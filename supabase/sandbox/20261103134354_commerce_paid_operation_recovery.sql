-- Sandbox only. Apply after commerce_paid_operations. Durable payment recovery and operational history.
alter table commerce.operations add column effective_ends_at timestamptz;
update commerce.operations set effective_ends_at=(input->>'endsAt')::timestamptz where effective_ends_at is null;
alter table commerce.operations alter column effective_ends_at set not null;
create function commerce.initialize_operation_deadline() returns trigger language plpgsql security invoker set search_path='' as $$
begin new.effective_ends_at:=(new.input->>'endsAt')::timestamptz; return new; end;
$$;
create trigger commerce_operation_deadline before insert on commerce.operations for each row execute function commerce.initialize_operation_deadline();
revoke all on function commerce.initialize_operation_deadline() from public,anon,authenticated;
grant execute on function commerce.initialize_operation_deadline() to service_role;

create table commerce.operation_events (
  id bigint generated always as identity primary key, operation_id uuid not null references commerce.operations(id),
  kind text not null check(length(kind) between 1 and 80), detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index commerce_operation_events_history on commerce.operation_events(operation_id,id desc);
alter table commerce.operation_events enable row level security;
revoke all on commerce.operation_events from public,anon,authenticated;
grant select,insert on commerce.operation_events to service_role;
grant usage,select on sequence commerce.operation_events_id_seq to service_role;
create trigger commerce_operation_events_immutable before update or delete on commerce.operation_events
  for each row execute function commerce.reject_ledger_mutation();

create table commerce.operation_recovery (
  operation_id uuid primary key references commerce.operations(id),
  state text not null default 'pending' check(state in ('pending','leased','waiting_for_approval','succeeded','needs_attention')),
  lease_id uuid, lease_until timestamptz, attempts integer not null default 0, failures integer not null default 0,
  next_at timestamptz not null default clock_timestamp(), last_code text, approval_url text,
  updated_at timestamptz not null default clock_timestamp(), checked_at timestamptz
);
create index commerce_operation_recovery_due on commerce.operation_recovery(next_at) where state in ('pending','waiting_for_approval','leased');
alter table commerce.operation_recovery enable row level security;
revoke all on commerce.operation_recovery from public,anon,authenticated;
grant select,insert,update on commerce.operation_recovery to service_role;

create function commerce.audit_paid_operation() returns trigger language plpgsql security invoker set search_path='' as $$
declare v_id uuid; v_kind text; v_detail jsonb:='{}';
begin
  if tg_table_name='operations' then
    v_id:=new.id;
    if tg_op='INSERT' then v_kind:='task_prepared';
    elsif new.approval_id is distinct from old.approval_id then
      v_kind:=case when old.approval_id is null then 'task_approved' else 'consent_renewed' end;
      v_detail:=jsonb_build_object('approvalId',new.approval_id,'endsAt',new.effective_ends_at);
    elsif new.cancelled_at is distinct from old.cancelled_at then v_kind:='task_cancelled';
    elsif new.topup_id is distinct from old.topup_id then v_kind:='funding_requested';
    elsif new.job_id is distinct from old.job_id then v_kind:='job_queued';v_detail:=jsonb_build_object('jobId',new.job_id);
    end if;
  elsif tg_table_name='jobs' then
    if new.status is distinct from old.status then
      select id into v_id from commerce.operations where job_id=new.id;
      v_kind:='job_'||new.status;v_detail:=jsonb_build_object('jobId',new.id);
    end if;
  elsif tg_table_name='payment_adjustments' then
    select id into v_id from commerce.operations where topup_id=new.topup_id;
    v_kind:='payment_adjusted';v_detail:=jsonb_build_object('eventId',new.event_id,'eventType',new.event_type);
  else
    if new.provider_order_id is distinct from old.provider_order_id or new.status is distinct from old.status then
      select id into v_id from commerce.operations where topup_id=new.id;
      v_kind:='payment_'||new.status;v_detail:=jsonb_build_object('orderId',new.provider_order_id,'captureId',new.capture_id);
      if new.status='credited' then
        update commerce.operation_recovery set state='succeeded',lease_id=null,lease_until=null,last_code=null,checked_at=clock_timestamp(),updated_at=clock_timestamp()
          where operation_id=v_id;
      end if;
    end if;
  end if;
  if v_id is not null and v_kind is not null then insert into commerce.operation_events(operation_id,kind,detail) values(v_id,v_kind,v_detail); end if;
  return new;
end;
$$;
create trigger commerce_operation_audit after insert or update on commerce.operations for each row execute function commerce.audit_paid_operation();
create trigger commerce_operation_job_audit after update of status on commerce.jobs for each row execute function commerce.audit_paid_operation();
create trigger commerce_operation_payment_audit after update on commerce.topups for each row execute function commerce.audit_paid_operation();
create trigger commerce_operation_adjustment_audit after insert on commerce.payment_adjustments for each row execute function commerce.audit_paid_operation();
revoke all on function commerce.audit_paid_operation() from public,anon,authenticated;
grant execute on function commerce.audit_paid_operation() to service_role;

create or replace function commerce.operation_snapshot(o commerce.operations) returns jsonb
language sql stable security invoker set search_path='' as $$
  select to_jsonb(o)||jsonb_build_object(
    'state',case when j.status='succeeded' then 'completed' when j.status='unknown' then 'needs_reconciliation'
      when j.status='failed' then 'failed' when o.cancelled_at is not null and j.status='running' then 'cancelling'
      when o.cancelled_at is not null then 'cancelled' when w.spending_blocked then 'blocked'
      when j.status='running' then 'running' when j.status='queued' then 'queued'
      when r.state='needs_attention' and t.status<>'credited' then 'payment_review'
      when o.effective_ends_at<=clock_timestamp()+interval '240 seconds' then 'expired'
      when o.approval_id is null then 'awaiting_approval'
      when t.id is not null and t.status<>'credited' then 'awaiting_payment'
      when w.balance_credits-w.reserved_credits<(o.input->>'maxCredits')::integer then 'awaiting_payment' else 'ready' end,
    'payment',case when t.id is null then null else jsonb_build_object('intent_id',t.id,'status',t.status,
      'provider_order_id',t.provider_order_id,'capture_id',t.capture_id,'amount_cents',t.amount_cents,'credits',t.credits,'currency',t.currency) end,
    'job',case when j.id is null then null else to_jsonb(j)-'completion_input'-'lease_token'-'worker_id' end,
    'recovery',case when r.operation_id is null then null else jsonb_build_object('state',r.state,'attempts',r.attempts,
      'last_code',r.last_code,'checked_at',r.checked_at,'next_at',r.next_at) end,
    'available_credits',w.balance_credits-w.reserved_credits,'spending_blocked',w.spending_blocked)
  from commerce.wallets w left join commerce.topups t on t.id=o.topup_id left join commerce.jobs j on j.id=o.job_id
    left join commerce.operation_recovery r on r.operation_id=o.id where w.owner=o.owner;
$$;

alter function public.commerce_operation(text,text,jsonb) rename to commerce_operation_v1;
revoke all on function public.commerce_operation_v1(text,text,jsonb) from public,anon,authenticated;
create function public.commerce_operation(p_owner text,p_command text,p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o commerce.operations%rowtype; v jsonb; a jsonb; v_ends timestamptz; v_rows jsonb; v_limit integer;
begin
  if p_owner is null then raise exception 'commerce:owner-required'; end if;
  perform id from commerce.mutex where id=true for update;
  if p_command='page' then
    perform public.commerce_command(p_owner,'wallet');
    v_limit:=coalesce((p_input->>'limit')::integer,20);
    if v_limit not between 1 and 50 or length(coalesce(p_input->>'query',''))>64
      or coalesce(p_input->>'filter','all') not in ('all','active','attention','completed') then raise exception 'commerce:invalid-input'; end if;
    select coalesce(jsonb_agg(snap order by created_at desc,id desc),'[]') into v_rows from (
      select x.id,x.created_at,commerce.operation_snapshot(x) snap from commerce.operations x where owner=p_owner
        and (not(p_input?'cursor') or (x.created_at,x.id)<((p_input->'cursor'->>'createdAt')::timestamptz,(p_input->'cursor'->>'id')::uuid))
        and strpos(lower(x.input->>'channelId'),lower(coalesce(p_input->>'query','')))>0
        and (coalesce(p_input->>'filter','all')='all'
          or (p_input->>'filter'='completed' and commerce.operation_snapshot(x)->>'state' in ('completed','failed','cancelled'))
          or (p_input->>'filter'='attention' and commerce.operation_snapshot(x)->>'state' in ('needs_reconciliation','payment_review','blocked','expired'))
          or (p_input->>'filter'='active' and commerce.operation_snapshot(x)->>'state' not in ('completed','failed','cancelled')))
      order by x.created_at desc,x.id desc limit v_limit+1
    ) page;
    return jsonb_build_object('items',case when jsonb_array_length(v_rows)>v_limit then v_rows-v_limit else v_rows end,
      'has_more',jsonb_array_length(v_rows)>v_limit,'next_cursor',case when jsonb_array_length(v_rows)>v_limit then
        jsonb_build_object('created_at',v_rows->(v_limit-1)->>'created_at','id',v_rows->(v_limit-1)->>'id') else null end);
  elsif p_command in ('renew_consent','events','find_request') then
    if p_command='find_request' then
      select * into o from commerce.operations where owner=p_owner and request_key=(p_input->>'requestKey')::uuid;
      if not found then return null; end if;
      return commerce.operation_snapshot(o);
    end if;
    select * into o from commerce.operations where owner=p_owner and id=(p_input->>'operationId')::uuid;
    if not found then raise exception 'commerce:not-found'; end if;
    if p_command='events' then
      return coalesce((select jsonb_agg(to_jsonb(x) order by id desc) from (
        select * from commerce.operation_events where operation_id=o.id and (not(p_input?'before') or id<(p_input->>'before')::bigint) order by id desc limit 50
      ) x),'[]');
    end if;
    v_ends:=(p_input->>'endsAt')::timestamptz;
    if o.job_id is not null or o.cancelled_at is not null then raise exception 'commerce:operation-not-renewable'; end if;
    if o.effective_ends_at=v_ends and o.approval_id is not null then return commerce.operation_snapshot(o); end if;
    if o.effective_ends_at>clock_timestamp()+interval '240 seconds' then raise exception 'commerce:consent-still-valid'; end if;
    if v_ends is null or v_ends<clock_timestamp()+interval '10 minutes' or v_ends>clock_timestamp()+interval '24 hours' then raise exception 'commerce:invalid-input'; end if;
    a:=public.commerce_command(p_owner,'approve_budget',(o.input-'product'-'requestKey')||jsonb_build_object('requestKey',gen_random_uuid(),'endsAt',v_ends));
    update commerce.operations set effective_ends_at=v_ends,approval_id=(a->>'id')::uuid,approved_at=clock_timestamp() where id=o.id returning * into o;
    return commerce.operation_snapshot(o);
  end if;
  v:=public.commerce_operation_v1(p_owner,p_command,p_input);
  if p_command='fund' then
    insert into commerce.operation_recovery(operation_id) values((v->>'id')::uuid) on conflict do nothing;
  end if;
  return v;
end;
$$;
revoke all on function public.commerce_operation(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_operation(text,text,jsonb) to service_role;

create function public.commerce_operation_recovery(p_owner text,p_command text,p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r commerce.operation_recovery%rowtype; o commerce.operations%rowtype; v_state text; v_code text; v_delay integer; v_old text;
begin
  perform id from commerce.mutex where id=true for update;
  if p_command='health' then return jsonb_build_object('schema_version',2); end if;
  if p_command='metrics' then
    return jsonb_build_object('pending',(select count(*) from commerce.operation_recovery where state in ('pending','leased','waiting_for_approval')),
      'attention',(select count(*) from commerce.operation_recovery where state='needs_attention'),
      'oldest_due_at',(select min(next_at) from commerce.operation_recovery where state in ('pending','waiting_for_approval')),
      'last_checked_at',(select max(checked_at) from commerce.operation_recovery),
      'unknown_jobs',(select count(*) from commerce.operations op join commerce.jobs j on j.id=op.job_id where j.status='unknown'));
  elsif p_command='attention' then
    return coalesce((select jsonb_agg(to_jsonb(x) order by updated_at) from (select * from commerce.operation_recovery where state='needs_attention' order by updated_at limit 100) x),'[]');
  elsif p_command='inspect' then
    select * into o from commerce.operations where id=(p_input->>'operationId')::uuid;
    if not found then raise exception 'commerce:not-found'; end if;
    return commerce.operation_snapshot(o);
  elsif p_command='claim' then
    select x.* into r from commerce.operation_recovery x join commerce.operations op on op.id=x.operation_id
      where (p_owner is null or op.owner=p_owner) and (not(p_input?'operationId') or x.operation_id=(p_input->>'operationId')::uuid)
        and ((x.state='leased' and x.lease_until<=clock_timestamp()) or
          (x.state in ('pending','waiting_for_approval') and (x.next_at<=clock_timestamp() or (p_input?'operationId' and x.state='waiting_for_approval'))))
      order by x.next_at,x.operation_id limit 1;
    if not found then return null; end if;
    update commerce.operation_recovery set state='leased',lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '120 seconds',
      attempts=attempts+1,updated_at=clock_timestamp() where operation_id=r.operation_id returning * into r;
    select * into o from commerce.operations where id=r.operation_id;
    return to_jsonb(r)||jsonb_build_object('owner',o.owner,'topup_id',o.topup_id);
  end if;
  select * into o from commerce.operations where id=(p_input->>'operationId')::uuid and (p_owner is null or owner=p_owner);
  if not found then raise exception 'commerce:not-found'; end if;
  select * into r from commerce.operation_recovery where operation_id=o.id;
  if p_command='link_order' then
    if p_owner is not null or length(coalesce(p_input->>'note','')) not between 1 and 500 then raise exception 'commerce:operator-note-required'; end if;
    if o.topup_id is null then raise exception 'commerce:operation-not-payable'; end if;
    if r.state='leased' and r.lease_until>clock_timestamp() then raise exception 'commerce:operation-busy'; end if;
    -- Only the operator CLI calls this after verifying the canonical provider binding.
    perform public.commerce_command(o.owner,'attach_order',jsonb_build_object('intentId',o.topup_id,'providerOrderId',p_input->>'providerOrderId'));
    insert into commerce.operation_events(operation_id,kind,detail) values(o.id,'payment_link_recovered',jsonb_build_object('orderId',p_input->>'providerOrderId','note',p_input->>'note'));
    update commerce.operation_recovery set state='pending',next_at=clock_timestamp(),failures=0,updated_at=clock_timestamp() where operation_id=o.id;
    return commerce.operation_snapshot(o);
  end if;
  if p_command='status' then return case when r.operation_id is null then null else to_jsonb(r)-'lease_id' end; end if;
  if p_command='retry' then
    if p_owner is null and length(coalesce(p_input->>'note','')) not between 1 and 500 then raise exception 'commerce:operator-note-required'; end if;
    if r.operation_id is null then return null; end if;
    if r.state not in ('leased','succeeded') then
      update commerce.operation_recovery set state='pending',next_at=clock_timestamp(),failures=0,updated_at=clock_timestamp() where operation_id=o.id returning * into r;
      insert into commerce.operation_events(operation_id,kind,detail) values(o.id,'payment_check_requested',
        jsonb_build_object('actor',case when p_owner is null then 'operator' else 'owner' end,'note',p_input->>'note'));
    end if;
    return to_jsonb(r)-'lease_id';
  elsif p_command='finish' then
    if r.state<>'leased' or r.lease_id is distinct from (p_input->>'leaseId')::uuid or r.lease_until<=clock_timestamp() then return jsonb_build_object('stale',true); end if;
    v_state:=p_input->>'state';v_code:=p_input->>'code';v_delay:=coalesce((p_input->>'delaySeconds')::integer,60);v_old:=r.last_code;
    if v_state not in ('pending','waiting_for_approval','succeeded','needs_attention') or v_delay not between 1 and 3600
      or (v_code is not null and v_code !~ '^[a-z_-]{1,80}$') then raise exception 'commerce:invalid-input'; end if;
    update commerce.operation_recovery set state=v_state,lease_id=null,lease_until=null,checked_at=clock_timestamp(),updated_at=clock_timestamp(),
      next_at=clock_timestamp()+make_interval(secs=>v_delay),last_code=v_code,
      failures=case when v_state='pending' then failures+1 when v_state='waiting_for_approval' or v_state='succeeded' then 0 else failures end,
      approval_url=coalesce(p_input->>'approvalUrl',approval_url) where operation_id=o.id returning * into r;
    if v_state in ('succeeded','needs_attention') or v_code is distinct from v_old then
      insert into commerce.operation_events(operation_id,kind,detail) values(o.id,'payment_check_'||v_state,jsonb_build_object('code',v_code));
    end if;
    return to_jsonb(r)-'lease_id';
  end if;
  raise exception 'commerce:invalid-command';
end;
$$;
revoke all on function public.commerce_operation_recovery(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_operation_recovery(text,text,jsonb) to service_role;

-- Existing pending checkouts are recoverable after upgrade, without creating a new order or new task.
insert into commerce.operation_recovery(operation_id)
  select o.id from commerce.operations o join commerce.topups t on t.id=o.topup_id where t.status<>'credited' on conflict do nothing;
