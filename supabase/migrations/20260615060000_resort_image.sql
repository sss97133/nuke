-- Image re-sorting — the general, unbiased "put the picture where it belongs" primitive.
--
-- Misattribution is routine, not radioactive: bulk photo-cascade attributes a whole camera roll
-- to one vehicle, so frames of OTHER vehicles ride along. Re-homing one is just an operation, and
-- it's the same operation for every image. Append-only (testimony is never deleted — lineage is
-- recorded in merged_from_vehicle_id).
--
-- This is the APPLY-ARM for the existing detector `check-image-vehicle-match`, which flags strays
-- (image_vehicle_match_status='mismatch', suggested_vehicle_id=<vehicle>) but has no direct apply.
-- resort_image consumes that suggestion. Target resolution: explicit id > detector suggestion >
-- demote to pool (NULL). Demote is a last resort — the cron skips null-vehicle images as
-- low-signal, so they only get re-identified once the first-attribution drain exists
-- (attribute_testimony, ISSUES.md). Prefer reattribution.
--
-- Re-analysis gate: process-all-images-cron re-appraises images where
-- `ai_scan_metadata->appraiser->primary_label IS NULL`. Setting ai_processing_status alone does
-- NOT re-trigger it. So we CLEAR that label here, so the moved image is re-appraised in its new
-- vehicle's context.
--
-- SECURITY DEFINER so the sanctioned function does the write (the god-write hook guards raw agent
-- UPDATEs to testimony; this is the approved path). Owner/platform only; not on the public MCP.

CREATE OR REPLACE FUNCTION public.resort_image(p_image_id uuid, p_to_vehicle_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from uuid; v_suggested uuid; v_target uuid;
BEGIN
  SELECT vehicle_id, suggested_vehicle_id INTO v_from, v_suggested FROM vehicle_images WHERE id = p_image_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','image not found'); END IF;

  -- Resolve target: explicit > detector suggestion > demote-to-pool.
  v_target := COALESCE(p_to_vehicle_id, v_suggested);

  UPDATE vehicle_images
     SET vehicle_id = v_target,
         merged_from_vehicle_id = COALESCE(merged_from_vehicle_id, v_from),  -- lineage, first move only
         -- clear the appraiser gate the cron watches → re-appraise in the new context
         ai_scan_metadata = CASE WHEN ai_scan_metadata IS NULL THEN NULL
                                 ELSE ai_scan_metadata #- '{appraiser,primary_label}' END,
         ai_processing_status = 'pending',
         -- detector reconciliation: a resolved move is confirmed; a pure demote is unrelated.
         image_vehicle_match_status = CASE WHEN v_target IS NULL THEN 'unrelated' ELSE 'confirmed' END,
         suggested_vehicle_id = NULL
   WHERE id = p_image_id;

  RETURN jsonb_build_object(
    'image_id', p_image_id,
    'moved_from', v_from,
    'moved_to', v_target,
    'used_suggestion', (p_to_vehicle_id IS NULL AND v_suggested IS NOT NULL),
    'action', CASE WHEN v_target IS NULL THEN 'demoted_to_pool' ELSE 'reattributed' END,
    'requeued', true,
    'reason', p_reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.retag_image(p_image_id uuid, p_angle text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old text;
BEGIN
  SELECT angle INTO v_old FROM vehicle_images WHERE id = p_image_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','image not found'); END IF;
  UPDATE vehicle_images SET angle = p_angle WHERE id = p_image_id;
  RETURN jsonb_build_object('image_id', p_image_id, 'angle_was', v_old, 'angle_now', p_angle, 'reason', p_reason);
END;
$$;

COMMENT ON FUNCTION public.resort_image(uuid, uuid, text) IS
  'General image re-sort + apply-arm for check-image-vehicle-match: reattribute to a vehicle (explicit id or the detector''s suggested_vehicle_id) else DEMOTE to pool. Append-only (lineage in merged_from_vehicle_id), clears the appraiser gate to re-appraise, sets image_vehicle_match_status. Sanctioned path; owner/platform only.';
COMMENT ON FUNCTION public.retag_image(uuid, text, text) IS
  'Fix a misclassified image angle in place (e.g. a title mistagged exterior_side -> document).';
