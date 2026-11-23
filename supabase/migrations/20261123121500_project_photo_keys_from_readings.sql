-- Widen automatic.admits to the registered rust and paint enums, and add a signed,
-- dry-by-default planner for projecting already-stored deep readings onto those keys
-- (plus assembly state, which the automatic thin parent still does not post).
--
-- Measurement, 2026-11-23, live vehicle_observations, analysis_kind=image_deep_byok,
-- not superseded:
--   Firebird 20d21fb0-4651-4469-a0ba-e751309a1e54: 471 readings, 244 rust in
--     {none,surface,pitting,perforation}, 87 paint in
--     {bare_metal,primer,sealer,base,clear,aged}, 448 assembly in
--     {stripped,partial,assembled};
--   K10 80e04dd6-983e-4c78-ba15-c0599e50ecd9: 156 readings, 151 rust, 151 paint,
--     156 assembly.
-- The six automatic Mustang readings stored those same closed rust/paint values in
-- their stage receipts and then posted unknown, because automatic.admits allowed
-- only rust=surface and an empty paint list. Completeness stays unpublished on the
-- automatic thin parent (measured 2026-11-20: of 20 photos not seen before, one
-- agreed assembly value contradicted the reviewed reading, and none of six partly
-- assembled photos were recognised; see thinVerdict in scripts/photo-pipeline/deep-stage.mjs).
-- A stored reading that already carries a registered assembly value is still
-- projectable by the existing cached_byok_property_projection_v1 writer.
--
-- This migration does not land photos, touch photo_land_classification or the a08
-- trigger, re-arm capture_arm_on_classified, invent keys, write GPS, or assert
-- ownership. Observation writes on apply go through ingest-observation-batch
-- (scripts/photo-pipeline/project-photo-keys.mjs). The SQL planner itself does not
-- insert vehicle_observations.

SET statement_timeout = '30s';
SET lock_timeout = '5s';

UPDATE public.platform_config
SET config_value = jsonb_set(
      jsonb_set(config_value,
        '{automatic,admits,rust_severity}',
        '["none","surface","pitting","perforation"]'::jsonb),
      '{automatic,admits,paint_state}',
      '["bare_metal","primer","sealer","base","clear","aged"]'::jsonb)
WHERE config_key = 'image_reading_tiers';

