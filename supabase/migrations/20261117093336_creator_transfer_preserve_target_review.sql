-- Preserve an idle target review request without cancelling or transferring it.
-- Source review jobs and any leased/running target jobs still block transfer.
create or replace function af_private.apply_creator_transfer(p_expected jsonb) returns jsonb
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
  if exists(select 1 from public.af_generation_jobs where owner_id in(src,dst) and status not in('submitted','cancelled','rejected','failed')
    and not (owner_id=dst and status='needs_review' and lease_token is null and lease_expires_at is null))
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
