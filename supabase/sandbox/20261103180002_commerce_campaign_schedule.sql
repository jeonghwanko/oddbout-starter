-- Isolated Sandbox only. Scheduling never starts a broadcast or charges a wallet.
alter table commerce.campaign_orders add column scheduled_at timestamptz,
  add column schedule_timezone text,add column schedule_revision integer not null default 0;
create index commerce_campaign_calendar on commerce.campaign_orders(owner,scheduled_at,id) where scheduled_at is not null;
create table commerce.campaign_schedules (
  order_id uuid not null references commerce.campaign_orders(id),request_key uuid not null,
  input jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(order_id,request_key)
);
alter table commerce.campaign_schedules enable row level security;
revoke all on commerce.campaign_schedules from public,anon,authenticated;
grant select,insert on commerce.campaign_schedules to service_role;
create trigger commerce_campaign_schedules_immutable before update or delete on commerce.campaign_schedules
  for each row execute function commerce.reject_ledger_mutation();

create or replace function commerce.campaign_snapshot(o commerce.campaign_orders) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',o.id,'productId',o.product_id,'productName',case o.product_id
      when 'spotlight-2h' then 'Spotlight 2 Hours' when 'spotlight-3h' then 'Spotlight 3 Hours' else 'Spotlight Hour' end,
    'priceCredits',o.price_credits,'durationSeconds',o.duration_seconds,'fighterIds',to_jsonb(o.fighter_ids),
    'fighterTier','SS','fighterTierMeaning','campaign merchandising tier; not game rank',
    'status',o.status,'createdAt',o.created_at,'startedAt',o.started_at,'mediaId',o.media_id,
    'scheduledAt',o.scheduled_at,'scheduleTimezone',o.schedule_timezone,'scheduleRevision',o.schedule_revision,
    'watchToken',case when o.started_at is null then null else o.watch_token end,
    'playbackStatus',case when o.started_at is null then 'not_started' else 'unverified' end,
    'adSeconds',o.duration_seconds/6,
    'adSlots',(select jsonb_agg(jsonb_build_object('startSeconds',s.start,'durationSeconds',300) order by s.start)
      from generate_series(0,o.duration_seconds/3600-1) h(hour)
      cross join lateral(values(h.hour*3600),(h.hour*3600+1800)) s(start)),
    'media',case when m.id is null then null else m.input-'requestKey' end)
  from commerce.campaign_orders x left join commerce.campaign_media m on m.id=o.media_id where x.id=o.id;
$$;

create function commerce.require_campaign_schedule() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if old.started_at is null and new.started_at is not null and new.scheduled_at is null then
    raise exception 'commerce:campaign-schedule-required';
  end if;
  return new;
end;
$$;
revoke all on function commerce.require_campaign_schedule() from public,anon,authenticated;
grant execute on function commerce.require_campaign_schedule() to service_role;
create trigger commerce_campaign_scheduled_start before update of started_at on commerce.campaign_orders
  for each row execute function commerce.require_campaign_schedule();

create function public.commerce_campaign_planning(p_owner text,p_command text,p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o commerce.campaign_orders%rowtype;s commerce.campaign_schedules%rowtype;
  v_at timestamptz;v_from timestamptz;v_to timestamptz;v_rows jsonb;v_key uuid;v_revision integer;
begin
  if p_owner is null or length(p_owner) not between 1 and 128 then raise exception 'commerce:owner-required'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'commerce:invalid-input'; end if;
  if p_command='calendar' then
    v_from:=(p_input->>'from')::timestamptz;v_to:=(p_input->>'to')::timestamptz;
    if v_from is null or v_to is null or not isfinite(v_from) or not isfinite(v_to)
      or v_to<=v_from or v_to-v_from>interval '42 days' then raise exception 'commerce:invalid-input'; end if;
    select coalesce(jsonb_agg(snapshot order by scheduled_at,id),'[]') into v_rows from (
      select c.id,c.scheduled_at,commerce.campaign_snapshot(c) snapshot from commerce.campaign_orders c
      where owner=p_owner and scheduled_at>=v_from and scheduled_at<v_to
        and (not(p_input?'cursor') or (scheduled_at,id)>((p_input->'cursor'->>'scheduledAt')::timestamptz,(p_input->'cursor'->>'id')::uuid))
      order by scheduled_at,id limit 101
    ) page;
    return jsonb_build_object('items',case when jsonb_array_length(v_rows)>100 then v_rows-100 else v_rows end,
      'nextCursor',case when jsonb_array_length(v_rows)>100 then jsonb_build_object('scheduledAt',v_rows->99->>'scheduledAt','id',v_rows->99->>'id') else null end);
  end if;
  perform id from commerce.mutex where id=true for update;
  select * into o from commerce.campaign_orders where owner=p_owner and id=(p_input->>'orderId')::uuid;
  if not found then raise exception 'commerce:not-found'; end if;
  v_key:=(p_input->>'requestKey')::uuid;v_revision:=(p_input->>'expectedRevision')::integer;
  if v_key is null or v_revision is null or v_revision<0 then raise exception 'commerce:invalid-input'; end if;
  if p_command='start' then
    if o.started_at is not null then return commerce.campaign_snapshot(o); end if;
    if o.scheduled_at is null then raise exception 'commerce:campaign-schedule-required'; end if;
    if o.schedule_revision<>v_revision then raise exception 'commerce:schedule-changed'; end if;
    if o.media_id is distinct from (p_input->>'expectedMediaId')::uuid then raise exception 'commerce:media-changed'; end if;
    -- The host deliberately starts now, even if the planned time has passed. Duration begins here.
    return public.commerce_campaign(p_owner,'start',jsonb_build_object('orderId',o.id,'requestKey',v_key));
  elsif p_command<>'schedule' then raise exception 'commerce:invalid-command'; end if;
  if (p_input-'orderId'-'requestKey'-'scheduledAt'-'timezone'-'expectedRevision')<>'{}'::jsonb then raise exception 'commerce:invalid-input'; end if;
  select * into s from commerce.campaign_schedules where order_id=o.id and request_key=v_key;
  if found then
    if s.input<>p_input then raise exception 'commerce:idempotency-conflict'; end if;
    return commerce.campaign_snapshot(o);
  end if;
  if o.started_at is not null then raise exception 'commerce:campaign-already-started'; end if;
  if o.status<>'ready' then raise exception 'commerce:campaign-media-required'; end if;
  if o.schedule_revision<>v_revision then raise exception 'commerce:schedule-changed'; end if;
  v_at:=(p_input->>'scheduledAt')::timestamptz;
  if v_at is null or not isfinite(v_at) or v_at<clock_timestamp() or v_at>clock_timestamp()+interval '366 days'
    or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_input->>'timezone') then raise exception 'commerce:invalid-schedule'; end if;
  insert into commerce.campaign_schedules(order_id,request_key,input) values(o.id,v_key,p_input);
  update commerce.campaign_orders set scheduled_at=v_at,schedule_timezone=p_input->>'timezone',schedule_revision=schedule_revision+1
    where id=o.id returning * into o;
  insert into commerce.campaign_events(order_id,kind,detail) values(o.id,'scheduled',jsonb_build_object('scheduledAt',v_at,'revision',o.schedule_revision));
  return commerce.campaign_snapshot(o);
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
  raise exception 'commerce:invalid-input';
end;
$$;
revoke all on function public.commerce_campaign_planning(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_campaign_planning(text,text,jsonb) to service_role;
