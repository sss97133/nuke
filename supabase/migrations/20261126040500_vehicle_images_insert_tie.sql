-- vehicle_images: a signed-in user adds a photo only as themself, onto a car they can edit or unfiled, with the gate
-- and the readers' scan keys left to the server.
--
-- Live before (pg_policies, 2026-11-26): six PERMISSIVE INSERT policies TO public, OR'd, so the weakest one wins:
--   'Authenticated can upload vehicle images'               uid = submitted_by OR (submitted_by IS NULL AND uid IS NOT NULL)
--                                                           (user_id unchecked: any uploader, or NULL; any car)
--   'Authenticated users can upload images to any vehicle'  uid = user_id AND vehicle_id IS NOT NULL (any car)
--   'Logged in users can upload images'                     uid = user_id (any car)
--   'Users can insert images for their own vehicles'        uid = user_id AND (unfiled OR vehicles.user_id = uid)
--   users_can_insert_own_images                             the same text
--   service_role_can_insert_vehicle_images                  auth.role() = 'service_role'
-- authenticated holds table-level INSERT, so an insert also chooses vision_gate_status (NULL or 'approved' skips the
-- gate; the public read policy hides only rejected_* and review_needed) and any ai_scan_metadata keys the readers write.
-- UPDATE has the placement hole one step later: 'users_can_update_own_images' and 'Allow vehicle owners to update
-- images' have no WITH CHECK, so an unfiled row of one's own can be PATCHed onto any car, and an editor of a car can
-- rewrite user_id on any photo on it.
--
-- After:
--   (1) The five end-user INSERT policies are replaced by one, vehicle_images_insert_uploader (PERMISSIVE, TO
--       authenticated), and a RESTRICTIVE floor, vehicle_images_insert_uploader_tied (TO anon, authenticated), with the
--       same check, so a permissive policy added later cannot widen it: user_id = auth.uid(), submitted_by NULL or
--       auth.uid() (apply_auto_approval_for_image auto-approves for COALESCE(submitted_by, user_id), so naming a
--       stranger as submitter is the same forgery as naming one as uploader), merged_from_vehicle_id IS NULL, and vehicle_id IS NULL or user_can_edit_vehicle(vehicle_id, auth.uid()). user_id is NULL only from
--       the service role. user_can_edit_vehicle is the one definition (20261126011500 corrects it in place); this
--       migration does not define it. RLS checks run after BEFORE triggers, so user_id is read after
--       vehicle_images_default_attribution fills it and vehicle_id after capture_relay_default_vehicle_fn files a
--       capture onto the uploader's default car. service_role_can_insert_vehicle_images is kept.
--   (2) BEFORE INSERT trigger a000_vehicle_images_client_insert_guard, named to run before every other BEFORE INSERT
--       trigger so it judges what the client sent. For anon and authenticated only, it refuses (42501):
--       vision_gate_status other than 'pending' (the column default, which is what the gate reads); ai_scan_metadata
--       that is not an object or carries a key outside the one client write on main, VehicleComments.tsx:691 (source,
--       bat_url, scraped_at, vin_match, confidence_score, original_listing, vehicle_expected).
--   (3) BEFORE UPDATE trigger zz_vehicle_images_client_move_guard, named to run after every other BEFORE UPDATE
--       trigger (some unfile a row or put vehicle_id back). For anon and authenticated only (a PostgREST PATCH, or an
--       invoker function a signed-in user called; definer writers and the service role are untouched), it refuses
--       (42501): a user_id change; any vision_gate_status change (to approved, or rejected_* back to anything:
--       the gate's writers are definer functions and the service role; no web or iOS client writes the column, and
--       no other BEFORE UPDATE trigger sets it, so the WHEN sees only what the caller sent); merged_from_vehicle_id set to anything but NULL, its old value or the row's car;
--       vehicle_id moved onto a car the caller cannot edit, unless it is the car the photo was merged from
--       (unmerge_vehicle returns photos there; (1) and the merged_from rule keep that a car the photo sat on).
--
-- Consumers (origin/main 2026-11-26): iOS and mac capture insert vehicle_id NULL, user_id = self, no gate column, no
-- ai_scan_metadata. Web inserts (imageUploadService, ImageGallery, AddEventWizard, EnhancedTimelineEventForm,
-- DealerDropboxImport, dataRouter, VehicleComments) send user_id = self and the page's car: they keep working for an
-- editor of that car and are refused (42501) for anyone else; none sends vision_gate_status; only VehicleComments
-- sends ai_scan_metadata (the keys above). EnhancedImageTagger (no user columns) and unifiedImageImportService (ghost
-- user_id) have no importer. Web vehicle_id PATCHes (TechInbox, personalPhotoLibraryService, imageVehicleMatcher,
-- vehicleDeduplicationService) work onto cars the caller can edit. Invoker functions authenticated can execute that
-- write vehicle_images: relink_testimony (checks user_can_edit_vehicle on the target), unmerge_vehicle (returns photos
-- to merged_from), flag_image_burst_duplicates and mark_duplicates_by_url_pattern (is_duplicate only). Edge functions
-- write as the service role. Out of scope: an UPDATE of ai_scan_metadata on one's own row (the column revoke work).
--
-- Locks: DROP/CREATE POLICY take ACCESS EXCLUSIVE and CREATE TRIGGER SHARE ROW EXCLUSIVE on vehicle_images (59 GB);
-- all catalog-only, no scan, one transaction. lock_timeout 3s so a busy table fails the deploy instead of queueing
-- readers; run in a quiet window.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DROP POLICY IF EXISTS "Authenticated can upload vehicle images" ON public.vehicle_images;
DROP POLICY IF EXISTS "Authenticated users can upload images to any vehicle" ON public.vehicle_images;
DROP POLICY IF EXISTS "Logged in users can upload images" ON public.vehicle_images;
DROP POLICY IF EXISTS "Users can insert images for their own vehicles" ON public.vehicle_images;
DROP POLICY IF EXISTS users_can_insert_own_images ON public.vehicle_images;

