-- attribute_testimony, the sanctioned first-filing writer, cannot file an image: the body applied by hand on 2026-10-17
-- (recorded as 20261018201500) casts its gate approval to public.vision_gate_enum, a type that does not exist, so its
-- UPDATE fails with SQLSTATE 42704. The column's enum is public.vision_gate_status. reattribution_audit has no
-- first_attribution row after 2026-10-17 13:03:11Z (read 2026-10-20 08:35Z). device_file_images,
-- attribute_image_session and photo-pipeline-orchestrator file through it.
-- The body is the live definition (pg_get_functiondef, 2026-10-20) with only that cast changed. The guard accepts that
-- live body or this one and refuses any other. Grants restate the live ACL (owner and service_role), so access is
-- unchanged.
SET lock_timeout = '5s';
SET statement_timeout = '30s';
BEGIN;
DO $guard$ BEGIN
  IF coalesce((SELECT md5(prosrc) FROM pg_proc
               WHERE oid = 'public.attribute_testimony(text,uuid,uuid,text,uuid,numeric,text)'::regprocedure), '')
     NOT IN ('0d5acd1a6873c06e7757449744267563', '7492c54c97880e31123dcd49d56b0f9c') THEN -- gitleaks:allow (function-definition fingerprints, not secrets)
    RAISE EXCEPTION 'attribute_testimony differs from the reviewed live body; rebase and review the drift';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.attribute_testimony(p_observation_type text, p_observation_id uuid, p_target_vehicle_id uuid, p_reason text, p_actor_user_id uuid DEFAULT NULL::uuid, p_confidence numeric DEFAULT NULL::numeric, p_signal text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_old_vehicle_id uuid;
  v_is_primary     boolean;
  v_file_hash      text;
  v_keep_primary   boolean := false;
BEGIN
  IF p_observation_type NOT IN ('image','observation') THEN
    RAISE EXCEPTION 'observation_type must be image or observation, got %', p_observation_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_target_vehicle_id) THEN
    RAISE EXCEPTION 'target vehicle % does not exist', p_target_vehicle_id;
  END IF;

  IF p_observation_type = 'image' THEN
    SELECT vehicle_id, COALESCE(is_primary,false), file_hash
      INTO v_old_vehicle_id, v_is_primary, v_file_hash
      FROM vehicle_images WHERE id = p_observation_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'image % not found', p_observation_id;
    END IF;

    -- FIRST-attribution ONLY. Already-attributed -> use relink_testimony to move.
    IF v_old_vehicle_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'already_attributed',
        'observation_id', p_observation_id, 'current_vehicle_id', v_old_vehicle_id,
        'hint', 'use relink_testimony() to move an already-attributed image');
    END IF;

    -- Guard: identical content already on target (the (vehicle_id,file_hash) rule).
    IF v_file_hash IS NOT NULL AND EXISTS (
      SELECT 1 FROM vehicle_images b
      WHERE b.vehicle_id = p_target_vehicle_id AND b.file_hash = v_file_hash
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'file_hash_exists_on_target',
        'observation_id', p_observation_id);
    END IF;

    -- Keep is_primary only if it was primary AND target has no primary yet;
    -- otherwise force false (respect the one-primary-per-vehicle index).
    v_keep_primary := v_is_primary AND NOT EXISTS (
      SELECT 1 FROM vehicle_images b
      WHERE b.vehicle_id = p_target_vehicle_id AND b.is_primary = true
        AND COALESCE(b.is_document,false) = false
        AND COALESCE(b.is_duplicate,false) = false
    );

    UPDATE vehicle_images
       SET vehicle_id = p_target_vehicle_id,
           is_primary = v_keep_primary,
           vision_gate_status = CASE
             WHEN vision_gate_status = 'pending' AND COALESCE(is_sensitive, false) = false
             THEN 'approved'::public.vision_gate_status
             ELSE vision_gate_status
           END,
           is_approved = CASE
             WHEN vision_gate_status = 'pending' AND COALESCE(is_sensitive, false) = false
             THEN true
             ELSE is_approved
           END,
           approval_status = CASE
             WHEN vision_gate_status = 'pending' AND COALESCE(is_sensitive, false) = false
             THEN 'approved'
             ELSE approval_status
           END,
           updated_at = NOW()
     WHERE id = p_observation_id;

  ELSE
    SELECT vehicle_id INTO v_old_vehicle_id
      FROM vehicle_observations WHERE id = p_observation_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'observation % not found', p_observation_id;
    END IF;
    IF v_old_vehicle_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'already_attributed',
        'observation_id', p_observation_id, 'current_vehicle_id', v_old_vehicle_id,
        'hint', 'use reattribute_observation() to move an already-attributed observation');
    END IF;
    UPDATE vehicle_observations
       SET vehicle_id = p_target_vehicle_id
     WHERE id = p_observation_id;
  END IF;

  INSERT INTO reattribution_audit (
    observation_type, old_observation_id, old_vehicle_id,
    new_observation_id, new_vehicle_id, reason, actor_user_id)
  VALUES (
    p_observation_type, p_observation_id, NULL,
    p_observation_id, p_target_vehicle_id,
    'first_attribution: ' || COALESCE(p_reason,'')
      || COALESCE('; confidence=' || p_confidence::text, '')
      || COALESCE('; signal=' || p_signal, ''),
    p_actor_user_id);

  RETURN jsonb_build_object(
    'success', true,
    'mode', 'first_attribution',
    'observation_type', p_observation_type,
    'observation_id', p_observation_id,
    'old_vehicle_id', NULL,
    'new_vehicle_id', p_target_vehicle_id,
    'confidence', p_confidence,
    'signal', p_signal);
END;
$function$;

REVOKE ALL ON FUNCTION public.attribute_testimony(text, uuid, uuid, text, uuid, numeric, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.attribute_testimony(text, uuid, uuid, text, uuid, numeric, text) TO service_role;
COMMIT;
