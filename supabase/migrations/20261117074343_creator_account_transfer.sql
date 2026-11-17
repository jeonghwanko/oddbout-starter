-- Operator-only transfer of a creator-only secondary account. Auth identities are never edited with SQL.
-- Existing files, manifests, submission IDs and usage rows remain intact. Unknown holdings fail closed.
create schema if not exists af_private;
create table af_private.creator_account_transfers (
  id uuid primary key default gen_random_uuid(),
  source uuid not null unique references auth.users(id),
  target uuid not null references auth.users(id),
  snapshot jsonb not null,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  check (source <> target)
);
revoke all on af_private.creator_account_transfers from public, anon, authenticated, service_role;

create function af_private.creator_transfer_snapshot(p_source uuid,p_target uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item record; rows jsonb; snapshot jsonb := '{}'::jsonb;
begin
  if current_user <> 'postgres' then raise exception 'operator-only'; end if;
  if p_source is null or p_target is null or p_source=p_target then raise exception 'invalid-accounts'; end if;
  if (select count(*) from auth.users where id in (p_source,p_target)) <> 2 then raise exception 'account-not-found'; end if;
  -- Inspect every UUID reference, not just columns named owner_id. A new account-related table cannot be silently omitted.
  for item in select c.table_name,c.column_name from information_schema.columns c
    join information_schema.tables t using(table_catalog,table_schema,table_name)
    where c.table_schema='public' and c.data_type='uuid' and t.table_type='BASE TABLE'
    order by c.table_name,c.ordinal_position
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb) from public.%I r where %I=$1',item.table_name,item.column_name)
      into rows using p_source;
    if rows <> '[]'::jsonb and not (item.column_name='owner_id' and item.table_name=any(array[
      'af_creators','af_fighters','af_submissions','af_profile_sets','af_generation_jobs','af_account_agents']))
      then raise exception 'unsupported-holdings: %.%',item.table_name,item.column_name; end if;
  end loop;
  foreach item.table_name in array array['af_creators','af_fighters','af_submissions','af_profile_sets','af_generation_jobs','af_account_agents'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb) from public.%I r where owner_id in ($1,$2)',item.table_name)
      into rows using p_source,p_target;
    snapshot := snapshot || jsonb_build_object(item.table_name,rows);
  end loop;
  return jsonb_build_object('source',p_source,'target',p_target,'rows',snapshot,
    'objects',(select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket_id,'name',name,'metadata',metadata) order by bucket_id,name),'[]'::jsonb)
      from storage.objects where name like p_source::text||'/%'),
    'sourceTokens',public.af_generation_balance(p_source),'targetTokens',public.af_generation_balance(p_target),
    'limit',greatest(public.af_fighter_limit(p_source),public.af_fighter_limit(p_target)));
end $$;
revoke all on function af_private.creator_transfer_snapshot(uuid,uuid) from public,anon,authenticated,service_role;

-- Keep the original immutable contract, with one audited exception for ownership alone during this transaction.
create or replace function public.af_immutable_submission() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.owner_id is distinct from old.owner_id then
    if current_user <> 'postgres' then raise exception 'immutable-submission'; end if;
    if not exists(select 1 from af_private.creator_account_transfers m
      where m.source=old.owner_id and m.target=new.owner_id and not m.completed
      and m.snapshot->'rows'->'af_submissions' @> jsonb_build_array(to_jsonb(old)))
      or (to_jsonb(new)-'owner_id') is distinct from (to_jsonb(old)-'owner_id')
      then raise exception 'immutable-submission'; end if;
  elsif row(new.idempotency_key,new.manifest_text,new.manifest,new.manifest_sha,new.asset_bytes,new.replaces_fighter,new.asset_source_submission)
    is distinct from row(old.idempotency_key,old.manifest_text,old.manifest,old.manifest_sha,old.asset_bytes,old.replaces_fighter,old.asset_source_submission)
    then raise exception 'immutable-submission';
  end if;
  return new;
end $$;

