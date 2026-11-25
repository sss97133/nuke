-- image_angle_observations, ai_angle_classifications_audit, image_spatial_metadata, image_question_answers: a model's reading
-- of a photo is readable by a signed-in caller only where the photo itself is shown publicly, where the caller uploaded
-- the photo, or where the caller is tied to the photo's vehicle. Same rule as image_descriptions (20261125094500) and
-- 20261125180000, kept TO authenticated: anon read none of these tables before and reads none after.
--
-- Measured 2026-11-25 on production (pg_policy, cron private-row-exposure-watch 08:41 UTC): each table held one SELECT
-- policy, allow_authenticated_read_<table>, FOR SELECT TO authenticated USING (true). The hourly assay read 0 of 50
-- sampled private rows as anon and 50 of 50 as a random signed-in user on each: any account read the angle, spatial
-- and question readings of unfiled photos, private cars' photos, deleted cars' photos and gallery-ineligible photos
-- (image_question_answers holds 22 plate- or VIN-type answers).
--
-- New SELECT policy <table>_select TO authenticated, keyed on <table>.image_id -> vehicle_images.id (FOREIGN KEY on all
-- four). The vehicle is the photo's (vehicle_images.vehicle_id), never the table's vehicle_id stamp (1,653 of 15,446
-- ai_angle_classifications_audit rows and 402 of 32,050 image_angle_observations rows carry a vehicle_id that is not
-- their photo's).
--   (a) shown: the photo passes public.vehicle_image_gallery_eligible on its vehicle_images_public row, and its vehicle
--       is_public = true AND deleted_at IS NULL.
--   (b) uploader: vehicle_images.user_id = auth.uid().
--   (c) tied: public.vehicle_viewer_tied(vehicle_images.vehicle_id).
--   image_question_answers.image_id is nullable (0 of 1,021 rows NULL today): a row with no photo follows its vehicle
--   (public and undeleted, or tied).
-- Kept for a signed-in stranger (measured 2026-11-25): image_angle_observations 12,281 of 32,050;
-- ai_angle_classifications_audit 7,525 of 15,446; image_spatial_metadata 239 of 368; image_question_answers 623 of
-- 1,021. Readers: image_angle_classifications_view is security_invoker (narrows with the tables);
-- get_labor_bundle_images, get_vehicle_images_by_angle and get_manual_pages_for_image are SECURITY INVOKER (narrow
-- with the tables); land_angle_reland_v1, land_child_vehicle_sync_image and photo_land_classification are SECURITY
-- DEFINER owned by postgres (unchanged); the frontend's resolveAngle reads image_angle_observations by image_id.
-- service_role has BYPASSRLS. No INSERT/UPDATE/DELETE policy or grant changes.
-- One transaction: the open policy and its replacement swap with no moment without a SELECT policy.

SET statement_timeout = '30s';
SET lock_timeout = '5s';

BEGIN;

DROP POLICY IF EXISTS allow_authenticated_read_image_angle_observations ON public.image_angle_observations;
DROP POLICY IF EXISTS image_angle_observations_select ON public.image_angle_observations;
CREATE POLICY image_angle_observations_select ON public.image_angle_observations FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.vehicle_images_public vip
        JOIN public.vehicles v ON v.id = vip.vehicle_id
        WHERE vip.id = image_angle_observations.image_id
          AND v.is_public = true
          AND v.deleted_at IS NULL
          AND public.vehicle_image_gallery_eligible(vip))
      OR EXISTS (
        SELECT 1
        FROM public.vehicle_images vi
        WHERE vi.id = image_angle_observations.image_id
          AND (vi.user_id = (SELECT auth.uid())
               OR public.vehicle_viewer_tied(vi.vehicle_id)))
    )
  );
COMMENT ON POLICY image_angle_observations_select ON public.image_angle_observations IS
  'A signed-in caller reads a row where its photo is shown publicly (vehicle_image_gallery_eligible on a public, '
  'undeleted vehicle), where it uploaded the photo, or where it is vehicle_viewer_tied to the photo''s vehicle. '
  '20261125183000.';

