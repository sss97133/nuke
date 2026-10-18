-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_pdm15 -f supabase/sql/test_k5_pdm15_pin_map_protection_fold.sql
-- Proves 20261015023000_pdm15_pin_map_protection_fold.sql on top of RSI pass 12: the PDM15 pinout follows MoTeC's
-- manual p.43 (corrected rows keep what they said), a net on pin A9 moves from OUT9 to OUT5, a net with no wire ends
-- takes the output its wire's design names, a stale pointer with no basis is cleared, the scoreboard counts the
-- design against the fold, and the fold is idempotent.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_topology_standing.sql

-- The live shape of device_pin_maps (the shim has four columns) and the design column the registry loader writes.
ALTER TABLE public.device_pin_maps ADD COLUMN device_family text, ADD COLUMN connector_name text, ADD COLUMN connector_type text,
  ADD COLUMN pin_count integer, ADD COLUMN signal_type text, ADD COLUMN source_document text, ADD COLUMN notes text,
  ADD COLUMN firmware_version text;
UPDATE public.device_pin_maps SET device_family = 'pdm', connector_name = 'Connector_A', connector_type = 'fixture', pin_count = 34;
ALTER TABLE public.vehicle_custom_circuits ADD COLUMN IF NOT EXISTS from_component text;

-- A PDM15 plug and three wires, each with its own net, as pass 1 left them: W5 lands on A9, which the old map called
-- Output 9; W9 has no wire ends and names PDM30 OUT9; WX carries a pointer with no basis.
INSERT INTO public.harness_endpoints (id, design_id, code, name, endpoint_type, location_zone) VALUES
  ('00000000-0000-0000-0000-00000000e015', '00000000-0000-0000-0000-0000000000d0', 'PDM15-A', 'PDM15 A', 'ecu', 'engine');
INSERT INTO public.vehicle_custom_circuits (id, overlay_id, circuit_code, circuit_name, design_status, build_state, from_component) VALUES
  ('00000000-0000-0000-0000-00000000c005', '00000000-0000-0000-0000-0000000000f0', 'W5', 'fuel pump feed', 'decided', 'uncut', 'SPL-PDM15-OUT5 (PDM15:OUT5 pigtails A9 + A17)'),
  ('00000000-0000-0000-0000-00000000c009', '00000000-0000-0000-0000-0000000000f0', 'W9', 'wiper feed', 'decided', 'uncut', 'PDM30:OUT9 (A2)'),
  ('00000000-0000-0000-0000-00000000c0ff', '00000000-0000-0000-0000-0000000000f0', 'WX', 'switch return', 'decided', 'uncut', 'SW-1');
