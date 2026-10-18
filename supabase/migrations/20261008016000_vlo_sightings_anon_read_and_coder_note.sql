-- 20261008016000_vlo_sightings_anon_read_and_coder_note.sql
--
-- Two corrections on vehicle_location_observations from the describe-batch8 lane (PR #828).
--
-- 1. PRIVACY. The read policy "Public read high confidence observations" (SELECT for anon and authenticated, USING
--    confidence >= 0.50) covers every row, so anyone with the public key can read the exact GPS point and time of the
--    4,165 photo sightings (source_type 'sighting', precision 'gps', all with coordinates; 3,179 of them from one
--    account's own uploaded or synced photos; verified 2026-10-07 15:24Z). A listing's location is public market data; a
--    person's photo location is not. Interim rule until the owner's masking design (privacy is a masking spectrum; masking
--    happens in the DB): anonymous readers no longer see sighting rows; signed-in readers (today only the owner) still do.
--    The predicate becomes: confidence >= 0.50 AND (source_type <> 'sighting' OR auth.role() = 'authenticated').
--    service_role is unaffected (its own ALL policy). The public map (map-vehicles) reads listing rows only.
--
-- 2. TRUTH. The county_fips comment written by 20261007213000 credits scripts/geocode-backfill.mjs with the 337,576 rows
--    coded through 2026-03-29, on the strength of the pipeline_registry row. The lane read every version of that script:
--    none writes county_fips (its upsert names a conflict key with no unique index, and no row carries its marker). The
--    coder of those rows is not recorded; the rows arrived with the 2026-03-10 hand load (265,503 rows copied from vehicles
--    and vehicle_images GPS) and the live writers' geocoded rows of that period. The comment now says so.
--
-- Guarded; a re-apply changes nothing. CONTRACT: supabase/sql/test_vlo_sightings_anon_read.sql (PostgreSQL 17).
-- Reversal: ALTER POLICY "Public read high confidence observations" ON public.vehicle_location_observations USING (confidence >= 0.50);
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vehicle_location_observations'
             AND policyname = 'Public read high confidence observations' AND coalesce(qual, '') NOT LIKE '%sighting%') THEN
    ALTER POLICY "Public read high confidence observations" ON public.vehicle_location_observations
      USING (confidence >= 0.50 AND (source_type <> 'sighting' OR auth.role() = 'authenticated'));
  END IF;
END $$;

COMMENT ON COLUMN public.vehicle_location_observations.county_fips IS
'County the observation falls in: a US county FIPS code, a foreign key to us_county_boundaries(fips) since 2026-10-07 (NOT VALID: the 3,244 rows coded ''_none'' stay unchecked; a new or re-keyed code must be a county). Two coders, told apart by metadata.county_key: (1) the 337,576 rows coded through 2026-03-29 arrived with the 2026-03-10 hand load (265,503 rows copied from vehicles and vehicle_images GPS) and the live writers'' geocoded rows of that period; the coder is not recorded (the registry row names scripts/geocode-backfill.mjs, but no version of that script writes county_fips; corrected 20261008016000), and none of those rows carries a metadata record; (2) since 2026-10-07, trigger trg_key_vehicle_location_county at insert and key_vehicle_location_county_from_zip() for the back-fill, from the postal code through zip_to_fips (ZIP grain; metadata.county_key = {method zip_to_fips, zip, grain, at, writer}; 183,519 rows back-filled 2026-10-07 11:46Z). Coordinates stopped arriving on 2026-03-29. Unit: none (code). Source: as above. Grain: one observation. Clock: metadata.county_key.at for (2); created_at for (1). Partial indexes idx_vlo_county_fips and idx_vlo_county_id_page; read by map-vehicles for county and state aggregates; the key of the place entity for S01 and the other stacks that name it.';

DO $$
DECLARE q text;
BEGIN
  SELECT qual INTO q FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vehicle_location_observations' AND policyname = 'Public read high confidence observations';
  IF q IS NULL OR q NOT LIKE '%sighting%' THEN RAISE EXCEPTION 'vehicle_location_observations read policy still exposes sightings: %', q; END IF;
  RAISE NOTICE 'vehicle_location_observations: anon no longer reads sightings; county_fips comment corrected';
END $$;

COMMIT;
