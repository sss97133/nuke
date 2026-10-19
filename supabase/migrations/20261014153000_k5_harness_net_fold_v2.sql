-- RSI pass 5 on the K5 harness model: the net fold checks its own physics, and two false joins come apart. Case ledger
-- 13.12.2.
--
-- Found 2026-10-14 while folding design loads onto nets (read-only): 14 of the 18 power-spine cables sized from physics
-- (battery +, isolator out, alternator, starter, PDM feeds) sat in one net, GND-BANK-CAB, with every ground cable:
-- 80 segments joining the Odyssey + post and PDM30 OUT19 (A24) to the ground star. The reshape (20261014101500) joined
-- every wire at a splice, a ground-typed plug or a stud into one node. Two plugs broke that rule:
--   PS-STUDS   one code for the DC primary's distinct studs (isolator stud A and B, distribution stud, starter B+,
--              alternator B+, block, frame rail, head, firewall bond), per vehicle_custom_circuits from/to text. Typed
--              ground, it merged battery +, the isolator output and the grounds. The legacy rows also lost the second end
--              of the stud-to-stud cables (#6, #59, ISO_OUT have one wire end each), and the registry marks this topology
--              open ("the registry still carries the v4 runs #63/#6/#59 - the power-spine chapter re-draws them"), so this
--              pass does not invent it: each PS-STUDS end becomes its own node until the re-draw names each stud.
--   MARKER-LF  a lamp socket with two leads (park-circuit lead, second lead), typed ground; it joined PDM30 OUT19 (#87)
--              to the ground star through MK_LF_GND.
--
-- This pass:
--   1. harness_endpoints.node_kind ('bus': all its wire ends are one electrical node; 'terminals': each end is its own)
--      and node_kind_basis, for the K5's plugs: the reshape's rule, with PS-STUDS and MARKER-LF as terminals and why.
--   2. The fold re-run with node_kind: nets whose wires change are superseded (append-only), the new nets and their
--      signals inserted, segments repointed, PDM protection recomputed with pass 1's pin rule.
--   3. Design loads: nominal_current_a (and peak where stated) from the wires' physics sizing (vehicle_custom_circuits
--      notes "sized from physics ... load N A"), the largest load on the net (a bus carries its feeder's current).
--   4. The scoreboard checks physics: "nets that join a supply to ground" (a battery + post or a PDM output on a net
--      with a battery - post), which must read 0, and stack SH gains node_kind as a need.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.gm_circuit_identification WHERE source_document LIKE 'GM ST 352 78%') THEN
    RAISE EXCEPTION 'RSI pass 4 (20261014143000) has not run';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'harness_endpoints' AND column_name = 'node_kind') THEN
    RAISE EXCEPTION 'harness_endpoints.node_kind already exists';
  END IF;
END $guard$;

-- 1. Node semantics, as data.
ALTER TABLE public.harness_endpoints
  ADD COLUMN node_kind text CHECK (node_kind IN ('bus', 'terminals')),
  ADD COLUMN node_kind_basis text;
COMMENT ON COLUMN public.harness_endpoints.node_kind IS 'Electrical node semantics for the net fold: bus = every wire end on this plug is one node (splice, ground bus, stud); terminals = each end is its own node (device, connector). Null: not yet stated.';
COMMENT ON COLUMN public.harness_endpoints.node_kind_basis IS 'Why node_kind is what it is: the rule that set it, or the evidence for an exception.';

UPDATE public.harness_endpoints e
SET node_kind = CASE WHEN e.code IN ('PS-STUDS', 'MARKER-LF') THEN 'terminals'
                     WHEN e.code LIKE 'SPL-%' OR e.endpoint_type IN ('splice', 'ground') OR e.code LIKE '%-STUD' THEN 'bus'
                     ELSE 'terminals' END,
    node_kind_basis = CASE
      WHEN e.code = 'PS-STUDS' THEN 'net fold v2 (20261014153000): one code for the DC primary''s distinct studs (isolator A and B, distribution, starter B+, alternator B+, block, frame, head, firewall), per vehicle_custom_circuits from/to text; as one node it joined battery + to ground. Each end its own node until the power-spine re-draw names each stud.'
      WHEN e.code = 'MARKER-LF' THEN 'net fold v2 (20261014153000): a lamp socket with two leads (park-circuit lead, second lead), typed ground in the design rows; as one node it joined PDM30 OUT19 to the ground star.'
      WHEN e.code LIKE 'SPL-%' OR e.endpoint_type IN ('splice', 'ground') OR e.code LIKE '%-STUD' THEN 'reshape v1 rule: a splice, ground bus or stud is one electrical node'
      ELSE 'reshape v1 rule: a device or connector; each wire end is its own node' END
