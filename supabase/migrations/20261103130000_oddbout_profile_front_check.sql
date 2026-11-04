-- 정면 판정 (2026-11-03 사용자: "정면샷이 없는데 왜 출전이 된거야? MCP 서버에서 이거 체크해서 정면샷 제작해야 출전할 수 있다고 알려줘야",
-- "정면샷인지 검증해서 MCP가 알려줘야지"): a fighter entered with a set whose painting nobody had looked at — the validator checks pixels
-- (format, a clear border, the figure's height, the face square), never the view. Now a set the validator passed waits for ODDBOUT's front
-- check before it lets him enter: the official generation PC's codex, every tool off, answers whether the painting shows one character, whole,
-- facing the viewer straight on (host/generation-stages.mjs frontJudgePrompt). A failed check rejects the set with its reason (a wrong fail is
-- answered with a new painting: the user chose the PC's check alone, not an operator's override); an operator's approval of a set in review
-- still decides the home and the arena, and counts as a check passed. The user's other answers the same day: the gate covers every
-- fighter (no exemption by the time he was made; fighters already entered stay), and a fighter who loses his last front goes back to 제작 중.

-- The check: null until it is made (a set made from an approved one, `based_on`, keeps that set's front and is never checked); `pass` or
-- `fail` with the judge's checks and notes. The lease is the check's own, apart from the validator's.
alter table public.af_profile_sets
  add column front_check text check (front_check in ('pass', 'fail')),
  add column front_verdict jsonb check (front_verdict is null or (jsonb_typeof(front_verdict) = 'object' and octet_length(front_verdict::text) <= 2000)),
  add column front_checked_at timestamptz,
  add column front_lease_token uuid,
  add column front_lease_until timestamptz,
  add column front_attempts integer not null default 0 check (front_attempts >= 0),
  add constraint af_profile_sets_front_checked check ((front_check is null) = (front_verdict is null) and (front_check is null) = (front_checked_at is null));
create index af_profile_sets_front_queue on public.af_profile_sets(validated_at) where status = 'review' and front_check is null and based_on is null;

alter table public.af_profile_set_events drop constraint af_profile_set_events_kind_check,
  add constraint af_profile_set_events_kind_check
    check (kind in ('approve', 'reject', 'withdraw', 'public-cleanup-failed', 'admin-expressions', 'admin-front', 'front-check', 'front-lost'));

-- His front for the entry, as the API, the MCP and af_enter_fighter read it: `required` while the gate is on; `ok` with the set that lets him
-- enter (approved, or in review with the check passed); otherwise a set still on its way (before a newer refused one: it may yet pass) or
-- the newest refused, with why, or none. `frontCheck` is the check's answer, or `stalled` when five takes brought none (an operator decides).
create function public.af_fighter_front(p_fighter uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('required', coalesce((select s.profile_set_required_after is not null from public.af_settings s where s.singleton), false))
    || coalesce(
      (select jsonb_build_object('ok', true, 'profileSetId', p.id, 'status', p.status, 'frontCheck', p.front_check)
        from public.af_profile_sets p where p.fighter_id = p_fighter and (p.status = 'approved' or (p.status = 'review' and p.front_check = 'pass'))
        order by p.status = 'approved' desc, p.created_at desc limit 1),
      (select jsonb_build_object('ok', false, 'profileSetId', p.id, 'status', p.status, 'frontCheck', case when p.front_check is null
          and p.status = 'review' and p.front_attempts >= 5 then 'stalled' else p.front_check end)
          || case when p.reason is null then '{}'::jsonb else jsonb_build_object('reason', p.reason) end
          -- The judge's words only for its own refusal: an operator's rejection after a passed check gives his reason alone.
          || case when p.front_check = 'fail' then jsonb_build_object('notes', p.front_verdict->'notes') else '{}'::jsonb end
        from public.af_profile_sets p where p.fighter_id = p_fighter and p.based_on is null and p.status not in ('superseded', 'withdrawn')
          and not (p.status = 'uploading' and p.expires_at <= now())
        order by p.status in ('queued', 'validating', 'review') desc, p.created_at desc limit 1),
      jsonb_build_object('ok', false, 'profileSetId', null, 'status', null))
$$;

-- Was this set a front that let him enter (`p_entered`: when he entered)? Approved, or in review with the check passed, or — the rule before
-- this one — in review since before his entry, unchecked. A set that never was one takes nothing when it goes: a fighter who entered with no
-- front (before the gate) stays entered (리뷰 2026-11-03: his first upload failing the check sent him back to 제작 중).
create function public.af_profile_set_counted(p public.af_profile_sets, p_entered timestamptz) returns boolean
language sql stable security invoker set search_path = '' as $$
  -- Never null (an unchecked set's `front_check = 'pass'` is): a null here once read as "counted".
  select coalesce(p.status = 'approved' or (p.status = 'review' and (p.front_check is not distinct from 'pass'
    or (p.front_check is null and p_entered is not null and p.validated_at < p_entered))), false)
$$;

-- An entered fighter who lost a front that let him enter (`p_counted`, af_profile_set_counted before the change) and has no other goes back
-- to 제작 중, as a new package takes him back; his record stays. Only while the gate is on. The caller holds his row's lock.
create function public.af_fighter_front_lost(p_fighter uuid, p_set uuid, p_counted boolean) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare f public.af_fighters; front jsonb := public.af_fighter_front(p_fighter);
begin
  if not coalesce(p_counted, false) or not (front->>'required')::boolean or (front->>'ok')::boolean then return false; end if;
  update public.af_fighters set entered_at = null where id = p_fighter and entered_at is not null and deleted_at is null returning * into f;
  if not found then return false; end if;
  insert into public.af_profile_set_events(fighter_id, profile_set_id, kind) values (p_fighter, p_set, 'front-lost');
  return true;
end $$;

-- The front check's queue: the official generation PC takes one set at a time, oldest first, under a fifteen-minute lease (codex may wait for
-- a slot). Five takes without a verdict leave the set to the operator (`stalled`); a take the host could not run is given back (below).
create function public.af_profile_set_front_claim() returns public.af_profile_sets
language plpgsql security invoker set search_path = '' as $$
declare p public.af_profile_sets;
begin
  select * into p from public.af_profile_sets
    where status = 'review' and front_check is null and based_on is null and front_attempts < 5
      and (front_lease_until is null or front_lease_until < now())
    order by validated_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.af_profile_sets set front_lease_token = gen_random_uuid(), front_lease_until = now() + interval '15 minutes',
    front_attempts = front_attempts + 1 where id = p.id returning * into p;
  return p;
end $$;

-- A take that could not judge for the host's own reasons (codex cannot run there now, og did not start it, the API could not sign the
-- painting's link): back in the queue at once, and not counted. Under the check's own lease only; a set judged meanwhile stays judged.
create function public.af_profile_set_front_release(p_id uuid, p_lease uuid) returns public.af_profile_sets
language plpgsql security invoker set search_path = '' as $$
declare p public.af_profile_sets;
begin
  update public.af_profile_sets set front_lease_token = null, front_lease_until = null, front_attempts = greatest(front_attempts - 1, 0)
    where id = p_id and p_lease is not null and front_lease_token = p_lease and front_check is null returning * into p;
  if not found then raise exception 'stale-check'; end if;
  return p;
end $$;

-- The judge's verdict under the check's lease: { checks: { whole, front, single: pass | fail }, notes }. All three pass: the set lets him
-- enter. Any fail: the set is rejected with the first failed check's reason (FRONT_VIEW, FRONT_WHOLE, FRONT_SINGLE) and the notes, and an
-- entered fighter left with no front goes back to 제작 중. The same receipt repeated answers the same; a set an operator decided meanwhile
-- keeps his decision.
create function public.af_profile_set_front_finish(p_id uuid, p_lease uuid, p_verdict jsonb) returns public.af_profile_sets
language plpgsql security invoker set search_path = '' as $$
declare p public.af_profile_sets; fighter uuid; entered timestamptz; checks jsonb := p_verdict->'checks'; failed text; counted boolean;
begin
  select fighter_id into fighter from public.af_profile_sets where id = p_id;
  if not found then raise exception 'not-found'; end if;
  -- The fighter first, then his set: the order of approval, rejection and deletion.
  select entered_at into entered from public.af_fighters where id = fighter for update;
  select * into p from public.af_profile_sets where id = p_id for update;
  if p_lease is null or p.front_lease_token is distinct from p_lease then raise exception 'stale-check'; end if;
  if p.front_check is not null or p.status <> 'review' then return p; end if;
  if jsonb_typeof(p_verdict) is distinct from 'object' or jsonb_typeof(checks) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(checks)) <> 3
    or (select count(*) from jsonb_each(checks) c where c.key in ('whole', 'front', 'single') and c.value in ('"pass"', '"fail"')) <> 3
    or jsonb_typeof(p_verdict->'notes') is distinct from 'string' or char_length(p_verdict->>'notes') not between 1 and 400
    or (select count(*) from jsonb_object_keys(p_verdict)) <> 2 or octet_length(p_verdict::text) > 2000 then
    raise exception 'invalid-verdict';
  end if;
  counted := public.af_profile_set_counted(p, entered);
  failed := case when checks->>'front' = 'fail' then 'FRONT_VIEW' when checks->>'whole' = 'fail' then 'FRONT_WHOLE'
    when checks->>'single' = 'fail' then 'FRONT_SINGLE' end;
  update public.af_profile_sets set front_check = case when failed is null then 'pass' else 'fail' end, front_verdict = p_verdict,
    front_checked_at = now(), front_lease_until = null,
    status = case when failed is null then status else 'rejected' end, reason = coalesce(failed, reason)
    where id = p.id returning * into p;
  insert into public.af_profile_set_events(fighter_id, profile_set_id, kind, data)
    values (p.fighter_id, p.id, 'front-check', jsonb_build_object('front', p.front_check) || case when failed is null then '{}'::jsonb
      else jsonb_build_object('reason', failed) end);
  if failed is not null then perform public.af_fighter_front_lost(p.fighter_id, p.id, counted); end if;
  return p;
end $$;

-- As 20261031100000, and a fighter whose last front that let him enter is rejected goes back to 제작 중.
create or replace function public.af_admin_profile_set_reject(p_actor uuid, p_id uuid, p_reason text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare p public.af_profile_sets; was text; fighter uuid; entered timestamptz; counted boolean;
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  if p_reason is null or char_length(btrim(p_reason)) = 0 or char_length(btrim(p_reason)) > 300 then raise exception 'invalid-review'; end if;
  select fighter_id into fighter from public.af_profile_sets where id = p_id;
  if not found then raise exception 'not-found'; end if;
  select entered_at into entered from public.af_fighters where id = fighter for update;
  select * into p from public.af_profile_sets where id = p_id for update;
  if p.status not in ('review', 'approved') then raise exception 'review-conflict'; end if;
  was := p.status; counted := public.af_profile_set_counted(p, entered);
  update public.af_profile_sets set status = 'rejected', reason = btrim(p_reason), reviewed_by = p_actor, reviewed_at = now()
    where id = p.id returning * into p;
  update public.af_fighters set profile_set_id = null where id = p.fighter_id and profile_set_id = p.id and deleted_at is null;
  insert into public.af_profile_set_events(fighter_id, profile_set_id, actor, kind, data)
    values (p.fighter_id, p.id, p_actor, 'reject', jsonb_build_object('reason', p.reason, 'previous', was));
  perform public.af_fighter_front_lost(p.fighter_id, p.id, counted);
  return jsonb_build_object('id', p.id, 'fighterId', p.fighter_id, 'status', p.status, 'previous', was, 'derived', p.derived);
end $$;

-- As 20261031100000, and an operator's removal takes the entry a withdrawn front gave (리뷰 2026-11-03: removed and restored, he was entered
-- again with no front). His deletion clears the entry itself before this.
create or replace function public.af_profile_sets_withdraw(p_fighter uuid, p_actor uuid, p_reason text) returns integer
language plpgsql security invoker set search_path = '' as $$
declare n integer; had boolean;
begin
  select exists(select 1 from public.af_profile_sets p where p.fighter_id = p_fighter and public.af_profile_set_counted(p, f.entered_at))
    into had from public.af_fighters f where f.id = p_fighter;
  update public.af_profile_sets set status = 'withdrawn', reason = p_reason, lease_until = null
    where fighter_id = p_fighter and status in ('uploading', 'queued', 'validating', 'review', 'approved');
  get diagnostics n = row_count;
  if n > 0 then
    insert into public.af_profile_set_events(fighter_id, actor, kind, data) values (p_fighter, p_actor, 'withdraw', jsonb_build_object('reason', p_reason, 'sets', n));
  end if;
  perform public.af_fighter_front_lost(p_fighter, null, coalesce(had, false));
  return n;
end $$;

-- As 20261031100000, and the gate reads af_fighter_front: a set in review counts only once the front check passed, and the switch covers
-- every fighter, whenever he was made (`profile_set_required_after` is an on/off switch now; its time no longer matters).
create or replace function public.af_enter_fighter(p_owner uuid, p_fighter uuid, p_sha text, p_clips text[]) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare f public.af_fighters; front jsonb;
begin
  if p_clips is null or cardinality(p_clips) = 0 then raise exception 'invalid-entry'; end if;
  select * into f from public.af_fighters where id = p_fighter and owner_id = p_owner for update;
  if not found or f.deleted_at is not null then raise exception 'not-found'; end if;
  if f.status <> 'registered' or not coalesce(f.runtime_approved and f.duel_approved and f.review_state = 'approved'
    and f.duel_manifest_sha = f.manifest_sha, false) then raise exception 'fighter-not-ready'; end if;
  if f.manifest_sha is distinct from p_sha then raise exception 'fighter-changed'; end if;
  if f.entered_at is null then
    front := public.af_fighter_front(f.id);
    if (front->>'required')::boolean and not (front->>'ok')::boolean then raise exception 'profile-set-required'; end if;
    update public.af_fighters set entered_at = now(), review_evidence = coalesce(review_evidence, '{}'::jsonb)
      || jsonb_build_object('entry', jsonb_build_object('manifestSha', p_sha, 'clips', to_jsonb(p_clips), 'at', now()))
      where id = f.id returning * into f;
  end if;
  return jsonb_build_object('ok', true, 'stage', 'entered', 'fighterId', f.id, 'enteredAt', f.entered_at);
end $$;

revoke all on function public.af_fighter_front(uuid), public.af_profile_set_counted(public.af_profile_sets, timestamptz),
  public.af_fighter_front_lost(uuid, uuid, boolean), public.af_profile_set_front_claim(), public.af_profile_set_front_release(uuid, uuid),
  public.af_profile_set_front_finish(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.af_fighter_front(uuid), public.af_profile_set_counted(public.af_profile_sets, timestamptz),
  public.af_fighter_front_lost(uuid, uuid, boolean), public.af_profile_set_front_claim(), public.af_profile_set_front_release(uuid, uuid),
  public.af_profile_set_front_finish(uuid, uuid, jsonb) to service_role;
