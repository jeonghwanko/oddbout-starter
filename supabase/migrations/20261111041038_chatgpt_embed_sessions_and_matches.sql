-- Opt-in ChatGPT practice. No writes to af_duels, reward ledgers or notification outboxes.
-- Launch and session bearer values never enter the database; only their SHA-256 hashes do.
create table public.af_embed_grants (
  grant_hash text primary key check (grant_hash ~ '^[a-f0-9]{64}$'),
  owner_id uuid not null references auth.users(id) on delete cascade,
  oauth_session uuid not null,
  oauth_client uuid not null,
  attempt_id uuid not null,
  challenge text not null check (challenge ~ '^[A-Za-z0-9_-]{43}$'),
  game_origin text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '60 seconds',
  consumed_at timestamptz,
  revoked_at timestamptz
);
create index af_embed_grants_owner on public.af_embed_grants(owner_id, created_at desc);
create table public.af_embed_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  owner_id uuid not null references auth.users(id) on delete cascade,
  oauth_session uuid not null,
  oauth_client uuid not null,
  attempt_id uuid not null,
  game_origin text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  revoked_at timestamptz
);
create index af_embed_sessions_owner on public.af_embed_sessions(owner_id, attempt_id);
create table public.af_embed_matches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_key uuid not null,
  a uuid not null references public.af_fighters(id),
  b uuid not null references public.af_fighters(id),
  hash_a text not null check (hash_a ~ '^[a-f0-9]{64}$'),
  hash_b text not null check (hash_b ~ '^[a-f0-9]{64}$'),
  engine text not null check (engine ~ '^[a-z0-9][a-z0-9.-]{0,63}$'),
  seed bigint not null check (seed between 0 and 4294967295),
  run_attempts integer not null default 1 check (run_attempts between 1 and 5),
  last_run_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  result jsonb,
  unique(owner_id, request_key),
  check(a <> b),
  check((result is null) = (completed_at is null))
);
create index af_embed_matches_owner on public.af_embed_matches(owner_id, created_at desc, id);
alter table public.af_embed_grants enable row level security;
alter table public.af_embed_sessions enable row level security;
alter table public.af_embed_matches enable row level security;
revoke all on public.af_embed_grants, public.af_embed_sessions, public.af_embed_matches from public, anon, authenticated, service_role;

-- Consent revocation, logout, account disable/ban/deletion stop every embed request, including result completion.
create function public.af_embed_connection_active(p_owner uuid, p_session uuid, p_client uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.af_mcp_session_active(p_owner,p_session,p_client)
    and exists(select 1 from auth.users u where u.id=p_owner and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()))
    and not exists(select 1 from public.af_creators c where c.owner_id=p_owner and not c.enabled)
