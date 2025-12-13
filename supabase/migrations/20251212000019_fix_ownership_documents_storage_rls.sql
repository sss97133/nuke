-- Fix ownership-documents Storage RLS (production-safe)
-- Symptom: StorageApiError: new row violates row-level security policy
-- when uploading to bucket `ownership-documents`.
--
-- This migration (re)creates the bucket + RLS policies using a robust path check:
--   name = <auth.uid()>/<vehicleId>/<filename>
--
-- NOTE: Storage policies live on storage.objects.

begin;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'Skipping ownership-documents storage RLS: storage.objects does not exist.';
    return;
  end if;

  -- Ensure bucket exists (private)
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'ownership-documents',
    'ownership-documents',
    false,
    10485760,
    array['image/jpeg','image/png','image/jpg','image/gif','image/webp','application/pdf']::text[]
  )
  on conflict (id) do update set
    public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg','image/png','image/jpg','image/gif','image/webp','application/pdf']::text[];

  -- Ensure RLS is enabled
  begin
    execute 'alter table storage.objects enable row level security';
  exception when insufficient_privilege then
    raise notice 'Skipping RLS enable on storage.objects (insufficient privilege)';
  end;

  -- Drop legacy policies (names used in older migrations)
  execute 'drop policy if exists "Users can upload their own ownership documents" on storage.objects';
  execute 'drop policy if exists "Users can view their own ownership documents" on storage.objects';
  execute 'drop policy if exists "Users can delete their own ownership documents" on storage.objects';
  execute 'drop policy if exists "Users can update their own ownership documents" on storage.objects';
  execute 'drop policy if exists "Moderators can view all ownership documents" on storage.objects';

  -- Owner INSERT (user-scoped folder)
  execute $p$
    create policy "ownership-documents: owner insert"
    on storage.objects
    for insert
    with check (
      bucket_id = 'ownership-documents'
      and auth.role() = 'authenticated'
      and (string_to_array(name, '/'))[1] = auth.uid()::text
    )
  $p$;

  -- Owner SELECT
  execute $p$
    create policy "ownership-documents: owner select"
    on storage.objects
    for select
    using (
      bucket_id = 'ownership-documents'
      and auth.role() = 'authenticated'
      and (string_to_array(name, '/'))[1] = auth.uid()::text
    )
  $p$;

  -- Owner UPDATE
  execute $p$
    create policy "ownership-documents: owner update"
    on storage.objects
    for update
    using (
      bucket_id = 'ownership-documents'
      and auth.role() = 'authenticated'
      and (string_to_array(name, '/'))[1] = auth.uid()::text
    )
    with check (
      bucket_id = 'ownership-documents'
      and (string_to_array(name, '/'))[1] = auth.uid()::text
    )
  $p$;

  -- Owner DELETE
  execute $p$
    create policy "ownership-documents: owner delete"
    on storage.objects
    for delete
    using (
      bucket_id = 'ownership-documents'
      and auth.role() = 'authenticated'
      and (string_to_array(name, '/'))[1] = auth.uid()::text
    )
  $p$;

  -- Moderator/Admin SELECT (best-effort; schema varies by env)
  begin
    execute $p$
      create policy "ownership-documents: moderator select"
      on storage.objects
      for select
      using (
        bucket_id = 'ownership-documents'
        and exists (
          select 1 from public.profiles p
          where p.id = auth.uid()
            and (
              (p.user_type in ('moderator','admin'))
              or (p.role in ('moderator','admin'))
            )
        )
      )
    $p$;
  exception when undefined_column then
    -- profiles.user_type or profiles.role missing; skip this policy.
    null;
  when undefined_table then
    null;
  end;
end
$$;

commit;


