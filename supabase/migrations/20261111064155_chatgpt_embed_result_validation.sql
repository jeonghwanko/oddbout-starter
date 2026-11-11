-- Reject malformed engine output before it becomes an immutable private result. JSON nulls must never pass SQL's three-valued logic.
-- Keep the canonical result shape aligned with the game's parseServerDuel; no second HTTP-layer result rule table.
create function public.af_embed_result_valid(p_result jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare n numeric; item jsonb;
begin
  if jsonb_typeof(p_result) is distinct from 'object' then return false; end if;
  if jsonb_typeof(p_result->'winner') is distinct from 'number'
    or jsonb_typeof(p_result->'how') is distinct from 'string'
    or jsonb_typeof(p_result->'ms') is distinct from 'number'
    or jsonb_typeof(p_result->'digest') is distinct from 'string'
    or jsonb_typeof(p_result->'hp') is distinct from 'array'
    or jsonb_typeof(p_result->'contacts') is distinct from 'array' then return false; end if;
  if (p_result->>'winner')::numeric not in (0,1) or p_result->>'how' not in ('ko','decision')
    or p_result->>'digest' !~ '^[a-f0-9]{8}$'
    or jsonb_array_length(p_result->'hp')<>2 or jsonb_array_length(p_result->'contacts')<>2 then return false; end if;
  n:=(p_result->>'ms')::numeric;
  if n not between 1 and 90000 or trunc(n)<>n then return false; end if;
  for item in select value from jsonb_array_elements(p_result->'hp') loop
    if jsonb_typeof(item) is distinct from 'number' then return false; end if;
    n:=item::text::numeric;
    if n not between 0 and 1 then return false; end if;
  end loop;
  for item in select value from jsonb_array_elements(p_result->'contacts') loop
    if jsonb_typeof(item) is distinct from 'number' then return false; end if;
    n:=item::text::numeric;
    if n not between 0 and 9007199254740991 or trunc(n)<>n then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function public.af_embed_result_valid(jsonb) from public,anon,authenticated,service_role;

create or replace function public.af_embed_complete_match(p_token_hash text, p_origin text, p_id uuid, p_engine text, p_result jsonb, p_official jsonb default null)
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
  if not public.af_embed_result_valid(p_result) then raise exception 'invalid-result'; end if;
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
