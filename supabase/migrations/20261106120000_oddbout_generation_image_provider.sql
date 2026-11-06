-- 그림 제공자 (1.1 제공자 프로필, 2026-11-06 — 사용자 결정 2026-11-05: 첫 대상은 SuperGrok만 있는 사람이고 그림도 Grok으로 뽑는다; ChatGPT가 있으면
-- GPT 그림을 옵션으로 고른다): a request names who draws its pictures, `grok` (the default) or `gpt`. The worker draws the fronts, the side
-- still, the expression sheet and the keypose rows with it (host/generation-stages.mjs IMAGE_PROFILES); the walk and run are Grok clips
-- either way, and the brief stays codex's on the official host.
-- Step 0 (2026-11-06, office-stable): Grok pictures took 2 of 3 fighters through unattended (GPT 1 of 3), with 4 retakes to GPT's 10.
--
-- - The jobs made before this were drawn by GPT: they keep `gpt` (a job GPT started never goes on in Grok). New jobs default to `grok`.
-- - What a host can draw, its worker says in each heartbeat (`worker_health.images`: `grok` with a grok login, `gpt` too with codex as well).
--   A host that says nothing of it (a worker from before this, or none yet) is not held back (af_generation_host_images): an older worker
--   draws every job with GPT, so the official PC's worker is updated (og self-update) before this migration is applied, and a job it claimed
--   before then says `gpt` as it was drawn.
-- - A request for GPT pictures on one named host (`mine` included) is refused unless that host's last health says it draws them, and on
--   `any` unless an online host that takes any request does (`image-provider-unavailable`). A request to ODDBOUT is not checked here: its
--   own PC draws both, and a request waits for it as before.
-- - A claim gives a host only a job whose pictures it draws, and the brief (`queued`, the official host's) only while its codex is ok. Before,
--   a worker claimed only with both logins ok; a SuperGrok-only PC now claims (host/generation-worker.mjs canWork), so the server keeps the
--   jobs that need codex from it.

alter table public.af_generation_jobs add column image_provider text not null default 'gpt' check (image_provider in ('grok', 'gpt'));
alter table public.af_generation_jobs alter column image_provider set default 'grok';

-- The image providers a host draws now, from its worker's last health: `images` as it sends it, else both (a worker before 1.1 says none).
create function public.af_generation_host_images(p_host public.af_generation_hosts) returns text[] language sql stable set search_path = '' as $$
  select case when jsonb_typeof(p_host.worker_health->'images') = 'array'
    then array(select x from jsonb_array_elements_text(p_host.worker_health->'images') x where x in ('grok', 'gpt'))
    else array['grok', 'gpt'] end;
$$;

-- A request's pictures: a known provider, and for a named host or `any` one that can draw them now. Run after af_generation_check (which
-- holds the named host's row) by af_generation_create, and by the API's request check.
create function public.af_generation_image_check(p_host_choice text default 'oddbout', p_host uuid default null, p_image_provider text default 'grok')
returns void language plpgsql stable security invoker set search_path = '' as $$
declare choice text := coalesce(p_host_choice, 'oddbout'); provider text := coalesce(p_image_provider, 'grok');
begin
  if provider not in ('grok', 'gpt') then raise exception 'invalid-image-provider'; end if;
  if choice = 'host' and not exists(select 1 from public.af_generation_hosts h where h.id = p_host
      and provider = any(public.af_generation_host_images(h))) then raise exception 'image-provider-unavailable'; end if;
  if choice = 'any' and not exists(select 1 from public.af_generation_hosts h where h.accepts_any and public.af_generation_host_online(h)
      and public.af_generation_host_today(h.id) < h.daily_limit and provider = any(public.af_generation_host_images(h)))
    then raise exception 'image-provider-unavailable'; end if;
end $$;

-- af_generation_create (20261103110000) with p_image_provider at the end. A new parameter is a new signature: the old one goes, so a call
-- by name finds one function; every older call (no provider) asks for Grok's pictures, the default.
drop function public.af_generation_create(uuid, uuid, text, text, uuid[], boolean, boolean, text, uuid, boolean, uuid);
create function public.af_generation_create(p_owner uuid, p_key uuid, p_description text, p_language text, p_refs uuid[], p_rights boolean,
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
  if found then return row; end if;
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

-- Restated whole from 20261105100000 with two conditions more: the brief (`queued`) not while the official host's last health says its codex
-- is not ok (a worker that judges with pixels claims without codex), and any other stage only to a host that draws the job's pictures
-- (af_generation_host_images).
create or replace function public.af_generation_claim_for(p_host uuid) returns public.af_generation_jobs
language plpgsql security invoker set search_path = '' as $$
declare row public.af_generation_jobs; h public.af_generation_hosts; others boolean; room boolean; images text[];
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
  images := public.af_generation_host_images(h);
  -- The official host's claims go one at a time: two workers must not both take the day's last start.
  if h.official then perform pg_advisory_xact_lock(74280504); end if;
  room := not h.official or public.af_generation_official_wait() is null;
  select j.* into row from public.af_generation_jobs j
    where public.af_generation_working(j.status) and (j.lease_expires_at is null or j.lease_expires_at < now())
      and ((j.status = 'queued' and h.official and coalesce((h.worker_health->>'codex')::boolean, true))
        or (j.status <> 'queued' and j.image_provider = any(images)
          and (h.approved or (j.owner_id = h.owner_id and j.host_choice = 'host' and j.requested_host = h.id))
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

revoke all on function public.af_generation_host_images(public.af_generation_hosts), public.af_generation_image_check(text, uuid, text),
  public.af_generation_create(uuid, uuid, text, text, uuid[], boolean, boolean, text, uuid, boolean, uuid, text) from public, anon, authenticated;
grant execute on function public.af_generation_host_images(public.af_generation_hosts), public.af_generation_image_check(text, uuid, text),
  public.af_generation_create(uuid, uuid, text, text, uuid[], boolean, boolean, text, uuid, boolean, uuid, text) to service_role;
