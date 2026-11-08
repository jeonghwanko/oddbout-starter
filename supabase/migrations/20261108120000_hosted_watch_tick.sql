-- A hosted wait's tick in one call (2026-11-08). get_hosted_fighter with waitSeconds reads every 3 seconds, up to about 21 seconds, what the
-- user sees of a job: its state, progress and submission, and while the motions are made its newest picture events. That was two queries
-- a tick (the job with its submission, then the events); this answers both. `p_events`: also the events whatever the state (the wait's
-- first tick). Null for a job that is not the owner's. Only the service role calls it (the hosted MCP); no row is changed.

create function public.af_hosted_watch_tick(p_owner uuid, p_job uuid, p_kinds text[], p_limit integer, p_events boolean default false)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', j.status,
    'progress', j.progress,
    'submission', s.status,
    'events', case when j.status = 'motions' or p_events then coalesce((
      select jsonb_agg(to_jsonb(e) order by e.at desc)
      from (select ev.id, ev.at, ev.kind, ev.data from public.af_generation_events ev
        where ev.job_id = j.id and ev.kind = any(p_kinds) order by ev.at desc limit greatest(p_limit, 0)) e), '[]'::jsonb)
    end)
  from public.af_generation_jobs j
  left join public.af_submissions s on s.id = j.submission_id
  where j.id = p_job and j.owner_id = p_owner;
$$;
revoke all on function public.af_hosted_watch_tick(uuid, uuid, text[], integer, boolean) from public, anon, authenticated;
grant execute on function public.af_hosted_watch_tick(uuid, uuid, text[], integer, boolean) to service_role;
