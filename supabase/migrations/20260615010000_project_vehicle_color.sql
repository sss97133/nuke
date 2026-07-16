-- Phase 2 — time-varying color projection.
--
-- The `vehicles` color columns were written ad-hoc by extractors (no pipeline_registry
-- owner), which is how a blue/black Mustang ended up with color_family='Red'. This makes
-- the PROJECTION the owner: canonical color is recomputed FROM the evidence-cited claim set
-- (vehicle.current_color / vehicle.original_color / vehicle.refinish_event atoms), with
-- provenance. It supersedes the corrupt derived value instead of an agent raw-overwriting it.
--
-- Read-mostly: it only mutates vehicles when a current_color claim actually exists, and it
-- stamps color_source='nuke_projection:claims' so the number carries its source DNA.

CREATE OR REPLACE FUNCTION public.project_vehicle_color(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current        jsonb;
  v_original       jsonb;
  v_history        jsonb;
  v_current_color  text;
  v_original_color text;
  v_family         text;
  v_prior_color    text;
  v_prior_family   text;
BEGIN
  -- Weighted pick (base_trust * confidence) of the current_color claims; latest breaks ties.
  SELECT to_jsonb(t) INTO v_current FROM (
    SELECT pe.result_envelope->'label' AS label, pe.evidence_class, pe.observed_at,
           (COALESCE(mr.base_trust, 0.3) * COALESCE((pe.result_envelope->>'confidence')::numeric, 0.5)) AS weight
    FROM projection_event pe
    LEFT JOIN model_registry mr ON mr.id = pe.model_id
    WHERE pe.request_envelope->>'subject_id' = p_vehicle_id::text
      AND pe.request_envelope->>'attribute' = 'vehicle.current_color'
      AND pe.retracted_at IS NULL
    ORDER BY weight DESC, pe.observed_at DESC
    LIMIT 1
  ) t;

  SELECT to_jsonb(t) INTO v_original FROM (
    SELECT pe.result_envelope->'label' AS label, pe.evidence_class, pe.observed_at,
           (COALESCE(mr.base_trust, 0.3) * COALESCE((pe.result_envelope->>'confidence')::numeric, 0.5)) AS weight
    FROM projection_event pe
    LEFT JOIN model_registry mr ON mr.id = pe.model_id
    WHERE pe.request_envelope->>'subject_id' = p_vehicle_id::text
      AND pe.request_envelope->>'attribute' = 'vehicle.original_color'
      AND pe.retracted_at IS NULL
    ORDER BY weight DESC, pe.observed_at DESC
    LIMIT 1
  ) t;

  -- Full change history: every color/refinish atom, newest first, with its citation.
  SELECT jsonb_agg(h ORDER BY h.observed_at DESC) INTO v_history FROM (
    SELECT jsonb_build_object(
             'attribute', pe.request_envelope->>'attribute',
             'value', pe.result_envelope->'label',
             'evidence_class', pe.evidence_class,
             'evidence_ref', pe.evidence_ref,
             'confidence', (pe.result_envelope->>'confidence'),
             'observed_at', pe.observed_at
           ) AS h, pe.observed_at
    FROM projection_event pe
    WHERE pe.request_envelope->>'subject_id' = p_vehicle_id::text
      AND pe.request_envelope->>'attribute' IN
          ('vehicle.current_color','vehicle.original_color','vehicle.refinish_event')
      AND pe.retracted_at IS NULL
  ) h;

  -- Labels may be structured ({color, hex}) or a bare string.
  v_current_color  := lower(COALESCE(v_current->'label'->>'color',  v_current->>'label'));
  v_original_color := lower(COALESCE(v_original->'label'->>'color', v_original->>'label'));

  v_family := CASE
    WHEN v_current_color IS NULL THEN NULL
    WHEN v_current_color ~ 'black|satin_black|gloss_black' THEN 'Black'
    WHEN v_current_color ~ 'white|pearl' THEN 'White'
    WHEN v_current_color ~ 'silver|gray|grey|gunmetal|raw_metal|primer' THEN 'Silver'
    WHEN v_current_color ~ 'blue|turquoise|teal' THEN 'Blue'
    WHEN v_current_color ~ 'red|maroon|burgundy' THEN 'Red'
    WHEN v_current_color ~ 'green|olive' THEN 'Green'
    WHEN v_current_color ~ 'yellow|gold' THEN 'Yellow'
    WHEN v_current_color ~ 'orange' THEN 'Orange'
    WHEN v_current_color ~ 'brown|tan|beige|bronze' THEN 'Brown'
    ELSE initcap(split_part(v_current_color, '_', 1))
  END;

  -- Only the projection touches canonical color, and only when a claim backs it.
  IF v_current_color IS NOT NULL THEN
    SELECT color, color_family INTO v_prior_color, v_prior_family FROM vehicles WHERE id = p_vehicle_id;
    UPDATE vehicles
       SET color = initcap(replace(v_current_color, '_', ' ')),
           color_family = v_family,
           color_source = 'nuke_projection:claims'
     WHERE id = p_vehicle_id;
  END IF;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'current_color', v_current_color,
    'current_evidence_class', v_current->>'evidence_class',
    'original_color', v_original_color,
    'original_evidence_class', v_original->>'evidence_class',
    'color_family', v_family,
    'prior_canonical', jsonb_build_object('color', v_prior_color, 'color_family', v_prior_family),
    'superseded_corrupt_family', (v_prior_family IS DISTINCT FROM v_family AND v_current_color IS NOT NULL),
    'history', COALESCE(v_history, '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.project_vehicle_color(uuid) IS
  'Phase 2: projects canonical vehicle color (current + family) from the evidence-cited claim set (current_color/original_color/refinish_event projection_event atoms). Owner of vehicles.color/color_family/color_source going forward; supersedes ad-hoc extractor writes. Returns the projection incl. original_color, change history, and whether it superseded a contradicted family.';
