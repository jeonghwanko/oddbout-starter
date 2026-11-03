-- 운영자 세트는 주인의 하루 한도에 세지 않는다 (2026-11-03): eight expression sheets an operator added for one owner's fighters
-- (af_admin_profile_set_expressions, 22:01 UTC the day before) filled that owner's ten sets a day, and the operator's front for his hosted
-- fighter 레온 — whose own set the host's face square had sent back (starter #321) — was refused with profile-set-quota. The limit is the
-- owner's own uploads: a set an operator made (its `admin-expressions` or `admin-front` event, written in the same transaction as the set)
-- is not counted.

-- As 20261031100000, and the day's count leaves out the operator's sets.
create or replace function public.af_profile_set_create(p_owner uuid, p_fighter uuid, p_key uuid, p_text text, p_sha text, p_bytes bigint)
returns public.af_profile_sets language plpgsql security invoker set search_path = '' as $$
declare p public.af_profile_sets; f public.af_fighters; paused boolean;
begin
  perform 1 from public.af_creators where owner_id = p_owner for update;
  select * into p from public.af_profile_sets where owner_id = p_owner and idempotency_key = p_key;
  if found then
    if p.manifest_sha <> p_sha or p.fighter_id <> p_fighter then raise exception 'idempotency-conflict'; end if;
    return p;
  end if;
  select s.paused into paused from public.af_settings s where s.singleton;
  if paused then raise exception 'submissions-paused'; end if;
  select * into f from public.af_fighters where id = p_fighter and owner_id = p_owner;
  if not found or f.deleted_at is not null or f.status <> 'registered' or f.review_state = 'rejected' then raise exception 'fighter-not-found'; end if;
  if p_bytes is null or p_bytes < 1 or p_bytes > 4000000 then raise exception 'byte-budget-mismatch'; end if;
  if exists(select 1 from public.af_profile_sets where fighter_id = p_fighter
      and (status in ('queued', 'validating') or (status = 'uploading' and expires_at > now()))) then
    raise exception 'open-profile-set-exists';
  end if;
  if (select count(*) from public.af_profile_sets s where s.owner_id = p_owner and s.created_at > now() - interval '24 hours'
      and not exists(select 1 from public.af_profile_set_events e where e.profile_set_id = s.id and e.kind in ('admin-expressions', 'admin-front'))) >= 10 then
    raise exception 'profile-set-quota';
  end if;
  insert into public.af_profile_sets(fighter_id, owner_id, idempotency_key, manifest_text, manifest_sha, manifest)
    values (p_fighter, p_owner, p_key, p_text, p_sha, p_text::jsonb) returning * into p;
  return p;
end $$;
