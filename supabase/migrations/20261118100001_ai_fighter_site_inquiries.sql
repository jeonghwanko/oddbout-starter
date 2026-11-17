-- Store website inquiries for the service and keep the text out of browser roles.
create table public.af_inquiries (
  id uuid primary key,
  title text not null check (char_length(title) between 1 and 120 and title ~ '[^[:space:]]'),
  message text not null check (char_length(message) between 1 and 4000 and message ~ '[^[:space:]]'),
  created_at timestamptz not null default now()
);
create index af_inquiries_recent on public.af_inquiries (created_at desc, id desc);

alter table public.af_inquiries enable row level security;
revoke all on public.af_inquiries from public, anon, authenticated, service_role;
grant insert, select on public.af_inquiries to service_role;
