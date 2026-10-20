-- Organization access rules admit active members only; deal records only active staff.
--
-- Live on 2026-10-19 (policies in supabase/sql/helpers/org_member_policies_live_20261019.sql), 16 RLS policies granted
-- access for ANY organization_contributors row of the caller, whatever its status, and two routes give any signed-in
-- account such a row for any organization:
--   1. organization_contributors_insert admits a pending, self_claimed contributor or photographer row (a join request).
--   2. contractor_work_contributions accepts any organization_id from its contractor, and its SECURITY DEFINER trigger
--      update_contractor_contribution_count inserts a technician row that takes the column default, status 'active'.
-- A rolled-back production probe at 23:00Z: a fresh account went from 0 to 22 deal_contacts (names, phones, addresses),
-- 10 deal_jackets, 12 deal_documents, 52 deal_reconditioning and 16 deal_vehicle_details rows of one organization
-- after route 1, and to the same through route 2. Inactive rows (people who left) kept the same access.
-- A third route: organization_contributors_insert still seats as an active owner anyone with an approved
-- organization_ownership_verifications row, which approve_organization_claim_owner_agent writes for a document claim;
-- 20261020101000 made claimants a separate register (organization_verified_claimants) that is not a member, so a claim
-- must not open the organization's private records.
-- Population at the read: 10 contributor rows, all active (no pending row), 0 approved ownership verifications.
--
-- After:
--   * deal_contacts_org, deal_docs_org, deal_jackets_org, deal_recon_org, deal_vehicle_details_org and obs_org (the
--     deal intelligence tables, 20260215400000 "org members"): an active member in a staff role (owner, co_founder,
--     board_member, manager, employee, technician). Community roles (contributor, photographer, historian, moderator,
--     contractor) read none of them.
--   * deal_jackets_principals, obs_deal, documents (organization entity, view and insert), image_work_extractions,
--     location_collaborations (both), organization_capabilities manage, work_organization_matches (both): unchanged
--     role lists, plus status 'active'.
--   * "Organizations can view location collaborations" also loses its branch for other organizations at the same
--     address: it read location_collaborations from that table's own policy, so every signed-in read of the table
--     failed with infinite recursion (42P17, live 2026-10-19; 2 rows, no reader in the repo).
--   * organization_contributors_insert: the owner seat for the organization's recorded founder (active
--     business_ownership) only; join requests and owners adding people unchanged.
--   * update_contractor_contribution_count: a new row is a pending technician; an existing row keeps its status.
-- Existing rows are not touched. Both active rows on the one organization with deal records (a board member and a
-- technician) keep their access.
-- Contract: supabase/sql/test_org_member_policies_require_active.sql.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';
-- pg_get_expr qualifies names by search_path; the hashes below were taken with public on it.
SET LOCAL search_path = public;

-- The 17 policies and the trigger body this file was reviewed against (read 2026-10-19 23:00Z), or this file's result.
-- Hash: base64 SHA-256 of one line per policy ordered by table and name (table, name, cmd, permissive, role names or
-- 'public', USING, WITH CHECK, tab-separated).
DO $guard$
DECLARE
  v_hash text;
  v_trigger text;
