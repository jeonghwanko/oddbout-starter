-- Keep registered and built-in practice in one private ledger, including retries and all budgets.
-- Existing rows remain registered; historical rows survive removal of a fighter package.
alter table public.af_embed_matches
  drop constraint af_embed_matches_a_fkey,
  drop constraint af_embed_matches_b_fkey,
  alter column a type text using a::text,
  alter column b type text using b::text,
  add column mode text not null default 'registered' check (mode in ('registered','official'));
alter table public.af_embed_matches add constraint af_embed_matches_mode_ids check (
  (mode='registered' and a ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and b ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  or (mode='official' and length(a)<=64 and length(b)<=64
    and a ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and b ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
    and a !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and b !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);

-- The service supplies this catalog from its bundled engine adapter, never from the HTTP request.
-- This internal helper has no API grant and cannot mint credentials, reserve rows or write results.
create function public.af_embed_official_admitted(p_a text,p_b text,p_hash_a text,p_hash_b text,p_engine text,p_official jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_official is null or jsonb_typeof(p_official)<>'object' or p_official->>'engine' is distinct from p_engine
    or jsonb_typeof(p_official->'fighters') is distinct from 'array' then raise exception 'engine-mismatch'; end if;
  if p_a is null or p_b is null or p_a=p_b or length(p_a)>64 or length(p_b)>64
    or p_a !~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' or p_b !~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
    or p_a ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_b ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then raise exception 'invalid-match'; end if;
  if (select count(*) from jsonb_array_elements(p_official->'fighters') f where f->>'id'=p_a and f->>'manifestSha256'=p_hash_a)<>1
    or (select count(*) from jsonb_array_elements(p_official->'fighters') f where f->>'id'=p_b and f->>'manifestSha256'=p_hash_b)<>1
    then raise exception 'duel-not-approved'; end if;
end $$;
revoke all on function public.af_embed_official_admitted(text,text,text,text,text,jsonb) from public,anon,authenticated,service_role;

-- Replace, rather than overload, the public RPC signatures. Optional parameters keep registered callers compatible.
drop function public.af_embed_reserve_match(text,text,uuid,uuid,uuid,text,text,text);
drop function public.af_embed_complete_match(text,text,uuid,text,jsonb);
create function public.af_embed_reserve_match(p_token_hash text, p_origin text, p_key uuid, p_a text, p_b text, p_hash_a text, p_hash_b text, p_engine text,
  p_mode text default 'registered', p_official jsonb default null)
returns public.af_embed_matches language plpgsql security definer set search_path='' as $$
declare s public.af_embed_sessions; r public.af_embed_matches; fa public.af_fighters; fb public.af_fighters;
  today timestamptz := date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
begin
  s:=public.af_embed_session(p_token_hash,p_origin);
  -- Serialize account keys and private budgets. No guest/ranked match budget is consumed.
  perform pg_advisory_xact_lock(193402021);
  select * into r from public.af_embed_matches where owner_id=s.owner_id and request_key=p_key;
  if found then
    if r.mode is distinct from p_mode or r.a is distinct from p_a or r.b is distinct from p_b or r.hash_a is distinct from p_hash_a
      or r.hash_b is distinct from p_hash_b or r.engine is distinct from p_engine then raise exception 'idempotency-conflict'; end if;
    if r.result is not null then return r; end if;
  end if;
  if p_mode is null or p_mode not in ('registered','official') or p_key is null or p_a is null or p_b is null or p_a=p_b or p_hash_a is null or p_hash_b is null
    or p_hash_a !~ '^[a-f0-9]{64}$' or p_hash_b !~ '^[a-f0-9]{64}$'
    or p_engine is null or p_engine !~ '^[a-z0-9][a-z0-9.-]{0,63}$' then raise exception 'invalid-match'; end if;
  if exists(select 1 from public.af_settings where paused) then raise exception 'duels-paused'; end if;
  if p_mode='registered' then
    -- Validate the UUID spelling before casting; official slugs must never reach registered admission.
    if p_a !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or p_b !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'invalid-match'; end if;
    select * into fa from public.af_fighters where id=p_a::uuid for share;
    select * into fb from public.af_fighters where id=p_b::uuid for share;
    if not public.af_duel_admitted(fa) or not public.af_duel_admitted(fb) or fa.deleted_at is not null or fb.deleted_at is not null
      or fa.manifest_sha is distinct from p_hash_a or fb.manifest_sha is distinct from p_hash_b
      or fa.runtime_manifest_sha is distinct from p_hash_a or fb.runtime_manifest_sha is distinct from p_hash_b
      then raise exception 'duel-not-approved'; end if;
  else
    perform public.af_embed_official_admitted(p_a,p_b,p_hash_a,p_hash_b,p_engine,p_official);
  end if;
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
  insert into public.af_embed_matches(owner_id,request_key,a,b,hash_a,hash_b,engine,seed,mode)
    values(s.owner_id,p_key,p_a,p_b,p_hash_a,p_hash_b,p_engine,
      ('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint,p_mode) returning * into r;
  return r;
end $$;
create function public.af_embed_complete_match(p_token_hash text, p_origin text, p_id uuid, p_engine text, p_result jsonb, p_official jsonb default null)
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
  if r.mode='registered' then
    if (select count(*) from public.af_fighters f where ((f.id=r.a::uuid and f.manifest_sha=r.hash_a) or (f.id=r.b::uuid and f.manifest_sha=r.hash_b))
      and public.af_duel_admitted(f) and f.runtime_manifest_sha=f.manifest_sha and f.deleted_at is null)<>2
      then raise exception 'duel-not-approved'; end if;
  else
    perform public.af_embed_official_admitted(r.a,r.b,r.hash_a,r.hash_b,r.engine,p_official);
  end if;
  update public.af_embed_matches set result=p_result,completed_at=now() where id=r.id returning * into r;
  return r;
end $$;

revoke all on function public.af_embed_reserve_match(text,text,uuid,text,text,text,text,text,text,jsonb),
  public.af_embed_complete_match(text,text,uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.af_embed_reserve_match(text,text,uuid,text,text,text,text,text,text,jsonb),
  public.af_embed_complete_match(text,text,uuid,text,jsonb,jsonb) to service_role;
