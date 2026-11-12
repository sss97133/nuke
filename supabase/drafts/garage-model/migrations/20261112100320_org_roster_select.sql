-- DRAFT — NOT APPLIED. Do not move into supabase/migrations without Skylar's approval.
--
-- Hole 2 (MODEL.md section 9, SPEC H2): organization_contributors_select is USING (true) for {public} (anon included).
-- Anyone can read any organization's roster: user ids, roles, status, verification method, contribution counts.
-- 10 rows live (exact read 2026-11-12), all active and self_claimed.
--
-- After:
--   * SELECT: your own rows, or the rows of an organization you belong to or own (org_roster_visible, SECURITY DEFINER so the
--     policy does not recurse into itself), or an admin. Anon reads nothing.
--   * org_public_contributors(org): what a public organization page may show a stranger: role, contribution_count, since, with NO
--     user id, and only active rows. Members get the user id too.
-- 34 policies on 23 other tables subselect organization_contributors; every one constrains the subselect to the caller's own
-- row (oc.user_id = auth.uid()), which this policy keeps visible (counted in the 2026-11-12 policy snapshot), so none changes.
-- Callers that read ANOTHER user's row (found by grep, VISIBILITY.md section 4): nuke_frontend/src/pages/OrganizationProfile.tsx
-- (roster list, user_id + role + contribution_count) must move to org_public_contributors() BEFORE this applies; the service-role
-- edge functions (auto-merge-duplicate-orgs, extract-vin-from-vehicle) bypass RLS.
-- Writes are not touched (insert and update_own stay as they are).
--
-- Rollback at the bottom.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.org_roster_visible(p_org uuid, p_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_user IS NOT NULL AND p_org IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.organization_contributors oc
            WHERE oc.organization_id = p_org AND oc.user_id = p_user AND oc.status = 'active')
    OR EXISTS (SELECT 1 FROM public.business_ownership bo
               WHERE bo.business_id = p_org AND bo.owner_id = p_user AND bo.status = 'active')
    OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = p_user AND au.is_active)
  )
$$;
COMMENT ON FUNCTION public.org_roster_visible(uuid, uuid) IS
  'May this user read the whole roster of this organization: active member, active owner or admin.';

CREATE OR REPLACE FUNCTION public.org_public_contributors(p_org uuid)
RETURNS TABLE (contributor_ref uuid, role text, contribution_count integer, since timestamptz, user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT oc.id, oc.role, oc.contribution_count, oc.created_at,
         CASE WHEN public.org_roster_visible(p_org) THEN oc.user_id END
  FROM public.organization_contributors oc
  WHERE oc.organization_id = p_org AND oc.status = 'active'
  ORDER BY oc.created_at
$$;
COMMENT ON FUNCTION public.org_public_contributors(uuid) IS
  'Public-safe roster: role, count and join date; the user id only for members of the organization.';

REVOKE EXECUTE ON FUNCTION public.org_roster_visible(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_roster_visible(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.org_public_contributors(uuid) TO anon, authenticated, service_role;

-- No "(SELECT auth.uid())" here on purpose: a sub-select makes Postgres treat the policy as having sublinks, and the live INSERT policy
-- (its third arm reads organization_contributors) would then fail with "infinite recursion detected in policy". Found by the contract
-- test. The table has 10 rows, so the per-row auth.uid() call costs nothing.
DROP POLICY IF EXISTS organization_contributors_select ON public.organization_contributors;
CREATE POLICY organization_contributors_select ON public.organization_contributors AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.org_roster_visible(organization_id, auth.uid()));

-- Rollback:
--   DROP POLICY organization_contributors_select ON public.organization_contributors;
--   CREATE POLICY organization_contributors_select ON public.organization_contributors AS PERMISSIVE FOR SELECT USING (true);
--   (the two helper functions may stay)