DROP POLICY IF EXISTS vehicle_images_insert_uploader ON public.vehicle_images;
CREATE POLICY vehicle_images_insert_uploader ON public.vehicle_images
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (submitted_by IS NULL OR submitted_by = (SELECT auth.uid()))
    AND merged_from_vehicle_id IS NULL
    AND (vehicle_id IS NULL OR public.user_can_edit_vehicle(vehicle_id, (SELECT auth.uid())))
  );
COMMENT ON POLICY vehicle_images_insert_uploader ON public.vehicle_images IS
  'The one end-user INSERT policy (20261126040500): the caller is the uploader; the row lands unfiled or on a car the caller can edit.';

DROP POLICY IF EXISTS vehicle_images_insert_uploader_tied ON public.vehicle_images;
CREATE POLICY vehicle_images_insert_uploader_tied ON public.vehicle_images
  AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (submitted_by IS NULL OR submitted_by = (SELECT auth.uid()))
    AND merged_from_vehicle_id IS NULL
    AND (vehicle_id IS NULL OR public.user_can_edit_vehicle(vehicle_id, (SELECT auth.uid())))
  );
COMMENT ON POLICY vehicle_images_insert_uploader_tied ON public.vehicle_images IS
  'Floor under every permissive INSERT policy, present or later (20261126040500): same check as vehicle_images_insert_uploader.';

CREATE OR REPLACE FUNCTION public.vehicle_images_client_insert_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_extra text;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF NEW.vision_gate_status IS DISTINCT FROM 'pending'::public.vision_gate_status THEN
    RAISE EXCEPTION 'vehicle_images: vision_gate_status is set by the gate, not by the uploader' USING ERRCODE = '42501';
  END IF;
  IF NEW.ai_scan_metadata IS NOT NULL THEN
    IF jsonb_typeof(NEW.ai_scan_metadata) <> 'object' THEN
      RAISE EXCEPTION 'vehicle_images: ai_scan_metadata must be an object' USING ERRCODE = '42501';
    END IF;
    SELECT string_agg(k, ', ' ORDER BY k) INTO v_extra
      FROM jsonb_object_keys(NEW.ai_scan_metadata) AS k
     WHERE k NOT IN ('source', 'bat_url', 'scraped_at', 'vin_match', 'confidence_score', 'original_listing',
                     'vehicle_expected');
    IF v_extra IS NOT NULL THEN
      RAISE EXCEPTION 'vehicle_images: ai_scan_metadata keys % are written by readers, not by the uploader', v_extra
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.vehicle_images_client_insert_guard() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.vehicle_images_client_insert_guard() IS
  'BEFORE INSERT guard for signed-in writes to vehicle_images (20261126040500): the gate starts at pending; ai_scan_metadata carries only the listing keys VehicleComments writes.';

DROP TRIGGER IF EXISTS a000_vehicle_images_client_insert_guard ON public.vehicle_images;
CREATE TRIGGER a000_vehicle_images_client_insert_guard
  BEFORE INSERT ON public.vehicle_images
  FOR EACH ROW
  EXECUTE FUNCTION public.vehicle_images_client_insert_guard();

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
  IF NEW.vision_gate_status IS DISTINCT FROM OLD.vision_gate_status THEN
    RAISE EXCEPTION 'vehicle_images: vision_gate_status is set by the gate, not by a signed-in user' USING ERRCODE = '42501';
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
  'BEFORE UPDATE guard for signed-in writes to vehicle_images (20261126040500): no uploader or gate change, merged_from only to a car the photo sat on, vehicle_id only onto a car the caller can edit or back to merged_from.';

DROP TRIGGER IF EXISTS zz_vehicle_images_client_move_guard ON public.vehicle_images;
CREATE TRIGGER zz_vehicle_images_client_move_guard
  BEFORE UPDATE ON public.vehicle_images
  FOR EACH ROW
  WHEN (OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id
        OR OLD.user_id IS DISTINCT FROM NEW.user_id
        OR OLD.merged_from_vehicle_id IS DISTINCT FROM NEW.merged_from_vehicle_id
        OR OLD.vision_gate_status IS DISTINCT FROM NEW.vision_gate_status)
  EXECUTE FUNCTION public.vehicle_images_client_move_guard();

COMMIT;
