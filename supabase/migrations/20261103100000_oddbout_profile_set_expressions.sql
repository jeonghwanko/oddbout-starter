-- 선수 프로필 세트의 표정 시트 (2026-11-03 사용자: "무투장에서 패배했을때 결과창에서 표정이 생성되는지 점검하고, 안되고 있다면 생성되게
-- 개선해줘"): a set may carry his expression sheet (api/profile-sets.mjs `expressions`: 1536 × 1024, 3 × 2 cells in the arena's order
-- default·hit·smug·danger·sideeye·ko). The validator (0.2.0) decodes it and makes the arena's 1152 × 768 copy, `derived.sheet`; approval
-- copies it to the public bucket with the card and face, and the roster names it (`profileSet.expressions`). A set without a sheet is as before,
-- and a 0.1.0 validator (deployed before this) may still finish one.

-- As 20261031100000, and the sheet's object too when the set file names one.
create or replace function public.af_profile_set_submit(p_owner uuid, p_id uuid) returns public.af_profile_sets
language plpgsql security invoker set search_path = '' as $$
declare p public.af_profile_sets; base text;
begin
  select * into p from public.af_profile_sets where id = p_id and owner_id = p_owner for update;
  if not found then raise exception 'not-found'; end if;
  if p.status <> 'uploading' then return p; end if;
  if p.expires_at <= now() then raise exception 'upload-expired'; end if;
  base := p.owner_id::text || '/profile-sets/' || p.id::text || '/';
  if not exists(select 1 from storage.objects o where o.bucket_id = 'ai-fighter-beta' and o.name = base || 'front.webp'
      and (o.metadata->>'size')::bigint = (p.manifest->'front'->>'bytes')::bigint)
    or (p.manifest ? 'expressions' and not exists(select 1 from storage.objects o where o.bucket_id = 'ai-fighter-beta'
      and o.name = base || 'expressions.webp' and (o.metadata->>'size')::bigint = (p.manifest->'expressions'->>'bytes')::bigint)) then
    raise exception 'assets-incomplete';
  end if;
  update public.af_profile_sets set status = 'queued', submitted_at = now() where id = p.id returning * into p;
  return p;
end $$;

