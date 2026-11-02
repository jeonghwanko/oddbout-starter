-- 운영자의 정면 (2026-11-03 — 사용자: "운영자가 올릴 수 있게 해줘"): a whole profile set (front painting, face square and an optional expression
-- sheet) for a registered fighter who has no approved set, without his owner's sign-in (api/admin-profile-front.mjs). The set is his owner's,
-- made by his owner's af_profile_set_create; the operator's id and reason are kept in af_profile_set_events (`admin-front`) only, as
-- 20261103100000 keeps an operator's sheet.
alter table public.af_profile_set_events drop constraint af_profile_set_events_kind_check,
  add constraint af_profile_set_events_kind_check
    check (kind in ('approve', 'reject', 'withdraw', 'public-cleanup-failed', 'admin-expressions', 'admin-front'));
-- The approval below asks whether a set is an operator's front.
create index af_profile_set_events_admin_front on public.af_profile_set_events(profile_set_id) where kind = 'admin-front';

-- The operator's front: the set and its event in one transaction. Only for a fighter with no current set: a fighter with one gets a sheet
-- through af_admin_profile_set_expressions, and his owner's own front is never replaced by an operator. The same key answers the same set,
-- at any status, only for the same fighter and set file.
create function public.af_admin_profile_set_front(p_actor uuid, p_fighter uuid, p_key uuid, p_text text, p_sha text, p_bytes bigint, p_reason text)
returns public.af_profile_sets language plpgsql security invoker set search_path = '' as $$
declare f public.af_fighters; p public.af_profile_sets; owner uuid; reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  if length(reason) not between 1 and 500 then raise exception 'invalid-reason'; end if;
  select owner_id into owner from public.af_fighters where id = p_fighter;
  if not found then raise exception 'fighter-not-found'; end if;
  -- The owner first, then his fighter (af_admin_profile_set_expressions' order): two calls with one key wait here, so the second finds the
  -- first's set below and writes no second event.
  perform 1 from public.af_creators where owner_id = owner for update;
  select * into p from public.af_profile_sets where owner_id = owner and idempotency_key = p_key;
  if found then
    if p.manifest_sha <> p_sha or p.fighter_id <> p_fighter or not exists(select 1 from public.af_profile_set_events e
        where e.profile_set_id = p.id and e.kind = 'admin-front') then raise exception 'idempotency-conflict'; end if;
    return p;
  end if;
  select * into f from public.af_fighters where id = p_fighter for update;
  if f.profile_set_id is not null then raise exception 'approved-profile-set-exists'; end if;
  p := public.af_profile_set_create(owner, p_fighter, p_key, p_text, p_sha, p_bytes);
  insert into public.af_profile_set_events(fighter_id, profile_set_id, actor, kind, data)
    values (p.fighter_id, p.id, p_actor, 'admin-front', jsonb_build_object('reason', reason));
  return p;
end $$;
revoke all on function public.af_admin_profile_set_front(uuid, uuid, uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.af_admin_profile_set_front(uuid, uuid, uuid, text, text, bigint, text) to service_role;

-- As 20261103100000, and an operator's front is approved only while the fighter still has no current set: an approval never replaces a
-- front his owner had approved meanwhile.
create or replace function public.af_admin_profile_set_approve(p_actor uuid, p_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare p public.af_profile_sets; f public.af_fighters; fighter uuid;
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  select fighter_id into fighter from public.af_profile_sets where id = p_id;
  if not found then raise exception 'not-found'; end if;
  select * into f from public.af_fighters where id = fighter for update;
  select * into p from public.af_profile_sets where id = p_id for update;
  if p.status = 'approved' and f.profile_set_id is not distinct from p.id then
    return jsonb_build_object('id', p.id, 'fighterId', p.fighter_id, 'status', p.status, 'derived', p.derived);
  end if;
  if p.status <> 'review' or f.deleted_at is not null or f.review_state = 'rejected' then raise exception 'review-conflict'; end if;
  if p.based_on is not null and f.profile_set_id is distinct from p.based_on then raise exception 'review-conflict'; end if;
  if f.profile_set_id is not null and exists(select 1 from public.af_profile_set_events e where e.profile_set_id = p.id and e.kind = 'admin-front')
    then raise exception 'review-conflict'; end if;
  update public.af_profile_sets set status = 'superseded' where fighter_id = p.fighter_id and status = 'approved' and id <> p.id;
  update public.af_profile_sets set status = 'approved', reviewed_by = p_actor, reviewed_at = now(), approved_at = now(), reason = null
    where id = p.id returning * into p;
  update public.af_fighters set profile_set_id = p.id where id = p.fighter_id;
  insert into public.af_profile_set_events(fighter_id, profile_set_id, actor, kind) values (p.fighter_id, p.id, p_actor, 'approve');
  return jsonb_build_object('id', p.id, 'fighterId', p.fighter_id, 'status', p.status, 'derived', p.derived);
end $$;
