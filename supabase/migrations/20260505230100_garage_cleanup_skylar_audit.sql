-- Garage cleanup record — Skylar's user_id only.
--
-- Audit context: 2026-05-05 garage UX audit found shkylar@gmail.com
-- (user_id 0b9f107a-d124-49de-9ded-94698f63c1c4) had 102 active
-- vehicle_user_permissions rows totaling $2.26M in dashboard estimate.
-- Reality: 4-5 owned vehicles, ~$280K. Three classes of contamination:
--
--   1. 19 OWNER rows from a 2026-03-09 backfill batch — all granted_by
--      NULL, all created in a single hour, all targeting vehicles
--      Skylar uploaded for research. The script promoted "uploaded_by"
--      into "owner" without consent or evidence.
--
--   2. 10 dangling perms pointing at vehicle_ids hard-deleted from
--      the vehicles table. Per agent-trust-invariants this should
--      never have happened — testimony is permanent. The perms
--      themselves are revoked here, not deleted, in case the
--      ghost vehicles are restored via unmerge.
--
--   3. 2 perms pointing at vehicles with status='merged'. The frontend
--      filter (VISIBLE_STATUSES in useVehiclesDashboard.ts) hides
--      these, but leaving the perm "active" asserts ownership of a
--      superseded entity.
--
-- Plus 1 ownership_verifications row pointing at a deleted vehicle
-- (05f27cc4) — set to status='expired' with rejection_reason noting
-- the cleanup.
--
-- Application: applied via REST PATCH on 2026-05-05T23:03Z. This file
-- is the audit record; re-running it is a no-op (the rows are already
-- is_active=false). Per agent-trust-invariants no DELETE is performed.
--
-- Companion migration 20260505230000_enforce_evidence_allow_revocation.sql
-- fixed the enforce_user_vehicle_evidence trigger to allow revocation
-- without re-validating evidence — the trigger had been blocking
-- legitimate supersession PATCHes on OWNER rows.

-- No-op confirmation: count active OWNER perms whose granted_by is NULL.
-- Should return 1 (the K5, granted before the 03-09 batch).
DO $$
DECLARE
  v_active_null_owner_count int;
BEGIN
  SELECT COUNT(*) INTO v_active_null_owner_count
  FROM public.vehicle_user_permissions
  WHERE user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
    AND role = 'owner'
    AND is_active = true
    AND granted_by IS NULL;

  IF v_active_null_owner_count > 1 THEN
    RAISE WARNING 'Expected ≤1 active OWNER perm with NULL granted_by for Skylar after cleanup; got %',
      v_active_null_owner_count;
  END IF;
END $$;
