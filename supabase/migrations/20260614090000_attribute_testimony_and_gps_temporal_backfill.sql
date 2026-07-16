-- attribute_testimony(): sanctioned FIRST-ATTRIBUTION (NULL -> vehicle_id) for testimony rows
-- + a conservative GPS+temporal backfill of 63 of Skylar's null-vehicle images.
--
-- WHY THIS EXISTS (2026-06-14, overnight null-image attribution mission):
-- The platform had 6,706 active null-vehicle images for shkylar@gmail.com that could
-- not enter the analysis drain (deep-image-analysis-byok prepare needs a vehicle_id).
-- The existing sanctioned movers CANNOT do first-attribution:
--   * reattribute_observation(): RAISEs 'not found' when vehicle_id IS NULL.
--   * relink_testimony():        RAISEs 'not found (or vehicle_id is null)' when NULL.
-- Both are designed to MOVE testimony between two real vehicles, not to set the first
-- entity link on an orphan observation. Setting a NULL link to its first value is exactly
-- what entity resolution is DEFINED to do (docs/architecture/ENTITY_RESOLUTION_RULES.md:
-- "Assign a canonical vehicle_id to observations that refer to the same chassis") and is
-- non-destructive: there is no prior testimony value to preserve or supersede.
--
-- This migration ships the missing sanctioned primitive so agents never reach for a raw
-- God-write (the block-god-writes.sh hook correctly refuses raw UPDATEs on testimony).
--
-- TRUST-INVARIANT COMPLIANCE (.claude/rules/agent-trust-invariants.md):
--   * NO DELETE, NO content mutation, NO overwrite of an existing link.
--     attribute_testimony refuses if vehicle_id IS NOT NULL (returns success=false).
--   * Every attribution writes a reattribution_audit row (old_vehicle_id = NULL,
--     made nullable below precisely for the first-attribution case).
--   * merged_from_vehicle_id is NOT set (there is no source vehicle — it was an orphan).
--   * Guards the one-primary-per-vehicle and (vehicle_id,file_hash) unique indexes,
--     mirroring relink_testimony().
--   * Provenance DNA (confidence, source, signal) is stamped on the row, per
--     feedback_numbers_carry_source_dna and the album-is-a-prior doctrine
--     (vehicle_confidence < 1.0, user_confirmed_vehicle=false — agentic, not owner-signed).

-- ── 1. Allow reattribution_audit to record a first-attribution (no old vehicle) ──
ALTER TABLE reattribution_audit
  ALTER COLUMN old_vehicle_id DROP NOT NULL;

COMMENT ON COLUMN reattribution_audit.old_vehicle_id IS
  'Source vehicle of a reattribution. NULL for a first-attribution (orphan NULL image -> vehicle) written by attribute_testimony().';

-- ── 2. The sanctioned first-attribution primitive ──
CREATE OR REPLACE FUNCTION public.attribute_testimony(
  p_observation_type text,
  p_observation_id   uuid,
  p_target_vehicle_id uuid,
  p_confidence       numeric,
  p_signal           text,
  p_reason           text,
  p_actor_user_id    uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_existing_vehicle_id uuid;
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
    SELECT vehicle_id, COALESCE(is_primary,false), file_hash
      INTO v_existing_vehicle_id, v_is_primary, v_file_hash
      FROM vehicle_images WHERE id = p_observation_id;

    -- First-attribution ONLY: refuse if already linked (no overwrite of testimony).
    IF v_existing_vehicle_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'already_attributed',
                                'observation_id', p_observation_id,
                                'existing_vehicle_id', v_existing_vehicle_id);
    END IF;

    -- Guard: (vehicle_id, file_hash) unique — content already on target.
    IF v_file_hash IS NOT NULL AND EXISTS (
      SELECT 1 FROM vehicle_images b
      WHERE b.vehicle_id = p_target_vehicle_id AND b.file_hash = v_file_hash
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'file_hash_exists_on_target',
                                'observation_id', p_observation_id);
    END IF;

    -- Guard: one-primary-per-vehicle. Demote the incoming row, never the target's primary.
    IF v_is_primary AND EXISTS (
      SELECT 1 FROM vehicle_images b
      WHERE b.vehicle_id = p_target_vehicle_id AND b.is_primary = true
        AND COALESCE(b.is_document,false)=false AND COALESCE(b.is_duplicate,false)=false
    ) THEN
      v_demoted := true;
    END IF;

    UPDATE vehicle_images
       SET vehicle_id = p_target_vehicle_id,
           vehicle_confidence = p_confidence,
           vehicle_source = 'agent_gps_temporal',
           user_confirmed_vehicle = false,
           auto_suggested_vehicle_id = p_target_vehicle_id,
           auto_suggestion_confidence = p_confidence,
           auto_suggestion_reasons = ARRAY[
             p_signal,
             'agent_model=claude-opus-4-8',
             'attribution_basis=gps_temporal',
             'first_attribution_via=attribute_testimony'
           ],
           is_primary = CASE WHEN v_demoted THEN false ELSE is_primary END,
           updated_at = NOW()
     WHERE id = p_observation_id;

  ELSE
    SELECT vehicle_id INTO v_existing_vehicle_id
      FROM vehicle_observations WHERE id = p_observation_id;

    IF v_existing_vehicle_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'already_attributed',
                                'observation_id', p_observation_id,
                                'existing_vehicle_id', v_existing_vehicle_id);
    END IF;

    UPDATE vehicle_observations
       SET vehicle_id = p_target_vehicle_id,
           confidence = p_confidence
     WHERE id = p_observation_id;
  END IF;

  INSERT INTO reattribution_audit (
    observation_type, old_observation_id, old_vehicle_id,
    new_observation_id, new_vehicle_id, reason, actor_user_id)
  VALUES (
    p_observation_type, p_observation_id, NULL,
    p_observation_id, p_target_vehicle_id,
    'FIRST_ATTRIBUTION ' || p_reason ||
      CASE WHEN v_demoted THEN ' [is_primary demoted: target already has a primary]' ELSE '' END,
    p_actor_user_id);

  RETURN jsonb_build_object(
    'success', true,
    'mode', 'first_attribution',
    'observation_type', p_observation_type,
    'observation_id', p_observation_id,
    'new_vehicle_id', p_target_vehicle_id,
    'confidence', p_confidence,
    'signal', p_signal,
    'demoted_primary', v_demoted);
