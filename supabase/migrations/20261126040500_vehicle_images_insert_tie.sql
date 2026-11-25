-- vehicle_images: a signed-in user adds a photo only as themself, onto a car they can edit, or unfiled.
--
-- Live before (pg_policies, 2026-11-26): seven PERMISSIVE INSERT policies TO public, OR'd. Three of them admit any car:
--   'Authenticated users can upload images to any vehicle'  uid = user_id AND vehicle_id IS NOT NULL
--   'Logged in users can upload images'                     uid = user_id
--   'Authenticated can upload vehicle images'               uid = submitted_by OR (submitted_by IS NULL AND uid IS NOT NULL)
--     (the last one leaves user_id free, so a row can name another person as its uploader).
-- UPDATE has the same hole one step later: 'users_can_update_own_images' and 'Allow vehicle owners to update images'
-- have USING (uid = user_id OR ...) and no WITH CHECK, so an unfiled row of one's own can be PATCHed onto any car, and
-- an editor of a car can rewrite user_id on any photo on it.
--
-- After:
--   (1) RESTRICTIVE INSERT policy vehicle_images_insert_uploader_tied TO anon, authenticated. It ANDs with every
--       permissive INSERT policy, present or added later: user_id = auth.uid(), merged_from_vehicle_id IS NULL, and
--       vehicle_id IS NULL or user_can_edit_vehicle(vehicle_id, auth.uid()). user_can_edit_vehicle is the one
--       definition (20261126011500 corrects it in place); this migration does not define it. RLS checks run after
--       BEFORE triggers, so user_id is read after vehicle_images_default_attribution fills it and vehicle_id after
--       capture_relay_default_vehicle_fn files a capture onto the uploader's default car.
--   (2) BEFORE UPDATE trigger zz_vehicle_images_client_move_guard (named to run after every other BEFORE UPDATE
--       trigger, which may unfile a row or put vehicle_id back). It acts only when the statement runs as anon or
--       authenticated, i.e. a PostgREST PATCH or an invoker function a signed-in user called; definer writers
--       (attribute_image_session, relink paths that are definer) and the service role are untouched. It refuses
--       (42501): a user_id change; a merged_from_vehicle_id set to anything but NULL, its old value, or the row's
--       current car; a vehicle_id moved to a non-null car the caller cannot edit, unless it is the car the photo
--       was merged from (unmerge_vehicle returns photos there, and (1) and the merged_from rule keep that a car
--       the photo really sat on).
--
-- Consumers (origin/main 2026-11-26): iOS and mac capture insert vehicle_id NULL, user_id = self. Web inserts
-- (imageUploadService, ImageGallery, AddEventWizard, EnhancedTimelineEventForm, DealerDropboxImport, dataRouter,
-- VehicleComments) send user_id = self and the page's car: they keep working for an editor of that car and are refused
-- (42501) for anyone else. EnhancedImageTagger (no user columns) and unifiedImageImportService (ghost user_id) have no
-- importer. Web vehicle_id PATCHes (TechInbox, personalPhotoLibraryService, imageVehicleMatcher,
-- vehicleDeduplicationService) work onto cars the caller can edit. Invoker functions authenticated can execute that
-- write vehicle_images: relink_testimony (checks user_can_edit_vehicle on the target), unmerge_vehicle (returns photos
-- to merged_from), flag_image_burst_duplicates and mark_duplicates_by_url_pattern (is_duplicate only). Edge functions
-- write as the service role.
--
-- Locks: CREATE POLICY takes ACCESS EXCLUSIVE and CREATE TRIGGER SHARE ROW EXCLUSIVE on vehicle_images (57 GB);
-- both are catalog-only, no scan. lock_timeout 3s so a busy table fails the deploy instead of queueing readers;
-- run in a quiet window.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DROP POLICY IF EXISTS vehicle_images_insert_uploader_tied ON public.vehicle_images;
CREATE POLICY vehicle_images_insert_uploader_tied ON public.vehicle_images
  AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND merged_from_vehicle_id IS NULL
    AND (vehicle_id IS NULL OR public.user_can_edit_vehicle(vehicle_id, (SELECT auth.uid())))
  );
COMMENT ON POLICY vehicle_images_insert_uploader_tied ON public.vehicle_images IS
  'A signed-in insert names its caller as uploader and lands unfiled or on a car the caller can edit (20261126040500). Restrictive: ANDs with every permissive INSERT policy.';

CREATE OR REPLACE FUNCTION public.vehicle_images_client_move_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'vehicle_images: a photo''s uploader cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF NEW.merged_from_vehicle_id IS DISTINCT FROM OLD.merged_from_vehicle_id
     AND NEW.merged_from_vehicle_id IS NOT NULL
     AND NEW.merged_from_vehicle_id IS DISTINCT FROM OLD.vehicle_id THEN
    RAISE EXCEPTION 'vehicle_images: merged_from_vehicle_id names only a car the photo sat on' USING ERRCODE = '42501';
  END IF;
  IF NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
     AND NEW.vehicle_id IS NOT NULL
     AND NEW.vehicle_id IS DISTINCT FROM OLD.merged_from_vehicle_id
     AND NOT coalesce(public.user_can_edit_vehicle(NEW.vehicle_id, auth.uid()), false) THEN
    RAISE EXCEPTION 'vehicle_images: you can only file a photo onto a vehicle you can edit' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.vehicle_images_client_move_guard() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.vehicle_images_client_move_guard() IS
  'BEFORE UPDATE guard for signed-in writes to vehicle_images (20261126040500): no uploader change, merged_from only to a car the photo sat on, vehicle_id only onto a car the caller can edit or back to merged_from.';

DROP TRIGGER IF EXISTS zz_vehicle_images_client_move_guard ON public.vehicle_images;
CREATE TRIGGER zz_vehicle_images_client_move_guard
  BEFORE UPDATE ON public.vehicle_images
  FOR EACH ROW
  WHEN (OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id
        OR OLD.user_id IS DISTINCT FROM NEW.user_id
        OR OLD.merged_from_vehicle_id IS DISTINCT FROM NEW.merged_from_vehicle_id)
  EXECUTE FUNCTION public.vehicle_images_client_move_guard();

COMMIT;
