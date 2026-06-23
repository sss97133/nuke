-- Rescue an owner's own frames that the vision gate stranded.
--
-- The gate (photo-pipeline-orchestrator) parks frames in 'review_needed' / 'pending' when its
-- per-frame matcher can't INDEPENDENTLY re-confirm which vehicle they show — e.g. a masked,
-- freshly-painted panel with no badge/plate/VIN. But these frames are already ASSIGNED to one
-- of the OWNER's vehicles (vehicle_id set) and live under the owner's user_id. Holding an
-- owner's own assigned photo out of both analysis and the gallery, forever, over a pixel
-- matcher's uncertainty is pointless conservatism — and manual per-frame review doesn't scale
-- (the owner can still reject in-app). This promotes those frames to 'approved' so they flow
-- into the deep-analysis drain (approved/null whitelist) and the gallery (same whitelist).
--
-- Scope is deliberately narrow and safe:
--   • owner's own rows (user_id = p_user_id), already assigned to a vehicle
--   • ONLY 'review_needed' and 'pending' (gate couldn't decide / hasn't run)
--   • NEVER touches explicit safety rejects: 'rejected_personal', 'rejected_misattributed'
-- image_vehicle_match_status is left as-is; the deep analysis sets it properly when it runs.
-- Reversible (a status flip). SECURITY DEFINER, no model spend.

CREATE OR REPLACE FUNCTION public.approve_owner_stranded_frames(p_user_id uuid)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_count bigint;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'p_user_id required'; END IF;
  UPDATE vehicle_images
  SET vision_gate_status = 'approved',
      vision_gate_agent_reasoning = 'owner-assigned frame: context-approved (was '
        || vision_gate_status || '); gate could not independently re-confirm in isolation',
      vision_gate_processed_at = now()
  WHERE user_id = p_user_id
    AND vehicle_id IS NOT NULL
    AND vision_gate_status IN ('review_needed', 'pending')
    AND COALESCE(is_superseded, false) = false;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.approve_owner_stranded_frames(uuid) IS
  'Promote an owner''s own assigned-but-gate-stranded frames (review_needed/pending) to '
  'approved so they enter analysis + gallery. Never touches explicit rejects. Reversible.';
