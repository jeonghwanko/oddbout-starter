-- 운영자 선수 수정 (2026-11-02 사용자: "슈퍼 계정으로 어드민이 수정할 수 있는 루트도 하나 만들어두자"): an operator (af_admins) replaces a
-- fighter's package, or edits his profile and fighting style, without his owner's sign-in. The owner's own functions do the work under
-- the owner's id, so every check of his own edit holds (account, moderation, open submission, unchanged package, storage budget). The
-- operator's id and reason stay in af_admin_fighter_edits only: the owner reads his own submissions and fighters (RLS), so they hold no
-- operator id. 사용자 결정: an operator's new package keeps the fighter's entry (`keep_entry`; af_finish clears it only for the owner's own
-- — he enters again after watching his new motions); a profile or style edit keeps it for everyone, as before.

alter table public.af_submissions add column keep_entry boolean not null default false;

create table public.af_admin_fighter_edits (
  id bigint generated always as identity primary key,
  actor uuid not null references auth.users(id),
  fighter_id uuid not null references public.af_fighters(id),
  owner_id uuid not null references auth.users(id),
  submission_id uuid not null unique references public.af_submissions(id),
  kind text not null check(kind in ('package','profile')),
  reason text not null check(length(btrim(reason)) between 1 and 500),
  kept_entry boolean not null,
  created_at timestamptz not null default now()
);
create index af_admin_fighter_edits_fighter on public.af_admin_fighter_edits(fighter_id, created_at desc);
alter table public.af_admin_fighter_edits enable row level security;
revoke all on public.af_admin_fighter_edits from public,anon,authenticated;
grant all on public.af_admin_fighter_edits to service_role;
grant usage,select on sequence public.af_admin_fighter_edits_id_seq to service_role;
create policy af_admin_fighter_edits_service on public.af_admin_fighter_edits for all to service_role using(true) with check(true);

