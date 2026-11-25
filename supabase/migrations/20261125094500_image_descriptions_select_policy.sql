-- image_descriptions: a model's description of a photo is readable only where the photo itself is shown publicly, by the
-- photo's uploader, or by a caller tied to the photo's vehicle.
--
-- Measured 2026-11-24 on production (pg_policies, PostgREST as anon):
--   image_descriptions_select was FOR SELECT TO public USING (true). Anon read every row (~201k, pg_class.reltuples
--   201,008), including the descriptions of an owner's UNFILED photos (vehicle_images.vehicle_id NULL: papers, people,
--   places). GET /rest/v1/image_descriptions?select=id&vehicle_id=is.null with Prefer: count=estimated answered
--   200 with content-range 0-0/9581 (exact: 12,207 rows with vehicle_id NULL, 12,164 of them on unfiled photos).
--
-- New USING, keyed on image_descriptions.image_id -> vehicle_images.id (FK image_descriptions_image_id_fkey; served by
-- idx_image_descriptions_image and vehicle_images_pkey, so no index is added). The vehicle is the photo's
-- (vehicle_images.vehicle_id), never image_descriptions.vehicle_id, which can lag a filing.
--   (a) shown: the photo passes public.vehicle_image_gallery_eligible on its vehicle_images_public row, and its vehicle
--       is_public = true AND deleted_at IS NULL. The view and its overload are the anon-safe pair: anon holds column
--       grants on vehicle_images (no exif_data, location or device columns), so a whole-row vehicle_images reference
--       would fail with 42501 for anon (2026-10-19, #2293). vehicle_images_public is security_invoker, so the image's
--       own SELECT policies apply too: a description is never shown where its photo is not.
--   (b) uploader: vehicle_images.user_id = auth.uid().
--   (c) tied: public.vehicle_viewer_tied(vehicle_images.vehicle_id), the existing test (owner_id, user_id,
--       created_by_user_id, uploaded_by, then vehicle_user_has_access) that vehicle_statements, receipt masking and
--       the vehicle readers use. It is false for a NULL vehicle, so an unfiled photo's description reaches only (b).
-- service_role has BYPASSRLS and keeps every row. The insert policy (service_role) is unchanged. The SECURITY DEFINER
-- readers of this table are owned by postgres (BYPASSRLS) and are unaffected.
-- ALTER POLICY changes the expression in place, so there is no moment without a SELECT policy.

SET statement_timeout = '30s';
SET lock_timeout = '5s';

ALTER POLICY image_descriptions_select ON public.image_descriptions
  USING (
    EXISTS (
      SELECT 1
      FROM public.vehicle_images_public vip
      JOIN public.vehicles v ON v.id = vip.vehicle_id
      WHERE vip.id = image_descriptions.image_id
        AND v.is_public = true
        AND v.deleted_at IS NULL
        AND public.vehicle_image_gallery_eligible(vip))
    OR (
      (SELECT auth.uid()) IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.vehicle_images vi
        WHERE vi.id = image_descriptions.image_id
          AND (vi.user_id = (SELECT auth.uid())
               OR public.vehicle_viewer_tied(vi.vehicle_id))))
  );

COMMENT ON POLICY image_descriptions_select ON public.image_descriptions IS
  'A photo description is readable where the photo is shown publicly (vehicle_image_gallery_eligible on a public, '
  'undeleted vehicle), by the photo''s uploader, or by a caller vehicle_viewer_tied to the photo''s vehicle. '
  '20261125094500.';