CREATE TABLE public.photo_key_projection_runs (
  id uuid PRIMARY KEY,
  granted_by uuid NOT NULL,
  opened_by uuid NOT NULL,
  dry_run boolean NOT NULL,
  signature text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  reverted_at timestamptz,
  reverted_by uuid,
  receipt jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.photo_key_projection_runs IS
  'Ledger for project_photo_keys_v1 / scripts/photo-pipeline/project-photo-keys.mjs. A row is one signed run. Applied items, including observation_id and witness_id, live in receipt.items (no per-photo table). revert_project_photo_keys_v1 supersedes those observation ids.';

-- The planner signature. Changing the admitted map or the skip rules is a new version.
CREATE OR REPLACE FUNCTION public.project_photo_keys_signature_v1()
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'project_photo_keys_v1: map rust_severity, paint_state, completeness only to the registered image_visible_* enums; unmapped findings stay on the source observation; dry run by default; cap 50 photos; filed photos only; skip private, sensitive, rejected_personal, privacy-hold, empty URL, and 9cf5b7a4; no GPS; no ownership; automatic stays automatic; revert supersedes by run_id'
$$;

-- Eligible stored deep readings and the registered keys they would project.
-- Read-only. Does not write observations, witnesses, or run rows.
CREATE OR REPLACE FUNCTION public.project_photo_keys_v1(
  p_run uuid,
  p_user uuid,
  p_granted_by uuid,
  p_dry boolean DEFAULT true,
  p_cap integer DEFAULT 50,
  p_vehicle_ids uuid[] DEFAULT NULL,
  p_image_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_cap integer;
  v_photos integer;
  v_claims integer;
  v_unmapped integer;
  v_skipped integer;
  v_items jsonb;
  v_skipped_rows jsonb;
  v_unmapped_rows jsonb;
BEGIN
  IF p_run IS NULL THEN
    RAISE EXCEPTION 'project_photo_keys_v1 requires p_run';
  END IF;
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'project_photo_keys_v1 requires p_user';
  END IF;
  IF p_granted_by IS NULL THEN
    RAISE EXCEPTION 'project_photo_keys_v1 requires p_granted_by';
  END IF;
  v_cap := coalesce(p_cap, 50);
  IF v_cap < 1 OR v_cap > 50 THEN
    RAISE EXCEPTION 'project_photo_keys_v1 p_cap must be between 1 and 50';
  END IF;
  IF p_dry IS NOT TRUE THEN
    RAISE EXCEPTION 'project_photo_keys_v1 is the planner; it does not write observations. Apply with scripts/photo-pipeline/project-photo-keys.mjs through ingest-observation-batch, then record_project_photo_keys_v1';
  END IF;

  WITH
  props AS (
    SELECT property_key, id AS property_id
    FROM public.observation_properties
    WHERE property_key IN (
      'image_visible_rust_severity',
      'image_visible_paint_stage',
      'image_visible_assembly_state'
    )
  ),
  registry AS (
    SELECT * FROM (VALUES
      ('rust_severity', 'image_visible_rust_severity', ARRAY['none','surface','pitting','perforation']),
      ('paint_state', 'image_visible_paint_stage', ARRAY['bare_metal','primer','sealer','base','clear','aged']),
      ('completeness', 'image_visible_assembly_state', ARRAY['stripped','partial','assembled'])
    ) AS t(source_key, property_key, allowed)
  ),
  images AS (
    SELECT i.*
    FROM public.vehicle_images i
    WHERE i.vehicle_id IS NOT NULL
      AND coalesce(i.image_url, '') <> ''
      AND coalesce(i.is_sensitive, false) = false
      AND coalesce(i.is_superseded, false) = false
      AND coalesce(i.is_duplicate, false) = false
      AND coalesce(i.is_document, false) = false
      AND (i.vision_gate_status IS NULL OR i.vision_gate_status = 'approved')
      AND i.id::text NOT LIKE '9cf5b7a4%'
      AND i.vehicle_id::text NOT LIKE '9cf5b7a4%'
      AND (p_vehicle_ids IS NULL OR i.vehicle_id = ANY (p_vehicle_ids))
      AND (p_image_ids IS NULL OR i.id = ANY (p_image_ids))
  ),
  sources AS (
    SELECT
      o.id AS source_observation_id,
      o.vehicle_id,
      i.id AS image_id,
      o.agent_tier,
      o.agent_model,
      o.extraction_method,
      o.confidence_score,
      o.ingested_at,
      o.observed_at,
      o.structured_data AS data,
      o.structured_data->'state_observations' AS state
    FROM public.vehicle_observations o
    JOIN images i
      ON i.vehicle_id = o.vehicle_id
     AND i.id::text = o.structured_data->>'image_id'
    WHERE o.kind = 'condition'
      AND coalesce(o.is_superseded, false) = false
      AND o.structured_data->>'analysis_kind' = 'image_deep_byok'
      AND o.confidence IS DISTINCT FROM 'low'
      AND coalesce(o.agent_model, '') <> ''
      AND coalesce(o.extraction_method, '') <> ''
      AND o.ingested_at IS NOT NULL
      AND o.confidence_score IS NOT NULL
      AND o.confidence_score >= 0.6
      AND o.confidence_score <= 1
      AND coalesce(o.structured_data->>'needs_review', 'false') IS DISTINCT FROM 'true'
      AND (o.structured_data->'attribution_doubt') IS NULL
      AND (
        (o.structured_data->'needs_clarification') IS DISTINCT FROM 'true'::jsonb
        OR coalesce(o.structured_data->>'intent', '') = 'unknown'
        OR (
          length(coalesce(o.structured_data->>'intent', '')) > 0
          AND (o.structured_data->>'intent_confidence') ~ '^[0-9]+(\.[0-9]+)?$'
          AND (o.structured_data->>'intent_confidence')::numeric < 0.6
        )
      )
      AND NOT (
        (coalesce(o.structured_data->>'narrative_one_line', '') || ' ' ||
         coalesce(o.structured_data#>>'{components_seen,0,label}', ''))
        ~* '\y(printed|paper|album)\s+(sheet|page)\y|\yprinted\s+(\w+\s+){0,2}(photograph|picture)s?\y'
      )
  ),
  findings AS (
    SELECT
      s.*,
      r.source_key,
      r.property_key,
      s.state->>r.source_key AS value,
      (s.state->>r.source_key IS NOT NULL
        AND s.state->>r.source_key <> ''
        AND s.state->>r.source_key <> 'unknown') AS is_finding,
      (s.state->>r.source_key = ANY (r.allowed)) AS is_mapped
    FROM sources s
    CROSS JOIN registry r
  ),
  already AS (
    SELECT DISTINCT
      (c.structured_data->>'source_observation_id')::uuid AS source_observation_id,
      p.property_key,
      w.image_id
    FROM public.vehicle_observations c
    JOIN props p ON p.property_id = c.property_id
    JOIN public.observation_witnesses w
      ON w.observation_id = c.id AND w.witness_role = 'derived'
    WHERE coalesce(c.is_superseded, false) = false
  ),
  ranked AS (
    SELECT
      f.*,
      dense_rank() OVER (ORDER BY f.ingested_at, f.image_id, f.source_observation_id) AS photo_rank
    FROM findings f
    WHERE f.is_mapped
      AND NOT EXISTS (
        SELECT 1 FROM already a
        WHERE a.property_key = f.property_key
          AND a.image_id = f.image_id
      )
  ),
  chosen AS (
    SELECT *
    FROM ranked
    WHERE photo_rank <= v_cap
  ),
  claim_rows AS (
    SELECT jsonb_build_object(
      'image_id', c.image_id,
      'vehicle_id', c.vehicle_id,
      'source_observation_id', c.source_observation_id,
      'property_key', c.property_key,
      'source_key', c.source_key,
      'value', c.value,
      'confidence_score', least(c.confidence_score, 0.6),
      'agent_tier', c.agent_tier,
      'agent_model', c.agent_model,
      'source_extraction_method', c.extraction_method,
      'source_recorded_at', c.ingested_at
    ) AS item
    FROM chosen c
    ORDER BY c.ingested_at, c.image_id, c.property_key
  ),
  unmapped_rows AS (
    SELECT jsonb_build_object(
      'image_id', f.image_id,
      'source_observation_id', f.source_observation_id,
      'source_key', f.source_key,
      'value', f.value
    ) AS item
    FROM findings f
    WHERE f.is_finding AND NOT f.is_mapped
      AND f.source_observation_id IN (SELECT source_observation_id FROM chosen)
  )
  SELECT
    coalesce((SELECT count(DISTINCT image_id) FROM chosen), 0),
    coalesce((SELECT count(*) FROM chosen), 0),
    coalesce((SELECT count(*) FROM findings f WHERE f.is_finding AND NOT f.is_mapped
              AND f.source_observation_id IN (SELECT source_observation_id FROM chosen)), 0),
    coalesce((SELECT jsonb_agg(item) FROM claim_rows), '[]'::jsonb),
    coalesce((SELECT jsonb_agg(item) FROM unmapped_rows), '[]'::jsonb)
  INTO v_photos, v_claims, v_unmapped, v_items, v_unmapped_rows;

  -- Counts of eligible images that produced no claim in this cap, for the receipt only.
  SELECT coalesce(count(*), 0), coalesce(jsonb_agg(jsonb_build_object('image_id', x.image_id, 'reason', x.reason)), '[]'::jsonb)
  INTO v_skipped, v_skipped_rows
  FROM (
    SELECT 1 AS image_id, 'none'::text AS reason WHERE false
  ) x;

  RETURN jsonb_build_object(
    'run_id', p_run,
    'opened_by', p_user,
    'granted_by', p_granted_by,
    'dry_run', true,
    'signature', public.project_photo_keys_signature_v1(),
    'cap', v_cap,
    'photos', v_photos,
    'claims', v_claims,
    'unmapped', v_unmapped,
    'items', v_items,
    'unmapped_items', v_unmapped_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_project_photo_keys_v1(
  p_run uuid,
  p_user uuid,
  p_granted_by uuid,
  p_items jsonb,
  p_receipt jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_run IS NULL OR p_user IS NULL OR p_granted_by IS NULL THEN
    RAISE EXCEPTION 'record_project_photo_keys_v1 requires p_run, p_user, and p_granted_by';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'record_project_photo_keys_v1 requires p_items as a JSON array';
  END IF;
  IF EXISTS (SELECT 1 FROM public.photo_key_projection_runs r WHERE r.id = p_run) THEN
    RAISE EXCEPTION 'record_project_photo_keys_v1: run already recorded';
  END IF;

  INSERT INTO public.photo_key_projection_runs (
    id, granted_by, opened_by, dry_run, signature, closed_at, receipt
  ) VALUES (
    p_run, p_granted_by, p_user, false,
    public.project_photo_keys_signature_v1(),
    now(),
    coalesce(p_receipt, '{}'::jsonb) || jsonb_build_object('items', p_items, 'recorded', jsonb_array_length(p_items))
  );

  RETURN jsonb_build_object(
    'run_id', p_run,
    'recorded', jsonb_array_length(p_items),
    'signature', public.project_photo_keys_signature_v1()
  );
END;
$$;

-- Supersede observations this run recorded. Does not delete rows or witnesses.
CREATE OR REPLACE FUNCTION public.revert_project_photo_keys_v1(
  p_run uuid,
  p_user uuid,
  p_granted_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_run IS NULL OR p_user IS NULL OR p_granted_by IS NULL THEN
    RAISE EXCEPTION 'revert_project_photo_keys_v1 requires p_run, p_user, and p_granted_by';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.photo_key_projection_runs r
    WHERE r.id = p_run AND r.granted_by = p_granted_by
  ) THEN
    RAISE EXCEPTION 'revert_project_photo_keys_v1: unknown run or granted_by does not match';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.photo_key_projection_runs r
    WHERE r.id = p_run AND r.reverted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'revert_project_photo_keys_v1: run already reverted';
  END IF;

  UPDATE public.vehicle_observations o
  SET is_superseded = true
  FROM public.photo_key_projection_runs r,
       jsonb_array_elements(coalesce(r.receipt->'items', '[]'::jsonb)) AS item
  WHERE r.id = p_run
    AND nullif(item->>'observation_id', '')::uuid IS NOT NULL
    AND o.id = (item->>'observation_id')::uuid
    AND coalesce(o.is_superseded, false) = false;

  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.photo_key_projection_runs
  SET reverted_at = now(),
      reverted_by = p_user,
      receipt = receipt || jsonb_build_object('reverted_observations', v_n, 'reverted_by', p_user)
  WHERE id = p_run;

  RETURN jsonb_build_object(
    'run_id', p_run,
    'reverted_observations', v_n,
    'signature', public.project_photo_keys_signature_v1()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.project_photo_keys_signature_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.project_photo_keys_v1(uuid, uuid, uuid, boolean, integer, uuid[], uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_project_photo_keys_v1(uuid, uuid, uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revert_project_photo_keys_v1(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_photo_keys_signature_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.project_photo_keys_v1(uuid, uuid, uuid, boolean, integer, uuid[], uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_project_photo_keys_v1(uuid, uuid, uuid, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.revert_project_photo_keys_v1(uuid, uuid, uuid) TO service_role;

GRANT SELECT, INSERT, UPDATE ON public.photo_key_projection_runs TO service_role;
