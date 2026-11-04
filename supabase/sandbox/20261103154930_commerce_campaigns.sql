-- Isolated Sandbox only. Apply after the existing commerce ledger. No production migration history.
-- Flat campaign purchases are independent of metered broadcast cups: no cup may debit this order again.
create table commerce.campaign_orders (
  id uuid primary key default gen_random_uuid(),owner text not null references commerce.wallets(owner),
  request_key uuid not null,product_id text not null default 'spotlight-hour',
  price_credits integer not null default 300,
  duration_seconds integer not null default 3600,
  fighter_ids text[] not null check(cardinality(fighter_ids)=4),
  status text not null default 'awaiting_media' check(status in ('awaiting_media','ready','started')),
  media_id uuid,created_at timestamptz not null default clock_timestamp(),started_at timestamptz,start_request_key uuid,
  watch_token text not null unique default replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),
  unique(owner,request_key),check((status='started')=(started_at is not null)),
  check(status='awaiting_media' or media_id is not null),
  check((product_id='spotlight-hour' and price_credits=300 and duration_seconds=3600)
    or(product_id='spotlight-2h' and price_credits=600 and duration_seconds=7200)
    or(product_id='spotlight-3h' and price_credits=900 and duration_seconds=10800))
);
create index commerce_campaigns_owner on commerce.campaign_orders(owner,created_at desc,id desc);
create table commerce.campaign_media (
  id uuid primary key default gen_random_uuid(),order_id uuid not null references commerce.campaign_orders(id),
  request_key uuid not null,input jsonb not null,created_at timestamptz not null default clock_timestamp(),
  unique(order_id,request_key),unique(order_id,id)
);
alter table commerce.campaign_orders add constraint campaign_media_belongs_to_order
  foreign key(id,media_id) references commerce.campaign_media(order_id,id);
create table commerce.campaign_events (
  id bigint generated always as identity primary key,order_id uuid not null references commerce.campaign_orders(id),
  kind text not null,detail jsonb not null default '{}',created_at timestamptz not null default clock_timestamp()
);
create trigger commerce_campaign_media_immutable before update or delete on commerce.campaign_media
  for each row execute function commerce.reject_ledger_mutation();
create trigger commerce_campaign_events_immutable before update or delete on commerce.campaign_events
  for each row execute function commerce.reject_ledger_mutation();
alter table commerce.campaign_orders enable row level security;
alter table commerce.campaign_media enable row level security;
alter table commerce.campaign_events enable row level security;
revoke all on commerce.campaign_orders,commerce.campaign_media,commerce.campaign_events from public,anon,authenticated;
grant select,insert,update on commerce.campaign_orders to service_role;
grant select,insert on commerce.campaign_media,commerce.campaign_events to service_role;
grant usage,select on sequence commerce.campaign_events_id_seq to service_role;

create function commerce.campaign_snapshot(o commerce.campaign_orders) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',o.id,'productId',o.product_id,'productName',case o.product_id
      when 'spotlight-2h' then 'Spotlight 2 Hours' when 'spotlight-3h' then 'Spotlight 3 Hours' else 'Spotlight Hour' end,
    'priceCredits',o.price_credits,'durationSeconds',o.duration_seconds,'fighterIds',to_jsonb(o.fighter_ids),
    'fighterTier','SS','fighterTierMeaning','campaign merchandising tier; not game rank',
    'status',o.status,'createdAt',o.created_at,'startedAt',o.started_at,
    'watchToken',case when o.started_at is null then null else o.watch_token end,
    'playbackStatus',case when o.started_at is null then 'not_started' else 'unverified' end,
    'adSeconds',o.duration_seconds/6,
    'adSlots',(select jsonb_agg(jsonb_build_object('startSeconds',s.start,'durationSeconds',300) order by s.start)
      from generate_series(0,o.duration_seconds/3600-1) h(hour)
      cross join lateral(values(h.hour*3600),(h.hour*3600+1800)) s(start)),
    'media',case when m.id is null then null else m.input-'requestKey' end)
  from commerce.campaign_orders x left join commerce.campaign_media m on m.id=o.media_id where x.id=o.id;
$$;
revoke all on function commerce.campaign_snapshot(commerce.campaign_orders) from public,anon,authenticated;
grant execute on function commerce.campaign_snapshot(commerce.campaign_orders) to service_role;

