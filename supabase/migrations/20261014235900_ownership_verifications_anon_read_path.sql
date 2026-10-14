-- Logged-out vehicle profiles read again: anon gets back SELECT on ownership_verifications, and row security still
-- shows anon no row.
--
-- Measured 2026-10-14 22:46Z, logged out: POST /rest/v1/rpc/vehicle_profile_read on the K5 returned 401 (42501
-- "permission denied for table ownership_verifications"), and so did the vehicle page's direct read of the table.
-- The logged-out page probe went from 0 failed requests (10:30Z) to 3 per vehicle-page load.
-- 20261014234500_ownership_verifications_select_scoped dropped the USING (true) read policy and revoked anon's
-- SELECT. vehicle_profile_read is SECURITY INVOKER and executable by anon; its viewer CASE references
-- ownership_verifications in a branch anon never reaches, but Postgres checks table privileges when the statement
-- starts, so the whole read fails for every logged-out visitor.
-- Row security keeps the rows private: the read policies left admit the claimant's own rows (auth.uid() = user_id)
-- and active admin_users rows, and for anon auth.uid() is null, so anon reads no row. The grant restores the read
-- path and exposes nothing. Writes are unchanged.
-- Contract: supabase/sql/test_ownership_verifications_anon_read_path.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ownership_verifications'
             AND cmd IN ('SELECT', 'ALL') AND coalesce(qual, 'true') = 'true') THEN
    RAISE EXCEPTION 'ownership_verifications has a read policy that admits every row; not granting anon SELECT';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ownership_verifications'::regclass) THEN
    RAISE EXCEPTION 'ownership_verifications has row security off; not granting anon SELECT';
  END IF;
END $guard$;

GRANT SELECT ON public.ownership_verifications TO anon;

DO $check$
BEGIN
  IF NOT has_table_privilege('anon', 'public.ownership_verifications', 'SELECT') THEN
    RAISE EXCEPTION 'anon SELECT on ownership_verifications did not land';
  END IF;
END $check$;

COMMIT;
