-- vehicle_observations: a signed-in owner reads their own rows that have no vehicle.
-- Asked by the reconciliation lane, 2026-09-28, for the date-only receipt attributions that
-- demote_observation_to_user takes off vehicles (20260928204500, 20260928211500).
--
-- WHY (measured 2026-09-28): vehicle_observations has two read paths: vo_service_role_all and
-- vo_authenticated_read, which joins vehicles. A row with no vehicle (vehicle_id NULL, subject
-- 'user' or 'organization') is readable only by service_role, so once a receipt is taken off a car
-- its owner can't see it signed in. Signed in as the owner of those receipts: 0 of the 2,195 rows
-- with no vehicle were visible.
--
-- WHAT: one more read path, for signed-in users only (never anon), and only for rows with no vehicle:
--  - subject 'user': the row's subject is the caller.
--  - subject 'organization': the caller manages that organization, by the rule the organizations table
--    already uses for its managers: active business_ownership, an active organization_contributors row
--    with role owner, co_founder, board_member or manager, or an approved ownership verification.
--    Technicians, photographers and other contributors do not see an organization's receipts, and
--    discovered_by does not count (finding a business is not managing it).
-- Rows attached to a vehicle keep their rules (vo_authenticated_read and observation_is_public()).
-- No data changes.
--
-- Measured before shipping (who gains read access):
--  - The owner of the demoted receipts: their own 'user' rows, plus the two organizations they manage
--    (Viva! Las Vegas Autos, Nuke).
--  - The one other member of those two organizations is a technician: gains nothing.
--  - The 467 existing 'organization' rows with no vehicle (121 organizations): none of those
--    organizations has an active manager, so nobody gains them.
--  - anon: nothing; the policy is TO authenticated.
--
-- SCHEMA_LAW pre-mint checklist:
--  1. Search 2026-09-28: no read policy covers vehicle_observations rows without a vehicle. The manager
--     rule exists inline in the organizations UPDATE policy "Owners/contributors update orgs" (no helper
--     function), so it is written out here the same way.
--  2. Not a fact class: an access rule.  3. Writes no testimony.  4. One policy, zero storage.
--  5. Read-only.  6. No writers.  7. CI-applied.

SET statement_timeout = '60s';
SET lock_timeout = '5s';

DROP POLICY IF EXISTS vo_subject_owner_read ON public.vehicle_observations;

CREATE POLICY vo_subject_owner_read ON public.vehicle_observations
  FOR SELECT
  TO authenticated
  USING (
    vehicle_id IS NULL
    AND (
      (subject_type = 'user' AND subject_id = (SELECT auth.uid()))
      OR (subject_type = 'organization' AND (
            EXISTS (SELECT 1 FROM public.business_ownership bo
                     WHERE bo.business_id = vehicle_observations.subject_id
                       AND bo.owner_id = (SELECT auth.uid())
                       AND bo.status = 'active')
         OR EXISTS (SELECT 1 FROM public.organization_contributors oc
                     WHERE oc.organization_id = vehicle_observations.subject_id
                       AND oc.user_id = (SELECT auth.uid())
                       AND oc.status = 'active'
                       AND oc.role = ANY (ARRAY['owner', 'co_founder', 'board_member', 'manager']))
         OR EXISTS (SELECT 1 FROM public.organization_ownership_verifications ov
                     WHERE ov.organization_id = vehicle_observations.subject_id
                       AND ov.user_id = (SELECT auth.uid())
                       AND ov.status = 'approved')))
    )
  );

COMMENT ON POLICY vo_subject_owner_read ON public.vehicle_observations IS
  'Signed-in read of rows with no vehicle: subject user = the caller, or subject organization the caller manages (active owner, owner/co_founder/board_member/manager contributor, approved ownership verification). Never anon. 2026-09-28.';
