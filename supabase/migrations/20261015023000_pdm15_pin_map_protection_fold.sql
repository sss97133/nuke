-- RSI pass 13 on the harness model: the PDM15's pin map comes from MoTeC's manual, and net protection is a fold that
-- checks itself against the design. Case ledger 13.12.3.
--
-- device_pin_maps held a PDM15 pinout that was never MoTeC's: 37 rows, "A1..A15 = Output 1..15", A16 "Battery +12V
-- Supply", A17 "Ground A (0V)", B1..B16 "Switch Input 1..16". The MoTeC PDM user manual, printed p.43 (PDM15)
-- (reference_documents/component_drawings/motec_pdm_user_manual.pdf), says otherwise. Connector A is 34-pin and
-- connector B 26-pin. Each 20 A output is a pin pair: OUT1 A1+A10, OUT2 A3+A12, OUT3 A5+A14, OUT4 A7+A16, OUT5 A9+A17,
-- OUT6 B3+B9, OUT7 B5+B11, OUT8 B7+B13. The 8 A outputs sit between them: OUT9 A2, OUT10 A4, OUT11 A6, OUT12 A8,
-- OUT13 A11, OUT14 A13, OUT15 A15. Battery negative is A26 and B18, 0 V is A28 and B22, CAN is B25/B26, and the inputs
-- are spread over A19-A34 and B15-B24. 21 of the 37 rows named the wrong function and 24 pins had no row. The PDM30
-- rows already agree with p.44.
--
-- RSI pass 1 pointed each net at the PDM output its wire end lands on, through this map. Measured read-only 2026-10-15
-- on the K5: of the 63 decided wires whose design names a PDM output (vehicle_custom_circuits.from_component, written
-- by the registry loader), 50 agreed with the protecting output, 9 PDM15 wires were protected by another output
-- (INJ_PWR, the PDM15 OUT2 rail feed, was "protected" by OUT3), and 4 had no protection, because they have no wire ends
-- and so no pin to read. With p.43, 59 agree, 0 disagree, and the 4 have only the design's word.
--
-- This pass:
--   1. The PDM15 pinout per p.43: 36 rows corrected or renamed (each note keeps what the row said), 24 rows added; the
--      PDM30 naming (OUTn, OUTn_A/_B for a 20 A pair, DIGn, VBATT_NEG_A/B, GND_0V_A/B, CAN_LO/HI). The M6 stud row
--      (Battery +) stands. The PDM15 channel notes name their real pins.
--   2. fold_harness_net_protection(vehicle): each live net's PDM output comes from a wire end on an output pin (the pin
--      map); a net with no such pin takes the one output its wires' design names; a net with neither loses a stale
--      pointer. Idempotent; service role; the loader calls it after every run.
--   3. The scoreboard: "PDM-fed wires whose net is protected by another output (must be 0)", the design against the
--      fold. It would have read 9 + 4 = 13 of 63 before this pass.
-- Programmed limits and loads per output (the registry's pdm_settings) are the next pass; this one makes the pointer
-- they hang on correct.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF to_regprocedure('public.key_harness_endpoints_to_topology(uuid)') IS NULL THEN
    RAISE EXCEPTION 'RSI pass 12 (20261015013000) has not run';
  END IF;
  IF to_regprocedure('public.fold_harness_net_protection(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'fold_harness_net_protection already exists';
  END IF;
END $guard$;

-- 1. The PDM15 pinout, MoTeC PDM user manual printed p.43. (connector, pin, function, signal type, amps, the manual's words)
CREATE TEMP TABLE pass13_pins (connector_name text, pin_number text, pin_function text, signal_type text,
  max_current_amps numeric, manual_text text) ON COMMIT DROP;
INSERT INTO pass13_pins VALUES
  ('Connector_A', 'A1', 'OUT1_A', 'high_current_output', 20, '20 A Output 1 (with A10)'),
  ('Connector_A', 'A2', 'OUT9', 'standard_output', 8, '8 A Output 9'),
  ('Connector_A', 'A3', 'OUT2_A', 'high_current_output', 20, '20 A Output 2 (with A12)'),
  ('Connector_A', 'A4', 'OUT10', 'standard_output', 8, '8 A Output 10'),
  ('Connector_A', 'A5', 'OUT3_A', 'high_current_output', 20, '20 A Output 3 (with A14)'),
  ('Connector_A', 'A6', 'OUT11', 'standard_output', 8, '8 A Output 11'),
  ('Connector_A', 'A7', 'OUT4_A', 'high_current_output', 20, '20 A Output 4 (with A16)'),
  ('Connector_A', 'A8', 'OUT12', 'standard_output', 8, '8 A Output 12'),
  ('Connector_A', 'A9', 'OUT5_A', 'high_current_output', 20, '20 A Output 5 (with A17)'),
  ('Connector_A', 'A10', 'OUT1_B', 'high_current_output', 20, '20 A Output 1 (with A1)'),
  ('Connector_A', 'A11', 'OUT13', 'standard_output', 8, '8 A Output 13'),
  ('Connector_A', 'A12', 'OUT2_B', 'high_current_output', 20, '20 A Output 2 (with A3)'),
  ('Connector_A', 'A13', 'OUT14', 'standard_output', 8, '8 A Output 14'),
  ('Connector_A', 'A14', 'OUT3_B', 'high_current_output', 20, '20 A Output 3 (with A5)'),
  ('Connector_A', 'A15', 'OUT15', 'standard_output', 8, '8 A Output 15'),
  ('Connector_A', 'A16', 'OUT4_B', 'high_current_output', 20, '20 A Output 4 (with A7)'),
  ('Connector_A', 'A17', 'OUT5_B', 'high_current_output', 20, '20 A Output 5 (with A9)'),
  ('Connector_A', 'A18', 'NC', 'unused', NULL, 'Not used'),
  ('Connector_A', 'A19', 'DIG2', 'switch_input', NULL, 'Digital/Switch Input 2'),
  ('Connector_A', 'A20', 'NC', 'unused', NULL, 'Not used'),
  ('Connector_A', 'A21', 'DIG4', 'switch_input', NULL, 'Digital/Switch Input 4'),
  ('Connector_A', 'A22', 'NC', 'unused', NULL, 'Not used'),
  ('Connector_A', 'A23', 'DIG7', 'switch_input', NULL, 'Digital/Switch Input 7'),
  ('Connector_A', 'A24', 'NC', 'unused', NULL, 'Not used'),
  ('Connector_A', 'A25', 'NC', 'unused', NULL, 'Not used'),
  ('Connector_A', 'A26', 'VBATT_NEG_A', 'power_ground', NULL, 'Battery Negative'),
  ('Connector_A', 'A27', 'DIG1', 'switch_input', NULL, 'Digital/Switch Input 1'),
  ('Connector_A', 'A28', 'GND_0V_A', 'logic_ground', NULL, '0 V'),
  ('Connector_A', 'A29', 'DIG3', 'switch_input', NULL, 'Digital/Switch Input 3'),
  ('Connector_A', 'A30', 'DIG5', 'switch_input', NULL, 'Digital/Switch Input 5'),
  ('Connector_A', 'A31', 'DIG6', 'switch_input', NULL, 'Digital/Switch Input 6'),
  ('Connector_A', 'A32', 'DIG8', 'switch_input', NULL, 'Digital/Switch Input 8'),
  ('Connector_A', 'A33', 'DIG9', 'switch_input', NULL, 'Digital/Switch Input 9'),
  ('Connector_A', 'A34', 'DIG10', 'switch_input', NULL, 'Digital/Switch Input 10'),
  ('Connector_B', 'B1', 'NC', 'unused', NULL, 'Not used'),
  ('Connector_B', 'B2', 'NC', 'unused', NULL, 'Not used'),
  ('Connector_B', 'B3', 'OUT6_A', 'high_current_output', 20, '20 A Output 6 (with B9)'),
  ('Connector_B', 'B4', 'NC', 'unused', NULL, 'Not used'),
  ('Connector_B', 'B5', 'OUT7_A', 'high_current_output', 20, '20 A Output 7 (with B11)'),
  ('Connector_B', 'B6', 'NC', 'unused', NULL, 'Not used'),
  ('Connector_B', 'B7', 'OUT8_A', 'high_current_output', 20, '20 A Output 8 (with B13)'),
  ('Connector_B', 'B8', 'NC', 'unused', NULL, 'Not used'),
  ('Connector_B', 'B9', 'OUT6_B', 'high_current_output', 20, '20 A Output 6 (with B3)'),
  ('Connector_B', 'B10', 'NC', 'unused', NULL, 'Not used'),
  ('Connector_B', 'B11', 'OUT7_B', 'high_current_output', 20, '20 A Output 7 (with B5)'),
  ('Connector_B', 'B12', 'NC', 'unused', NULL, 'Not used'),
  ('Connector_B', 'B13', 'OUT8_B', 'high_current_output', 20, '20 A Output 8 (with B7)'),
  ('Connector_B', 'B14', 'NC', 'unused', NULL, 'Not used'),
  ('Connector_B', 'B15', 'DIG13', 'switch_input', NULL, 'Digital/Switch Input 13'),
  ('Connector_B', 'B16', 'NC', 'unused', NULL, 'Not used'),
  ('Connector_B', 'B17', 'DIG15', 'switch_input', NULL, 'Digital/Switch Input 15'),
  ('Connector_B', 'B18', 'VBATT_NEG_B', 'power_ground', NULL, 'Battery Negative'),
  ('Connector_B', 'B19', 'NC', 'unused', NULL, 'Not used'),
  ('Connector_B', 'B20', 'DIG11', 'switch_input', NULL, 'Digital/Switch Input 11'),
  ('Connector_B', 'B21', 'DIG12', 'switch_input', NULL, 'Digital/Switch Input 12'),
  ('Connector_B', 'B22', 'GND_0V_B', 'logic_ground', NULL, '0 V'),
  ('Connector_B', 'B23', 'DIG14', 'switch_input', NULL, 'Digital/Switch Input 14'),
  ('Connector_B', 'B24', 'DIG16', 'switch_input', NULL, 'Digital/Switch Input 16'),
  ('Connector_B', 'B25', 'CAN_LO', 'can_bus', NULL, 'CAN Low'),
  ('Connector_B', 'B26', 'CAN_HI', 'can_bus', NULL, 'CAN High');

UPDATE public.device_pin_maps d
SET pin_function = p.pin_function, signal_type = p.signal_type, max_current_amps = p.max_current_amps,
    source_document = 'MoTeC PDM user manual p.43 (PDM15 pinout), reference_documents/component_drawings/motec_pdm_user_manual.pdf',
    notes = 'Manual p.43: "' || p.manual_text || '".'
            || CASE WHEN coalesce(substring(d.pin_function FROM '^Output ([0-9]+)'), d.pin_function) = coalesce(substring(p.pin_function FROM '^OUT([0-9]+)'), p.pin_function)
                    THEN ' Renamed 2026-10-15 from "' || d.pin_function || '".'
                    ELSE ' Corrected 2026-10-15 (RSI pass 13); this row said "' || d.pin_function || '".' END
FROM pass13_pins p
WHERE d.device_model = 'PDM15' AND d.connector_name = p.connector_name AND d.pin_number = p.pin_number
  AND d.firmware_version IS NULL;

INSERT INTO public.device_pin_maps (device_family, device_model, connector_name, connector_type, pin_count, pin_number,
  pin_function, signal_type, max_current_amps, source_document, notes)
SELECT 'pdm', 'PDM15', p.connector_name,
       CASE p.connector_name WHEN 'Connector_A' THEN 'amp_superseal_34' ELSE 'amp_superseal_26' END,
       CASE p.connector_name WHEN 'Connector_A' THEN 34 ELSE 26 END,
       p.pin_number, p.pin_function, p.signal_type, p.max_current_amps,
       'MoTeC PDM user manual p.43 (PDM15 pinout), reference_documents/component_drawings/motec_pdm_user_manual.pdf',
       'Manual p.43: "' || p.manual_text || '". Added 2026-10-15 (RSI pass 13).'
FROM pass13_pins p
WHERE NOT EXISTS (SELECT 1 FROM public.device_pin_maps d WHERE d.device_model = 'PDM15' AND d.connector_name = p.connector_name
                    AND d.pin_number = p.pin_number AND d.firmware_version IS NULL);

-- Every PDM15 unit has a channel per output, and each channel names its real pins.
INSERT INTO public.pdm_channels (pdm_unit_id, channel_number, channel_group_name, fuse_rating_amps, notes)
SELECT u.id, o.n, 'OUT' || o.n, o.amps, 'output pins per the MoTeC PDM user manual p.43: ' || o.pins || ' (RSI pass 13)'
FROM public.pdm_units u
CROSS JOIN (SELECT substring(pin_function FROM '^OUT([0-9]+)')::int AS n, max(max_current_amps) AS amps,
                   string_agg(pin_number, ' + ' ORDER BY length(pin_number), pin_number) AS pins
            FROM pass13_pins WHERE pin_function ~ '^OUT[0-9]+' GROUP BY 1) o
WHERE u.model = 'MoTeC PDM15'
  AND NOT EXISTS (SELECT 1 FROM public.pdm_channels ch WHERE ch.pdm_unit_id = u.id AND ch.channel_number = o.n);
UPDATE public.pdm_channels ch
SET notes = 'output pins per the MoTeC PDM user manual p.43: ' || o.pins || '; rating = the output''s class, ' || o.amps
            || ' A. RSI pass 13 corrected the pins (pass 1 read a PDM15 map that was not MoTeC''s).'
FROM public.pdm_units u,
     (SELECT substring(pin_function FROM '^OUT([0-9]+)')::int AS n, max(max_current_amps) AS amps,
             string_agg(pin_number, ' + ' ORDER BY length(pin_number), pin_number) AS pins
      FROM pass13_pins WHERE pin_function ~ '^OUT[0-9]+' GROUP BY 1) o
WHERE u.model = 'MoTeC PDM15' AND ch.pdm_unit_id = u.id AND ch.channel_number = o.n
  AND ch.notes NOT LIKE 'output pins per the MoTeC PDM user manual p.43%';

-- 2. The design against the fold: per decided wire whose design names a PDM output, the output its net is protected by.
CREATE VIEW public.v_harness_pdm_protection_check AS
WITH w AS (
  SELECT o.vehicle_id, c.id AS wire_id, c.circuit_code,
         coalesce(substring(c.from_component FROM '(PDM15|PDM30):OUT[0-9]+'), substring(c.from_component FROM 'SPL-(PDM15|PDM30)-OUT[0-9]+'))
           || ' OUT' || coalesce(substring(c.from_component FROM '(?:PDM15|PDM30):OUT([0-9]+)'), substring(c.from_component FROM 'SPL-(?:PDM15|PDM30)-OUT([0-9]+)')) AS declared_output
  FROM public.vehicle_custom_circuits c
  JOIN public.vehicle_wiring_overlays o ON o.id = c.overlay_id
  JOIN public.vehicles v ON v.id = o.vehicle_id AND v.is_public IS TRUE
  WHERE NOT coalesce(c.is_superseded, false) AND c.design_status = 'decided'
    AND c.from_component ~ '(PDM15|PDM30):OUT[0-9]+|SPL-(PDM15|PDM30)-OUT[0-9]+')
SELECT w.vehicle_id, w.wire_id, w.circuit_code, w.declared_output, p.protected_by,
       coalesce(p.protected_by = w.declared_output, false) AS agrees
FROM w
LEFT JOIN LATERAL (
  SELECT string_agg(DISTINCT replace(u.model, 'MoTeC ', '') || ' OUT' || ch.channel_number, ', ') AS protected_by
  FROM public.harness_segments s
  JOIN public.harness_nets n ON n.id = s.net_id AND NOT n.is_superseded
  JOIN public.pdm_channels ch ON ch.id = n.protection_pdm_channel_id
  JOIN public.pdm_units u ON u.id = ch.pdm_unit_id
  WHERE s.vehicle_custom_circuit_id = w.wire_id AND NOT s.is_superseded) p ON true;
COMMENT ON VIEW public.v_harness_pdm_protection_check IS 'Per decided wire of a public vehicle whose design names a PDM output (vehicle_custom_circuits.from_component, written by the registry loader): the output its net is protected by after the fold, and whether they agree. RSI pass 13, case ledger 13.12.3.';
REVOKE ALL ON public.v_harness_pdm_protection_check FROM anon, authenticated;
GRANT SELECT ON public.v_harness_pdm_protection_check TO anon, authenticated;

-- 3. Protection as a fold.
CREATE FUNCTION public.fold_harness_net_protection(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE added int; repointed int; cleared int; from_pin int; from_design int; conflicts int;
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

  SELECT count(*) INTO conflicts FROM public.v_harness_pdm_protection_check
  WHERE vehicle_id = p_vehicle_id AND NOT agrees;
  RETURN jsonb_build_object('nets_protected_from_a_pin', from_pin, 'nets_protected_from_the_design', from_design,
                            'protection_added', added, 'protection_repointed', repointed, 'protection_cleared', cleared,
                            'wires_disagreeing_with_the_design', conflicts);
END $fn$;
COMMENT ON FUNCTION public.fold_harness_net_protection(uuid) IS 'Points each live net of the vehicle at the PDM output that protects it: a wire end on an output pin (device_pin_maps), else the one output its wires'' design names, else none. Idempotent; returns counts and the design disagreements left. The registry loader calls it after every run. RSI pass 13, case ledger 13.12.3.';
REVOKE ALL ON FUNCTION public.fold_harness_net_protection(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fold_harness_net_protection(uuid) TO service_role;

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
    ('PDM-fed wires not protected by the output the design names (must be 0)', 'wires')) g(measure, grain) ON g.measure = x.measure;

COMMENT ON VIEW public.v_harness_coverage IS 'The harness model measuring itself: per public vehicle, per stack layer, a measure with its numerator and denominator and what they count (grain). RSI scoreboard for stack SH; case ledger 13.12.2 / 13.12.3. Baseline and residual since RSI pass 3; the physics check since net fold v2; the geometry check since pass 7; the build log since pass 8; grain since pass 10; the legacy-row drift check since pass 11; route-graph points and standing positions since pass 12; PDM protection against the design since pass 13.';

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, note) VALUES
  ('SH', 1, 'dimension', 'table', 'device_pin_maps', NULL, 'each device pin''s function, cited to the maker''s pinout'),
  ('SH', 1, 'fold', 'function', 'fold_harness_net_protection', NULL, 'net protection re-derived from pins and the design after every run'),
  ('SH', 1, 'residual', 'table', 'v_harness_pdm_protection_check', NULL, 'the design''s PDM output against the folded protection');

DO $check$
DECLARE r jsonb; n_rows int; n_out int; n_outputs int; short_ int; left_ int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE pin_function ~ '^OUT[0-9]+'), count(DISTINCT substring(pin_function FROM '^OUT([0-9]+)'))
    INTO n_rows, n_out, n_outputs FROM public.device_pin_maps WHERE device_model = 'PDM15' AND firmware_version IS NULL;
  IF n_out <> 23 OR n_outputs <> 15 THEN
    RAISE EXCEPTION 'PDM15 pin map: % output pins over % outputs, want 23 over 15 (p.43)', n_out, n_outputs;
  END IF;
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a scoreboard measure has no grain'; END IF;
  r := public.fold_harness_net_protection('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  SELECT numerator INTO short_ FROM public.v_harness_coverage
  WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND measure = 'nets that join a supply to ground (must be 0)';
  SELECT numerator INTO left_ FROM public.v_harness_coverage
  WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND measure = 'PDM-fed wires not protected by the output the design names (must be 0)';
  RAISE NOTICE 'RSI pass 13 on the K5: PDM15 pin rows %; protection %; supply joined to ground %; PDM-fed wires off their output %', n_rows, r, short_, left_;
END $check$;

COMMIT;
