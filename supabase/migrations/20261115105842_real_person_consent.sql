-- Consented private likeness (2026-11-15). The brief refuses every real person with reject code real-person: a photo, a named
-- person, a celebrity and a politician are that one check (host/generation-prompts.mjs briefPrompt). A requester can now confirm
-- that the private person in their own uploaded photo, or a parent or guardian when that person is a minor, consented to a fighter.
-- The flag is the job's real_person_consent and the created event's realPersonConsent. Absent or false stays the old refusal.
-- The brief still refuses celebrities, politicians and other public figures, and sexualized or demeaning depictions, including any
-- sexualization of a minor. Those decisions stay in the brief; this column only records what the requester confirmed.
--
-- af_generation_create (20261115030903) with p_real_person_consent at the end. A new parameter is a new signature: the old one goes,
-- so a call by name finds one function. An older call that omits it stores false, and a retry of a job from before this column
-- (backfilled false) still matches. The flag is part of the request, so a key reused with the other value is idempotency-conflict.

alter table public.af_generation_jobs add column real_person_consent boolean not null default false;

drop function public.af_generation_create(uuid, uuid, text, text, uuid[], boolean, boolean, text, uuid, boolean, uuid, text);
create function public.af_generation_create(p_owner uuid, p_key uuid, p_description text, p_language text, p_refs uuid[], p_rights boolean,
  p_delegate boolean default false, p_host_choice text default 'oddbout', p_host uuid default null, p_host_consent boolean default false,
  p_agent_client uuid default null, p_image_provider text default 'grok', p_real_person_consent boolean default false)
returns public.af_generation_jobs language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs; refs uuid[] := coalesce(p_refs, '{}'); choice text := coalesce(p_host_choice, 'oddbout'); own boolean;
  agent text := case when p_agent_client is null then null else public.af_oauth_client_name(p_agent_client) end;
  provider text := coalesce(p_image_provider, 'grok');
  consent boolean := coalesce(p_real_person_consent, false);
begin
  perform public.af_authorize(p_owner);
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 74280502));
  select * into row from public.af_generation_jobs where owner_id = p_owner and idempotency_key = p_key;
  if found then
    if row.description is distinct from btrim(p_description) or row.language is distinct from p_language
        or row.delegate is distinct from coalesce(p_delegate, false) or row.host_choice is distinct from choice
        or row.requested_host is distinct from (case when choice = 'host' then p_host end)
        or row.real_person_consent is distinct from consent
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
      agent_client, agent_name, image_provider, real_person_consent)
    values (p_owner, p_key, btrim(p_description), p_language, cardinality(refs) > 0, coalesce(p_delegate, false), choice,
      case when choice = 'host' then p_host end, choice <> 'oddbout',
      case when agent is null then null else p_agent_client end, agent, provider, consent) returning * into row;
  update public.af_generation_uploads set job_id = row.id where id = any(refs);
  insert into public.af_generation_events(job_id, kind, data) values (row.id, 'created',
    jsonb_build_object('refs', cardinality(refs), 'delegate', coalesce(p_delegate, false), 'host', choice, 'own', own, 'images', provider,
      'realPersonConsent', consent));
  return row;
end $$;

revoke all on function public.af_generation_create(uuid, uuid, text, text, uuid[], boolean, boolean, text, uuid, boolean, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.af_generation_create(uuid, uuid, text, text, uuid[], boolean, boolean, text, uuid, boolean, uuid, text, boolean)
  to service_role;
