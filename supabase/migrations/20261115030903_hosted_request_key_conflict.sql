-- A request key names one request (2026-11-15). af_generation_create gave back the job a key already named whatever the request said, so a
-- caller that reused a key for another description, language, delegate, host or image provider was told its request was made. Hosted work
-- spends the account's tokens, and the other keyed writes refuse a changed request (af_create_submission, a profile set): this one now does
-- too, with `idempotency-conflict` (409), before the service's checks, the host lock and any write to a job (af_authorize and the owner's
-- lock come first, as on every call, so a retry counts in his minute's requests). The same request still gets its job back, whatever the
-- service switch, the day's limits or his balance say now (a retry after a lost answer; the cloud MCP sends a saved key's request here too).
--
-- The job row is the request's record: each compared column holds its input as the first write normalised it, so nothing new is stored and
-- a job made before this migration compares the same way.
-- - description: btrim(p_description) (the API trims it and joins its line ends before, api/canon.mjs text).
-- - language as sent; delegate: coalesce(p_delegate, false); host_choice: coalesce(p_host_choice, 'oddbout'); requested_host: p_host for a
--   named host only (the API's `mine` is his own host's id, as the first write stored it).
-- - image_provider: coalesce(p_image_provider, 'grok'), for the jobs whose `created` event names `images` (made since
--   20261106120000). The jobs before it hold `gpt`, written by that migration for requests that named no provider: theirs is not compared.
-- Not compared:
-- - The reference pictures. A request names upload ids made before it, and the server keeps no hash of their bytes; an honest retry can
--   upload again under new ids (the cloud MCP downloads and uploads attached files on each call until the first request is saved). A retry
--   with other or no pictures gets the job back; its own uploads stay unused, as before.
-- - p_rights and p_host_consent: permissions the first write checked, not what the job makes (refs_rights and host_consent are derived).
-- - What the server derives: the agent's client (the cloud MCP's verified token), the checks' results (capacity, the host that takes it).
create or replace function public.af_generation_create(p_owner uuid, p_key uuid, p_description text, p_language text, p_refs uuid[], p_rights boolean,
  p_delegate boolean default false, p_host_choice text default 'oddbout', p_host uuid default null, p_host_consent boolean default false,
  p_agent_client uuid default null, p_image_provider text default 'grok')
returns public.af_generation_jobs language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs; refs uuid[] := coalesce(p_refs, '{}'); choice text := coalesce(p_host_choice, 'oddbout'); own boolean;
  agent text := case when p_agent_client is null then null else public.af_oauth_client_name(p_agent_client) end;
  provider text := coalesce(p_image_provider, 'grok');
begin
  perform public.af_authorize(p_owner);
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 74280502));
  select * into row from public.af_generation_jobs where owner_id = p_owner and idempotency_key = p_key;
  if found then
    if row.description is distinct from btrim(p_description) or row.language is distinct from p_language
        or row.delegate is distinct from coalesce(p_delegate, false) or row.host_choice is distinct from choice
        or row.requested_host is distinct from (case when choice = 'host' then p_host end)
        or (row.image_provider is distinct from provider
          and exists(select 1 from public.af_generation_events e where e.job_id = row.id and e.kind = 'created' and e.data ? 'images'))
      then raise exception 'idempotency-conflict'; end if;
    return row;
  end if;
  -- The host's row lock and the capacity lock it takes are held until this request is made.
  own := public.af_generation_check(p_owner, choice, p_host, p_host_consent);
  perform public.af_generation_image_check(choice, p_host, provider);
  if cardinality(refs) > 2 or cardinality(refs) <> (select count(distinct x) from unnest(refs) x) then raise exception 'invalid-refs'; end if;
  if cardinality(refs) > 0 and not coalesce(p_rights, false) then raise exception 'rights-required'; end if;
  if (select count(*) from public.af_generation_uploads where id = any(refs) and owner_id = p_owner and job_id is null
      and created_at > now() - interval '1 day') <> cardinality(refs) then raise exception 'invalid-refs'; end if;
  insert into public.af_generation_jobs(owner_id, idempotency_key, description, language, refs_rights, delegate, host_choice, requested_host, host_consent,
      agent_client, agent_name, image_provider)
    values (p_owner, p_key, btrim(p_description), p_language, cardinality(refs) > 0, coalesce(p_delegate, false), choice,
      case when choice = 'host' then p_host end, choice <> 'oddbout',
      case when agent is null then null else p_agent_client end, agent, provider) returning * into row;
  update public.af_generation_uploads set job_id = row.id where id = any(refs);
  insert into public.af_generation_events(job_id, kind, data) values (row.id, 'created',
    jsonb_build_object('refs', cardinality(refs), 'delegate', coalesce(p_delegate, false), 'host', choice, 'own', own, 'images', provider));
  return row;
end $$;

revoke all on function public.af_generation_create(uuid, uuid, text, text, uuid[], boolean, boolean, text, uuid, boolean, uuid, text)
  from public, anon, authenticated;
grant execute on function public.af_generation_create(uuid, uuid, text, text, uuid[], boolean, boolean, text, uuid, boolean, uuid, text) to service_role;