$$;
create function public.af_embed_issue_grant(p_owner uuid, p_session uuid, p_client uuid, p_attempt uuid, p_challenge text, p_origin text, p_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare expires timestamptz := now()+interval '60 seconds';
begin
  if not public.af_embed_connection_active(p_owner,p_session,p_client) then raise exception 'authentication-required'; end if;
  if p_attempt is null or p_challenge is null or p_challenge !~ '^[A-Za-z0-9_-]{43}$'
    or p_origin is null or p_origin !~ '^https://[^/?#@[:space:]]+$'
    or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid-launch'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 193402020));
  if (select count(*) from public.af_embed_grants where owner_id=p_owner and created_at>now()-interval '1 minute')>=10
    then raise exception 'rate-limit'; end if;
  -- Reissuing this browser attempt invalidates its previous grant and credential. Issuance never starts a match.
  update public.af_embed_grants set revoked_at=now() where owner_id=p_owner and attempt_id=p_attempt and revoked_at is null;
  update public.af_embed_sessions set revoked_at=now() where owner_id=p_owner and attempt_id=p_attempt and revoked_at is null;
  insert into public.af_embed_grants(grant_hash,owner_id,oauth_session,oauth_client,attempt_id,challenge,game_origin,expires_at)
    values(p_hash,p_owner,p_session,p_client,p_attempt,p_challenge,p_origin,expires);
  return jsonb_build_object('expiresAt',expires);
end $$;

create function public.af_embed_exchange(p_hash text, p_challenge text, p_attempt uuid, p_origin text, p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.af_embed_grants; expires timestamptz := now()+interval '15 minutes';
begin
  -- A row lock consumes one grant exactly once, even across simultaneous Edge instances.
  select * into g from public.af_embed_grants where grant_hash=p_hash for update;
  if not found or g.consumed_at is not null or g.revoked_at is not null or g.expires_at<=now()
    or g.challenge is distinct from p_challenge or g.attempt_id is distinct from p_attempt or g.game_origin is distinct from p_origin
    then raise exception 'invalid-grant'; end if;
  if not public.af_embed_connection_active(g.owner_id,g.oauth_session,g.oauth_client) then raise exception 'authentication-required'; end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid-grant'; end if;
  update public.af_embed_grants set consumed_at=now() where grant_hash=p_hash;
  insert into public.af_embed_sessions(token_hash,owner_id,oauth_session,oauth_client,attempt_id,game_origin,expires_at)
    values(p_token_hash,g.owner_id,g.oauth_session,g.oauth_client,g.attempt_id,g.game_origin,expires);
  return jsonb_build_object('expiresAt',expires,'account',jsonb_build_object('id',g.owner_id,
    'name',coalesce((select nickname from public.af_creator_names where user_id=g.owner_id),'ODDBOUT 플레이어')));
end $$;

-- Internal helper. It cannot authenticate to another route or mint a web/OAuth token.
create function public.af_embed_session(p_token_hash text, p_origin text)
returns public.af_embed_sessions language plpgsql security definer set search_path='' as $$
declare s public.af_embed_sessions;
begin
  select * into s from public.af_embed_sessions where token_hash=p_token_hash;
  if not found or s.revoked_at is not null or s.expires_at<=now() or s.game_origin is distinct from p_origin
    then raise exception 'authentication-required'; end if;
  if not public.af_embed_connection_active(s.owner_id,s.oauth_session,s.oauth_client) then raise exception 'authentication-required'; end if;
  return s;
end $$;
create function public.af_embed_revoke_session(p_token_hash text, p_origin text)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.af_embed_sessions;
begin
  s:=public.af_embed_session(p_token_hash,p_origin);
  update public.af_embed_sessions set revoked_at=now() where token_hash=s.token_hash;
  return true;
end $$;
create function public.af_embed_fighters(p_token_hash text, p_origin text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.af_embed_sessions;
begin
  s:=public.af_embed_session(p_token_hash,p_origin);
  return coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'name',f.profile->>'name',
    'manifestSha256',f.manifest_sha,'owned',f.owner_id=s.owner_id) order by (f.owner_id=s.owner_id) desc,f.created_at,f.id)
    from (select f.* from public.af_fighters f where public.af_duel_admitted(f)
      and f.runtime_manifest_sha is not distinct from f.manifest_sha and f.deleted_at is null
      order by (f.owner_id=s.owner_id) desc,f.created_at,f.id limit 200) f),'[]'::jsonb);
end $$;
create function public.af_embed_matches(p_token_hash text, p_origin text, p_id uuid default null)
returns setof public.af_embed_matches language plpgsql security definer set search_path='' as $$
declare s public.af_embed_sessions;
begin
  s:=public.af_embed_session(p_token_hash,p_origin);
  return query select m.* from public.af_embed_matches m where m.owner_id=s.owner_id and (p_id is null or m.id=p_id)
    order by m.created_at desc,m.id limit 20;
end $$;
create function public.af_embed_reserve_match(p_token_hash text, p_origin text, p_key uuid, p_a uuid, p_b uuid, p_hash_a text, p_hash_b text, p_engine text)
returns public.af_embed_matches language plpgsql security definer set search_path='' as $$
declare s public.af_embed_sessions; r public.af_embed_matches; fa public.af_fighters; fb public.af_fighters;
  today timestamptz := date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
