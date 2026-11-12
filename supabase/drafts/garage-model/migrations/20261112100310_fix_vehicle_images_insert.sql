-- DRAFT — NOT APPLIED. Do not move into supabase/migrations without Skylar's approval.
--
-- Hole 1 (MODEL.md section 9, SPEC H3): vehicle_images INSERT lets any signed-in user attach a photo to any vehicle.
-- Live policy text, read 2026-11-12 ~10:50 AM AST (catalog snapshot; helpers/garage_visibility_live_20261112.sql):
--   "Authenticated can upload vehicle images"            WITH CHECK (uid = submitted_by OR (submitted_by IS NULL AND uid IS NOT NULL))
--        -> does not even check user_id: a row may name ANY user as its photographer and ANY vehicle.
--   "Authenticated users can upload images to any vehicle" WITH CHECK (uid IS NOT NULL AND uid = user_id AND vehicle_id IS NOT NULL)
--   "Logged in users can upload images"                  WITH CHECK (uid IS NOT NULL AND uid = user_id)   (any vehicle, or none)
-- plus three owner-scoped ones that are correct and stay: "Users can insert images for their own vehicles",
-- users_can_insert_own_images, and service_role_can_insert_vehicle_images.
-- The chain this opens: a photo on any car satisfies enforce_user_vehicle_evidence, so the same user can then self-insert a
-- vehicle_user_permissions 'contributor' row (vup_insert_own) and reach the car's UPDATE/DELETE and work_sessions policies.
--
-- After: the three permissive policies are dropped and replaced by ONE, vehicle_images_insert_with_standing:
--   (user_id = auth.uid() OR submitted_by = auth.uid())  -- submitted_by covers ghost-photographer imports by a signed-in uploader
--   AND can_attach_vehicle_image(vehicle_id, auth.uid())
-- can_attach_vehicle_image is true for: no vehicle (own library; the capture pipeline files it later), the vehicle's owner or
-- uploader (vehicles.user_id / owner_id / uploaded_by), a holder of an active vehicle_user_permissions row or an active
-- vehicle_contributor_roles row on it (the roles the live UPDATE policies already trust), an ACTIVE member of an organization linked
-- to the vehicle through organization_vehicles (the iOS contributor flow, SupabaseService.fetchActiveOrgMemberships), and a garage
-- member who can see the car (can_see_vehicle_via_garage, migration 300). The service role bypasses RLS and is untouched, and so is
-- the SECURITY DEFINER contributor_intake_file writer (it inserts as the function owner).
-- Also here: vehicle_image_steward(vehicle, user), the "may manage this car's media" predicate reused by migration 360 and 370.
--
-- Requires 20261112100300. Rollback at the bottom restores the three policies verbatim.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.vehicle_image_steward(p_vehicle uuid, p_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_user IS NOT NULL AND p_vehicle IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = p_vehicle AND (v.user_id = p_user OR v.owner_id = p_user OR v.uploaded_by = p_user))
    OR EXISTS (SELECT 1 FROM public.vehicle_user_permissions vup
               WHERE vup.vehicle_id = p_vehicle AND vup.user_id = p_user AND coalesce(vup.is_active, true)
                 AND vup.revoked_at IS NULL AND (vup.expires_at IS NULL OR vup.expires_at > now())
                 AND vup.role IN ('owner', 'co_owner', 'mechanic', 'appraiser', 'moderator', 'contributor', 'photographer', 'dealer_rep', 'sales_agent'))
    OR EXISTS (SELECT 1 FROM public.vehicle_contributor_roles vcr
               WHERE vcr.vehicle_id = p_vehicle AND vcr.user_id = p_user AND coalesce(vcr.is_active, true))
  )
$$;
COMMENT ON FUNCTION public.vehicle_image_steward(uuid, uuid) IS
  'May this user manage the media of this vehicle: owner/uploader, active permission holder or active contributor role.';

CREATE OR REPLACE FUNCTION public.can_attach_vehicle_image(p_vehicle uuid, p_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_user IS NOT NULL AND (
    p_vehicle IS NULL
    OR public.vehicle_image_steward(p_vehicle, p_user)
    OR EXISTS (SELECT 1 FROM public.organization_vehicles ov
               JOIN public.organization_contributors oc ON oc.organization_id = ov.organization_id
               WHERE ov.vehicle_id = p_vehicle AND oc.user_id = p_user AND oc.status = 'active')
    OR public.can_see_vehicle_via_garage(p_vehicle, p_user)
  )
$$;
COMMENT ON FUNCTION public.can_attach_vehicle_image(uuid, uuid) IS
  'May this user add a photo to this vehicle (null vehicle = own library). The insert predicate on vehicle_images.';

REVOKE EXECUTE ON FUNCTION public.vehicle_image_steward(uuid, uuid), public.can_attach_vehicle_image(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vehicle_image_steward(uuid, uuid), public.can_attach_vehicle_image(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Authenticated can upload vehicle images" ON public.vehicle_images;
DROP POLICY IF EXISTS "Authenticated users can upload images to any vehicle" ON public.vehicle_images;
DROP POLICY IF EXISTS "Logged in users can upload images" ON public.vehicle_images;

CREATE POLICY vehicle_images_insert_with_standing ON public.vehicle_images AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (user_id = (SELECT auth.uid()) OR submitted_by = (SELECT auth.uid()))
    AND public.can_attach_vehicle_image(vehicle_id, (SELECT auth.uid()))
  );

-- Rollback:
--   DROP POLICY vehicle_images_insert_with_standing ON public.vehicle_images;
--   CREATE POLICY "Authenticated can upload vehicle images" ON public.vehicle_images AS PERMISSIVE FOR INSERT
--     WITH CHECK ((( SELECT auth.uid() AS uid) = submitted_by) OR ((submitted_by IS NULL) AND (( SELECT auth.uid() AS uid) IS NOT NULL)));
--   CREATE POLICY "Authenticated users can upload images to any vehicle" ON public.vehicle_images AS PERMISSIVE FOR INSERT
--     WITH CHECK ((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id) AND (vehicle_id IS NOT NULL));
--   CREATE POLICY "Logged in users can upload images" ON public.vehicle_images AS PERMISSIVE FOR INSERT
--     WITH CHECK ((( SELECT auth.uid() AS uid) IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id));
--   (the two helper functions may stay)
