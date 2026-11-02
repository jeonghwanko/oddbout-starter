-- 저장 용량 정리 (2026-11-02 사용자: "유저에게 물어보고 제일 오래된 것을 제거하던가" → 운영자 확인 후 정리). af_create_submission counted
-- every package folder ever uploaded against af_settings.max_reserved_bytes, rejected and replaced ones included, so files nothing reads
-- filled the service-wide budget and refused every creator's new submission (140번째 배포: 199.9 MB full, 26 old submissions 156.6 MB of
-- it; the limit went to 400 MB, the column's maximum). Now the operator lists the package folders nothing uses, oldest first, and removes
-- the ones he confirms: the API deletes their files, then af_asset_removals records each one and the budget stops counting it.
--
-- A folder (owner/submission, api/submissions.mjs objectKey) is in use, and never listed, while its submission is open (uploading and not
-- an hour past its expiry, queued, validating), is any fighter's current package (an owner-deleted fighter keeps his: deletion promised to
-- keep the private package; a removed fighter can be restored), or is the asset source of a profile or style edit that is current or open.
-- Nothing reads any other folder: duels read the current submission's manifest text from this table, and the roster, the validator and the
-- profile sets sign only the current or an open folder. An unused folder stays unused (no finished submission becomes open or current
-- again, and an edit's source is always the current package's folder), so the files can go before the record without a lock between them;
-- the hour after expiry covers an upload that started just before it.

create table public.af_asset_removals (
  submission_id uuid primary key references public.af_submissions(id),
  actor uuid not null references auth.users(id),
  asset_bytes bigint not null check (asset_bytes >= 0),
  reason text not null check (reason in ('replaced','rejected','upload-expired')),
  removed_at timestamptz not null default now()
);
alter table public.af_asset_removals enable row level security;
revoke all on public.af_asset_removals from public,anon,authenticated;
grant select,insert on public.af_asset_removals to service_role;
create policy af_asset_removals_service on public.af_asset_removals for all to service_role using(true) with check(true);

-- The bytes the budget holds: every folder a submission uploaded (an edit that reuses another's has none of its own), less the removed.
create function public.af_kept_package_bytes() returns bigint
language sql stable security invoker set search_path = '' as $$
  select coalesce(sum(s.asset_bytes),0)::bigint from public.af_submissions s
  where s.asset_source_submission is null and not exists(select 1 from public.af_asset_removals r where r.submission_id=s.id)
$$;

-- The folders nothing uses, oldest first, with the file keys api/submissions.mjs objectKey gave them.
create function public.af_unused_package_folders()
returns table(submission_id uuid, owner_id uuid, reason text, created_at timestamptz, asset_bytes bigint, keys text[])
language sql stable security invoker set search_path = '' as $$
  select s.id, s.owner_id,
    case when s.status='registered' then 'replaced'
         when s.status='uploading' or s.validation->>'code'='upload-expired' then 'upload-expired' else 'rejected' end,
    s.created_at, s.asset_bytes,
    array(select s.owner_id::text||'/'||s.id::text||'/'||(a->>'id')||'.webp' from jsonb_array_elements(s.manifest->'assets') a)
  from public.af_submissions s
  where s.asset_source_submission is null
    and (s.status in ('registered','rejected') or (s.status='uploading' and s.expires_at <= now() - interval '1 hour'))
    and not exists(select 1 from public.af_asset_removals r where r.submission_id=s.id)
    and not exists(select 1 from public.af_fighters f where f.submission_id=s.id)
    and not exists(select 1 from public.af_submissions t where t.asset_source_submission=s.id
      and (t.status in ('uploading','queued','validating') or exists(select 1 from public.af_fighters f where f.submission_id=t.id)))
  order by s.created_at, s.id
$$;

-- The operator's view: what the budget holds against its limit, and the 200 oldest unused folders with whose they are.
create function public.af_admin_storage(p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  return (with unused as (select * from public.af_unused_package_folders())
    select jsonb_build_object('usedBytes', public.af_kept_package_bytes(),
      'limitBytes', (select max_reserved_bytes from public.af_settings where singleton),
      'unusedCount', (select count(*) from unused), 'unusedBytes', (select coalesce(sum(asset_bytes),0) from unused),
      'unused', coalesce((select jsonb_agg(jsonb_build_object('submissionId', u.submission_id, 'ownerId', u.owner_id, 'email', usr.email,
          'fighterId', s.fighter_id, 'name', s.manifest->'profile'->>'name', 'reason', u.reason, 'createdAt', u.created_at,
          'bytes', u.asset_bytes, 'files', cardinality(u.keys)) order by u.created_at, u.submission_id)
        from (select * from unused order by created_at, submission_id limit 200) u
        join public.af_submissions s on s.id=u.submission_id
        left join auth.users usr on usr.id=u.owner_id), '[]'::jsonb)));
end $$;

-- Of the folders the operator named, those still unused, with their file keys: the API deletes these files next.
create function public.af_admin_storage_folders(p_actor uuid, p_ids uuid[]) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  if p_ids is null or cardinality(p_ids) not between 1 and 50 or array_position(p_ids, null) is not null then raise exception 'invalid-review'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('submissionId', u.submission_id, 'bytes', u.asset_bytes, 'keys', to_jsonb(u.keys))
      order by u.created_at, u.submission_id)
    from public.af_unused_package_folders() u where u.submission_id = any(p_ids)), '[]'::jsonb);