begin
  s:=public.af_embed_session(p_token_hash,p_origin);
  -- Serialize account keys and private budgets. No guest/ranked match budget is consumed.
  perform pg_advisory_xact_lock(193402021);
  select * into r from public.af_embed_matches where owner_id=s.owner_id and request_key=p_key;
  if found then
    if r.a is distinct from p_a or r.b is distinct from p_b or r.hash_a is distinct from p_hash_a
      or r.hash_b is distinct from p_hash_b or r.engine is distinct from p_engine then raise exception 'idempotency-conflict'; end if;
    if r.result is not null then return r; end if;
  end if;
  if p_key is null or p_a is null or p_b is null or p_a=p_b or p_hash_a is null or p_hash_b is null
    or p_hash_a !~ '^[a-f0-9]{64}$' or p_hash_b !~ '^[a-f0-9]{64}$'
    or p_engine is null or p_engine !~ '^[a-z0-9][a-z0-9.-]{0,63}$' then raise exception 'invalid-match'; end if;
  if exists(select 1 from public.af_settings where paused) then raise exception 'duels-paused'; end if;
  select * into fa from public.af_fighters where id=p_a for share;
  select * into fb from public.af_fighters where id=p_b for share;
  if not public.af_duel_admitted(fa) or not public.af_duel_admitted(fb) or fa.deleted_at is not null or fb.deleted_at is not null
    or fa.manifest_sha is distinct from p_hash_a or fb.manifest_sha is distinct from p_hash_b
    or fa.runtime_manifest_sha is distinct from p_hash_a or fb.runtime_manifest_sha is distinct from p_hash_b
    then raise exception 'duel-not-approved'; end if;
  if r.id is not null then
    -- One worker at a time within thirty seconds. Killed or failed runs may resume, at most five runs per immutable input.
    if r.last_run_at>now()-interval '30 seconds' then raise exception 'match-busy'; end if;
    if r.run_attempts>=5 then raise exception 'embed-budget'; end if;
    update public.af_embed_matches set run_attempts=run_attempts+1,last_run_at=now() where id=r.id returning * into r;
    return r;
  end if;
  if (select count(*) from public.af_embed_matches where owner_id=s.owner_id and created_at>=today)>=20
    or (select count(*) from public.af_embed_matches where owner_id=s.owner_id and result is null and created_at>now()-interval '5 minutes')>=3
    or (select count(*) from public.af_embed_matches where created_at>=today)>=100
    or (select count(*) from public.af_embed_matches)>=10000 then raise exception 'embed-budget'; end if;
  insert into public.af_embed_matches(owner_id,request_key,a,b,hash_a,hash_b,engine,seed)
    values(s.owner_id,p_key,p_a,p_b,p_hash_a,p_hash_b,p_engine,
      ('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint) returning * into r;
  return r;
end $$;
create function public.af_embed_complete_match(p_token_hash text, p_origin text, p_id uuid, p_engine text, p_result jsonb)
returns public.af_embed_matches language plpgsql security definer set search_path='' as $$
declare s public.af_embed_sessions; r public.af_embed_matches;
begin
  s:=public.af_embed_session(p_token_hash,p_origin);
  select * into r from public.af_embed_matches where id=p_id and owner_id=s.owner_id for update;
  if not found then raise exception 'not-found'; end if;
  if r.engine is distinct from p_engine then raise exception 'engine-mismatch'; end if;
  if r.result is not null then
    if r.result is distinct from p_result then raise exception 'result-conflict'; end if;
    return r;
  end if;
  if p_result is null or jsonb_typeof(p_result)<>'object' or not (p_result ?& array['winner','how','ms','hp','contacts','digest'])
    or p_result->>'winner' not in ('0','1') or p_result->>'how' not in ('ko','decision')
    or not (p_result->>'digest' ~ '^[a-f0-9]{8}$')
    or (p_result->>'ms')::numeric not between 1 and 90000
    or jsonb_array_length(p_result->'hp')<>2 or jsonb_array_length(p_result->'contacts')<>2 then raise exception 'invalid-result'; end if;
  if (select count(*) from public.af_fighters f where ((f.id=r.a and f.manifest_sha=r.hash_a) or (f.id=r.b and f.manifest_sha=r.hash_b))
    and public.af_duel_admitted(f) and f.runtime_manifest_sha=f.manifest_sha and f.deleted_at is null)<>2
    then raise exception 'duel-not-approved'; end if;
  update public.af_embed_matches set result=p_result,completed_at=now() where id=r.id returning * into r;
  return r;
end $$;

revoke all on function public.af_embed_connection_active(uuid,uuid,uuid),public.af_embed_session(text,text),
  public.af_embed_issue_grant(uuid,uuid,uuid,uuid,text,text,text),public.af_embed_exchange(text,text,uuid,text,text),
  public.af_embed_revoke_session(text,text),public.af_embed_fighters(text,text),public.af_embed_matches(text,text,uuid),
  public.af_embed_reserve_match(text,text,uuid,uuid,uuid,text,text,text),public.af_embed_complete_match(text,text,uuid,text,jsonb)
  from public,anon,authenticated,service_role;
-- Helpers have no API privilege. Only these narrowly scoped RPCs are exposed to the Edge service.
grant execute on function public.af_embed_issue_grant(uuid,uuid,uuid,uuid,text,text,text),public.af_embed_exchange(text,text,uuid,text,text),
  public.af_embed_revoke_session(text,text),public.af_embed_fighters(text,text),public.af_embed_matches(text,text,uuid),
  public.af_embed_reserve_match(text,text,uuid,uuid,uuid,text,text,text),public.af_embed_complete_match(text,text,uuid,text,jsonb)
  to service_role;
