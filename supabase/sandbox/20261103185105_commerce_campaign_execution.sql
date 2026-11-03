-- Isolated Sandbox only. Ticket purchases fund an internal execution allowance, never a second wallet debit.
alter table commerce.broadcasts add column campaign_order_id uuid unique references commerce.campaign_orders(id);
create table commerce.worker_heartbeats(host_id text primary key,seen_at timestamptz not null);
alter table commerce.worker_heartbeats enable row level security;
revoke all on commerce.worker_heartbeats from public,anon,authenticated;
grant select,insert,update on commerce.worker_heartbeats to service_role;

create or replace function public.commerce_command(p_owner text,p_command text,p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  t commerce.topups%rowtype; a commerce.approvals%rowtype; b commerce.broadcasts%rowtype;
  j commerce.jobs%rowtype; w commerce.wallets%rowtype;
  e commerce.broadcasts%rowtype;
  adjustment commerce.payment_adjustments%rowtype;
  inbox commerce.payment_adjustment_inbox%rowtype;
  v_key text := p_input->>'requestKey'; v_now timestamptz := clock_timestamp();
  v_ends timestamptz; v_amount bigint; v_release bigint; v_lease integer;
  v_result jsonb; v_jobs jsonb; v_ledger jsonb; v_report jsonb; v_bout jsonb;
  v_one text; v_two text; v_worker text := p_input->>'workerId'; v_count integer;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then raise exception 'commerce:invalid-input'; end if;
  if p_command not in ('claim_job','renew_job','complete_job','worker_jobs','release_job','lookup_order','record_adjustment') and
    (p_owner is null or length(p_owner) not between 1 and 128) then raise exception 'commerce:owner-required'; end if;
  if p_command in ('claim_job','renew_job','complete_job','worker_jobs') and
    (v_worker is null or length(v_worker) not between 1 and 128) then raise exception 'commerce:invalid-input'; end if;
  if p_command in ('create_topup','approve_budget','start_broadcast','enqueue_cup') and
    (v_key is null or length(v_key) not between 1 and 128) then raise exception 'commerce:invalid-input'; end if;
  perform id from commerce.mutex where id = true for update;
  v_now:=clock_timestamp();
  -- Losing a renderer lease says nothing about whether the audience saw the cup.
  -- Quarantine, never replay it automatically. Reads/stop/claim also expose this honest
  -- state for ended sessions, retaining every unresolved allocation until reconciliation.
  with candidates as (
    select x.id from commerce.jobs x join commerce.broadcasts s on s.id=x.broadcast_id
      where x.status='running' and (x.lease_until is null or x.lease_until<=v_now or s.ends_at<=v_now)
      order by coalesce(x.id::text=p_input->>'jobId',false) desc,
        coalesce(x.broadcast_id::text=p_input->>'broadcastId',false) desc,coalesce(x.owner=p_owner,false) desc,x.lease_until,x.id limit 100
  ), expired as (
    update commerce.jobs set status='unknown',result=jsonb_build_object('reason','lease-expired-outcome-unknown')
      where id in (select id from candidates) returning broadcast_id
  )
  update commerce.broadcasts set status=case when status='stopping' then 'stopping' else 'needs_attention' end
    where id in (select broadcast_id from expired) and status<>'completed';
  -- Deadline housekeeping is observed, bounded work rather than a mandatory cron/daemon.
  -- Target/owner priority makes normal reads finalize their own expired session first.
  -- Large queues drain in batches; uncancelled queued allocations stay held and cannot run.
  for e in select s.* from commerce.broadcasts s where s.ends_at<=v_now and s.status<>'completed'
    and (s.status<>'stopping' or s.reserved_credits>s.allocated_credits
      or exists(select 1 from commerce.jobs x where x.broadcast_id=s.id and x.status='queued'))
    order by coalesce(s.id::text=p_input->>'broadcastId',false) desc,coalesce(s.owner=p_owner,false) desc,s.ends_at,s.id limit 100
  loop
    update commerce.jobs set status='failed',finished_at=v_now,result='{"reason":"approval-expired-before-execution"}'::jsonb
      where id in (select x.id from commerce.jobs x where x.broadcast_id=e.id and x.status='queued' order by x.created_at,x.id limit 100);
    select coalesce(sum(price_credits),0) into v_amount from commerce.jobs where broadcast_id=e.id and status in ('queued','running','unknown');
    v_release:=e.reserved_credits-v_amount;
    if v_release>0 and e.campaign_order_id is null then
      update commerce.wallets set reserved_credits=reserved_credits-v_release where owner=e.owner;
      insert into commerce.ledger(owner,kind,cause_id,broadcast_id,balance_delta,reserved_delta)
        values(e.owner,'release',gen_random_uuid(),e.id,0,-v_release);
    end if;
    update commerce.broadcasts set reserved_credits=v_amount,allocated_credits=v_amount,
      status=case when v_amount=0 then 'completed' else 'stopping' end,stopped_at=coalesce(stopped_at,v_now) where id=e.id;
  end loop;
  if p_owner is not null then
    insert into commerce.wallets(owner) values(p_owner) on conflict(owner) do nothing;
    select * into w from commerce.wallets where owner=p_owner;
  end if;
  if p_command in ('approve_budget','start_broadcast','enqueue_cup') and w.spending_blocked then raise exception 'commerce:wallet-frozen'; end if;

  if p_command = 'wallet' then
    return to_jsonb(w) || jsonb_build_object('available_credits',w.balance_credits-w.reserved_credits);
  elsif p_command = 'create_topup' then
    select * into t from commerce.topups where owner=p_owner and request_key=v_key;
    if found then
      if t.input <> p_input then raise exception 'commerce:idempotency-conflict'; end if;
      return to_jsonb(t);
    end if;
    if w.spending_blocked then raise exception 'commerce:wallet-frozen'; end if;
    if coalesce(p_input->>'currency','') <> 'USD' or coalesce(p_input->>'amountCents','') !~ '^[1-9][0-9]{0,8}$'
      or coalesce(p_input->>'credits','') !~ '^[1-9][0-9]{0,9}$' then raise exception 'commerce:invalid-input'; end if;
    insert into commerce.topups(owner,request_key,input,input_hash,amount_cents,credits,currency)
      values(p_owner,v_key,p_input,md5(p_input::text),(p_input->>'amountCents')::integer,(p_input->>'credits')::integer,'USD') returning * into t;
    return to_jsonb(t);
  elsif p_command='record_adjustment' then
    if jsonb_typeof(p_input->'eventId') is distinct from 'string' or jsonb_typeof(p_input->'eventType') is distinct from 'string'
      or jsonb_typeof(p_input->'captureId') is distinct from 'string' or coalesce(p_input->>'eventId','') !~ '^[A-Za-z0-9_-]{1,128}$'
      or coalesce(p_input->>'eventType','') not in ('PAYMENT.CAPTURE.REFUNDED','PAYMENT.CAPTURE.REVERSED')
      or coalesce(p_input->>'captureId','') !~ '^[A-Za-z0-9_-]{1,128}$' then raise exception 'commerce:invalid-input'; end if;
    select * into t from commerce.topups where capture_id=p_input->>'captureId' and status='credited';
    if p_input->'providerOrderId' is not null and (jsonb_typeof(p_input->'providerOrderId') is distinct from 'string'
      or coalesce(p_input->>'providerOrderId','') !~ '^[A-Za-z0-9_-]{1,128}$'
      or (t.id is not null and p_input->>'providerOrderId' is distinct from t.provider_order_id)) then raise exception 'commerce:adjustment-mismatch'; end if;
    select * into inbox from commerce.payment_adjustment_inbox where event_id=p_input->>'eventId';
    if found then
      if inbox.event_type is distinct from p_input->>'eventType' or inbox.capture_id is distinct from p_input->>'captureId'
        or inbox.provider_order_id is distinct from p_input->>'providerOrderId' then raise exception 'commerce:idempotency-conflict'; end if;
    else
      insert into commerce.payment_adjustment_inbox(event_id,event_type,capture_id,provider_order_id)
        values(p_input->>'eventId',p_input->>'eventType',p_input->>'captureId',p_input->>'providerOrderId') returning * into inbox;
    end if;
    if t.id is null then return to_jsonb(inbox)||jsonb_build_object('status','pending_link'); end if;
    perform commerce.link_payment_adjustments(t.id);
    select * into adjustment from commerce.payment_adjustments where event_id=inbox.event_id;
    return to_jsonb(adjustment);
  elsif p_command = 'lookup_order' then
    select * into t from commerce.topups where provider_order_id=p_input->>'providerOrderId';
    if not found then raise exception 'commerce:not-found'; end if;
    return to_jsonb(t);
  elsif p_command in ('find_topup','attach_order','credit_capture') then
    select * into t from commerce.topups where id=(p_input->>'intentId')::uuid and owner=p_owner;
    if not found then raise exception 'commerce:not-found'; end if;
    if p_command='find_topup' then return to_jsonb(t); end if;
    if coalesce(p_input->>'providerOrderId','') !~ '^[A-Za-z0-9_-]{1,128}$' then raise exception 'commerce:invalid-input'; end if;
    if p_command='attach_order' then
      if t.provider_order_id is not null and t.provider_order_id<>p_input->>'providerOrderId' then raise exception 'commerce:order-conflict'; end if;
      if t.provider_order_id is null then
        update commerce.topups set provider_order_id=p_input->>'providerOrderId',status='ordered' where id=t.id returning * into t;
      end if;
      return to_jsonb(t);
    end if;
    if t.provider_order_id is null or t.provider_order_id<>p_input->>'providerOrderId'
      or p_input->>'status' is distinct from 'COMPLETED' or p_input->>'currency' is distinct from t.currency
      or coalesce(p_input->>'amountCents','') !~ '^[1-9][0-9]{0,8}$'
      or (p_input->>'amountCents')::integer <> t.amount_cents
      or coalesce(p_input->>'captureId','') !~ '^[A-Za-z0-9_-]{1,128}$' then raise exception 'commerce:capture-mismatch'; end if;
    if t.capture_id is not null then
      if t.capture_id<>p_input->>'captureId' then raise exception 'commerce:capture-conflict'; end if;
      perform commerce.link_payment_adjustments(t.id);
      return to_jsonb(t);
    end if;
    update commerce.topups set capture_id=p_input->>'captureId',status='credited',credited_at=v_now where id=t.id returning * into t;
    update commerce.wallets set balance_credits=balance_credits+t.credits where owner=p_owner;
    insert into commerce.ledger(owner,kind,cause_id,balance_delta,reserved_delta) values(p_owner,'topup',t.id,t.credits,0);
    perform commerce.link_payment_adjustments(t.id);
    return to_jsonb(t);

  elsif p_command='list_topups' then
    -- Newest 50 of this owner's top-ups, for reconciliation against PayPal's own records.
    return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (select * from commerce.topups where owner=p_owner order by created_at desc limit 50) x), '[]'::jsonb);
  elsif p_command='approve_budget' then
    select * into a from commerce.approvals where owner=p_owner and request_key=v_key;
    if found then
      if a.input<>p_input then raise exception 'commerce:idempotency-conflict'; end if;
      return to_jsonb(a);
    end if;
    v_ends := (p_input->>'endsAt')::timestamptz;
    if v_ends is null or v_ends<=v_now or v_ends>v_now+interval '24 hours'
      or length(coalesce(p_input->>'channelId','')) not between 1 and 128
      or coalesce(p_input->>'hostId','') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
      or length(coalesce(p_input->>'priceVersion','')) not between 1 and 128
      or coalesce(p_input->>'maxCredits','') !~ '^[1-9][0-9]{0,9}$'
      or p_input->'allowedTools' is distinct from '["host_cup"]'::jsonb
      or jsonb_typeof(p_input->'fighterIds') is distinct from 'array' then raise exception 'commerce:invalid-input'; end if;
    select count(distinct value) into v_count from jsonb_array_elements_text(p_input->'fighterIds');
    if v_count not between 4 and 128 or v_count<>jsonb_array_length(p_input->'fighterIds')
      or exists(select 1 from jsonb_array_elements(p_input->'fighterIds') x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 128)
      then raise exception 'commerce:invalid-input'; end if;
    insert into commerce.approvals(owner,request_key,input,input_hash,channel_id,host_id,ends_at,max_credits,allowed_tools,fighter_ids,price_version)
      values(p_owner,v_key,p_input,md5(p_input::text),p_input->>'channelId',p_input->>'hostId',v_ends,(p_input->>'maxCredits')::integer,
        p_input->'allowedTools',p_input->'fighterIds',p_input->>'priceVersion') returning * into a;
    return to_jsonb(a);

  elsif p_command='start_broadcast' then
    select * into b from commerce.broadcasts where owner=p_owner and request_key=v_key;
    if found then
      if b.input<>p_input then raise exception 'commerce:idempotency-conflict'; end if;
      return to_jsonb(b);
    end if;
    select * into a from commerce.approvals where id=(p_input->>'approvalId')::uuid and owner=p_owner;
    if not found then raise exception 'commerce:not-found'; end if;
    if a.ends_at<=v_now then raise exception 'commerce:approval-expired'; end if;
    if exists(select 1 from commerce.broadcasts where approval_id=a.id) then raise exception 'commerce:approval-used'; end if;
    if exists(select 1 from commerce.broadcasts where owner=p_owner and channel_id=a.channel_id and status<>'completed') then raise exception 'commerce:channel-busy'; end if;
    if w.balance_credits-w.reserved_credits<a.max_credits then raise exception 'commerce:insufficient-credits'; end if;
    insert into commerce.broadcasts(owner,request_key,input,input_hash,approval_id,channel_id,host_id,ends_at,initial_credits,reserved_credits)
      values(p_owner,v_key,p_input,md5(p_input::text),a.id,a.channel_id,a.host_id,a.ends_at,a.max_credits,a.max_credits) returning * into b;
    update commerce.wallets set reserved_credits=reserved_credits+a.max_credits where owner=p_owner;
    insert into commerce.ledger(owner,kind,cause_id,broadcast_id,balance_delta,reserved_delta) values(p_owner,'reserve',b.id,b.id,0,a.max_credits);
    return to_jsonb(b);

  elsif p_command='enqueue_cup' then
    select * into j from commerce.jobs where owner=p_owner and request_key=v_key;
    if found then
      if j.input<>p_input then raise exception 'commerce:idempotency-conflict'; end if;
      return to_jsonb(j);
    end if;
    select * into b from commerce.broadcasts where id=(p_input->>'broadcastId')::uuid and owner=p_owner;
    if not found then raise exception 'commerce:not-found'; end if;
    if b.ends_at<=v_now then raise exception 'commerce:approval-expired'; end if;
    if b.status not in ('queued','running') then raise exception 'commerce:broadcast-stopped'; end if;
    select * into a from commerce.approvals where id=b.approval_id;
    if p_input->>'priceVersion' is distinct from a.price_version then raise exception 'commerce:price-version-conflict'; end if;
    if jsonb_typeof(p_input->'fighterIds') is distinct from 'array' then raise exception 'commerce:invalid-input'; end if;
    select count(distinct value) into v_count from jsonb_array_elements_text(p_input->'fighterIds');
    if v_count<>4 or jsonb_array_length(p_input->'fighterIds')<>4 or not a.fighter_ids @> (p_input->'fighterIds')
      or coalesce(p_input->>'priceCredits','') !~ '^[1-9][0-9]{0,8}$' then raise exception 'commerce:invalid-input'; end if;
    v_amount:=(p_input->>'priceCredits')::integer;
    if b.reserved_credits-b.allocated_credits<v_amount then raise exception 'commerce:insufficient-credits'; end if;
    insert into commerce.jobs(owner,broadcast_id,host_id,request_key,input,input_hash,fighter_ids,price_version,price_credits)
      values(p_owner,b.id,b.host_id,v_key,p_input,md5(p_input::text),p_input->'fighterIds',a.price_version,v_amount) returning * into j;
    update commerce.broadcasts set allocated_credits=allocated_credits+v_amount where id=b.id;
    return to_jsonb(j);

  elsif p_command='claim_job' then
    insert into commerce.worker_heartbeats(host_id,seen_at) values(p_input->>'hostId',v_now)
      on conflict(host_id) do update set seen_at=excluded.seen_at;
    v_lease:=coalesce((p_input->>'leaseSeconds')::integer,60);
    if v_lease not between 1 and 300 or coalesce(p_input->>'hostId','') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' then raise exception 'commerce:invalid-input'; end if;
    -- A cup takes about two minutes and its lease ends at the session's end: one claimed later than this window before
    -- ends_at could only end unknown and hold the host. COMMERCE_CATALOG.tools.host_cup.startWindowSeconds states it too.
    select x.* into j from commerce.jobs x join commerce.broadcasts s on s.id=x.broadcast_id join commerce.wallets funds on funds.owner=x.owner
      where not funds.spending_blocked and s.status in ('queued','running') and s.ends_at>v_now+interval '240 seconds' and x.host_id=p_input->>'hostId' and
        x.status='queued'
        and not exists(select 1 from commerce.jobs active where active.host_id=x.host_id and active.id<>x.id
          and active.status in ('running','unknown'))
      order by x.created_at,x.id limit 1;
    if not found then return null; end if;
    select * into b from commerce.broadcasts where id=j.broadcast_id;
    update commerce.jobs set status='running',worker_id=v_worker,lease_token=lease_token+1,
      lease_until=least(v_now+make_interval(secs=>v_lease),b.ends_at) where id=j.id returning * into j;
    update commerce.broadcasts set status='running' where id=b.id;
    return to_jsonb(j) || jsonb_build_object('channel_id',b.channel_id,'ends_at',b.ends_at);

  elsif p_command in ('renew_job','complete_job') then
    select * into j from commerce.jobs where id=(p_input->>'jobId')::uuid;
    if not found then raise exception 'commerce:not-found'; end if;
    select * into b from commerce.broadcasts where id=j.broadcast_id;
    if p_command='renew_job' and exists(select 1 from commerce.wallets where owner=j.owner and spending_blocked) then raise exception 'commerce:wallet-frozen'; end if;
    -- Terminal retry is idempotent only for the identical fenced completion, including evidence.
    if p_command='complete_job' and j.status in ('succeeded','failed') then
      if j.completion_input=p_input then return to_jsonb(j); end if;
      raise exception 'commerce:completion-conflict';
    end if;
    if j.worker_id is distinct from v_worker or j.lease_token is distinct from (p_input->>'leaseToken')::bigint
      or j.lease_until is null or j.lease_until<=v_now or j.status not in ('running','unknown') then raise exception 'commerce:stale-lease'; end if;
    if p_command='renew_job' then
      v_lease:=coalesce((p_input->>'leaseSeconds')::integer,60);
      if v_lease not between 1 and 300 then raise exception 'commerce:invalid-input'; end if;
      -- Stop ends new work; the cup already on screen keeps its lease and settles like any other.
      if b.ends_at<=v_now or b.status not in ('queued','running','stopping') or j.status<>'running' then raise exception 'commerce:broadcast-stopped'; end if;
      update commerce.jobs set lease_until=least(v_now+make_interval(secs=>v_lease),b.ends_at) where id=j.id returning * into j;
      return to_jsonb(j);
    end if;
    if p_input->>'outcome'='unknown' then
      update commerce.jobs set status='unknown',result=p_input->'result' where id=j.id returning * into j;
      update commerce.broadcasts set status='needs_attention' where id=b.id;
      return to_jsonb(j);
    elsif p_input->>'outcome'='succeeded' then
      if exists(select 1 from commerce.wallets where owner=j.owner and spending_blocked) then raise exception 'commerce:wallet-frozen'; end if;
      if b.ends_at<=v_now then raise exception 'commerce:approval-expired'; end if;
      v_result:=p_input->'result';
      if v_result->'protocolVersion' is distinct from '1'::jsonb
        or jsonb_typeof(v_result->'jobId') is distinct from 'string' or v_result->>'jobId' is distinct from j.id::text
        or v_result->'leaseToken' is distinct from to_jsonb(j.lease_token) or v_result->'seed' is distinct from to_jsonb(j.seed)
        or jsonb_typeof(v_result->'winnerId') is distinct from 'string' then raise exception 'commerce:invalid-result'; end if;
      if jsonb_typeof(v_result->'bouts') is distinct from 'array' then raise exception 'commerce:invalid-result'; end if;
      if jsonb_array_length(v_result->'bouts')<>3 then raise exception 'commerce:invalid-result'; end if;
      for n in 0..2 loop
        v_bout:=v_result->'bouts'->n;
        if jsonb_typeof(v_bout->'leftId') is distinct from 'string' or jsonb_typeof(v_bout->'rightId') is distinct from 'string'
          or jsonb_typeof(v_bout->'winnerId') is distinct from 'string'
          or v_bout->'seed' is distinct from to_jsonb((j.seed::bigint+n)%4294967296)
          or jsonb_typeof(v_bout->'digest') is distinct from 'string' or coalesce(v_bout->>'digest','') !~ '^[a-fA-F0-9]{8}$'
          or coalesce(v_bout->>'how','') not in ('ko','decision')
          or jsonb_typeof(v_bout->'ms') is distinct from 'number'
          or jsonb_typeof(v_bout->'hp') is distinct from 'array' or jsonb_typeof(v_bout->'contacts') is distinct from 'array'
          then raise exception 'commerce:invalid-result'; end if;
        if (v_bout->>'ms')::numeric<0 or (v_bout->>'ms')::numeric>1.7976931348623157e308
          or jsonb_array_length(v_bout->'hp')<>2 or jsonb_array_length(v_bout->'contacts')<>2 then raise exception 'commerce:invalid-result'; end if;
        for k in 0..1 loop
          if jsonb_typeof(v_bout->'hp'->k) is distinct from 'number' or jsonb_typeof(v_bout->'contacts'->k) is distinct from 'number'
            then raise exception 'commerce:invalid-result'; end if;
          if (v_bout->'hp'->>k)::numeric not between 0 and 1 or (v_bout->'contacts'->>k)::numeric not between 0 and 9007199254740991
            or trunc((v_bout->'contacts'->>k)::numeric)<>(v_bout->'contacts'->>k)::numeric then raise exception 'commerce:invalid-result'; end if;
        end loop;
        if n=0 then v_one:=j.fighter_ids->>0; v_two:=j.fighter_ids->>1;
        elsif n=1 then v_one:=j.fighter_ids->>2; v_two:=j.fighter_ids->>3;
        else v_one:=v_result->'bouts'->0->>'winnerId'; v_two:=v_result->'bouts'->1->>'winnerId'; end if;
        if v_bout->>'leftId' is distinct from v_one or v_bout->>'rightId' is distinct from v_two
          or coalesce(v_bout->>'winnerId','') not in (v_one,v_two) then raise exception 'commerce:invalid-result'; end if;
        if v_bout->'winner' is distinct from (case when v_bout->>'winnerId'=v_one then '0'::jsonb else '1'::jsonb end)
          then raise exception 'commerce:invalid-result'; end if;
      end loop;
      if v_result->>'winnerId' is distinct from v_result->'bouts'->2->>'winnerId' then raise exception 'commerce:invalid-result'; end if;
      if b.campaign_order_id is null then
        update commerce.wallets set balance_credits=balance_credits-j.price_credits,reserved_credits=reserved_credits-j.price_credits where owner=j.owner;
      end if;
      update commerce.broadcasts set allocated_credits=allocated_credits-j.price_credits,reserved_credits=reserved_credits-j.price_credits,
        spent_credits=spent_credits+j.price_credits where id=b.id;
      if b.campaign_order_id is null then
        insert into commerce.ledger(owner,kind,cause_id,broadcast_id,balance_delta,reserved_delta) values(j.owner,'spend',j.id,b.id,-j.price_credits,-j.price_credits);
      end if;
    elsif p_input->>'outcome'='failed' then
      update commerce.broadcasts set allocated_credits=allocated_credits-j.price_credits where id=b.id;
    else raise exception 'commerce:invalid-input'; end if;
    update commerce.jobs set status=case when p_input->>'outcome'='succeeded' then 'succeeded' else 'failed' end,
      result=p_input->'result',completion_input=p_input,finished_at=v_now where id=j.id returning * into j;
    -- Closing sessions retain every unresolved allocation; a confirmed failure is now safe to release.
    select * into b from commerce.broadcasts where id=b.id;
    if b.status in ('stopping','needs_attention') then
      v_release:=b.reserved_credits-b.allocated_credits;
      if v_release>0 then
        if b.campaign_order_id is null then
          update commerce.wallets set reserved_credits=reserved_credits-v_release where owner=b.owner;
        end if;
        update commerce.broadcasts set reserved_credits=allocated_credits where id=b.id;
        if b.campaign_order_id is null then
          insert into commerce.ledger(owner,kind,cause_id,broadcast_id,balance_delta,reserved_delta) values(b.owner,'release',j.id,b.id,0,-v_release);
        end if;
      end if;
      update commerce.broadcasts set status=case when allocated_credits=0 then 'completed' else 'stopping' end where id=b.id;
    end if;
    return to_jsonb(j);

  elsif p_command='worker_jobs' then
    -- A runner that lost a claim or completion reply asks what the server holds for it before anything else.
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]'::jsonb) into v_jobs from commerce.jobs x
      where x.worker_id=v_worker and (case when p_input ? 'jobId' then x.id=(p_input->>'jobId')::uuid else x.status in ('running','unknown') end);
    return v_jobs;
  elsif p_command='release_job' then
    -- Operator only (service role, never an HTTP route): close an unknown job without charging it. This frees its host
    -- slot and allocation; the session closes as a confirmed failure would close it.
    select * into j from commerce.jobs where id=(p_input->>'jobId')::uuid;
    if not found then raise exception 'commerce:not-found'; end if;
    if j.status<>'unknown' then raise exception 'commerce:job-not-unknown'; end if;
    if length(coalesce(p_input->>'note','')) not between 1 and 500 then raise exception 'commerce:invalid-input'; end if;
    update commerce.broadcasts set allocated_credits=allocated_credits-j.price_credits where id=j.broadcast_id returning * into b;
    update commerce.jobs set status='failed',finished_at=v_now,result=jsonb_build_object('reason','operator-released-unknown',
      'note',p_input->>'note','unknownResult',j.result) where id=j.id returning * into j;
    if b.status in ('stopping','needs_attention') then
      v_release:=b.reserved_credits-b.allocated_credits;
      if v_release>0 then
        if b.campaign_order_id is null then
          update commerce.wallets set reserved_credits=reserved_credits-v_release where owner=b.owner;
        end if;
        update commerce.broadcasts set reserved_credits=allocated_credits where id=b.id;
        if b.campaign_order_id is null then
          insert into commerce.ledger(owner,kind,cause_id,broadcast_id,balance_delta,reserved_delta) values(b.owner,'release',j.id,b.id,0,-v_release);
        end if;
      end if;
      update commerce.broadcasts set status=case when allocated_credits=0 then 'completed' else 'stopping' end where id=b.id;
    end if;
    return to_jsonb(j);
  elsif p_command='get_job' then
    select * into j from commerce.jobs where id=(p_input->>'jobId')::uuid and owner=p_owner;
    if not found then raise exception 'commerce:not-found'; end if;
    return to_jsonb(j);
  elsif p_command in ('stop_broadcast','report','list_jobs') then
    select * into b from commerce.broadcasts where id=(p_input->>'broadcastId')::uuid and owner=p_owner;
    if not found then raise exception 'commerce:not-found'; end if;
    if p_command='stop_broadcast' and b.status<>'completed' then
      update commerce.jobs set status='failed',finished_at=v_now,result='{"reason":"stopped-before-execution"}'::jsonb
        where broadcast_id=b.id and status='queued';
      select coalesce(sum(price_credits),0) into v_amount from commerce.jobs where broadcast_id=b.id and status in ('running','unknown');
      v_release:=b.reserved_credits-v_amount;
      if v_release>0 then
        if b.campaign_order_id is null then
          update commerce.wallets set reserved_credits=reserved_credits-v_release where owner=b.owner;
        end if;
        if b.campaign_order_id is null then
          insert into commerce.ledger(owner,kind,cause_id,broadcast_id,balance_delta,reserved_delta) values(b.owner,'release',gen_random_uuid(),b.id,0,-v_release);
        end if;
      end if;
      update commerce.broadcasts set reserved_credits=v_amount,allocated_credits=v_amount,
        status=case when v_amount=0 then 'completed' else 'stopping' end,stopped_at=coalesce(stopped_at,v_now) where id=b.id returning * into b;
    end if;
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]'::jsonb) into v_jobs from commerce.jobs x where broadcast_id=b.id;
    if p_command='list_jobs' then return v_jobs; end if;
    if p_command='stop_broadcast' then return to_jsonb(b); end if;
    if b.final_report is not null then return b.final_report; end if;
    select * into a from commerce.approvals where id=b.approval_id and owner=p_owner;
    if not found then raise exception 'commerce:not-found'; end if;
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]'::jsonb) into v_ledger from commerce.ledger x
      where owner=b.owner and broadcast_id=b.id;
    v_report:=jsonb_build_object('schema_version',1,'channel_identity','operator-label-unverified','broadcast',to_jsonb(b),'jobs',v_jobs,'ledger',v_ledger,
      'approval',jsonb_build_object('fighter_ids',a.fighter_ids,'allowed_tools',a.allowed_tools,'price_version',a.price_version,
        'channel_id',a.channel_id,'host_id',a.host_id,'ends_at',a.ends_at,'max_credits',a.max_credits),
      'confirmed_spent_credits',b.spent_credits,'remaining_reserved_credits',b.reserved_credits,
      'broadcast_observation',jsonb_build_object('status','unverified','live_seconds',null));
    if b.status='completed' then update commerce.broadcasts set final_report=v_report where id=b.id; end if;
    return v_report;
  else raise exception 'commerce:invalid-input'; end if;
