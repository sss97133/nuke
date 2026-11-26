-- One database snapshot of existing physical owners, not a second harness model.
-- Uniform engineering payload even under an elevated fold: private source prose
-- and recorded check details require an authorized evidence reader, never this
-- public graph or a downstream public evaluation snapshot.
-- Receipt: docs/wiring/receipts/2026-11-25_physical-workspace-reader.md
-- Verification: docs/wiring/receipts/2026-11-25_physical-workspace-reader-verification.md
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '1s';

CREATE OR REPLACE FUNCTION public.harness_schematic_model(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public SET timezone = 'UTC' AS $fn$
WITH
visible AS MATERIALIZED (
  SELECT v.id FROM public.vehicles v WHERE v.id = p_vehicle_id AND v.deleted_at IS NULL
    AND (v.is_public IS TRUE OR (auth.uid() IS NOT NULL
      AND coalesce(auth.jwt()->>'is_anonymous', 'false') <> 'true'
      AND (v.user_id = auth.uid() OR v.owner_id = auth.uid()))
      OR current_user IN ('postgres', 'service_role'))
),
physical AS MATERIALIZED (
  SELECT s.* FROM public.harness_segments s JOIN visible v ON v.id = s.vehicle_id
  WHERE NOT s.is_superseded
),
spec AS MATERIALIZED (SELECT * FROM public.harness_segment_spec_status(p_vehicle_id)),
end_references AS MATERIALIZED (
  -- Bind unresolved references too, without returning another vehicle's records.
  SELECT t.id, md5(jsonb_build_array(t.circuit_id, t.endpoint_id, t.cavity, t.cavity_layout_id,
    t.terminal_contact_catalog_id, t.pin_seal_catalog_id, t.crimp_tool_catalog_id,
    t.is_superseded, t.superseded_by)::text) AS reference_fingerprint
  FROM public.wire_termination_specs t JOIN visible v ON v.id = t.vehicle_id
),
circuits AS MATERIALIZED (
  SELECT c.id, c.circuit_code, c.circuit_name, c.harness_section, c.design_status,
    c.wire_gauge_awg, c.wire_color, c.wire_type, c.is_shielded,
    c.circuit_code AS code, c.circuit_name AS name, c.harness_section AS section,
    c.wire_gauge_awg AS gauge_awg, c.wire_color AS colour,
    CASE WHEN c.checks IS NULL THEN 'not_checked' ELSE 'unversioned' END AS legacy_check_state,
    CASE WHEN c.checks IS NOT NULL THEN md5(c.checks::text) END AS legacy_checks_hash,
    NULL::text AS source,
    NULL::text AS method, c.observed_at, c.trust, c.is_superseded, c.superseded_by,
    NULL::jsonb AS recorded_checks, c.checked_at, c.checks_version,
    c.checks_invalidated_at, NULL::text AS checks_invalidation_reason,
    -- No check writer currently binds the complete physical input snapshot.
    CASE WHEN c.checks IS NULL THEN 'not_recorded'
      WHEN c.checks_invalidated_at IS NOT NULL THEN 'invalidated'
      ELSE 'unbound' END AS check_applicability
  FROM public.vehicle_custom_circuits c
  JOIN public.vehicle_wiring_overlays o ON o.id = c.overlay_id
  JOIN visible v ON v.id = o.vehicle_id
  WHERE NOT coalesce(c.is_superseded, false)
    OR EXISTS (SELECT 1 FROM physical s WHERE s.vehicle_custom_circuit_id = c.id)
),
ends AS MATERIALIZED (
  SELECT t.id, t.circuit_id, t.endpoint_id, t.wire_code, t.cavity, t.cavity_layout_id,
    t.terminal_contact_pn, t.terminal_contact_catalog_id,
    t.pin_seal_pn, t.pin_seal_catalog_id, t.crimp_tool_pn, t.crimp_tool_catalog_id,
    t.connector_housing_pn, t.connector_housing_catalog_id,
    t.wedge_lock_pn, t.wedge_lock_catalog_id,
    NULL::text AS source,
    NULL::text AS method, t.observed_at, t.trust, t.is_superseded, t.superseded_by,
    EXISTS (SELECT 1 FROM physical s WHERE t.id IN (s.from_termination_id, s.to_termination_id)) AS physical_end
  FROM public.wire_termination_specs t JOIN visible v ON v.id = t.vehicle_id
  JOIN public.harness_endpoints e ON e.id = t.endpoint_id
  JOIN public.harness_designs d ON d.id = e.design_id AND d.vehicle_id = t.vehicle_id
  WHERE (NOT coalesce(t.is_superseded, false)
    OR EXISTS (SELECT 1 FROM physical s WHERE t.id IN (s.from_termination_id, s.to_termination_id)))
    AND (t.circuit_id IS NULL OR EXISTS (SELECT 1 FROM circuits c WHERE c.id = t.circuit_id))
),
endpoints AS MATERIALIZED (
  SELECT e.id, e.code, e.name, e.endpoint_type, e.family, e.harness_section,
    e.design_status, e.work_status, e.part_number, e.catalog_part_id,
    e.endpoint_type AS type, e.node_kind,
    e.mates_with_endpoint_id, e.topology_node_id,
    NULL::text AS source,
    NULL::text AS method, e.observed_at, e.trust, e.is_superseded, e.superseded_by
  FROM public.harness_endpoints e JOIN public.harness_designs d ON d.id = e.design_id
  JOIN visible v ON v.id = d.vehicle_id
  WHERE NOT coalesce(e.is_superseded, false) OR EXISTS (SELECT 1 FROM ends t WHERE t.endpoint_id = e.id)
),
signals AS MATERIALIZED (
  SELECT g.id, g.signal_key, g.name, g.signal_type, NULL::text AS source,
    NULL::text AS method, g.observed_at, g.trust, g.is_superseded, g.superseded_by
  FROM public.harness_signals g JOIN visible v ON v.id = g.vehicle_id
  WHERE NOT g.is_superseded OR EXISTS (
    SELECT 1 FROM public.harness_nets n WHERE n.vehicle_id = v.id AND n.signal_id = g.id
      AND (NOT n.is_superseded OR EXISTS (SELECT 1 FROM physical s WHERE s.net_id = n.id)))
),
nets AS MATERIALIZED (
  SELECT n.id, n.net_code, n.net_code AS code, g.id AS signal_id,
    md5(jsonb_build_array(n.signal_id)::text) AS signal_reference_fingerprint,
    CASE WHEN n.signal_id IS NULL THEN 'unassigned' WHEN g.id IS NULL THEN 'unresolved'
      WHEN g.is_superseded THEN 'retained' ELSE 'linked' END AS signal_link_state,
    n.function, n.nominal_current_a, n.peak_current_a,
    n.protection_pdm_channel_ids, n.protection_pdm_channel_id, n.protection_fuse_part_id,
    n.protection_setting_a, NULL::text AS source,
    NULL::text AS method, n.observed_at, n.trust,
    n.is_superseded, n.superseded_by
  FROM public.harness_nets n JOIN visible v ON v.id = n.vehicle_id
  LEFT JOIN signals g ON g.id = n.signal_id
  WHERE NOT n.is_superseded OR EXISTS (SELECT 1 FROM physical s WHERE s.net_id = n.id)
),
segments AS MATERIALIZED (
  SELECT s.id, n.id AS net_id, c.id AS circuit_id, st.current_circuit_id,
    md5(jsonb_build_array(s.net_id, s.vehicle_custom_circuit_id, s.from_termination_id,
      s.to_termination_id, s.wire_part_id, fr.reference_fingerprint, tr.reference_fingerprint)::text) AS reference_fingerprint,
    ft.id AS from_termination_id, tt.id AS to_termination_id,
    s.gauge_awg, s.colour, s.wire_part_id, cp.part_number,
    s.planned_length_ft, s.planned_length_method,
    s.measured_length_ft, s.measured_at, s.build_state, s.design_status,
    coalesce(s.design_status = 'decided' AND c.design_status = 'decided'
      AND NOT coalesce(c.is_superseded, false), false) AS in_current_plan,
    NULL::text AS source,
    NULL::text AS method, s.observed_at, s.trust,
    st.expected_gauge_awg, st.expected_colour, st.expected_part_number, st.expected_part_id,
    st.physical_progress, st.needs_revision,
    c.circuit_code, c.wire_gauge_awg AS circuit_gauge_awg, c.wire_color AS circuit_colour,
    c.wire_type, cp.part_number AS keyed_part_number,
    CASE WHEN c.id IS NULL OR n.id IS NULL OR n.is_superseded OR c.is_superseded
      OR (s.from_termination_id IS NOT NULL AND ft.id IS NULL)
      OR (s.to_termination_id IS NOT NULL AND tt.id IS NULL)
      OR (ft.id IS NOT NULL AND ft.circuit_id IS DISTINCT FROM s.vehicle_custom_circuit_id)
      OR (tt.id IS NOT NULL AND tt.circuit_id IS DISTINCT FROM s.vehicle_custom_circuit_id)
      OR (ft.id IS NOT NULL AND tt.id IS NOT NULL AND 'current_termination_pair_unresolved' = ANY(st.blockers))
      OR coalesce(ft.is_superseded, false) OR coalesce(tt.is_superseded, false) THEN 'stale'
      WHEN ft.id IS NULL OR tt.id IS NULL THEN 'incomplete' ELSE 'linked' END AS link_state,
    CASE WHEN (s.gauge_awg IS NOT NULL AND st.expected_gauge_awg IS NOT NULL AND s.gauge_awg <> st.expected_gauge_awg)
      OR (s.colour IS NOT NULL AND st.expected_colour IS NOT NULL AND lower(btrim(s.colour)) <> lower(btrim(st.expected_colour)))
      OR (s.wire_part_id IS NOT NULL AND st.expected_part_id IS NOT NULL AND s.wire_part_id <> st.expected_part_id) THEN 'conflict'
      WHEN c.id IS NULL OR st.expected_part_id IS NULL OR s.wire_part_id IS NULL
        OR s.gauge_awg IS NULL OR s.colour IS NULL THEN 'incomplete' ELSE 'agrees' END AS specification_state,
    c.legacy_check_state, c.checked_at AS legacy_checked_at, c.checks_version AS legacy_checks_version, c.legacy_checks_hash,
    coalesce(st.blockers, ARRAY['material_status_missing']::text[]) || array_remove(ARRAY[
      CASE WHEN n.id IS NULL THEN 'net_unresolved' END,
      CASE WHEN c.id IS NULL THEN 'source_circuit_unresolved' END,
      CASE WHEN ft.id IS NULL THEN 'from_termination_unresolved' END,
      CASE WHEN tt.id IS NULL THEN 'to_termination_unresolved' END,
      CASE WHEN s.wire_part_id IS NOT NULL AND cp.id IS NULL THEN 'material_part_unresolved' END
    ], NULL)::text[] AS blockers
  FROM physical s LEFT JOIN spec st ON st.segment_id = s.id
  LEFT JOIN circuits c ON c.id = s.vehicle_custom_circuit_id
  LEFT JOIN nets n ON n.id = s.net_id
  LEFT JOIN ends ft ON ft.id = s.from_termination_id AND ft.circuit_id = s.vehicle_custom_circuit_id
  LEFT JOIN ends tt ON tt.id = s.to_termination_id AND tt.circuit_id = s.vehicle_custom_circuit_id
  LEFT JOIN end_references fr ON fr.id = s.from_termination_id
  LEFT JOIN end_references tr ON tr.id = s.to_termination_id
  LEFT JOIN public.catalog_parts cp ON cp.id = s.wire_part_id
),
branches AS MATERIALIZED (
  SELECT l.id, l.landmark_code, l.description, l.distance_in, NULL::text AS method,
    l.from_node_id, l.to_node_id, l.polyline_m, NULL::text AS source_file, l.derived_on,
    l.is_superseded, l.superseded_by
  FROM public.vehicle_harness_landmarks l JOIN visible v ON v.id = l.vehicle_id
  WHERE NOT coalesce(l.is_superseded, false) OR EXISTS (
    SELECT 1 FROM public.harness_routings r JOIN physical s ON s.id = r.segment_id
    WHERE r.landmark_id = l.id AND NOT r.is_superseded)
),
routings AS MATERIALIZED (
  SELECT r.id, r.segment_id, b.id AS landmark_id, r.seq,
    md5(jsonb_build_array(r.segment_id, r.landmark_id)::text) AS reference_fingerprint,
    NULL::text AS source, r.observed_at, r.trust,
    (b.id IS NOT NULL AND NOT coalesce(b.is_superseded, false)) AS branch_current
  FROM public.harness_routings r JOIN physical s ON s.id = r.segment_id
  LEFT JOIN branches b ON b.id = r.landmark_id WHERE NOT r.is_superseded
),
topology AS MATERIALIZED (
  SELECT t.id, t.node_code, t.kind, t.pos_x_m, t.pos_y_m, t.pos_z_m,
    NULL::text AS pos_source, NULL::text AS source,
    NULL::text AS method, t.observed_at, t.trust,
    t.is_superseded, t.superseded_by
  FROM public.harness_topology_nodes t JOIN visible v ON v.id = t.vehicle_id
  WHERE NOT t.is_superseded
    OR EXISTS (SELECT 1 FROM endpoints e WHERE e.topology_node_id = t.id)
    OR EXISTS (SELECT 1 FROM branches b WHERE t.id IN (b.from_node_id, b.to_node_id))
),
mates AS MATERIALIZED (
  -- An endpoint's declared mating edge is not a third wire or a continuity test.
  SELECT DISTINCT a.id AS from_endpoint_id, b.id AS to_endpoint_id,
    'declared_endpoint_mate'::text AS relation
  FROM endpoints a JOIN endpoints b ON b.id = a.mates_with_endpoint_id
  WHERE NOT coalesce(a.is_superseded, false) AND NOT coalesce(b.is_superseded, false)
    AND (a.id < b.id OR b.mates_with_endpoint_id IS DISTINCT FROM a.id)
),
payload AS (
  SELECT jsonb_build_object(
    'schema_version', 1, 'contract_version', 1, 'vehicle_id', v.id,
    'provenance_scope', 'keyed_evidence_only',
    'circuits', coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.circuit_code, c.id) FROM circuits c), '[]'::jsonb),
    'segments', coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM segments s), '[]'::jsonb),
    'ends', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM ends t), '[]'::jsonb),
    'endpoints', coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.code, e.id) FROM endpoints e), '[]'::jsonb),
    'signals', coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.signal_key, g.id) FROM signals g), '[]'::jsonb),
    'nets', coalesce((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.net_code, n.id) FROM nets n), '[]'::jsonb),
    'routings', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.segment_id, r.seq, r.id) FROM routings r), '[]'::jsonb),
    'branches', coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.landmark_code, b.id) FROM branches b), '[]'::jsonb),
    'topology_nodes', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.node_code, t.id) FROM topology t), '[]'::jsonb),
    'mates', coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.from_endpoint_id, m.to_endpoint_id) FROM mates m), '[]'::jsonb),
    -- Legacy schematic keys remain projections of the same rows during consumer migration.
    'terminations', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM ends t WHERE t.physical_end), '[]'::jsonb),
    'connector_matings', coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.from_endpoint_id, m.to_endpoint_id) FROM mates m), '[]'::jsonb),
    'unsegmented_end_records', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', t.id, 'circuit_id', t.circuit_id, 'endpoint_id', t.endpoint_id, 'endpoint_node_kind', e.node_kind) ORDER BY t.id)
      FROM ends t JOIN endpoints e ON e.id=t.endpoint_id WHERE NOT t.physical_end), '[]'::jsonb),
    'evidence_edges', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', e.id, 'observation_id', e.observation_id, 'row_kind', e.row_kind,
      'row_id', e.row_id, 'field', e.field, 'relation', e.relation) ORDER BY e.id)
      FROM public.harness_evidence e WHERE e.vehicle_id=v.id AND (
        (e.row_kind='signal' AND EXISTS (SELECT 1 FROM signals g WHERE g.id=e.row_id))
        OR (e.row_kind='segment' AND EXISTS (SELECT 1 FROM segments s WHERE s.id=e.row_id))
        OR (e.row_kind='endpoint' AND EXISTS (SELECT 1 FROM endpoints p WHERE p.id=e.row_id))
        OR (e.row_kind='net' AND EXISTS (SELECT 1 FROM nets n WHERE n.id=e.row_id))
        OR (e.row_kind='termination' AND EXISTS (SELECT 1 FROM ends t WHERE t.id=e.row_id)))), '[]'::jsonb),
    'counts', jsonb_build_object(
      'current_circuits', (SELECT count(*) FROM circuits WHERE NOT coalesce(is_superseded, false)),
      'physical_segments', (SELECT count(*) FROM segments),
      'current_plan_segments', (SELECT count(*) FROM segments WHERE in_current_plan),
      'physical_ends', (SELECT count(*) FROM ends WHERE physical_end),
      'segments_with_material_blockers', (SELECT count(*) FROM segments WHERE cardinality(blockers) > 0),
      'segments_with_planned_length', (SELECT count(*) FROM segments WHERE planned_length_ft IS NOT NULL),
      'segments_with_measured_length', (SELECT count(*) FROM segments WHERE measured_length_ft IS NOT NULL),
      'current_circuits_without_segments', (SELECT count(*) FROM circuits c WHERE NOT coalesce(c.is_superseded, false)
        AND NOT EXISTS (SELECT 1 FROM segments s WHERE s.circuit_id = c.id)),
      'routed_segments', (SELECT count(DISTINCT segment_id) FROM routings WHERE branch_current)
    )
  ) AS data FROM visible v
)
SELECT data || jsonb_build_object('snapshot_key', md5(data::text), 'snapshot_hash', md5(data::text),
  'snapshot_kind', 'current_read_not_published_revision', 'read_at', statement_timestamp()) FROM payload;
$fn$;

COMMENT ON FUNCTION public.harness_schematic_model(uuid) IS 'Canonical physical harness workspace: one SQL snapshot of keyed segments, nets, ends, declared mates and database routing, with retained physical revision holds and unbound historical checks. NULL for unavailable vehicle. Invoker RLS and explicit same-vehicle joins; no readiness or stock assertion. Snapshot key identifies returned content, not a validation signature.';
REVOKE ALL ON FUNCTION public.harness_schematic_model(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.harness_schematic_model(uuid) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
