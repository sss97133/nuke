-- RSI pass 25 on the harness model: every decided wire's segments follow its live wire ends. Case ledger 13.12.3.
--
-- The reshape (20261014101500) segmented the decided wires that existed on 2026-10-14. Since then:
--   - pass 11's resync fold follows a wire superseded by the loader to its successor and moves each segment end to the
--     successor's end at the same plug; an end whose plug changed has no match and stays on the superseded row;
--   - pass 19's fill handles a wire whose one segment was made with no ends.
-- A wire the loader adds later gets no segment at all. On 2026-10-15 05:5xZ (RSI pass 24, live) the A/C clutch moved to
-- PDM15 OUT8: its two new pigtails (23_PT1/_PT2) have no segment, and #23's segment kept its PDM15-A A6 end (now
-- superseded) because the wire now starts at the new splice node SPL-PDM15-OUT8. The scoreboard read "live segments on
-- superseded legacy rows" 1 / 643 and "wire ends on no live segment" 1 / 931; no measure counted decided wires with no
-- segment.
--
-- This pass:
--   1. conform_harness_segments(vehicle): for each decided wire with live ends, the reshape's segmentation of those ends
--      (the rule pass 19 uses) compared with its live segments. A segment that already is a desired hop stays; an
--      unmatched segment takes an unmatched hop in place (its option links, net and evidence stay); a hop left over is a
--      new segment copied from the wire's kept segment; a segment left over is superseded (pointing at a kept one). A
--      wire with no segment gets its hops and a net of its own, which the net refold then joins to its node. A wire
--      split into several hops carries no whole-wire length. Idempotent; service role; every UPDATE has a WHERE. The
--      loader calls it after the resync fold, in place of the fill.
--   2. The scoreboard: decided wires with no live segment (must be 0).
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF to_regprocedure('public.fill_harness_segment_ends(uuid)') IS NULL THEN
    RAISE EXCEPTION 'RSI pass 19 (20261015100000) has not run';
  END IF;
  IF to_regprocedure('public.conform_harness_segments(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'conform_harness_segments already exists';
  END IF;
END $guard$;

-- 1. The fold.
CREATE FUNCTION public.conform_harness_segments(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE n_todo int; n_nets int; n_updated int; n_inserted int; n_retired int; n_skipped int;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS conf_w (wire_id uuid PRIMARY KEY, code text, from_endpoint_id uuid, to_endpoint_id uuid, gauge int,
    colour text, wire_type text, planned numeric, source text, observed_at timestamptz, trust text) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS conf_hop (wire_id uuid, n int, hops int, from_term uuid, to_term uuid) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS conf_seg (seg_id uuid PRIMARY KEY, wire_id uuid, from_term uuid, to_term uuid, created_at timestamptz) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS conf_match (seg_id uuid PRIMARY KEY, wire_id uuid, hop_n int) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS conf_pair (seg_id uuid, wire_id uuid, hop_n int) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS conf_net (wire_id uuid PRIMARY KEY, net_id uuid, signal_id uuid, net_code text) ON COMMIT DROP;
  TRUNCATE conf_w, conf_hop, conf_seg, conf_match, conf_pair, conf_net;

  INSERT INTO conf_w
  SELECT c.id, c.circuit_code, c.from_endpoint_id, c.to_endpoint_id, c.wire_gauge_awg, c.wire_color, c.wire_type, c.planned_length_ft,
         coalesce(c.source, 'vehicle_custom_circuits ' || c.circuit_code), coalesce(c.observed_at, c.created_at), coalesce(c.trust, 'T3')
  FROM public.vehicle_custom_circuits c JOIN public.vehicle_wiring_overlays o ON o.id = c.overlay_id
  WHERE o.vehicle_id = p_vehicle_id AND NOT coalesce(c.is_superseded, false) AND c.design_status = 'decided';

  -- The reshape's segmentation of each wire's live ends (20261014101500; the rule pass 19 applies).
  INSERT INTO conf_hop
  WITH e AS (
    SELECT w.wire_id, t.id AS term_id, h.code,
           (h.code ILIKE '%GROMMET%' OR h.code IN ('AMP-PASS', 'Firewall')) AS is_grommet,
           CASE WHEN t.endpoint_id = w.from_endpoint_id THEN 'F' WHEN t.endpoint_id = w.to_endpoint_id THEN 'T' ELSE 'M' END AS role,
           coalesce((SELECT fe.location_zone IN ('engine', 'chassis') FROM public.harness_endpoints fe WHERE fe.id = w.from_endpoint_id), false) AS from_engine
    FROM conf_w w
    JOIN public.wire_termination_specs t ON t.circuit_id = w.wire_id AND NOT coalesce(t.is_superseded, false)
    LEFT JOIN public.harness_endpoints h ON h.id = t.endpoint_id),
  ends AS (
    SELECT wire_id, term_id, code, role,
           CASE WHEN role = 'F' THEN 0 WHEN role = 'T' THEN 100
                WHEN code = 'FIREWALL-CABIN' THEN CASE WHEN from_engine THEN 60 ELSE 40 END
                WHEN code = 'FIREWALL-ENGINE' THEN CASE WHEN from_engine THEN 40 ELSE 60 END
                ELSE 50 END AS ord
    FROM e WHERE NOT coalesce(is_grommet, false)),
  wired AS (SELECT DISTINCT wire_id FROM ends),
  bounds AS (
    SELECT w.wire_id, NULL::uuid AS term_id, NULL::text AS code, 'F'::text AS role, -1 AS ord
    FROM wired w WHERE NOT EXISTS (SELECT 1 FROM ends x WHERE x.wire_id = w.wire_id AND x.role = 'F')
    UNION ALL
    SELECT w.wire_id, NULL::uuid, NULL::text, 'T', 101
    FROM wired w WHERE NOT EXISTS (SELECT 1 FROM ends x WHERE x.wire_id = w.wire_id AND x.role = 'T')),
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

  -- Two live ends of one wire on one plug is an ambiguity the rule cannot order (pass 11 leaves it in place): skip the wire.
  DELETE FROM conf_hop h
  WHERE h.wire_id IN (SELECT t.circuit_id FROM public.wire_termination_specs t
                      JOIN conf_w w ON w.wire_id = t.circuit_id
                      JOIN public.harness_endpoints e ON e.id = t.endpoint_id
                      WHERE NOT coalesce(t.is_superseded, false) AND NOT (e.code ILIKE '%GROMMET%' OR e.code IN ('AMP-PASS', 'Firewall'))
                      GROUP BY t.circuit_id, t.endpoint_id HAVING count(*) > 1);
  GET DIAGNOSTICS n_skipped = ROW_COUNT;

  INSERT INTO conf_seg
  SELECT s.id, s.vehicle_custom_circuit_id, s.from_termination_id, s.to_termination_id, s.created_at
  FROM public.harness_segments s JOIN conf_w w ON w.wire_id = s.vehicle_custom_circuit_id
  WHERE s.vehicle_id = p_vehicle_id AND NOT s.is_superseded;   -- every live segment, whatever its design status

  -- Segments that already are a desired hop stay as they are.
  INSERT INTO conf_match
  SELECT DISTINCT ON (s.seg_id) s.seg_id, s.wire_id, h.n
  FROM conf_seg s JOIN conf_hop h ON h.wire_id = s.wire_id
       AND h.from_term IS NOT DISTINCT FROM s.from_term AND h.to_term IS NOT DISTINCT FROM s.to_term
  ORDER BY s.seg_id, h.n;
  DELETE FROM conf_match m USING conf_match m2
  WHERE m.wire_id = m2.wire_id AND m.hop_n = m2.hop_n AND m.seg_id > m2.seg_id;   -- one segment per hop

  -- Unmatched segments take unmatched hops in order; what is left over is inserted or superseded.
  INSERT INTO conf_pair
  WITH us AS (
    SELECT s.seg_id, s.wire_id, row_number() OVER (PARTITION BY s.wire_id ORDER BY s.created_at, s.seg_id) AS k
    FROM conf_seg s WHERE s.seg_id NOT IN (SELECT seg_id FROM conf_match)
      AND s.wire_id IN (SELECT wire_id FROM conf_hop)),
  uh AS (
    SELECT h.wire_id, h.n, row_number() OVER (PARTITION BY h.wire_id ORDER BY h.n) AS k
    FROM conf_hop h WHERE NOT EXISTS (SELECT 1 FROM conf_match m WHERE m.wire_id = h.wire_id AND m.hop_n = h.n))
  SELECT us.seg_id, coalesce(us.wire_id, uh.wire_id), uh.n
  FROM us FULL JOIN uh ON uh.wire_id = us.wire_id AND uh.k = us.k;
  SELECT count(DISTINCT wire_id) INTO n_todo FROM conf_pair;

  -- A wire with no segment at all gets a net of its own; the net refold joins it to its node.
  INSERT INTO conf_net
  SELECT w.wire_id, gen_random_uuid(), gen_random_uuid(), 'wire ' || w.code
  FROM conf_w w
  WHERE w.wire_id IN (SELECT wire_id FROM conf_hop)
    AND NOT EXISTS (SELECT 1 FROM conf_seg s WHERE s.wire_id = w.wire_id)
    AND NOT EXISTS (SELECT 1 FROM public.harness_nets n WHERE n.vehicle_id = p_vehicle_id AND NOT n.is_superseded AND n.net_code = 'wire ' || w.code);
  INSERT INTO public.harness_signals (id, vehicle_id, signal_key, name, signal_type, source, method, observed_at, trust)
  SELECT c.signal_id, p_vehicle_id, c.net_code, w.code, NULL, w.source,
         'segment fold (RSI pass 25): a net for a wire with no segment, until the net refold joins it', w.observed_at, w.trust
  FROM conf_net c JOIN conf_w w ON w.wire_id = c.wire_id;
  INSERT INTO public.harness_nets (id, vehicle_id, net_code, signal_id, function, source, method, observed_at, trust)
  SELECT c.net_id, p_vehicle_id, c.net_code, c.signal_id, w.code, w.source,
         'segment fold (RSI pass 25): a net for a wire with no segment, until the net refold joins it', w.observed_at, w.trust
  FROM conf_net c JOIN conf_w w ON w.wire_id = c.wire_id;
  GET DIAGNOSTICS n_nets = ROW_COUNT;

  -- Segments left over are superseded, pointing at a segment the wire keeps.
  UPDATE public.harness_segments s
  SET is_superseded = true,
      superseded_by = (SELECT min(x.seg_id::text)::uuid
                       FROM (SELECT m.seg_id FROM conf_match m WHERE m.wire_id = p.wire_id
                             UNION ALL
                             SELECT p2.seg_id FROM conf_pair p2 WHERE p2.wire_id = p.wire_id AND p2.hop_n IS NOT NULL AND p2.seg_id IS NOT NULL) x),
      method = s.method || '; superseded by the segment fold (RSI pass 25): the wire''s live ends make fewer hops'
  FROM conf_pair p
  WHERE s.id = p.seg_id AND p.hop_n IS NULL;
  GET DIAGNOSTICS n_retired = ROW_COUNT;

  -- Unmatched segments take their hop in place.
  UPDATE public.harness_segments s
  SET from_termination_id = h.from_term, to_termination_id = h.to_term,
      planned_length_ft = CASE WHEN h.hops = 1 THEN coalesce(s.planned_length_ft, CASE WHEN w.planned > 0 THEN w.planned END) END,
      planned_length_method = CASE WHEN h.hops = 1 THEN coalesce(s.planned_length_method, 'whole-wire estimate from the wire row')
                                   ELSE 'unknown: the whole-wire estimate (' || coalesce(w.planned::text, 'none') || ' ft) was never split at its junctions' END,
      method = s.method || '; ends conformed to the wire''s live ends, hop ' || h.n || ' of ' || h.hops || ' (RSI pass 25)'
  FROM conf_pair p JOIN conf_hop h ON h.wire_id = p.wire_id AND h.n = p.hop_n JOIN conf_w w ON w.wire_id = p.wire_id
  WHERE s.id = p.seg_id AND p.seg_id IS NOT NULL;
  GET DIAGNOSTICS n_updated = ROW_COUNT;

  -- Hops left over become segments: copied from a segment the wire keeps, or new on the wire's own net.
  INSERT INTO public.harness_segments (vehicle_id, net_id, from_termination_id, to_termination_id, wire_part_id, gauge_awg, colour,
    planned_length_ft, planned_length_method, build_state, source, method, observed_at, trust, vehicle_custom_circuit_id, design_status)
  SELECT p_vehicle_id, coalesce(k.net_id, cn.net_id), h.from_term, h.to_term, k.wire_part_id, coalesce(k.gauge_awg, w.gauge),
         coalesce(k.colour, w.colour),
         CASE WHEN h.hops = 1 AND w.planned > 0 THEN w.planned END,
         CASE WHEN h.hops = 1 THEN 'whole-wire estimate from the wire row'
              ELSE 'unknown: the whole-wire estimate (' || coalesce(w.planned::text, 'none') || ' ft) was never split at its junctions' END,
         coalesce(k.build_state, 'uncut'), w.source,
         'hop ' || h.n || ' of ' || h.hops || ' of the wire, from its live ends (RSI pass 25, the reshape v1 rule)', w.observed_at, w.trust,
         w.wire_id, coalesce(k.design_status, 'decided')
  FROM conf_pair p
  JOIN conf_hop h ON h.wire_id = p.wire_id AND h.n = p.hop_n
  JOIN conf_w w ON w.wire_id = p.wire_id
  LEFT JOIN LATERAL (SELECT s.* FROM public.harness_segments s
                     WHERE s.vehicle_custom_circuit_id = p.wire_id AND NOT s.is_superseded ORDER BY s.created_at, s.id LIMIT 1) k ON true
  LEFT JOIN conf_net cn ON cn.wire_id = p.wire_id
  WHERE p.seg_id IS NULL AND coalesce(k.net_id, cn.net_id) IS NOT NULL;
  GET DIAGNOSTICS n_inserted = ROW_COUNT;

  RETURN jsonb_build_object('wires_conformed', n_todo, 'segments_updated', n_updated, 'segments_added', n_inserted,
                            'segments_superseded', n_retired, 'nets_for_new_wires', n_nets, 'hops_skipped_two_ends_on_one_plug', n_skipped);
END $fn$;
COMMENT ON FUNCTION public.conform_harness_segments(uuid) IS 'Conforms each decided wire''s live segments to its live wire ends (the reshape v1 segmentation: from the wire''s from-end, split at terminating pass-throughs, the 61-pin halves a mate, grommets not splitting): a segment that already is a desired hop stays, an unmatched one takes an unmatched hop in place, hops left over are new segments, segments left over are superseded; a wire with no segment gets a net of its own for the net refold to join. Idempotent; returns counts. The registry loader calls it after resync_harness_segments. RSI pass 25, case ledger 13.12.3.';
REVOKE ALL ON FUNCTION public.conform_harness_segments(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conform_harness_segments(uuid) TO service_role;

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
    ('decided wires with no live segment (must be 0)', 'wires')) g(measure, grain) ON g.measure = x.measure;


COMMENT ON VIEW public.v_harness_coverage IS 'The harness model measuring itself: per public vehicle, per stack layer, a measure with its numerator and denominator and what they count (grain). RSI scoreboard for stack SH; case ledger 13.12.2 / 13.12.3. Baseline and residual since RSI pass 3; the physics check since net fold v2; the geometry check since pass 7; the build log since pass 8; grain since pass 10; the legacy-row drift check since pass 11; route-graph points and standing positions since pass 12; PDM protection against the design since pass 13; shared pin cavities since pass 14; PDM limits and loads since pass 15; the design''s splices since pass 16; wire ends on no segment since pass 19; decided wires with no segment since pass 25.';

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, note) VALUES
  ('SH', 1, 'fold', 'function', 'conform_harness_segments', NULL, 'every decided wire''s segments follow its live ends after every loader run');

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a scoreboard measure has no grain'; END IF;
  RAISE NOTICE 'RSI pass 25: segments conform with the loader''s next call to conform_harness_segments';
END $check$;

COMMIT;