-- As 20261031100000, and the sheet: a set with one passes only from a 0.2.0 validator, with its derived sheet (whose object must exist) or,
-- when the sheet failed its check, without it and with the reasons (`sheetErrors`): a failing sheet never takes the front's set down.
create or replace function public.af_profile_set_finish(p_id uuid, p_lease uuid, p_sha text, p_passed boolean, p_result jsonb, p_derived jsonb)
returns public.af_profile_sets language plpgsql security invoker set search_path = '' as $$
declare p public.af_profile_sets; base text; card jsonb; face jsonb; sheet jsonb;
begin
  select * into p from public.af_profile_sets where id = p_id for update;
  if not found then raise exception 'not-found'; end if;
  if p.lease_token is distinct from p_lease or p.manifest_sha <> p_sha then raise exception 'stale-validation'; end if;
  if p.status in ('review', 'approved', 'rejected', 'superseded', 'withdrawn') then return p; end if;
  if p.status <> 'validating' or p.lease_until <= now() then raise exception 'stale-validation'; end if;
  if coalesce(p_result->>'validatorVersion', '') not in ('oddbout-profile-set-validator-0.1.0', 'oddbout-profile-set-validator-0.2.0')
    or (p.manifest ? 'expressions' and p_result->>'validatorVersion' <> 'oddbout-profile-set-validator-0.2.0') then
    raise exception 'validator-version';
  end if;
  if octet_length(p_result::text) > 16000 then raise exception 'validation-result-limit'; end if;
  if not p_passed then
    update public.af_profile_sets set status = 'rejected', validation = p_result,
      reason = left(coalesce(p_result->'errors'->0->>'code', 'validation'), 100), lease_until = null,
      validated_at = now() where id = p.id returning * into p;
    return p;
  end if;
  if p_result->>'stage' is distinct from 'profile-set-full-decode' then raise exception 'validation-incomplete'; end if;
  card := p_derived->'card'; face := p_derived->'face'; sheet := p_derived->'sheet';
  if jsonb_typeof(card) is distinct from 'object' or jsonb_typeof(face) is distinct from 'object'
    or coalesce(card->>'sha256', '') !~ '^[a-f0-9]{64}$' or coalesce(face->>'sha256', '') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(card->'bytes') is distinct from 'number' or jsonb_typeof(face->'bytes') is distinct from 'number'
    or jsonb_typeof(card->'width') is distinct from 'number' or not (card->'width' >= '1'::jsonb and card->'width' <= '600'::jsonb)
    or card->'height' is distinct from '600'::jsonb
    or face->'size' is distinct from '192'::jsonb or jsonb_typeof(card->'face') is distinct from 'object'
    or (sheet is not null and not (p.manifest ? 'expressions'))
    or (sheet is null and p.manifest ? 'expressions' and (jsonb_typeof(p_result->'sheetErrors') is distinct from 'array'
      or jsonb_array_length(p_result->'sheetErrors') = 0))
    or (sheet is not null and (jsonb_typeof(sheet) is distinct from 'object' or coalesce(sheet->>'sha256', '') !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(sheet->'bytes') is distinct from 'number' or sheet->'width' is distinct from '1152'::jsonb
      or sheet->'height' is distinct from '768'::jsonb or sheet->'cell' is distinct from '384'::jsonb))
    or octet_length(p_derived::text) > 2000 then
    raise exception 'validation-incomplete';
  end if;
  base := p.owner_id::text || '/profile-sets/' || p.id::text || '/';
  if not exists(select 1 from storage.objects o where o.bucket_id = 'ai-fighter-beta' and o.name = base || 'card.webp'
      and (o.metadata->>'size')::numeric = (card->>'bytes')::numeric)
    or not exists(select 1 from storage.objects o where o.bucket_id = 'ai-fighter-beta' and o.name = base || 'face.webp'
      and (o.metadata->>'size')::numeric = (face->>'bytes')::numeric)
    or (sheet is not null and not exists(select 1 from storage.objects o where o.bucket_id = 'ai-fighter-beta' and o.name = base || 'sheet.webp'
      and (o.metadata->>'size')::numeric = (sheet->>'bytes')::numeric)) then
    raise exception 'validation-incomplete';
  end if;
  update public.af_profile_sets set status = 'review', validation = p_result,
    derived = jsonb_build_object('card', card, 'face', face) || case when sheet is null then '{}'::jsonb else jsonb_build_object('sheet', sheet) end,
    lease_until = null, validated_at = now()
    where id = p.id returning * into p;
  return p;
end $$;

-- As 20261031100000, and the sheet's hash with the card's and the face's.
create or replace function public.af_profile_set_stale_public(p_fighter uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'shas', (
      select coalesce(jsonb_agg(sha), '[]'::jsonb) from (select p.derived->'card'->>'sha256' as sha union select p.derived->'face'->>'sha256'
        union select p.derived->'sheet'->>'sha256') h
      where h.sha ~ '^[a-f0-9]{64}$' and not exists(select 1 from public.af_profile_sets c where c.fighter_id = p.fighter_id and c.status = 'approved'
        and h.sha in (c.derived->'card'->>'sha256', c.derived->'face'->>'sha256', c.derived->'sheet'->>'sha256'))))), '[]'::jsonb)
  from public.af_profile_sets p
  where p.fighter_id = p_fighter and p.status <> 'approved' and p.approved_at is not null and p.unpublished_at is null;
$$;

revoke all on function public.af_profile_set_submit(uuid, uuid), public.af_profile_set_finish(uuid, uuid, text, boolean, jsonb, jsonb),
  public.af_profile_set_stale_public(uuid) from public, anon, authenticated;
