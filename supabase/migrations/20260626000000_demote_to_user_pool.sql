-- ============================================================================
-- DEMOTE_OBSERVATION_TO_USER + promote-from-pool — the missing user-pool primitive
-- ============================================================================
--
-- Model (Skylar 2026-06-25): an image whose vehicle isn't PROVEN is demoted to
-- the USER POOL (vehicle_id NULL, user_id kept). It waits there and gets
-- consumed into the right vehicle profile as evidence accrues. Default home is
-- the user; promotion to a vehicle is EARNED.
--
-- Gap this closes: reattribute_observation() (20260505100000) only moves
-- vehicle->vehicle — it requires the target to exist (raises otherwise) and
-- raises when the source vehicle_id is NULL. So the user pool was unreachable
-- through the canon, forcing raw `UPDATE ... SET vehicle_id = NULL` writes that
-- agent-trust-invariants.md explicitly forbids (and which drop merged_from
-- lineage). This adds the supersession-safe demote, and teaches
-- reattribute_observation to PROMOTE out of the pool (null source vehicle).
--
-- Same invariants as reattribute_observation: testimony never deleted; old row
-- superseded (is_superseded=true, superseded_by -> new), new row carries
-- merged_from_vehicle_id lineage; every move audited. Idempotent, atomic,
-- universal (no user-specific logic).

-- ─── audit table: null target (demote) / null source (promote-from-pool) ─────
ALTER TABLE reattribution_audit ALTER COLUMN new_vehicle_id DROP NOT NULL;
ALTER TABLE reattribution_audit ALTER COLUMN old_vehicle_id DROP NOT NULL;
COMMENT ON COLUMN reattribution_audit.new_vehicle_id IS
  'Target vehicle. NULL when the move is a demote-to-user-pool (no vehicle home).';
COMMENT ON COLUMN reattribution_audit.old_vehicle_id IS
  'Source vehicle. NULL when promoting an image OUT of the user pool.';

