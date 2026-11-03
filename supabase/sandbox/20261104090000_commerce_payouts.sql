-- Sandbox only, like 20261102115107_commerce_broadcast_ledger.sql: apply after it, to the isolated project only.
-- Creator appearance fees: each completed cup pays every fighter in it a fixed fee, at most once,
-- through a PayPal Sandbox Payouts batch that the session owner approves.

create table commerce.payout_batches (
  id uuid primary key default gen_random_uuid(), owner text not null references commerce.wallets(owner),
  broadcast_id uuid not null references commerce.broadcasts(id),
  request_key text not null check (length(request_key) between 1 and 128),
  -- proposed -> submitting (approved; PayPal dispatch may be retried with the same ids) -> submitted -> paid | failed
  status text not null default 'proposed' check (status in ('proposed','submitting','submitted','paid','failed','cancelled')),
  total_cents integer not null check (total_cents > 0), currency text not null check (currency = 'USD'),
  -- PayPal sends counted by approvals. After the first, a refusal may follow a batch PayPal already made.
  dispatch_attempts integer not null default 0 check (dispatch_attempts >= 0),
  provider_batch_id text unique check (provider_batch_id ~ '^[A-Za-z0-9_-]{1,64}$'), provider_status text check (length(provider_status) <= 40),
  created_at timestamptz not null default clock_timestamp(), approved_at timestamptz, completed_at timestamptz,
  unique(owner, request_key)
);
-- One row per paid appearance. The key makes a cup's fee for a fighter payable once; a failed or
-- cancelled batch deletes its rows so they can be proposed again.
create table commerce.payout_items (
  batch_id uuid not null references commerce.payout_batches(id), job_id uuid not null references commerce.jobs(id),
  fighter_id text not null check (length(fighter_id) between 1 and 128), receiver text not null check (length(receiver) between 3 and 254),
  cents integer not null check (cents > 0), primary key (job_id, fighter_id)
);
create index payout_items_batch on commerce.payout_items(batch_id);
alter table commerce.payout_batches enable row level security;
alter table commerce.payout_items enable row level security;
revoke all on commerce.payout_batches, commerce.payout_items from public,anon,authenticated;
grant select,insert,update on commerce.payout_batches to service_role;
grant select,insert,delete on commerce.payout_items to service_role;

create function commerce.payout_view(p_batch uuid) returns jsonb language sql stable security invoker set search_path='' as $$
  select to_jsonb(p) || jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object('fighter_id',x.fighter_id,'receiver',x.receiver,'cents',x.cents,'cups',x.cups) order by x.fighter_id)
    from (select fighter_id, receiver, sum(cents)::integer as cents, count(*)::integer as cups from commerce.payout_items where batch_id=p.id group by fighter_id, receiver) x), '[]'::jsonb))
  from commerce.payout_batches p where p.id=p_batch
$$;
revoke all on function commerce.payout_view(uuid) from public,anon,authenticated;
grant execute on function commerce.payout_view(uuid) to service_role;

