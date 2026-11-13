-- A seeded bout filmed for X (2026-11-13). One row is one rendered file: the cache key is the pair, seed, rules
-- version, result digest, trim, aspect and renderer version. The cloud tool inserts a queued row; a browser on the
-- official PC claims it (af_bout_video_claim) and uploads the MP4. No client policy: the API is the only reader
-- and writer, and the table holds no X credential. Merging does not apply this migration.
create table public.af_bout_videos (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  requested_by uuid not null,
  a text not null,
  b text not null,
  seed bigint not null,
  rules integer not null,
  digest text not null,
  stamina text,
  trim text not null,
  trim_applied text,
  aspect text not null,
  status text not null,
  page text not null,
  caption text,
  intent text,
  reply text,
  record jsonb not null,
  fighters jsonb not null,
  object_path text,
  bytes integer,
  seconds numeric,
  width integer,
  height integer,
  sha256 text,
  lease_token uuid,
  lease_until timestamptz,
  error_code text,
  created_at timestamptz not null default pg_catalog.now(),
  failed_at timestamptz,
  ready_at timestamptz,
  constraint af_bout_videos_status check (status in ('queued', 'rendering', 'ready', 'failed')),
  constraint af_bout_videos_trim check (trim in ('full', 'highlights')),
  constraint af_bout_videos_aspect check (aspect in ('16:9', '1:1')),
  constraint af_bout_videos_digest check (digest ~ '^[a-f0-9]{8}$')
);

create index af_bout_videos_claim on public.af_bout_videos (status, created_at);
create index af_bout_videos_owner on public.af_bout_videos (requested_by, status);

alter table public.af_bout_videos enable row level security;
revoke all on table public.af_bout_videos from public, anon, authenticated;
grant select, insert, update, delete on table public.af_bout_videos to service_role;

-- The next queued job, or a render whose lease has expired. Skip-locked so two machines do not film the same job.
create function public.af_bout_video_claim(p_lease uuid, p_seconds integer) returns public.af_bout_videos
language plpgsql security definer set search_path = '' as $$
declare
  claimed public.af_bout_videos;
begin
  if p_seconds < 30 or p_seconds > 900 then
    raise exception 'bout-video-lease';
  end if;
  select * into claimed from public.af_bout_videos
  where status = 'queued' or (status = 'rendering' and lease_until < pg_catalog.now())
  order by created_at
  for update skip locked
  limit 1;
  if not found then
    return null;
  end if;
  update public.af_bout_videos set
    status = 'rendering',
    lease_token = p_lease,
    lease_until = pg_catalog.now() + make_interval(secs => p_seconds),
    error_code = null
  where id = claimed.id
  returning * into claimed;
  return claimed;
end $$;

revoke all on function public.af_bout_video_claim(uuid, integer) from public, anon, authenticated;
grant execute on function public.af_bout_video_claim(uuid, integer) to service_role;

-- Private bucket. The API signs a short upload for the renderer and a short download for the assistant.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('af-bout-videos', 'af-bout-videos', false, 40000000, array['video/mp4']);
