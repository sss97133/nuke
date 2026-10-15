-- RSI pass 11 on the harness model: the model follows the design rows it was folded from. Case ledger 13.12.3.
--
-- harness_segments point at legacy rows: the wire (vehicle_custom_circuits) and its two ends (wire_termination_specs).
-- The registry loader (docs/wiring/calc-data/load_map_rows.py) never edits a changed wire in place: it supersedes the
-- wire and its ends and inserts new rows, linking the old wire to its successor (superseded_by) but not the old ends
-- (measured read-only 2026-10-14 on the K5: 1,851 of 1,941 superseded wires carry a successor, 0 of 3,182 superseded
-- wire ends do). Today 0 live segments point at a superseded row; the next loader run that changes a wire would leave
-- its segments on dead rows, silently.
--
-- This pass:
--   1. resync_harness_segments(vehicle_id): segments on a superseded wire move to its live successor (following
--      superseded_by); segments of a wire that left the design (no live successor) are superseded with a note; each
--      segment end on a superseded wire end moves to the live end of the segment's wire at the same plug (by plug code,
--      so a plug row superseded and reinserted still matches); an end with no single match is left in place and stays
--      counted below. A segment that is its wire's only segment and still carries the legacy zone estimate takes the
--      successor's planned length; a segment with its own better plan (twin route) keeps it. Idempotent; service role.
--   2. The scoreboard gains "live segments on superseded legacy rows (must be 0)".
--   3. The loader calls the fold at the end of every run (same PR).
-- Net membership is not re-folded here: a successor wire that lands on different plugs changes nets, which the net fold
-- (20261014153000) owns.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'v_harness_coverage' AND column_name = 'grain') THEN
    RAISE EXCEPTION 'RSI pass 10 (20261014235500) has not run';
  END IF;
  IF to_regprocedure('public.resync_harness_segments(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'resync_harness_segments already exists';
  END IF;
END $guard$;

CREATE FUNCTION public.resync_harness_segments(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE rewired int; retired int; from_moved int; to_moved int; replanned int; left_ int;
BEGIN
  -- 1. Segments on a superseded wire move to its live successor.
  WITH RECURSIVE chain(start_id, cur_id, depth) AS (
    SELECT c.id, c.superseded_by, 1
    FROM public.vehicle_custom_circuits c
    WHERE coalesce(c.is_superseded, false) AND c.superseded_by IS NOT NULL
      AND c.id IN (SELECT vehicle_custom_circuit_id FROM public.harness_segments WHERE vehicle_id = p_vehicle_id AND NOT is_superseded)
    UNION ALL
    SELECT ch.start_id, c.superseded_by, ch.depth + 1
    FROM chain ch JOIN public.vehicle_custom_circuits c ON c.id = ch.cur_id
    WHERE coalesce(c.is_superseded, false) AND c.superseded_by IS NOT NULL AND ch.depth < 20),
  succ AS (
    SELECT DISTINCT ON (ch.start_id) ch.start_id, ch.cur_id
    FROM chain ch JOIN public.vehicle_custom_circuits c ON c.id = ch.cur_id
    WHERE NOT coalesce(c.is_superseded, false)
    ORDER BY ch.start_id, ch.depth)
  UPDATE public.harness_segments s
  SET vehicle_custom_circuit_id = succ.cur_id,
      method = s.method || '; moved to the wire''s successor row (resync_harness_segments)'
  FROM succ
  WHERE s.vehicle_custom_circuit_id = succ.start_id AND s.vehicle_id = p_vehicle_id AND NOT s.is_superseded;
  GET DIAGNOSTICS rewired = ROW_COUNT;

  -- 2. Segments whose wire left the design (superseded, no live successor) leave the live model.
  UPDATE public.harness_segments s
  SET is_superseded = true,
      design_note = concat_ws('; ', s.design_note, 'its wire left the design: superseded with no live successor (resync_harness_segments)')
  FROM public.vehicle_custom_circuits c
  WHERE c.id = s.vehicle_custom_circuit_id AND coalesce(c.is_superseded, false)
    AND s.vehicle_id = p_vehicle_id AND NOT s.is_superseded;
  GET DIAGNOSTICS retired = ROW_COUNT;

  -- 3. Segment ends on a superseded wire end move to the live end of the same wire at the same plug, when exactly one.
  WITH moves AS (
    SELECT s.id AS segment_id, (array_agg(n.id))[1] AS new_id
    FROM public.harness_segments s
    JOIN public.wire_termination_specs o ON o.id = s.from_termination_id AND coalesce(o.is_superseded, false)
    JOIN public.harness_endpoints oe ON oe.id = o.endpoint_id
    JOIN public.wire_termination_specs n ON n.circuit_id = s.vehicle_custom_circuit_id AND NOT coalesce(n.is_superseded, false)
    JOIN public.harness_endpoints ne ON ne.id = n.endpoint_id AND ne.code = oe.code
    WHERE s.vehicle_id = p_vehicle_id AND NOT s.is_superseded
    GROUP BY s.id HAVING count(*) = 1)
  UPDATE public.harness_segments s SET from_termination_id = m.new_id FROM moves m WHERE s.id = m.segment_id;
  GET DIAGNOSTICS from_moved = ROW_COUNT;
  WITH moves AS (
    SELECT s.id AS segment_id, (array_agg(n.id))[1] AS new_id
    FROM public.harness_segments s
    JOIN public.wire_termination_specs o ON o.id = s.to_termination_id AND coalesce(o.is_superseded, false)
    JOIN public.harness_endpoints oe ON oe.id = o.endpoint_id
    JOIN public.wire_termination_specs n ON n.circuit_id = s.vehicle_custom_circuit_id AND NOT coalesce(n.is_superseded, false)
    JOIN public.harness_endpoints ne ON ne.id = n.endpoint_id AND ne.code = oe.code
    WHERE s.vehicle_id = p_vehicle_id AND NOT s.is_superseded
    GROUP BY s.id HAVING count(*) = 1)
  UPDATE public.harness_segments s SET to_termination_id = m.new_id FROM moves m WHERE s.id = m.segment_id;
  GET DIAGNOSTICS to_moved = ROW_COUNT;

  -- 4. A wire's only segment, still on the legacy zone estimate, takes the successor wire's planned length.
  UPDATE public.harness_segments s
  SET planned_length_ft = c.planned_length_ft
  FROM public.vehicle_custom_circuits c
  WHERE c.id = s.vehicle_custom_circuit_id AND s.vehicle_id = p_vehicle_id AND NOT s.is_superseded
    AND s.planned_length_method LIKE 'whole-wire zone estimate from the legacy row%'
    AND s.planned_length_ft IS DISTINCT FROM c.planned_length_ft
    AND NOT EXISTS (SELECT 1 FROM public.harness_segments o WHERE o.vehicle_custom_circuit_id = s.vehicle_custom_circuit_id AND o.id <> s.id AND NOT o.is_superseded);
  GET DIAGNOSTICS replanned = ROW_COUNT;

  SELECT count(*) INTO left_ FROM public.harness_segments s
  WHERE s.vehicle_id = p_vehicle_id AND NOT s.is_superseded
    AND (EXISTS (SELECT 1 FROM public.vehicle_custom_circuits c WHERE c.id = s.vehicle_custom_circuit_id AND coalesce(c.is_superseded, false))
      OR EXISTS (SELECT 1 FROM public.wire_termination_specs t WHERE t.id IN (s.from_termination_id, s.to_termination_id) AND coalesce(t.is_superseded, false)));

  RETURN jsonb_build_object('segments_moved_to_successor', rewired, 'segments_retired', retired,
                            'ends_moved', from_moved + to_moved, 'segments_replanned', replanned, 'segments_still_on_superseded_rows', left_);
END
$fn$;
COMMENT ON FUNCTION public.resync_harness_segments(uuid) IS 'Stack SH fold: keeps a vehicle''s harness_segments on live legacy rows after the registry loader supersedes wires and wire ends (successor wire by superseded_by; ends re-matched by plug code; retired wires'' segments superseded; legacy zone-estimate plans refreshed). Idempotent; returns counts. Called by load_map_rows.py after every run.';
REVOKE ALL ON FUNCTION public.resync_harness_segments(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resync_harness_segments(uuid) TO service_role;

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
            WHERE NOT coalesce(c.is_superseded, false) AND c.design_status = 'decided' AND v.is_public IS TRUE)
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
  UNION ALL SELECT g.vehicle_id, 'prediction', 'segments planned shorter than the straight line between their plugs (must be 0)', count(*) FILTER (WHERE g.planned_ft < g.straight_ft), count(*) FILTER (WHERE g.planned_ft IS NOT NULL AND g.straight_ft IS NOT NULL) FROM public.v_harness_segment_geometry g GROUP BY 1
  UNION ALL SELECT w.vehicle_id, 'outcome', 'decided wires with a recorded build step', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.harness_build_events e WHERE e.circuit_id = w.id)), count(*) FROM wires w GROUP BY 1
  UNION ALL SELECT s.vehicle_id, 'fold', 'live segments on superseded legacy rows (must be 0)', count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM public.vehicle_custom_circuits c WHERE c.id = s.vehicle_custom_circuit_id AND coalesce(c.is_superseded, false))
           OR EXISTS (SELECT 1 FROM public.wire_termination_specs t WHERE t.id IN (s.from_termination_id, s.to_termination_id) AND coalesce(t.is_superseded, false))),
         count(*) FROM seg s GROUP BY 1
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
    ('segments with both plugs positioned', 'segments'),
    ('segments planned shorter than the straight line between their plugs (must be 0)', 'segments'),
    ('decided wires with a recorded build step', 'wires'),
    ('live segments on superseded legacy rows (must be 0)', 'segments')) g(measure, grain) ON g.measure = x.measure;

COMMENT ON VIEW public.v_harness_coverage IS 'The harness model measuring itself: per public vehicle, per stack layer, a measure with its numerator and denominator and what they count (grain). RSI scoreboard for stack SH; case ledger 13.12.2 / 13.12.3. Baseline and residual since RSI pass 3; the physics check since net fold v2; the geometry check since pass 7; the build log since pass 8; grain since pass 10; the legacy-row drift check since pass 11.';

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, note) VALUES
  ('SH', 1, 'fold', 'function', 'resync_harness_segments', NULL, 'the model follows superseded wires and wire ends');

DO $check$
DECLARE r jsonb; drift int;
BEGIN
  r := public.resync_harness_segments('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  SELECT numerator INTO drift FROM public.v_harness_coverage
  WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND measure = 'live segments on superseded legacy rows (must be 0)';
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a scoreboard measure has no grain'; END IF;
  RAISE NOTICE 'RSI pass 11: resync on the K5 %; segments on superseded legacy rows: %', r, drift;
END $check$;

COMMIT;
