-- =========================================================================
-- 2026-05-22 — Derive wire_terminal_pn_b for K5 MoTeC-originating wires.
--
-- For every wire whose from_pin starts with 'M130:' or 'PDM30:', the
-- Superseal-end terminal PN is determined by the wire's gauge per the
-- TE Connectivity Superseal 1.0 spec:
--
--   22-24 AWG → 3-1447221-5  (extra-small barrel; motorsport-default for
--                              fine signal wires)
--   20 AWG     → 3-1447221-4  (small barrel)
--   16-18 AWG  → 3-1447221-3  (normal barrel)
--   <=14 AWG   → OUT-OF-SPEC for Superseal 1.0
--                (system range 0.30-1.25 mm² = 22-16 AWG; SKIP these)
--
-- Source for the gauge→PN table:
--   docs/wiring/reference/connectors/CONNECTOR_DATA_REPORT.md §2.3
--   (verified against TE 4-1437290-0 catalog and motec_m1_hardware_techspec.pdf)
--
-- Confidence: 'high' (0.85 score) — this is a systematic inference, not a
-- per-wire measurement. Cited to the connector report.
-- =========================================================================
BEGIN;

DO $$
DECLARE
  v_user uuid := '0b9f107a-d124-49de-9ded-94698f63c1c4';
  v_source uuid;
  v_prop_terminal_b uuid;
  v_inserted int := 0;
  v_skipped_oversized int := 0;
  v_skipped_already int := 0;
BEGIN
  -- Use the existing k5_cut_list_v2 source (the gauge data came from there).
  SELECT id INTO v_source FROM public.observation_sources WHERE slug = 'k5_cut_list_v2';
  SELECT id INTO v_prop_terminal_b FROM public.observation_properties WHERE property_key = 'wire_terminal_pn_b';

  WITH wire_facts AS (
    SELECT
      vc.structured_data->>'wire_id' AS wire_id,
      vc.structured_data->>'from_pin' AS from_pin,
      vc.structured_data->>'loom' AS loom,
      vc.structured_data->>'label' AS label,
      gauge_obs.value::int AS gauge
    FROM public.vehicle_canonical vc
    JOIN public.observation_properties op ON op.id = vc.property_id
    LEFT JOIN LATERAL (
      SELECT vc2.structured_data->>'value' AS value
      FROM public.vehicle_canonical vc2
      JOIN public.observation_properties op2 ON op2.id = vc2.property_id
      WHERE vc2.vehicle_id = vc.vehicle_id
        AND op2.property_key = 'wire_gauge_awg'
        AND vc2.structured_data->>'wire_id' = vc.structured_data->>'wire_id'
      LIMIT 1
    ) AS gauge_obs ON true
    WHERE vc.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
      AND op.property_key = 'wire_circuit_id'
      AND (vc.structured_data->>'from_pin' LIKE 'M130:%'
        OR vc.structured_data->>'from_pin' LIKE 'PDM30:%')
  ),
  derive AS (
    SELECT wire_id, from_pin, loom, label, gauge,
      CASE
        WHEN gauge BETWEEN 22 AND 24 THEN '3-1447221-5'
        WHEN gauge = 20                THEN '3-1447221-4'
        WHEN gauge BETWEEN 16 AND 18   THEN '3-1447221-3'
        ELSE NULL
      END AS terminal_pn,
      CASE
        WHEN gauge BETWEEN 22 AND 24 THEN 'TE Superseal 1.0 socket, extra-small barrel (gold over nickel, double-spring)'
        WHEN gauge = 20                THEN 'TE Superseal 1.0 socket, small barrel'
        WHEN gauge BETWEEN 16 AND 18   THEN 'TE Superseal 1.0 socket, normal barrel'
        ELSE NULL
      END AS terminal_desc
    FROM wire_facts
    WHERE gauge IS NOT NULL
  ),
  already AS (
    SELECT DISTINCT structured_data->>'wire_id' AS wire_id
    FROM public.vehicle_observations
    WHERE property_id = v_prop_terminal_b
      AND vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
      AND is_superseded = false
  ),
  to_insert AS (
    SELECT d.* FROM derive d
    LEFT JOIN already a ON a.wire_id = d.wire_id
    WHERE d.terminal_pn IS NOT NULL
      AND a.wire_id IS NULL
  )
  INSERT INTO public.vehicle_observations
    (vehicle_id, kind, property_id, structured_data, source_id, submitted_by_user_id, observed_at, rank, confidence, confidence_score, content_text)
  SELECT
    'e08bf694-970f-4cbe-8a74-8715158a0f2e',
    'specification'::observation_kind,
    v_prop_terminal_b,
    jsonb_build_object(
      'wire_id', wire_id,
      'loom', loom,
      'label', label,
      'from_pin', from_pin,
      'property_key', 'wire_terminal_pn_b',
      'value', terminal_pn,
      'terminal_description', terminal_desc,
      'gauge_awg', gauge,
      'derivation', 'gauge→Superseal terminal PN per TE Superseal 1.0 catalog (16-22 AWG range, per-gauge barrel size)',
      'citation', 'docs/wiring/reference/connectors/CONNECTOR_DATA_REPORT.md §2.3 (Contact / Terminal Part Numbers, verified against TE 4-1437290-0 catalog)',
      'end', 'B'
    ),
    v_source, v_user, now(),
    'normal'::vfc_rank, 'high'::confidence_level, 0.85,
    format('#%s wire_terminal_pn_b=%s (%s AWG → %s)', wire_id, terminal_pn, gauge, terminal_desc)
  FROM to_insert;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RAISE NOTICE 'Inserted % wire_terminal_pn_b observations.', v_inserted;
  RAISE NOTICE 'Oversized wires (gauge < 16 AWG, out of Superseal 1.0 spec) skipped — flag as substrate_inconsistency in next pass.';
END $$;

-- Verification: PN distribution + sample
SELECT
  vo.structured_data->>'value' AS terminal_pn,
  vo.structured_data->>'gauge_awg' AS gauge,
  count(*) AS wires
FROM public.vehicle_observations vo
WHERE vo.property_id = (SELECT id FROM public.observation_properties WHERE property_key = 'wire_terminal_pn_b')
  AND vo.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
  AND vo.is_superseded = false
GROUP BY 1, 2
ORDER BY 1, 2;

\echo '=== Sample 3 wires showing wire_terminal_pn_b ==='
SELECT vo.structured_data->>'wire_id' AS wire_id,
       vo.structured_data->>'label' AS label,
       vo.structured_data->>'from_pin' AS from_pin,
       vo.structured_data->>'value' AS terminal_pn
FROM public.vehicle_observations vo
WHERE vo.property_id = (SELECT id FROM public.observation_properties WHERE property_key = 'wire_terminal_pn_b')
  AND vo.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
  AND vo.is_superseded = false
ORDER BY (vo.structured_data->>'wire_id')::text
LIMIT 8;

COMMIT;
