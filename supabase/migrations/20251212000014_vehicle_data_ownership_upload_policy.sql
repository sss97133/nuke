-- Allow authenticated users to upload ownership verification documents
-- Path: vehicle-data / vehicles/<vehicleId>/ownership/<...>
--
-- This fixes: StorageApiError: new row violates row-level security policy
-- triggered when submitting ownership claim documents.

begin;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'Skipping vehicle-data ownership upload policy: storage.objects does not exist.';
    return;
  end if;

  -- Drop and recreate to ensure the policy exists and is correct.
  execute 'drop policy if exists "auth upload vehicle ownership documents" on storage.objects';

  execute $p$
    create policy "auth upload vehicle ownership documents"
    on storage.objects
    for insert
    with check (
      bucket_id = 'vehicle-data'
      and auth.role() = 'authenticated'
      and name like 'vehicles/%/ownership/%'
    )
  $p$;
end
$$;

commit;


