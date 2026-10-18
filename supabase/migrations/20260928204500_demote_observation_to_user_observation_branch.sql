-- ============================================================================
-- demote_observation_to_user: the observation branch it said it lacked
-- ============================================================================
--
-- WHY (2026-09-28, reconciliation, user-first): a one-time script
-- (scripts/receipt-attribution-cleanup.mjs, WS-8, ran 2026-05-03) attached 433
-- receipts that the receipts table holds with NO vehicle (scope 'personal' or
-- 'org') to 8 of Skylar's vehicles on date proximity alone, giving itself
-- confidence 0.80. $122,160 personal + $60,204 org now sit on cars as
-- work_record / specification / comment observations; the Mustang alone carries
-- $79.8K that is not its own. The receipts table (the source) was right all
-- along. The observation rows are the only wrong home.
--
-- No sanctioned writer could take an observation OFF a vehicle:
--   reattribute_observation() needs an existing target vehicle,
--   attribute_testimony() is first-attribution only,
--   demote_observation_to_user() raised 'image only'.
-- This adds the observation branch with the same grammar as the image branch
-- (20260626000000): testimony never deleted; the old row superseded
-- (is_superseded, superseded_by -> new); the new row lives in the user pool
-- (vehicle_id NULL, subject 'user') with merged_from_vehicle_id lineage and the
-- retraction written into structured_data.attribution; every move audited in
-- reattribution_audit with new_vehicle_id NULL. Signature unchanged, so the
-- write-door grants (20260927170000: service_role only) carry over.
--
-- Live verification after CI applies:
--   select proname from pg_proc where proname = 'demote_observation_to_user';
--   -- one row; then the worklist (starts from receipts, no observation scan):
--   select o.vehicle_id, r.scope_type, count(*)
--     from receipts r join vehicle_observations o on o.id = r.submitted_observation_id
--    where r.is_superseded is not true and o.is_superseded is not true
--      and r.vehicle_id is null
--      and o.structured_data->'attribution'->>'signal' = 'date_proximity_singleton'
--    group by 1, 2;   -- reaches 0 rows once the demotes have run
-- RLS posture: unchanged (function is not exposed to anon/authenticated).

SET statement_timeout = '30s';
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.demote_observation_to_user(
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
  v_submitted_by UUID;
  v_subject UUID;
BEGIN
  IF p_observation_type NOT IN ('image', 'observation') THEN
    RAISE EXCEPTION 'demote_observation_to_user: observation_type must be image or observation, got %', p_observation_type;
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'demote_observation_to_user: a reason is required';
  END IF;

  IF p_observation_type = 'image' THEN
    SELECT true, vehicle_id, COALESCE(is_superseded, false)
      INTO v_found, v_old_vehicle_id, v_already_superseded
      FROM vehicle_images WHERE id = p_observation_id;
  ELSE
    SELECT true, vehicle_id, COALESCE(is_superseded, false), submitted_by_user_id
      INTO v_found, v_old_vehicle_id, v_already_superseded, v_submitted_by
      FROM vehicle_observations WHERE id = p_observation_id;
  END IF;

  IF NOT v_found THEN
    RAISE EXCEPTION '% % not found', p_observation_type, p_observation_id;
  END IF;
  IF v_already_superseded THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_superseded', 'observation_id', p_observation_id);
  END IF;
  IF v_old_vehicle_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_in_user_pool', 'observation_id', p_observation_id);
  END IF;

  IF p_observation_type = 'image' THEN
    -- unchanged from 20260626000000
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
      v_old_vehicle_id, false, NULL, 'pending'
    FROM vehicle_images WHERE id = p_observation_id
    RETURNING id INTO v_new_id;

    UPDATE vehicle_images
       SET is_superseded = true, superseded_at = NOW(), superseded_by = v_new_id
     WHERE id = p_observation_id;
  ELSE
    -- the user pool for testimony: no vehicle; subject = the person it was submitted by,
    -- else the owner of the receipt it was built from, else the actor who ordered the
    -- demote. Lineage + the retraction are kept in the row.
    v_subject := COALESCE(
      v_submitted_by,
      (SELECT r.user_id FROM receipts r WHERE r.submitted_observation_id = p_observation_id LIMIT 1),
      p_actor_user_id);
    IF v_subject IS NULL THEN
      RAISE EXCEPTION 'demote_observation_to_user: observation % has no subject to demote to (pass p_actor_user_id)', p_observation_id;
    END IF;
    -- unique_observation is (source_id, source_identifier, kind, content_hash): the fork keeps
    -- its source but derives a new hash from the old one and the vehicle it left, so the tuple
    -- is distinct and a second demote of the same row is caught by already_superseded above.
    INSERT INTO vehicle_observations (
      vehicle_id, subject_type, subject_id,
      kind, source_id, source_identifier, source_url, content_text, content_hash,
      structured_data, confidence, observed_at, ingested_at, observer_id, observer_raw,
      submitted_by_user_id, agent_tier, agent_model, extraction_method, rank,
      merged_from_vehicle_id, is_superseded, superseded_by
    )
    SELECT
      NULL, 'user', v_subject,
      kind, source_id, source_identifier, source_url, content_text,
      encode(sha256(convert_to(COALESCE(content_hash, '') || ':retracted:' || v_old_vehicle_id::text, 'UTF8')), 'hex'),
      COALESCE(structured_data, '{}'::jsonb) || jsonb_build_object(
        'attribution', jsonb_build_object(
          'signal', 'retracted',
          'retracted_from_vehicle_id', v_old_vehicle_id,
          'retracted_at', NOW(),
          'reason', p_reason,
          'previous', structured_data -> 'attribution')),
      confidence, observed_at, NOW(), observer_id, observer_raw,
      submitted_by_user_id, agent_tier, agent_model, extraction_method, rank,
      v_old_vehicle_id, false, NULL
    FROM vehicle_observations WHERE id = p_observation_id
    RETURNING id INTO v_new_id;

    UPDATE vehicle_observations
       SET is_superseded = true, superseded_at = NOW(), superseded_by = v_new_id
     WHERE id = p_observation_id;
  END IF;

  INSERT INTO reattribution_audit (
    observation_type, old_observation_id, old_vehicle_id,
    new_observation_id, new_vehicle_id, reason, actor_user_id)
  VALUES (p_observation_type, p_observation_id, v_old_vehicle_id, v_new_id, NULL, p_reason, p_actor_user_id);

  RETURN jsonb_build_object(
    'success', true, 'observation_type', p_observation_type,
    'old_observation_id', p_observation_id, 'old_vehicle_id', v_old_vehicle_id,
    'new_observation_id', v_new_id, 'new_vehicle_id', NULL,
    'demoted_to', 'user_pool', 'reason', p_reason);
END;
$$;

COMMENT ON FUNCTION public.demote_observation_to_user(TEXT, UUID, TEXT, UUID) IS
  'Sanctioned writer: take an image OR an observation off a vehicle into the user pool (vehicle_id NULL). Supersession-safe, lineage kept (merged_from_vehicle_id), retraction recorded in structured_data.attribution, audited in reattribution_audit. Observation branch added 2026-09-28 for the WS-8 date-only receipt attributions.';