BEGIN
  SELECT encode(sha256(convert_to(string_agg(
           c.relname || E'\t' || p.polname || E'\t' || p.polcmd::text || E'\t' || p.polpermissive::text || E'\t'
           || coalesce((SELECT string_agg(r.rolname, ',' ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY (p.polroles)), 'public')
           || E'\t' || coalesce(pg_get_expr(p.polqual, p.polrelid), '')
           || E'\t' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
           E'\n' ORDER BY c.relname, p.polname), 'UTF8')), 'base64')
    INTO v_hash
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
  WHERE c.relnamespace = 'public'::regnamespace AND (c.relname, p.polname) IN (
    ('deal_contacts', 'deal_contacts_org'), ('deal_documents', 'deal_docs_org'), ('deal_jackets', 'deal_jackets_org'),
    ('deal_jackets', 'deal_jackets_principals'), ('deal_reconditioning', 'deal_recon_org'),
    ('deal_vehicle_details', 'deal_vehicle_details_org'), ('documents', 'documents_insert_policy'),
    ('documents', 'documents_view_policy'), ('image_work_extractions', 'View work extractions'),
    ('location_collaborations', 'Organizations can manage own location collaborations'),
    ('location_collaborations', 'Organizations can view location collaborations'),
    ('organization_behavior_signals', 'obs_deal'), ('organization_behavior_signals', 'obs_org'),
    ('organization_capabilities', 'Manage own capabilities'),
    ('organization_contributors', 'organization_contributors_insert'),
    ('work_organization_matches', 'Update own work matches'), ('work_organization_matches', 'View work matches'));
  IF v_hash IS DISTINCT FROM 'kX06K1oOuKI+WcsbiyEKuqt1UOpAD1hVQNOWKa1oKjE=' AND v_hash IS DISTINCT FROM 'nZRlpt0vTJqoOywE011A+bDUeU63Wul3vBcdAMWJrAo=' THEN
    RAISE EXCEPTION 'organization member policies drifted from the 2026-10-19 read (hash %); not changing them', v_hash;
  END IF;
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO v_trigger
  FROM pg_proc WHERE oid = to_regprocedure('public.update_contractor_contribution_count()');
  IF v_trigger IS DISTINCT FROM 'rgtwFqP2wymBua2yWWuC5Sn52BCmNur//kfHbyMlkr0=' AND v_trigger IS DISTINCT FROM '/STDsCeWEfsSzPZfI3Xg0bFxUQ/E7Eub8S85vwG6OOY=' THEN
    RAISE EXCEPTION 'update_contractor_contribution_count differs from the reviewed definition (%)', v_trigger;
  END IF;
END $guard$;

-- Deal intelligence: active staff only.
ALTER POLICY deal_contacts_org ON public.deal_contacts
  USING (organization_id IN (SELECT oc.organization_id FROM public.organization_contributors oc
    WHERE oc.user_id = (SELECT auth.uid()) AND oc.status = 'active'
      AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager', 'employee', 'technician')));
ALTER POLICY deal_vehicle_details_org ON public.deal_vehicle_details
  USING (organization_id IN (SELECT oc.organization_id FROM public.organization_contributors oc
    WHERE oc.user_id = (SELECT auth.uid()) AND oc.status = 'active'
      AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager', 'employee', 'technician')));
ALTER POLICY deal_jackets_org ON public.deal_jackets
  USING (visibility IN ('public', 'org') AND organization_id IN (SELECT oc.organization_id FROM public.organization_contributors oc
    WHERE oc.user_id = (SELECT auth.uid()) AND oc.status = 'active'
      AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager', 'employee', 'technician')));
ALTER POLICY deal_docs_org ON public.deal_documents
  USING (deal_id IN (SELECT dj.id FROM public.deal_jackets dj
    JOIN public.organization_contributors oc ON oc.organization_id = dj.organization_id
    WHERE oc.user_id = (SELECT auth.uid()) AND oc.status = 'active'
      AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager', 'employee', 'technician')));
ALTER POLICY deal_recon_org ON public.deal_reconditioning
  USING (deal_id IN (SELECT dj.id FROM public.deal_jackets dj
    JOIN public.organization_contributors oc ON oc.organization_id = dj.organization_id
    WHERE oc.user_id = (SELECT auth.uid()) AND oc.status = 'active'
      AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager', 'employee', 'technician')));
ALTER POLICY obs_org ON public.organization_behavior_signals
  USING (visibility IN ('public', 'org') AND organization_id IN (SELECT oc.organization_id FROM public.organization_contributors oc
    WHERE oc.user_id = (SELECT auth.uid()) AND oc.status = 'active'
      AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager', 'employee', 'technician')));

-- Same role lists as before, active rows only.
ALTER POLICY deal_jackets_principals ON public.deal_jackets
  USING (visibility IN ('public', 'org', 'principals') AND (created_by = (SELECT auth.uid())
    OR organization_id IN (SELECT oc.organization_id FROM public.organization_contributors oc
      WHERE oc.user_id = (SELECT auth.uid()) AND oc.status = 'active' AND oc.role IN ('owner', 'admin'))));
ALTER POLICY obs_deal ON public.organization_behavior_signals
  USING (visibility IN ('public', 'org', 'deal') AND (reported_by = (SELECT auth.uid())
    OR organization_id IN (SELECT oc.organization_id FROM public.organization_contributors oc
      WHERE oc.user_id = (SELECT auth.uid()) AND oc.status = 'active' AND oc.role IN ('owner', 'admin'))));
ALTER POLICY documents_view_policy ON public.documents
  USING (is_public = true OR uploaded_by = (SELECT auth.uid())
    OR (entity_type = 'vehicle' AND entity_id IN (SELECT vehicles.id FROM public.vehicles WHERE vehicles.user_id = (SELECT auth.uid())))
    OR (entity_type = 'organization' AND entity_id IN (SELECT oc.organization_id FROM public.organization_contributors oc
      WHERE oc.user_id = (SELECT auth.uid()) AND oc.status = 'active'))
    OR (entity_type = 'user' AND entity_id = (SELECT auth.uid())));
ALTER POLICY documents_insert_policy ON public.documents
  WITH CHECK (uploaded_by = (SELECT auth.uid()) AND (
    (entity_type = 'vehicle' AND entity_id IN (SELECT vehicles.id FROM public.vehicles WHERE vehicles.user_id = (SELECT auth.uid())))
    OR (entity_type = 'organization' AND entity_id IN (SELECT oc.organization_id FROM public.organization_contributors oc
      WHERE oc.user_id = (SELECT auth.uid()) AND oc.status = 'active'))
    OR (entity_type = 'user' AND entity_id = (SELECT auth.uid()))
    OR (entity_type = 'timeline_event' AND entity_id IN (SELECT te.id FROM public.timeline_events te
      JOIN public.vehicles v ON v.id = te.vehicle_id WHERE v.user_id = (SELECT auth.uid())))));
ALTER POLICY "View work extractions" ON public.image_work_extractions
  USING (EXISTS (SELECT 1 FROM public.organization_vehicles ov
      WHERE ov.vehicle_id = image_work_extractions.vehicle_id
        AND EXISTS (SELECT 1 FROM public.organization_contributors oc
          WHERE oc.organization_id = ov.organization_id AND oc.user_id = (SELECT auth.uid()) AND oc.status = 'active'))
    OR EXISTS (SELECT 1 FROM public.vehicle_images vi
      WHERE vi.id = image_work_extractions.image_id AND vi.user_id = (SELECT auth.uid())));
ALTER POLICY "Organizations can manage own location collaborations" ON public.location_collaborations
  USING (EXISTS (SELECT 1 FROM public.organization_contributors oc
    WHERE oc.organization_id = location_collaborations.organization_id AND oc.user_id = (SELECT auth.uid())
      AND oc.status = 'active' AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager')));
ALTER POLICY "Organizations can view location collaborations" ON public.location_collaborations
  USING (EXISTS (SELECT 1 FROM public.organization_contributors oc
    WHERE oc.organization_id = location_collaborations.organization_id AND oc.user_id = (SELECT auth.uid())
      AND oc.status = 'active'));
ALTER POLICY "Manage own capabilities" ON public.organization_capabilities
  USING (EXISTS (SELECT 1 FROM public.organization_contributors oc
    WHERE oc.organization_id = organization_capabilities.organization_id AND oc.user_id = (SELECT auth.uid())
      AND oc.status = 'active' AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager')));
ALTER POLICY "Update own work matches" ON public.work_organization_matches
  USING (EXISTS (SELECT 1 FROM public.organization_contributors oc
    WHERE oc.organization_id = work_organization_matches.matched_organization_id AND oc.user_id = (SELECT auth.uid())
      AND oc.status = 'active' AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager')));
ALTER POLICY "View work matches" ON public.work_organization_matches
  USING (EXISTS (SELECT 1 FROM public.organization_contributors oc
      WHERE oc.organization_id = work_organization_matches.matched_organization_id AND oc.user_id = (SELECT auth.uid())
        AND oc.status = 'active')
    OR EXISTS (SELECT 1 FROM public.organization_vehicles ov
      WHERE ov.vehicle_id = work_organization_matches.vehicle_id
        AND EXISTS (SELECT 1 FROM public.organization_contributors oc2
          WHERE oc2.organization_id = ov.organization_id AND oc2.user_id = (SELECT auth.uid()) AND oc2.status = 'active')));

-- organization_contributors INSERT: a join request, the founder's owner seat, or an owner adding people.
ALTER POLICY organization_contributors_insert ON public.organization_contributors
  WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL
    AND (
      (user_id = (SELECT auth.uid())
        AND role IN ('contributor', 'photographer') AND status = 'pending'
        AND verification_method = 'self_claimed' AND verified_by IS NULL AND verified_at IS NULL)
      OR (user_id = (SELECT auth.uid())
        AND role = 'owner'
        AND verification_method = 'self_claimed' AND verified_by IS NULL AND verified_at IS NULL
        AND EXISTS (SELECT 1 FROM public.business_ownership bo
                    WHERE bo.business_id = organization_contributors.organization_id
                      AND bo.owner_id = (SELECT auth.uid())
                      AND bo.status = 'active'))
      OR EXISTS (SELECT 1 FROM public.organization_contributors oc
                 WHERE oc.organization_id = organization_contributors.organization_id
                   AND oc.user_id = (SELECT auth.uid())
                   AND oc.role IN ('owner', 'co_founder')
                   AND oc.status = 'active')));

-- A contractor's self-reported work asks to join; an owner decides.
CREATE OR REPLACE FUNCTION public.update_contractor_contribution_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Increment contribution count for the contractor
  INSERT INTO organization_contributors (
    organization_id,
    user_id,
    role,
    status,
    contribution_count,
    start_date
  )
  VALUES (
    NEW.organization_id,
    NEW.contractor_user_id,
    'technician', -- Default role for contractors
    'pending',
    1,
    NEW.work_date
  )
  ON CONFLICT (organization_id, user_id) 
  DO UPDATE SET
    contribution_count = organization_contributors.contribution_count + 1,
    updated_at = NOW();
  
  RETURN NEW;
END;
$function$;

COMMIT;
