-- vehicle_location_observations: a location row is readable only while its vehicle is, and a sighting only by a viewer
-- tied to the vehicle.
--
-- PRIVACY. The SELECT policy "Public read high confidence observations" (anon, authenticated) tested only confidence and,
-- since 20261008016000, hid sightings from anon. It never tested the vehicle, so a private or deleted vehicle's location
-- rows were readable by anyone with the public key through a plain table read (the web and iOS maps embed vehicles!inner,
-- which filtered them there, but the table itself did not). And every signed-in account read the 4,165 legacy
-- 'sighting' rows (2026-03-10 hand load, source_platform photo_exif): exact photo points, which are where a vehicle's
-- holder lives or works. Photo points are for viewers tied to the vehicle only.
--
-- WHAT. The policy becomes:
--   confidence >= 0.50 (unchanged);
--   AND a sighting only through public.vehicle_listing_viewer_tied(vehicle_id) (the service role, or a signed-in viewer
--       who owns, created, uploaded or has access to the vehicle, active admins included);
--   AND the vehicle is public and not deleted, or the viewer is tied to it (the same test vehicles_private_select
--       applies to a private vehicle, plus deleted_at IS NULL for the public side, as every public reader states).
-- The service role's own policy and SECURITY DEFINER readers (get_field_provenance, vehicle_location_areas, the map
-- folds, map-vehicles over its direct connection) do not pass through this policy and are unchanged.
-- Readers checked 2026-11-12: nuke_frontend/src/components/map/oneMapService.ts (readCounty, readZip) and
-- apps/nuke-capture-ios MarketMapView.swift read by county with vehicles!inner and drop deleted vehicles client-side;
-- they lose only rows they already dropped. Measured on prod (anon, LA County 06037, first 1,000-row page by id):
-- 3.2 ms without the vehicle test, 18-30 ms with it, about +0.5-0.9 s over the county's 34,101 rows.
-- CONTRACT: supabase/sql/test_vlo_sightings_anon_read.sql (PostgreSQL 17).
-- Reversal: ALTER POLICY "Public read high confidence observations" ON public.vehicle_location_observations
--   USING (confidence >= 0.50 AND (source_type <> 'sighting' OR auth.role() = 'authenticated'));
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
BEGIN
  IF to_regprocedure('public.vehicle_listing_viewer_tied(uuid)') IS NULL THEN
    RAISE EXCEPTION 'vehicle_listing_viewer_tied(uuid) is missing; this policy reads it';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vehicle_location_observations'
                 AND policyname = 'Public read high confidence observations' AND cmd = 'SELECT'
                 AND qual LIKE '%sighting%') THEN
    RAISE EXCEPTION 'vehicle_location_observations read policy drifted from 20261008016000; review it';
  END IF;
END $guard$;

ALTER POLICY "Public read high confidence observations" ON public.vehicle_location_observations
  USING (
    confidence >= 0.50
    AND (source_type <> 'sighting' OR public.vehicle_listing_viewer_tied(vehicle_id))
    AND EXISTS (SELECT 1 FROM public.vehicles v
                WHERE v.id = vehicle_location_observations.vehicle_id
                  AND ((v.is_public = true AND v.deleted_at IS NULL) OR public.vehicle_listing_viewer_tied(v.id)))
  );

DO $check$
DECLARE q text;
BEGIN
  SELECT qual INTO q FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vehicle_location_observations'
    AND policyname = 'Public read high confidence observations';
  IF q IS NULL OR q NOT LIKE '%deleted_at IS NULL%' OR q NOT LIKE '%vehicle_listing_viewer_tied%' THEN
    RAISE EXCEPTION 'vehicle_location_observations read policy not as intended: %', q;
  END IF;
END $check$;

COMMIT;