exception
  when unique_violation then raise exception 'commerce:unique-conflict';
  when invalid_text_representation or numeric_value_out_of_range or check_violation or datetime_field_overflow or invalid_datetime_format then raise exception 'commerce:invalid-input';
end $$;
revoke all on function public.commerce_command(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_command(text,text,jsonb) to service_role;

alter function commerce.campaign_snapshot(commerce.campaign_orders) rename to campaign_snapshot_schedule;
create function commerce.campaign_snapshot(o commerce.campaign_orders) returns jsonb
language sql stable security invoker set search_path='' as $$
  select commerce.campaign_snapshot_schedule(o)||jsonb_build_object('broadcastId',b.id,'executionStatus',b.status,
    'stoppedAt',b.stopped_at,'billingMode',case when b.id is null then null else 'ticket_included' end)
  from (select 1) anchor left join commerce.broadcasts b on b.campaign_order_id=o.id;
$$;
revoke all on function commerce.campaign_snapshot(commerce.campaign_orders),commerce.campaign_snapshot_schedule(commerce.campaign_orders) from public,anon,authenticated;
grant execute on function commerce.campaign_snapshot(commerce.campaign_orders),commerce.campaign_snapshot_schedule(commerce.campaign_orders) to service_role;

-- FIFO attribution of the existing append-only wallet ledger. No new money or synthetic top-up is minted.
create function commerce.campaign_funding(p_order uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  with o as (select * from commerce.campaign_orders where id=p_order),
  credits as (select l.cause_id,sum(l.balance_delta) over(order by l.created_at,l.id) hi,l.balance_delta amount
    from commerce.ledger l,o where l.owner=o.owner and l.kind='topup'),
  debits as (select l.cause_id,sum(-l.balance_delta) over(order by l.created_at,l.id) hi,-l.balance_delta amount
    from commerce.ledger l,o where l.owner=o.owner and l.kind='spend'),
  shares as (select c.cause_id,greatest(0,least(c.hi,d.hi)-greatest(c.hi-c.amount,d.hi-d.amount)) amount
    from credits c cross join debits d where d.cause_id=p_order)
  select coalesce(jsonb_agg(jsonb_build_object('intentId',t.id,'orderId',t.provider_order_id,'captureId',t.capture_id,
    'credits',s.amount,'status',t.status) order by t.created_at,t.id),'[]')
  from shares s join commerce.topups t on t.id=s.cause_id where s.amount>0;
$$;
revoke all on function commerce.campaign_funding(uuid) from public,anon,authenticated;
grant execute on function commerce.campaign_funding(uuid) to service_role;

create function public.commerce_campaign_execution(p_owner text,p_command text,p_input jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o commerce.campaign_orders%rowtype;b commerce.broadcasts%rowtype;a commerce.approvals%rowtype;
  v_now timestamptz:=clock_timestamp();v_input jsonb;v_report jsonb;v_funding jsonb;v_result jsonb;v_host text;
begin
  if p_command='health' then perform campaign_order_id from commerce.broadcasts limit 1; return '{"schemaVersion":1}'::jsonb; end if;
  if p_command='continuations' then
    return coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'owner',b.owner,'orderId',b.campaign_order_id))
      from commerce.broadcasts b where b.campaign_order_id is not null and b.status<>'completed'),'[]');
  end if;
  if p_command='playback' then
    select * into o from commerce.campaign_orders where watch_token=p_input->>'watchToken' and started_at is not null;
    if not found then raise exception 'commerce:not-found'; end if;
    select * into b from commerce.broadcasts where campaign_order_id=o.id;
    if not found then return 'null'; end if;
    return jsonb_build_object('status',b.status,'stoppedAt',b.stopped_at,'cups',
      (select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'seed',j.seed,'bouts',j.result->'bouts') order by j.created_at,j.id),'[]')
        from commerce.jobs j where j.broadcast_id=b.id and j.status='succeeded'));
  end if;
  if p_owner is null then raise exception 'commerce:owner-required'; end if;
  perform id from commerce.mutex where id=true for update;
  select * into o from commerce.campaign_orders where owner=p_owner and id=(p_input->>'orderId')::uuid;
  if not found then raise exception 'commerce:not-found'; end if;
  perform public.commerce_command(p_owner,'wallet');
  select * into b from commerce.broadcasts where campaign_order_id=o.id;
  if p_command='start' then
    if b.id is not null then return commerce.campaign_snapshot(o); end if;
    -- Older started purchases stay readable; never manufacture retroactive execution evidence.
    if o.started_at is not null then raise exception 'commerce:legacy-broadcast'; end if;
    if o.status<>'ready' or o.media_id is null then raise exception 'commerce:campaign-media-required'; end if;
    if o.scheduled_at is null then raise exception 'commerce:campaign-schedule-required'; end if;
    if o.schedule_revision is distinct from (p_input->>'expectedRevision')::integer then raise exception 'commerce:schedule-changed'; end if;
    if o.media_id is distinct from (p_input->>'expectedMediaId')::uuid then raise exception 'commerce:media-changed'; end if;
    if exists(select 1 from commerce.wallets where owner=p_owner and spending_blocked) then raise exception 'commerce:wallet-frozen'; end if;
    v_host:=p_input->>'hostId';
    if not exists(select 1 from commerce.worker_heartbeats where host_id=v_host and seen_at>v_now-interval '90 seconds') then
      raise exception 'commerce:campaign-host-offline'; end if;
    if exists(select 1 from commerce.broadcasts where host_id=v_host and status<>'completed') then raise exception 'commerce:campaign-host-busy'; end if;
    if p_input->>'priceVersion' is null or (p_input->>'requestKey')::uuid is null then raise exception 'commerce:invalid-input'; end if;
    v_input:=jsonb_build_object('campaignOrderId',o.id,'billingMode','ticket_included');
    insert into commerce.approvals(owner,request_key,input,input_hash,channel_id,host_id,ends_at,max_credits,allowed_tools,fighter_ids,price_version)
      values(p_owner,'campaign:'||o.id,v_input,md5(v_input::text),'campaign:'||o.id,v_host,
        v_now+make_interval(secs=>o.duration_seconds),o.price_credits,'["host_cup"]',to_jsonb(o.fighter_ids),p_input->>'priceVersion') returning * into a;
    insert into commerce.broadcasts(owner,request_key,input,input_hash,approval_id,channel_id,host_id,ends_at,initial_credits,reserved_credits,campaign_order_id)
      values(p_owner,'campaign:'||o.id,v_input,md5(v_input::text),a.id,a.channel_id,a.host_id,a.ends_at,a.max_credits,a.max_credits,o.id) returning * into b;
    update commerce.campaign_orders set status='started',started_at=v_now,start_request_key=(p_input->>'requestKey')::uuid where id=o.id returning * into o;
    insert into commerce.campaign_events(order_id,kind,detail) values(o.id,'started',jsonb_build_object('startedAt',v_now,'broadcastId',b.id,'billingMode','ticket_included'));
    return commerce.campaign_snapshot(o);
  end if;
  if b.id is null then raise exception 'commerce:campaign-execution-missing'; end if;
  if p_command='stop' then perform public.commerce_command(p_owner,'stop_broadcast',jsonb_build_object('broadcastId',b.id)); end if;
  v_report:=public.commerce_command(p_owner,'report',jsonb_build_object('broadcastId',b.id));
  v_funding:=commerce.campaign_funding(o.id);
  if p_command='settlement' then
    if v_report->'broadcast'->>'status'<>'completed' then raise exception 'commerce:broadcast-not-finished'; end if;
    insert into commerce.campaign_events(order_id,kind,detail) values(o.id,'settlement',p_input->'report');
  elsif p_command not in ('report','stop') then raise exception 'commerce:invalid-command'; end if;
  select detail into v_result from commerce.campaign_events where order_id=o.id and kind='settlement' order by id desc limit 1;
  return jsonb_build_object('order',commerce.campaign_snapshot(o),'execution',v_report,'funding',v_funding,'settlement',v_result,
    'events',(select coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'at',e.created_at) order by e.id),'[]') from commerce.campaign_events e where e.order_id=o.id));
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'commerce:invalid-input';
end;
$$;
revoke all on function public.commerce_campaign_execution(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_campaign_execution(text,text,jsonb) to service_role;

-- Every payout entry point (including the old operator console) enforces the ticket's settlement.
alter function public.commerce_payout(text,text,jsonb) rename to commerce_payout_metered;
create function public.commerce_payout(p_owner text,p_command text,p_input jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b commerce.broadcasts%rowtype;v_settlement jsonb;v_funding jsonb;
begin
  perform id from commerce.mutex where id=true for update;
  if p_command='propose' then select * into b from commerce.broadcasts where id=(p_input->>'broadcastId')::uuid and owner=p_owner;
  elsif p_command='approve' then
    select s.* into b from commerce.broadcasts s join commerce.payout_batches p on p.broadcast_id=s.id where p.id=(p_input->>'batchId')::uuid and p.owner=p_owner;
  end if;
  if b.campaign_order_id is not null then
    if b.status<>'completed' or exists(select 1 from commerce.jobs where broadcast_id=b.id and status in ('queued','running','unknown'))
      then raise exception 'commerce:broadcast-not-finished'; end if;
    if exists(select 1 from commerce.wallets where owner=p_owner and spending_blocked) then raise exception 'commerce:wallet-frozen'; end if;
    select detail into v_settlement from commerce.campaign_events where order_id=b.campaign_order_id and kind='settlement' order by id desc limit 1;
    v_funding:=commerce.campaign_funding(b.campaign_order_id);
    if v_settlement is null or v_settlement->>'status'<>'matched'
      or (v_settlement->>'checkedAt')::timestamptz<clock_timestamp()-interval '15 minutes'
      or exists(select 1 from jsonb_array_elements(v_funding) f where f->>'status'<>'credited')
      then raise exception 'commerce:campaign-settlement-required'; end if;
  end if;
  return public.commerce_payout_metered(p_owner,p_command,p_input);
end;
$$;
revoke all on function public.commerce_payout(text,text,jsonb),public.commerce_payout_metered(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_payout(text,text,jsonb),public.commerce_payout_metered(text,text,jsonb) to service_role;
