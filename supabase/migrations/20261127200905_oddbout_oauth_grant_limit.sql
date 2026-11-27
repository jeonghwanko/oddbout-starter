-- ODDBOUT uses every active OAuth server grant as an agent connection. Keep the
-- native consent as the source of truth, including approvals made directly in Auth.
create function public.af_enforce_oauth_grant_limit()
returns trigger language plpgsql volatile security invoker set search_path = '' as $$
begin
  if new.revoked_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.revoked_at is null and old.user_id = new.user_id and old.client_id = new.client_id then
      return new;
    end if;
  end if;
  if not exists (select 1 from auth.oauth_clients c where c.id = new.client_id and c.deleted_at is null) then
    return new;
  end if;

  -- Auth writes at READ COMMITTED. A fresh statement snapshot after the owner
  -- lock sees any grant that won the last slot while this transaction waited.
  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise serialization_failure using message = 'OAuth grants require read committed isolation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('oddbout:oauth-grant:' || new.user_id::text, 0));

  if (
    select count(*) from auth.oauth_consents g
    join auth.oauth_clients c on c.id = g.client_id
    where g.user_id = new.user_id and g.revoked_at is null and c.deleted_at is null
  ) > 3 then
    raise exception 'ai_fighter_oauth_grant_limit' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.af_enforce_oauth_grant_limit() from public, anon, authenticated, service_role;
grant execute on function public.af_enforce_oauth_grant_limit() to supabase_auth_admin;

do $$
declare
  account_count integer;
  grant_count integer;
  session_count integer;
  authorization_count integer;
begin
  -- Drain Auth's code approval/exchange before installing the guard and clearing
  -- existing grants. Code exchange locks its authorization before issuing a session.
  perform set_config('lock_timeout', '5s', true);
  lock table auth.oauth_authorizations, auth.oauth_consents in exclusive mode;

  create trigger af_enforce_oauth_grant_limit
    after insert or update of user_id, client_id, revoked_at on auth.oauth_consents
    for each row execute function public.af_enforce_oauth_grant_limit();

  -- Revoke every active consent for affected owners, then invalidate their OAuth
  -- codes and sessions. Row locks serialize session deletion with token refresh.
  -- The session FK cascades to refresh tokens. Browser and device-login sessions
  -- have a null oauth_client_id.
  with affected as materialized (
    select g.user_id from auth.oauth_consents g
    join auth.oauth_clients c on c.id = g.client_id
    where g.revoked_at is null and c.deleted_at is null
    group by g.user_id
    having count(*) > 3
  ),
  revoked as (
    update auth.oauth_consents g
    set revoked_at = greatest(clock_timestamp(), g.granted_at)
    where g.user_id in (select user_id from affected) and g.revoked_at is null
    returning 1
  ),
  removed_authorizations as (
    delete from auth.oauth_authorizations a
    where a.user_id in (select user_id from affected)
      and a.status in ('pending', 'approved') and a.expires_at > now()
    returning 1
  ),
  removed_sessions as (
    delete from auth.sessions s
    where s.user_id in (select user_id from affected) and s.oauth_client_id is not null
    returning 1
  )
  select (select count(*) from affected), (select count(*) from revoked),
         (select count(*) from removed_sessions), (select count(*) from removed_authorizations)
  into account_count, grant_count, session_count, authorization_count;

  raise notice 'ODDBOUT OAuth reset: % accounts, % grants, % sessions, % authorizations',
    account_count, grant_count, session_count, authorization_count;
end;
$$;
