-- Tighten vehicle-data public read policy
-- Keep `vehicles/*` public for non-sensitive media, but EXCLUDE ownership documents.
--
-- This prevents accidental public access to:
--   vehicle-data/vehicles/<vehicleId>/ownership/*
--
-- Note: We are also moving NEW ownership uploads to the private `ownership-documents` bucket,
-- but this protects any legacy uploads that already exist under vehicle-data.

begin;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'Skipping vehicle-data public read policy update: storage.objects does not exist.';
    return;
  end if;

  -- Replace the broad policy with an explicit exclusion for ownership paths.
  execute 'drop policy if exists "public read vehicle-data vehicles/*" on storage.objects';

  execute $p$
    create policy "public read vehicle-data vehicles/*"
    on storage.objects
    for select
    using (
      bucket_id = 'vehicle-data'
      and name like 'vehicles/%'
      and name not like 'vehicles/%/ownership/%'
    )
  $p$;
end
$$;

commit;


