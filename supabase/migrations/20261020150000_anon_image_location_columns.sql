-- Photo metadata exposure (privacy doctrine: no street addresses or exact places, no device identifiers to visitors).
-- anon held table-level SELECT on every column of vehicle_images, including precise coordinates, EXIF (with a location
-- object), place names and device fingerprints, and device_attributions is readable by anyone (policy true) with GPS,
-- altitude, GPS clock, camera serial and raw EXIF. RLS decides rows, not columns, so anon gets column grants instead:
--   * vehicle_images: every column except latitude, longitude, location_name, location_confidence, exif_data,
--     device_fingerprint, documented_by_device.
--   * device_attributions: every column except latitude, longitude, altitude, gps_timestamp, camera_serial, raw_exif,
--     device_fingerprint.
-- Rows, policies, authenticated and service_role are unchanged; nothing is deleted or rewritten. Signed-out frontend reads
-- name their columns (lib/vehicleImageColumns.ts) so they keep working. Columns added later are not granted to anon until
-- a migration grants them. Reverse: GRANT SELECT ON TABLE public.vehicle_images, public.device_attributions TO anon.
-- Contract: supabase/sql/test_anon_image_location_columns.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $$
DECLARE
  t record;
  cols text;
BEGIN
  FOR t IN SELECT * FROM (VALUES
      ('vehicle_images', ARRAY['latitude','longitude','location_name','location_confidence','exif_data','device_fingerprint','documented_by_device']),
      ('device_attributions', ARRAY['latitude','longitude','altitude','gps_timestamp','camera_serial','raw_exif','device_fingerprint'])
    ) v(tbl, excluded) LOOP
    CONTINUE WHEN to_regclass('public.' || t.tbl) IS NULL;
    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = t.tbl AND column_name <> ALL (t.excluded);
    EXECUTE format('REVOKE SELECT ON TABLE public.%I FROM anon', t.tbl);
    EXECUTE format('REVOKE SELECT (%s) ON TABLE public.%I FROM anon',
      (SELECT string_agg(quote_ident(c), ', ') FROM unnest(t.excluded) c
        WHERE EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t.tbl AND column_name = c)), t.tbl);
    EXECUTE format('GRANT SELECT (%s) ON TABLE public.%I TO anon', cols, t.tbl);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
