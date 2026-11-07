-- New pairs get ten minutes to answer. Existing waiting jobs deliberately keep NULL:
-- deploying this policy must not suddenly dispatch old, unanswered requests.
alter table public.af_generation_jobs add column appearance_auto_select_at timestamptz;
create index af_generation_look_deadline on public.af_generation_jobs(appearance_auto_select_at)
  where status = 'appearance_ready' and appearance_auto_select_at is not null;

create function public.af_generation_look_deadline() returns trigger
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
    new.appearance_auto_select_at := new.waiting_since + interval '10 minutes';
  end if;
  return new;
end $$;
revoke all on function public.af_generation_look_deadline() from public, anon, authenticated;
grant execute on function public.af_generation_look_deadline() to service_role;
create trigger af_generation_look_deadline before update on public.af_generation_jobs
  for each row execute function public.af_generation_look_deadline();

create function public.af_generation_auto_choose_look() returns integer
language plpgsql security invoker set search_path = '' as $$
declare candidate record; row public.af_generation_jobs; n integer := 0; due timestamptz;
begin
  for candidate in select j.id, j.owner_id from public.af_generation_jobs j
    join public.af_creators c on c.owner_id = j.owner_id and c.enabled
    where j.status = 'appearance_ready' and j.appearance_auto_select_at <= now()
    order by j.appearance_auto_select_at, j.id limit 100
  loop
    -- Same lock order as owner answers/cancellation: creator, then job. A concurrent
    -- answer wins if it has the lock; the next tick rechecks the committed state.
    perform 1 from public.af_creators where owner_id = candidate.owner_id and enabled for update skip locked;
    if not found then continue; end if;
    select * into row from public.af_generation_jobs where id = candidate.id
      and status = 'appearance_ready' and choice is null and error_code is null
      and appearance_auto_select_at <= now() for update skip locked;
    if not found then continue; end if;
    due := row.appearance_auto_select_at;
    update public.af_generation_jobs set choice = 'a', status = 'motions', waiting_since = null,
      progress = 0, stage_leases = 0, updated_at = now() where id = row.id;
    -- A timeout is a product default, never a fabricated user answer or visual approval.
    insert into public.af_generation_events(job_id, kind, data)
      values (row.id, 'appearance-auto-selected', jsonb_build_object('choice', 'a', 'reason', 'no-answer', 'deadline', due));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.af_generation_auto_choose_look() from public, anon, authenticated;
grant execute on function public.af_generation_auto_choose_look() to service_role;
-- Runs even with no open chat/browser. Existing claims enforce host/provider availability;
-- the deadline only queues the next stage, it does not bypass a stopped provider.
select cron.schedule('af-generation-auto-choose-look', '* * * * *', 'select public.af_generation_auto_choose_look();');
