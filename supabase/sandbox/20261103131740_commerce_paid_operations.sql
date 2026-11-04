-- Isolated Sandbox only. Apply AFTER the ledger and payouts SQL files.
-- Durable task/consent/funding linkage; the existing ledger remains the accounting authority.
create table commerce.operations (
  id uuid primary key default gen_random_uuid(), owner text not null references commerce.wallets(owner),
  request_key uuid not null, input jsonb not null, created_at timestamptz not null default clock_timestamp(),
  approval_id uuid unique references commerce.approvals(id), approved_at timestamptz,
  topup_id uuid unique references commerce.topups(id), broadcast_id uuid unique references commerce.broadcasts(id),
  job_id uuid unique references commerce.jobs(id), cancelled_at timestamptz,
  unique(owner,request_key)
);
create index commerce_operations_owner on commerce.operations(owner,created_at desc,id);
alter table commerce.operations enable row level security;
revoke all on commerce.operations from public,anon,authenticated;
grant select,insert,update on commerce.operations to service_role;

-- An operation session can never accept a replacement cup, even through a legacy producer/API route.
create function commerce.guard_paid_operation_job() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from commerce.operations where broadcast_id=new.broadcast_id) then
    raise exception 'commerce:single-task-session';
  end if;
  return new;
end;
$$;
create trigger commerce_single_paid_job before insert on commerce.jobs for each row execute function commerce.guard_paid_operation_job();
revoke all on function commerce.guard_paid_operation_job() from public,anon,authenticated;
grant execute on function commerce.guard_paid_operation_job() to service_role;

-- Complete a one-cup session even if no phone or PC is polling. A release/expiry has no completion_input:
-- its original accounting command already handles releases, so do not nest it from those updates.
create function commerce.finish_paid_operation_job() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.status in ('succeeded','failed') and new.completion_input is not null
    and exists(select 1 from commerce.operations where job_id=new.id) then
    perform public.commerce_command(new.owner,'stop_broadcast',jsonb_build_object('broadcastId',new.broadcast_id));
  end if;
  return new;
end;
$$;
create trigger commerce_finish_paid_job after update of status on commerce.jobs for each row execute function commerce.finish_paid_operation_job();
revoke all on function commerce.finish_paid_operation_job() from public,anon,authenticated;
grant execute on function commerce.finish_paid_operation_job() to service_role;

create function commerce.operation_snapshot(o commerce.operations) returns jsonb
language sql stable security invoker set search_path='' as $$
  select to_jsonb(o) || jsonb_build_object(
    'state', case
      when j.status='succeeded' then 'completed'
      when j.status='unknown' then 'needs_reconciliation'
      when j.status='failed' then 'failed'
      when o.cancelled_at is not null then 'cancelled'
      when w.spending_blocked then 'blocked'
      when j.status='running' then 'running'
      when j.status='queued' then 'queued'
      when (o.input->>'endsAt')::timestamptz<=clock_timestamp()+interval '240 seconds' then 'expired'
      when o.approval_id is null then 'awaiting_approval'
      when t.id is not null and t.status<>'credited' then 'awaiting_payment'
      when w.balance_credits-w.reserved_credits < (o.input->>'maxCredits')::integer then 'awaiting_payment'
      else 'ready' end,
    'payment', case when t.id is null then null else jsonb_build_object('intent_id',t.id,'status',t.status,
      'provider_order_id',t.provider_order_id,'capture_id',t.capture_id,'amount_cents',t.amount_cents,'credits',t.credits,'currency',t.currency) end,
    'job', case when j.id is null then null else to_jsonb(j) - 'completion_input' - 'lease_token' - 'worker_id' end,
    'available_credits',w.balance_credits-w.reserved_credits,
    'spending_blocked',w.spending_blocked)
  from commerce.wallets w left join commerce.topups t on t.id=o.topup_id
    left join commerce.jobs j on j.id=o.job_id where w.owner=o.owner;
$$;
revoke all on function commerce.operation_snapshot(commerce.operations) from public,anon,authenticated;
grant execute on function commerce.operation_snapshot(commerce.operations) to service_role;

