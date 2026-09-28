-- ============================================================================
-- demote_observation_to_user: the subject follows the receipt's scope
-- ============================================================================
--
-- WHY (2026-09-28, follow-up to 20260928204500, measured by the setup lane before the
-- first batch ran): of the 433 date-only receipt attributions, 98 are receipts the
-- receipts table scopes to an ORGANIZATION (Viva! Las Vegas Autos 85, Nuke Ltd 13), not
-- to Skylar. Demoting those to a 'user' subject would move org money onto the person,
-- the commingling the books are meant to end. The observation branch now reads the
-- receipt's scope: 'org' with a resolvable organization id -> subject 'organization';
-- everything else -> subject 'user' (the household / 1040 slugs are kept in
-- structured_data.attribution.scope for the tax split). Image branch unchanged.
--
-- Live verification after CI applies: demote one org-scoped row, then
--   select subject_type, subject_id from vehicle_observations where id = <new id>;
--   -- 'organization', c433d27e-... for a Viva receipt.

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
  v_subject_type TEXT;
  v_scope_type TEXT;
  v_scope_id TEXT;
  v_receipt_user UUID;
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
    -- Subject follows the receipt's scope when the row was built from a receipt:
    --   scope 'org'  -> ('organization', scope_id)   e.g. Viva! Las Vegas Autos, Nuke Ltd
    --   otherwise    -> ('user', receipts.user_id)   the household / 1040 slugs stay in the row
    SELECT r.scope_type, r.scope_id, r.user_id
      INTO v_scope_type, v_scope_id, v_receipt_user
      FROM receipts r WHERE r.submitted_observation_id = p_observation_id
      ORDER BY r.created_at LIMIT 1;
    IF v_scope_type = 'org' AND v_scope_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND EXISTS (SELECT 1 FROM organizations o WHERE o.id = v_scope_id::uuid) THEN
      v_subject_type := 'organization';
      v_subject := v_scope_id::uuid;
    ELSE
      v_subject_type := 'user';
      v_subject := COALESCE(v_submitted_by, v_receipt_user, p_actor_user_id);
    END IF;
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
      NULL, v_subject_type, v_subject,
      kind, source_id, source_identifier, source_url, content_text,
      encode(sha256(convert_to(COALESCE(content_hash, '') || ':retracted:' || v_old_vehicle_id::text, 'UTF8')), 'hex'),
      COALESCE(structured_data, '{}'::jsonb) || jsonb_build_object(
        'attribution', jsonb_build_object(
          'signal', 'retracted',
          'retracted_from_vehicle_id', v_old_vehicle_id,
          'retracted_at', NOW(),
          'reason', p_reason,
          'scope', jsonb_strip_nulls(jsonb_build_object('scope_type', v_scope_type, 'scope_id', v_scope_id)),
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
  'Sanctioned writer: take an image OR an observation off a vehicle into the user pool (vehicle_id NULL). Supersession-safe, lineage kept (merged_from_vehicle_id), retraction recorded in structured_data.attribution, audited in reattribution_audit. Observation branch added 2026-09-28 for the WS-8 date-only receipt attributions; subject follows the receipt scope (organization or user).';
