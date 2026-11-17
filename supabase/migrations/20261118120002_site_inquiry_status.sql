-- Track the support workflow while keeping inquiry text private to the service.
alter table public.af_inquiries
  add column status text not null default 'unread'
  check (status in ('unread', 'read', 'done'));
grant update (status), delete on public.af_inquiries to service_role;