DROP POLICY IF EXISTS allow_authenticated_read_ai_angle_classifications_audit ON public.ai_angle_classifications_audit;
DROP POLICY IF EXISTS ai_angle_classifications_audit_select ON public.ai_angle_classifications_audit;
CREATE POLICY ai_angle_classifications_audit_select ON public.ai_angle_classifications_audit FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.vehicle_images_public vip
        JOIN public.vehicles v ON v.id = vip.vehicle_id
        WHERE vip.id = ai_angle_classifications_audit.image_id
          AND v.is_public = true
          AND v.deleted_at IS NULL
          AND public.vehicle_image_gallery_eligible(vip))
      OR EXISTS (
        SELECT 1
        FROM public.vehicle_images vi
        WHERE vi.id = ai_angle_classifications_audit.image_id
          AND (vi.user_id = (SELECT auth.uid())
               OR public.vehicle_viewer_tied(vi.vehicle_id)))
    )
  );
COMMENT ON POLICY ai_angle_classifications_audit_select ON public.ai_angle_classifications_audit IS
  'A signed-in caller reads a row where its photo is shown publicly (vehicle_image_gallery_eligible on a public, '
  'undeleted vehicle), where it uploaded the photo, or where it is vehicle_viewer_tied to the photo''s vehicle. '
  '20261125183000.';

DROP POLICY IF EXISTS allow_authenticated_read_image_spatial_metadata ON public.image_spatial_metadata;
DROP POLICY IF EXISTS image_spatial_metadata_select ON public.image_spatial_metadata;
CREATE POLICY image_spatial_metadata_select ON public.image_spatial_metadata FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.vehicle_images_public vip
        JOIN public.vehicles v ON v.id = vip.vehicle_id
        WHERE vip.id = image_spatial_metadata.image_id
          AND v.is_public = true
          AND v.deleted_at IS NULL
          AND public.vehicle_image_gallery_eligible(vip))
      OR EXISTS (
        SELECT 1
        FROM public.vehicle_images vi
        WHERE vi.id = image_spatial_metadata.image_id
          AND (vi.user_id = (SELECT auth.uid())
               OR public.vehicle_viewer_tied(vi.vehicle_id)))
    )
  );
COMMENT ON POLICY image_spatial_metadata_select ON public.image_spatial_metadata IS
  'A signed-in caller reads a row where its photo is shown publicly (vehicle_image_gallery_eligible on a public, '
  'undeleted vehicle), where it uploaded the photo, or where it is vehicle_viewer_tied to the photo''s vehicle. '
  '20261125183000.';

DROP POLICY IF EXISTS allow_authenticated_read_image_question_answers ON public.image_question_answers;
DROP POLICY IF EXISTS image_question_answers_select ON public.image_question_answers;
CREATE POLICY image_question_answers_select ON public.image_question_answers FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND (
      (image_question_answers.image_id IS NULL
       AND (EXISTS (SELECT 1 FROM public.vehicles v
                    WHERE v.id = image_question_answers.vehicle_id AND v.is_public = true AND v.deleted_at IS NULL)
            OR public.vehicle_viewer_tied(image_question_answers.vehicle_id)))
      OR
      EXISTS (
        SELECT 1
        FROM public.vehicle_images_public vip
        JOIN public.vehicles v ON v.id = vip.vehicle_id
        WHERE vip.id = image_question_answers.image_id
          AND v.is_public = true
          AND v.deleted_at IS NULL
          AND public.vehicle_image_gallery_eligible(vip))
      OR EXISTS (
        SELECT 1
        FROM public.vehicle_images vi
        WHERE vi.id = image_question_answers.image_id
          AND (vi.user_id = (SELECT auth.uid())
               OR public.vehicle_viewer_tied(vi.vehicle_id)))
    )
  );
COMMENT ON POLICY image_question_answers_select ON public.image_question_answers IS
  'A signed-in caller reads a row where its photo is shown publicly (vehicle_image_gallery_eligible on a public, '
  'undeleted vehicle), where it uploaded the photo, or where it is vehicle_viewer_tied to the photo''s vehicle. A row with no photo follows its vehicle. '
  '20261125183000.';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy p
             WHERE p.polrelid IN ('public.image_angle_observations'::regclass, 'public.ai_angle_classifications_audit'::regclass,
                                  'public.image_spatial_metadata'::regclass, 'public.image_question_answers'::regclass)
               AND p.polcmd IN ('r', '*') AND pg_get_expr(p.polqual, p.polrelid) = 'true'
               AND NOT p.polroles @> ARRAY['service_role'::regrole::oid]) THEN
    RAISE EXCEPTION 'an open SELECT policy is left on a photo-reading table';
  END IF;
END $$;

COMMIT;