-- ─── demote_observation_to_user: vehicle -> user pool (vehicle_id NULL) ──────
CREATE OR REPLACE FUNCTION demote_observation_to_user(
  p_observation_type TEXT,
  p_observation_id UUID,
  p_reason TEXT,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_old_vehicle_id UUID;
  v_already_superseded BOOLEAN;
  v_found BOOLEAN := false;
  v_new_id UUID;
BEGIN
  IF p_observation_type <> 'image' THEN
    RAISE EXCEPTION 'demote_observation_to_user currently supports image only, got %', p_observation_type;
  END IF;

  SELECT true, vehicle_id, COALESCE(is_superseded, false)
    INTO v_found, v_old_vehicle_id, v_already_superseded
    FROM vehicle_images WHERE id = p_observation_id;

  IF NOT v_found THEN
    RAISE EXCEPTION 'image % not found', p_observation_id;
  END IF;
  IF v_already_superseded THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_superseded', 'observation_id', p_observation_id);
  END IF;
  IF v_old_vehicle_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_in_user_pool', 'observation_id', p_observation_id);
  END IF;

  -- new row in the user pool: vehicle_id NULL, lineage to the vehicle it left
  INSERT INTO vehicle_images (
    vehicle_id, user_id, image_url, image_type, image_category,
    category, position, caption, is_primary, created_at, updated_at,
    file_name, source, exif_data, file_hash, file_size, taken_at,
    latitude, longitude, location_name, apple_ml_labels,
    photographer_attribution, documented_by_device, documented_by_user_id,
    storage_path, thumbnail_url, medium_url, large_url,
    merged_from_vehicle_id, is_superseded, superseded_by, vision_gate_status
  )
  SELECT
    NULL, user_id, image_url, image_type, image_category,
    NULL, position, caption, false, created_at, NOW(),
    file_name, source, exif_data, file_hash, file_size, taken_at,
    latitude, longitude, location_name, apple_ml_labels,
    photographer_attribution, documented_by_device, documented_by_user_id,
    storage_path, thumbnail_url, medium_url, large_url,
    v_old_vehicle_id,  -- merged_from_vehicle_id = where it used to live
    false, NULL, 'pending'
  FROM vehicle_images WHERE id = p_observation_id
  RETURNING id INTO v_new_id;

  UPDATE vehicle_images
     SET is_superseded = true, superseded_at = NOW(), superseded_by = v_new_id
   WHERE id = p_observation_id;

  INSERT INTO reattribution_audit (
    observation_type, old_observation_id, old_vehicle_id,
    new_observation_id, new_vehicle_id, reason, actor_user_id)
  VALUES ('image', p_observation_id, v_old_vehicle_id, v_new_id, NULL, p_reason, p_actor_user_id);

  RETURN jsonb_build_object(
    'success', true, 'old_observation_id', p_observation_id,
    'old_vehicle_id', v_old_vehicle_id, 'new_observation_id', v_new_id,
    'new_vehicle_id', NULL, 'demoted_to', 'user_pool', 'reason', p_reason);
END;
$$;

COMMENT ON FUNCTION demote_observation_to_user IS
  'Demote an image to the user pool (vehicle_id NULL) via supersession: old row superseded (superseded_by -> new), new row carries merged_from_vehicle_id lineage and waits to be consumed into the right vehicle as evidence accrues. Never deletes testimony. The canon-safe replacement for raw UPDATE ... SET vehicle_id = NULL.';

-- ─── reattribute_observation: allow promote FROM the user pool (null source) ──
-- Only change vs 20260505100000: distinguish "row missing" from "row in pool"
-- (vehicle_id NULL) so a pooled image can be promoted to a vehicle. All other
-- behavior identical.
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
  v_found BOOLEAN := false;
  v_new_observation_id UUID;
BEGIN
  IF p_observation_type NOT IN ('image', 'observation') THEN
    RAISE EXCEPTION 'observation_type must be image or observation, got %', p_observation_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_target_vehicle_id) THEN
    RAISE EXCEPTION 'target vehicle % does not exist', p_target_vehicle_id;
  END IF;

  IF p_observation_type = 'image' THEN
    SELECT true, vehicle_id, COALESCE(is_superseded, false)
      INTO v_found, v_old_vehicle_id, v_already_superseded
      FROM vehicle_images WHERE id = p_observation_id;
  ELSE
    SELECT true, vehicle_id, COALESCE(is_superseded, false)
      INTO v_found, v_old_vehicle_id, v_already_superseded
      FROM vehicle_observations WHERE id = p_observation_id;
  END IF;

  IF NOT v_found THEN
    RAISE EXCEPTION '% % not found', p_observation_type, p_observation_id;
  END IF;
  IF v_already_superseded THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_superseded', 'observation_id', p_observation_id);
  END IF;
  IF v_old_vehicle_id IS NOT DISTINCT FROM p_target_vehicle_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'target_same_as_current',
      'observation_id', p_observation_id, 'vehicle_id', v_old_vehicle_id);
  END IF;

  IF p_observation_type = 'image' THEN
    INSERT INTO vehicle_images (
      vehicle_id, user_id, image_url, image_type, image_category,
      category, position, caption, is_primary, created_at, updated_at,
      file_name, source, exif_data, file_hash, file_size, taken_at,
      latitude, longitude, location_name, apple_ml_labels,
      photographer_attribution, documented_by_device, documented_by_user_id,
      storage_path, thumbnail_url, medium_url, large_url,
      merged_from_vehicle_id, is_superseded, superseded_by, vision_gate_status
    )
    SELECT
      p_target_vehicle_id, user_id, image_url, image_type, image_category,
      category, position, caption, is_primary, created_at, NOW(),
      file_name, source, exif_data, file_hash, file_size, taken_at,
      latitude, longitude, location_name, apple_ml_labels,
      photographer_attribution, documented_by_device, documented_by_user_id,
      storage_path, thumbnail_url, medium_url, large_url,
      v_old_vehicle_id, false, NULL, 'pending'
    FROM vehicle_images WHERE id = p_observation_id
    RETURNING id INTO v_new_observation_id;

    UPDATE vehicle_images SET is_superseded = true, superseded_at = NOW(), superseded_by = v_new_observation_id
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

    UPDATE vehicle_observations SET is_superseded = true, superseded_at = NOW(), superseded_by = v_new_observation_id
     WHERE id = p_observation_id;
  END IF;

  INSERT INTO reattribution_audit (
    observation_type, old_observation_id, old_vehicle_id,
    new_observation_id, new_vehicle_id, reason, actor_user_id)
  VALUES (p_observation_type, p_observation_id, v_old_vehicle_id, v_new_observation_id, p_target_vehicle_id, p_reason, p_actor_user_id);

  RETURN jsonb_build_object(
    'success', true, 'observation_type', p_observation_type,
    'old_observation_id', p_observation_id, 'old_vehicle_id', v_old_vehicle_id,
    'new_observation_id', v_new_observation_id, 'new_vehicle_id', p_target_vehicle_id,
    'merged_from_vehicle_id', v_old_vehicle_id, 'reason', p_reason, 'superseded_at', NOW());
END;
$$;
