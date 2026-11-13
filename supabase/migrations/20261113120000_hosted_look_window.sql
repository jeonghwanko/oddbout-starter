-- New pairs get three minutes to answer (was ten). Jobs already waiting keep the deadline stored on the row:
-- this only replaces the trigger that stamps a deadline when a pair becomes ready. A row whose
-- appearance_auto_select_at is already set is not rewritten, so a wait the creator was told is not cut short.
create or replace function public.af_generation_look_deadline() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.status <> 'appearance_ready' or new.choice is not null or new.error_code is not null
    or jsonb_array_length(new.candidates) <> 2
    or jsonb_typeof(new.candidates->0) is distinct from 'string'
    or jsonb_typeof(new.candidates->1) is distinct from 'string'
    or (new.candidates->>0) !~ '^[a-z0-9][a-z0-9-]{0,47}$'
    or (new.candidates->>1) !~ '^[a-z0-9][a-z0-9-]{0,47}$' then
    new.appearance_auto_select_at := null;
  elsif old.status = 'appearance' and new.waiting_since is not null then
    new.appearance_auto_select_at := new.waiting_since + interval '3 minutes';
  end if;
  return new;
end $$;

-- Milliseconds until the next unanswered look, on the database clock, for a host that is waiting.
-- Null when nothing is pending. The claim route also runs af_generation_auto_choose_look, so a host
-- that wakes at this time selects then; the minute cron remains the backstop when no host is polling.
create function public.af_generation_next_look_select_ms() returns integer
language sql stable security invoker set search_path = '' as $$
  select floor(extract(epoch from min(j.appearance_auto_select_at) - pg_catalog.clock_timestamp()) * 1000)::integer
  from public.af_generation_jobs j
  join public.af_creators c on c.owner_id = j.owner_id and c.enabled
  where j.status = 'appearance_ready' and j.appearance_auto_select_at > pg_catalog.clock_timestamp();
$$;
revoke all on function public.af_generation_next_look_select_ms() from public, anon, authenticated;
grant execute on function public.af_generation_next_look_select_ms() to service_role;
