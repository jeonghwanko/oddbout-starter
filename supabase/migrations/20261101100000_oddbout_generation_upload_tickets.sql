-- 그림 올리기 표 (2026-11-01, 사용자: "이미지 생성할 수 있는 모델은 다 지원하는게 맞지 않어? grok, gemini도 이미지 생성해서 붙일 수 있어야지").
-- A request's pictures came only from ChatGPT's file attachments (the connector downloads them from OpenAI's file hosts). An agent with no
-- such attachment (Grok, Claude, Gemini CLI, Cursor's Grok Bot) asks for a ticket: up to two pictures for the same account within 30
-- minutes, put in on the site by the signed-in owner (the ticket's id in its link) or from a terminal with the ticket's secret (its hash
-- here, shown once). Each picture is an ordinary upload (af_generation_upload's kinds, sizes and twelve a day) that the request then names
-- in its refs; a ticket that ran out keeps the pictures it took.
create table public.af_generation_upload_tickets (
  id uuid primary key,
  owner_id uuid not null references public.af_creators(owner_id),
  secret_hash text not null unique check (secret_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index af_generation_upload_tickets_owner on public.af_generation_upload_tickets(owner_id, created_at desc);
alter table public.af_generation_upload_tickets enable row level security;
revoke all on table public.af_generation_upload_tickets from public, anon, authenticated;
grant select, insert, update, delete on table public.af_generation_upload_tickets to service_role;

alter table public.af_generation_uploads add column ticket_id uuid references public.af_generation_upload_tickets(id) on delete set null;
create index af_generation_uploads_ticket on public.af_generation_uploads(ticket_id) where ticket_id is not null;

-- A ticket for the owner (`p_secret_hash`: the hash of the secret the API shows once). Twelve a day, as many as the day's uploads.
create function public.af_generation_upload_ticket(p_owner uuid, p_id uuid, p_secret_hash text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare expires timestamptz := now() + interval '30 minutes';
begin
  perform public.af_authorize(p_owner);
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 74280502));
  if (select count(*) from public.af_generation_upload_tickets where owner_id = p_owner and created_at > now() - interval '1 day') >= 12
    then raise exception 'rate-limit'; end if;
  insert into public.af_generation_upload_tickets(id, owner_id, secret_hash, expires_at) values (p_id, p_owner, p_secret_hash, expires);
  return jsonb_build_object('id', p_id, 'expiresAt', expires);
end $$;

-- A picture the API stored under a ticket of the owner's: while it is open, two at most. The ticket's row lock orders two at once.
create function public.af_generation_ticket_upload(p_owner uuid, p_ticket uuid, p_id uuid, p_path text, p_type text, p_bytes integer,
  p_width integer, p_height integer) returns public.af_generation_uploads
language plpgsql security invoker set search_path = '' as $$
declare t public.af_generation_upload_tickets; row public.af_generation_uploads;
begin
  select * into t from public.af_generation_upload_tickets where id = p_ticket and owner_id = p_owner for update;
  if not found then raise exception 'not-found'; end if;
  if t.expires_at < now() then raise exception 'ticket-expired'; end if;
  if (select count(*) from public.af_generation_uploads where ticket_id = p_ticket) >= 2 then raise exception 'ticket-full'; end if;
  row := public.af_generation_upload(p_owner, p_id, p_path, p_type, p_bytes, p_width, p_height);
  update public.af_generation_uploads set ticket_id = p_ticket where id = p_id returning * into row;
  return row;
end $$;

revoke all on function public.af_generation_upload_ticket(uuid, uuid, text),
  public.af_generation_ticket_upload(uuid, uuid, uuid, text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.af_generation_upload_ticket(uuid, uuid, text),
  public.af_generation_ticket_upload(uuid, uuid, uuid, text, text, integer, integer, integer) to service_role;