create function public.commerce_operation(p_owner text,p_command text,p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  o commerce.operations%rowtype; v jsonb; b jsonb; j jsonb; v_input jsonb;
begin
  if p_owner is null or length(p_owner) not between 1 and 128 then raise exception 'commerce:owner-required'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'commerce:invalid-input'; end if;
  -- Same mutex/order as the original ledger; nested commands are in this one transaction.
  perform id from commerce.mutex where id=true for update;
  perform public.commerce_command(p_owner,'wallet');
  if p_command='prepare' then
    select * into o from commerce.operations where owner=p_owner and request_key=(p_input->>'requestKey')::uuid;
    if found then
      if o.input<>p_input then raise exception 'commerce:idempotency-conflict'; end if;
    else
      if p_input->'maxCredits' is distinct from '25'::jsonb or p_input->'allowedTools' is distinct from '["host_cup"]'::jsonb
        or jsonb_typeof(p_input->'fighterIds') is distinct from 'array' or jsonb_array_length(p_input->'fighterIds')<>4
        or (p_input->>'endsAt')::timestamptz<=clock_timestamp()+interval '240 seconds'
        or (p_input->>'endsAt')::timestamptz>clock_timestamp()+interval '24 hours' then raise exception 'commerce:invalid-input'; end if;
      insert into commerce.operations(owner,request_key,input) values(p_owner,(p_input->>'requestKey')::uuid,p_input) returning * into o;
    end if;
  elsif p_command='list' then
    return coalesce((select jsonb_agg(commerce.operation_snapshot(x) order by x.created_at desc,x.id)
      from (select * from commerce.operations where owner=p_owner order by created_at desc,id limit 50) x),'[]'::jsonb);
  else
    select * into o from commerce.operations where owner=p_owner and id=(p_input->>'operationId')::uuid;
    if not found then raise exception 'commerce:not-found'; end if;
    -- A lost completion reply is recovered from the stored job, including closing its one-cup session.
    if o.job_id is not null and exists(select 1 from commerce.jobs where id=o.job_id and status in ('succeeded','failed')) then
      perform public.commerce_command(p_owner,'stop_broadcast',jsonb_build_object('broadcastId',o.broadcast_id));
    end if;
    v:=commerce.operation_snapshot(o);
    if p_command='get' then null;
    elsif p_command='cancel' then
      if o.broadcast_id is not null then
        perform public.commerce_command(p_owner,'stop_broadcast',jsonb_build_object('broadcastId',o.broadcast_id));
      end if;
      update commerce.operations set cancelled_at=coalesce(cancelled_at,clock_timestamp()) where id=o.id returning * into o;
    elsif p_command='approve' then
      if o.cancelled_at is not null then raise exception 'commerce:operation-cancelled'; end if;
      if v->>'state'='expired' then raise exception 'commerce:approval-expired'; end if;
      if o.approval_id is null then
        v_input:=(o.input - 'product' - 'requestKey') || jsonb_build_object('requestKey',o.id);
        v:=public.commerce_command(p_owner,'approve_budget',v_input);
        update commerce.operations set approval_id=(v->>'id')::uuid,approved_at=clock_timestamp() where id=o.id returning * into o;
      end if;
    elsif p_command='fund' then
      if o.topup_id is null then
        if v->>'state'<>'awaiting_payment' or o.approval_id is null then raise exception 'commerce:operation-not-payable'; end if;
        v:=public.commerce_command(p_owner,'create_topup',jsonb_build_object('requestKey',o.id,
          'amountCents',o.input->'product'->'amountCents','credits',o.input->'product'->'credits','currency','USD'));
        update commerce.operations set topup_id=(v->>'id')::uuid where id=o.id returning * into o;
      end if;
    elsif p_command='resume' then
      -- Unknown/terminal work is returned unchanged. No new job/key can replace it.
      if o.job_id is null and v->>'state'='ready' then
        if p_input->>'priceVersion' is distinct from o.input->>'priceVersion' then raise exception 'commerce:price-version-conflict'; end if;
        b:=public.commerce_command(p_owner,'start_broadcast',jsonb_build_object('requestKey',o.id,'approvalId',o.approval_id));
        j:=public.commerce_command(p_owner,'enqueue_cup',jsonb_build_object('requestKey',o.id,'broadcastId',b->>'id',
          'fighterIds',o.input->'fighterIds','priceCredits',o.input->'maxCredits','priceVersion',o.input->>'priceVersion'));
        update commerce.operations set broadcast_id=(b->>'id')::uuid,job_id=(j->>'id')::uuid where id=o.id returning * into o;
      end if;
    else raise exception 'commerce:invalid-command'; end if;
  end if;
  return commerce.operation_snapshot(o);
end;
$$;
revoke all on function public.commerce_operation(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_operation(text,text,jsonb) to service_role;

-- A local MCP client holds its device secret in memory. The model sees only the public pairing link/code.
create table commerce.operation_devices (
  id uuid primary key, secret_hash text not null unique check(secret_hash ~ '^[a-f0-9]{64}$'),
  user_code text not null check(user_code ~ '^[A-F0-9]{8}$'), label text not null check(length(label) between 1 and 64),
  owner text, created_at timestamptz not null default clock_timestamp(), approved_at timestamptz, revoked_at timestamptz,
  approve_by timestamptz not null default clock_timestamp()+interval '10 minutes',
  expires_at timestamptz not null default clock_timestamp()+interval '24 hours'
);
create index commerce_operation_devices_owner on commerce.operation_devices(owner,created_at desc);
alter table commerce.operation_devices enable row level security;
revoke all on commerce.operation_devices from public,anon,authenticated;
grant select,insert,update on commerce.operation_devices to service_role;
create function public.commerce_operation_device(p_owner text,p_command text,p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d commerce.operation_devices%rowtype;
begin
  if p_command='begin' then
    -- The server generates all these values. The cap bounds unauthenticated pending requests across replicas.
    perform id from commerce.mutex where id=true for update;
    if (select count(*) from commerce.operation_devices where owner is null and approve_by>clock_timestamp())>=100 then
      raise exception 'commerce:too-many-connections'; end if;
    insert into commerce.operation_devices(id,secret_hash,user_code,label)
      values((p_input->>'id')::uuid,p_input->>'secretHash',p_input->>'userCode',p_input->>'label') returning * into d;
  elsif p_command='authenticate' then
    select * into d from commerce.operation_devices where secret_hash=p_input->>'secretHash';
    if not found or d.revoked_at is not null or d.expires_at<=clock_timestamp()
      or (d.owner is null and d.approve_by<=clock_timestamp()) then raise exception 'commerce:device-expired'; end if;
    return jsonb_build_object('id',d.id,'owner',d.owner,'expires_at',d.expires_at,'state',case when d.owner is null then 'pending' else 'connected' end);
  else
    if p_owner is null then raise exception 'commerce:owner-required'; end if;
    if p_command='list' then
      return coalesce((select jsonb_agg(to_jsonb(x)-'secret_hash'-'user_code' order by x.created_at desc)
        from (select * from commerce.operation_devices where owner=p_owner and revoked_at is null and expires_at>clock_timestamp() order by created_at desc limit 50) x),'[]'::jsonb);
    end if;
    select * into d from commerce.operation_devices where id=(p_input->>'id')::uuid for update;
    if not found then raise exception 'commerce:not-found'; end if;
    if p_command='approve' then
      if d.user_code is distinct from p_input->>'userCode' or (d.owner is not null and d.owner<>p_owner) then raise exception 'commerce:not-found'; end if;
      if d.revoked_at is not null or d.approve_by<=clock_timestamp() then raise exception 'commerce:device-expired'; end if;
      update commerce.operation_devices set owner=p_owner,approved_at=coalesce(approved_at,clock_timestamp()) where id=d.id returning * into d;
    elsif p_command='revoke' then
      if d.owner is distinct from p_owner then raise exception 'commerce:not-found'; end if;
      update commerce.operation_devices set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=d.id returning * into d;
    else raise exception 'commerce:invalid-command'; end if;
  end if;
  return to_jsonb(d)-'secret_hash';
end;
$$;
revoke all on function public.commerce_operation_device(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_operation_device(text,text,jsonb) to service_role;