create function af_private.apply_creator_transfer(p_expected jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare src uuid := (p_expected->>'source')::uuid; dst uuid := (p_expected->>'target')::uuid;
  actual jsonb; f record; slot integer; cap integer; transfer_id uuid; total bigint;
begin
  if current_user <> 'postgres' then raise exception 'operator-only'; end if;
  -- Prevent a write between the approved snapshot comparison and the final checks. No triggers or RLS are disabled.
  lock table public.af_creators,public.af_fighters,public.af_submissions,public.af_profile_sets,
    public.af_generation_jobs,public.af_generation_usage,public.af_account_agents in share row exclusive mode;
  if exists(select 1 from af_private.creator_account_transfers where source=src or source=dst or target=src)
    then raise exception 'account-already-transferred'; end if;
  actual := af_private.creator_transfer_snapshot(src,dst);
  if actual is distinct from p_expected then raise exception 'transfer-plan-stale'; end if;
  -- The operator copies and byte-verifies these objects first, without removing or overwriting originals.
  -- Readers construct paths from owner_id, so changing ownership without the new paths would lose access to assets.
  if exists(select 1 from jsonb_array_elements(actual->'objects') a where not exists(
    select 1 from storage.objects o where o.bucket_id=a->>'bucket'
      and o.name=dst::text||substr(a->>'name',37)
      and o.metadata->>'size' is not distinct from a->'metadata'->>'size'))
    then raise exception 'assets-not-copied'; end if;
  if (select count(*) from public.af_creators where owner_id in(src,dst) and enabled) <> 2
    then raise exception 'account-disabled'; end if;
  if exists(select 1 from public.af_generation_jobs where owner_id in(src,dst) and status not in('submitted','cancelled','rejected','failed'))
    then raise exception 'generation-active'; end if;
  if exists(select 1 from public.af_submissions where owner_id=src and status not in('registered','rejected','expired'))
    then raise exception 'submission-active'; end if;
  if exists(select 1 from public.af_profile_sets where owner_id=src and status not in('approved','rejected','expired'))
    then raise exception 'profile-active'; end if;
  if exists(select 1 from public.af_fighters where owner_id=src and (deleted_at is not null or promoted_to is not null))
    then raise exception 'archived-fighter-needs-review'; end if;
  cap := (actual->>'limit')::integer;
  if (select count(*) from public.af_fighters where owner_id in(src,dst) and deleted_at is null)>cap
    then raise exception 'fighter-quota'; end if;
  total := (actual->'sourceTokens'->>'granted')::bigint+(actual->'targetTokens'->>'granted')::bigint;
  insert into af_private.creator_account_transfers(source,target,snapshot) values(src,dst,actual) returning id into transfer_id;
  update public.af_creators set token_grant=total,fighter_limit=cap where owner_id=dst;
  -- Original submission bytes and IDs survive; only their account authorization changes.
  update public.af_submissions set owner_id=dst where owner_id=src;
  update public.af_profile_sets set owner_id=dst where owner_id=src;
  update public.af_generation_jobs set owner_id=dst where owner_id=src;
  for f in select id from public.af_fighters where owner_id=src order by id loop
    select n into slot from generate_series(1,cap) n where not exists(
      select 1 from public.af_fighters where owner_id=dst and account_slot=n) order by n limit 1;
    if slot is null then raise exception 'fighter-quota'; end if;
    update public.af_fighters set owner_id=dst,account_slot=slot where id=f.id and owner_id=src;
  end loop;
  insert into public.af_account_agents(owner_id,agent,created_at)
    select dst,agent,created_at from public.af_account_agents where owner_id=src on conflict(owner_id,agent) do nothing;
  -- Preserve the old login and agent audit; no user deletion, grant reset, or automatic new-user credit.
  update public.af_creators set token_grant=0,hosted_credits=0,enabled=false where owner_id=src;
  if (public.af_generation_balance(dst)->>'balance')::bigint <>
    (actual->'sourceTokens'->>'balance')::bigint+(actual->'targetTokens'->>'balance')::bigint
    then raise exception 'token-conservation-failed'; end if;
  update af_private.creator_account_transfers set completed=true where id=transfer_id;
  return jsonb_build_object('id',transfer_id,'target',dst,'tokens',public.af_generation_balance(dst),'fighterLimit',cap,
    'fighters',(select count(*) from public.af_fighters where owner_id=dst and deleted_at is null));
end $$;
revoke all on function af_private.apply_creator_transfer(jsonb) from public,anon,authenticated,service_role;
