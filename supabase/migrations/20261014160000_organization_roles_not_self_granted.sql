-- Organization roles are granted, never self-asserted: a signed-in account can no longer make itself an
-- organization's owner or manager, and no existing role changes.
--
-- Live on 2026-10-14 (policies in supabase/sql/helpers/org_role_policies_live_20261014.sql), three self-grants
-- reached caller_manages_organization(), the check behind organization_vehicle_books (cost basis, sale price, asking
-- price, internal notes) and sold_vehicle_proof's sale price, and the business_ownership and approved-claim checks
-- that work_orders, organization_images, vehicle_observations (vo_subject_owner_read) and the organizations UPDATE
-- policies trust:
--   1. business_ownership "Owners manage own ownership" (ALL, USING owner_id = auth.uid(), no WITH CHECK): any
--      signed-in account inserts an active ownership row for any organization. That one row opens the organization's
--      work orders, private observations and internal images, and "Business owners can update their businesses",
--      which sets organizations.discovered_by to the caller; organization_contributors_insert then admits an active
--      owner row for the discoverer. Three writes to owner.
--   2. organization_ownership_verifications "Users submit org ownership claims" checks only user_id, so a claim can
--      arrive already 'approved'; "Owners/contributors update orgs" and vo_subject_owner_read trust approved claims.
--      The same chain to owner.
--   3. organization_contributors_update_own lets a member rewrite their own row, except into owner or co_founder
--      when they are not the discoverer: a pending join request, which anyone may file, becomes an active manager,
--      board member or employee, or moves to another organization. Two writes to manager.
-- Population: 11 contributor rows (2 active owner or board member, each its organization's discoverer and
-- uploader), 1 business_ownership row (a founder), 1 pending claim.
--
-- After:
--   * business_ownership: an owner reads their own rows. Only the service role and create_initial_business_ownership
--     (the definer trigger that records an organization's creator as its founder) write; INSERT, UPDATE, DELETE and
--     TRUNCATE are revoked from anon and authenticated.
--   * organization_ownership_verifications: a claim is filed 'pending' with no review field set. Only the service
--     role, the reviewer, moves it, as before.
--   * organization_contributors INSERT: a join request (contributor or photographer, pending, self_claimed) as before;
--     the owner seat for the organization's recorded founder (an active business_ownership row) or a claimant whose
--     claim the reviewer approved, in place of discovered_by, which every organizations UPDATE policy lets an editor
--     rewrite; an active owner or co-founder adds people, as before. A caller names no verifier for their own row.
--   * organization_contributors UPDATE: a member edits their own row (notes, dates, counts) and may step down, but
--     cannot change its organization, role or verification fields, or make it active unless it already was. The
--     prior version is read by id inside WITH CHECK: the statement's snapshot holds the row as it was before the
--     update.
-- Existing rows are not touched; both active owner and board member rows keep caller_manages_organization().
-- Contract: supabase/sql/test_organization_roles_not_self_granted.sql (CI job organization-roles-contract).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
-- pg_get_expr qualifies names by search_path; the hashes below were taken with public on it.
SET LOCAL search_path = public;

-- The policy sets this file was reviewed against (read 2026-10-14 10:21Z), or this file's own result on a second run.
-- Hash: base64 SHA-256 of one line per policy ordered by name (name, cmd, permissive, role names or 'public', USING,
-- WITH CHECK, tab-separated). The owner seat relies on create_initial_business_ownership as read the same morning.
DO $guard$
DECLARE
  t record;
  v_hash text;
  v_trigger_body text;
BEGIN
  FOR t IN SELECT * FROM (VALUES
      ('business_ownership', '9fhZL8e9nL6s6VBtEHM+P25zAvyRbFQeOAO4YsmO1m4=', 'xIHVho/5eAAV2v0Q6NgA5fF5sKMnmjp5aH07V3Y1CWc='),
      ('organization_contributors', 'R4c0+Y0LvKtNABRvnhYLUgxKuxfHPyVTIj2uZJuUAm0=', 'lNETl/KxFRDXMpgg6NWw+5U0vPdCuL8tFY9P48H4Bp0='),
      ('organization_ownership_verifications', '+2+rWomj4YzHGuV0jNZNPef850xilx80m8RISvGnbBo=', 's8DKEsijiWeGIPipwMKTIwmBmnxDpM6eoMbCRRrfkos='))
    AS v(tbl, live_hash, done_hash)
  LOOP
    SELECT encode(sha256(convert_to(string_agg(
             p.polname || E'\t' || p.polcmd::text || E'\t' || p.polpermissive::text || E'\t'
             || coalesce((SELECT string_agg(r.rolname, ',' ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY (p.polroles)), 'public')
             || E'\t' || coalesce(pg_get_expr(p.polqual, p.polrelid), '')
             || E'\t' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
             E'\n' ORDER BY p.polname), 'UTF8')), 'base64')
      INTO v_hash
    FROM pg_policy p
    WHERE p.polrelid = format('public.%I', t.tbl)::regclass;
    IF v_hash IS DISTINCT FROM t.live_hash AND v_hash IS DISTINCT FROM t.done_hash THEN
      RAISE EXCEPTION '% policies drifted from the 2026-10-14 read (hash %); not changing them', t.tbl, v_hash;
    END IF;
  END LOOP;
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO v_trigger_body
  FROM pg_proc WHERE oid = to_regprocedure('public.create_initial_business_ownership()');
  IF v_trigger_body IS DISTINCT FROM 'bbR2tsdhjw+OhFujEAcsiQDjPrJM7QI4qybwyRPvQHM=' THEN
    RAISE EXCEPTION 'create_initial_business_ownership differs from the reviewed definition (%)', v_trigger_body;
  END IF;
END $guard$;

-- business_ownership: read your own; written by the service role and the founder trigger only.
DROP POLICY IF EXISTS "Owners manage own ownership" ON public.business_ownership;
DROP POLICY IF EXISTS "Owners read own ownership" ON public.business_ownership;
CREATE POLICY "Owners read own ownership" ON public.business_ownership
  FOR SELECT USING (owner_id = (SELECT auth.uid()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.business_ownership FROM anon, authenticated;

-- organization_ownership_verifications: a claim arrives unreviewed.
DROP POLICY IF EXISTS "Users submit org ownership claims" ON public.organization_ownership_verifications;
CREATE POLICY "Users submit org ownership claims" ON public.organization_ownership_verifications
  FOR INSERT WITH CHECK (
    user_id = (SELECT auth.uid())
    AND status = 'pending'
    AND human_reviewer_id IS NULL AND human_reviewed_at IS NULL AND human_review_notes IS NULL
    AND approved_at IS NULL AND rejection_reason IS NULL
    AND ai_confidence_score IS NULL AND ai_processed_at IS NULL);

-- organization_contributors INSERT: a join request, the founder's or approved claimant's owner seat, or an owner
-- adding people.
DROP POLICY IF EXISTS organization_contributors_insert ON public.organization_contributors;
CREATE POLICY organization_contributors_insert ON public.organization_contributors
  FOR INSERT WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL
    AND (
      (user_id = (SELECT auth.uid())
        AND role IN ('contributor', 'photographer') AND status = 'pending'
        AND verification_method = 'self_claimed' AND verified_by IS NULL AND verified_at IS NULL)
      OR (user_id = (SELECT auth.uid())
        AND role = 'owner'
        AND verification_method = 'self_claimed' AND verified_by IS NULL AND verified_at IS NULL
        AND (EXISTS (SELECT 1 FROM public.business_ownership bo
                     WHERE bo.business_id = organization_contributors.organization_id
                       AND bo.owner_id = (SELECT auth.uid())
                       AND bo.status = 'active')
             OR EXISTS (SELECT 1 FROM public.organization_ownership_verifications v
                        WHERE v.organization_id = organization_contributors.organization_id
                          AND v.user_id = (SELECT auth.uid())
                          AND v.status = 'approved')))
      OR EXISTS (SELECT 1 FROM public.organization_contributors oc
                 WHERE oc.organization_id = organization_contributors.organization_id
                   AND oc.user_id = (SELECT auth.uid())
                   AND oc.role IN ('owner', 'co_founder')
                   AND oc.status = 'active')));

-- organization_contributors UPDATE: your own row, never raised.
DROP POLICY IF EXISTS organization_contributors_update_own ON public.organization_contributors;
CREATE POLICY organization_contributors_update_own ON public.organization_contributors
  FOR UPDATE
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.organization_contributors prior
                WHERE prior.id = organization_contributors.id
                  AND prior.organization_id = organization_contributors.organization_id
                  AND prior.user_id = organization_contributors.user_id
                  AND prior.role = organization_contributors.role
                  AND prior.verification_method = organization_contributors.verification_method
                  AND prior.verified_by IS NOT DISTINCT FROM organization_contributors.verified_by
                  AND prior.verified_at IS NOT DISTINCT FROM organization_contributors.verified_at
                  AND (organization_contributors.status IS DISTINCT FROM 'active' OR prior.status = 'active')));

COMMIT;
