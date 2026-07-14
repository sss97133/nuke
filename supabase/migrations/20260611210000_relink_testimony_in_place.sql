-- relink_testimony(): in-place vehicle_id reassignment for testimony rows
-- (vehicle_images, vehicle_observations) with mandatory lineage + audit trail.
--
-- WHY THIS EXISTS (2026-06-11, K5 doppelganger reattribution — Skylar's order "fix the 2wd issue"):
-- The existing sanctioned function reattribute_observation() uses copy+supersede.
-- That design structurally cannot move most real rows:
--   1. unique_observation (source_id, source_identifier, kind, content_hash) is NOT
--      vehicle-scoped, so the copy collides with its own superseded original
--      (1,309 of 1,314 movable K5 observations).
--   2. idx_vehicle_images_ssd_blast_dedup is a GLOBAL unique index on file_hash
--      WHERE source='ssd_blast' — a copy always collides with the original.
--   3. It copies is_primary verbatim, violating vehicle_images_one_primary_per_vehicle_idx
--      whenever the target vehicle already has a primary image.
--
-- relink_testimony() implements the "relink" arm of the trust invariants
-- (.claude/rules/agent-trust-invariants.md: "supersede or relink, never destroy"):
--   * The original row is preserved — same id, same content, same provenance.
--     ONLY the entity link (vehicle_id) changes, which is exactly what entity
--     resolution is defined to do (docs/architecture/ENTITY_RESOLUTION_RULES.md:
--     "Assign a canonical vehicle_id to observations").
--   * merged_from_vehicle_id is populated on every moved row (invariant #6).
--   * Every move writes a reattribution_audit row.
--   * Guards:
--       - image whose file_hash already exists on the target -> refuses
--         (returns success=false; content is already present on the target).
--       - moved image has is_primary=true while target already has a primary
--         -> demotes the MOVED row (is_primary=false). The primary flag is
--         workflow/display state, not testimony content.
--
-- This function performs NO DELETE and NO content mutation.

CREATE OR REPLACE FUNCTION public.relink_testimony(
  p_observation_type text,
  p_observation_id uuid,
  p_target_vehicle_id uuid,
  p_reason text,
  p_actor_user_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_old_vehicle_id uuid;
  v_is_primary boolean;
  v_file_hash text;
  v_demoted boolean := false;
BEGIN
  IF p_observation_type NOT IN ('image', 'observation') THEN
    RAISE EXCEPTION 'observation_type must be image or observation, got %', p_observation_type;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_target_vehicle_id) THEN
    RAISE EXCEPTION 'target vehicle % does not exist', p_target_vehicle_id;
  END IF;

  IF p_observation_type = 'image' THEN
    SELECT vehicle_id, COALESCE(is_primary, false), file_hash
      INTO v_old_vehicle_id, v_is_primary, v_file_hash
      FROM vehicle_images WHERE id = p_observation_id;

    IF v_old_vehicle_id IS NULL THEN
      RAISE EXCEPTION 'image % not found (or vehicle_id is null)', p_observation_id;
    END IF;

    IF v_old_vehicle_id = p_target_vehicle_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'target_same_as_current',
                                'observation_id', p_observation_id);
    END IF;

    -- Guard: (vehicle_id, file_hash) unique — content already on target.
    IF v_file_hash IS NOT NULL AND EXISTS (
      SELECT 1 FROM vehicle_images b
      WHERE b.vehicle_id = p_target_vehicle_id AND b.file_hash = v_file_hash
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'file_hash_exists_on_target',
                                'observation_id', p_observation_id);
    END IF;

    -- Guard: one-primary-per-vehicle unique index. Demote the MOVED row, never
    -- the target's existing primary (workflow state, not testimony content).
    IF v_is_primary AND EXISTS (
      SELECT 1 FROM vehicle_images b
      WHERE b.vehicle_id = p_target_vehicle_id
        AND b.is_primary = true
        AND COALESCE(b.is_document, false) = false
        AND COALESCE(b.is_duplicate, false) = false
    ) THEN
      v_demoted := true;
    END IF;

    UPDATE vehicle_images
       SET vehicle_id = p_target_vehicle_id,
           merged_from_vehicle_id = v_old_vehicle_id,
           is_primary = CASE WHEN v_demoted THEN false ELSE is_primary END,
           updated_at = NOW()
     WHERE id = p_observation_id;

  ELSE
    SELECT vehicle_id INTO v_old_vehicle_id
      FROM vehicle_observations WHERE id = p_observation_id;

    IF v_old_vehicle_id IS NULL THEN
      RAISE EXCEPTION 'observation % not found (or vehicle_id is null)', p_observation_id;
    END IF;

    IF v_old_vehicle_id = p_target_vehicle_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'target_same_as_current',
                                'observation_id', p_observation_id);
    END IF;

    UPDATE vehicle_observations
       SET vehicle_id = p_target_vehicle_id,
           merged_from_vehicle_id = v_old_vehicle_id
     WHERE id = p_observation_id;
  END IF;

  INSERT INTO reattribution_audit (
    observation_type, old_observation_id, old_vehicle_id,
    new_observation_id, new_vehicle_id, reason, actor_user_id)
  VALUES (
    p_observation_type, p_observation_id, v_old_vehicle_id,
    p_observation_id, p_target_vehicle_id,
    p_reason || CASE WHEN v_demoted THEN ' [is_primary demoted: target already has a primary]' ELSE '' END,
    p_actor_user_id);

  RETURN jsonb_build_object(
    'success', true,
    'mode', 'relink_in_place',
    'observation_type', p_observation_type,
    'observation_id', p_observation_id,
    'old_vehicle_id', v_old_vehicle_id,
    'new_vehicle_id', p_target_vehicle_id,
    'merged_from_vehicle_id', v_old_vehicle_id,
    'demoted_primary', v_demoted);
END;
$function$;

COMMENT ON FUNCTION public.relink_testimony(text, uuid, uuid, text, uuid) IS
'Sanctioned relink arm of the trust invariants: moves a testimony row (vehicle_images / vehicle_observations) to another vehicle IN PLACE — content untouched, merged_from_vehicle_id populated, reattribution_audit written. Use when reattribute_observation()''s copy+supersede design collides with non-vehicle-scoped unique indexes (unique_observation, ssd_blast file_hash dedup). Guards the one-primary-per-vehicle and (vehicle_id,file_hash) unique indexes.';
