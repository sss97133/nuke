-- reattribute_observation: an observation move must not trip unique_observation on its own copy, and must not copy a row that already lives on the target.
-- Break (lane U, 2026-10-06): moving a duplicate vehicle's live observations to its primary failed whole with
--   ERROR 23505 duplicate key value violates unique constraint "unique_observation".
-- Cause, measured on the live catalog and on that case: unique_observation is UNIQUE (source_id, source_identifier, kind, content_hash),
--   table-wide, not scoped to the vehicle, NULLs distinct. The writer inserts the copy before it supersedes the source and the source keeps
--   its key forever, so every observation whose key has no NULL part collides with its own copy. In the measured case 18 of 20 live rows were
--   fully keyed, no other row anywhere held any of those keys (no twin existed on the target), and the 2 rows with a NULL part moved fine.
--   Known since 2026-06-11: header of 20260611210000_relink_testimony_in_place.sql and
--   docs/wiring/receipts/2026-06-11_k5-doppelganger-reattribution.md section 4.
-- Change, observation branch only (the image branch and every early return are byte-identical to the live body):
--   1. A fully keyed row is copied under a derived content_hash, sha256(old hash || ':reattributed:' || old vehicle id), the derivation
--      grammar demote_observation_to_user uses for its fork. Source, identifier, kind, content and lineage are unchanged.
--      A row with a NULL key part is copied exactly as before.
--   2. If the target already holds a LIVE row that is the same observation (same kind and content_hash, and the same source_id and
--      source_identifier, where a NULL matches a NULL and a missing content_hash never matches), no copy is written: the source is superseded
--      with superseded_by pointing at that row and the audit row names it as new_observation_id. A fully keyed row can never have such a twin
--      (unique_observation forbids it), so this serves the rows the index does not protect, which before each piled another duplicate
--      onto the target.
--   3. An observation result carries merged_into_existing: true when step 2 applied, otherwise false. Image results are unchanged.
-- Guard: the live body is compacted relative to 20260626000000_demote_to_user_pool.sql, so the pre-fingerprint below is the LIVE one,
--   measured 2026-10-06 08:42:20Z by a read-only catalog SELECT (PostgreSQL 17.6, not security definer, no proconfig, ACL postgres + service_role).
-- Forward-only, no row changes, no permission changes. Applied by CI, never by hand.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
DO $guard$
DECLARE f text;
BEGIN
  f := md5(pg_get_functiondef('public.reattribute_observation(text,uuid,uuid,text,uuid)'::regprocedure));
  IF f = '11ee320156c4847f36dbd53d81a8c119' THEN -- gitleaks:allow (function-definition fingerprint after this migration, not a secret)
    RAISE NOTICE 'reattribute_observation already merges into an existing twin and keys its copies';
  ELSIF f <> '5b39ee293216ed647d7f09f8a53beb58' THEN -- gitleaks:allow (live fingerprint measured 2026-10-06 08:42:20Z, not a secret)
    RAISE EXCEPTION 'reattribute_observation writer body drifted since 2026-10-06 08:42Z (md5 %); review before replacement', f;
  END IF;
END;
$guard$;
CREATE OR REPLACE FUNCTION public.reattribute_observation(p_observation_type text, p_observation_id uuid, p_target_vehicle_id uuid, p_reason text, p_actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE v_old_vehicle_id UUID; v_already_superseded BOOLEAN; v_found BOOLEAN := false; v_new_observation_id UUID; v_existing_id UUID; v_merged BOOLEAN := false; v_result JSONB;
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
    -- already on the target: a live row there that is the same observation (same kind and hash; a NULL source or identifier matches a NULL;
    -- a missing hash never matches). A fully keyed row cannot have one: unique_observation would forbid it.
    SELECT t.id INTO v_existing_id
      FROM vehicle_observations o
      JOIN vehicle_observations t ON t.vehicle_id = p_target_vehicle_id AND COALESCE(t.is_superseded, false) = false
       AND t.content_hash = o.content_hash AND t.kind = o.kind
       AND t.source_id IS NOT DISTINCT FROM o.source_id AND t.source_identifier IS NOT DISTINCT FROM o.source_identifier
     WHERE o.id = p_observation_id
     ORDER BY t.ingested_at, t.id LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      v_new_observation_id := v_existing_id;
      v_merged := true;
    ELSE
      INSERT INTO vehicle_observations (
        vehicle_id, kind, source_id, source_identifier, source_url, content_text, content_hash, structured_data, confidence,
        observed_at, ingested_at, observer_id, observer_raw, submitted_by_user_id, agent_tier, agent_model, extraction_method,
        rank, merged_from_vehicle_id, is_superseded, superseded_by)
      -- the source keeps its key forever and unique_observation is not scoped to a vehicle: a fully keyed copy needs a hash of its own
      SELECT p_target_vehicle_id, kind, source_id, source_identifier, source_url, content_text,
        CASE WHEN source_id IS NOT NULL AND source_identifier IS NOT NULL AND content_hash IS NOT NULL
             THEN encode(sha256(convert_to(content_hash || ':reattributed:' || COALESCE(v_old_vehicle_id::text, 'user_pool'), 'UTF8')), 'hex')
             ELSE content_hash END,
        structured_data, confidence,
        observed_at, NOW(), observer_id, observer_raw, submitted_by_user_id, agent_tier, agent_model, extraction_method,
        rank, v_old_vehicle_id, false, NULL
      FROM vehicle_observations WHERE id = p_observation_id RETURNING id INTO v_new_observation_id;
    END IF;
    UPDATE vehicle_observations SET is_superseded = true, superseded_at = NOW(), superseded_by = v_new_observation_id WHERE id = p_observation_id;
  END IF;
  INSERT INTO reattribution_audit (observation_type, old_observation_id, old_vehicle_id, new_observation_id, new_vehicle_id, reason, actor_user_id)
  VALUES (p_observation_type, p_observation_id, v_old_vehicle_id, v_new_observation_id, p_target_vehicle_id, p_reason, p_actor_user_id);
  v_result := jsonb_build_object('success', true, 'observation_type', p_observation_type, 'old_observation_id', p_observation_id, 'old_vehicle_id', v_old_vehicle_id,
    'new_observation_id', v_new_observation_id, 'new_vehicle_id', p_target_vehicle_id, 'merged_from_vehicle_id', v_old_vehicle_id, 'reason', p_reason, 'superseded_at', NOW());
  IF p_observation_type = 'observation' THEN v_result := v_result || jsonb_build_object('merged_into_existing', v_merged); END IF;
  RETURN v_result;
END; $function$;
COMMENT ON FUNCTION public.reattribute_observation(text, uuid, uuid, text, uuid) IS
  'Move an image or an observation to another vehicle by supersession: the old row is superseded (superseded_by points at its successor), the successor carries merged_from_vehicle_id, and every move writes a reattribution_audit row. Never deletes testimony. Observation moves: a fully keyed row is copied under a derived content_hash because unique_observation is table-wide and the source keeps its key; if the target already holds a live row that is the same observation (same kind and content_hash, NULL source or identifier matching NULL), no copy is written and the source points at that row (merged_into_existing true). Images are unchanged: a copy collides with its original on global unique indexes, use relink_testimony for those.';
COMMIT;
