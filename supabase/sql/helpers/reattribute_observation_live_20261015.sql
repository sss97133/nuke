-- The live reattribute_observation, verbatim from production 2026-10-15 14:15Z (fingerprint md5(pg_get_functiondef)
-- 5b39ee293216ed647d7f09f8a53beb58; in no migration: applied directly), for contracts. -- gitleaks:allow (fingerprint)
CREATE OR REPLACE FUNCTION public.reattribute_observation(p_observation_type text, p_observation_id uuid, p_target_vehicle_id uuid, p_reason text, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE v_old_vehicle_id UUID; v_already_superseded BOOLEAN; v_found BOOLEAN := false; v_new_observation_id UUID;
BEGIN
  IF p_observation_type NOT IN ('image', 'observation') THEN RAISE EXCEPTION 'observation_type must be image or observation, got %', p_observation_type; END IF;
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_target_vehicle_id) THEN RAISE EXCEPTION 'target vehicle % does not exist', p_target_vehicle_id; END IF;
  IF p_observation_type = 'image' THEN
    SELECT true, vehicle_id, COALESCE(is_superseded, false) INTO v_found, v_old_vehicle_id, v_already_superseded FROM vehicle_images WHERE id = p_observation_id;
  ELSE
    SELECT true, vehicle_id, COALESCE(is_superseded, false) INTO v_found, v_old_vehicle_id, v_already_superseded FROM vehicle_observations WHERE id = p_observation_id;
  END IF;
  IF NOT v_found THEN RAISE EXCEPTION '% % not found', p_observation_type, p_observation_id; END IF;
  IF v_already_superseded THEN RETURN jsonb_build_object('success', false, 'error', 'already_superseded', 'observation_id', p_observation_id); END IF;
  IF v_old_vehicle_id IS NOT DISTINCT FROM p_target_vehicle_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'target_same_as_current', 'observation_id', p_observation_id, 'vehicle_id', v_old_vehicle_id); END IF;
  IF p_observation_type = 'image' THEN
    INSERT INTO vehicle_images (
      vehicle_id, user_id, image_url, image_type, image_category, category, position, caption, is_primary, created_at, updated_at,
      file_name, source, exif_data, file_hash, file_size, taken_at, latitude, longitude, location_name, apple_ml_labels,
      photographer_attribution, documented_by_device, documented_by_user_id, storage_path, thumbnail_url, medium_url, large_url,
      merged_from_vehicle_id, is_superseded, superseded_by, vision_gate_status)
    SELECT p_target_vehicle_id, user_id, image_url, image_type, image_category, category, position, caption, is_primary, created_at, NOW(),
      file_name, source, exif_data, file_hash, file_size, taken_at, latitude, longitude, location_name, apple_ml_labels,
      photographer_attribution, documented_by_device, documented_by_user_id, storage_path, thumbnail_url, medium_url, large_url,
      v_old_vehicle_id, false, NULL, 'pending'
    FROM vehicle_images WHERE id = p_observation_id RETURNING id INTO v_new_observation_id;
    UPDATE vehicle_images SET is_superseded = true, superseded_at = NOW(), superseded_by = v_new_observation_id WHERE id = p_observation_id;
  ELSE
    INSERT INTO vehicle_observations (
      vehicle_id, kind, source_id, source_identifier, source_url, content_text, content_hash, structured_data, confidence,
      observed_at, ingested_at, observer_id, observer_raw, submitted_by_user_id, agent_tier, agent_model, extraction_method,
      rank, merged_from_vehicle_id, is_superseded, superseded_by)
    SELECT p_target_vehicle_id, kind, source_id, source_identifier, source_url, content_text, content_hash, structured_data, confidence,
      observed_at, NOW(), observer_id, observer_raw, submitted_by_user_id, agent_tier, agent_model, extraction_method,
      rank, v_old_vehicle_id, false, NULL
    FROM vehicle_observations WHERE id = p_observation_id RETURNING id INTO v_new_observation_id;
    UPDATE vehicle_observations SET is_superseded = true, superseded_at = NOW(), superseded_by = v_new_observation_id WHERE id = p_observation_id;
  END IF;
  INSERT INTO reattribution_audit (observation_type, old_observation_id, old_vehicle_id, new_observation_id, new_vehicle_id, reason, actor_user_id)
  VALUES (p_observation_type, p_observation_id, v_old_vehicle_id, v_new_observation_id, p_target_vehicle_id, p_reason, p_actor_user_id);
  RETURN jsonb_build_object('success', true, 'observation_type', p_observation_type, 'old_observation_id', p_observation_id, 'old_vehicle_id', v_old_vehicle_id,
    'new_observation_id', v_new_observation_id, 'new_vehicle_id', p_target_vehicle_id, 'merged_from_vehicle_id', v_old_vehicle_id, 'reason', p_reason, 'superseded_at', NOW());
END; $function$
;
