-- 내 PC 연결, 코드 복사 없이 (2026-11-05). Design: game repo plan "구독 사용자를 위한 ODDBOUT 선수 만들기 개선" 1.4.
-- Joining a PC took a thirty-minute join code copied from the site into a three-line Linux install. Now the PC asks first, the way a
-- workspace signs in (`af_device_logins`): the runner starts a pairing with no account (its secret's SHA-256 is kept, never the secret)
-- and opens `creator.html#pc=<code>`; the site shows the code, the PC's name and OS, and one Connect button. Connecting is the owner's
-- act on the site: it makes his host if he has none (a default name, no name field; the host terms are the button's link, so pressing
-- it accepts them) and a join code for it (`af_generation_host_join_code`, whose secret nobody sees). The runner, polling every five
-- seconds, trades that code once for a worker key (`af_generation_host_join`, the same key and the same two-live-keys rule as a typed
-- code). The PC connects before it installs anything, so its heartbeat's `health` tells the site how setup goes (docs/GENERATION-HOST.md).
create table public.af_generation_host_pairings (
  id uuid primary key default gen_random_uuid(),
  secret_hash text not null unique check (secret_hash ~ '^[a-f0-9]{64}$'),
  -- The public code, as the device sign-in's: eight consonants, shown XXXX-XXXX.
  user_code text not null check (user_code ~ '^[BCDFGHJKLMNPQRSTVWXZ]{8}$'),
  -- What the PC says it is, shown beside the code so the owner can tell it is the PC in front of him.
  pc_name text not null check (char_length(pc_name) between 1 and 40),
  platform text not null check (platform in ('windows', 'macos', 'linux')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'consumed')),
  owner_id uuid references auth.users(id) on delete cascade,
  host_id uuid references public.af_generation_hosts(id) on delete cascade,
  -- The approval's join code (its hash; the code itself is never made visible), until the PC trades it.
  join_hash text check (join_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  approved_at timestamptz, consumed_at timestamptz, polled_at timestamptz,
  check ((status = 'pending') = (owner_id is null)),
  check ((status = 'approved') = (join_hash is not null))
);
-- An open code names one PC; a closed one may come round again.
create unique index af_generation_host_pairings_open_code on public.af_generation_host_pairings(user_code) where status = 'pending';
create index af_generation_host_pairings_created on public.af_generation_host_pairings(created_at);
create index af_generation_host_pairings_owner on public.af_generation_host_pairings(owner_id, approved_at);
alter table public.af_generation_host_pairings enable row level security;
revoke all on table public.af_generation_host_pairings from public, anon, authenticated;
grant select, insert, update, delete on table public.af_generation_host_pairings to service_role;

-- A PC starts a pairing with no account: 120 starts per 10 minutes for everyone (the API brakes each caller too), rows a day past their
-- end are removed.
create function public.af_generation_host_pairing_start(p_secret_hash text, p_user_code text, p_pc_name text, p_platform text, p_ttl_seconds integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.af_generation_host_pairings;
begin
  if p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 900 then raise exception 'invalid-ttl'; end if;
  delete from public.af_generation_host_pairings where expires_at < now() - interval '1 day';
  if (select count(*) from public.af_generation_host_pairings where created_at > now() - interval '10 minutes') >= 120 then raise exception 'rate-limit'; end if;
  begin
    insert into public.af_generation_host_pairings(secret_hash, user_code, pc_name, platform, expires_at)
      values (p_secret_hash, p_user_code, p_pc_name, p_platform, now() + make_interval(secs => p_ttl_seconds)) returning * into r;
  exception when unique_violation then raise exception 'user-code-collision';
  end;
  return jsonb_build_object('userCode', r.user_code, 'expiresAt', r.expires_at);
end $$;

-- What the site shows before Connect: the PC's name and OS while its code is open.
create function public.af_generation_host_pairing_view(p_user_code text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare r public.af_generation_host_pairings;
begin
  select * into r from public.af_generation_host_pairings where user_code = p_user_code and status = 'pending' and expires_at > now();
  if not found then raise exception 'pairing-not-found'; end if;
  return jsonb_build_object('userCode', r.user_code, 'name', r.pc_name, 'platform', r.platform, 'expiresAt', r.expires_at);
end $$;

-- Connect (p_owner from the verified token): five a hour per account. His host is made, or brought back after removal, with its name and
-- billing kept (a new one: 'My PC', a subscription) and the terms accepted now; then a join code for it, kept on the pairing by its hash.
create function public.af_generation_host_pairing_approve(p_owner uuid, p_user_code text, p_join_hash text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare r public.af_generation_host_pairings; h public.af_generation_hosts;
begin
  perform public.af_authorize(p_owner);
  if (select count(*) from public.af_generation_host_pairings where owner_id = p_owner and approved_at > now() - interval '1 hour') >= 5 then
    raise exception 'rate-limit';
  end if;
  select * into r from public.af_generation_host_pairings where user_code = p_user_code and status = 'pending' and expires_at > now() for update;
  if not found then raise exception 'pairing-not-found'; end if;
  select * into h from public.af_generation_hosts where owner_id = p_owner;
  h := public.af_generation_host_apply(p_owner, coalesce(h.name, 'My PC'), coalesce(h.billing, 'subscription'), true);
  perform public.af_generation_host_join_code(p_owner, p_join_hash);
  -- A Connect in the code's last seconds still reaches a PC polling every five.
  update public.af_generation_host_pairings set status = 'approved', owner_id = p_owner, host_id = h.id, join_hash = p_join_hash, approved_at = now(),
    expires_at = greatest(expires_at, now() + interval '1 minute') where id = r.id;
  return jsonb_build_object('host', jsonb_build_object('id', h.id, 'name', h.name, 'approved', h.approved),
    'pc', jsonb_build_object('name', r.pc_name, 'platform', r.platform));
end $$;

-- The PC polls with its secret, at most once in four seconds (RFC 8628 slow_down). Approved, it gets its worker key here, exactly once:
-- the join code is traded in the same transaction that closes the pairing.
create function public.af_generation_host_pairing_poll(p_secret_hash text, p_key_hash text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare r public.af_generation_host_pairings; previous timestamptz; joined jsonb;
begin
  select * into r from public.af_generation_host_pairings where secret_hash = p_secret_hash for update;
  if not found then raise exception 'pairing-not-found'; end if;
  if r.status = 'consumed' then return jsonb_build_object('status', 'consumed'); end if;
  if r.expires_at <= now() then return jsonb_build_object('status', 'expired'); end if;
  previous := r.polled_at;
  update public.af_generation_host_pairings set polled_at = now() where id = r.id;
  if previous is not null and previous > now() - interval '4 seconds' then raise exception 'slow-down'; end if;
  if r.status = 'pending' then return jsonb_build_object('status', 'pending'); end if;
  joined := public.af_generation_host_join(r.join_hash, p_key_hash, 'host-pair-' || r.platform || '-' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'));
  update public.af_generation_host_pairings set status = 'consumed', consumed_at = now(), join_hash = null where id = r.id;
  return joined || jsonb_build_object('status', 'approved');
end $$;

revoke all on function public.af_generation_host_pairing_start(text, text, text, text, integer), public.af_generation_host_pairing_view(text),
  public.af_generation_host_pairing_approve(uuid, text, text), public.af_generation_host_pairing_poll(text, text) from public, anon, authenticated;
grant execute on function public.af_generation_host_pairing_start(text, text, text, text, integer), public.af_generation_host_pairing_view(text),
  public.af_generation_host_pairing_approve(uuid, text, text), public.af_generation_host_pairing_poll(text, text) to service_role;
