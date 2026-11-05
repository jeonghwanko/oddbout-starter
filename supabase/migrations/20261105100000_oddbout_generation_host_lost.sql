-- 사라진 호스트의 신청 (2026-11-05, 서빙 아키텍처 리뷰): a community host that took a request and then went away for good held it forever.
-- After its brief a job belongs to the host that took it (`assigned_host`; 20261028130000: its files are on that PC), and only that host
-- claims it again (af_generation_claim_for). Its lease ran out, `stage-attempts` counts only that host's own claims, af_generation_expire
-- ends only the jobs waiting for their creators, and a creator cannot cancel a registration under way (`submitting`). So the job stayed in a
-- working state for good, holding its creator's one open request and his free fighter.
--
-- A job is lost with its host (af_generation_host_lost) when all of these hold:
--   - it is past its brief and the worker's (`appearance`, `motions`, `submitting`). A `queued` job has no host yet: the brief is the
--     official host's.
--   - its lease is over, or it has none.
--   - its host is a community host that is not online (af_generation_host_online) and has not reported in for a day (`worker_seen_at`).
--     A PC switched off for a night comes back to its jobs. A stage's progress is a report too, so a host making a long stage is never lost.
-- The official host is ODDBOUT's own PC: its jobs wait for it (its operator brings it back), and no other host may take a request to ODDBOUT.
--
-- What becomes of it, decided per status. No status is handed to another host:
--   - `appearance`, `motions` and `submitting` all have files on that PC only (the looks, the side still, the rows and clips, the package).
--     Another host would draw them again on its own subscription, and a request that named this host was consented to that PC only. A job
--     handed on would also leave its folder open on the old PC, blocking `og setup` there: the `ended` route tells a host only of its own jobs.
--   - The host took the stage and never finished it (a lease taken since the stage began: `lease_token`, or `stage_leases` > 0, which a
--     stage handed back with `retry` keeps). Whether a paid run went out is written only in that PC's dispatch records
--     (host/generation-worker.mjs createDispatches), so the outcome is unknown (AGENTS.md hard rule 2). As a record with no end does
--     (`<stage>-dispatch-unknown`), it goes to an operator without running: `needs_review`, error `<status>-host-lost`. Nothing runs it again
--     unseen. Its creator may cancel it and gets his free fighter back (af_generation_cancel); an operator's retry gives it to the same host
--     again (af_admin_generation_retry), and it fails as below if that host is still gone.
--   - The host never took this stage (`stage_leases` = 0: set by the creator's answer or an operator's retry, with no claim since). Nothing
--     ran, so nothing is unknown. It fails (`failed`, error `host-lost`): the creator's free fighter comes back (af_generation_spends), he may
--     ask again, and the host, if it ever returns, closes the job's folder (the `ended` route reports a failed job).
-- Each lost job gets a `host-lost` event (the stage, where it went, the host and its last report). Run by every claim of every host
-- (af_generation_claim_for), after the stage-attempts rule: a job that used its three leases still fails with `stage-attempts` as before.

create function public.af_generation_host_lost() returns integer language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  with lost as (
    select j.id, j.status, j.assigned_host, h.worker_seen_at, (j.lease_token is not null or j.stage_leases > 0) as unknown
    from public.af_generation_jobs j join public.af_generation_hosts h on h.id = j.assigned_host
    where j.status in ('appearance', 'motions', 'submitting') and coalesce(j.lease_expires_at, '-infinity') < now()
      and not h.official and not public.af_generation_host_online(h) and coalesce(h.worker_seen_at, '-infinity') < now() - interval '1 day'
    for update of j skip locked),
  ended as (
    update public.af_generation_jobs j set status = case when l.unknown then 'needs_review' else 'failed' end,
      error_code = case when l.unknown then l.status || '-host-lost' else 'host-lost' end, lease_token = null, lease_expires_at = null,
      updated_at = now()
    from lost l where j.id = l.id
    returning j.id, l.status as stage, j.status as moved, l.assigned_host, l.worker_seen_at)
  insert into public.af_generation_events(job_id, kind, data)
    select e.id, 'host-lost', jsonb_build_object('status', e.stage, 'to', e.moved, 'host', e.assigned_host, 'lastSeenAt', e.worker_seen_at)
    from ended e;
  get diagnostics n = row_count;
  return n;
end $$;

-- Restated whole from 20261031120000 with only the lost hosts' jobs ended (af_generation_host_lost) after the stage-attempts rule.
create or replace function public.af_generation_claim_for(p_host uuid) returns public.af_generation_jobs
language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs; h public.af_generation_hosts; others boolean; room boolean;
begin
  -- The host row is held (key share) until this claim commits: a removal waits for it and then sees the job it took.
  select * into h from public.af_generation_hosts where id = coalesce(p_host, public.af_generation_official()) for key share;
  if not found or h.removed_at is not null or not h.enabled or not (h.approved or h.terms_accepted_at is not null) then return null; end if;
  perform public.af_generation_expire();
  update public.af_generation_jobs set status = 'failed', error_code = 'stage-attempts', lease_token = null, lease_expires_at = null, updated_at = now()
    where public.af_generation_working(status) and stage_leases >= 3 and coalesce(lease_expires_at, '-infinity') < now();
  perform public.af_generation_host_lost();
  others := exists(select 1 from public.af_generation_hosts o where not o.official and o.accepts_any and public.af_generation_host_online(o)
    and public.af_generation_host_today(o.id) < o.daily_limit);
  -- The official host's claims go one at a time: two workers must not both take the day's last start.
  if h.official then perform pg_advisory_xact_lock(74280504); end if;
  room := not h.official or public.af_generation_official_wait() is null;
  select j.* into row from public.af_generation_jobs j
    where public.af_generation_working(j.status) and (j.lease_expires_at is null or j.lease_expires_at < now())
      and ((j.status = 'queued' and h.official)
        or (j.status <> 'queued' and (h.approved or (j.owner_id = h.owner_id and j.host_choice = 'host' and j.requested_host = h.id))
          and (j.assigned_host = h.id
            or (j.assigned_host is null and ((j.host_choice = 'oddbout' and h.official and (room or public.af_generation_is_admin(j.owner_id)))
              or (j.host_choice = 'host' and j.requested_host = h.id)
              or (j.host_choice = 'any' and h.accepts_any and (case when h.official then room else public.af_generation_host_today(h.id) < h.daily_limit end)
                and (not h.official or not others or j.updated_at < now() - interval '3 minutes')))))))
    order by public.af_generation_is_admin(j.owner_id) desc, j.updated_at, j.id limit 1 for update skip locked;
  if not found then return null; end if;
  update public.af_generation_jobs set lease_token = gen_random_uuid(), lease_expires_at = now() + interval '5 minutes', stage_leases = stage_leases + 1,
    assigned_host = case when status = 'queued' then assigned_host else coalesce(assigned_host, h.id) end,
    started_at = case when status = 'queued' then started_at else coalesce(started_at, now()) end
    where id = row.id returning * into row;
  insert into public.af_generation_events(job_id, kind, data) values (row.id, 'claimed',
    jsonb_build_object('status', row.status, 'lease', row.stage_leases, 'host', h.id));
  return row;
end $$;

revoke all on function public.af_generation_host_lost() from public, anon, authenticated;
grant execute on function public.af_generation_host_lost() to service_role;
