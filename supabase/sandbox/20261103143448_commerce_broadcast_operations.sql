-- Isolated Sandbox only. Apply after paid_operation_recovery. Legacy one-cup consent is unchanged.
alter table commerce.operations add column kind text not null default 'one_cup' check(kind in ('one_cup','broadcast'));
alter table commerce.operations add column start_when_funded boolean not null default false;
alter table commerce.operations add column continuation_next_at timestamptz not null default clock_timestamp();
create index commerce_broadcast_continuation on commerce.operations(continuation_next_at,id)
  where kind='broadcast' and start_when_funded and cancelled_at is null;

create or replace function commerce.guard_paid_operation_job() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from commerce.operations where broadcast_id=new.broadcast_id and kind='one_cup') then
    raise exception 'commerce:single-task-session';
  end if;
  return new;
end;
$$;

alter function commerce.operation_snapshot(commerce.operations) rename to operation_snapshot_cup;
create function commerce.operation_snapshot(o commerce.operations) returns jsonb
language sql stable security invoker set search_path='' as $$
  select commerce.operation_snapshot_cup(o) || jsonb_build_object('kind',o.kind,'start_when_funded',o.start_when_funded)
    || case when o.kind='broadcast' and b.id is not null then jsonb_build_object(
      'broadcast',to_jsonb(b),
      'state',case
        when exists(select 1 from commerce.jobs where broadcast_id=b.id and status='unknown') then 'needs_reconciliation'
        when b.status='needs_attention' then 'needs_reconciliation'
        when b.status='completed' and o.cancelled_at is not null then 'cancelled'
        when b.status='completed' then 'completed'
        when o.cancelled_at is not null then 'cancelling'
        when w.spending_blocked then 'blocked'
        when b.status='stopping' then 'stopping'
        else b.status end) else '{}'::jsonb end
  from commerce.wallets w left join commerce.broadcasts b on b.id=o.broadcast_id where w.owner=o.owner;
$$;
revoke all on function commerce.operation_snapshot(commerce.operations),commerce.operation_snapshot_cup(commerce.operations) from public,anon,authenticated;
grant execute on function commerce.operation_snapshot(commerce.operations),commerce.operation_snapshot_cup(commerce.operations) to service_role;