end $$;

-- After their files are gone: each named folder that is still unused is recorded once, and the budget stops counting it. A retry records
-- nothing twice.
create function public.af_admin_storage_removed(p_actor uuid, p_ids uuid[]) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare removed integer; freed bigint;
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  if p_ids is null or cardinality(p_ids) not between 1 and 50 or array_position(p_ids, null) is not null then raise exception 'invalid-review'; end if;
  with added as (
    insert into public.af_asset_removals(submission_id, actor, asset_bytes, reason)
      select u.submission_id, p_actor, u.asset_bytes, u.reason from public.af_unused_package_folders() u where u.submission_id = any(p_ids)
      on conflict (submission_id) do nothing returning asset_bytes)
  select count(*), coalesce(sum(asset_bytes),0) into removed, freed from added;
  return jsonb_build_object('removed', removed, 'freedBytes', freed, 'usedBytes', public.af_kept_package_bytes(),
    'limitBytes', (select max_reserved_bytes from public.af_settings where singleton));
end $$;

revoke all on function public.af_kept_package_bytes(), public.af_unused_package_folders(), public.af_admin_storage(uuid),
  public.af_admin_storage_folders(uuid,uuid[]), public.af_admin_storage_removed(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.af_kept_package_bytes(), public.af_unused_package_folders(), public.af_admin_storage(uuid),
  public.af_admin_storage_folders(uuid,uuid[]), public.af_admin_storage_removed(uuid,uuid[]) to service_role;

-- af_create_submission restated whole from 20261029035001 with only the budget check changed: removed folders no longer count.
create or replace function public.af_create_submission(p_owner uuid,p_key uuid,p_text text,p_sha text,p_bytes bigint,p_fighter uuid default null)
returns public.af_submissions language plpgsql security invoker set search_path = '' as $$
declare s public.af_submissions; settings public.af_settings; declared numeric; f public.af_fighters;
begin
  perform public.af_authorize(p_owner);
  select * into settings from public.af_settings where singleton for update;
  select * into s from public.af_submissions where owner_id=p_owner and idempotency_key=p_key;
  if found then
    if s.manifest_sha<>p_sha or s.manifest_text<>p_text or s.replaces_fighter is distinct from p_fighter then raise exception 'idempotency-conflict'; end if;
    return s;
  end if;
  if settings.paused then raise exception 'submissions-paused'; end if;
  if p_fighter is null then
    if (select count(*) from public.af_fighters where owner_id=p_owner and deleted_at is null) >= public.af_fighter_limit(p_owner) then raise exception 'fighter-quota'; end if;
  else
    select * into f from public.af_fighters where id=p_fighter and owner_id=p_owner;
    if not found then raise exception 'fighter-not-found'; end if;
    if f.review_state='rejected' then raise exception 'fighter-removed'; end if;
    if f.manifest_sha=p_sha then raise exception 'fighter-unchanged'; end if;
  end if;
  update public.af_submissions set status='rejected',validation='{"code":"upload-expired"}'::jsonb
    where owner_id=p_owner and status='uploading' and expires_at<=now();
  if exists(select 1 from public.af_submissions where owner_id=p_owner and status in ('uploading','queued','validating')) then raise exception 'open-submission-exists'; end if;
  -- New-fighter submissions are bounded per day, not for the account's life: rejected and deleted attempts used to count forever,
  -- so five of them locked an account out of new fighters even below its fighter limit (2026-10-29).
  if p_fighter is null and (select count(*) from public.af_submissions where owner_id=p_owner and replaces_fighter is null
      and created_at > now() - interval '1 day') >= 5 then raise exception 'submission-quota'; end if;
  select sum((a->>'bytes')::numeric) into declared from jsonb_array_elements(p_text::jsonb->'assets') a;
  if declared is null or declared<>p_bytes then raise exception 'byte-budget-mismatch'; end if;
  -- Every folder counts, expired and rejected ones too, until the operator removes its files (af_admin_storage_removed, 2026-11-02).
  if public.af_kept_package_bytes()+p_bytes > settings.max_reserved_bytes then raise exception 'storage-budget-full'; end if;
  insert into public.af_submissions(owner_id,idempotency_key,manifest_text,manifest,manifest_sha,asset_bytes,replaces_fighter)
    values(p_owner,p_key,p_text,p_text::jsonb,p_sha,p_bytes,p_fighter) returning * into s;
  return s;
end $$;
