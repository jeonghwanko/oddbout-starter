-- 연결을 주소에 묶기 (2026-11-01, Claude 디렉터리판): Supabase Auth puts no requested resource (RFC 8707) into a connector token — its
-- audience is the hook's fixed list (af_mcp_access_token_hook) whatever address the client connected to. So the cloud MCP binds each OAuth
-- session to the edition of the address its first signed-in call came to: 'full' (/mcp and /signin, on either host) or 'directory'
-- (/claude). A token of that session is then refused at the other edition ('other-edition'): a sign-in made through the Claude directory
-- listing does not reach the tools that listing leaves out, and one made for ChatGPT, Grok or a terminal never turns into a directory one.
-- Sessions that existed before this bind to the edition of their next call; every connector so far used a full address.
-- A row holds no user id and outlives its session harmlessly: session ids are random and never reused.

create table public.af_mcp_session_editions (
  session_id uuid primary key,
  edition text not null check (edition in ('full', 'directory')),
  bound_at timestamptz not null default now()
);
alter table public.af_mcp_session_editions enable row level security;
revoke all on table public.af_mcp_session_editions from public, anon, authenticated;

-- One call's sign-in check in one round trip: the connection (af_mcp_session_active, or af_mcp_expired_token_state for an expired token
-- with its issue time), then the edition its session is bound to. 'usable' lets the call through; otherwise why not: 'ended', 'strict',
-- 'refreshed' (the expired token's answers) or 'other-edition'.
create function public.af_mcp_session_state(p_owner uuid, p_session uuid, p_client uuid, p_edition text, p_issued_at bigint default null)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare connection text; bound text;
begin
  if p_edition is null or p_edition not in ('full', 'directory') then raise exception 'invalid-edition'; end if;
  connection := case when p_issued_at is null
    then case when public.af_mcp_session_active(p_owner, p_session, p_client) then 'usable' else 'ended' end
    else public.af_mcp_expired_token_state(p_owner, p_session, p_client, p_issued_at) end;
  if connection <> 'usable' then return connection; end if;
  select e.edition into bound from public.af_mcp_session_editions e where e.session_id = p_session;
  if bound is null then
    insert into public.af_mcp_session_editions(session_id, edition) values (p_session, p_edition) on conflict (session_id) do nothing;
    select e.edition into bound from public.af_mcp_session_editions e where e.session_id = p_session;
  end if;
  return case when bound = p_edition then 'usable' else 'other-edition' end;
end $$;
revoke all on function public.af_mcp_session_state(uuid,uuid,uuid,text,bigint) from public, anon, authenticated;
grant execute on function public.af_mcp_session_state(uuid,uuid,uuid,text,bigint) to service_role;
