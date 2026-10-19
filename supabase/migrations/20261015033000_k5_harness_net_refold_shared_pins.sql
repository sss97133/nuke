-- RSI pass 14 on the harness model: two wire ends in one pin are one electrical node, and the net fold re-runs.
-- Case ledger 13.12.3.
--
-- The net fold (reshape v1, net fold v2 in 20261014153000) joins wires only through plugs whose node_kind is bus
-- (splices, ground buses, studs). It never joins two wires landed in the same pin of a device or connector, though they
-- are one electrical node. Measured read-only 2026-10-15 on the K5 (decided wires, live ends):
--   - The 8 marker and clearance lamp feeds on PDM30-A A24 (OUT19) are 8 nets; OUT13's 5 feeds on A11 are 5 nets.
--   - The 12 sensor grounds on M130-B B16 are 12 nets; the 5 sensor 5 V references on M130-A A02 are 5 nets.
--   - Both CAN pairs on the PDMs, the dimmer's high and low beam cavities, and the switch returns on PDM30 A28 likewise.
--   29 pin cavities hold several wire ends, and 89 nets are pieces of 27 electrical nodes.
-- In the registry each of those groups meets in a splice (k5_registry.json "splices": 37 "splice at pin" groups, e.g.
-- M130-B B16 = two D-609-05 group splices and a lead). The registry loader drops the splices and lands every wire on the
-- pin, so the model sees 12 wires in one Superseal cavity. That is a loader gap, named here and measured below; the
-- electrical node is the same either way, so the fold can be right now.
--
-- The rule is narrow on purpose:
--   - Cavity labels compare case-sensitively. The D38999 25-61 insert has contacts F and f (different wires); only
--     leading zeros and an underscore are normalised (A02 = A2).
--   - A cavity named by a stud, lug, post, ring or eyelet does not join. Its text describes the lug, not which stud
--     (AMP-BLOCK "stud, lug DL438" carries the power tail and the ground tail); net fold v2 kept PS-STUDS apart for
--     the same reason.
--   - Only decided wires join through a shared pin. A contradicted wire on the same pin is a superseded design, not a
--     second conductor.
--   Simulated read-only on production before writing: 27 nodes absorb 89 nets, and no node joins a supply to ground.
--
-- This pass:
--   1. refold_harness_nets(vehicle): the net fold as a function. Wires (live, non-candidate segments) join through bus
--      plugs and through shared pin cavities. Changed nets are superseded (each pointing at the net its wires moved
--      to) with their signals, new nets and signals are inserted, segments are re-pointed, loads are re-read from the
--      physics sizing, and protection is re-folded (fold_harness_net_protection). Idempotent; service role; the
--      loader calls it after every run.
--   2. v_harness_pin_occupancy: wire ends per pin cavity. The scoreboard counts the cavities shared by several wires:
--      the backlog for loading the registry's splices.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF to_regprocedure('public.fold_harness_net_protection(uuid)') IS NULL THEN
    RAISE EXCEPTION 'RSI pass 13 (20261015023000) has not run';
  END IF;
  IF to_regprocedure('public.refold_harness_nets(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'refold_harness_nets already exists';
  END IF;
END $guard$;

-- 1. Wire ends per pin cavity (decided wires, live ends on live segments, plugs whose ends are each their own node).
CREATE VIEW public.v_harness_pin_occupancy AS
SELECT s.vehicle_id, e.id AS endpoint_id, e.code AS plug,
       regexp_replace(btrim(t.cavity), '^([A-Za-z]+)_?0*([0-9]+)$', '\1\2') AS cavity,
       count(DISTINCT c.id) AS wires,
       string_agg(DISTINCT c.circuit_code, ', ') AS wire_codes
FROM public.harness_segments s
JOIN public.vehicles v ON v.id = s.vehicle_id AND v.is_public IS TRUE
JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id AND c.design_status = 'decided' AND NOT coalesce(c.is_superseded, false)
JOIN public.wire_termination_specs t ON t.id IN (s.from_termination_id, s.to_termination_id) AND NOT coalesce(t.is_superseded, false)
JOIN public.harness_endpoints e ON e.id = t.endpoint_id AND e.node_kind = 'terminals'
WHERE NOT s.is_superseded AND btrim(coalesce(t.cavity, '')) <> '' AND t.cavity !~* '(stud|lug|post|ring|eyelet)'
GROUP BY s.vehicle_id, e.id, e.code, regexp_replace(btrim(t.cavity), '^([A-Za-z]+)_?0*([0-9]+)$', '\1\2');
COMMENT ON VIEW public.v_harness_pin_occupancy IS 'Per pin cavity of a public vehicle''s plugs (node_kind terminals; stud, lug and post cavities excluded): how many decided wires land there. More than one is one electrical node, which the registry builds as a splice at the pin or a doubled terminal; the model holds neither yet. Cavity labels are case-sensitive (D38999 F and f differ). RSI pass 14, case ledger 13.12.3.';
REVOKE ALL ON public.v_harness_pin_occupancy FROM anon, authenticated;
GRANT SELECT ON public.v_harness_pin_occupancy TO anon, authenticated;

-- 2. The net fold as a function.
CREATE FUNCTION public.refold_harness_nets(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE n_comp int; n_changed int; n_old int; n_new int; n_seg int; prot jsonb;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS refold_w (id uuid PRIMARY KEY, circuit_code text, circuit_name text, fuse_rating_amps numeric,
    source text, observed_at timestamptz, from_endpoint_id uuid, to_endpoint_id uuid, design_status text, created_at timestamptz) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS refold_link (wire_id uuid, node text, label text, is_bus boolean, is_ground boolean, is_stud boolean) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS refold_comp (wire_id uuid PRIMARY KEY, comp uuid) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS refold_now (wire_id uuid, net_id uuid) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS refold_changed (comp uuid PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS refold_net (comp uuid PRIMARY KEY, net_code text, name text, fuse_a numeric, source text,
    observed_at timestamptz, is_ground boolean, is_stud boolean, net_id uuid, signal_id uuid) ON COMMIT DROP;
  TRUNCATE refold_w, refold_link, refold_comp, refold_now, refold_changed, refold_net;

  INSERT INTO refold_w
  SELECT DISTINCT ON (c.id) c.id, c.circuit_code, c.circuit_name, c.fuse_rating_amps, c.source, c.observed_at,
         c.from_endpoint_id, c.to_endpoint_id, c.design_status, c.created_at
  FROM public.vehicle_custom_circuits c
  JOIN public.harness_segments s ON s.vehicle_custom_circuit_id = c.id AND NOT s.is_superseded AND s.design_status <> 'candidate'
  WHERE s.vehicle_id = p_vehicle_id;

  -- Bus plugs: every end on one is one node (net fold v2's rule).
  INSERT INTO refold_link
  SELECT DISTINCT w.id, 'bus:' || e.id, e.code, true, e.endpoint_type = 'ground', e.code LIKE '%-STUD'
  FROM refold_w w JOIN public.harness_endpoints e ON e.id IN (w.from_endpoint_id, w.to_endpoint_id)
  WHERE NOT coalesce(e.is_superseded, false) AND e.node_kind = 'bus'
  UNION
  SELECT DISTINCT w.id, 'bus:' || e.id, e.code, true, e.endpoint_type = 'ground', e.code LIKE '%-STUD'
  FROM refold_w w JOIN public.wire_termination_specs t ON t.circuit_id = w.id AND NOT coalesce(t.is_superseded, false)
  JOIN public.harness_endpoints e ON e.id = t.endpoint_id AND NOT coalesce(e.is_superseded, false) AND e.node_kind = 'bus';
  -- Shared pins: decided wires whose live ends land in the same cavity of a terminals plug.
  INSERT INTO refold_link
  SELECT x.wire_id, x.node, x.label, false, false, false
  FROM (SELECT DISTINCT w.id AS wire_id,
               'pin:' || e.id || ':' || regexp_replace(btrim(t.cavity), '^([A-Za-z]+)_?0*([0-9]+)$', '\1\2') AS node,
               e.code || ' ' || regexp_replace(btrim(t.cavity), '^([A-Za-z]+)_?0*([0-9]+)$', '\1\2') AS label
        FROM refold_w w
        JOIN public.wire_termination_specs t ON t.circuit_id = w.id AND NOT coalesce(t.is_superseded, false)
        JOIN public.harness_endpoints e ON e.id = t.endpoint_id AND NOT coalesce(e.is_superseded, false) AND e.node_kind = 'terminals'
        WHERE w.design_status = 'decided' AND btrim(coalesce(t.cavity, '')) <> '' AND t.cavity !~* '(stud|lug|post|ring|eyelet)'
          AND EXISTS (SELECT 1 FROM public.harness_segments s WHERE s.vehicle_custom_circuit_id = w.id AND NOT s.is_superseded
                        AND t.id IN (s.from_termination_id, s.to_termination_id))) x
  WHERE x.node IN (SELECT node FROM (SELECT DISTINCT w.id, 'pin:' || e.id || ':' || regexp_replace(btrim(t.cavity), '^([A-Za-z]+)_?0*([0-9]+)$', '\1\2') AS node
                                    FROM refold_w w
                                    JOIN public.wire_termination_specs t ON t.circuit_id = w.id AND NOT coalesce(t.is_superseded, false)
                                    JOIN public.harness_endpoints e ON e.id = t.endpoint_id AND NOT coalesce(e.is_superseded, false) AND e.node_kind = 'terminals'
                                    WHERE w.design_status = 'decided' AND btrim(coalesce(t.cavity, '')) <> '' AND t.cavity !~* '(stud|lug|post|ring|eyelet)'
                                      AND EXISTS (SELECT 1 FROM public.harness_segments s WHERE s.vehicle_custom_circuit_id = w.id AND NOT s.is_superseded
                                                    AND t.id IN (s.from_termination_id, s.to_termination_id))) y
                   GROUP BY node HAVING count(*) > 1);

  INSERT INTO refold_comp
  WITH RECURSIVE pairs AS (SELECT DISTINCT a.wire_id AS x, b.wire_id AS y FROM refold_link a JOIN refold_link b ON a.node = b.node),
  reach(root, wire) AS (SELECT id, id FROM refold_w UNION SELECT r.root, p.y FROM reach r JOIN pairs p ON p.x = r.wire)
  SELECT wire, min(root::text)::uuid FROM reach GROUP BY wire;
  SELECT count(DISTINCT comp) INTO n_comp FROM refold_comp;

  INSERT INTO refold_now
  SELECT DISTINCT s.vehicle_custom_circuit_id, s.net_id FROM public.harness_segments s JOIN refold_w w ON w.id = s.vehicle_custom_circuit_id
  WHERE NOT s.is_superseded AND s.design_status <> 'candidate';

  -- A component changes when its wires sit on more than one net, or its net also holds wires outside it.
  INSERT INTO refold_changed
  SELECT k.comp FROM refold_comp k JOIN refold_now n ON n.wire_id = k.wire_id
  GROUP BY k.comp
  HAVING count(DISTINCT n.net_id) <> 1
      OR count(DISTINCT k.wire_id) <> (SELECT count(DISTINCT n2.wire_id) FROM refold_now n2 WHERE n2.net_id = min(n.net_id::text)::uuid);
  SELECT count(*) INTO n_changed FROM refold_changed;
  IF n_changed = 0 THEN
    prot := public.fold_harness_net_protection(p_vehicle_id);
    RETURN jsonb_build_object('nodes', n_comp, 'nets_superseded', 0, 'nets_created', 0, 'segments_repointed', 0, 'protection', prot);
  END IF;

  INSERT INTO refold_net
  SELECT k.comp,
         coalesce(min(l.label) FILTER (WHERE l.is_bus), min(l.label) FILTER (WHERE NOT l.is_bus), min(w.circuit_code)),
         CASE WHEN count(DISTINCT k.wire_id) = 1 THEN min(w.circuit_name)
              ELSE coalesce(min(l.label) FILTER (WHERE l.is_bus), min(l.label) FILTER (WHERE NOT l.is_bus), min(w.circuit_name)) END,
         CASE WHEN count(DISTINCT k.wire_id) = 1 THEN min(w.fuse_rating_amps) END,
         CASE WHEN count(DISTINCT k.wire_id) = 1 THEN coalesce(min(w.source), 'vehicle_custom_circuits ' || min(w.circuit_code))
              ELSE 'vehicle_custom_circuits (' || count(DISTINCT k.wire_id) || ' wires)' END,
         coalesce(min(w.observed_at), min(w.created_at)), coalesce(bool_or(l.is_ground), false), coalesce(bool_or(l.is_stud), false),
         gen_random_uuid(), gen_random_uuid()
  FROM refold_comp k JOIN refold_changed c ON c.comp = k.comp JOIN refold_w w ON w.id = k.wire_id
  LEFT JOIN refold_link l ON l.wire_id = k.wire_id
  GROUP BY k.comp;

  -- Supersede first (live codes are unique), then insert, then link each old net to the net its wires moved to.
  UPDATE public.harness_signals g SET is_superseded = true
  FROM public.harness_nets n
  WHERE n.id IN (SELECT DISTINCT x.net_id FROM refold_now x JOIN refold_comp k ON k.wire_id = x.wire_id JOIN refold_changed c ON c.comp = k.comp)
    AND g.id = n.signal_id AND NOT g.is_superseded;
  UPDATE public.harness_nets n SET is_superseded = true,
         method = n.method || '; superseded by the net refold (RSI pass 14): its wires now fold into '
                  || (SELECT count(DISTINCT k.comp) FROM refold_now x JOIN refold_comp k ON k.wire_id = x.wire_id WHERE x.net_id = n.id) || ' net(s)'
  WHERE n.id IN (SELECT DISTINCT x.net_id FROM refold_now x JOIN refold_comp k ON k.wire_id = x.wire_id JOIN refold_changed c ON c.comp = k.comp)
    AND NOT n.is_superseded;
  GET DIAGNOSTICS n_old = ROW_COUNT;

  INSERT INTO public.harness_signals (id, vehicle_id, signal_key, name, signal_type, source, method, observed_at, trust)
  SELECT r.signal_id, p_vehicle_id, r.net_code, r.name, CASE WHEN r.is_ground THEN 'ground' WHEN r.is_stud THEN 'power' END,
         r.source, 'net refold (RSI pass 14) from vehicle_custom_circuits; one signal per net', r.observed_at, 'T3'
  FROM refold_net r;
  INSERT INTO public.harness_nets (id, vehicle_id, net_code, signal_id, function, protection_setting_a, source, method, observed_at, trust)
  SELECT r.net_id, p_vehicle_id, r.net_code, r.signal_id, r.name, r.fuse_a, r.source,
         'net refold (RSI pass 14): wires joined through bus plugs and through shared pin cavities', r.observed_at, 'T3'
  FROM refold_net r;
  GET DIAGNOSTICS n_new = ROW_COUNT;

  UPDATE public.harness_nets o SET superseded_by = m.net_id
  FROM (SELECT x.net_id AS old_id, min(r.net_id::text)::uuid AS net_id, count(DISTINCT r.net_id) AS k
        FROM refold_now x JOIN refold_comp c ON c.wire_id = x.wire_id JOIN refold_net r ON r.comp = c.comp GROUP BY x.net_id) m
  WHERE o.id = m.old_id AND m.k = 1 AND o.superseded_by IS NULL AND o.is_superseded;
  UPDATE public.harness_signals g SET superseded_by = nn.signal_id
  FROM public.harness_nets o JOIN public.harness_nets nn ON nn.id = o.superseded_by
  WHERE g.id = o.signal_id AND g.superseded_by IS NULL AND g.is_superseded AND nn.id IN (SELECT net_id FROM refold_net);

  UPDATE public.harness_segments s SET net_id = r.net_id
  FROM refold_comp k JOIN refold_net r ON r.comp = k.comp
  WHERE s.vehicle_custom_circuit_id = k.wire_id AND NOT s.is_superseded AND s.design_status <> 'candidate' AND s.net_id IS DISTINCT FROM r.net_id;
  GET DIAGNOSTICS n_seg = ROW_COUNT;

  -- Loads from the physics sizing on the wires (net fold v2's rule), on the new nets.
  UPDATE public.harness_nets n
  SET nominal_current_a = x.load_a, peak_current_a = x.peak_a,
      method = n.method || '; load: the largest physics-sized design load among its wires (' || x.wires || '; vehicle_custom_circuits notes, cable_sizing_v5.py)'
  FROM (SELECT s.net_id, max(substring(c.notes FROM 'load ([0-9.]+) A')::numeric) AS load_a,
               max(substring(c.notes FROM 'cranking ([0-9.]+) A')::numeric) AS peak_a,
               string_agg(DISTINCT c.circuit_code || ' ' || substring(c.notes FROM 'load ([0-9.]+) A') || ' A', ', ') AS wires
        FROM public.harness_segments s JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
        WHERE s.vehicle_id = p_vehicle_id AND NOT s.is_superseded AND c.notes ~ '^sized from physics [0-9-]+: load [0-9.]+ A'
          AND s.net_id IN (SELECT net_id FROM refold_net)
        GROUP BY s.net_id) x
  WHERE n.id = x.net_id;

  prot := public.fold_harness_net_protection(p_vehicle_id);
  RETURN jsonb_build_object('nodes', n_comp, 'nets_superseded', n_old, 'nets_created', n_new, 'segments_repointed', n_seg, 'protection', prot);
END $fn$;
COMMENT ON FUNCTION public.refold_harness_nets(uuid) IS 'The harness net fold for a vehicle, re-runnable: wires on live non-candidate segments join through bus plugs (node_kind bus) and through pin cavities shared by decided wires (case-sensitive labels; stud, lug and post cavities excluded). Changed nets are superseded with their signals, new nets and signals inserted, segments re-pointed, loads re-read from the physics sizing and protection re-folded. Idempotent; returns counts. The registry loader calls it after every run. RSI pass 14, case ledger 13.12.3.';
REVOKE ALL ON FUNCTION public.refold_harness_nets(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refold_harness_nets(uuid) TO service_role;

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
    ('pin cavities shared by several wires', 'cavities')) g(measure, grain) ON g.measure = x.measure;

COMMENT ON VIEW public.v_harness_coverage IS 'The harness model measuring itself: per public vehicle, per stack layer, a measure with its numerator and denominator and what they count (grain). RSI scoreboard for stack SH; case ledger 13.12.2 / 13.12.3. Baseline and residual since RSI pass 3; the physics check since net fold v2; the geometry check since pass 7; the build log since pass 8; grain since pass 10; the legacy-row drift check since pass 11; route-graph points and standing positions since pass 12; PDM protection against the design since pass 13; shared pin cavities since pass 14.';

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, note) VALUES
  ('SH', 1, 'fold', 'function', 'refold_harness_nets', NULL, 'nets re-folded through buses and shared pins after every run'),
  ('SH', 1, 'fold', 'table', 'v_harness_pin_occupancy', NULL, 'wire ends per pin cavity: the splices the model still lacks');

DO $check$
DECLARE r jsonb; r2 jsonb; short_ int; nets_ int; shared_ int;
BEGIN
  r := public.refold_harness_nets('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  r2 := public.refold_harness_nets('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF (r2->>'nets_superseded')::int <> 0 OR (r2->>'segments_repointed')::int <> 0 THEN RAISE EXCEPTION 'the refold is not idempotent: %', r2; END IF;
  SELECT numerator INTO short_ FROM public.v_harness_coverage
  WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND measure = 'nets that join a supply to ground (must be 0)';
  IF short_ <> 0 THEN RAISE EXCEPTION 'the refold joined a supply to ground in % net(s)', short_; END IF;
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a scoreboard measure has no grain'; END IF;
  SELECT denominator INTO nets_ FROM public.v_harness_coverage
  WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND measure = 'nets with protection';
  SELECT numerator INTO shared_ FROM public.v_harness_coverage
  WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND measure LIKE 'pin cavities shared by several wires%';
  RAISE NOTICE 'RSI pass 14 on the K5: refold %; live nets %; shared pin cavities %; supply joined to ground %', r, nets_, shared_, short_;
END $check$;

COMMIT;
