-- 등록 선수를 정식 선수로 올리기(2026-11-05, 사용자: "코드 정식 선수로 승격해줘", "DB + 전적 이전"): a registered fighter whose package went into
-- the game as an official fighter (crashbang-heroes kaito_web/src/fighters/<id>/fighter.json `promotedFrom`) is retired here and remembers
-- the official id (`promoted_to`). Retired, he leaves the roster, duels, cups and every write (af_fighter_public is unchanged); his story,
-- relations and world place stay readable under the official fighter (af_fighter_listed, af_fighter_cast_shown), and nobody deletes,
-- restores or edits him (사용자 2026-11-05: 정사 쓰기도 막는다). His account slot is released as an owner deletion releases it (사용자: 선수 칸을
-- 돌려준다): `deleted_at` and a null `account_slot`, so every count of an owner's fighters (`deleted_at is null` — the fighter limit, a new
-- submission's slot, a generation request, the account page) leaves him out without restating each. `promoted_to` tells the two apart. One operator step: af_promote_fighter (admin API POST admin/fighters/<id>/promotion, `npm run admin -- fighter-promote`).

alter table public.af_fighters add column promoted_to text
  check (promoted_to ~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$' and char_length(promoted_to) <= 32);
alter table public.af_fighters add constraint af_fighters_promoted_retired
  check (promoted_to is null or (review_state = 'rejected' and not runtime_approved and not duel_approved and deleted_at is not null and account_slot is null));
-- Several registered fighters may go into one official package (its `promotedFrom` is a list): not unique.
create index af_fighters_promoted_to on public.af_fighters(promoted_to) where promoted_to is not null;

alter table public.af_moderation_events drop constraint af_moderation_events_action_check;
alter table public.af_moderation_events add constraint af_moderation_events_action_check check (action in ('remove', 'restore', 'promote'));

-- Who public reads show (S0-1: the read side of af_fighter_public, in one place). A story and its relations: a fighter on the public stage, or
-- a promoted one (his `deleted_at` is his released slot, not an owner's deletion). A world's cast and its count: an approved fighter not
-- deleted (as before), or a promoted one.
create function public.af_fighter_listed(p_fighter uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select public.af_fighter_public(p_fighter)
    or exists(select 1 from public.af_fighters f where f.id = p_fighter and f.promoted_to is not null);
$$;
create function public.af_fighter_cast_shown(f public.af_fighters) returns boolean language sql immutable set search_path = '' as $$
  select (f.deleted_at is null and f.review_state = 'approved') or f.promoted_to is not null;
$$;
revoke all on function public.af_fighter_listed(uuid), public.af_fighter_cast_shown(public.af_fighters) from public, anon, authenticated;
grant execute on function public.af_fighter_listed(uuid), public.af_fighter_cast_shown(public.af_fighters) to service_role;

-- Restated from 20261027200000 with af_fighter_listed for the reader's checks and the promoted ids beside the fighter and each relation.
create or replace function public.af_fighter_story(p_fighter uuid, p_before timestamptz default null, p_version integer default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when not public.af_fighter_listed(p_fighter) then null else jsonb_build_object(
    'promotedTo', (select f.promoted_to from public.af_fighters f where f.id = p_fighter),
    'canon', (select jsonb_build_object('version', c.version, 'sheet', c.sheet, 'createdAt', c.created_at, 'noteId', c.note_id,
        'madeWith', c.made_with, 'author', (select nickname from public.af_creator_names where user_id = c.author_id))
      from public.af_fighter_canon c where c.fighter_id = p_fighter and (p_version is null or c.version = p_version)
      order by c.version desc limit 1),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('version', c.version, 'createdAt', c.created_at, 'noteId', c.note_id,
        'madeWith', c.made_with) order by c.version desc)
      from (select * from public.af_fighter_canon where fighter_id = p_fighter order by version desc limit 50) c), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'body', n.body, 'evidence', n.evidence,
        'proposal', n.proposal, 'baseVersion', n.base_version, 'state', n.state, 'resolvedVersion', n.resolved_version,
        'madeWith', n.made_with, 'author', (select nickname from public.af_creator_names where user_id = n.author_id),
        'createdAt', n.created_at) order by n.created_at desc, n.id)
      from (select * from public.af_fighter_notes where fighter_id = p_fighter and not hidden and (p_before is null or created_at < p_before)
        order by created_at desc, id limit 21) n), '[]'::jsonb),
    'relations', coalesce((select jsonb_agg(jsonb_build_object('id', r.id,
        'other', case when r.fighter_id = p_fighter then r.other_id else r.fighter_id end,
        'otherName', (select f.profile->>'name' from public.af_fighters f where f.id = case when r.fighter_id = p_fighter then r.other_id else r.fighter_id end),
        'otherPromotedTo', (select f.promoted_to from public.af_fighters f where f.id = case when r.fighter_id = p_fighter then r.other_id else r.fighter_id end),
        -- The kind as this fighter sees it: the other side of mentor is student.
        'kind', case when r.fighter_id = p_fighter or r.kind in ('rival', 'comrade') then r.kind when r.kind = 'mentor' then 'student' else 'mentor' end,
        'since', r.answered_at) order by r.answered_at)
      from public.af_fighter_relations r where r.state = 'accepted' and p_fighter in (r.fighter_id, r.other_id)
        and public.af_fighter_listed(r.fighter_id) and public.af_fighter_listed(r.other_id)), '[]'::jsonb)) end;
