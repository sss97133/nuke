-- DRAFT, NOT APPLIED. Needs the owner's explicit yes.
-- Org members read an org vehicle's photos, but not the private ones.
--
-- Why. "Organization members can view org vehicle images" (permissive, SELECT on vehicle_images) admits any active
-- organization_contributors member of an org linked to the vehicle, with no privacy filter. Permissive policies OR
-- together, so a photo the public policy hides (is_sensitive, rejected_personal) is still readable, image_url
-- included, by everyone in such an org. Measured 2026-11-23: 245 of Skylar's private photos (is_sensitive or
-- rejected_personal) sit on vehicles linked to an org with another active member.
--
-- Change. Same membership test, plus the same privacy filter the public-vehicle policy already uses. The uploader
-- ("Users can view their own images") and the vehicle owner ("Users can view images for vehicles they own") keep their
-- own paths and are untouched.
--
-- Contract (run in a disposable database copy first):
--   as an active org member who is not the uploader or vehicle owner:
--     select count(*) from vehicle_images where id = <sensitive photo on an org vehicle>   -> 0 (was 1)
--     select count(*) from vehicle_images where id = <ordinary photo on the same vehicle>  -> 1 (unchanged)
--   as the uploader: both -> 1 (unchanged)
-- Revert: 01_org_member_image_policy_revert.sql

begin;
set local lock_timeout = '3s';

ALTER POLICY "Organization members can view org vehicle images" ON public.vehicle_images
USING (
  COALESCE(is_sensitive, false) = false
  AND (vision_gate_status IS NULL OR vision_gate_status <> 'rejected_personal'::vision_gate_status)
  AND EXISTS (
    SELECT 1
    FROM public.organization_vehicles ov
    JOIN public.organization_contributors oc ON ov.organization_id = oc.organization_id
    WHERE ov.vehicle_id = vehicle_images.vehicle_id
      AND oc.user_id = (SELECT auth.uid())
      AND oc.status = 'active'
  )
);

commit;
