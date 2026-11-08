-- A job's view reads its events of a few kinds, newest first (drafts, side, expressions, the appearance choice); the list of a
-- creator's jobs reads them for all its jobs in one query (리뷰 2026-11-08). The (job_id, at) index finds a job's events but then
-- filters every stage and provider event by kind; this one goes straight to the kinds read.
-- No row is changed. The table takes a short write lock while the index builds.

create index if not exists af_generation_events_job_kind on public.af_generation_events(job_id, kind, id desc);
