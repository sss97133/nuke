-- A self-inserted vehicle_contributors row can no longer grant access to a vehicle the caller does not own.
--
-- Live on 2026-10-14: insert_self_contributor (WITH CHECK user_id = auth.uid() OR user_id =
-- '0b9f107a-d124-49de-9ded-94698f63c1c4') and update_self_contributor (USING the same) put no limit on vehicle_id,
-- role, status or the can_* flags. The AFTER trigger enforce_contributor_evidence only requires one vehicle_images
-- row for (vehicle_id, user_id), and image upload to any vehicle is open, so a signed-in account could: upload an
-- image to any vehicle, then insert a row {that vehicle, self, role 'owner', status 'active'}. vehicle_user_has_access
-- then returns true (it trusts an active row with an owner/restorer/mechanic/… role) and user_can_edit_vehicle too
-- (active + can_edit), opening that vehicle's purchase_price/date/location (vehicle_owner_books), work orders and
-- private images — owner of any vehicle in two writes. The hardcoded-uuid branch also let ANY caller write
-- contributor rows AS that account (an admin that owns 331 vehicles), a standing back door.
--
-- After:
--   * A self-insert or self-update is for the caller's own row (user_id = auth.uid()); the hardcoded-uuid branch is
--     dropped (that account signs in as itself like everyone else).
--   * It may set any role/status/flags ONLY on a vehicle the caller owns (owner_id, user_id, uploaded_by or
--     created_by_user_id) — they already have access, so it grants nothing new. On any other vehicle the row must be
--     an unverified claim: status 'pending' with can_edit, can_delete, can_approve and can_sell all false, which
--     neither vehicle_user_has_access (needs 'active') nor user_can_edit_vehicle (needs active + can_edit) accepts.
--   * The vehicle's owner still assigns privileged, active roles through "Users can manage contributors for vehicles
--     they own", and an approved ownership_verification still grants owner through its trigger. Those paths are
--     unchanged; the read policies are unchanged.
-- Existing rows are untouched. The policy-set hash is guarded.
-- Live policies: supabase/sql/helpers/vehicle_contributors_live_20261014.sql.
-- Contract: supabase/sql/test_vehicle_contributors_no_self_grant.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = public;

DO $guard$
DECLARE v_hash text;
BEGIN
  SELECT encode(sha256(convert_to(string_agg(
           p.polname || E'\t' || p.polcmd::text || E'\t' || p.polpermissive::text || E'\t'
           || coalesce((SELECT string_agg(r.rolname, ',' ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY (p.polroles)), 'public')
           || E'\t' || coalesce(pg_get_expr(p.polqual, p.polrelid), '')
           || E'\t' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
           E'\n' ORDER BY p.polname), 'UTF8')), 'base64')
    INTO v_hash
  FROM pg_policy p WHERE p.polrelid = 'public.vehicle_contributors'::regclass;
  IF v_hash NOT IN ('2GGlz5/MpLrgQvC04ODQJg+PHrOS3bkWptq9dx20eNE=', 'pjHC0UMSPD+9skyygdKfrBCPS+IR/tcqUZARRrUtijY=') THEN
    RAISE EXCEPTION 'vehicle_contributors policies drifted from the 2026-10-14 read (hash %); not changing them', v_hash;
  END IF;
END $guard$;

DROP POLICY IF EXISTS insert_self_contributor ON public.vehicle_contributors;
CREATE POLICY insert_self_contributor ON public.vehicle_contributors
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (
      EXISTS (SELECT 1 FROM public.vehicles v
              WHERE v.id = vehicle_contributors.vehicle_id
                AND (SELECT auth.uid()) IN (v.owner_id, v.user_id, v.uploaded_by, v.created_by_user_id))
      OR (status = 'pending'
          AND coalesce(can_edit, false) = false AND coalesce(can_delete, false) = false
          AND coalesce(can_approve, false) = false AND coalesce(can_sell, false) = false)
    ));

DROP POLICY IF EXISTS update_self_contributor ON public.vehicle_contributors;
CREATE POLICY update_self_contributor ON public.vehicle_contributors
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (
      EXISTS (SELECT 1 FROM public.vehicles v
              WHERE v.id = vehicle_contributors.vehicle_id
                AND (SELECT auth.uid()) IN (v.owner_id, v.user_id, v.uploaded_by, v.created_by_user_id))
      OR (status = 'pending'
          AND coalesce(can_edit, false) = false AND coalesce(can_delete, false) = false
          AND coalesce(can_approve, false) = false AND coalesce(can_sell, false) = false)
    ));

COMMIT;
