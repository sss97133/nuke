-- v2 — materialize wire facts to a temp table, then 4 quick INSERTs.
-- Same inference as v1 but avoids re-scanning vehicle_canonical 4×.
BEGIN;

SET LOCAL statement_timeout = '120s';

-- Materialize the per-wire inputs once.
CREATE TEMP TABLE tmp_wire_inputs ON COMMIT DROP AS
SELECT
  vc.structured_data->>'wire_id' AS wire_id,
  vc.structured_data->>'loom' AS loom,
  vc.structured_data->>'label' AS label,
  gauge.value::int AS gauge_int,
  CASE gauge.value::int
    WHEN 22 THEN 'SCL-1/8-0'
    WHEN 20 THEN 'SCL-3/16-0'
    WHEN 18 THEN 'SCL-1/4-0'
    WHEN 16 THEN 'SCL-3/8-0'
  END AS inner_pn,
  CASE gauge.value::int
    WHEN 22 THEN 'DR-25-3/8-0-STK'
    WHEN 20 THEN 'DR-25-3/8-0-STK'
    WHEN 18 THEN 'DR-25-1/2-0-STK'
    WHEN 16 THEN 'DR-25-5/8-0-STK'
  END AS outer_pn
FROM public.vehicle_canonical vc
JOIN public.observation_properties op ON op.id = vc.property_id
JOIN LATERAL (
  SELECT (vc2.structured_data->>'value') AS value
  FROM public.vehicle_canonical vc2
  JOIN public.observation_properties op2 ON op2.id = vc2.property_id
  WHERE vc2.vehicle_id = vc.vehicle_id
    AND op2.property_key = 'wire_gauge_awg'
    AND vc2.structured_data->>'wire_id' = vc.structured_data->>'wire_id'
  LIMIT 1
) AS gauge ON true
WHERE vc.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
  AND op.property_key = 'wire_circuit_id'
  AND gauge.value ~ '^[0-9]+$'
  AND gauge.value::int BETWEEN 16 AND 22;

CREATE INDEX ON tmp_wire_inputs (wire_id);

DO $$
DECLARE
  v_user uuid := '0b9f107a-d124-49de-9ded-94698f63c1c4';
  v_source uuid;
  v_prop_a_inner uuid;
  v_prop_a_outer uuid;
  v_prop_b_inner uuid;
  v_prop_b_outer uuid;
  v_tot int;
  v_total_inserted int := 0;
  v_n int;
