-- An unused creator row can go with the account. Non-cascading references from submissions and other
-- creator records still prevent deletion, so the Auth transaction cannot remove an immutable package.
alter table public.af_creators
  drop constraint af_creators_owner_id_fkey,
  add constraint af_creators_owner_id_fkey foreign key (owner_id) references auth.users(id) on delete cascade;

-- Original files are uploaded to Storage with server credentials. Keep their ownership rows until
-- support has handled the files. The FK also covers a source created after the eligibility check.
alter table public.af_creator_sources
  drop constraint af_creator_sources_owner_id_fkey,
  add constraint af_creator_sources_owner_id_fkey foreign key (owner_id) references auth.users(id) on delete restrict;

create function public.af_account_deletion_eligibility(p_owner uuid, p_session uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when not public.af_owner_session_active(p_owner, p_session, '00000000-0000-0000-0000-000000000000') then 'sign-in'
    when exists (select 1 from public.af_submissions where owner_id = p_owner)
      or exists (select 1 from public.af_creator_sources where owner_id = p_owner) then 'support'
    else 'eligible'
  end;
$$;
revoke all on function public.af_account_deletion_eligibility(uuid, uuid) from public, anon, authenticated;
grant execute on function public.af_account_deletion_eligibility(uuid, uuid) to service_role;