FROM public.harness_designs d
WHERE d.id = e.design_id AND d.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND NOT coalesce(e.is_superseded, false);

-- 2. The fold, re-run. Wires: the K5's wires with live segments outside the candidates (decided and contradicted).
CREATE TEMP TABLE f2_w ON COMMIT DROP AS
SELECT DISTINCT c.id, c.circuit_code, c.circuit_name, c.fuse_rating_amps, c.source, c.observed_at, c.from_endpoint_id, c.to_endpoint_id
FROM public.vehicle_custom_circuits c
JOIN public.harness_segments s ON s.vehicle_custom_circuit_id = c.id AND NOT s.is_superseded AND s.design_status <> 'candidate'
WHERE s.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';

CREATE TEMP TABLE f2_e ON COMMIT DROP AS
SELECT e.id, e.code, e.endpoint_type FROM public.harness_endpoints e JOIN public.harness_designs d ON d.id = e.design_id
WHERE d.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND NOT coalesce(e.is_superseded, false) AND e.node_kind = 'bus';

CREATE TEMP TABLE f2_wm ON COMMIT DROP AS
SELECT DISTINCT w.id AS wire_id, e.id AS ep_id, e.code, e.endpoint_type
FROM f2_w w JOIN f2_e e ON e.id IN (w.from_endpoint_id, w.to_endpoint_id)
UNION
SELECT DISTINCT w.id, e.id, e.code, e.endpoint_type
FROM f2_w w JOIN public.wire_termination_specs t ON t.circuit_id = w.id AND NOT coalesce(t.is_superseded, false)
JOIN f2_e e ON e.id = t.endpoint_id;

CREATE TEMP TABLE f2_comp ON COMMIT DROP AS
WITH RECURSIVE pairs AS (
  SELECT DISTINCT a.wire_id AS x, b.wire_id AS y FROM f2_wm a JOIN f2_wm b ON a.ep_id = b.ep_id),
reach(root, wire) AS (
  SELECT id, id FROM f2_w
  UNION
  SELECT r.root, p.y FROM reach r JOIN pairs p ON p.x = r.wire)
SELECT wire AS wire_id, min(root::text)::uuid AS comp FROM reach GROUP BY wire;

-- The live net each wire is on now, and whether its component is exactly that net.
CREATE TEMP TABLE f2_now ON COMMIT DROP AS
SELECT DISTINCT s.vehicle_custom_circuit_id AS wire_id, s.net_id
FROM public.harness_segments s JOIN f2_w w ON w.id = s.vehicle_custom_circuit_id
WHERE NOT s.is_superseded AND s.design_status <> 'candidate';

CREATE TEMP TABLE f2_changed ON COMMIT DROP AS
SELECT k.comp FROM f2_comp k JOIN f2_now n ON n.wire_id = k.wire_id
GROUP BY k.comp
HAVING count(DISTINCT n.net_id) <> 1
    OR count(DISTINCT k.wire_id) <> (SELECT count(DISTINCT n2.wire_id) FROM f2_now n2 WHERE n2.net_id = min(n.net_id::text)::uuid);

CREATE TEMP TABLE f2_old ON COMMIT DROP AS
SELECT DISTINCT n.net_id FROM f2_comp k JOIN f2_changed c ON c.comp = k.comp JOIN f2_now n ON n.wire_id = k.wire_id;

