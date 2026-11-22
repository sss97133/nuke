-- approve_vehicle_merge_proposal: the sanctioned way to record a reviewer's approval of a filed merge proposal. It never merges.
--
-- Why (2026-11-21): the reversible merge path is propose_vehicle_merge -> approval -> merge_into_primary -> unmerge_vehicle.
-- Gate 2 of merge_into_primary lets an owned pair merge only when a vehicle_merge_proposals row for the pair (either
-- direction) has status = 'approved' AND reviewed_by IS NOT NULL. No writer set that: the only way was a raw UPDATE on the
-- proposals table, which the house rules forbid. This function is that step, and only that step.
--
-- Contract:
--   - Callers: the service role (a job acting on approval the owner gave elsewhere, recorded in p_note), or a signed-in
--     user who is p_reviewer and can edit both vehicles (user_can_edit_vehicle, the helper merge_duplicate_vehicles uses).
--     anon is refused by grant and by the body.
--   - Moves an open proposal ('proposed' or 'detected'; the status CHECK has no 'pending') to 'approved', recording
--     reviewed_by, reviewed_at and review_notes (how the approval was given). The row is locked while it is read.
--   - When the proposal names requires_approval_from, p_reviewer must be that person.
--   - Both vehicles must still be live (not merged, not deleted).
--   - The same reviewer approving an approved row again is a no-op (returns already_approved = true and changes nothing).
--   - Everything else raises: a missing proposal, a blank note, no reviewer, a different reviewer of an approved row, and
--     a rejected, merged, auto_merged or unmerged row (a closed decision is not reopened here).
--   - The row it leaves satisfies exactly what merge_into_primary checks before an owned merge: status = 'approved' AND
--     reviewed_by IS NOT NULL. It does not touch any vehicle, image or observation.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.approve_vehicle_merge_proposal(
  p_proposal_id uuid,
  p_reviewer uuid,
  p_note text
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role text := coalesce(auth.role(), '');
  v_uid uuid := auth.uid();
  v_row public.vehicle_merge_proposals%ROWTYPE;
BEGIN
  IF v_role = 'anon' THEN
    RAISE EXCEPTION 'approve_vehicle_merge_proposal: sign in to approve a merge' USING ERRCODE = '42501';
  END IF;
  IF p_proposal_id IS NULL OR p_reviewer IS NULL THEN
    RAISE EXCEPTION 'approve_vehicle_merge_proposal: a proposal and a reviewer are required' USING ERRCODE = '22023';
  END IF;
  IF coalesce(btrim(p_note), '') = '' THEN
    RAISE EXCEPTION 'approve_vehicle_merge_proposal: a note saying how the approval was given is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.vehicle_merge_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approve_vehicle_merge_proposal: proposal % not found', p_proposal_id USING ERRCODE = 'P0002';
  END IF;

  -- A signed-in caller approves only as themself, and only for two vehicles they can edit.
  IF v_role = 'authenticated' THEN
    IF v_uid IS NULL OR p_reviewer IS DISTINCT FROM v_uid
       OR NOT public.user_can_edit_vehicle(v_row.primary_vehicle_id, v_uid)
       OR NOT public.user_can_edit_vehicle(v_row.duplicate_vehicle_id, v_uid) THEN
      RAISE EXCEPTION 'approve_vehicle_merge_proposal: you must be the reviewer and able to edit both vehicles' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_row.requires_approval_from IS NOT NULL AND v_row.requires_approval_from IS DISTINCT FROM p_reviewer THEN
    RAISE EXCEPTION 'approve_vehicle_merge_proposal: this proposal waits for a different approver' USING ERRCODE = '42501';
  END IF;

  IF v_row.status = 'approved' THEN
    IF v_row.reviewed_by IS NOT DISTINCT FROM p_reviewer THEN
      RETURN jsonb_build_object('proposal_id', v_row.id, 'status', v_row.status, 'already_approved', true,
        'reviewed_by', v_row.reviewed_by, 'reviewed_at', v_row.reviewed_at);
    END IF;
    RAISE EXCEPTION 'approve_vehicle_merge_proposal: already approved by another reviewer' USING ERRCODE = '22023';
  END IF;
  IF v_row.status NOT IN ('proposed', 'detected') THEN
    RAISE EXCEPTION 'approve_vehicle_merge_proposal: a % proposal cannot be approved', v_row.status USING ERRCODE = '22023';
  END IF;

  IF (SELECT count(*) FROM public.vehicles
       WHERE id IN (v_row.primary_vehicle_id, v_row.duplicate_vehicle_id)
         AND status IS DISTINCT FROM 'merged' AND deleted_at IS NULL) <> 2 THEN
    RAISE EXCEPTION 'approve_vehicle_merge_proposal: both vehicles must be live (not merged, not deleted)' USING ERRCODE = '22023';
  END IF;

  UPDATE public.vehicle_merge_proposals
     SET status = 'approved', reviewed_by = p_reviewer, reviewed_at = now(), review_notes = btrim(p_note), updated_at = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('proposal_id', v_row.id, 'status', v_row.status, 'already_approved', false,
    'reviewed_by', v_row.reviewed_by, 'reviewed_at', v_row.reviewed_at,
    'primary_vehicle_id', v_row.primary_vehicle_id, 'duplicate_vehicle_id', v_row.duplicate_vehicle_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.approve_vehicle_merge_proposal(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_vehicle_merge_proposal(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_vehicle_merge_proposal(uuid, uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.approve_vehicle_merge_proposal(uuid, uuid, text) IS
  'Moves an open (proposed/detected) vehicle_merge_proposals row to approved with reviewer, time and note; the row then passes merge_into_primary Gate 2. Service role, or the signed-in reviewer who can edit both vehicles. Idempotent for the same reviewer; refuses closed rows. Never merges.';

COMMIT;
