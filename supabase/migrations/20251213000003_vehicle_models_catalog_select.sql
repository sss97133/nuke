-- Allow authenticated users to read "catalog" vehicle models from the private `vehicle-models` bucket.
--
-- We intentionally do NOT open up the entire bucket:
-- - User uploads live under: <auth.uid()>/<vehicleId>/<filename> (already protected by owner select policy)
-- - Catalog files may live either:
--   - at the bucket root (no slashes): <filename>
--   - under a `catalog/` prefix: catalog/<...>
--
-- This enables "models already in the system" to be rendered in chat without requiring users to paste signed URLs.

begin;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'Skipping vehicle-models catalog select policy: storage.objects does not exist.';
    return;
  end if;

  -- Ensure RLS is enabled (best-effort)
  begin
    execute 'alter table storage.objects enable row level security';
  exception when insufficient_privilege then
    raise notice 'Skipping RLS enable on storage.objects (insufficient privilege)';
  end;

  -- Drop/recreate policy (idempotent)
  execute 'drop policy if exists "vehicle-models: catalog select" on storage.objects';

  execute $p$
    create policy "vehicle-models: catalog select"
    on storage.objects
    for select
    using (
      bucket_id = 'vehicle-models'
      and auth.role() = 'authenticated'
      and (
        -- Top-level objects (no slash) are treated as catalog
        position('/' in name) = 0
        -- Explicit catalog prefix also allowed
        or (string_to_array(name, '/'))[1] = 'catalog'
      )
    )
  $p$;
end
$$;

commit;