CREATE TEMP TABLE f2_net ON COMMIT DROP AS
SELECT k.comp,
       coalesce(min(m.code), min(w.circuit_code)) AS net_code,
       count(DISTINCT k.wire_id) AS wires,
       bool_or(m.endpoint_type = 'ground') AS is_ground,
       bool_or(m.code LIKE '%-STUD') AS is_stud,
       min(w.observed_at) AS observed_at,
       CASE WHEN count(DISTINCT k.wire_id) = 1 THEN min(w.circuit_name) ELSE coalesce(min(m.code), min(w.circuit_name)) END AS name,
       CASE WHEN count(DISTINCT k.wire_id) = 1 THEN min(w.fuse_rating_amps) END AS fuse_a,
       CASE WHEN count(DISTINCT k.wire_id) = 1 THEN min(w.source) ELSE 'vehicle_custom_circuits (' || count(DISTINCT k.wire_id) || ' wires)' END AS source,
       gen_random_uuid() AS net_id, gen_random_uuid() AS signal_id
FROM f2_comp k JOIN f2_changed c ON c.comp = k.comp JOIN f2_w w ON w.id = k.wire_id LEFT JOIN f2_wm m ON m.wire_id = k.wire_id
GROUP BY k.comp;

-- Supersede first (live keys are unique among live rows), then insert.
UPDATE public.harness_signals g SET is_superseded = true
FROM public.harness_nets n WHERE n.id IN (SELECT net_id FROM f2_old) AND g.id = n.signal_id;
UPDATE public.harness_nets n SET is_superseded = true,
  method = n.method || '; superseded by net fold v2 (20261014153000): its wires now fold into ' ||
           (SELECT count(DISTINCT k.comp) FROM f2_now x JOIN f2_comp k ON k.wire_id = x.wire_id WHERE x.net_id = n.id) || ' net(s)'
WHERE n.id IN (SELECT net_id FROM f2_old);

INSERT INTO public.harness_signals (id, vehicle_id, signal_key, name, signal_type, source, method, observed_at, trust)
SELECT n.signal_id, 'e08bf694-970f-4cbe-8a74-8715158a0f2e', n.net_code, n.name,
       CASE WHEN n.is_ground THEN 'ground' WHEN n.is_stud THEN 'power' END,
       n.source, 'net fold v2 (20261014153000) from vehicle_custom_circuits; one signal per net', n.observed_at, 'T3'
FROM f2_net n;
INSERT INTO public.harness_nets (id, vehicle_id, net_code, signal_id, function, protection_setting_a, source, method, observed_at, trust)
SELECT n.net_id, 'e08bf694-970f-4cbe-8a74-8715158a0f2e', n.net_code, n.signal_id, n.name, n.fuse_a, n.source,
       'net fold v2 (20261014153000): wires merged through plugs whose node_kind is bus', n.observed_at, 'T3'
FROM f2_net n;

UPDATE public.harness_signals g SET superseded_by = nn.signal_id
FROM public.harness_nets o, f2_net nn
WHERE o.id IN (SELECT net_id FROM f2_old) AND g.id = o.signal_id AND nn.net_code = o.net_code;
UPDATE public.harness_nets o SET superseded_by = nn.net_id
FROM f2_net nn WHERE o.id IN (SELECT net_id FROM f2_old) AND nn.net_code = o.net_code;

UPDATE public.harness_segments s SET net_id = n.net_id
FROM f2_comp k JOIN f2_net n ON n.comp = k.comp
WHERE s.vehicle_custom_circuit_id = k.wire_id AND NOT s.is_superseded AND s.design_status <> 'candidate';

-- Protection on the new nets: pass 1's rule (a wire end on a PDM output pin points the net at that output).
UPDATE public.harness_nets n
SET protection_pdm_channel_id = x.channel_id,
    method = n.method || '; protection from the PDM output pin (' || x.pin || ')'