create function public.commerce_campaign(p_owner text,p_command text,p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o commerce.campaign_orders%rowtype;m commerce.campaign_media%rowtype;w commerce.wallets%rowtype;
  selected text[];v_limit integer;v_rows jsonb;v_price integer;v_duration integer;
begin
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'commerce:invalid-input'; end if;
  if p_command='health' then return jsonb_build_object('schemaVersion',1); end if;
  if p_command='manifest' then
    select * into o from commerce.campaign_orders where watch_token=p_input->>'watchToken' and started_at is not null;
    if not found then raise exception 'commerce:not-found'; end if;
    return commerce.campaign_snapshot(o);
  end if;
  if p_owner is null or length(p_owner) not between 1 and 128 then raise exception 'commerce:owner-required'; end if;
  -- Share the ledger mutex and lock order. Provider/storage/network calls never run in this transaction.
  perform id from commerce.mutex where id=true for update;
  perform public.commerce_command(p_owner,'wallet');
  if p_command='purchase' then
    if coalesce(p_input->>'productId','') not in ('spotlight-hour','spotlight-2h','spotlight-3h')
      or (p_input-'requestKey'-'productId')<>'{}'::jsonb then raise exception 'commerce:invalid-input'; end if;
    select * into o from commerce.campaign_orders where owner=p_owner and request_key=(p_input->>'requestKey')::uuid;
    if found then
      if o.product_id<>p_input->>'productId' then raise exception 'commerce:idempotency-conflict'; end if;
      return commerce.campaign_snapshot(o);
    end if;
    v_price:=case p_input->>'productId' when 'spotlight-2h' then 600 when 'spotlight-3h' then 900 else 300 end;
    v_duration:=case p_input->>'productId' when 'spotlight-2h' then 7200 when 'spotlight-3h' then 10800 else 3600 end;
    select * into w from commerce.wallets where owner=p_owner;
    if w.spending_blocked then raise exception 'commerce:wallet-frozen'; end if;
    if w.balance_credits-w.reserved_credits<v_price then raise exception 'commerce:insufficient-credits'; end if;
    select array_agg(id) into selected from (
      select id from unnest(array['kuma','yume','bravow','beotim','quickcat','kungjjak','sikeundung','duldul','eoridung']) id
      order by random() limit 4
    ) pool;
    insert into commerce.campaign_orders(owner,request_key,product_id,price_credits,duration_seconds,fighter_ids)
      values(p_owner,(p_input->>'requestKey')::uuid,p_input->>'productId',v_price,v_duration,selected) returning * into o;
    update commerce.wallets set balance_credits=balance_credits-v_price where owner=p_owner;
    insert into commerce.ledger(owner,kind,cause_id,balance_delta,reserved_delta)
      values(p_owner,'reserve',o.id,0,v_price),(p_owner,'spend',o.id,-v_price,-v_price);
    insert into commerce.campaign_events(order_id,kind,detail) values(o.id,'purchased',
      jsonb_build_object('priceCredits',v_price,'productId',o.product_id,'fighterIds',to_jsonb(selected)));
  elsif p_command='list' then
    v_limit:=coalesce((p_input->>'limit')::integer,20);
    if v_limit not between 1 and 50 then raise exception 'commerce:invalid-input'; end if;
    select coalesce(jsonb_agg(snapshot order by created_at desc,id desc),'[]') into v_rows from (
      select id,created_at,commerce.campaign_snapshot(c) snapshot from commerce.campaign_orders c where owner=p_owner
        and (not(p_input?'cursor') or (created_at,id)<((p_input->'cursor'->>'createdAt')::timestamptz,(p_input->'cursor'->>'id')::uuid))
      order by created_at desc,id desc limit v_limit+1
    ) page;
    return jsonb_build_object('items',case when jsonb_array_length(v_rows)>v_limit then v_rows-v_limit else v_rows end,
      'hasMore',jsonb_array_length(v_rows)>v_limit,'nextCursor',case when jsonb_array_length(v_rows)>v_limit
        then jsonb_build_object('createdAt',v_rows->(v_limit-1)->>'createdAt','id',v_rows->(v_limit-1)->>'id') else null end);
  else
    select * into o from commerce.campaign_orders where owner=p_owner and id=(p_input->>'orderId')::uuid;
    if not found then raise exception 'commerce:not-found'; end if;
    if p_command='get' then null;
    elsif p_command='find_media' then
      select * into m from commerce.campaign_media where order_id=o.id and request_key=(p_input->>'requestKey')::uuid;
      if not found then return null; end if;
      return jsonb_build_object('media',m.input-'requestKey','order',commerce.campaign_snapshot(o));
    elsif p_command='save_media' then
      select * into m from commerce.campaign_media where order_id=o.id and request_key=(p_input->>'requestKey')::uuid;
      if found then
        if m.input<>p_input-'orderId' then raise exception 'commerce:idempotency-conflict'; end if;
        return commerce.campaign_snapshot(o);
      end if;
      if o.started_at is not null then raise exception 'commerce:campaign-already-started'; end if;
      if coalesce(p_input->>'videoPath','') not like 'campaigns/'||o.id::text||'/%'
        or length(coalesce(p_input->>'aiIntro','')) not between 1 and 1000
        or coalesce(p_input->>'targetUrl','') not like 'https://%' then raise exception 'commerce:invalid-input'; end if;
      insert into commerce.campaign_media(order_id,request_key,input) values(o.id,(p_input->>'requestKey')::uuid,p_input-'orderId') returning * into m;
      update commerce.campaign_orders set media_id=m.id,status='ready' where id=o.id returning * into o;
      insert into commerce.campaign_events(order_id,kind,detail) values(o.id,'media_saved',jsonb_build_object('mediaId',m.id));
    elsif p_command='start' then
      if o.started_at is not null then return commerce.campaign_snapshot(o); end if;
      if o.status<>'ready' or o.media_id is null then raise exception 'commerce:campaign-media-required'; end if;
      select * into w from commerce.wallets where owner=p_owner;
      if w.spending_blocked then raise exception 'commerce:wallet-frozen'; end if;
      update commerce.campaign_orders set status='started',started_at=clock_timestamp(),start_request_key=(p_input->>'requestKey')::uuid
        where id=o.id returning * into o;
      insert into commerce.campaign_events(order_id,kind,detail) values(o.id,'started',jsonb_build_object('startedAt',o.started_at));
    else raise exception 'commerce:invalid-command'; end if;
  end if;
  return commerce.campaign_snapshot(o);
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    raise exception 'commerce:invalid-input';
end;
$$;
revoke all on function public.commerce_campaign(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_campaign(text,text,jsonb) to service_role;

-- The real Supabase project has Storage; portable PostgreSQL tests intentionally do not.
-- Private objects are available only through server-issued signed uploads/playback URLs.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    execute $bucket$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
      values('campaign-media','campaign-media',false,52428800,array['video/mp4'])
      on conflict(id) do update set public=false,file_size_limit=52428800,allowed_mime_types=array['video/mp4']$bucket$;
  end if;
end;
$$;
