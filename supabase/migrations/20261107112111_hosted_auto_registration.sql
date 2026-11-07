-- Hosted creation finishes in production without a user motion-approval gate.
-- Restates the existing finish function; keeps leases, charging and failure handling.
-- Existing motion_ready jobs are untouched and can use the owner-scoped register route.
-- Minimal typed draft for both automatic and operator recovery. The existing package validator
-- remains authoritative for all text limits, names, lines and combat stats before registration.
create function public.af_generation_registration_draft(p_job public.af_generation_jobs) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare draft jsonb := coalesce(p_job.profile, p_job.brief->'profile');
begin
  if jsonb_typeof(draft) is distinct from 'object'
    or jsonb_typeof(draft->'name') is distinct from 'string'
    or jsonb_typeof(draft->'description') is distinct from 'string'
    or btrim(coalesce(draft->>'name', '')) = '' or btrim(coalesce(draft->>'description', '')) = '' then
    raise exception 'invalid-profile';
  end if;
  return (select jsonb_object_agg(key, value) from jsonb_each(draft)
    where key in ('name', 'description', 'names', 'lines', 'stats') and value <> 'null'::jsonb);
end $$;
revoke all on function public.af_generation_registration_draft(public.af_generation_jobs) from public, anon, authenticated;
grant execute on function public.af_generation_registration_draft(public.af_generation_jobs) to service_role;

create or replace function public.af_generation_finish(p_id uuid, p_token uuid, p_outcome text, p_result jsonb)
returns public.af_generation_jobs language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs := public.af_generation_held(p_id, p_token); result jsonb := coalesce(p_result, '{}'::jsonb);
  registration_blocked boolean := false;
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
    if jsonb_typeof(result->'preview') is distinct from 'array' or jsonb_array_length(result->'preview') < 1 then raise exception 'invalid-result'; end if;
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
      row := public.af_generation_register(row.owner_id, row.id, public.af_generation_registration_draft(row));
    exception when sqlstate 'P0001' then
      -- Preserve finished art when quota/account/profile needs attention; no regeneration or lost result.
      update public.af_generation_jobs set status = 'needs_review', error_code = left(sqlerrm, 64),
        waiting_since = null, updated_at = now() where id = p_id returning * into row;
      registration_blocked := true;
    end;
  end if;
  insert into public.af_generation_events(job_id, kind, data) values (p_id, 'finished',
    jsonb_build_object('outcome', p_outcome, 'status', row.status,
      'code', case when registration_blocked then row.error_code else result->>'code' end,
      'registrationBlocked', registration_blocked, 'calls', result->'calls', 'choice', result->>'choice'));
  return row;
end $$;

-- A completed motion stage may now stop at registration admission, without row.profile ever
-- being set. The former retry inferred 'motions' from that null and could regenerate paid art.
-- The latest finished event identifies this stop until a later register event consumes it.
-- A subsequent submitting-host failure resumes submission without redoing admission.
create or replace function public.af_admin_generation_retry(p_actor uuid, p_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare j public.af_generation_jobs; next text; blocked boolean;
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  select * into j from public.af_generation_jobs where id = p_id for update;
  if not found then raise exception 'not-found'; end if;
  if j.status <> 'needs_review' then raise exception 'review-conflict'; end if;
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
