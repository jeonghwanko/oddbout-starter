-- Operator-review jobs keep their art and history without blocking a new request.
-- Resume admission uses the same creator lock: only one runnable job per account.
-- No existing job, deadline, choice, token balance, or provider is changed.

create or replace function public.af_generation_check(p_owner uuid, p_host_choice text default 'oddbout', p_host uuid default null, p_host_consent boolean default false)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare caps jsonb; choice text := coalesce(p_host_choice, 'oddbout'); named public.af_generation_hosts; own boolean := false;
begin
  perform public.af_authorize(p_owner);
  caps := public.af_generation_capabilities();
  if not (caps->>'hosted')::boolean then raise exception 'generation-unavailable'; end if;
  if choice not in ('oddbout', 'any', 'host') or (choice = 'host') <> (p_host is not null) then raise exception 'invalid-host'; end if;
  if choice = 'host' then
    -- Held until the request is made, so a removal of that host waits and then sees it; a removed host takes no request.
    select * into named from public.af_generation_hosts where id = p_host for key share;
    if not found or named.official or named.removed_at is not null then raise exception 'invalid-host'; end if;
    own := named.owner_id = p_owner;
    if not (own or named.approved) then raise exception 'invalid-host'; end if;
  end if;
  if choice <> 'oddbout' and not own and not coalesce(p_host_consent, false) then raise exception 'host-consent-required'; end if;
  -- One runnable request at a time (operator-review work stays preserved but does not occupy the slot); and a request that is not on his own PC only while his tokens last (보유 토큰 2026-10-31: his balance above
  -- zero, never held for an operator). Only what ODDBOUT's subscription makes for him takes tokens off (af_generation_charged); a request
  -- another person's host makes is held by that host's daily limit and by three requests a day.
  if exists(select 1 from public.af_generation_jobs j where j.owner_id = p_owner and j.status not in ('submitted', 'rejected', 'failed', 'cancelled', 'expired', 'needs_review'))
    then raise exception 'generation-quota'; end if;
  if not own and public.af_generation_free_used(p_owner) then raise exception 'generation-quota'; end if;
  -- Three requests a day, his own: not one ODDBOUT stopped — failed on our side (`failed`), or cancelled while it waited for an operator
  -- (`refunded_at`, the cancel of a needs_review job) — and never for an operator. A refused request (safety) counts: each takes a brief.
  if not public.af_generation_is_admin(p_owner) and (select count(*) from public.af_generation_jobs where owner_id = p_owner
      and created_at > now() - interval '1 day' and status <> 'failed' and not (status = 'cancelled' and refunded_at is not null)) >= 3
    then raise exception 'rate-limit'; end if;
  if (select count(*) from public.af_fighters where owner_id = p_owner and deleted_at is null) >= public.af_fighter_limit(p_owner) then raise exception 'fighter-quota'; end if;
  perform pg_advisory_xact_lock(74280503);
  -- Counted under the lock (two requests at once must not both take the last place in line); a daily limit of 0 starts nothing, so it
  -- takes no request either (it would wait forever).
  if choice = 'oddbout' and ((caps->>'dailyLimit')::integer = 0
      or public.af_generation_waiting() >= (select s.queue_limit from public.af_generation_settings s where s.singleton))
    then raise exception 'generation-capacity'; end if;
  if choice = 'host' then
    if not public.af_generation_host_live(named) then raise exception 'host-offline'; end if;
    if public.af_generation_host_today(named.id) >= named.daily_limit then raise exception 'host-capacity'; end if;
  end if;
  if choice = 'any' and not exists(select 1 from public.af_generation_hosts h where h.accepts_any and public.af_generation_host_online(h)
      and public.af_generation_host_today(h.id) < h.daily_limit) then raise exception 'generation-capacity'; end if;
  return own;
end $$;

create or replace function public.af_admin_generation_retry(p_actor uuid, p_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare j public.af_generation_jobs; next text; blocked boolean;
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  -- Same creator-before-job order as af_generation_own and automatic completion.
  perform 1 from public.af_creators c join public.af_generation_jobs pending_job on pending_job.owner_id = c.owner_id
    where pending_job.id = p_id for update of c;
  select * into j from public.af_generation_jobs where id = p_id for update;
  if not found then raise exception 'not-found'; end if;
  if j.status <> 'needs_review' then raise exception 'review-conflict'; end if;
  -- The creator row above also serializes new requests and other operator retries.
  if exists(select 1 from public.af_generation_jobs other where other.owner_id = j.owner_id and other.id <> j.id
      and other.status not in ('submitted', 'rejected', 'failed', 'cancelled', 'expired', 'needs_review'))
    then raise exception 'review-conflict'; end if;
  select finished.data->'registrationBlocked' = 'true'::jsonb and not exists (
    select 1 from public.af_generation_events registered
      where registered.job_id = p_id and registered.kind = 'register' and registered.id > finished.id
  ) into blocked from public.af_generation_events finished
    where finished.job_id = p_id and finished.kind = 'finished' order by finished.id desc limit 1;
  if coalesce(blocked, false) then
    -- A refusal rolls this transaction back to needs_review. Never queue generation to repair registration.
    perform public.af_generation_registration_draft(j);
    update public.af_generation_jobs set status = 'motion_ready' where id = p_id;
    j := public.af_generation_register(j.owner_id, j.id, public.af_generation_registration_draft(j));
    next := 'submitting';
  else
    next := case when j.brief is null then 'queued' when j.profile is not null then 'submitting' when j.choice is not null then 'motions' else 'appearance' end;
  end if;
  update public.af_generation_jobs set status = next, error_code = null, stage_leases = 0, lease_token = null, lease_expires_at = null,
    waiting_since = null, updated_at = now() where id = p_id returning * into j;
  insert into public.af_generation_events(job_id, kind, data) values (p_id, 'operator', jsonb_build_object('action', 'retry', 'to', next, 'actor', p_actor));
  return jsonb_build_object('id', j.id, 'status', j.status);
end $$;
