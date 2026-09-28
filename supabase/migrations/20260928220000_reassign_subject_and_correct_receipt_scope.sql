-- ============================================================================
-- Two sanctioned writers for routing corrections in the books
--   reassign_observation_subject(): move a no-vehicle observation to another subject
--   correct_receipt_scope():        re-scope a receipt, keeping its routing history
-- ============================================================================
--
-- WHY (2026-09-28): 85 receipts the May attribution script had pinned to Skylar's cars
-- were demoted today with subject = the receipt's scope, which put them on organization
-- Viva! Las Vegas Autos (c433d27e). Skylar ruled that routing an error: "skylar works at
-- the viva premise but this vehicle's other data supersedes to the point that the work
-- isn't commissioned by viva ... viva isn't claiming it. skylar is the author. viva
-- claiming is an error of data routing." Measured: 62 of the 85 carry no Viva mark on the
-- receipt (no Viva vendor, customer or account text); 23 have "VIVA LAS VEGAS AUTOS"
-- printed on them and go to the owner as a separate question. The scope came from
-- scripts/receipt-attribution-ingest.mjs mapping its 'viva' label to ('org', c433d27e)
-- with no attribution signals recorded.
--
-- No writer could change the subject of an observation that has no vehicle, or change a
-- receipt's scope with provenance. These do, with the same grammar as the existing
-- writers:
--   reassign_observation_subject: fork to the new subject, supersede the original,
--     record the move in structured_data.attribution.subject_reassigned and in
--     reattribution_audit. Only rows with no vehicle (vehicle moves use
--     reattribute_observation / demote_observation_to_user).
--   correct_receipt_scope: sets scope_type/scope_id and appends the prior scope, reason,
--     actor and time to raw_json.scope_history. The receipt's content (vendor, amounts,
--     dates, lines, file) is untouched and receipt_items stay linked.
-- Both service_role only.
--
-- Live verification after CI applies:
--   select proname from pg_proc where proname in ('reassign_observation_subject','correct_receipt_scope');  -- 2 rows

