-- RSI pass 15 on the harness model: each PDM output's programmed limit and cited load land in the model, and the nets
-- it protects carry them. Case ledger 13.12.3.
--
-- A PDM output's limit is its fuse: the PDM trips the output above the programmed current. The registry computes one
-- per output (docs/wiring/calc-data/reconcile_v5.py pdm_settings: at least 1.25 x the cited running current, at most
-- 0.85 x the ampacity of the thinnest conductor it feeds, in whole amps, 8 A outputs <= 10 A and 20 A outputs <= 25 A,
-- MoTeC PDM manual pp.24, 36, 48) and writes it to k5_registry.json "pdm_settings": 39 outputs, 20 set, 18 open (each
-- naming the current it still needs, e.g. "needs the horn current") and 1 conflict (PDM30 OUT21 needs 12 A; an 8 A
-- output's setting caps at 10 A). None of it was in the model: pdm_channels.fuse_rating_amps holds the pins' hardware
-- class (8 or 20 A), harness_nets.protection_setting_a was empty on all 338 nets, and 12 nets had a load (the DC
-- primary's physics sizing), none of them PDM-fed.
--
-- This pass:
--   1. pdm_channels gains max_current_setting_a (the programmed limit), load_a (the cited running current of everything
--      the output feeds), setting_status (set | open | conflict), setting_basis (the registry's source and verdict),
--      setting_loads (the wires it feeds), setting_source and setting_observed_at.
--   2. load_pdm_settings(vehicle, rows, source) writes them from the registry's rows (the loader passes
--      reg["pdm_settings"] after every run), clears channels the rows no longer name, then re-folds protection.
--      Idempotent; service role.
--   3. fold_harness_net_protection carries them to nets: protection_setting_a from the protecting channel when it is
--      set; nominal_current_a when every wire the output feeds sits in that net (pass 14 made each multi-load output one
--      net). A load split over several nets is not divided.
--   4. The scoreboard: PDM-fed nets with a programmed limit, PDM-fed nets with a load, PDM outputs still waiting on a
--      cited load current (the evidence backlog), and PDM outputs whose load needs more than the output or its wire
--      allows (must be 0).
-- The rows arrive by the loader's call, not in this migration: the registry is the design's record and the loader its
-- writer.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF to_regprocedure('public.refold_harness_nets(uuid)') IS NULL THEN
    RAISE EXCEPTION 'RSI pass 14 (20261015033000) has not run';
  END IF;
  IF to_regprocedure('public.load_pdm_settings(uuid,jsonb,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'load_pdm_settings already exists';
  END IF;
END $guard$;

-- 1. The design's settings, per channel.
ALTER TABLE public.pdm_channels
  ADD COLUMN max_current_setting_a numeric CHECK (max_current_setting_a IS NULL OR max_current_setting_a > 0),
  ADD COLUMN load_a numeric CHECK (load_a IS NULL OR load_a >= 0),
  ADD COLUMN setting_status text CHECK (setting_status IN ('set', 'open', 'conflict')),
  ADD COLUMN setting_basis text,
  ADD COLUMN setting_loads text[],
  ADD COLUMN setting_source text,
  ADD COLUMN setting_observed_at timestamptz;
COMMENT ON COLUMN public.pdm_channels.max_current_setting_a IS 'The output''s programmed current limit, amps: the PDM trips the output above it (its fuse). From the design (k5_registry.json pdm_settings via load_pdm_settings). Null when the design has not set it.';
COMMENT ON COLUMN public.pdm_channels.load_a IS 'The cited running current of everything the output (or output pair) feeds, amps, with its source in setting_basis. Null: not cited yet.';
COMMENT ON COLUMN public.pdm_channels.setting_status IS 'set: the limit stands; open: a load current is still needed (setting_basis names it); conflict: the load needs more than the output or its thinnest conductor allows.';
COMMENT ON COLUMN public.pdm_channels.setting_basis IS 'The design''s source for the load and its verdict on the limit, verbatim from the registry.';
COMMENT ON COLUMN public.pdm_channels.setting_loads IS 'The wire codes (vehicle_custom_circuits.circuit_code) the output feeds, per the design.';
COMMENT ON COLUMN public.pdm_channels.setting_source IS 'Where the settings came from, e.g. k5_registry.json pdm_settings @ <commit>.';

-- 2. The writer.
CREATE FUNCTION public.load_pdm_settings(p_vehicle_id uuid, p_rows jsonb, p_source text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE r jsonb; box text; nums int[]; st text; written int := 0; n int; cleared int; unmatched int := 0; named int[]; prot jsonb;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'p_rows must be a JSON array of pdm_settings rows'; END IF;
  CREATE TEMP TABLE IF NOT EXISTS load_pdm_named (channel_id uuid PRIMARY KEY) ON COMMIT DROP;
  TRUNCATE load_pdm_named;
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    box := substring(r->>'output' FROM '^(PDM[0-9]+)');
    nums := ARRAY(SELECT m[1]::int FROM regexp_matches(r->>'output', 'OUT([0-9]+)', 'g') m);
    st := CASE WHEN r->>'status' LIKE 'set%' THEN 'set' WHEN r->>'status' LIKE 'OPEN%' THEN 'open'
               WHEN r->>'status' LIKE 'CONFLICT%' THEN 'conflict' END;
    IF box IS NULL OR cardinality(nums) = 0 OR st IS NULL THEN unmatched := unmatched + 1; CONTINUE; END IF;
    INSERT INTO load_pdm_named
    SELECT ch.id FROM public.pdm_channels ch JOIN public.pdm_units u ON u.id = ch.pdm_unit_id
    WHERE u.vehicle_id = p_vehicle_id AND u.model = 'MoTeC ' || box AND ch.channel_number = ANY (nums)
    ON CONFLICT DO NOTHING;
    UPDATE public.pdm_channels ch
    SET max_current_setting_a = CASE WHEN st = 'set' THEN (r->>'limit_a')::numeric END,
        load_a = (r->>'load_a')::numeric,
        setting_status = st,
        setting_basis = left(coalesce(r->>'source', '') || ' | ' || coalesce(r->>'status', ''), 2000),
        setting_loads = ARRAY(SELECT jsonb_array_elements_text(r->'loads')),
        setting_source = p_source, setting_observed_at = now()
    FROM public.pdm_units u
    WHERE u.id = ch.pdm_unit_id AND u.vehicle_id = p_vehicle_id AND u.model = 'MoTeC ' || box AND ch.channel_number = ANY (nums)
      AND (ch.max_current_setting_a IS DISTINCT FROM CASE WHEN st = 'set' THEN (r->>'limit_a')::numeric END
           OR ch.load_a IS DISTINCT FROM (r->>'load_a')::numeric OR ch.setting_status IS DISTINCT FROM st
           OR ch.setting_basis IS DISTINCT FROM left(coalesce(r->>'source', '') || ' | ' || coalesce(r->>'status', ''), 2000)
           OR ch.setting_loads IS DISTINCT FROM ARRAY(SELECT jsonb_array_elements_text(r->'loads')));
    GET DIAGNOSTICS n = ROW_COUNT;
    written := written + n;
    IF NOT EXISTS (SELECT 1 FROM public.pdm_channels ch JOIN public.pdm_units u ON u.id = ch.pdm_unit_id
                   WHERE u.vehicle_id = p_vehicle_id AND u.model = 'MoTeC ' || box AND ch.channel_number = ANY (nums)) THEN
      unmatched := unmatched + 1;
    END IF;
  END LOOP;
  UPDATE public.pdm_channels ch
  SET max_current_setting_a = NULL, load_a = NULL, setting_status = NULL, setting_basis = NULL, setting_loads = NULL,
      setting_source = p_source, setting_observed_at = now()
  FROM public.pdm_units u
  WHERE u.id = ch.pdm_unit_id AND u.vehicle_id = p_vehicle_id AND ch.setting_status IS NOT NULL
    AND ch.id NOT IN (SELECT channel_id FROM load_pdm_named);
  GET DIAGNOSTICS cleared = ROW_COUNT;
  prot := public.fold_harness_net_protection(p_vehicle_id);
  RETURN jsonb_build_object('rows', jsonb_array_length(p_rows), 'channels_written', written, 'channels_cleared', cleared,
                            'rows_unmatched', unmatched, 'protection', prot);
END $fn$;
COMMENT ON FUNCTION public.load_pdm_settings(uuid, jsonb, text) IS 'Writes the design''s PDM output settings (k5_registry.json pdm_settings rows: output, loads, load_a, limit_a, status, source) onto the vehicle''s pdm_channels, clears channels the rows no longer name, and re-folds net protection. Idempotent; returns counts. The registry loader calls it after every run. RSI pass 15, case ledger 13.12.3.';
REVOKE ALL ON FUNCTION public.load_pdm_settings(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.load_pdm_settings(uuid, jsonb, text) TO service_role;

-- 3. The protection fold carries limits and loads.
CREATE OR REPLACE FUNCTION public.fold_harness_net_protection(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE added int; repointed int; cleared int; from_pin int; from_design int; conflicts int; limited int;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS fold_protection_target (net_id uuid PRIMARY KEY, channel_id uuid, basis text, by_pin boolean) ON COMMIT DROP;
  TRUNCATE fold_protection_target;
  WITH nets AS (SELECT id FROM public.harness_nets WHERE vehicle_id = p_vehicle_id AND NOT is_superseded),
  pin AS (
    SELECT DISTINCT ON (s.net_id) s.net_id, ch.id AS channel_id,
           e.code || ' ' || t.cavity || ' = ' || p.pin_function AS basis
    FROM public.harness_segments s
    JOIN public.wire_termination_specs t ON t.id IN (s.from_termination_id, s.to_termination_id) AND NOT coalesce(t.is_superseded, false)
    JOIN public.harness_endpoints e ON e.id = t.endpoint_id AND e.code ~ '^PDM(15|30)-[AB]$'
    JOIN public.device_pin_maps p ON p.device_model = split_part(e.code, '-', 1) AND p.firmware_version IS NULL
         AND regexp_replace(upper(p.pin_number), '^([A-Z]+)0*([0-9]+)$', '\1\2') = regexp_replace(upper(t.cavity), '^([A-Z]+)0*([0-9]+)$', '\1\2')
         AND coalesce(substring(p.pin_function FROM '^OUT([0-9]+)'), substring(p.pin_function FROM '^Output ([0-9]+)')) IS NOT NULL
    JOIN public.pdm_units u ON u.vehicle_id = s.vehicle_id AND u.model = 'MoTeC ' || p.device_model
    JOIN public.pdm_channels ch ON ch.pdm_unit_id = u.id
         AND ch.channel_number = coalesce(substring(p.pin_function FROM '^OUT([0-9]+)'), substring(p.pin_function FROM '^Output ([0-9]+)'))::int
    WHERE s.vehicle_id = p_vehicle_id AND NOT s.is_superseded AND s.net_id IN (SELECT id FROM nets)
    ORDER BY s.net_id, ch.fuse_rating_amps DESC NULLS LAST, ch.channel_number),
  design AS (
    SELECT s.net_id, min(ch.id::text)::uuid AS channel_id, count(DISTINCT ch.id) AS n_outputs,
           string_agg(DISTINCT c.circuit_code || ' from ' || d.box || ':OUT' || d.n, ', ') AS basis
    FROM public.harness_segments s
    JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
    CROSS JOIN LATERAL (SELECT coalesce(substring(c.from_component FROM '(PDM15|PDM30):OUT[0-9]+'), substring(c.from_component FROM 'SPL-(PDM15|PDM30)-OUT[0-9]+')) AS box,
                               coalesce(substring(c.from_component FROM '(?:PDM15|PDM30):OUT([0-9]+)'), substring(c.from_component FROM 'SPL-(?:PDM15|PDM30)-OUT([0-9]+)'))::int AS n) d
    JOIN public.pdm_units u ON u.vehicle_id = s.vehicle_id AND u.model = 'MoTeC ' || d.box
    JOIN public.pdm_channels ch ON ch.pdm_unit_id = u.id AND ch.channel_number = d.n
    WHERE s.vehicle_id = p_vehicle_id AND NOT s.is_superseded AND s.net_id IN (SELECT id FROM nets) AND d.box IS NOT NULL
    GROUP BY s.net_id)
  INSERT INTO fold_protection_target (net_id, channel_id, basis, by_pin)
  SELECT n.id,
         coalesce(pin.channel_id, CASE WHEN design.n_outputs = 1 THEN design.channel_id END),
         CASE WHEN pin.channel_id IS NOT NULL THEN 'the PDM output pin (' || pin.basis || ')'
              WHEN design.n_outputs = 1 THEN 'the output the design names (' || design.basis || '); no wire end lands on a PDM pin' END,
         pin.channel_id IS NOT NULL
  FROM nets n LEFT JOIN pin ON pin.net_id = n.id LEFT JOIN design ON design.net_id = n.id;

  SELECT count(*) FILTER (WHERE by_pin), count(*) FILTER (WHERE channel_id IS NOT NULL AND NOT by_pin) INTO from_pin, from_design
  FROM fold_protection_target;

  UPDATE public.harness_nets n SET protection_pdm_channel_id = f.channel_id,
         method = n.method || '; protection (RSI pass 13 fold): ' || f.basis
  FROM fold_protection_target f
  WHERE n.id = f.net_id AND f.channel_id IS NOT NULL AND n.protection_pdm_channel_id IS NULL;
  GET DIAGNOSTICS added = ROW_COUNT;
  UPDATE public.harness_nets n SET protection_pdm_channel_id = f.channel_id,
         method = n.method || '; protection re-pointed (RSI pass 13 fold): ' || f.basis
  FROM fold_protection_target f
  WHERE n.id = f.net_id AND f.channel_id IS NOT NULL AND n.protection_pdm_channel_id IS DISTINCT FROM f.channel_id;
  GET DIAGNOSTICS repointed = ROW_COUNT;
  UPDATE public.harness_nets n SET protection_pdm_channel_id = NULL,
         method = n.method || '; protection cleared (RSI pass 13 fold): no wire end on a PDM output pin and no output named by its wires'
  FROM fold_protection_target f
  WHERE n.id = f.net_id AND f.channel_id IS NULL AND n.protection_pdm_channel_id IS NOT NULL;
  GET DIAGNOSTICS cleared = ROW_COUNT;

  -- Limit and load from the protecting channel (RSI pass 15): the programmed limit when the output is set; the cited
  -- load when every wire the output feeds sits in this net (a load split over several nets is not divided).
  UPDATE public.harness_nets n
  SET protection_setting_a = x.setting,
      nominal_current_a = coalesce(x.load, CASE WHEN n.method LIKE '%limit and load (RSI pass 15)%' THEN NULL ELSE n.nominal_current_a END),
      method = n.method || '; limit and load (RSI pass 15): ' || x.basis
  FROM (
    SELECT n2.id,
           CASE WHEN ch.setting_status = 'set' THEN ch.max_current_setting_a END AS setting,
           CASE WHEN ch.load_a IS NOT NULL AND cardinality(ch.setting_loads) > 0
                 AND NOT EXISTS (SELECT 1 FROM unnest(ch.setting_loads) lw(code)
                                 WHERE NOT EXISTS (SELECT 1 FROM public.harness_segments s
                                                   JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
                                                   WHERE s.net_id = n2.id AND NOT s.is_superseded AND c.circuit_code = lw.code))
                THEN ch.load_a END AS load,
           replace(u.model, 'MoTeC ', '') || ' OUT' || ch.channel_number || ' ' || coalesce(ch.setting_status, 'not in the design''s settings')
             || coalesce(', limit ' || ch.max_current_setting_a || ' A', '') || coalesce(', load ' || ch.load_a || ' A', '') AS basis
    FROM public.harness_nets n2
    JOIN public.pdm_channels ch ON ch.id = n2.protection_pdm_channel_id
    JOIN public.pdm_units u ON u.id = ch.pdm_unit_id
    WHERE n2.vehicle_id = p_vehicle_id AND NOT n2.is_superseded) x
  WHERE n.id = x.id
    AND (n.protection_setting_a IS DISTINCT FROM x.setting
         OR (x.load IS NOT NULL AND n.nominal_current_a IS DISTINCT FROM x.load)
         OR (x.load IS NULL AND n.method LIKE '%limit and load (RSI pass 15)%' AND n.nominal_current_a IS NOT NULL));
  GET DIAGNOSTICS limited = ROW_COUNT;

  SELECT count(*) INTO conflicts FROM public.v_harness_pdm_protection_check
  WHERE vehicle_id = p_vehicle_id AND NOT agrees;
  RETURN jsonb_build_object('nets_protected_from_a_pin', from_pin, 'nets_protected_from_the_design', from_design,
                            'protection_added', added, 'protection_repointed', repointed, 'protection_cleared', cleared,
                            'nets_given_limit_or_load', limited, 'wires_disagreeing_with_the_design', conflicts);
END $fn$;

-- 4. The scoreboard.
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
    ('PDM outputs whose load needs more than the output or its wire allows (must be 0)', 'PDM outputs')) g(measure, grain) ON g.measure = x.measure;

COMMENT ON VIEW public.v_harness_coverage IS 'The harness model measuring itself: per public vehicle, per stack layer, a measure with its numerator and denominator and what they count (grain). RSI scoreboard for stack SH; case ledger 13.12.2 / 13.12.3. Baseline and residual since RSI pass 3; the physics check since net fold v2; the geometry check since pass 7; the build log since pass 8; grain since pass 10; the legacy-row drift check since pass 11; route-graph points and standing positions since pass 12; PDM protection against the design since pass 13; shared pin cavities since pass 14; PDM limits and loads since pass 15.';

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, note) VALUES
  ('SH', 1, 'prediction', 'column', 'pdm_channels.max_current_setting_a', NULL, 'each PDM output''s programmed limit, from the design'),
  ('SH', 1, 'log', 'column', 'pdm_channels.load_a', NULL, 'each PDM output''s cited running current'),
  ('SH', 1, 'fold', 'function', 'load_pdm_settings', NULL, 'the design''s PDM settings written after every loader run');

DO $check$
DECLARE r jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a scoreboard measure has no grain'; END IF;
  r := public.fold_harness_net_protection('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  RAISE NOTICE 'RSI pass 15 on the K5: protection fold %; settings arrive with the loader''s next call to load_pdm_settings', r;
END $check$;

COMMIT;
