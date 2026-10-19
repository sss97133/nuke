-- A vehicle ownership-verification row (title/ID document URLs and names) is readable only by the claimant, an
-- admin, and the service role — not by every visitor.
--
-- Live on 2026-10-14, ownership_verifications had "ownership_verifications_select" (SELECT TO public USING true) and
-- the table-wide SELECT granted to anon, so a logged-out visitor read every verification row for any vehicle:
-- title_document_url, drivers_license_url, face_scan_url, title_owner_name, license_holder_name. The public vehicle
-- profile's popups (DataValidationPopup, ValidationPopupV2) select these per vehicle. Today the 6 rows' document URLs
-- are the placeholder 'pending' and face_scan_url is null (measured), so no real document is exposed yet; this closes
-- it before real uploads arrive.
--
-- After: the blanket USING (true) SELECT policy is dropped, and SELECT is revoked from anon. The remaining readers
-- are "Users can view own verifications" (the claimant), ownership_verifications_admin_access (active admins) and the
-- service role (bypasses RLS). A non-owner — logged out or signed in — reads no row, so the public popups show the
-- claimant's documents to nobody but the claimant and admins. Insert/update and the other policies are unchanged
-- (this is orthogonal to #1219's pending-claim rules; it touches only the blanket SELECT, guarded narrowly).
-- Contract: supabase/sql/test_ownership_verifications_select_scoped.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = public;

-- Narrow guard: only the blanket SELECT policy is in scope, so this is independent of any other policy change on the
-- table. It must be the permissive, PUBLIC, USING (true) SELECT policy as read on 2026-10-14, or already gone (re-run).
DO $guard$
DECLARE v_qual text; v_exists boolean;
BEGIN
  SELECT (pg_get_expr(polqual, polrelid)), true INTO v_qual, v_exists
    FROM pg_policy WHERE polrelid = 'public.ownership_verifications'::regclass AND polname = 'ownership_verifications_select';
  IF v_exists IS NOT TRUE THEN
    RETURN; -- already dropped
  END IF;
  IF v_qual IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'ownership_verifications_select is not the expected USING (true) policy (%); not changing it', v_qual;
  END IF;
END $guard$;

DROP POLICY IF EXISTS ownership_verifications_select ON public.ownership_verifications;
REVOKE SELECT ON public.ownership_verifications FROM anon;

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.ownership_verifications'::regclass AND polname = 'ownership_verifications_select')
     OR has_table_privilege('anon', 'public.ownership_verifications', 'SELECT')
     OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.ownership_verifications'::regclass AND polname = 'Users can view own verifications') THEN
    RAISE EXCEPTION 'ownership_verifications select scoping did not land as written';
  END IF;
END $check$;

COMMIT;