FROM (
  SELECT DISTINCT ON (s.net_id) s.net_id, ch.id AS channel_id, e.code || ' ' || t.cavity || ' = ' || p.pin_function AS pin
  FROM public.harness_segments s
  JOIN public.wire_termination_specs t ON t.id IN (s.from_termination_id, s.to_termination_id)
  JOIN public.harness_endpoints e ON e.id = t.endpoint_id AND e.code ~ '^PDM(15|30)-[AB]$'
  JOIN public.device_pin_maps p ON p.device_model = split_part(e.code, '-', 1)
       AND regexp_replace(upper(p.pin_number), '^([A-Z]+)0*([0-9]+)$', '\1\2') = regexp_replace(upper(t.cavity), '^([A-Z]+)0*([0-9]+)$', '\1\2')
       AND coalesce(substring(p.pin_function FROM '^OUT([0-9]+)'), substring(p.pin_function FROM '^Output ([0-9]+)')) IS NOT NULL
  JOIN public.pdm_units u ON u.vehicle_id = s.vehicle_id AND u.model = 'MoTeC ' || p.device_model
  JOIN public.pdm_channels ch ON ch.pdm_unit_id = u.id AND ch.channel_number = coalesce(substring(p.pin_function FROM '^OUT([0-9]+)'), substring(p.pin_function FROM '^Output ([0-9]+)'))::int
  WHERE s.net_id IN (SELECT net_id FROM f2_net) AND NOT s.is_superseded
  ORDER BY s.net_id, ch.fuse_rating_amps DESC NULLS LAST
) x
WHERE n.id = x.net_id;

-- 3. Design loads from the physics sizing on the wires.
UPDATE public.harness_nets n
SET nominal_current_a = x.load_a, peak_current_a = x.peak_a,
    method = n.method || '; load: the largest physics-sized design load among its wires (' || x.wires || '; vehicle_custom_circuits notes, cable_sizing_v5.py)'
FROM (
  SELECT s.net_id, max(substring(c.notes FROM 'load ([0-9.]+) A')::numeric) AS load_a,
         max(substring(c.notes FROM 'cranking ([0-9.]+) A')::numeric) AS peak_a,
         string_agg(DISTINCT c.circuit_code || ' ' || substring(c.notes FROM 'load ([0-9.]+) A') || ' A', ', ') AS wires
  FROM public.harness_segments s JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
  WHERE s.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND NOT s.is_superseded AND c.notes ~ '^sized from physics [0-9-]+: load [0-9.]+ A'
  GROUP BY s.net_id
) x
WHERE n.id = x.net_id AND NOT n.is_superseded;

-- 4. The scoreboard checks physics.
CREATE OR REPLACE VIEW public.v_harness_coverage AS
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
res AS (SELECT * FROM public.v_harness_factory_residual)
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
           WHERE s.net_id = n.id AND NOT s.is_superseded AND t.cavity ILIKE '- post%')), count(*) FROM nets n GROUP BY 1;
COMMENT ON VIEW public.v_harness_coverage IS 'The harness model measuring itself: per public vehicle, per stack layer, a measure with its numerator and denominator. RSI scoreboard for stack SH; case ledger 13.12.2. Baseline and residual since RSI pass 3; the physics check (nets joining a supply to ground) since net fold v2 (20261014153000).';
GRANT SELECT ON public.v_harness_coverage TO anon, authenticated, service_role;

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, note) VALUES
  ('SH', 1, 'fold', 'column', 'harness_endpoints.node_kind', 'harness_endpoints.id', 'plugs whose electrical node semantics are stated (bus or terminals)');

-- Result.
DO $check$
DECLARE superseded int; added int; shorted int; loaded int; protected int; total int;
BEGIN
  SELECT count(*) INTO superseded FROM f2_old;
  SELECT count(*) INTO added FROM f2_net;
  SELECT numerator INTO shorted FROM public.v_harness_coverage
  WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND measure = 'nets that join a supply to ground (must be 0)';
  IF coalesce(shorted, 0) <> 0 THEN
    RAISE EXCEPTION 'net fold v2 still joins a supply to ground on % net(s)', shorted;
  END IF;
  SELECT count(nominal_current_a), count(protection_pdm_channel_id), count(*) INTO loaded, protected, total
  FROM public.harness_nets WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND NOT is_superseded;
  RAISE NOTICE 'net fold v2: % nets superseded, % nets added; 0 nets join a supply to ground; % of % live nets carry a design load, % a PDM output',
    superseded, added, loaded, total, protected;
END $check$;

COMMIT;
