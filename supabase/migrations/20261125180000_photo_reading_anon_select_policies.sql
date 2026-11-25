-- image_vehicle_mismatches, image_condition_observations, appraisal_canon_checks: a model's reading of a photo is
-- readable only where the photo itself is shown publicly, by the photo's uploader, or by a caller tied to the photo's
-- vehicle. Same rule as image_descriptions (20261125094500).
--
-- Measured 2026-11-25 on production (pg_policy, cron private-row-exposure-watch 08:41 UTC):
--   image_vehicle_mismatches     "Public can view mismatches"                FOR SELECT TO public USING (true)
--   image_condition_observations "Public read image_condition_observations" FOR SELECT TO public USING (true)
--   appraisal_canon_checks       a materialized view (RLS cannot apply) with SELECT granted to anon and authenticated
--   The hourly assay read 50 of 50 sampled private rows as anon and as a signed-in stranger on the two tables, and 53 of
--   50 keys on the materialized view (several rows per observation): readings of unfiled photos, private cars' photos,
--   deleted cars' photos and gallery-ineligible photos.
--
-- New SELECT policy on each table, keyed on <table>.image_id -> vehicle_images.id (FOREIGN KEY on both tables). The
-- vehicle is the photo's (vehicle_images.vehicle_id), never the table's own vehicle_id / current_vehicle_id stamp:
-- 2,066 of 18,923 image_condition_observations rows carry a vehicle_id that is not their photo's.
--   (a) shown: the photo passes public.vehicle_image_gallery_eligible on its vehicle_images_public row (the anon-safe
--       overload; a whole-row vehicle_images reference fails with 42501 for anon), and its vehicle is_public = true AND
--       deleted_at IS NULL. vehicle_images_public is security_invoker, so the photo's own SELECT policies apply too.
--   (b) uploader: vehicle_images.user_id = auth.uid().
--   (c) tied: public.vehicle_viewer_tied(vehicle_images.vehicle_id); false for an unfiled photo.
-- appraisal_canon_checks: REVOKE ALL from anon and authenticated. No page, edge function, view or SQL function reads it
-- (git grep, pg_proc, pg_views on 2026-11-25); its owner (postgres) and service_role keep it.
-- Unchanged: "Service role can manage mismatches" (ALL TO service_role), "Service role manage
-- image_condition_observations" (ALL, auth.role() = 'service_role'), every INSERT/UPDATE/DELETE grant and policy.
-- Kept rows (anon, measured 2026-11-25): image_vehicle_mismatches 63 of 1,750; image_condition_observations 14,560 of
-- 18,923. SECURITY DEFINER readers owned by postgres (listing_work_plan_read, photo_gate_unfile_apply,
-- enforce_vision_gate_filing, capture_relay_hint_guard_fn) bypass RLS and are unchanged.
-- One transaction: the open policy and its replacement swap with no moment without a SELECT policy.

SET statement_timeout = '30s';
SET lock_timeout = '5s';

BEGIN;

DROP POLICY IF EXISTS "Public can view mismatches" ON public.image_vehicle_mismatches;
DROP POLICY IF EXISTS image_vehicle_mismatches_select ON public.image_vehicle_mismatches;
CREATE POLICY image_vehicle_mismatches_select ON public.image_vehicle_mismatches FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.vehicle_images_public vip
      JOIN public.vehicles v ON v.id = vip.vehicle_id
      WHERE vip.id = image_vehicle_mismatches.image_id
        AND v.is_public = true
        AND v.deleted_at IS NULL
        AND public.vehicle_image_gallery_eligible(vip))
    OR (
      (SELECT auth.uid()) IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.vehicle_images vi
        WHERE vi.id = image_vehicle_mismatches.image_id
          AND (vi.user_id = (SELECT auth.uid())
               OR public.vehicle_viewer_tied(vi.vehicle_id))))
  );
COMMENT ON POLICY image_vehicle_mismatches_select ON public.image_vehicle_mismatches IS
  'A mismatch reading is readable where its photo is shown publicly (vehicle_image_gallery_eligible on a public, '
  'undeleted vehicle), by the photo''s uploader, or by a caller vehicle_viewer_tied to the photo''s vehicle. '
  '20261125180000.';

DROP POLICY IF EXISTS "Public read image_condition_observations" ON public.image_condition_observations;
DROP POLICY IF EXISTS image_condition_observations_select ON public.image_condition_observations;
CREATE POLICY image_condition_observations_select ON public.image_condition_observations FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.vehicle_images_public vip
      JOIN public.vehicles v ON v.id = vip.vehicle_id
      WHERE vip.id = image_condition_observations.image_id
        AND v.is_public = true
        AND v.deleted_at IS NULL
        AND public.vehicle_image_gallery_eligible(vip))
    OR (
      (SELECT auth.uid()) IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.vehicle_images vi
        WHERE vi.id = image_condition_observations.image_id
          AND (vi.user_id = (SELECT auth.uid())
               OR public.vehicle_viewer_tied(vi.vehicle_id))))
  );
COMMENT ON POLICY image_condition_observations_select ON public.image_condition_observations IS
  'A condition reading is readable where its photo is shown publicly (vehicle_image_gallery_eligible on a public, '
  'undeleted vehicle), by the photo''s uploader, or by a caller vehicle_viewer_tied to the photo''s vehicle. '
  '20261125180000.';

REVOKE ALL ON public.appraisal_canon_checks FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy p
             WHERE p.polrelid IN ('public.image_vehicle_mismatches'::regclass, 'public.image_condition_observations'::regclass)
               AND p.polcmd IN ('r', '*') AND pg_get_expr(p.polqual, p.polrelid) = 'true'
               AND NOT p.polroles @> ARRAY['service_role'::regrole::oid])
     OR has_table_privilege('anon', 'public.appraisal_canon_checks', 'SELECT')
     OR has_table_privilege('authenticated', 'public.appraisal_canon_checks', 'SELECT') THEN
    RAISE EXCEPTION 'an open SELECT path is left on image_vehicle_mismatches, image_condition_observations or appraisal_canon_checks';
  END IF;
END $$;

COMMIT;
