-- One read snapshot of the existing physical harness graph. Case ledger 13.12.
-- No source data is changed. A connector mating is never synthesized as a wire.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

CREATE FUNCTION public.harness_schematic_model(p_vehicle_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $function$
WITH eligible AS MATERIALIZED (
  SELECT v.id FROM public.vehicles v
  WHERE v.id = p_vehicle_id AND v.deleted_at IS NULL
    AND (v.is_public IS TRUE OR v.user_id = auth.uid() OR v.owner_id = auth.uid())
), circuits AS MATERIALIZED (
  SELECT c.* FROM public.vehicle_custom_circuits c
  JOIN public.vehicle_wiring_overlays o ON o.id = c.overlay_id
  JOIN eligible v ON v.id = o.vehicle_id
  WHERE NOT coalesce(c.is_superseded, false)
), endpoints AS MATERIALIZED (
  SELECT e.* FROM public.harness_endpoints e
  JOIN public.harness_designs d ON d.id = e.design_id
  JOIN eligible v ON v.id = d.vehicle_id
  WHERE NOT coalesce(e.is_superseded, false)
), ends AS MATERIALIZED (
  SELECT t.* FROM public.wire_termination_specs t JOIN eligible v ON v.id = t.vehicle_id
  WHERE NOT coalesce(t.is_superseded, false)
), nets AS MATERIALIZED (
  SELECT n.* FROM public.harness_nets n JOIN eligible v ON v.id = n.vehicle_id
  WHERE NOT n.is_superseded
), segments AS MATERIALIZED (
  SELECT s.* FROM public.harness_segments s JOIN eligible v ON v.id = s.vehicle_id
  WHERE NOT s.is_superseded
), colour_codes AS (
  SELECT c.id, CASE WHEN count(*) = count(x.digit)
    THEN string_agg(x.digit, '' ORDER BY u.ord) END AS digits
  FROM circuits c
  CROSS JOIN LATERAL unnest(string_to_array(lower(nullif(btrim(c.wire_color), '')), '/'))
    WITH ORDINALITY u(colour, ord)
  CROSS JOIN LATERAL (SELECT CASE btrim(u.colour)
    WHEN 'black' THEN '0' WHEN 'brown' THEN '1' WHEN 'red' THEN '2' WHEN 'orange' THEN '3'
    WHEN 'yellow' THEN '4' WHEN 'green' THEN '5' WHEN 'blue' THEN '6' WHEN 'violet' THEN '7'
    WHEN 'gray' THEN '8' WHEN 'white' THEN '9' END AS digit) x
  GROUP BY c.id
), circuit_parts AS (
  SELECT c.id, CASE WHEN c.wire_type ~ '^M22759/(16|32)$' AND c.wire_gauge_awg > 0
    AND cc.digits IS NOT NULL THEN c.wire_type || '-' || c.wire_gauge_awg || '-' || cc.digits END AS expected_part_number
  FROM circuits c LEFT JOIN colour_codes cc ON cc.id = c.id
), segment_records AS (
  SELECT s.id, s.net_id, s.vehicle_custom_circuit_id AS circuit_id,
    s.from_termination_id, s.to_termination_id, s.wire_part_id,
    s.gauge_awg, s.colour, s.planned_length_ft, s.planned_length_method,
    s.measured_length_ft, s.measured_at, s.build_state, s.design_status,
    c.circuit_code, c.wire_gauge_awg AS circuit_gauge_awg, c.wire_color AS circuit_colour,
    c.wire_type, p.part_number AS keyed_part_number, cp.expected_part_number,
    CASE
      WHEN c.id IS NULL OR n.id IS NULL
        OR (s.from_termination_id IS NOT NULL AND (f.id IS NULL OR ef.id IS NULL))
        OR (s.to_termination_id IS NOT NULL AND (t.id IS NULL OR et.id IS NULL))
        OR (f.id IS NOT NULL AND f.circuit_id IS DISTINCT FROM s.vehicle_custom_circuit_id)
        OR (t.id IS NOT NULL AND t.circuit_id IS DISTINCT FROM s.vehicle_custom_circuit_id) THEN 'stale'
      WHEN s.from_termination_id IS NULL OR s.to_termination_id IS NULL THEN 'incomplete'
      ELSE 'linked' END AS link_state,
    CASE
      WHEN (s.gauge_awg IS NOT NULL AND c.wire_gauge_awg IS NOT NULL AND s.gauge_awg <> c.wire_gauge_awg)
        OR (nullif(btrim(s.colour), '') IS NOT NULL AND nullif(btrim(c.wire_color), '') IS NOT NULL
          AND lower(btrim(s.colour)) <> lower(btrim(c.wire_color)))
        OR (p.part_number IS NOT NULL AND cp.expected_part_number IS NOT NULL
          AND p.part_number <> cp.expected_part_number) THEN 'conflict'
      WHEN s.gauge_awg IS NULL OR nullif(btrim(s.colour), '') IS NULL
        OR c.wire_gauge_awg IS NULL OR nullif(btrim(c.wire_color), '') IS NULL
        OR cp.expected_part_number IS NULL OR p.id IS NULL THEN 'incomplete'
      ELSE 'agrees' END AS specification_state,
    -- No existing check row carries a fingerprint of these physical inputs.
    CASE WHEN c.checks IS NULL THEN 'not_checked' ELSE 'unversioned' END AS legacy_check_state,
    c.checked_at AS legacy_checked_at, c.checks_version AS legacy_checks_version,
    CASE WHEN c.checks IS NOT NULL THEN md5(c.checks::text) END AS legacy_checks_hash
  FROM segments s
  LEFT JOIN circuits c ON c.id = s.vehicle_custom_circuit_id
  LEFT JOIN circuit_parts cp ON cp.id = c.id
  LEFT JOIN public.catalog_parts p ON p.id = s.wire_part_id
  LEFT JOIN nets n ON n.id = s.net_id
  LEFT JOIN ends f ON f.id = s.from_termination_id
  LEFT JOIN ends t ON t.id = s.to_termination_id
  LEFT JOIN endpoints ef ON ef.id = f.endpoint_id
  LEFT JOIN endpoints et ON et.id = t.endpoint_id
), physical_ends AS (
  SELECT t.id, t.circuit_id, t.endpoint_id, t.cavity, t.cavity_layout_id,
    t.terminal_contact_catalog_id, t.terminal_contact_pn,
    t.pin_seal_catalog_id, t.pin_seal_pn, t.crimp_tool_catalog_id, t.crimp_tool_pn
  FROM ends t WHERE EXISTS (
    SELECT 1 FROM segments s WHERE t.id IN (s.from_termination_id, s.to_termination_id))
), mating_pairs AS (
  -- The stored endpoint FK is the witness. No code sorting, cavity-name matching or length is invented.
  SELECT DISTINCT least(e.id, m.id) AS from_endpoint_id, greatest(e.id, m.id) AS to_endpoint_id
  FROM endpoints e JOIN endpoints m ON m.id = e.mates_with_endpoint_id
), current_ids AS (
  SELECT id FROM circuits UNION SELECT id FROM endpoints UNION SELECT id FROM nets
  UNION SELECT id FROM segments UNION SELECT id FROM physical_ends
), graph AS (
  SELECT jsonb_build_object(
    'contract_version', 1,
    'vehicle_id', p_vehicle_id,
    'circuits', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'code', c.circuit_code, 'name', c.circuit_name, 'design_status', c.design_status,
      'section', c.harness_section,
      'gauge_awg', c.wire_gauge_awg, 'colour', c.wire_color, 'wire_type', c.wire_type,
      'legacy_checks_hash', CASE WHEN c.checks IS NOT NULL THEN md5(c.checks::text) END,
      'legacy_check_state', CASE WHEN c.checks IS NULL THEN 'not_checked' ELSE 'unversioned' END)
      ORDER BY c.id) FROM circuits c), '[]'::jsonb),
    'endpoints', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', e.id, 'code', e.code, 'name', e.name, 'type', e.endpoint_type,
      'node_kind', e.node_kind, 'part_number', e.part_number, 'topology_node_id', e.topology_node_id)
      ORDER BY e.id) FROM endpoints e), '[]'::jsonb),
    'nets', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', n.id, 'code', n.net_code, 'signal_id', n.signal_id, 'function', n.function,
      'nominal_current_a', n.nominal_current_a, 'peak_current_a', n.peak_current_a,
      'protection_pdm_channel_ids', n.protection_pdm_channel_ids,
      'protection_pdm_channel_id', n.protection_pdm_channel_id,
      'protection_fuse_part_id', n.protection_fuse_part_id, 'protection_setting_a', n.protection_setting_a)
      ORDER BY n.id) FROM nets n), '[]'::jsonb),
    'segments', coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM segment_records s), '[]'::jsonb),
    'terminations', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM physical_ends t), '[]'::jsonb),
    'connector_matings', coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.from_endpoint_id, m.to_endpoint_id)
      FROM mating_pairs m), '[]'::jsonb),
    'unsegmented_end_records', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', t.id, 'circuit_id', t.circuit_id, 'endpoint_id', t.endpoint_id,
      'endpoint_node_kind', e.node_kind) ORDER BY t.id)
      FROM ends t LEFT JOIN endpoints e ON e.id = t.endpoint_id
      WHERE NOT EXISTS (SELECT 1 FROM physical_ends f WHERE f.id = t.id)), '[]'::jsonb),
    'evidence_edges', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', e.id, 'observation_id', e.observation_id, 'row_kind', e.row_kind,
      'row_id', e.row_id, 'field', e.field, 'relation', e.relation) ORDER BY e.id)
      FROM public.harness_evidence e JOIN eligible v ON v.id = e.vehicle_id
      WHERE e.row_id IN (SELECT id FROM current_ids)), '[]'::jsonb)
  ) AS payload
)
SELECT CASE WHEN EXISTS (SELECT 1 FROM eligible) THEN payload || jsonb_build_object(
  'snapshot_hash', md5(payload::text), 'read_at', statement_timestamp(),
  'snapshot_kind', 'current_read_not_published_revision') ELSE NULL END
FROM graph;
$function$;

COMMENT ON FUNCTION public.harness_schematic_model(uuid) IS
'Read-only, invoker-RLS physical harness graph: existing net/segment/end IDs and stored connector mating FKs in one read snapshot. Conflicting circuit/segment/part values are exposed, not silently chosen; legacy checks are unversioned. snapshot_hash is read content identity, not an atomic published engineering revision. No source rows or physical-build claims are changed. Case ledger 13.12.';
REVOKE ALL ON FUNCTION public.harness_schematic_model(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.harness_schematic_model(uuid) TO anon, authenticated, service_role;
COMMIT;