$$;

-- Restated from 20261027230000 with af_fighter_cast_shown and each character's `promoted_to`.
create or replace function public.af_world_overview(p_world text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('world', to_jsonb(w) - 'owner_id' - 'hidden', 'memberCount', (select count(*) from public.af_world_members where world_id = w.id),
    'membership', (select to_jsonb(m) from public.af_world_members m where world_id = w.id and user_id = auth.uid()),
    'isOwner', w.owner_id is not null and w.owner_id = auth.uid(),
    'owner', (select nickname from public.af_world_members where world_id = w.id and user_id = w.owner_id),
    'characters', coalesce((select jsonb_agg(jsonb_build_object('fighter_id', c.fighter_id, 'world_id', c.world_id,
        'name', coalesce(left(nullif(btrim(f.profile->>'name'), ''), 60), c.name), 'portrait_path', c.portrait_path, 'faction', c.faction,
        'placed_at', c.placed_at, 'promoted_to', f.promoted_to) order by c.placed_at)
      from public.af_world_fighters c join public.af_fighters f on f.id = c.fighter_id
      where c.world_id = w.id and public.af_fighter_cast_shown(f)), '[]'::jsonb))
  from public.af_worlds w where w.id = p_world and w.published and not w.hidden;
$$;

-- Restated from 20261027230000 with af_fighter_cast_shown; `promotedCounted` tells the site this count already holds the promoted fighters
-- (an older server's did not, and the site added them itself — kaito_web/src/platform/workshop.ts fetchWorlds).
create or replace function public.af_world_list() returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'tagline', w.tagline, 'description', w.description, 'place', w.place,
      'cover', w.cover_path, 'factions', w.factions, 'operator', w.owner_id is null,
      'owner', (select nickname from public.af_world_members where world_id = w.id and user_id = w.owner_id),
      'members', (select count(*) from public.af_world_members where world_id = w.id),
      'fighters', (select count(*) from public.af_world_fighters c join public.af_fighters f on f.id = c.fighter_id
        where c.world_id = w.id and public.af_fighter_cast_shown(f)), 'promotedCounted', true, 'createdAt', w.created_at)
    order by w.owner_id is null desc, w.created_at desc, w.id), '[]'::jsonb)
  from (select * from public.af_worlds where published and not hidden order by owner_id is null desc, created_at desc, id limit 100) w;
$$;

