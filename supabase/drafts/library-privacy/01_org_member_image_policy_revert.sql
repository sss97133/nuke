-- Revert of 01_org_member_image_policy.sql: restores the policy exactly as read from pg_policies on 2026-11-23.
begin;
set local lock_timeout = '3s';
ALTER POLICY "Organization members can view org vehicle images" ON public.vehicle_images
USING (
  EXISTS (
    SELECT 1
    FROM public.organization_vehicles ov
    JOIN public.organization_contributors oc ON ov.organization_id = oc.organization_id
    WHERE ov.vehicle_id = vehicle_images.vehicle_id
      AND oc.user_id = (SELECT auth.uid())
      AND oc.status = 'active'
  )
);
commit;
