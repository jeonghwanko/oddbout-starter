-- 마지막 사용 후 7일 (2026-11-02, user: "인증된 상태로 grok bot을 이용하면 인증 만료가 자동으로 요청으로부터 7일 뒤에 만료되게",
-- then "마지막 사용 후 7일로 진행"): Cursor's Grok Bot never refreshes, so its sign-in lives on 20261031150000's grace, which ended
-- 7 days after the token's expiry however often the bot called. Now an expired token that grace takes ('usable' from
-- af_mcp_expired_token_state) is taken until 7 days after its session's last use: the later of the token's expiry and the last call
-- this function let through. Past that the answer is 'lapsed', which the MCP turns into a sign-in-again message with the page to
-- reconnect from. Every other answer, and every other client (still 'strict'), is unchanged; a sign-out or revoked grant still ends
-- the connection at once.
-- The last use is kept per session beside its edition binding and written at most once an hour, so a busy session costs one small
-- update an hour and an idle one lapses 7 days after its last call, give or take that hour. Bindings made before this start from
-- their bind time.
-- p_expires_at is new and optional: the MCP before this sends none, and then nothing lapses here (it kept 7 days from the expiry itself).
-- Restated whole from 20261101150000 with the last use added.

alter table public.af_mcp_session_editions add column last_used_at timestamptz;
update public.af_mcp_session_editions set last_used_at = bound_at where last_used_at is null;
alter table public.af_mcp_session_editions alter column last_used_at set default now(), alter column last_used_at set not null;

drop function public.af_mcp_session_state(uuid,uuid,uuid,text,bigint);
create function public.af_mcp_session_state(p_owner uuid, p_session uuid, p_client uuid, p_edition text, p_issued_at bigint default null,
  p_expires_at bigint default null)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare connection text; bound text; used timestamptz;
begin
  if p_edition is null or p_edition not in ('full', 'directory') then raise exception 'invalid-edition'; end if;
  connection := case when p_issued_at is null
    then case when public.af_mcp_session_active(p_owner, p_session, p_client) then 'usable' else 'ended' end
    else public.af_mcp_expired_token_state(p_owner, p_session, p_client, p_issued_at) end;
  if connection <> 'usable' then return connection; end if;
  select e.edition, e.last_used_at into bound, used from public.af_mcp_session_editions e where e.session_id = p_session;
  if p_issued_at is not null and p_expires_at is not null
    and greatest(to_timestamp(p_expires_at), coalesce(used, '-infinity'::timestamptz)) + interval '7 days' <= now() then
    return 'lapsed';
  end if;
  if bound is null then
    insert into public.af_mcp_session_editions(session_id, edition) values (p_session, p_edition) on conflict (session_id) do nothing;
    select e.edition into bound from public.af_mcp_session_editions e where e.session_id = p_session;
  end if;
  if bound <> p_edition then return 'other-edition'; end if;
  update public.af_mcp_session_editions e set last_used_at = now()
    where e.session_id = p_session and e.last_used_at < now() - interval '1 hour';
  return 'usable';
end $$;
revoke all on function public.af_mcp_session_state(uuid,uuid,uuid,text,bigint,bigint) from public, anon, authenticated;
grant execute on function public.af_mcp_session_state(uuid,uuid,uuid,text,bigint,bigint) to service_role;