-- The operator promotes a registered fighter: retired as by a removal (no roster, duels or cups), his slot released as by a deletion, his
-- profile sets kept, the official id kept. A removed fighter may be promoted (the first one was removed before this existed); a promoted one
-- not again; one his owner deleted not at all.
create function public.af_promote_fighter(p_actor uuid, p_fighter uuid, p_version bigint, p_official text, p_reason text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare f public.af_fighters; next_version bigint;
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  if p_version is null or p_version < 0 or p_reason is null or length(trim(p_reason)) not between 1 and 500 or p_official is null
    or p_official !~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$' or char_length(p_official) > 32 then raise exception 'invalid-review'; end if;
  select * into f from public.af_fighters where id = p_fighter for update;
  if not found then raise exception 'not-found'; end if;
  if f.moderation_version <> p_version or f.promoted_to is not null then raise exception 'review-conflict'; end if;
  if f.deleted_at is not null then raise exception 'fighter-deleted'; end if;
  next_version := f.moderation_version + 1;
  update public.af_fighters set review_state = 'rejected', runtime_approved = false, duel_approved = false, runtime_scope = null,
    runtime_manifest_sha = null, duel_manifest_sha = null, promoted_to = p_official, deleted_at = now(), account_slot = null, entered_at = null,
    moderation_version = next_version, moderation_reason = trim(p_reason), moderated_at = now()
    where id = f.id;
  insert into public.af_moderation_events(fighter_id, actor, action, reason, version) values (f.id, p_actor, 'promote', trim(p_reason), next_version);
  return jsonb_build_object('fighterId', f.id, 'state', 'promoted', 'promotedTo', p_official, 'version', next_version);
end $$;
revoke all on function public.af_promote_fighter(uuid, uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.af_promote_fighter(uuid, uuid, bigint, text, text) to service_role;

-- Restated from 20261031100000: a promoted fighter is not restored.
create or replace function public.af_moderate_fighter(p_actor uuid,p_fighter uuid,p_version bigint,p_action text,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare f public.af_fighters; s public.af_submissions; next_version bigint;
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  if p_action is null or p_action not in ('remove','restore') or p_version is null or p_version<0
    or p_reason is null or length(trim(p_reason)) not between 1 and 500 then raise exception 'invalid-review'; end if;
  select * into f from public.af_fighters where id=p_fighter for update;
  if not found then raise exception 'not-found'; end if;
  if f.moderation_version<>p_version then raise exception 'review-conflict'; end if;
  -- A promoted fighter (af_promote_fighter) stays retired: restored, he would stand twice — as himself and as the official one.
  if p_action='restore' and f.promoted_to is not null then raise exception 'fighter-promoted'; end if;
  if (p_action='remove' and f.review_state='rejected') or (p_action='restore' and (f.runtime_approved or (f.status='profile' and f.review_state='approved'))) then raise exception 'review-conflict'; end if;
  select * into s from public.af_submissions where id=f.submission_id;
  if p_action='restore' and f.status<>'profile' and (s.status<>'registered' or s.manifest_sha<>f.manifest_sha
    or s.validation->>'stage' is distinct from 'bytes-hashes-and-full-decode') then raise exception 'validation-incomplete'; end if;
  next_version:=f.moderation_version+1;
  update public.af_fighters set review_state=case when p_action='remove' then 'rejected' else 'approved' end,
    runtime_approved=p_action='restore' and f.status='registered',duel_approved=p_action='restore' and f.status='registered',
    runtime_scope=case when p_action='restore' and f.status='registered' then 'arena-player-v1' else null end,
    runtime_manifest_sha=case when p_action='restore' and f.status='registered' then manifest_sha else null end,
    duel_manifest_sha=case when p_action='restore' and f.status='registered' then manifest_sha else null end,
    profile_set_id=case when p_action='remove' then null else profile_set_id end,
    review_evidence=coalesce(review_evidence,'{}'::jsonb)||case when f.status='profile' then '{"authorization":"profile-registration"}'::jsonb else jsonb_build_object('authorization','open-registration','validation',s.validation,'duelValidation','validated-v1-package','policy','post-publication-moderation') end,
    moderation_version=next_version,moderation_reason=trim(p_reason),moderated_at=now()
    where id=f.id;
  if p_action='remove' then perform public.af_profile_sets_withdraw(f.id,p_actor,'fighter-removed'); end if;
  insert into public.af_moderation_events(fighter_id,actor,action,reason,version) values(f.id,p_actor,p_action,trim(p_reason),next_version);
  return jsonb_build_object('fighterId',f.id,'state',case when p_action='remove' then 'removed' else 'active' end,'version',next_version);
end $$;

-- Restated from 20261030120000: a promoted fighter is not deleted by his owner.
create or replace function public.af_prepare_fighter_deletion(p_owner uuid,p_fighter uuid,p_session uuid,p_client uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare f public.af_fighters; d public.af_fighter_deletions; current_snapshot jsonb; display_name text;
begin
  if not public.af_owner_session_active(p_owner,p_session,p_client) then raise exception 'authentication-required'; end if;
  -- Same creator lock as slot allocation; ownership and the snapshot are checked under the fighter lock.
  perform 1 from public.af_creators where owner_id=p_owner for update;
  select * into f from public.af_fighters where id=p_fighter and owner_id=p_owner for update;
  if not found then raise exception 'not-found'; end if;
  -- A promoted fighter's story, relations and world place now belong to the official one (af_promote_fighter): he is not deleted.
  if f.promoted_to is not null then raise exception 'fighter-promoted'; end if;
  if f.deleted_at is not null then return jsonb_build_object('ok',true,'stage','deleted','fighterId',f.id,'deletedAt',f.deleted_at); end if;
  current_snapshot:=jsonb_build_object('submission',f.submission_id,'manifest',f.manifest_sha,'profile',f.profile,'version',f.moderation_version);
  display_name:=coalesce(nullif(f.profile->'names'->>'ko',''),f.profile->>'name');
  select * into d from public.af_fighter_deletions where owner_id=p_owner and fighter_id=f.id and session_id=p_session and client_id=p_client for update;
  if not found then
    insert into public.af_fighter_deletions(owner_id,fighter_id,session_id,client_id,snapshot,confirm_name)
      values(p_owner,f.id,p_session,p_client,current_snapshot,display_name) returning * into d;
  elsif d.expires_at<=now() or d.snapshot is distinct from current_snapshot then
    update public.af_fighter_deletions set token=gen_random_uuid(),snapshot=current_snapshot,confirm_name=display_name,
      created_at=now(),expires_at=now()+interval '10 minutes',completed_at=null,result=null where token=d.token returning * into d;
  end if;
  return jsonb_build_object('ok',true,'stage','confirmation-required','fighterId',f.id,'ownerId',p_owner,
    'name',display_name,'registeredName',f.profile->>'name','manifestSha256',f.manifest_sha,
    'confirmationToken',d.token,'confirmName',d.confirm_name,'expiresAt',d.expires_at,
    'deletionMode','soft-delete','effects',jsonb_build_object('removeFromMyFighters',true,'removeFromPublicRoster',true,
      'disableNewMatches',true,'releaseFighterSlot',true,'retainPrivatePackageAndHistory',true,
      'previouslyIssuedAssetLinksExpireWithinSeconds',600));
end $$;

-- And no path changes him: not a deletion, a restore, his profile or style (the owner's edits and the operator's, which run the owner's own
-- functions), nor his slot. Named to fire before af_guard_deleted_fighter (triggers run in name order), so the answer is this one.
create function public.af_guard_promoted_fighter() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.promoted_to is not null and new is distinct from old then raise exception 'fighter-promoted'; end if;
  return new;
end $$;
revoke all on function public.af_guard_promoted_fighter() from public, anon, authenticated;
grant execute on function public.af_guard_promoted_fighter() to service_role;
create trigger af_guard_by_promotion before update on public.af_fighters for each row execute function public.af_guard_promoted_fighter();

-- His canon (정사) is not written again (사용자 2026-11-05): neither by his owner nor by accepting a workshop proposal (af_note_resolve writes
-- its version here too). The story keeps what was written before.
create function public.af_guard_promoted_canon() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists(select 1 from public.af_fighters f where f.id = new.fighter_id and f.promoted_to is not null) then raise exception 'fighter-promoted'; end if;
  return new;
end $$;
revoke all on function public.af_guard_promoted_canon() from public, anon, authenticated;
grant execute on function public.af_guard_promoted_canon() to service_role;
create trigger af_guard_by_promotion before insert on public.af_fighter_canon for each row execute function public.af_guard_promoted_canon();

-- Restated from 20261027230000: the owner's canon write answers `fighter-promoted` for a promoted fighter (his row is deleted-looking, which
-- the lookup below would have called not found).
create or replace function public.af_canon_write(p_owner uuid, p_fighter uuid, p_base integer, p_sheet jsonb, p_client uuid)
returns public.af_fighter_canon language plpgsql security definer set search_path = '' as $$
declare f public.af_fighters; current_version integer; row public.af_fighter_canon;
begin
  perform public.af_authorize(p_owner);
  if exists(select 1 from public.af_fighters where id = p_fighter and owner_id = p_owner and promoted_to is not null) then raise exception 'fighter-promoted'; end if;
  select * into f from public.af_fighters where id = p_fighter and owner_id = p_owner and deleted_at is null for update;
  if not found then raise exception 'fighter-not-found'; end if;
  select coalesce(max(version), 0) into current_version from public.af_fighter_canon where fighter_id = p_fighter;
  if current_version <> p_base then raise exception 'canon-changed'; end if;
  perform public.af_canon_rate(p_fighter);
  insert into public.af_fighter_canon(fighter_id, version, sheet, author_id, made_with)
    values (p_fighter, current_version + 1, p_sheet, p_owner, public.af_client_name(p_client)) returning * into row;
  return row;
end $$;
