-- propose_vehicle_merge: the sanctioned way to file an evidence-backed merge proposal for review. It never merges.
--
-- Why (2026-10-20): the image and vehicle-record rebuild lane built 17 evidence-backed merge proposals for the owner's own
-- fleet (a duplicate profile is a second row for one car). Gate 2 of merge_into_primary(_batch) lets an owned pair merge only
-- with an approved, reviewed vehicle_merge_proposals row, and the review screen reads that table (get_merge_proposals_with_details:
-- reasoning, recommended survivor, requires_approval_from). No writer filed a proposal with evidence: propose_listing_vin_merge needs a
-- VIN and writes the other table (merge_proposals), and a raw INSERT on a proposals table is blocked by design.
--
-- Contract: service_role only. Both vehicles must exist, be different, and be live (not merged, not deleted). p_reasoning must be a
-- non-empty JSON object (the evidence: witnesses, shared photo and hash counts, album and session overlap); a proposal without
-- evidence is a guess. The row is filed status 'proposed' with recommended_primary = p_primary (the survivor, the row that holds the
-- VIN and the money), detected_by = app.writer when set, else 'propose_vehicle_merge', and requires_approval_from /
-- visible_to_user_ids set to the approver when given. A pair that already has an open proposal (proposed, detected, pending, approved) in either
-- direction returns that proposal's id; a pair whose proposal was rejected, merged or unmerged returns NULL (a closed decision is not
-- reopened by a filing). Nothing here approves, merges or edits a vehicle.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.propose_vehicle_merge(
  p_primary uuid,
  p_duplicate uuid,
  p_match_type text,
  p_confidence integer,
  p_reasoning jsonb,
  p_summary text DEFAULT NULL,
  p_recommendation_reason text DEFAULT NULL,
  p_requires_approval_from uuid DEFAULT NULL
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
  v_existing record;
BEGIN
  IF p_primary IS NULL OR p_duplicate IS NULL OR p_primary = p_duplicate THEN
    RAISE EXCEPTION 'need two different vehicles' USING ERRCODE = '22023';
  END IF;
  IF coalesce(btrim(p_match_type), '') = '' THEN
    RAISE EXCEPTION 'match_type is required' USING ERRCODE = '22023';
  END IF;
  IF p_confidence IS NULL OR p_confidence < 0 OR p_confidence > 100 THEN
    RAISE EXCEPTION 'confidence must be 0 to 100' USING ERRCODE = '22023';
  END IF;
  IF p_reasoning IS NULL OR jsonb_typeof(p_reasoning) <> 'object' OR p_reasoning = '{}'::jsonb THEN
    RAISE EXCEPTION 'a proposal needs its evidence in p_reasoning (a non-empty JSON object)' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM vehicles
       WHERE id IN (p_primary, p_duplicate) AND status IS DISTINCT FROM 'merged' AND deleted_at IS NULL) <> 2 THEN
    RAISE EXCEPTION 'both vehicles must exist and be live (not merged, not deleted)' USING ERRCODE = '22023';
  END IF;

  SELECT id, status INTO v_existing FROM vehicle_merge_proposals
   WHERE (primary_vehicle_id = p_primary AND duplicate_vehicle_id = p_duplicate)
      OR (primary_vehicle_id = p_duplicate AND duplicate_vehicle_id = p_primary)
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    IF v_existing.status IN ('proposed', 'detected', 'pending', 'approved') THEN
      RETURN v_existing.id;
    END IF;
    RETURN NULL;
  END IF;

  INSERT INTO vehicle_merge_proposals (
    primary_vehicle_id, duplicate_vehicle_id, match_type, confidence_score, match_reasoning, ai_summary,
    recommended_primary, recommendation_reason, status, requires_approval_from, visible_to_user_ids,
    detected_at, detected_by)
  VALUES (
    p_primary, p_duplicate, btrim(p_match_type), p_confidence, p_reasoning, nullif(btrim(p_summary), ''),
    p_primary, nullif(btrim(p_recommendation_reason), ''), 'proposed', p_requires_approval_from,
    CASE WHEN p_requires_approval_from IS NULL THEN NULL ELSE ARRAY[p_requires_approval_from] END,
    now(), coalesce(nullif(btrim(current_setting('app.writer', true)), ''), 'propose_vehicle_merge'))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.propose_vehicle_merge(uuid, uuid, text, integer, jsonb, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.propose_vehicle_merge(uuid, uuid, text, integer, jsonb, text, text, uuid) TO service_role;

COMMENT ON FUNCTION public.propose_vehicle_merge(uuid, uuid, text, integer, jsonb, text, text, uuid) IS
  'Files an evidence-backed merge proposal (status proposed) for owner review; never merges or edits a vehicle. p_primary is the survivor. Requires both vehicles live and a non-empty p_reasoning object. Returns the proposal id; the id of an existing open proposal for the pair (either direction); NULL when the pair''s proposal is closed (rejected, merged, unmerged). Service role only.';

COMMIT;