INSERT INTO public.wire_termination_specs (id, vehicle_id, circuit_id, endpoint_id, cavity) VALUES
  ('00000000-0000-0000-0000-0000000c0051', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000c005', '00000000-0000-0000-0000-00000000e015', 'A9'),
  ('00000000-0000-0000-0000-0000000c0052', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000c005', '00000000-0000-0000-0000-0000000000e7', NULL);
INSERT INTO public.harness_nets (id, vehicle_id, net_code, source, method, observed_at, trust, protection_pdm_channel_id) VALUES
  ('00000000-0000-0000-0000-0000000a0005', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', 'W5', 'fixture', 'fixture', now(), 'fixture',
   (SELECT ch.id FROM public.pdm_channels ch JOIN public.pdm_units u ON u.id = ch.pdm_unit_id WHERE u.model = 'MoTeC PDM15' AND ch.channel_number = 9)),
  ('00000000-0000-0000-0000-0000000a0009', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', 'W9', 'fixture', 'fixture', now(), 'fixture', NULL),
  ('00000000-0000-0000-0000-0000000a00ff', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', 'WX', 'fixture', 'fixture', now(), 'fixture',
   (SELECT ch.id FROM public.pdm_channels ch JOIN public.pdm_units u ON u.id = ch.pdm_unit_id WHERE u.model = 'MoTeC PDM30' AND ch.channel_number = 1));
INSERT INTO public.harness_segments (vehicle_id, net_id, vehicle_custom_circuit_id, from_termination_id, to_termination_id, design_status, source, method, observed_at, trust) VALUES
  ('e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-0000000a0005', '00000000-0000-0000-0000-00000000c005',
   '00000000-0000-0000-0000-0000000c0051', '00000000-0000-0000-0000-0000000c0052', 'decided', 'fixture', 'fixture', now(), 'fixture'),
  ('e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-0000000a0009', '00000000-0000-0000-0000-00000000c009',
   NULL, NULL, 'decided', 'fixture', 'fixture', now(), 'fixture'),
  ('e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-0000000a00ff', '00000000-0000-0000-0000-00000000c0ff',
   NULL, NULL, 'decided', 'fixture', 'fixture', now(), 'fixture');

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.pdm_channels ch JOIN public.pdm_units u ON u.id = ch.pdm_unit_id WHERE u.model = 'MoTeC PDM15';
  IF n <> 2 THEN RAISE EXCEPTION 'fixture: pass 1 should have made PDM15 channels 1 and 9 only, got %', n; END IF;
END $$;

\i supabase/migrations/20261015023000_pdm15_pin_map_protection_fold.sql

DO $$
DECLARE got text; n int; r jsonb;
BEGIN
  -- The pinout, p.43.
  SELECT string_agg(pin_number || '=' || pin_function, ' ' ORDER BY length(pin_number), pin_number) INTO got
  FROM public.device_pin_maps WHERE device_model = 'PDM15' AND pin_number IN ('A1', 'A2', 'A9', 'A10', 'A17', 'A26', 'B3', 'B22', 'B25', 'B1');
  IF got IS DISTINCT FROM 'A1=OUT1_A A2=OUT9 A9=OUT5_A B1=NC B3=OUT6_A A10=OUT1_B A17=OUT5_B A26=VBATT_NEG_A B22=GND_0V_B B25=CAN_LO' THEN
    RAISE EXCEPTION 'PDM15 pins: %', got;
  END IF;
  SELECT count(*) INTO n FROM public.device_pin_maps WHERE device_model = 'PDM15';
  IF n <> 60 THEN RAISE EXCEPTION 'PDM15 rows: %, want 60 (the fixture has no M6 stud row)', n; END IF;
  SELECT notes INTO got FROM public.device_pin_maps WHERE device_model = 'PDM15' AND pin_number = 'A9';
  IF got IS DISTINCT FROM 'Manual p.43: "20 A Output 5 (with A17)". Corrected 2026-10-15 (RSI pass 13); this row said "Output 9 (Low Current)".' THEN
    RAISE EXCEPTION 'A9 note: %', got;
  END IF;
  SELECT notes INTO got FROM public.device_pin_maps WHERE device_model = 'PDM15' AND pin_number = 'A1';
  IF got NOT LIKE '%Renamed 2026-10-15 from "Output 1 (High Side)".' THEN RAISE EXCEPTION 'A1 note: %', got; END IF;
  SELECT count(*) INTO n FROM public.pdm_channels ch JOIN public.pdm_units u ON u.id = ch.pdm_unit_id WHERE u.model = 'MoTeC PDM15';
  IF n <> 15 THEN RAISE EXCEPTION 'PDM15 channels: %, want 15', n; END IF;
  SELECT ch.notes INTO got FROM public.pdm_channels ch JOIN public.pdm_units u ON u.id = ch.pdm_unit_id WHERE u.model = 'MoTeC PDM15' AND ch.channel_number = 5;
  IF got IS DISTINCT FROM 'output pins per the MoTeC PDM user manual p.43: A9 + A17 (RSI pass 13)' THEN RAISE EXCEPTION 'OUT5 channel note: %', got; END IF;

  -- The fold.
  SELECT string_agg(n2.net_code || '>' || coalesce(replace(u.model, 'MoTeC ', '') || ' OUT' || ch.channel_number, '-'), ' ' ORDER BY n2.net_code COLLATE "C") INTO got
  FROM public.harness_nets n2 LEFT JOIN public.pdm_channels ch ON ch.id = n2.protection_pdm_channel_id LEFT JOIN public.pdm_units u ON u.id = ch.pdm_unit_id
  WHERE n2.net_code IN ('W5', 'W9', 'WX');
  IF got IS DISTINCT FROM 'W5>PDM15 OUT5 W9>PDM30 OUT9 WX>-' THEN RAISE EXCEPTION 'protection after the fold: %', got; END IF;
  SELECT method INTO got FROM public.harness_nets WHERE net_code = 'W9';
  IF got NOT LIKE '%the output the design names (W9 from PDM30:OUT9); no wire end lands on a PDM pin' THEN RAISE EXCEPTION 'W9 basis: %', got; END IF;
  SELECT string_agg(circuit_code || ':' || declared_output || '/' || coalesce(protected_by, '-') || '/' || agrees, ' ' ORDER BY circuit_code COLLATE "C") INTO got
  FROM public.v_harness_pdm_protection_check;
  IF got IS DISTINCT FROM 'W5:PDM15 OUT5/PDM15 OUT5/true W9:PDM30 OUT9/PDM30 OUT9/true' THEN RAISE EXCEPTION 'check view: %', got; END IF;
  SELECT numerator || '/' || denominator INTO got FROM public.v_harness_coverage
  WHERE measure = 'PDM-fed wires not protected by the output the design names (must be 0)';
  IF got IS DISTINCT FROM '0/2' THEN RAISE EXCEPTION 'scoreboard: %', got; END IF;
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a measure has no grain'; END IF;
  SELECT count(*) INTO n FROM public.v_harness_coverage;
  IF n <> 26 THEN RAISE EXCEPTION 'scoreboard measures: %, want 26', n; END IF;

  r := public.fold_harness_net_protection('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF (r->>'protection_added')::int + (r->>'protection_repointed')::int + (r->>'protection_cleared')::int <> 0 THEN
    RAISE EXCEPTION 'the fold is not idempotent: %', r;
  END IF;
  IF (r->>'wires_disagreeing_with_the_design')::int <> 0 THEN RAISE EXCEPTION 'disagreements left: %', r; END IF;

  -- A wire end that moves to another output pin re-points its net; the check sees the disagreement with the design.
  UPDATE public.wire_termination_specs SET cavity = 'A2' WHERE id = '00000000-0000-0000-0000-0000000c0051';
  r := public.fold_harness_net_protection('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF (r->>'protection_repointed')::int <> 1 OR (r->>'wires_disagreeing_with_the_design')::int <> 1 THEN RAISE EXCEPTION 'moved end: %', r; END IF;
  SELECT protected_by INTO got FROM public.v_harness_pdm_protection_check WHERE circuit_code = 'W5';
  IF got IS DISTINCT FROM 'PDM15 OUT9' THEN RAISE EXCEPTION 'moved end protected by %', got; END IF;

  IF has_function_privilege('anon', 'public.fold_harness_net_protection(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'the public can run the fold'; END IF;
  IF has_table_privilege('anon', 'public.v_harness_pdm_protection_check', 'INSERT') THEN RAISE EXCEPTION 'the check view keeps a public write grant'; END IF;
  SELECT count(*) INTO n FROM public.stack_needs WHERE stack_id = 'SH';
  IF n <> 30 THEN RAISE EXCEPTION 'SH needs: %, want 30', n; END IF;
END $$;

SELECT 'test_k5_pdm15_pin_map_protection_fold: PASS' AS result;
