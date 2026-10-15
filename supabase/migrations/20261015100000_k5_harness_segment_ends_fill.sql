-- RSI pass 19 on the harness model: a wire's ends that arrive after its segment was made land on the segment.
-- Case ledger 13.12.3.
--
-- The reshape (20261014101500) made each decided wire's segments from its live wire ends: ordered from the wire's
-- from-end, split at terminating pass-throughs, the 61-pin's halves a mate, grommets not splitting. 22 wires had no ends
-- then, so each got one segment with both ends empty. The registry has their ends (late-September wires: the wiper
-- and washer, the PCS, the fuse pigtails, the third brake light's pigtails), and the loader's run of 2026-10-15 03:3xZ
-- inserted them (56 wire ends). Nothing put them on the segments: the resync fold (pass 11) only follows supersession.
-- Measured read-only after that run: 47 live wire ends of 21 decided wires sit on no live segment of their wire (931
-- non-grommet ends in all). No scoreboard measure saw it, because every wire-end measure counts ends on live segments.
--
-- This pass:
--   1. fill_harness_segment_ends(vehicle): a decided wire whose only live segment has no ends, and which now has live
--      ends, takes the reshape's segmentation of those ends. Its first hop fills the existing segment in place (its
--      option links, net and evidence stay); further hops are new segments copied from it. A wire split into several
--      hops loses its whole-wire length on the first (the reshape's rule: the estimate was never split). Idempotent;
--      service role. The loader calls it after the resync fold, then keys the new ends to terminal and tool parts
--      (key_harness_wire_ends, pass 6).
--   2. The scoreboard: wire ends of decided wires on no live segment (must be 0; grommet ends excluded, they never
--      split a wire).
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF to_regprocedure('public.load_harness_splices(uuid,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'RSI pass 16 (20261015090000) has not run';
  END IF;
  IF to_regprocedure('public.fill_harness_segment_ends(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'fill_harness_segment_ends already exists';
  END IF;
END $guard$;

-- 1. The fill.
CREATE FUNCTION public.fill_harness_segment_ends(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE n_wires int; filled int; added int; no_hop int;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS fill_w (wire_id uuid PRIMARY KEY, seg_id uuid, from_endpoint_id uuid, to_endpoint_id uuid,
    planned numeric) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS fill_hop (wire_id uuid, n int, hops int, from_term uuid, to_term uuid) ON COMMIT DROP;
  TRUNCATE fill_w, fill_hop;

  -- Decided wires whose only live segment has no ends, and which now have live ends.
  INSERT INTO fill_w
  SELECT c.id, min(s.id::text)::uuid, c.from_endpoint_id, c.to_endpoint_id, min(s.planned_length_ft)
  FROM public.harness_segments s
  JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id AND NOT coalesce(c.is_superseded, false) AND c.design_status = 'decided'
  WHERE s.vehicle_id = p_vehicle_id AND NOT s.is_superseded AND s.design_status = 'decided'
  GROUP BY c.id, c.from_endpoint_id, c.to_endpoint_id
  HAVING count(*) = 1 AND bool_and(s.from_termination_id IS NULL AND s.to_termination_id IS NULL)
     AND EXISTS (SELECT 1 FROM public.wire_termination_specs t WHERE t.circuit_id = c.id AND NOT coalesce(t.is_superseded, false));
  SELECT count(*) INTO n_wires FROM fill_w;

  -- The reshape's segmentation (20261014101500), on these wires' live ends.
  INSERT INTO fill_hop
  WITH e AS (
    SELECT w.wire_id, t.id AS term_id, h.code,
           (h.code ILIKE '%GROMMET%' OR h.code IN ('AMP-PASS', 'Firewall')) AS is_grommet,
           CASE WHEN t.endpoint_id = w.from_endpoint_id THEN 'F' WHEN t.endpoint_id = w.to_endpoint_id THEN 'T' ELSE 'M' END AS role,
           coalesce((SELECT fe.location_zone IN ('engine', 'chassis') FROM public.harness_endpoints fe WHERE fe.id = w.from_endpoint_id), false) AS from_engine
    FROM fill_w w
    JOIN public.wire_termination_specs t ON t.circuit_id = w.wire_id AND NOT coalesce(t.is_superseded, false)
    LEFT JOIN public.harness_endpoints h ON h.id = t.endpoint_id),
  ends AS (
    SELECT wire_id, term_id, code, role,
           CASE WHEN role = 'F' THEN 0 WHEN role = 'T' THEN 100
                WHEN code = 'FIREWALL-CABIN' THEN CASE WHEN from_engine THEN 60 ELSE 40 END
                WHEN code = 'FIREWALL-ENGINE' THEN CASE WHEN from_engine THEN 40 ELSE 60 END
                ELSE 50 END AS ord
    FROM e WHERE NOT coalesce(is_grommet, false)),
  bounds AS (
    SELECT w.wire_id, NULL::uuid AS term_id, NULL::text AS code, 'F'::text AS role, -1 AS ord
    FROM fill_w w WHERE NOT EXISTS (SELECT 1 FROM ends x WHERE x.wire_id = w.wire_id AND x.role = 'F')
    UNION ALL
    SELECT w.wire_id, NULL::uuid, NULL::text, 'T', 101
    FROM fill_w w WHERE NOT EXISTS (SELECT 1 FROM ends x WHERE x.wire_id = w.wire_id AND x.role = 'T')),
  all_ends AS (SELECT wire_id, term_id, code, role, ord FROM ends UNION ALL SELECT wire_id, term_id, code, role, ord FROM bounds),
  seq AS (
    SELECT wire_id, term_id, code, ord,
           lead(term_id) OVER w AS next_term, lead(code) OVER w AS next_code, lead(ord) OVER w AS next_ord,
           row_number() OVER w AS pos
    FROM all_ends WINDOW w AS (PARTITION BY wire_id ORDER BY ord, code NULLS FIRST, term_id)),
  hops AS (
    SELECT wire_id, pos, term_id AS from_term, next_term AS to_term
    FROM seq
    WHERE next_ord IS NOT NULL AND (term_id IS NOT NULL OR next_term IS NOT NULL)
      AND NOT (coalesce(code, '') IN ('FIREWALL-CABIN', 'FIREWALL-ENGINE')
               AND coalesce(next_code, '') IN ('FIREWALL-CABIN', 'FIREWALL-ENGINE') AND code <> next_code))
  SELECT wire_id, row_number() OVER (PARTITION BY wire_id ORDER BY pos)::int, count(*) OVER (PARTITION BY wire_id)::int, from_term, to_term
  FROM hops;
  SELECT count(*) INTO no_hop FROM fill_w w WHERE NOT EXISTS (SELECT 1 FROM fill_hop h WHERE h.wire_id = w.wire_id);

  -- Hops 2.. are new segments copied from the wire's segment (read before the first hop rewrites it).
  INSERT INTO public.harness_segments (vehicle_id, net_id, from_termination_id, to_termination_id, wire_part_id, gauge_awg, colour,
    planned_length_ft, planned_length_method, build_state, source, method, observed_at, trust, vehicle_custom_circuit_id,
    design_status, design_note)
  SELECT s.vehicle_id, s.net_id, h.from_term, h.to_term, s.wire_part_id, s.gauge_awg, s.colour, NULL,
         'unknown: the whole-wire estimate (' || coalesce(w.planned::text, 'none') || ' ft) was never split at its junctions',
         s.build_state, s.source,
         'hop ' || h.n || ' of ' || h.hops || ' of the wire, from its live ends (RSI pass 19, the reshape v1 rule)',
         s.observed_at, s.trust, s.vehicle_custom_circuit_id, s.design_status, s.design_note
  FROM fill_w w JOIN fill_hop h ON h.wire_id = w.wire_id AND h.n > 1 JOIN public.harness_segments s ON s.id = w.seg_id;
  GET DIAGNOSTICS added = ROW_COUNT;

  -- Hop 1 fills the wire's own segment in place.
  UPDATE public.harness_segments s
  SET from_termination_id = h.from_term, to_termination_id = h.to_term,
      planned_length_ft = CASE WHEN h.hops = 1 THEN s.planned_length_ft END,
      planned_length_method = CASE WHEN h.hops = 1 THEN s.planned_length_method
                                   ELSE 'unknown: the whole-wire estimate (' || coalesce(s.planned_length_ft::text, 'none') || ' ft) was never split at its junctions' END,
      method = s.method || '; ends filled from the wire''s live ends, hop 1 of ' || h.hops || ' (RSI pass 19)'
  FROM fill_w w JOIN fill_hop h ON h.wire_id = w.wire_id AND h.n = 1
  WHERE s.id = w.seg_id;
  GET DIAGNOSTICS filled = ROW_COUNT;

  RETURN jsonb_build_object('wires_with_empty_segments_and_live_ends', n_wires, 'segments_filled', filled,
                            'segments_added', added, 'wires_with_no_hop', no_hop);
END $fn$;
COMMENT ON FUNCTION public.fill_harness_segment_ends(uuid) IS 'For a decided wire whose only live segment has no ends but which now has live wire ends: the reshape v1 segmentation of those ends (from the wire''s from-end, split at terminating pass-throughs, the 61-pin halves a mate, grommets not splitting). Hop 1 fills the existing segment in place (its links stay); further hops are new segments copied from it, and a split wire''s whole-wire length is cleared with the reason. Idempotent; returns counts. The registry loader calls it after resync_harness_segments. RSI pass 19, case ledger 13.12.3.';
REVOKE ALL ON FUNCTION public.fill_harness_segment_ends(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fill_harness_segment_ends(uuid) TO service_role;

-- 2. The scoreboard.
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
    ('wire ends of decided wires on no live segment (must be 0)', 'wire ends')) g(measure, grain) ON g.measure = x.measure;


COMMENT ON VIEW public.v_harness_coverage IS 'The harness model measuring itself: per public vehicle, per stack layer, a measure with its numerator and denominator and what they count (grain). RSI scoreboard for stack SH; case ledger 13.12.2 / 13.12.3. Baseline and residual since RSI pass 3; the physics check since net fold v2; the geometry check since pass 7; the build log since pass 8; grain since pass 10; the legacy-row drift check since pass 11; route-graph points and standing positions since pass 12; PDM protection against the design since pass 13; shared pin cavities since pass 14; PDM limits and loads since pass 15; the design''s splices since pass 16; wire ends on no segment since pass 19.';

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, note) VALUES
  ('SH', 1, 'fold', 'function', 'fill_harness_segment_ends', NULL, 'segments take wire ends that arrive after them');

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a scoreboard measure has no grain'; END IF;
  RAISE NOTICE 'RSI pass 19: segment ends fill with the loader''s next call to fill_harness_segment_ends';
END $check$;

COMMIT;