grant execute on function public.af_profile_set_submit(uuid, uuid), public.af_profile_set_finish(uuid, uuid, text, boolean, jsonb, jsonb),
  public.af_profile_set_stale_public(uuid) to service_role;

-- An operator's sheet for someone's fighter (api/profile-sets.mjs addOperatorSheet): the new set is his owner's; the operator's id and
-- reason are kept here only, as af_admin_fighter_edits keeps an operator's package.
alter table public.af_profile_set_events drop constraint af_profile_set_events_kind_check,
  add constraint af_profile_set_events_kind_check check (kind in ('approve', 'reject', 'withdraw', 'public-cleanup-failed', 'admin-expressions'));
-- The approved set an operator's copy was made from: it is approved only while that set is still his current one (리뷰 2026-11-03: an
-- approval must never put back a front the owner replaced meanwhile).
alter table public.af_profile_sets add column based_on uuid references public.af_profile_sets(id);

-- The operator's set: his owner's af_profile_set_create from the fighter's current approved set, its base and the operator's event in one
-- transaction (리뷰 2026-11-03: an event written after the upload could be lost on a retry). The same key answers the same set, at any
-- status, only for the same sheet and base.
create function public.af_admin_profile_set_expressions(p_actor uuid, p_from uuid, p_key uuid, p_text text, p_sha text, p_bytes bigint, p_reason text)
returns public.af_profile_sets language plpgsql security invoker set search_path = '' as $$
declare base public.af_profile_sets; f public.af_fighters; p public.af_profile_sets; reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  if length(reason) not between 1 and 500 then raise exception 'invalid-reason'; end if;
  select * into base from public.af_profile_sets where id = p_from;
  if not found then raise exception 'not-found'; end if;
  select * into p from public.af_profile_sets where owner_id = base.owner_id and idempotency_key = p_key;
  if found then
    if p.manifest_sha <> p_sha or p.based_on is distinct from base.id then raise exception 'idempotency-conflict'; end if;
    return p;
  end if;
  select * into f from public.af_fighters where id = base.fighter_id for update;
  if base.status <> 'approved' or f.deleted_at is not null or f.profile_set_id is distinct from base.id then raise exception 'review-conflict'; end if;
  p := public.af_profile_set_create(base.owner_id, base.fighter_id, p_key, p_text, p_sha, p_bytes);
  update public.af_profile_sets set based_on = base.id where id = p.id returning * into p;
  insert into public.af_profile_set_events(fighter_id, profile_set_id, actor, kind, data)
    values (p.fighter_id, p.id, p_actor, 'admin-expressions', jsonb_build_object('reason', reason, 'from', base.id));
  return p;
end $$;
revoke all on function public.af_admin_profile_set_expressions(uuid, uuid, uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.af_admin_profile_set_expressions(uuid, uuid, uuid, text, text, bigint, text) to service_role;

-- As 20261031100000, and an operator's copy (`based_on`) is approved only while its base is still the fighter's current set.
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
  update public.af_profile_sets set status = 'superseded' where fighter_id = p.fighter_id and status = 'approved' and id <> p.id;
  update public.af_profile_sets set status = 'approved', reviewed_by = p_actor, reviewed_at = now(), approved_at = now(), reason = null
    where id = p.id returning * into p;
  update public.af_fighters set profile_set_id = p.id where id = p.fighter_id;
  insert into public.af_profile_set_events(fighter_id, profile_set_id, actor, kind) values (p.fighter_id, p.id, p_actor, 'approve');
  return jsonb_build_object('id', p.id, 'fighterId', p.fighter_id, 'status', p.status, 'derived', p.derived);
end $$;

-- A hosted fighter's sheet (the worker's `profile-front`), kept apart from his front: an API from before the sheet reads `profile_front`
-- alone, so a rollback still makes the front's set.
alter table public.af_generation_jobs add column profile_expressions jsonb;
