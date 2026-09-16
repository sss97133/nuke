-- ============================================================================
-- REATTRIBUTE_OBSERVATION: Universal testimony reattribution pipeline
-- ============================================================================
--
-- Trust invariant (`.claude/rules/agent-trust-invariants.md`):
-- "NEVER UPDATE to overwrite a value on a testimony row. Use the supersession
--  pattern — set is_superseded=true, write a new row, point superseded_by at
--  the new row."
--
-- When an image (or observation) is misattributed to vehicle A but actually
-- belongs to vehicle B, this function moves it via supersession: old row
-- marked superseded, new row created with corrected vehicle_id, full lineage
-- preserved in merged_from_vehicle_id + superseded_by.
--
-- Per Skylar 2026-05-05: "Images can only exist in one spot" — old row stays
-- as the audit trail (is_superseded=true, hidden from active queries); new
-- row at correct vehicle is the live attachment. No duplication.
--
-- Idempotent, atomic, universal (any user, any library, no Skylar-specific
-- logic).

-- ─── Add supersession columns to vehicle_images ──────────────────────────
-- Justification (Hard Rule #2 + agent-trust-invariants):
-- The trust-invariant rule MANDATES supersession columns on testimony
-- tables. vehicle_observations already has them; vehicle_images was
-- missing them. Adding now to enable testimony-preserving reattribution.

ALTER TABLE vehicle_images
  ADD COLUMN IF NOT EXISTS is_superseded BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES vehicle_images(id),
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

-- Partial index added in a separate migration with CREATE INDEX CONCURRENTLY
-- (cannot run inside a transaction, so kept out of this migration block).

COMMENT ON COLUMN vehicle_images.is_superseded IS
  'Supersession pattern: true means this row is hidden (replaced by superseded_by). Never deleted; preserved as audit trail. Active queries should filter is_superseded=false.';

-- ─── Audit Trail Table ───────────────────────────────────────────────────
-- Justification (Hard Rule #2):
-- Enables forensic queries like "where did K2500's 41 rejected_misattributed
-- images end up?" without joining across superseded chains. Immutable.

CREATE TABLE IF NOT EXISTS reattribution_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_type TEXT NOT NULL
    CHECK (observation_type IN ('image', 'observation')),
  old_observation_id UUID NOT NULL,
  old_vehicle_id UUID NOT NULL REFERENCES vehicles(id),
  new_observation_id UUID NOT NULL,
  new_vehicle_id UUID NOT NULL REFERENCES vehicles(id),
  reason TEXT NOT NULL,
  actor_user_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reattribution_old_vehicle
  ON reattribution_audit(old_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_reattribution_new_vehicle
  ON reattribution_audit(new_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_reattribution_reason
  ON reattribution_audit(reason);

COMMENT ON TABLE reattribution_audit IS
  'Immutable log of every reattribution. Forensic trail for "where did this image go?" queries.';

-- ─── Reattribution Function ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reattribute_observation(
  p_observation_type TEXT,
  p_observation_id UUID,
  p_target_vehicle_id UUID,
  p_reason TEXT,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_old_vehicle_id UUID;
  v_already_superseded BOOLEAN;
  v_new_observation_id UUID;
BEGIN
  IF p_observation_type NOT IN ('image', 'observation') THEN
    RAISE EXCEPTION 'observation_type must be image or observation, got %', p_observation_type;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_target_vehicle_id) THEN
    RAISE EXCEPTION 'target vehicle % does not exist', p_target_vehicle_id;
  END IF;

  -- Fetch old row state
  IF p_observation_type = 'image' THEN
    SELECT vehicle_id, COALESCE(is_superseded, false)
      INTO v_old_vehicle_id, v_already_superseded
      FROM vehicle_images WHERE id = p_observation_id;
  ELSE
    SELECT vehicle_id, COALESCE(is_superseded, false)
      INTO v_old_vehicle_id, v_already_superseded
      FROM vehicle_observations WHERE id = p_observation_id;
  END IF;

  IF v_old_vehicle_id IS NULL THEN
    RAISE EXCEPTION '% % not found', p_observation_type, p_observation_id;
  END IF;

  IF v_already_superseded THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'already_superseded',
      'observation_id', p_observation_id);
  END IF;

  IF v_old_vehicle_id = p_target_vehicle_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'target_same_as_current',
      'observation_id', p_observation_id,
      'vehicle_id', v_old_vehicle_id);
  END IF;

  -- Step 1: Insert new row with copied fields + lineage; supersede old row
  IF p_observation_type = 'image' THEN
    INSERT INTO vehicle_images (
      vehicle_id, user_id, image_url, image_type, image_category,
      category, position, caption, is_primary, created_at, updated_at,
      file_name, source, exif_data, file_hash, file_size, taken_at,
      latitude, longitude, location_name, apple_ml_labels,
      photographer_attribution, documented_by_device, documented_by_user_id,
      merged_from_vehicle_id, is_superseded, superseded_by,
      vision_gate_status
    )
    SELECT
      p_target_vehicle_id, user_id, image_url, image_type, image_category,
      category, position, caption, is_primary, created_at, NOW(),
      file_name, source, exif_data, file_hash, file_size, taken_at,
      latitude, longitude, location_name, apple_ml_labels,
      photographer_attribution, documented_by_device, documented_by_user_id,
      v_old_vehicle_id,  -- merged_from_vehicle_id = lineage to old vehicle
      false, NULL,
      'pending'  -- re-gate on new vehicle context
    FROM vehicle_images WHERE id = p_observation_id
    RETURNING id INTO v_new_observation_id;

    UPDATE vehicle_images
       SET is_superseded = true,
           superseded_at = NOW(),
           superseded_by = v_new_observation_id
     WHERE id = p_observation_id;
  ELSE
    INSERT INTO vehicle_observations (
      vehicle_id, kind, source_id, source_identifier, source_url,
      content_text, content_hash, structured_data, confidence,
      observed_at, ingested_at, observer_id, observer_raw,
      submitted_by_user_id, agent_tier, agent_model, extraction_method,
      rank, merged_from_vehicle_id, is_superseded, superseded_by
    )
    SELECT
      p_target_vehicle_id, kind, source_id, source_identifier, source_url,
      content_text, content_hash, structured_data, confidence,
      observed_at, NOW(), observer_id, observer_raw,
      submitted_by_user_id, agent_tier, agent_model, extraction_method,
      rank, v_old_vehicle_id, false, NULL
    FROM vehicle_observations WHERE id = p_observation_id
    RETURNING id INTO v_new_observation_id;

    UPDATE vehicle_observations
       SET is_superseded = true,
           superseded_at = NOW(),
           superseded_by = v_new_observation_id
     WHERE id = p_observation_id;
  END IF;

  -- Step 2: Audit trail
  INSERT INTO reattribution_audit (
    observation_type, old_observation_id, old_vehicle_id,
    new_observation_id, new_vehicle_id, reason, actor_user_id)
  VALUES (
    p_observation_type, p_observation_id, v_old_vehicle_id,
    v_new_observation_id, p_target_vehicle_id, p_reason, p_actor_user_id);

  RETURN jsonb_build_object(
    'success', true,
    'observation_type', p_observation_type,
    'old_observation_id', p_observation_id,
    'old_vehicle_id', v_old_vehicle_id,
    'new_observation_id', v_new_observation_id,
    'new_vehicle_id', p_target_vehicle_id,
    'merged_from_vehicle_id', v_old_vehicle_id,
    'reason', p_reason,
    'superseded_at', NOW());
END;
$$;

COMMENT ON FUNCTION reattribute_observation IS
  'Move observation (image or vehicle_observation) to correct vehicle via supersession. Old row marked is_superseded=true with superseded_by pointer; new row created with merged_from_vehicle_id lineage. Idempotent, atomic, never deletes testimony. Universal — works for any user library.';
