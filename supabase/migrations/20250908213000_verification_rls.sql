-- Verification RLS and helper functions
-- Idempotent migration

-- 1) secure_documents hardening
alter table if exists public.secure_documents enable row level security;

-- Add is_primary flag for duplicate grouping control
alter table if exists public.secure_documents
  add column if not exists is_primary boolean not null default false;

-- Helper: check if current user is admin or moderator
create or replace function public.is_admin_or_moderator()
returns boolean language sql stable as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.user_type in ('admin','moderator')
  );
$$;

-- Policies (drop if exist to be idempotent)
-- Owner can read own documents
drop policy if exists secure_documents_owner_select on public.secure_documents;
create policy secure_documents_owner_select on public.secure_documents
  for select using (auth.uid() = user_id);

-- Owner can insert own documents
drop policy if exists secure_documents_owner_insert on public.secure_documents;
create policy secure_documents_owner_insert on public.secure_documents
  for insert with check (auth.uid() = user_id);

-- Admin/Moderator can read all
drop policy if exists secure_documents_admin_select on public.secure_documents;
create policy secure_documents_admin_select on public.secure_documents
  for select using (public.is_admin_or_moderator());

-- Admin/Moderator can update verification fields (and is_primary)
-- Keep generic update for admins to simplify interim workflows
drop policy if exists secure_documents_admin_update on public.secure_documents;
create policy secure_documents_admin_update on public.secure_documents
  for update using (public.is_admin_or_moderator()) with check (public.is_admin_or_moderator());

-- 2) profiles: allow admin/moderator to update verification fields
alter table if exists public.profiles enable row level security;

-- Ensure owner can select/update own profile (common baseline)
drop policy if exists profiles_owner_select on public.profiles;
create policy profiles_owner_select on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_owner_update on public.profiles;
create policy profiles_owner_update on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Admin/Moderator full update (interim until column-level checks added)
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update using (public.is_admin_or_moderator()) with check (public.is_admin_or_moderator());

-- 3) RPC to set primary document within duplicate group (by file_hash & user)
create or replace function public.set_primary_document(p_doc_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_user uuid;
  v_hash text;
begin
  -- Only admins/moderators may call
  if not public.is_admin_or_moderator() then
    raise exception 'Insufficient permissions';
  end if;

  select user_id, file_hash into v_user, v_hash from public.secure_documents where id = p_doc_id;
  if v_user is null then
    raise exception 'Document not found';
  end if;

  -- Clear other primaries in same group
  update public.secure_documents
    set is_primary = false
    where user_id = v_user and (file_hash = v_hash or (file_hash is null and id <> p_doc_id));

  -- Set target as primary
  update public.secure_documents set is_primary = true where id = p_doc_id;
end;
$$;

-- 4) Convenience view (optional) to aid duplicates review
create or replace view public.secure_document_duplicates as
  select file_hash, count(*) as cnt
  from public.secure_documents
  where verification_status = 'pending' and file_hash is not null
  group by file_hash
  having count(*) > 1;
