-- Live definitions read from production on 2026-10-15 with pg_get_functiondef, for test_device_attribution.sql.
-- First 16 hex characters of md5(prosrc): attribute_testimony ef34786fb36459fb, normalize_make 1a25c38b39dc1de4,
-- enforce_vin_uniqueness 4494a95276c5eacb, enforce_contributor_evidence 9105d41cf9815180.

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
$function$

;

CREATE OR REPLACE FUNCTION public.normalize_make(input_make text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
    result TEXT;
BEGIN
    IF input_make IS NULL OR input_make = '' THEN
        RETURN input_make;
    END IF;

    -- Check if already a canonical name (case-insensitive)
    SELECT canonical_name INTO result
    FROM canonical_makes
    WHERE LOWER(canonical_name) = LOWER(input_make)
    LIMIT 1;

    IF result IS NOT NULL THEN
        RETURN result;
    END IF;

    -- Check aliases (case-insensitive)
    SELECT canonical_name INTO result
    FROM canonical_makes
    WHERE LOWER(input_make) = ANY(SELECT LOWER(a) FROM unnest(aliases) a)
    LIMIT 1;

    IF result IS NOT NULL THEN
        RETURN result;
    END IF;

    -- Return original if no match
    RETURN input_make;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.enforce_vin_uniqueness()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_norm text;
  v_existing uuid;
begin
  if new.vin is null or length(trim(new.vin)) < 11 then
    return new;
  end if;
  v_norm := upper(trim(new.vin));
  select id into v_existing
    from vehicles
   where upper(trim(vin)) = v_norm
     and id <> new.id
     and status is distinct from 'merged'
   limit 1;
  if v_existing is not null then
    raise exception 'VIN % already exists on vehicle %', v_norm, v_existing
      using errcode = 'unique_violation',
            hint = 'Attach observations to the existing vehicle via ingest-observation, or resolve via merge_proposals.';
  end if;
  return new;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.enforce_contributor_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.vehicle_images vi
    WHERE vi.vehicle_id = NEW.vehicle_id
    AND (vi.user_id = NEW.user_id OR vi.documented_by_user_id = NEW.user_id)
  ) THEN
    RAISE EXCEPTION 'Cannot add contributor without photo evidence on this vehicle. Vehicle: %, User: %',
      NEW.vehicle_id, NEW.user_id;
  END IF;
  RETURN NEW;
END;
$function$

;
