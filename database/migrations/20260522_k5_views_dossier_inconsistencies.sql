-- =========================================================================
-- 2026-05-22 — Two substrate views to make the K5 wiring data ergonomic:
--
-- 1. v_k5_wire_dossier — one row per wire, columns for every wiring
--    property currently in observation_properties. The "everything we know
--    about wire #110" question answered with one SELECT. Built dynamically
--    via crosstab/pivot from vehicle_canonical.
--
-- 2. v_k5_substrate_inconsistencies — known gauge-vs-connector mismatches
--    and other physics violations. First instance: wires with gauge < 16
--    AWG terminating at MoTeC Superseal pins. The institution's substrate
--    accepts the claims (it's testimony), but the view surfaces the
--    inconsistency for review.
-- =========================================================================

-- v_k5_wire_dossier — pivot vehicle_canonical wiring properties into wire rows.
-- One row per (vehicle_id, wire_id). Each wiring property becomes a column.
CREATE OR REPLACE VIEW public.v_k5_wire_dossier AS
SELECT
  vc.vehicle_id,
  vc.discriminator_value AS wire_id,
  max(vc.structured_data->>'loom')   FILTER (WHERE op.property_key = 'wire_circuit_id') AS loom,
  max(vc.structured_data->>'label')  FILTER (WHERE op.property_key = 'wire_circuit_id') AS label,
  max(vc.structured_data->>'from_pin') FILTER (WHERE op.property_key = 'wire_circuit_id') AS from_pin,

  max(vc.structured_data->>'value') FILTER (WHERE op.property_key = 'wire_gauge_awg')     AS gauge_awg,
  max(vc.structured_data->>'value') FILTER (WHERE op.property_key = 'wire_color_code')    AS color,
  max(vc.structured_data->>'value') FILTER (WHERE op.property_key = 'wire_specification') AS spec,
  max(vc.structured_data->>'value') FILTER (WHERE op.property_key = 'wire_length_in')     AS length_in,

  max(vc.structured_data->>'value') FILTER (WHERE op.property_key = 'wire_terminal_pn_a') AS terminal_a,
  max(vc.structured_data->>'value') FILTER (WHERE op.property_key = 'wire_terminal_pn_b') AS terminal_b,

  max(vc.structured_data->>'value') FILTER (WHERE op.property_key = 'wire_termination_a_inner_seal_pn')  AS term_a_inner,
  max(vc.structured_data->>'value') FILTER (WHERE op.property_key = 'wire_termination_a_outer_cover_pn') AS term_a_outer,
  max(vc.structured_data->>'value') FILTER (WHERE op.property_key = 'wire_termination_b_inner_seal_pn')  AS term_b_inner,
  max(vc.structured_data->>'value') FILTER (WHERE op.property_key = 'wire_termination_b_outer_cover_pn') AS term_b_outer,

  max(vc.structured_data->>'value') FILTER (WHERE op.property_key = 'wire_label_a_text') AS label_a,
  max(vc.structured_data->>'value') FILTER (WHERE op.property_key = 'wire_label_b_text') AS label_b,

  max(vc.structured_data->>'value') FILTER (WHERE op.property_key = 'wire_crimp_a_die_pn')        AS crimp_a_die,
  max(vc.structured_data->>'value') FILTER (WHERE op.property_key = 'wire_crimp_b_die_pn')        AS crimp_b_die,
  max(vc.structured_data->>'value') FILTER (WHERE op.property_key = 'wire_crimp_a_pull_test_lbf') AS pull_test_a,
  max(vc.structured_data->>'value') FILTER (WHERE op.property_key = 'wire_crimp_b_pull_test_lbf') AS pull_test_b,

  count(*) AS cited_cells,
  count(*) FILTER (WHERE vc.confidence_score >= 0.85) AS high_conf_cells
FROM public.vehicle_canonical vc
JOIN public.observation_properties op ON op.id = vc.property_id
WHERE op.category = 'wiring'
  AND op.discriminator_key = 'wire_id'
GROUP BY vc.vehicle_id, vc.discriminator_value;

COMMENT ON VIEW public.v_k5_wire_dossier IS
  'One row per (vehicle, wire). Pivots vehicle_canonical wiring observations into a dossier shape. Use for: "what do we know about wire X?", "which wires are missing a terminal_pn_b?", "build coverage per wire".';


-- v_k5_substrate_inconsistencies — surface known mismatches.
CREATE OR REPLACE VIEW public.v_k5_substrate_inconsistencies AS
-- Inconsistency type 1: gauge-vs-Superseal-spec
SELECT
  vehicle_id,
  wire_id,
  loom,
  label,
  from_pin,
  'gauge_exceeds_superseal_spec' AS inconsistency_type,
  format('Wire is %s AWG but %s requires 16-22 AWG (Superseal 1.0 spec range). Likely paralleled-pin power feed (BAT_NEG/BAT_POS) or junction-block routing not captured in cut list.', gauge_awg, from_pin) AS detail,
  'CONNECTOR_DATA_REPORT.md §2.1 (Superseal 1.0 wire range: 22-16 AWG)' AS citation
FROM public.v_k5_wire_dossier
WHERE gauge_awg IS NOT NULL
  AND gauge_awg ~ '^[0-9]+$'
  AND gauge_awg::int < 16
  AND (from_pin LIKE 'M130:%' OR from_pin LIKE 'PDM30:%');

COMMENT ON VIEW public.v_k5_substrate_inconsistencies IS
  'Physics-violations in the substrate that need human review. Currently surfaces gauge-vs-connector mismatches. Add new SELECTs (UNION ALL) here as new inconsistency types are identified.';


-- Build-progress view too
CREATE OR REPLACE VIEW public.v_k5_build_coverage AS
WITH wiring_props AS (
  SELECT id, property_key FROM public.observation_properties WHERE category = 'wiring'
),
totals AS (
  SELECT
    wp.property_key,
    (SELECT count(*) FROM public.vehicle_observations vo
      WHERE vo.property_id = wp.id
        AND vo.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
        AND vo.is_superseded = false) AS cited_cells
  FROM wiring_props wp
)
SELECT
  property_key,
  cited_cells,
  162 AS wire_target,
  round(100.0 * cited_cells::numeric / 162, 1) AS pct_wires_covered
FROM totals
ORDER BY property_key;

COMMENT ON VIEW public.v_k5_build_coverage IS
  'Per-property coverage of the K5 build target (162 wires). Shows how many wires have a cited claim for each wiring property.';

NOTIFY pgrst, 'reload schema';

-- Verification
\echo '=== v_k5_substrate_inconsistencies — first 15 ==='
SELECT wire_id, loom, gauge_awg_count.gauge AS gauge, from_pin, label
FROM public.v_k5_substrate_inconsistencies inc
JOIN (
  SELECT wire_id, gauge_awg AS gauge FROM public.v_k5_wire_dossier WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
) AS gauge_awg_count USING (wire_id)
ORDER BY gauge_awg_count.gauge::int DESC, wire_id
LIMIT 15;

\echo '=== Build coverage per property ==='
SELECT * FROM public.v_k5_build_coverage;

\echo '=== Sample dossier: wires #4a, #110, #62 ==='
SELECT wire_id, gauge_awg, color, length_in, terminal_b, term_b_inner, term_b_outer, label_a, label_b, cited_cells
FROM public.v_k5_wire_dossier
WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
  AND wire_id IN ('4a', '110', '62')
ORDER BY wire_id;