-- p_owner comes from the authenticated server; fees and receivers come from its configuration, never a model.
create function public.commerce_payout(p_owner text,p_command text,p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  b commerce.broadcasts%rowtype; p commerce.payout_batches%rowtype;
  v_key text := p_input->>'requestKey'; v_fee integer; v_receivers jsonb; v_count integer;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' then raise exception 'commerce:invalid-input'; end if;
  if p_owner is null or length(p_owner) not between 1 and 128 then raise exception 'commerce:owner-required'; end if;
  if p_command = 'propose' then
    if v_key is null or length(v_key) not between 1 and 128 then raise exception 'commerce:invalid-input'; end if;
    select * into p from commerce.payout_batches where owner=p_owner and request_key=v_key;
    if found and p.broadcast_id is distinct from (p_input->>'broadcastId')::uuid then raise exception 'commerce:idempotency-conflict'; end if;
    if found then return commerce.payout_view(p.id); end if;
    v_fee := (p_input->>'feeCents')::integer; v_receivers := p_input->'receivers';
    if v_fee is null or v_fee not between 1 and 10000 or jsonb_typeof(v_receivers) is distinct from 'object' then raise exception 'commerce:invalid-input'; end if;
    -- Proposals for one session run one at a time, so the two statements below see the same candidates.
    select * into b from commerce.broadcasts where id=(p_input->>'broadcastId')::uuid and owner=p_owner for update;
    if not found then raise exception 'commerce:not-found'; end if;
    select count(*) into v_count from commerce.jobs j cross join lateral jsonb_array_elements_text(j.fighter_ids) f(fighter)
      where j.broadcast_id=b.id and j.owner=p_owner and j.status='succeeded' and v_receivers ? f.fighter
        and not exists(select 1 from commerce.payout_items i where i.job_id=j.id and i.fighter_id=f.fighter);
    if v_count=0 then raise exception 'commerce:nothing-to-pay'; end if;
    insert into commerce.payout_batches(owner,broadcast_id,request_key,total_cents,currency)
      values(p_owner,b.id,v_key,v_count*v_fee,'USD') returning * into p;
    insert into commerce.payout_items(batch_id,job_id,fighter_id,receiver,cents)
      select p.id,j.id,f.fighter,v_receivers->>f.fighter,v_fee from commerce.jobs j cross join lateral jsonb_array_elements_text(j.fighter_ids) f(fighter)
      where j.broadcast_id=b.id and j.owner=p_owner and j.status='succeeded' and v_receivers ? f.fighter
        and not exists(select 1 from commerce.payout_items i where i.job_id=j.id and i.fighter_id=f.fighter);
    return commerce.payout_view(p.id);
  elsif p_command = 'list' then
    return coalesce((select jsonb_agg(commerce.payout_view(x.id) order by x.created_at desc) from commerce.payout_batches x
      where x.owner=p_owner and x.broadcast_id=(p_input->>'broadcastId')::uuid), '[]'::jsonb);
  end if;
  select * into p from commerce.payout_batches where id=(p_input->>'batchId')::uuid and owner=p_owner for update;
  if not found then raise exception 'commerce:not-found'; end if;
  if p_command = 'get' then return commerce.payout_view(p.id);
  elsif p_command = 'approve' then
    -- Repeating an approval is how an uncertain dispatch is retried; it never creates a second batch.
    if p.status='proposed' then update commerce.payout_batches set status='submitting',approved_at=clock_timestamp(),dispatch_attempts=1 where id=p.id;
    elsif p.status='submitting' then update commerce.payout_batches set dispatch_attempts=dispatch_attempts+1 where id=p.id;
    elsif p.status not in ('submitted','paid') then raise exception 'commerce:payout-not-approvable'; end if;
  elsif p_command = 'cancel' then
    if p.status<>'proposed' then raise exception 'commerce:payout-not-cancellable'; end if;
    delete from commerce.payout_items where batch_id=p.id;
    update commerce.payout_batches set status='cancelled',completed_at=clock_timestamp() where id=p.id;
  elsif p_command = 'attach' then
    if coalesce(p_input->>'providerBatchId','') !~ '^[A-Za-z0-9_-]{1,64}$' then raise exception 'commerce:invalid-input'; end if;
    if p.provider_batch_id is not null and p.provider_batch_id<>p_input->>'providerBatchId' then raise exception 'commerce:payout-conflict'; end if;
    if p.status='submitting' then update commerce.payout_batches set status='submitted',provider_batch_id=p_input->>'providerBatchId' where id=p.id;
    elsif p.status not in ('submitted','paid') then raise exception 'commerce:payout-conflict'; end if;
  elsif p_command = 'settle' then
    -- PayPal's batch status. REJECTED is the server's own record of a definite refusal of the first send,
    -- before any batch could exist; a refusal of a retry never frees appearances.
    if coalesce(p_input->>'providerStatus','') !~ '^[A-Z_]{1,40}$' then raise exception 'commerce:invalid-input'; end if;
    if p.status in ('paid','failed','cancelled') then return commerce.payout_view(p.id); end if;
    if p_input->>'providerStatus'='REJECTED' and (p.status<>'submitting' or p.dispatch_attempts<>1) then raise exception 'commerce:payout-conflict'; end if;
    if p_input->>'providerStatus'<>'REJECTED' and p.status<>'submitted' then raise exception 'commerce:payout-conflict'; end if;
    if p_input->>'providerStatus'='SUCCESS' then
      update commerce.payout_batches set status='paid',provider_status='SUCCESS',completed_at=clock_timestamp() where id=p.id;
    elsif p_input->>'providerStatus' in ('DENIED','CANCELED','REJECTED') then
      delete from commerce.payout_items where batch_id=p.id;
      update commerce.payout_batches set status='failed',provider_status=p_input->>'providerStatus',completed_at=clock_timestamp() where id=p.id;
    else update commerce.payout_batches set provider_status=p_input->>'providerStatus' where id=p.id; end if;
  else raise exception 'commerce:invalid-input'; end if;
  return commerce.payout_view(p.id);
exception
  when unique_violation then raise exception 'commerce:unique-conflict';
  when invalid_text_representation or numeric_value_out_of_range or check_violation then raise exception 'commerce:invalid-input';
end $$;
revoke all on function public.commerce_payout(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_payout(text,text,jsonb) to service_role;