alter function public.commerce_operation(text,text,jsonb) rename to commerce_operation_cup;
revoke all on function public.commerce_operation_cup(text,text,jsonb) from public,anon,authenticated;
create function public.commerce_operation(p_owner text,p_command text,p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o commerce.operations%rowtype; v jsonb; b jsonb; rows jsonb; v_limit integer;
begin
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'commerce:invalid-input'; end if;
  perform id from commerce.mutex where id=true for update;
  if p_command='continuations' then
    -- Service-role-only bounded durable scan. Revisit bound sessions after crashes before supervisor checkpointing.
    with due as (
      select x.id from commerce.operations x where kind='broadcast' and start_when_funded and cancelled_at is null
        and continuation_next_at<=clock_timestamp()
        and commerce.operation_snapshot(x)->>'state' in ('ready','queued','running')
      order by continuation_next_at,id limit 3
    ), advanced as (
      update commerce.operations x set continuation_next_at=clock_timestamp()+interval '10 seconds'
      from due where x.id=due.id returning x.*
    ) select coalesce(jsonb_agg(commerce.operation_snapshot(advanced)),'[]') into rows from advanced;
    return rows;
  end if;
  if p_owner is null or length(p_owner) not between 1 and 128 then raise exception 'commerce:owner-required'; end if;
  if p_command='page' and p_input?'kind' then
    perform public.commerce_command(p_owner,'wallet');
    v_limit:=coalesce((p_input->>'limit')::integer,20);
    if p_input->>'kind' not in ('broadcast','one_cup') or v_limit not between 1 and 50
      or length(coalesce(p_input->>'query',''))>64
      or coalesce(p_input->>'filter','all') not in ('all','active','attention','completed') then raise exception 'commerce:invalid-input'; end if;
    select coalesce(jsonb_agg(snap order by created_at desc,id desc),'[]') into rows from (
      select x.id,x.created_at,commerce.operation_snapshot(x) snap from commerce.operations x where owner=p_owner and kind=p_input->>'kind'
        and (not(p_input?'cursor') or (x.created_at,x.id)<((p_input->'cursor'->>'createdAt')::timestamptz,(p_input->'cursor'->>'id')::uuid))
        and strpos(lower(x.input->>'channelId'),lower(coalesce(p_input->>'query','')))>0
        and (coalesce(p_input->>'filter','all')='all'
          or (p_input->>'filter'='completed' and commerce.operation_snapshot(x)->>'state' in ('completed','failed','cancelled'))
          or (p_input->>'filter'='attention' and commerce.operation_snapshot(x)->>'state' in ('needs_reconciliation','payment_review','blocked','expired'))
          or (p_input->>'filter'='active' and commerce.operation_snapshot(x)->>'state' not in ('completed','failed','cancelled')))
      order by x.created_at desc,x.id desc limit v_limit+1
    ) page;
    return jsonb_build_object('items',case when jsonb_array_length(rows)>v_limit then rows-v_limit else rows end,
      'has_more',jsonb_array_length(rows)>v_limit,'next_cursor',case when jsonb_array_length(rows)>v_limit then
        jsonb_build_object('created_at',rows->(v_limit-1)->>'created_at','id',rows->(v_limit-1)->>'id') else null end);
  end if;
  if p_command='prepare_broadcast' then
    perform public.commerce_command(p_owner,'wallet');
    select * into o from commerce.operations where owner=p_owner and request_key=(p_input->>'requestKey')::uuid;
    if found then
      if o.kind<>'broadcast' or o.input<>p_input then raise exception 'commerce:idempotency-conflict'; end if;
    else
      if coalesce(p_input->>'maxCredits','') !~ '^[1-9][0-9]{0,6}$'
        or (p_input->>'maxCredits')::integer not between 25 and 1000000
        or p_input->'allowedTools' is distinct from '["host_cup"]'::jsonb
        or jsonb_typeof(p_input->'fighterIds') is distinct from 'array'
        or jsonb_array_length(p_input->'fighterIds') not between 4 and 9
        or (p_input->>'endsAt')::timestamptz<=clock_timestamp()+interval '240 seconds'
        or (p_input->>'endsAt')::timestamptz>clock_timestamp()+interval '24 hours' then raise exception 'commerce:invalid-input'; end if;
      insert into commerce.operations(owner,request_key,input,kind)
        values(p_owner,(p_input->>'requestKey')::uuid,p_input,'broadcast') returning * into o;
    end if;
    return commerce.operation_snapshot(o);
  end if;
  if p_input?'operationId' then
    select * into o from commerce.operations where owner=p_owner and id=(p_input->>'operationId')::uuid;
    if not found then raise exception 'commerce:not-found'; end if;
    if o.kind='broadcast' then
      if p_command='approve' then
        if p_input->'startWhenFunded' is distinct from 'true'::jsonb then raise exception 'commerce:automatic-start-consent-required'; end if;
        perform public.commerce_operation_cup(p_owner,p_command,p_input);
        update commerce.operations set start_when_funded=true,continuation_next_at=clock_timestamp() where id=o.id returning * into o;
        return commerce.operation_snapshot(o);
      elsif p_command='renew_consent' then
        if o.broadcast_id is not null then raise exception 'commerce:operation-not-renewable'; end if;
        if p_input->'startWhenFunded' is distinct from 'true'::jsonb then raise exception 'commerce:automatic-start-consent-required'; end if;
        perform public.commerce_operation_cup(p_owner,p_command,p_input);
        update commerce.operations set start_when_funded=true,continuation_next_at=clock_timestamp() where id=o.id returning * into o;
        return commerce.operation_snapshot(o);
      elsif p_command='resume' then
        v:=commerce.operation_snapshot(o);
        if o.broadcast_id is null and o.start_when_funded and v->>'state'='ready' then
          if p_input->>'priceVersion' is distinct from o.input->>'priceVersion' then raise exception 'commerce:price-version-conflict'; end if;
          b:=public.commerce_command(p_owner,'start_broadcast',jsonb_build_object('requestKey',o.id,'approvalId',o.approval_id));
          update commerce.operations set broadcast_id=(b->>'id')::uuid where id=o.id returning * into o;
        end if;
        return commerce.operation_snapshot(o);
      end if;
    end if;
  end if;
  return public.commerce_operation_cup(p_owner,p_command,p_input);
end;
$$;
revoke all on function public.commerce_operation(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_operation(text,text,jsonb) to service_role;

-- Existing task/payment audit remains intact; append broadcast-specific consent and binding evidence.
create function commerce.audit_broadcast_operation() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.kind='broadcast' then
    if (new.start_when_funded and not old.start_when_funded)
      or (new.start_when_funded and new.approval_id is distinct from old.approval_id) then
      insert into commerce.operation_events(operation_id,kind,detail) values(new.id,'automatic_start_authorized',
        jsonb_build_object('approvalId',new.approval_id,'endsAt',new.effective_ends_at,'startWhenFunded',true));
    end if;
    if new.broadcast_id is distinct from old.broadcast_id then
      insert into commerce.operation_events(operation_id,kind,detail) values(new.id,'broadcast_bound',
        jsonb_build_object('broadcastId',new.broadcast_id,'approvalId',new.approval_id,'endsAt',new.effective_ends_at));
    end if;
  end if;
  return new;
end;
$$;
create trigger commerce_broadcast_audit after update on commerce.operations for each row execute function commerce.audit_broadcast_operation();
revoke all on function commerce.audit_broadcast_operation() from public,anon,authenticated;
grant execute on function commerce.audit_broadcast_operation() to service_role;

alter function public.commerce_operation_recovery(text,text,jsonb) rename to commerce_operation_recovery_v2;
revoke all on function public.commerce_operation_recovery_v2(text,text,jsonb) from public,anon,authenticated;
create function public.commerce_operation_recovery(p_owner text,p_command text,p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  if p_command='health' then return jsonb_build_object('schema_version',3); end if;
  return public.commerce_operation_recovery_v2(p_owner,p_command,p_input);
end;
$$;
revoke all on function public.commerce_operation_recovery(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_operation_recovery(text,text,jsonb) to service_role;
