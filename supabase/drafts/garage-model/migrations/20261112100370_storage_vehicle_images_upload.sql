-- DRAFT — NOT APPLIED. Do not move into supabase/migrations without Skylar's approval.
--
-- Extra check (task brief): storage bucket policies for the same images. Live storage.objects policies for the vehicle bucket
-- (2026-11-12 snapshot): vehicle_images_upload INSERT TO authenticated WITH CHECK (bucket_id = 'vehicle-images') and nothing else:
-- any signed-in user can write an object at ANY path, including vehicles/<someone else's vehicle id>/..., which is the path the web
-- uploader (imageUploadService.ts) uses for a vehicle's media. vehicle_images_read / _update / _delete are owner-only (owner or
-- owner_id = you), which is correct for rows an authenticated user wrote. "vehicle-photos: owner insert" (users/<uid>/...) and
-- "capture-media: owner insert after attribution" are already scoped to the writer. Whether the vehicle-images bucket is PUBLIC
-- (public URLs bypass these policies entirely) is NOT in the snapshot: unverified, VISIBILITY.md section 3.
--
-- After: the upload policy keeps its name and gains a path rule. By first folder of the object name:
--   vehicles/<uuid>/...      the uploader must pass can_attach_vehicle_image(<uuid>) (same predicate as the table insert)
--   users/<uid>/...          <uid> must be you (the personal-library path)
--   temp/title-scan/<uid>/.. <uid> must be you
--   anything else            allowed as today (legacy flat names from ReceiptManager, EnhancedTimelineEventForm, uploadManager,
--                            aiDataIngestion), because the table-side policy decides whether such an object can ever back a vehicle row
-- Edge functions and the capture relay write as service role and are unaffected. Requires 20261112100310.
--
-- Rollback at the bottom.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

DROP POLICY IF EXISTS vehicle_images_upload ON storage.objects;
CREATE POLICY vehicle_images_upload ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'vehicle-images'
    AND CASE (storage.foldername(name))[1]
      WHEN 'vehicles' THEN
        -- CASE, not AND: SQL does not promise AND short-circuits, and a non-uuid folder must refuse, not raise a cast error.
        CASE WHEN (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             THEN public.can_attach_vehicle_image(((storage.foldername(name))[2])::uuid, (SELECT auth.uid()))
             ELSE false END
      WHEN 'users' THEN (storage.foldername(name))[2] = ((SELECT auth.uid()))::text
      WHEN 'temp' THEN (storage.foldername(name))[3] = ((SELECT auth.uid()))::text
      ELSE true
    END
  );

-- Rollback:
--   DROP POLICY vehicle_images_upload ON storage.objects;
--   CREATE POLICY vehicle_images_upload ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'vehicle-images'::text));