-- A new package for someone's fighter, as his owner's af_create_submission makes it. A retry by the same operator with the same key answers
-- the same row; a key the owner used for his own submission is a conflict, even one he is creating at this moment (the row must be this
-- transaction's: `created_at = now()`).
create function public.af_admin_create_submission(p_actor uuid,p_fighter uuid,p_key uuid,p_text text,p_sha text,p_bytes bigint,p_reason text)
returns public.af_submissions language plpgsql security invoker set search_path = '' as $$
declare f public.af_fighters; s public.af_submissions; e public.af_admin_fighter_edits; reason text := btrim(coalesce(p_reason,''));
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  if length(reason) not between 1 and 500 then raise exception 'invalid-reason'; end if;
  -- Not locked: the owner's functions lock af_settings before the fighter, and af_finish reads the entry again when the package lands.
  select * into f from public.af_fighters where id=p_fighter;
  if not found or f.deleted_at is not null then raise exception 'fighter-not-found'; end if;
  s := public.af_create_submission(f.owner_id,p_key,p_text,p_sha,p_bytes,p_fighter);
  select * into e from public.af_admin_fighter_edits where submission_id=s.id;
  if found then
    if e.actor is distinct from p_actor or e.kind<>'package' then raise exception 'idempotency-conflict'; end if;
    return s;
  end if;
  if s.created_at<>now() then raise exception 'idempotency-conflict'; end if;
  update public.af_submissions set keep_entry=f.entered_at is not null where id=s.id returning * into s;
  insert into public.af_admin_fighter_edits(actor,fighter_id,owner_id,submission_id,kind,reason,kept_entry)
    values(p_actor,f.id,f.owner_id,s.id,'package',reason,s.keep_entry);
  return s;
end $$;

-- Its upload done, the operator's submission goes to the validator queue as the owner's would.
create function public.af_admin_submit(p_actor uuid,p_id uuid) returns public.af_submissions
language plpgsql security invoker set search_path = '' as $$
declare s public.af_submissions;
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  select s2.* into s from public.af_submissions s2 join public.af_admin_fighter_edits e on e.submission_id=s2.id
    where s2.id=p_id and e.kind='package';
  if not found then raise exception 'not-found'; end if;
  return public.af_submit(s.owner_id,s.id);
end $$;

-- A profile or style edit of someone's fighter, as his owner's af_update_fighter_profile makes it (registered at once, entry kept).
create function public.af_admin_update_fighter_profile(p_actor uuid,p_reason text,p_owner uuid,p_key uuid,p_fighter uuid,p_base uuid,p_text text,p_sha text)
returns public.af_submissions language plpgsql security invoker set search_path = '' as $$
declare f public.af_fighters; s public.af_submissions; e public.af_admin_fighter_edits; reason text := btrim(coalesce(p_reason,''));
begin
  if not public.af_admin_account(p_actor) then raise exception 'admin-required'; end if;
  if length(reason) not between 1 and 500 then raise exception 'invalid-reason'; end if;
  select * into f from public.af_fighters where id=p_fighter and owner_id=p_owner;
  if not found or f.deleted_at is not null then raise exception 'fighter-not-found'; end if;
  s := public.af_update_fighter_profile(p_owner,p_key,p_fighter,p_base,p_text,p_sha);
  select * into e from public.af_admin_fighter_edits where submission_id=s.id;
  if found then
    if e.actor is distinct from p_actor or e.kind<>'profile' then raise exception 'idempotency-conflict'; end if;
    return s;
  end if;
  if s.created_at<>now() then raise exception 'idempotency-conflict'; end if;
  insert into public.af_admin_fighter_edits(actor,fighter_id,owner_id,submission_id,kind,reason,kept_entry)
    values(p_actor,f.id,f.owner_id,s.id,'profile',reason,f.entered_at is not null);
  return s;
end $$;

revoke all on function public.af_admin_create_submission(uuid,uuid,uuid,text,text,bigint,text), public.af_admin_submit(uuid,uuid),
  public.af_admin_update_fighter_profile(uuid,text,uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.af_admin_create_submission(uuid,uuid,uuid,text,text,bigint,text), public.af_admin_submit(uuid,uuid),
  public.af_admin_update_fighter_profile(uuid,text,uuid,uuid,uuid,uuid,text,text) to service_role;

-- As 20261030130000, and an operator's package keeps the entry it was made under (`keep_entry`), with the edit in the evidence.
create or replace function public.af_finish(p_id uuid,p_lease uuid,p_sha text,p_passed boolean,p_result jsonb)
returns public.af_submissions language plpgsql security invoker set search_path = '' as $$
declare s public.af_submissions; f public.af_fighters; allowed text[]; evidence jsonb;
begin
  select validator_versions into allowed from public.af_settings where singleton;
  select * into s from public.af_submissions where id=p_id for update;
  if not found then raise exception 'not-found'; end if;
  if s.lease_token is distinct from p_lease or s.manifest_sha<>p_sha then raise exception 'stale-validation'; end if;
  if s.status in ('registered','rejected') then return s; end if;
  if s.status<>'validating' or s.lease_until<=now() then raise exception 'stale-validation'; end if;
  if p_result->>'validatorVersion' is null or not (p_result->>'validatorVersion' = any(allowed))
    then raise exception 'validator-version'; end if;
  if octet_length(p_result::text)>16000 then raise exception 'validation-result-limit'; end if;
  if p_passed then
    if p_result->>'stage'<>'bytes-hashes-and-full-decode' or p_result->>'stage' is null then raise exception 'validation-incomplete'; end if;
    evidence := jsonb_build_object('authorization','open-registration','validation',p_result,'duelValidation','validated-v1-package','policy','post-publication-moderation');
    if s.replaces_fighter is null then
      insert into public.af_fighters(submission_id,owner_id,manifest_sha,profile,review_state,runtime_approved,runtime_scope,runtime_manifest_sha,duel_approved,duel_manifest_sha,review_evidence)
        values(s.id,s.owner_id,s.manifest_sha,s.manifest->'profile','approved',true,'arena-player-v1',s.manifest_sha,true,s.manifest_sha,evidence)
        on conflict(submission_id) do nothing;
      select * into f from public.af_fighters where submission_id=s.id;
    else
      select * into f from public.af_fighters where id=s.replaces_fighter and owner_id=s.owner_id for update;
      if not found or f.review_state='rejected' then
        update public.af_submissions set status='rejected',validation=p_result||'{"code":"fighter-removed"}'::jsonb where id=s.id returning * into s;
        return s;
      end if;
      -- Same row, new package: the ID, created_at and moderation fields stay; the duel record follows the ID. The entry does not, unless an
      -- operator made the package (`keep_entry`) — then it stays as it stands now (an owner who withdrew meanwhile stays withdrawn).
      if s.keep_entry and f.entered_at is not null then
        evidence := evidence||jsonb_build_object('adminEntryKept',jsonb_build_object('submission',s.id,'at',now()));
      end if;
      update public.af_fighters set status='registered',submission_id=s.id,manifest_sha=s.manifest_sha,profile=s.manifest->'profile',review_state='approved',
        runtime_approved=true,runtime_scope='arena-player-v1',runtime_manifest_sha=s.manifest_sha,duel_approved=true,duel_manifest_sha=s.manifest_sha,
        review_evidence=coalesce(f.review_evidence,'{}'::jsonb)||evidence,entered_at=case when s.keep_entry then f.entered_at end,updated_at=now()
        where id=f.id returning * into f;
    end if;
    update public.af_submissions set status='registered',fighter_id=f.id,validation=p_result where id=s.id returning * into s;
  else
    update public.af_submissions set status='rejected',validation=p_result where id=s.id returning * into s;
  end if;
  return s;
end $$;
