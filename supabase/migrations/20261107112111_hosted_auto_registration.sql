-- Hosted creation finishes in production without a user motion-approval gate.
-- Restates the existing finish function; keeps leases, charging and failure handling.
-- Existing motion_ready jobs are untouched and can use the owner-scoped register route.
create or replace function public.af_generation_finish(p_id uuid, p_token uuid, p_outcome text, p_result jsonb)
returns public.af_generation_jobs language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs := public.af_generation_held(p_id, p_token); result jsonb := coalesce(p_result, '{}'::jsonb);
begin
  if p_outcome = 'retry' then
    update public.af_generation_jobs set lease_token = null, lease_expires_at = now() + interval '2 minutes', updated_at = now() where id = p_id returning * into row;
  elsif p_outcome = 'ok' and row.status = 'queued' then
    if jsonb_typeof(result->'brief') <> 'object' then raise exception 'invalid-result'; end if;
    update public.af_generation_jobs set brief = result->'brief', status = 'appearance', progress = 0, stage_leases = 0, lease_token = null,
      lease_expires_at = null, updated_at = now() where id = p_id returning * into row;
  elsif p_outcome = 'ok' and row.status = 'appearance' then
    if jsonb_typeof(result->'candidates') <> 'array' or jsonb_array_length(result->'candidates') <> 2 then raise exception 'invalid-result'; end if;
    -- A pick only for a job its creator left to us; then the motions start without waiting for him.
    if result ? 'choice' and not (row.delegate and coalesce(result->>'choice', '') in ('a', 'b')) then raise exception 'invalid-result'; end if;
    if result ? 'choice' then
      update public.af_generation_jobs set candidates = result->'candidates', choice = result->>'choice', appearance_note = null, status = 'motions',
        waiting_since = null, progress = 0, stage_leases = 0, lease_token = null, lease_expires_at = null, charged_at = coalesce(charged_at, now()),
        updated_at = now() where id = p_id returning * into row;
    else
      update public.af_generation_jobs set candidates = result->'candidates', choice = null, appearance_note = null, status = 'appearance_ready',
        waiting_since = now(), progress = 100, stage_leases = 0, lease_token = null, lease_expires_at = null, charged_at = coalesce(charged_at, now()),
        updated_at = now() where id = p_id returning * into row;
    end if;
  elsif p_outcome = 'ok' and row.status = 'motions' then
    if jsonb_typeof(result->'preview') <> 'array' or jsonb_array_length(result->'preview') < 1 then raise exception 'invalid-result'; end if;
    update public.af_generation_jobs set preview = result->'preview', motion_note = null, status = 'motion_ready', waiting_since = now(), progress = 100,
      stage_leases = 0, lease_token = null, lease_expires_at = null, updated_at = now() where id = p_id returning * into row;
  elsif p_outcome = 'ok' and row.status = 'submitting' then
    if not exists(select 1 from public.af_submissions where id = (result->>'submissionId')::uuid and owner_id = row.owner_id) then raise exception 'invalid-result'; end if;
    update public.af_generation_jobs set submission_id = (result->>'submissionId')::uuid, status = 'submitted', progress = 100, stage_leases = 0,
      lease_token = null, lease_expires_at = null, updated_at = now() where id = p_id returning * into row;
  elsif p_outcome = 'rejected' and row.status = 'queued' then
    update public.af_generation_jobs set status = 'rejected', error_code = left(coalesce(result->>'code', 'unsafe'), 64), lease_token = null,
      lease_expires_at = null, updated_at = now() where id = p_id returning * into row;
  elsif p_outcome in ('failed', 'review') then
    update public.af_generation_jobs set status = case when p_outcome = 'failed' then 'failed' else 'needs_review' end,
      error_code = left(coalesce(result->>'code', p_outcome), 64), lease_token = null, lease_expires_at = null, updated_at = now() where id = p_id returning * into row;
  else raise exception 'invalid-result'; end if;
  -- Registration is part of hosted creation. Commit completion and its registration queue in one transaction.
  -- The worker's existing submitting stage still packages and validates; this never enters the fighter.
  if row.status = 'motion_ready' and p_outcome = 'ok' then
    begin
      if jsonb_typeof(coalesce(row.profile, row.brief->'profile')) is distinct from 'object'
        or btrim(coalesce(coalesce(row.profile, row.brief->'profile')->>'name', '')) = ''
        or btrim(coalesce(coalesce(row.profile, row.brief->'profile')->>'description', '')) = '' then
        raise exception 'invalid-profile';
      end if;
      row := public.af_generation_register(row.owner_id, row.id,
        (select jsonb_object_agg(key, value) from jsonb_each(coalesce(row.profile, row.brief->'profile'))
          where key in ('name', 'description', 'names', 'lines', 'stats') and value <> 'null'::jsonb));
    exception when sqlstate 'P0001' then
      -- Preserve finished art when quota/account/profile needs attention; no regeneration or lost result.
      update public.af_generation_jobs set status = 'needs_review', error_code = left(sqlerrm, 64),
        waiting_since = null, updated_at = now() where id = p_id returning * into row;
    end;
  end if;
  insert into public.af_generation_events(job_id, kind, data) values (p_id, 'finished',
    jsonb_build_object('outcome', p_outcome, 'status', row.status, 'code', result->>'code', 'calls', result->'calls', 'choice', result->>'choice'));
  return row;
end $$;
