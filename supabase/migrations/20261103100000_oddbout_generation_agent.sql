-- Which agent asked for a hosted fighter (2026-11-03, site deep links): the site shows "Grok에서 신청" on a request, and the fighter's "made with"
-- label (af_fighter_agents) names the agent that asked for him. Only the cloud MCP knows its OAuth client; the API takes it from the verified
-- token (`agentClient`, as the workshop does) and never from a request body, so a request made on the site or by the kit has none.
-- The name is the client's own at dynamic registration, at most 40 characters, kept with the job as af_record_submission_agent keeps it.

alter table public.af_generation_jobs
  add column agent_client uuid,
  add column agent_name text check (agent_name is null or length(agent_name) between 1 and 40),
  add constraint af_generation_jobs_agent_pair check ((agent_client is null) = (agent_name is null));

-- A live, named client's name; null for an unknown, deleted or blank one. A function of its own: af_generation_create runs as its caller,
-- who has no read on the auth schema.
create function public.af_oauth_client_name(p_client uuid) returns text
language sql stable security definer set search_path = '' as $$
  select left(btrim(c.client_name), 40) from auth.oauth_clients c
  where c.id = p_client and c.deleted_at is null and length(btrim(coalesce(c.client_name, ''))) > 0;
$$;
revoke execute on function public.af_oauth_client_name(uuid) from public, anon, authenticated;
grant execute on function public.af_oauth_client_name(uuid) to service_role;

-- af_generation_create (20261030090000) with p_agent_client at the end. A new parameter is a new signature: the old one goes, so a call
-- by name finds one function; every older call (no agent) is the same call.
drop function public.af_generation_create(uuid, uuid, text, text, uuid[], boolean, boolean, text, uuid, boolean);
create function public.af_generation_create(p_owner uuid, p_key uuid, p_description text, p_language text, p_refs uuid[], p_rights boolean,
  p_delegate boolean default false, p_host_choice text default 'oddbout', p_host uuid default null, p_host_consent boolean default false,
  p_agent_client uuid default null)
returns public.af_generation_jobs language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs; refs uuid[] := coalesce(p_refs, '{}'); choice text := coalesce(p_host_choice, 'oddbout'); own boolean;
  agent text := case when p_agent_client is null then null else public.af_oauth_client_name(p_agent_client) end;
begin
  perform public.af_authorize(p_owner);
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 74280502));
  select * into row from public.af_generation_jobs where owner_id = p_owner and idempotency_key = p_key;
  if found then return row; end if;
  -- The host's row lock and the capacity lock it takes are held until this request is made.
  own := public.af_generation_check(p_owner, choice, p_host, p_host_consent);
  if cardinality(refs) > 2 or cardinality(refs) <> (select count(distinct x) from unnest(refs) x) then raise exception 'invalid-refs'; end if;
  if cardinality(refs) > 0 and not coalesce(p_rights, false) then raise exception 'rights-required'; end if;
  if (select count(*) from public.af_generation_uploads where id = any(refs) and owner_id = p_owner and job_id is null
      and created_at > now() - interval '1 day') <> cardinality(refs) then raise exception 'invalid-refs'; end if;
  insert into public.af_generation_jobs(owner_id, idempotency_key, description, language, refs_rights, delegate, host_choice, requested_host, host_consent,
      agent_client, agent_name)
    values (p_owner, p_key, btrim(p_description), p_language, cardinality(refs) > 0, coalesce(p_delegate, false), choice,
      case when choice = 'host' then p_host end, choice <> 'oddbout',
      case when agent is null then null else p_agent_client end, agent) returning * into row;
  update public.af_generation_uploads set job_id = row.id where id = any(refs);
  insert into public.af_generation_events(job_id, kind, data) values (row.id, 'created',
    jsonb_build_object('refs', cardinality(refs), 'delegate', coalesce(p_delegate, false), 'host', choice, 'own', own));
  return row;
end $$;
revoke all on function public.af_generation_create(uuid, uuid, text, text, uuid[], boolean, boolean, text, uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.af_generation_create(uuid, uuid, text, text, uuid[], boolean, boolean, text, uuid, boolean, uuid) to service_role;

-- The fighter's "made with": the submission the worker makes for a job takes the job's agent, in the transaction that makes it. The worker's
-- submission is keyed by the job's id (api/generations.mjs); a fighter's maker is his earliest recorded submission's agent (af_fighter_agents).
-- A label, not a gate: nothing here may fail the submission.
create function public.af_job_submission_agent() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    insert into public.af_submission_agents(submission_id, client_id, client_name)
    select new.id, j.agent_client, j.agent_name from public.af_generation_jobs j
    where j.id = new.idempotency_key and j.owner_id = new.owner_id and j.agent_client is not null
    on conflict (submission_id) do nothing;
  exception when others then null;
  end;
  return null;
end $$;
revoke execute on function public.af_job_submission_agent() from public, anon, authenticated;
create trigger af_job_submission_agent after insert on public.af_submissions
  for each row execute function public.af_job_submission_agent();
