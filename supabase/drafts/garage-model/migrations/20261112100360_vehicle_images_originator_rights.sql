-- DRAFT — NOT APPLIED. Do not move into supabase/migrations without Skylar's approval.
--
-- Extra check (task brief; SPEC H4): owner UPDATE/DELETE reaching images other people uploaded to the owner's vehicles.
-- Live, 2026-11-12 snapshot: vehicle_images has FIVE UPDATE and SIX DELETE policies, all permissive and OR-ed:
--   UPDATE  "Allow vehicle owners to update images", "Owners and contributors can update images",
--           "Users can update images for their own vehicles", "Vehicle owners and contributors can update images",
--           users_can_update_own_images
--   DELETE  "Allow vehicle owners to delete images", "Owners and contributors can delete images",
--           "Users can delete images for their own vehicles", "Users can delete their own images",
--           "Vehicle owners and contributors can delete images", users_can_delete_own_images
-- Their union: vehicles.user_id / owner_id / uploaded_by, anyone with an active vehicle_contributor_roles row, and anyone with an
-- active vehicle_user_permissions row of role owner, co_owner, mechanic, appraiser, moderator, contributor, photographer, dealer_rep
-- or sales_agent (self-insertable, see VISIBILITY.md H8) may UPDATE and DELETE EVERY image of the vehicle, including a technician's
-- or a customer's. That breaks "testimony is never overwritten or deleted" (AGENTS invariant 2) and the originator/affiliation
-- split of the garage model (SPEC section 5).
--
-- After (11 policies become 4):
--   UPDATE originator  (user_id or submitted_by = you)             as before: your own photo, any column.
--   UPDATE steward     (vehicle_image_steward: owner/uploader, active permission holder, active contributor role)
--                      keeps filing, primary, zone, sensitivity and supersession on the car's media; the row must still belong to a
--                      vehicle they steward after the update, so a steward cannot push someone's evidence onto a car they do not steward.
--   DELETE originator  your own photo.
--   DELETE steward     only a row nobody else authored (user_id and submitted_by each null or you): scraper/listing rows and the
--                      owner's own. A technician's or customer's upload is superseded (UPDATE is_superseded), never deleted by the owner.
-- Not changed (reported only, VISIBILITY.md H11): an originator can still UPDATE vehicle_id of their own photo to any vehicle; the
-- BEFORE UPDATE trigger a05_trg_enforce_vision_gate_filing guards filing but its body is not in the snapshot.
-- Callers (VISIBILITY.md section 4): owner "delete photo" buttons in ImageGallery / ProImageViewer / BulkImageUploader / VehicleEditModal
-- will now fail on photos another person uploaded; the supersede path stays. SECURITY DEFINER and service-role writers are unaffected.
--
-- Requires 20261112100310 (vehicle_image_steward). Rollback at the bottom restores the eleven policies verbatim.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

DROP POLICY IF EXISTS "Allow vehicle owners to update images" ON public.vehicle_images;
DROP POLICY IF EXISTS "Owners and contributors can update images" ON public.vehicle_images;
DROP POLICY IF EXISTS "Users can update images for their own vehicles" ON public.vehicle_images;
DROP POLICY IF EXISTS "Vehicle owners and contributors can update images" ON public.vehicle_images;
DROP POLICY IF EXISTS users_can_update_own_images ON public.vehicle_images;
DROP POLICY IF EXISTS "Allow vehicle owners to delete images" ON public.vehicle_images;
DROP POLICY IF EXISTS "Owners and contributors can delete images" ON public.vehicle_images;
DROP POLICY IF EXISTS "Users can delete images for their own vehicles" ON public.vehicle_images;
DROP POLICY IF EXISTS "Users can delete their own images" ON public.vehicle_images;
DROP POLICY IF EXISTS "Vehicle owners and contributors can delete images" ON public.vehicle_images;
DROP POLICY IF EXISTS users_can_delete_own_images ON public.vehicle_images;

CREATE POLICY vehicle_images_update_originator ON public.vehicle_images AS PERMISSIVE FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR submitted_by = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()) OR submitted_by = (SELECT auth.uid()));
CREATE POLICY vehicle_images_update_steward ON public.vehicle_images AS PERMISSIVE FOR UPDATE TO authenticated
  USING (public.vehicle_image_steward(vehicle_id, (SELECT auth.uid())))
  WITH CHECK (public.vehicle_image_steward(vehicle_id, (SELECT auth.uid())));
CREATE POLICY vehicle_images_delete_originator ON public.vehicle_images AS PERMISSIVE FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR submitted_by = (SELECT auth.uid()));
CREATE POLICY vehicle_images_delete_steward ON public.vehicle_images AS PERMISSIVE FOR DELETE TO authenticated
  USING (public.vehicle_image_steward(vehicle_id, (SELECT auth.uid()))
         AND (user_id IS NULL OR user_id = (SELECT auth.uid()))
         AND (submitted_by IS NULL OR submitted_by = (SELECT auth.uid())));

-- Rollback (the live text, verbatim from the 2026-11-12 snapshot; policies TO public as they were):
--   DROP POLICY vehicle_images_update_originator, vehicle_images_update_steward, vehicle_images_delete_originator,
--     vehicle_images_delete_steward ON public.vehicle_images;   -- one DROP per policy
--   then re-create the eleven from supabase/sql/helpers/garage_visibility_live_20261112.sql (the "FOR UPDATE" / "FOR DELETE" blocks
--   on public.vehicle_images are the verbatim originals).
