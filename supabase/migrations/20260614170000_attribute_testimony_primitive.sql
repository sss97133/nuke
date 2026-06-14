-- attribute_testimony(): the missing FIRST-attribution primitive.
--
-- WHY (root cause, ISSUES.md [HIGH]): relink_testimony() and
-- reattribute_observation() both REQUIRE a non-null current vehicle_id — they
-- only MOVE testimony between two real vehicles (RAISE EXCEPTION on null). So
-- setting a FIRST vehicle_id on an orphan image/observation (vehicle_id IS NULL)
-- had NO sanctioned path; raw UPDATE is blocked by the god-write hook. That is
-- the structural reason ~6,706 of Skylar's recent images are stuck unattributed
-- and cannot enter the byok analysis drain.
--
-- This mirrors relink_testimony's guards exactly (target exists, file_hash dedup,
-- one-primary-per-vehicle, reattribution_audit row, supersede/relink-not-destroy)
-- but accepts NULL -> real, and records attribution provenance (confidence + signal).
-- It is FIRST-attribution ONLY: if the row is already attributed it refuses and
-- points at relink_testimony, so the two primitives never overlap.

-- reattribution_audit.old_vehicle_id is NOT NULL (built for moves). A first
-- attribution has no prior vehicle, so relax that one constraint. Non-destructive:
-- every existing NOT-NULL row stays valid; this only ALLOWS recording the
-- first-attribution event honestly (old_vehicle_id = NULL) instead of faking one.
ALTER TABLE public.reattribution_audit ALTER COLUMN old_vehicle_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.attribute_testimony(
  p_observation_type text,
  p_observation_id   uuid,
  p_target_vehicle_id uuid,
  p_reason           text,
  p_actor_user_id    uuid    DEFAULT NULL,
  p_confidence       numeric DEFAULT NULL,
  p_signal           text    DEFAULT NULL
) RETURNS jsonb
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

  -- Audit the first attribution honestly (old_vehicle_id NULL). Provenance DNA
  -- (confidence + signal) carried in the reason, matching the substrate's
  -- "numbers carry source DNA" rule.
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

COMMENT ON FUNCTION public.attribute_testimony(text,uuid,uuid,text,uuid,numeric,text) IS
  'FIRST-attribution primitive: sets a vehicle_id on an orphan (null) image/'
  'observation, with relink_testimony''s guards + audit + provenance. Refuses '
  'already-attributed rows (use relink_testimony/reattribute_observation to move). '
  'Closes the structural gap that stranded ~6,706 unattributed images.';