BEGIN
  SELECT count(*) INTO v_tot FROM tmp_wire_inputs;
  RAISE NOTICE 'tmp_wire_inputs has % wires with valid gauge (16-22 AWG).', v_tot;

  INSERT INTO public.observation_sources
    (slug, display_name, category, base_trust_score, supported_observations, notes, tier)
  VALUES
    ('k5_milspec_termination_inference',
     'K5 Mil-Spec Termination Inference (gauge→SCL+DR-25 PN derivation)',
     'internal', 0.65,
     ARRAY['specification']::observation_kind[],
     'Systematic gauge→PN inference for termination heat-shrink stack per Raychem catalog single-wire OD sizing. Documented in docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md §3.',
     2)
  ON CONFLICT (slug) DO UPDATE SET updated_at = now();

  SELECT id INTO v_source FROM public.observation_sources WHERE slug = 'k5_milspec_termination_inference';
  SELECT id INTO v_prop_a_inner FROM public.observation_properties WHERE property_key = 'wire_termination_a_inner_seal_pn';
  SELECT id INTO v_prop_a_outer FROM public.observation_properties WHERE property_key = 'wire_termination_a_outer_cover_pn';
  SELECT id INTO v_prop_b_inner FROM public.observation_properties WHERE property_key = 'wire_termination_b_inner_seal_pn';
  SELECT id INTO v_prop_b_outer FROM public.observation_properties WHERE property_key = 'wire_termination_b_outer_cover_pn';

  -- End A inner
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  SELECT 'e08bf694-970f-4cbe-8a74-8715158a0f2e'::uuid,
         'specification'::observation_kind,
         v_prop_a_inner,
         jsonb_build_object(
           'wire_id', t.wire_id, 'loom', t.loom, 'label', t.label, 'end', 'A',
           'property_key', 'wire_termination_a_inner_seal_pn',
           'value', t.inner_pn, 'gauge_awg', t.gauge_int,
           'spec', 'M23053/4 Class 2 (Raychem SCL)',
           'derivation', 'gauge → single-wire SCL size per Raychem catalog recovered-OD table',
           'citation', 'docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md §3'),
         v_source, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.65,
         format('#%s wire_termination_a_inner_seal_pn=%s (%s AWG)', t.wire_id, t.inner_pn, t.gauge_int)
  FROM tmp_wire_inputs t;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_total_inserted := v_total_inserted + v_n;
  RAISE NOTICE 'End A inner: % inserted', v_n;

  -- End A outer
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  SELECT 'e08bf694-970f-4cbe-8a74-8715158a0f2e'::uuid,
         'specification'::observation_kind,
         v_prop_a_outer,
         jsonb_build_object(
           'wire_id', t.wire_id, 'loom', t.loom, 'label', t.label, 'end', 'A',
           'property_key', 'wire_termination_a_outer_cover_pn',
           'value', t.outer_pn, 'gauge_awg', t.gauge_int,
           'spec', 'M23053/16 (Raychem DR-25)',
           'derivation', 'gauge → per-termination DR-25 size',
           'citation', 'docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md §3'),
         v_source, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.65,
         format('#%s wire_termination_a_outer_cover_pn=%s (%s AWG)', t.wire_id, t.outer_pn, t.gauge_int)
  FROM tmp_wire_inputs t;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_total_inserted := v_total_inserted + v_n;
  RAISE NOTICE 'End A outer: % inserted', v_n;

  -- End B inner
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  SELECT 'e08bf694-970f-4cbe-8a74-8715158a0f2e'::uuid,
         'specification'::observation_kind,
         v_prop_b_inner,
         jsonb_build_object(
           'wire_id', t.wire_id, 'loom', t.loom, 'label', t.label, 'end', 'B',
           'property_key', 'wire_termination_b_inner_seal_pn',
           'value', t.inner_pn, 'gauge_awg', t.gauge_int,
           'spec', 'M23053/4 Class 2 (Raychem SCL)',
           'derivation', 'gauge → single-wire SCL size',
           'citation', 'docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md §3'),
         v_source, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.65,
         format('#%s wire_termination_b_inner_seal_pn=%s (%s AWG)', t.wire_id, t.inner_pn, t.gauge_int)
  FROM tmp_wire_inputs t;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_total_inserted := v_total_inserted + v_n;
  RAISE NOTICE 'End B inner: % inserted', v_n;

  -- End B outer
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  SELECT 'e08bf694-970f-4cbe-8a74-8715158a0f2e'::uuid,
         'specification'::observation_kind,
         v_prop_b_outer,
         jsonb_build_object(
           'wire_id', t.wire_id, 'loom', t.loom, 'label', t.label, 'end', 'B',
           'property_key', 'wire_termination_b_outer_cover_pn',
           'value', t.outer_pn, 'gauge_awg', t.gauge_int,
           'spec', 'M23053/16 (Raychem DR-25)',
           'derivation', 'gauge → per-termination DR-25 size',
           'citation', 'docs/wiring/research/2026-05-21_milspec_heatshrink_protocols.md §3'),
         v_source, v_user, now(), 'normal'::vfc_rank, 'inferred'::confidence_level, 0.65,
         format('#%s wire_termination_b_outer_cover_pn=%s (%s AWG)', t.wire_id, t.outer_pn, t.gauge_int)
  FROM tmp_wire_inputs t;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_total_inserted := v_total_inserted + v_n;
  RAISE NOTICE 'End B outer: % inserted', v_n;

  RAISE NOTICE 'TOTAL: % termination-stack observations inserted.', v_total_inserted;
END $$;

-- Verification
\echo '=== Termination stack: rows per property × PN ==='
SELECT op.property_key,
       (vo.structured_data->>'value') AS pn,
       count(*) AS observations
FROM public.vehicle_observations vo
JOIN public.observation_properties op ON op.id = vo.property_id
WHERE op.property_key IN (
  'wire_termination_a_inner_seal_pn','wire_termination_a_outer_cover_pn',
  'wire_termination_b_inner_seal_pn','wire_termination_b_outer_cover_pn'
)
  AND vo.is_superseded = false
GROUP BY 1, 2 ORDER BY 1, 2;

\echo '=== K5 build coverage ==='
SELECT
  (SELECT count(*) FROM public.vehicle_observations
    WHERE vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e'
      AND property_id IS NOT NULL AND is_superseded = false) AS k5_cited_cells,
  162 * 25 AS build_target,
  round(100.0 * (SELECT count(*) FROM public.vehicle_observations
    WHERE vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e'
      AND property_id IS NOT NULL AND is_superseded = false)::numeric / (162 * 25), 1) AS pct;

COMMIT;
