-- Create `vehicle-models` storage bucket + RLS (production-safe, idempotent)
-- Path convention (enforced by RLS):
--   name = <auth.uid()>/<vehicleId>/<filename>

begin;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'Skipping vehicle-models storage RLS: storage.objects does not exist.';
    return;
  end if;

  -- Ensure bucket exists (private)
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'vehicle-models',
    'vehicle-models',
    false,
    524288000, -- 500MB
    array[
      'application/octet-stream',
      'application/zip',
      'model/gltf-binary',
      'model/gltf+json',
      'application/x-fbx'
    ]::text[]
  )
  on conflict (id) do update set
    public = false,
    file_size_limit = 524288000,
    allowed_mime_types = array[
      'application/octet-stream',
      'application/zip',
      'model/gltf-binary',
      'model/gltf+json',
      'application/x-fbx'
    ]::text[];

  -- Ensure RLS is enabled
  begin
    execute 'alter table storage.objects enable row level security';
  exception when insufficient_privilege then
    raise notice 'Skipping RLS enable on storage.objects (insufficient privilege)';
  end;

  -- Drop legacy policies (safe for re-runs)
  execute 'drop policy if exists "vehicle-models: owner insert" on storage.objects';
  execute 'drop policy if exists "vehicle-models: owner select" on storage.objects';
  execute 'drop policy if exists "vehicle-models: owner update" on storage.objects';
  execute 'drop policy if exists "vehicle-models: owner delete" on storage.objects';

  -- Owner INSERT (user-scoped folder)
  execute $p$
    create policy "vehicle-models: owner insert"
    on storage.objects
    for insert
    with check (
      bucket_id = 'vehicle-models'
      and auth.role() = 'authenticated'
      and (string_to_array(name, '/'))[1] = auth.uid()::text
    )
  $p$;

  -- Owner SELECT
  execute $p$
    create policy "vehicle-models: owner select"
    on storage.objects
    for select
    using (
      bucket_id = 'vehicle-models'
      and auth.role() = 'authenticated'
      and (string_to_array(name, '/'))[1] = auth.uid()::text
    )
  $p$;

  -- Owner UPDATE
  execute $p$
    create policy "vehicle-models: owner update"
    on storage.objects
    for update
    using (
      bucket_id = 'vehicle-models'
      and auth.role() = 'authenticated'
      and (string_to_array(name, '/'))[1] = auth.uid()::text
    )
    with check (
      bucket_id = 'vehicle-models'
      and (string_to_array(name, '/'))[1] = auth.uid()::text
    )
  $p$;

  -- Owner DELETE
  execute $p$
    create policy "vehicle-models: owner delete"
    on storage.objects
    for delete
    using (
      bucket_id = 'vehicle-models'
      and auth.role() = 'authenticated'
      and (string_to_array(name, '/'))[1] = auth.uid()::text
    )
  $p$;
end
$$;

commit;


