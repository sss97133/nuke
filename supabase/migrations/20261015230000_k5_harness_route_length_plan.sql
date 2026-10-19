-- RSI pass 34 on the harness model: a routed segment's length is predicted from its route, and the scoreboard checks
-- every plan against its route. Case ledger 13.12.3.
--
-- Pass 33 (#1650) routed 121 of 670 segments over the twin route graph. Live as anon at 18:57Z, only 15 of those 121
-- carry a planned length (the reshape split each wire's whole-length zone estimate only where the wire had one
-- segment; "unknown: the whole-wire estimate was never split at its junctions" for the rest). Those 15 run on average
-- 4.0x their route (minimum 1.88x), so no plan is shorter than its route, and nothing checked it.
--
-- This pass:
--   1. v_harness_route_length_check: per routed segment of a public vehicle, its route (the sum of its live branches,
--      inches and feet, and the branch count), its planned length and method, and the ratio.
--   2. plan_harness_segment_lengths(vehicle): a routed segment with no planned length, or one this rule planned, gets
--      route length x the record's pad: 1.20 in the engine section, 1.15 elsewhere (K5_WIRING_STATE.md row 33: "20 %
--      engine bay, 15 % body"). The method names the route, the branch count and the pad. When a route changes, its
--      plan follows. A plan from the cut list or a measurement is never touched.
--   3. The scoreboard: routed segments planned shorter than their route (must be 0).
-- The registry loader calls the planner after routing.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF to_regprocedure('public.route_harness_segments(uuid)') IS NULL THEN
    RAISE EXCEPTION 'RSI pass 33 (20261015220000) has not run';
  END IF;
  IF to_regprocedure('public.plan_harness_segment_lengths(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'plan_harness_segment_lengths already exists';
  END IF;
END $guard$;

-- 1. Plan against route.
CREATE VIEW public.v_harness_route_length_check AS
SELECT s.vehicle_id, s.id AS segment_id, c.circuit_code, c.harness_section,
       r.route_in, round(r.route_in / 12.0, 2) AS route_ft, r.branches,
       s.planned_length_ft AS planned_ft, s.planned_length_method,
       round(s.planned_length_ft / nullif(r.route_in / 12.0, 0), 2) AS planned_over_route
FROM public.harness_segments s
JOIN public.vehicles v ON v.id = s.vehicle_id AND v.is_public IS TRUE
JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
JOIN LATERAL (SELECT sum(l.distance_in) AS route_in, count(*) AS branches
              FROM public.harness_routings h JOIN public.vehicle_harness_landmarks l ON l.id = h.landmark_id
              WHERE h.segment_id = s.id AND NOT h.is_superseded) r ON r.branches > 0
WHERE NOT s.is_superseded;
COMMENT ON VIEW public.v_harness_route_length_check IS 'Per routed live segment of a public vehicle: its route (sum of its live route-graph branches, inches and feet, and how many), its planned length and how it was planned, and planned / route. A plan shorter than its route is a cut that cannot reach (scoreboard, must be 0). RSI pass 34, case ledger 13.12.3.';
REVOKE ALL ON public.v_harness_route_length_check FROM anon, authenticated;
GRANT SELECT ON public.v_harness_route_length_check TO anon, authenticated;

-- 2. The planner.
CREATE FUNCTION public.plan_harness_segment_lengths(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE n_planned int; n_replanned int;
BEGIN
  WITH t AS (
    SELECT s.id, s.planned_length_ft AS old_ft,
           round(r.route_in / 12.0 * CASE WHEN c.harness_section = 'engine' THEN 1.20 ELSE 1.15 END, 2) AS new_ft,
           'route length x pad (RSI pass 34): ' || r.route_in || ' in over ' || r.branches || ' branch'
             || CASE WHEN r.branches = 1 THEN '' ELSE 'es' END || ' x '
             || CASE WHEN c.harness_section = 'engine' THEN '1.20 (engine bay' ELSE '1.15 (body' END
             || ', K5_WIRING_STATE.md row 33)' AS method
    FROM public.harness_segments s
    JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
    JOIN LATERAL (SELECT sum(l.distance_in) AS route_in, count(*) AS branches
                  FROM public.harness_routings h JOIN public.vehicle_harness_landmarks l ON l.id = h.landmark_id
                  WHERE h.segment_id = s.id AND NOT h.is_superseded) r ON r.branches > 0 AND r.route_in > 0
    WHERE s.vehicle_id = p_vehicle_id AND NOT s.is_superseded
      AND (s.planned_length_ft IS NULL OR coalesce(s.planned_length_method, '') LIKE 'route length x pad%')),
  upd AS (
    UPDATE public.harness_segments s SET planned_length_ft = t.new_ft, planned_length_method = t.method
    FROM t
    WHERE s.id = t.id AND (s.planned_length_ft IS DISTINCT FROM t.new_ft OR s.planned_length_method IS DISTINCT FROM t.method)
    RETURNING t.old_ft IS NULL AS was_empty)
  SELECT count(*) FILTER (WHERE was_empty), count(*) FILTER (WHERE NOT was_empty) INTO n_planned, n_replanned FROM upd;
  RETURN jsonb_build_object('segments_planned_from_route', n_planned, 'segments_replanned', n_replanned);
END $fn$;
COMMENT ON FUNCTION public.plan_harness_segment_lengths(uuid) IS 'Gives each routed live segment of the vehicle with no planned length (or one this rule planned) its route length x the record''s pad: 1.20 in the engine section, 1.15 elsewhere (K5_WIRING_STATE.md row 33). A plan from the cut list or a measurement is never touched. Idempotent; the registry loader calls it after routing. RSI pass 34, case ledger 13.12.3.';
REVOKE ALL ON FUNCTION public.plan_harness_segment_lengths(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_harness_segment_lengths(uuid) TO service_role;

-- 3. The scoreboard.
CREATE OR REPLACE VIEW public.v_harness_coverage AS
SELECT x.vehicle_id, x.layer, x.measure, x.numerator, x.denominator, g.grain
FROM (
  WITH seg AS (SELECT s.* FROM public.harness_segments s JOIN public.vehicles v ON v.id = s.vehicle_id
               WHERE NOT s.is_superseded AND v.is_public IS TRUE),
  ends AS (SELECT t.* FROM public.wire_termination_specs t JOIN public.vehicles v ON v.id = t.vehicle_id
           WHERE NOT coalesce(t.is_superseded, false) AND v.is_public IS TRUE
             AND EXISTS (SELECT 1 FROM seg WHERE t.id IN (seg.from_termination_id, seg.to_termination_id))),
  nets AS (SELECT n.* FROM public.harness_nets n JOIN public.vehicles v ON v.id = n.vehicle_id
           WHERE NOT n.is_superseded AND v.is_public IS TRUE),
  base AS (SELECT o.vehicle_id, f.* FROM public.vehicle_wiring_overlays o JOIN public.vehicles v ON v.id = o.vehicle_id
           JOIN public.factory_harness_circuits f ON f.generation = o.factory_generation AND f.year_range @> v.year
           WHERE v.is_public IS TRUE),
  res AS (SELECT * FROM public.v_harness_factory_residual),
  wires AS (SELECT c.id, o.vehicle_id FROM public.vehicle_custom_circuits c
            JOIN public.vehicle_wiring_overlays o ON o.id = c.overlay_id JOIN public.vehicles v ON v.id = o.vehicle_id
            WHERE NOT coalesce(c.is_superseded, false) AND c.design_status = 'decided' AND v.is_public IS TRUE),
  pdmch AS (SELECT u.vehicle_id, ch.* FROM public.pdm_channels ch JOIN public.pdm_units u ON u.id = ch.pdm_unit_id
            JOIN public.vehicles v ON v.id = u.vehicle_id WHERE v.is_public IS TRUE AND ch.setting_status IS NOT NULL),
  loose_ends AS (SELECT t.vehicle_id, EXISTS (SELECT 1 FROM seg s WHERE s.vehicle_custom_circuit_id = c.id AND t.id IN (s.from_termination_id, s.to_termination_id)) AS on_segment
                 FROM public.wire_termination_specs t JOIN public.vehicles v ON v.id = t.vehicle_id AND v.is_public IS TRUE
                 JOIN public.vehicle_custom_circuits c ON c.id = t.circuit_id AND NOT coalesce(c.is_superseded, false) AND c.design_status = 'decided'
                 JOIN public.harness_endpoints e ON e.id = t.endpoint_id
                 WHERE NOT coalesce(t.is_superseded, false) AND NOT (e.code ILIKE '%GROMMET%' OR e.code IN ('AMP-PASS', 'Firewall'))
                   AND EXISTS (SELECT 1 FROM seg s WHERE s.vehicle_custom_circuit_id = c.id)),
  endpts AS (SELECT t.vehicle_id, t.id, n.id AS node_id, n.pos_x_m FROM ends t
             LEFT JOIN public.harness_endpoints e ON e.id = t.endpoint_id
             LEFT JOIN public.harness_topology_nodes n ON n.id = e.topology_node_id AND NOT n.is_superseded)
  SELECT vehicle_id, 'fold' AS layer, 'segments decided' AS measure, count(*) FILTER (WHERE design_status = 'decided') AS numerator, count(*) AS denominator FROM seg GROUP BY 1
  UNION ALL SELECT vehicle_id, 'fold', 'segments with both ends known', count(*) FILTER (WHERE from_termination_id IS NOT NULL AND to_termination_id IS NOT NULL), count(*) FROM seg GROUP BY 1
  UNION ALL SELECT vehicle_id, 'key', 'segments keyed to a wire part', count(wire_part_id), count(*) FROM seg GROUP BY 1
  UNION ALL SELECT vehicle_id, 'prediction', 'segments with a planned length', count(planned_length_ft), count(*) FROM seg GROUP BY 1
  UNION ALL SELECT vehicle_id, 'outcome', 'segments measured as cut', count(measured_length_ft), count(*) FROM seg GROUP BY 1
  UNION ALL SELECT s.vehicle_id, 'key', 'segments carrying an option link', count(DISTINCT l.segment_id), count(DISTINCT s.id) FROM seg s LEFT JOIN public.wiring_decision_links l ON l.segment_id = s.id GROUP BY 1
  UNION ALL SELECT s.vehicle_id, 'dimension', 'segments routed over topology', count(DISTINCT r.segment_id), count(DISTINCT s.id) FROM seg s LEFT JOIN public.harness_routings r ON r.segment_id = s.id AND NOT r.is_superseded GROUP BY 1
  UNION ALL SELECT vehicle_id, 'key', 'wire ends keyed to a cavity', count(cavity_layout_id), count(*) FROM ends GROUP BY 1
  UNION ALL SELECT vehicle_id, 'key', 'wire ends keyed to a terminal part', count(terminal_contact_catalog_id), count(*) FROM ends GROUP BY 1
  UNION ALL SELECT vehicle_id, 'key', 'wire ends keyed to a crimp tool', count(crimp_tool_catalog_id), count(*) FROM ends GROUP BY 1
  UNION ALL SELECT e.vehicle_id, 'log', 'wire ends with cited evidence', count(DISTINCT h.row_id) FILTER (WHERE h.relation = 'supports'), count(DISTINCT e.id) FROM ends e LEFT JOIN public.harness_evidence h ON h.row_kind = 'termination' AND h.row_id = e.id GROUP BY 1
  UNION ALL SELECT vehicle_id, 'fold', 'nets with protection', count(*) FILTER (WHERE protection_pdm_channel_id IS NOT NULL OR protection_fuse_part_id IS NOT NULL), count(*) FROM nets GROUP BY 1
  UNION ALL SELECT vehicle_id, 'fold', 'nets with a load model', count(nominal_current_a), count(*) FROM nets GROUP BY 1
  UNION ALL SELECT vehicle_id, 'baseline', 'factory circuits keyed to a GM circuit number', count(gm_circuit_number), count(*) FROM base GROUP BY 1
  UNION ALL SELECT vehicle_id, 'residual', 'factory GM circuits carried by the build', count(*) FILTER (WHERE status = 'carried'), count(*) FILTER (WHERE status <> 'baseline gap') FROM res GROUP BY 1
  UNION ALL SELECT vehicle_id, 'residual', 'GM circuits the build cites that the baseline cannot key', count(*) FILTER (WHERE status = 'baseline gap'), count(*) FILTER (WHERE status <> 'unassessed') FROM res GROUP BY 1
  UNION ALL SELECT n.vehicle_id, 'residual', 'nets carrying a factory circuit', count(DISTINCT n.id) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.harness_segments s JOIN public.harness_evidence h ON h.row_kind = 'termination' AND h.row_id IN (s.from_termination_id, s.to_termination_id)
             JOIN public.vehicle_observations o ON o.id = h.observation_id AND NOT coalesce(o.is_superseded, false)
             WHERE s.net_id = n.id AND NOT s.is_superseded AND o.structured_data->>'property_key' = 'factory circuit')), count(DISTINCT n.id) FROM nets n GROUP BY 1
  UNION ALL SELECT vehicle_id, 'dimension', 'GM circuits the build cites, named in the circuit dictionary', count(*) FILTER (WHERE status <> 'unassessed' AND gm_circuit_name IS NOT NULL), count(*) FILTER (WHERE status <> 'unassessed') FROM res GROUP BY 1
  UNION ALL SELECT n.vehicle_id, 'fold', 'nets that join a supply to ground (must be 0)', count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.harness_segments s JOIN public.wire_termination_specs t ON t.id IN (s.from_termination_id, s.to_termination_id)
             JOIN public.harness_endpoints e ON e.id = t.endpoint_id
             WHERE s.net_id = n.id AND NOT s.is_superseded
               AND (t.cavity ILIKE '+ post%' OR (e.code ~ '^PDM(15|30)-[AB]$' AND EXISTS (
                     SELECT 1 FROM public.device_pin_maps p WHERE p.device_model = split_part(e.code, '-', 1)
                       AND regexp_replace(upper(p.pin_number), '^([A-Z]+)0*([0-9]+)$', '\1\2') = regexp_replace(upper(t.cavity), '^([A-Z]+)0*([0-9]+)$', '\1\2')
                       AND coalesce(substring(p.pin_function FROM '^OUT([0-9]+)'), substring(p.pin_function FROM '^Output ([0-9]+)')) IS NOT NULL))))
           AND EXISTS (
             SELECT 1 FROM public.harness_segments s JOIN public.wire_termination_specs t ON t.id IN (s.from_termination_id, s.to_termination_id)
             WHERE s.net_id = n.id AND NOT s.is_superseded AND t.cavity ILIKE '- post%')), count(*) FROM nets n GROUP BY 1
  UNION ALL SELECT g.vehicle_id, 'dimension', 'segments with both plugs at a standing position', count(*) FILTER (WHERE g.straight_ft IS NOT NULL), count(*) FROM public.v_harness_segment_geometry g GROUP BY 1
  UNION ALL SELECT g.vehicle_id, 'prediction', 'segments planned shorter than the straight line between their plugs (must be 0)', count(*) FILTER (WHERE g.planned_ft < g.straight_ft), count(*) FILTER (WHERE g.planned_ft IS NOT NULL AND g.straight_ft IS NOT NULL) FROM public.v_harness_segment_geometry g GROUP BY 1
  UNION ALL SELECT w.vehicle_id, 'outcome', 'decided wires with a recorded build step', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.harness_build_events e WHERE e.circuit_id = w.id)), count(*) FROM wires w GROUP BY 1
  UNION ALL SELECT s.vehicle_id, 'fold', 'live segments on superseded legacy rows (must be 0)', count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.vehicle_custom_circuits c WHERE c.id = s.vehicle_custom_circuit_id AND coalesce(c.is_superseded, false))
           OR EXISTS (SELECT 1 FROM public.wire_termination_specs t WHERE t.id IN (s.from_termination_id, s.to_termination_id) AND coalesce(t.is_superseded, false))),
         count(*) FROM seg s GROUP BY 1
  UNION ALL SELECT vehicle_id, 'dimension', 'wire ends at a topology node', count(node_id), count(*) FROM endpts GROUP BY 1
  UNION ALL SELECT vehicle_id, 'dimension', 'wire ends at a node not yet placed', count(*) FILTER (WHERE node_id IS NOT NULL AND pos_x_m IS NULL), count(*) FROM endpts GROUP BY 1
  UNION ALL SELECT vehicle_id, 'residual', 'PDM-fed wires not protected by the output the design names (must be 0)', count(*) FILTER (WHERE NOT agrees), count(*) FROM public.v_harness_pdm_protection_check GROUP BY 1
  UNION ALL SELECT vehicle_id, 'fold', 'pin cavities shared by several wires', count(*) FILTER (WHERE wires > 1), count(*) FROM public.v_harness_pin_occupancy GROUP BY 1
  UNION ALL SELECT vehicle_id, 'prediction', 'PDM-fed nets with a programmed limit', count(protection_setting_a) FILTER (WHERE protection_pdm_channel_id IS NOT NULL), count(*) FILTER (WHERE protection_pdm_channel_id IS NOT NULL) FROM nets GROUP BY 1
  UNION ALL SELECT vehicle_id, 'fold', 'PDM-fed nets with a load', count(nominal_current_a) FILTER (WHERE protection_pdm_channel_id IS NOT NULL), count(*) FILTER (WHERE protection_pdm_channel_id IS NOT NULL) FROM nets GROUP BY 1
  UNION ALL SELECT vehicle_id, 'log', 'PDM outputs still waiting on a cited load current', count(*) FILTER (WHERE setting_status = 'open'), count(*) FROM pdmch GROUP BY 1
  UNION ALL SELECT vehicle_id, 'residual', 'PDM outputs whose load needs more than the output or its wire allows (must be 0)', count(*) FILTER (WHERE setting_status = 'conflict'), count(*) FROM pdmch GROUP BY 1
  UNION ALL SELECT h.vehicle_id, 'key', 'splice members keyed to a live wire', count(m.circuit_id), count(m.id)
    FROM public.harness_splices h JOIN public.vehicles v ON v.id = h.vehicle_id AND v.is_public IS TRUE
    JOIN public.harness_splice_members m ON m.splice_id = h.id WHERE NOT h.is_superseded GROUP BY 1
  UNION ALL SELECT vehicle_id, 'residual', 'pin cavities shared by several wires with no splice the design names (must be 0)', count(*) FILTER (WHERE wires > 1 AND wires_in_a_splice < wires), count(*) FILTER (WHERE wires > 1) FROM public.v_harness_pin_occupancy GROUP BY 1
  UNION ALL SELECT h.vehicle_id, 'fold', 'spliced pins whose lead into the pin the design names',
         count(DISTINCT coalesce(h.endpoint_id::text, split_part(h.at_label, ' ', 1)) || ' ' || h.cavity) FILTER (WHERE EXISTS (
           SELECT 1 FROM public.harness_splices h2 JOIN public.harness_splice_members m ON m.splice_id = h2.id
           WHERE NOT h2.is_superseded AND h2.placement = 'at_pin' AND h2.vehicle_id = h.vehicle_id AND h2.endpoint_id = h.endpoint_id AND h2.cavity = h.cavity
             AND m.circuit_id IS NULL AND m.member_label ~* '\mpin lead\M')),
         count(DISTINCT coalesce(h.endpoint_id::text, split_part(h.at_label, ' ', 1)) || ' ' || h.cavity)
    FROM public.harness_splices h JOIN public.vehicles v ON v.id = h.vehicle_id AND v.is_public IS TRUE
    WHERE NOT h.is_superseded AND h.placement = 'at_pin' GROUP BY 1
  UNION ALL SELECT vehicle_id, 'residual', 'splice sides outside the part''s crimp range (must be 0)', count(*) FILTER (WHERE status IN ('over the crimp range', 'under the crimp range')), count(*) FILTER (WHERE status IN ('fits', 'over the crimp range', 'under the crimp range')) FROM public.v_harness_splice_check GROUP BY 1
  UNION ALL SELECT vehicle_id, 'log', 'splice sides the fill check cannot settle yet', count(*) FILTER (WHERE status NOT IN ('fits', 'over the crimp range', 'under the crimp range')), count(*) FROM public.v_harness_splice_check GROUP BY 1
  UNION ALL SELECT vehicle_id, 'fold', 'wire ends of decided wires on no live segment (must be 0)', count(*) FILTER (WHERE NOT on_segment), count(*) FROM loose_ends GROUP BY 1
  UNION ALL SELECT vehicle_id, 'residual', 'routed segments planned shorter than their route (must be 0)', count(*) FILTER (WHERE planned_ft < route_ft), count(*) FILTER (WHERE planned_ft IS NOT NULL) FROM public.v_harness_route_length_check GROUP BY 1
  UNION ALL SELECT o.vehicle_id, 'fold', 'decided wires with no live segment (must be 0)',
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.harness_segments s WHERE s.vehicle_custom_circuit_id = c.id AND NOT s.is_superseded)),
         count(*)
    FROM public.vehicle_custom_circuits c JOIN public.vehicle_wiring_overlays o ON o.id = c.overlay_id
    JOIN public.vehicles v ON v.id = o.vehicle_id AND v.is_public IS TRUE
    WHERE NOT coalesce(c.is_superseded, false) AND c.design_status = 'decided'
      AND EXISTS (SELECT 1 FROM public.harness_segments s0 WHERE s0.vehicle_id = o.vehicle_id)
    GROUP BY 1
) x
LEFT JOIN (VALUES
    ('segments decided', 'segments'),
    ('segments with both ends known', 'segments'),
    ('segments keyed to a wire part', 'segments'),
    ('segments with a planned length', 'segments'),
    ('segments measured as cut', 'segments'),
    ('segments carrying an option link', 'segments'),
    ('segments routed over topology', 'segments'),
    ('wire ends keyed to a cavity', 'wire ends'),
    ('wire ends keyed to a terminal part', 'wire ends'),
    ('wire ends keyed to a crimp tool', 'wire ends'),
    ('wire ends with cited evidence', 'wire ends'),
    ('nets with protection', 'nets'),
    ('nets with a load model', 'nets'),
    ('factory circuits keyed to a GM circuit number', 'factory circuits'),
    ('factory GM circuits carried by the build', 'GM circuits'),
    ('GM circuits the build cites that the baseline cannot key', 'GM circuits'),
    ('nets carrying a factory circuit', 'nets'),
    ('GM circuits the build cites, named in the circuit dictionary', 'GM circuits'),
    ('nets that join a supply to ground (must be 0)', 'nets'),
    ('segments with both plugs at a standing position', 'segments'),
    ('segments planned shorter than the straight line between their plugs (must be 0)', 'segments'),
    ('decided wires with a recorded build step', 'wires'),
    ('live segments on superseded legacy rows (must be 0)', 'segments'),
    ('wire ends at a topology node', 'wire ends'),
    ('wire ends at a node not yet placed', 'wire ends'),
    ('PDM-fed wires not protected by the output the design names (must be 0)', 'wires'),
    ('pin cavities shared by several wires', 'cavities'),
    ('PDM-fed nets with a programmed limit', 'nets'),
    ('PDM-fed nets with a load', 'nets'),
    ('PDM outputs still waiting on a cited load current', 'PDM outputs'),
    ('PDM outputs whose load needs more than the output or its wire allows (must be 0)', 'PDM outputs'),
    ('splice members keyed to a live wire', 'splice members'),
    ('pin cavities shared by several wires with no splice the design names (must be 0)', 'cavities'),
    ('spliced pins whose lead into the pin the design names', 'pins'),
    ('splice sides outside the part''s crimp range (must be 0)', 'splice sides'),
    ('splice sides the fill check cannot settle yet', 'splice sides'),
    ('wire ends of decided wires on no live segment (must be 0)', 'wire ends'),
    ('decided wires with no live segment (must be 0)', 'wires'),
    ('routed segments planned shorter than their route (must be 0)', 'segments')) g(measure, grain) ON g.measure = x.measure;

COMMENT ON VIEW public.v_harness_coverage IS 'The harness model measuring itself: per public vehicle, per stack layer, a measure with its numerator and denominator and what they count (grain). RSI scoreboard for stack SH; case ledger 13.12.2 / 13.12.3. Baseline and residual since RSI pass 3; the physics check since net fold v2; the geometry check since pass 7; the build log since pass 8; grain since pass 10; the legacy-row drift check since pass 11; route-graph points and standing positions since pass 12; PDM protection against the design since pass 13; shared pin cavities since pass 14; PDM limits and loads since pass 15; the design''s splices since pass 16; wire ends on no segment since pass 19; decided wires with no segment since pass 25; routed segments planned shorter than their route since pass 34.';

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, note) VALUES
  ('SH', 1, 'residual', 'table', 'v_harness_route_length_check', NULL, 'every routed segment''s plan against its route'),
  ('SH', 1, 'prediction', 'function', 'plan_harness_segment_lengths', NULL, 'routed segments without a plan get route x pad');

DO $check$
DECLARE r jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a scoreboard measure has no grain'; END IF;
  r := public.plan_harness_segment_lengths('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  RAISE NOTICE 'RSI pass 34 on the K5: %', r;
END $check$;

COMMIT;
