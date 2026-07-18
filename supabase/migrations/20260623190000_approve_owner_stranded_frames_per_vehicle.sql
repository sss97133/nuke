-- Hotfix: make approve_owner_stranded_frames actually runnable.
--
-- The first cut (20260623180000) did ONE user-scoped UPDATE:
--   WHERE user_id = p_user_id AND vision_gate_status IN ('review_needed','pending') ...
-- MEASURED failure: that statement times out. vehicle_images is 38.9M rows, and the
-- moment a `vision_gate_status IN (...)` enum predicate is present the planner abandons
-- the user_id index and full-scans the table — even the equivalent SELECT hits the
-- statement timeout (57014). A user-scoped GROUP BY with NO enum predicate runs fine,
-- which pinned the bad plan on the enum filter.
--
-- Fix: drive the UPDATE off the selective per-vehicle index instead. A single
-- vehicle_id literal makes the planner pick vehicle_images_vehicle_id_idx:
--   Index Scan ... (actual time=0.739 ms)   [EXPLAIN ANALYZE, 2026-06-23]
-- The owner has ~211 vehicles, so the loop is ~211 sub-millisecond index scans plus
-- per-row trigger work on the ~1.3k matched frames ≈ well under a second. Same scope,
-- same safety (still user_id-bounded, still never touches explicit rejects), now runnable.

CREATE OR REPLACE FUNCTION public.approve_owner_stranded_frames(p_user_id uuid)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_total   bigint := 0;
  v_rows    bigint;
  v_vehicle uuid;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'p_user_id required'; END IF;
  -- Belt-and-suspenders: the loop is already fast, but never let a slow tail kill the
  -- whole rescue mid-way. Applies only within this SECURITY DEFINER call's transaction.
  SET LOCAL statement_timeout = '120s';

  FOR v_vehicle IN
    SELECT id FROM vehicles WHERE user_id = p_user_id
  LOOP
    UPDATE vehicle_images
    SET vision_gate_status = 'approved',
        vision_gate_agent_reasoning = 'owner-assigned frame: context-approved (was '
          || vision_gate_status || '); gate could not independently re-confirm in isolation',
        vision_gate_processed_at = now()
    WHERE vehicle_id = v_vehicle           -- selective: uses vehicle_images_vehicle_id_idx
      AND user_id = p_user_id              -- safety: owner's own rows only
      AND vision_gate_status IN ('review_needed', 'pending')
      AND COALESCE(is_superseded, false) = false;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_total := v_total + v_rows;
  END LOOP;

  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.approve_owner_stranded_frames(uuid) IS
  'Promote an owner''s own assigned-but-gate-stranded frames (review_needed/pending) to '
  'approved so they enter analysis + gallery. Loops per vehicle to stay on the vehicle_id '
  'index (a single user-scoped UPDATE full-scans the 38.9M-row table). Never touches '
  'explicit rejects. Reversible.';