END;
$function$;

COMMENT ON FUNCTION public.attribute_testimony(text,uuid,uuid,numeric,text,text,uuid) IS
'Sanctioned FIRST-ATTRIBUTION primitive: sets the first vehicle_id on an orphan (NULL) testimony row, stamps provenance DNA (confidence, source, signal), writes a reattribution_audit row (old_vehicle_id NULL). Refuses if already attributed (no overwrite). Guards one-primary and (vehicle_id,file_hash) unique indexes. Use for entity resolution of unattributed vehicle_images / vehicle_observations; use relink_testimony()/reattribute_observation() to MOVE already-attributed testimony.';

-- ── 3. Apply the conservative GPS+temporal backfill (63 slam-dunk attributions) ──
-- Evidence: each image sits in a remote, single-vehicle GPS cell within the trip window
-- of an attributed sibling of exactly ONE of Skylar's vehicles. Home-base (Boulder City,
-- 46+ vehicles in one cell) and multi-year city cells (Paris non-trip, Le Havre) are
-- DELIBERATELY EXCLUDED to avoid the K2500-in-garage contamination class.
DO $backfill$
DECLARE
  r record;
  v_actor uuid := '0b9f107a-d124-49de-9ded-94698f63c1c4'; -- shkylar@gmail.com (owner)
BEGIN
  FOR r IN
    WITH stbarts AS (
      SELECT id, 'a90c008a-3379-41d8-9eb2-b4eda365d74c'::uuid AS vid,
             'gps_temporal:stbarts_2026_trip_single_vehicle'::text AS signal, 0.96::numeric AS conf,
             'St. Barthelemy Feb-Mar 2026 trip; only the 1983 GMC K2500 is ever attributed in this remote location'::text AS reason
      FROM vehicle_images
      WHERE user_id=v_actor AND vehicle_id IS NULL AND COALESCE(is_superseded,false)=false
        AND latitude BETWEEN 17.80 AND 17.95 AND longitude BETWEEN -63.0 AND -62.7
        AND taken_at >= '2026-02-01' AND taken_at < '2026-03-15'
    ),
    paris AS (
      SELECT id, 'b1edd5c1-436c-4139-8811-e0bf006a25dc'::uuid AS vid,
             'gps_temporal:paris_2017-08_attributed_sibling_le14d'::text AS signal, 0.92::numeric AS conf,
             'Paris 2017-08; attributed 1989 R3500 sibling in same cell within 14 days, single-vehicle cell'::text AS reason
      FROM vehicle_images
      WHERE user_id=v_actor AND vehicle_id IS NULL AND COALESCE(is_superseded,false)=false
        AND round(latitude::numeric,2)=48.86 AND round(longitude::numeric,2)=2.36
        AND taken_at >= '2017-07-24' AND taken_at < '2017-08-22'
    ),
    deathvalley AS (
      SELECT id, '8cb16949-6818-4b98-8bea-39633f6a33ba'::uuid AS vid,
             'gps_temporal:death_valley_2017-10-23_same_day_sibling'::text AS signal, 0.93::numeric AS conf,
             'Death Valley 2017-10-23; same-day attributed 1972 C30 sibling, single-vehicle cell'::text AS reason
      FROM vehicle_images
      WHERE user_id=v_actor AND vehicle_id IS NULL AND COALESCE(is_superseded,false)=false
        AND round(latitude::numeric,2) IN (36.18,36.20) AND round(longitude::numeric,2) IN (-116.02,-116.01)
        AND taken_at::date = '2017-10-23'
    )
    SELECT * FROM stbarts UNION ALL SELECT * FROM paris UNION ALL SELECT * FROM deathvalley
  LOOP
    PERFORM public.attribute_testimony('image', r.id, r.vid, r.conf, r.signal, r.reason, v_actor);
  END LOOP;
END
$backfill$;
