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

-- As 20261031100000, and the sheet: a set with one passes only from a 0.2.0 validator with its derived sheet, whose object must exist.
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
    or (p.manifest ? 'expressions') <> (sheet is not null)
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
