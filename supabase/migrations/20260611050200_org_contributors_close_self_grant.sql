-- SECURITY: close the organization_contributors self-grant hole.
--
-- BEFORE: policy organization_contributors_insert allowed ANY authenticated
-- user to INSERT any row — including role='owner', status='active' for any
-- org. Owner role unlocks invite codes, deal jackets, org locations, org
-- updates, organization_vehicles management and more (32 policies depend on
-- this table). The UPDATE policy (organization_contributors_update_own) had
-- no WITH CHECK, so the same escalation worked by inserting a low row and
-- updating role → 'owner'.
--
-- AFTER:
--   INSERT (self, user_id = auth.uid()) allowed only when one of:
--     a) join request: role IN ('contributor','photographer') AND
--        status = 'pending' — an org owner activates it later;
--     b) creator owner-grant: role = 'owner' and the org row's
--        discovered_by = auth.uid() — this is exactly the CreateOrganization
--        / RestorationIntake flow (insert into businesses view with
--        discovered_by = user.id, then self-insert the owner row);
--     c) the inserter is already an active owner/co_founder of the org —
--        they may add rows for other users (any role).
--   UPDATE keeps USING (own rows) but gains a WITH CHECK that blocks
--   escalating a row to owner/co_founder unless (b) or (c) holds.
--
-- The self-EXISTS subqueries are safe from RLS recursion because the table's
-- SELECT policy is unconditional (organization_contributors_select: true).
--
-- NOTE for app code: AddOrganizationData.tsx upserts contributor/photographer
-- rows without status (column default 'active') — those upserts must send
-- status:'pending' to pass branch (a). Existing rows are untouched.

DROP POLICY IF EXISTS organization_contributors_insert ON public.organization_contributors;
CREATE POLICY organization_contributors_insert
ON public.organization_contributors
FOR INSERT
WITH CHECK (
  (SELECT auth.uid()) IS NOT NULL
  AND (
    -- (a) self join-request: low-privilege role, pending until approved
    (
      user_id = (SELECT auth.uid())
      AND role IN ('contributor', 'photographer')
      AND status = 'pending'
    )
    -- (b) org creator grants themself owner (CreateOrganization flow)
    OR (
      user_id = (SELECT auth.uid())
      AND role = 'owner'
      AND EXISTS (
        SELECT 1 FROM public.organizations o
        WHERE o.id = organization_id
          AND o.discovered_by = (SELECT auth.uid())
      )
    )
    -- (c) an active owner/co_founder of the org adds members
    OR EXISTS (
      SELECT 1 FROM public.organization_contributors oc
      WHERE oc.organization_id = organization_contributors.organization_id
        AND oc.user_id = (SELECT auth.uid())
        AND oc.role IN ('owner', 'co_founder')
        AND oc.status = 'active'
    )
  )
);

DROP POLICY IF EXISTS organization_contributors_update_own ON public.organization_contributors;
CREATE POLICY organization_contributors_update_own
ON public.organization_contributors
FOR UPDATE
USING (user_id = (SELECT auth.uid()))
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND (
    -- cannot escalate own row to a controlling role…
    role NOT IN ('owner', 'co_founder')
    -- …unless they created the org
    OR EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.id = organization_id
        AND o.discovered_by = (SELECT auth.uid())
    )
    -- …or are already an active owner/co_founder of it
    OR EXISTS (
      SELECT 1 FROM public.organization_contributors oc
      WHERE oc.organization_id = organization_contributors.organization_id
        AND oc.user_id = (SELECT auth.uid())
        AND oc.role IN ('owner', 'co_founder')
        AND oc.status = 'active'
    )
  )
);
