-- The hosted wait's tick takes a job's newest picture events by id (2026-11-08, review of 20261108121000). It took them by `at`, which
-- the index af_generation_events_job_kind (job_id, kind, id desc) cannot serve, and which events written in one transaction share:
-- with `limit` the newest id could be the one left out, and the wait would count a picture it had seen as new. `id` is the identity
-- column, so the newest event has the greatest id, the order is total, and the index walks it. Same signature, grants and result as before.

create or replace function public.af_hosted_watch_tick(p_owner uuid, p_job uuid, p_kinds text[], p_limit integer, p_events boolean default false)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', j.status,
    'progress', j.progress,
    'submission', s.status,
    'events', case when j.status = 'motions' or p_events then coalesce((
      select jsonb_agg(to_jsonb(e) order by e.id desc)
      from (select ev.id, ev.at, ev.kind, ev.data from public.af_generation_events ev
        where ev.job_id = j.id and ev.kind = any(p_kinds) order by ev.id desc limit greatest(p_limit, 0)) e), '[]'::jsonb)
    end)
  from public.af_generation_jobs j
  left join public.af_submissions s on s.id = j.submission_id
  where j.id = p_job and j.owner_id = p_owner;
$$;
revoke all on function public.af_hosted_watch_tick(uuid, uuid, text[], integer, boolean) from public, anon, authenticated;
grant execute on function public.af_hosted_watch_tick(uuid, uuid, text[], integer, boolean) to service_role;
