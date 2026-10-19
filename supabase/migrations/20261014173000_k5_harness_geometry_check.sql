-- RSI pass 7 on the harness model: planned lengths checked against geometry. Case ledger 13.12.2.
--
-- A wire cannot be shorter than the straight line between the plugs it joins. 98 K5 plugs carry a position from the
-- digital twin (harness_endpoints.pos_x_m / pos_y_m / pos_z_m, pos_source naming the twin anchor or object); measured
-- read-only 2026-10-14: 132 live segments have both plugs positioned, 15 of those have a planned length, and 4 are
-- planned shorter than the straight line: #119 and #120 PDM30-B to DAKOTA-VHX planned 1.5 ft against 3.6 ft, #71 and
-- #39 planned 3.5 ft against 3.6 ft. Either a position (the PDM30's is the twin's assumption A2, "under dash passenger")
-- or the plan is wrong; the check names them and fixes neither.
--
-- This pass: v_harness_segment_geometry (per live segment: its plugs, straight-line distance in ft from the twin
-- positions, planned length, and the position sources), and two scoreboard measures: segments with both plugs
-- positioned, and segments planned shorter than the straight line (must be 0; 4 today). The three harness views lose
-- their default write grants to anon and authenticated (they are not updatable; this makes it explicit).
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF to_regprocedure('public.key_harness_wire_ends(uuid)') IS NULL THEN
    RAISE EXCEPTION 'RSI pass 6 (20261014163000) has not run';
  END IF;
  IF to_regclass('public.v_harness_segment_geometry') IS NOT NULL THEN
    RAISE EXCEPTION 'v_harness_segment_geometry already exists';
  END IF;
END $guard$;

CREATE VIEW public.v_harness_segment_geometry AS
SELECT s.id AS segment_id, s.vehicle_id, s.net_id, c.circuit_code, ef.code AS from_plug, et.code AS to_plug,
       round((sqrt(power(ef.pos_x_m - et.pos_x_m, 2) + power(ef.pos_y_m - et.pos_y_m, 2) + power(ef.pos_z_m - et.pos_z_m, 2)) * 3.28084)::numeric, 2) AS straight_ft,
       s.planned_length_ft AS planned_ft, s.planned_length_method, ef.pos_source AS from_pos_source, et.pos_source AS to_pos_source
FROM public.harness_segments s
JOIN public.vehicles v ON v.id = s.vehicle_id AND v.is_public IS TRUE
LEFT JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
LEFT JOIN public.wire_termination_specs tf ON tf.id = s.from_termination_id
LEFT JOIN public.harness_endpoints ef ON ef.id = tf.endpoint_id
LEFT JOIN public.wire_termination_specs tt ON tt.id = s.to_termination_id
LEFT JOIN public.harness_endpoints et ON et.id = tt.endpoint_id
WHERE NOT s.is_superseded;
COMMENT ON VIEW public.v_harness_segment_geometry IS 'Stack SH geometry check: per live segment of a public vehicle, the straight-line distance between its two plugs from their twin positions (ft; null when either plug has no position) beside the planned length. A planned length below the straight line is impossible: a position or the plan is wrong.';
GRANT SELECT ON public.v_harness_segment_geometry TO anon, authenticated, service_role;

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
           WHERE s.net_id = n.id AND NOT s.is_superseded AND t.cavity ILIKE '- post%')), count(*) FROM nets n GROUP BY 1
UNION ALL SELECT g.vehicle_id, 'dimension', 'segments with both plugs positioned', count(*) FILTER (WHERE g.straight_ft IS NOT NULL), count(*) FROM public.v_harness_segment_geometry g GROUP BY 1
UNION ALL SELECT g.vehicle_id, 'prediction', 'segments planned shorter than the straight line between their plugs (must be 0)', count(*) FILTER (WHERE g.planned_ft < g.straight_ft), count(*) FILTER (WHERE g.planned_ft IS NOT NULL AND g.straight_ft IS NOT NULL) FROM public.v_harness_segment_geometry g GROUP BY 1;

COMMENT ON VIEW public.v_harness_coverage IS 'The harness model measuring itself: per public vehicle, per stack layer, a measure with its numerator and denominator. RSI scoreboard for stack SH; case ledger 13.12.2. Baseline and residual since RSI pass 3; the physics check since net fold v2; the geometry check since RSI pass 7 (20261014173000).';
GRANT SELECT ON public.v_harness_coverage TO anon, authenticated, service_role;

-- Read-only to the public by grant as well as by shape: these views join, union or aggregate (not updatable), and the
-- schema's default privileges grant ALL on new relations; writes are revoked explicitly.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.v_harness_coverage, public.v_harness_factory_residual, public.v_harness_segment_geometry
  FROM anon, authenticated;

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, note) VALUES
  ('SH', 1, 'prediction', 'table', 'v_harness_segment_geometry', NULL, 'planned length against the straight line between the plugs');

DO $check$
DECLARE pos int; total int; short int; planned int;
BEGIN
  SELECT count(*) FILTER (WHERE straight_ft IS NOT NULL), count(*), count(*) FILTER (WHERE planned_ft < straight_ft), count(*) FILTER (WHERE planned_ft IS NOT NULL AND straight_ft IS NOT NULL)
    INTO pos, total, short, planned
  FROM public.v_harness_segment_geometry WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';
  RAISE NOTICE 'RSI pass 7: % of % K5 segments have both plugs positioned; % of the % with a plan are planned shorter than the straight line',
    pos, total, short, planned;
END $check$;

COMMIT;
