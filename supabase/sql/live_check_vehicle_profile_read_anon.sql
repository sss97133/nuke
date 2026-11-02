-- Regression check for the logged-out profile read. Run against the LIVE database (read-only, rolled back);
-- not named test_*.sql because db-contracts runs those on an empty disposable database.
--   psql -X -v ON_ERROR_STOP=1 -f supabase/sql/live_check_vehicle_profile_read_anon.sql
-- Fails if anon cannot execute vehicle_profile_read or any function it calls (2026-10-31 incident:
-- retained_listing_property_result_matches was service_role only -> 401 for every logged-out visitor).
BEGIN;
SET LOCAL statement_timeout = '45s';
DO $$
DECLARE r record; n integer := 0;
BEGIN
  IF NOT has_function_privilege('anon', 'public.retained_listing_property_result_matches(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon cannot EXECUTE retained_listing_property_result_matches';
  END IF;
  SET LOCAL ROLE anon;
  FOR r IN SELECT id FROM (
      SELECT id FROM public.vehicles
       WHERE id IN ('83f6f033-a3c3-4cf4-a85e-a60d2c588838','e08bf694-970f-4cbe-8a74-8715158a0f2e',
                    'be853856-e450-4d0e-b2a1-613391956ad6','ac070808-4cbd-4d03-9c39-2ec5b0f0708c')
         AND is_public IS TRUE AND deleted_at IS NULL
      UNION
      (SELECT id FROM public.vehicles WHERE is_public IS TRUE AND deleted_at IS NULL ORDER BY updated_at DESC NULLS LAST LIMIT 4)
    ) s LOOP
    IF public.vehicle_profile_read(r.id) IS NULL THEN
      RAISE EXCEPTION 'anon vehicle_profile_read returned NULL for %', r.id;
    END IF;
    n := n + 1;
  END LOOP;
  IF n = 0 THEN RAISE EXCEPTION 'no public vehicles visible to anon'; END IF;
  RAISE NOTICE 'anon vehicle_profile_read ok for % vehicles', n;
END $$;
ROLLBACK;