SET statement_timeout = '30s';
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.reassign_observation_subject(
  p_observation_id UUID,
  p_subject_type TEXT,
  p_subject_id UUID,
  p_reason TEXT,
  p_actor_user_id UUID
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_vehicle_id UUID;
  v_superseded BOOLEAN;
  v_from_type TEXT;
  v_from_id UUID;
  v_new_id UUID;
BEGIN
  IF p_subject_type NOT IN ('user', 'organization') THEN
    RAISE EXCEPTION 'reassign_observation_subject: subject_type must be user or organization, got %', p_subject_type;
  END IF;
  IF p_subject_id IS NULL THEN
    RAISE EXCEPTION 'reassign_observation_subject: subject_id is required';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reassign_observation_subject: a reason is required';
  END IF;

  SELECT vehicle_id, COALESCE(is_superseded, false), subject_type, subject_id
    INTO v_vehicle_id, v_superseded, v_from_type, v_from_id
    FROM vehicle_observations WHERE id = p_observation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'observation % not found', p_observation_id;
  END IF;
  IF v_superseded THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_superseded', 'observation_id', p_observation_id);
  END IF;
  IF v_vehicle_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'on_a_vehicle', 'observation_id', p_observation_id);
  END IF;
  IF v_from_type = p_subject_type AND v_from_id IS NOT DISTINCT FROM p_subject_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'same_subject', 'observation_id', p_observation_id);
  END IF;

  INSERT INTO vehicle_observations (
    vehicle_id, subject_type, subject_id,
    kind, source_id, source_identifier, source_url, content_text, content_hash,
    structured_data, confidence, observed_at, ingested_at, observer_id, observer_raw,
    submitted_by_user_id, agent_tier, agent_model, extraction_method, rank,
    merged_from_vehicle_id, is_superseded, superseded_by
  )
  SELECT
    NULL, p_subject_type, p_subject_id,
    kind, source_id, source_identifier, source_url, content_text,
    -- unique_observation is (source_id, source_identifier, kind, content_hash)
    encode(sha256(convert_to(COALESCE(content_hash, '') || ':subject:' || p_subject_type || ':' || p_subject_id::text, 'UTF8')), 'hex'),
    COALESCE(structured_data, '{}'::jsonb) || jsonb_build_object(
      'attribution', COALESCE(structured_data -> 'attribution', '{}'::jsonb) || jsonb_build_object(
        'subject_reassigned', jsonb_build_object(
          'from_type', v_from_type, 'from_id', v_from_id,
          'to_type', p_subject_type, 'to_id', p_subject_id,
          'at', NOW(), 'reason', p_reason, 'actor', p_actor_user_id))),
    confidence, observed_at, NOW(), observer_id, observer_raw,
    submitted_by_user_id, agent_tier, agent_model, extraction_method, rank,
    merged_from_vehicle_id, false, NULL
  FROM vehicle_observations WHERE id = p_observation_id
  RETURNING id INTO v_new_id;

  UPDATE vehicle_observations
     SET is_superseded = true, superseded_at = NOW(), superseded_by = v_new_id
   WHERE id = p_observation_id;

  INSERT INTO reattribution_audit (
    observation_type, old_observation_id, old_vehicle_id,
    new_observation_id, new_vehicle_id, reason, actor_user_id)
  VALUES ('observation', p_observation_id, NULL, v_new_id, NULL, p_reason, p_actor_user_id);

  RETURN jsonb_build_object(
    'success', true, 'old_observation_id', p_observation_id, 'new_observation_id', v_new_id,
    'from', jsonb_build_object('type', v_from_type, 'id', v_from_id),
    'to', jsonb_build_object('type', p_subject_type, 'id', p_subject_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.correct_receipt_scope(
  p_receipt_ids UUID[],
  p_scope_type TEXT,
  p_scope_id TEXT,
  p_reason TEXT,
  p_actor_user_id UUID
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_n INTEGER;
BEGIN
  IF p_receipt_ids IS NULL OR cardinality(p_receipt_ids) = 0 THEN
    RAISE EXCEPTION 'correct_receipt_scope: no receipt ids';
  END IF;
  -- The vocabulary of scripts/receipt-attribution-ingest.mjs plus the values in use.
  IF p_scope_type NOT IN ('vehicle', 'personal', 'household', 'org', 'nuke', 'unknown', 'income_1099_NEC') THEN
    RAISE EXCEPTION 'correct_receipt_scope: unknown scope_type %', p_scope_type;
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'correct_receipt_scope: a reason is required';
  END IF;
  -- SET expressions read the pre-update row, so scope_history records the prior scope.
  UPDATE receipts
     SET scope_type = p_scope_type,
         scope_id   = p_scope_id,
         raw_json   = COALESCE(raw_json, '{}'::jsonb) || jsonb_build_object(
                        'scope_history', COALESCE(raw_json -> 'scope_history', '[]'::jsonb) || jsonb_build_array(
                          jsonb_build_object('from_type', scope_type, 'from_id', scope_id,
                                             'to_type', p_scope_type, 'to_id', p_scope_id,
                                             'at', NOW(), 'reason', p_reason, 'actor', p_actor_user_id))),
         updated_at = NOW()
   WHERE id = ANY(p_receipt_ids)
     AND is_superseded IS NOT TRUE
     AND (scope_type IS DISTINCT FROM p_scope_type OR scope_id IS DISTINCT FROM p_scope_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('updated', v_n, 'requested', cardinality(p_receipt_ids));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reassign_observation_subject(UUID, TEXT, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_observation_subject(UUID, TEXT, UUID, TEXT, UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION public.correct_receipt_scope(UUID[], TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correct_receipt_scope(UUID[], TEXT, TEXT, TEXT, UUID) TO service_role;

COMMENT ON FUNCTION public.reassign_observation_subject(UUID, TEXT, UUID, TEXT, UUID) IS
  'Sanctioned writer: move a no-vehicle observation to another subject (user or organization). Fork + supersede + reattribution_audit; the move is recorded in structured_data.attribution.subject_reassigned. Added 2026-09-28.';
COMMENT ON FUNCTION public.correct_receipt_scope(UUID[], TEXT, TEXT, TEXT, UUID) IS
  'Sanctioned writer: re-scope receipts (scope_type/scope_id) keeping the prior scope, reason, actor and time in raw_json.scope_history. Content and receipt_items untouched. Added 2026-09-28.';
