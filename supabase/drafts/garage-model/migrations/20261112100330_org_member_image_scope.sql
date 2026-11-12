-- DRAFT — NOT APPLIED. Do not move into supabase/migrations without Skylar's approval.
--
-- Hole 3 (MODEL.md section 9, SPEC H1): vehicle_images SELECT "Organization members can view org vehicle images":
--   EXISTS (organization_vehicles ov JOIN organization_contributors oc ON oc.organization_id = ov.organization_id
--           WHERE ov.vehicle_id = vehicle_images.vehicle_id AND oc.user_id = auth.uid() AND oc.status = 'active')
-- Any active member of any role sees EVERY image (sensitive documents included) of EVERY vehicle linked to the organization, whatever
-- the link means: a technician, a photographer or a "historian" sees consignment and pre-auction inventory, title scans, everything.
-- organization_vehicles.relationship_type live vocabulary seen: service_provider, consigner, owner, sold_by, work_location,
-- auction_platform (function bodies; a 300-row recent sample of the table was 299 service_provider, 1 consigner, 2026-11-12).
--
-- After, still one SELECT policy of the same name:
--   * stewards of the organization (role owner, co_founder, manager or board_member: the roles the live "Users/owners manage
--     links" policy trusts) see every image of every linked vehicle, as today;
--   * every other active member sees only NON-sensitive images of vehicles linked by a work relationship
--     (service_provider or work_location): the cars the shop is working on, not its inventory or consignments.
-- The public-vehicle policy ("Users can view images for public vehicles") and the owner policies are untouched, so a public vehicle's
-- public photos stay public. The garage readers add rank-based access on top (VISIBILITY.md); nothing here uses the garage.
-- Cost: same shape as before (one correlated EXISTS on organization_vehicles by vehicle_id, organization_contributors by user_id).
-- Callers that could notice (VISIBILITY.md section 4): any signed-in org member reading images of org-linked vehicles they do
-- not own, e.g. nuke_frontend ImageGallery / vehicle profile for org-linked cars, OrganizationInventory, ServiceVehicleCardRich;
-- iOS GarageActivityReader (photos by taken_at). Run node scripts/ci/logged-out-live.mjs after applying.
--
-- Rollback at the bottom.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

DROP POLICY IF EXISTS "Organization members can view org vehicle images" ON public.vehicle_images;
CREATE POLICY "Organization members can view org vehicle images" ON public.vehicle_images AS PERMISSIVE FOR SELECT
  USING (EXISTS (
    SELECT 1
    FROM public.organization_vehicles ov
    JOIN public.organization_contributors oc ON oc.organization_id = ov.organization_id
    WHERE ov.vehicle_id = vehicle_images.vehicle_id
      AND oc.user_id = (SELECT auth.uid())
      AND oc.status = 'active'
      AND (
        oc.role IN ('owner', 'co_founder', 'manager', 'board_member')
        OR (ov.relationship_type IN ('service_provider', 'work_location')
            AND COALESCE(vehicle_images.is_sensitive, false) = false)
      )
  ));

-- Rollback:
--   DROP POLICY "Organization members can view org vehicle images" ON public.vehicle_images;
--   CREATE POLICY "Organization members can view org vehicle images" ON public.vehicle_images AS PERMISSIVE FOR SELECT
--     USING ((EXISTS ( SELECT 1 FROM (organization_vehicles ov JOIN organization_contributors oc ON ((ov.organization_id = oc.organization_id)))
--       WHERE ((ov.vehicle_id = vehicle_images.vehicle_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.status = 'active'::text)))));
