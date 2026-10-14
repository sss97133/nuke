-- A vehicle-ownership claim arrives pending, and only a reviewer approves it. A signed-in account can no longer
-- grant itself ownership of a vehicle.
--
-- Live on 2026-10-14, ownership_verifications had three self-insert policies (all WITH CHECK only user_id = auth.uid())
-- and one self-update policy (user_id = auth.uid(), no column limit). The AFTER INSERT OR UPDATE OF status trigger
-- trg_auto_grant_owner (auto_grant_owner_on_verification) inserts a vehicle_user_permissions 'owner' row whenever a
-- row reaches status 'approved'. So a signed-in account could insert a verification for any vehicle_id with
-- user_id = self and status 'approved' (or self-update an existing row to 'approved') and be granted owner, which
-- vehicle_user_has_access trusts: it opens the vehicle's purchase_price/date/location (vehicle_owner_books), its work
-- orders and its private images. Population: 6 rows (4 approved, 2 expired).
--
-- After:
--   * A self-insert must be status 'pending' with no reviewer or decision field set (human_reviewer_id,
--     human_reviewed_at, human_review_notes, approved_at, rejected_at, rejection_reason all null). The three insert
--     policies collapse to one, ownership_verifications_insert_self, TO authenticated.
--   * A self-update (re-uploading documents) must leave the row pending with no reviewer or decision field set, so
--     the claimant can never move their own claim to 'approved'. The check names only the new row's columns — it does
--     not query ownership_verifications, which would recurse against the FOR ALL admin policy.
--   * Approval is unchanged: ownership_verifications_admin_access (active admins) and the service role, which both
--     bypass these self policies, still set 'approved', and the trigger then grants owner.
-- Existing rows are untouched. This does not change who may READ the table (ownership_verifications_select is still
-- USING (true) — reported separately).
-- Live policies and trigger: supabase/sql/helpers/ownership_verifications_live_20261014.sql.
-- Contract: supabase/sql/test_ownership_verifications_arrive_pending.sql (CI job ownership-verifications-contract).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = public;

DO $guard$
DECLARE
  v_hash text;
  v_fn text;
BEGIN
  SELECT encode(sha256(convert_to(string_agg(
           p.polname || E'\t' || p.polcmd::text || E'\t' || p.polpermissive::text || E'\t'
           || coalesce((SELECT string_agg(r.rolname, ',' ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY (p.polroles)), 'public')
           || E'\t' || coalesce(pg_get_expr(p.polqual, p.polrelid), '')
           || E'\t' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
           E'\n' ORDER BY p.polname), 'UTF8')), 'base64')
    INTO v_hash
  FROM pg_policy p WHERE p.polrelid = 'public.ownership_verifications'::regclass;
  IF v_hash NOT IN ('eRsDpwfz/KEF71HYdOJJYXnWkhwVkh6Oz/A9Wh973gY=', 'I+7c7s493nCwyfUI+HavjsgheJzXtbAQTvu8onuUFXI=') THEN
    RAISE EXCEPTION 'ownership_verifications policies drifted from the 2026-10-14 read (hash %); not changing them', v_hash;
  END IF;
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO v_fn
    FROM pg_proc WHERE oid = to_regprocedure('public.auto_grant_owner_on_verification()');
  IF v_fn IS DISTINCT FROM 'QDX/sp/LVEO7EnaYDioNRu9avp3bQwNA+S8VPAgPE04=' THEN
    RAISE EXCEPTION 'auto_grant_owner_on_verification differs from the reviewed definition (%)', v_fn;
  END IF;
END $guard$;

-- One self-insert policy: a pending claim with no decision field set.
DROP POLICY IF EXISTS "Users can create own verifications" ON public.ownership_verifications;
DROP POLICY IF EXISTS ownership_verifications_insert ON public.ownership_verifications;
DROP POLICY IF EXISTS ownership_verifications_insert_self ON public.ownership_verifications;
CREATE POLICY ownership_verifications_insert_self ON public.ownership_verifications
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND status = 'pending'
    AND human_reviewer_id IS NULL AND human_reviewed_at IS NULL AND human_review_notes IS NULL
    AND approved_at IS NULL AND rejected_at IS NULL AND rejection_reason IS NULL);

-- Self-update may not move status or any reviewer/decision field.
DROP POLICY IF EXISTS "Users can update their own verification documents" ON public.ownership_verifications;
CREATE POLICY "Users can update their own verification documents" ON public.ownership_verifications
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND status = 'pending'
    AND human_reviewer_id IS NULL AND human_reviewed_at IS NULL AND human_review_notes IS NULL
    AND approved_at IS NULL AND rejected_at IS NULL AND rejection_reason IS NULL);

COMMIT;
