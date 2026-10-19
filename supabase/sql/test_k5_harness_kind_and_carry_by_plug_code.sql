-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_bycode -f supabase/sql/test_k5_harness_kind_and_carry_by_plug_code.sql
-- Proves 20261015210000_k5_harness_kind_and_carry_by_plug_code.sql on top of RSI pass 31:
--   - a re-inserted ground-typed plug that was terminals by evidence stays terminals (the generic rule would make it a
--     bus), with the kept basis;
--   - a plug with no history still takes the generic rule;
--   - a citation follows its wire end onto the re-inserted plug (new row id, same code, same cavity).
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_topology_points_writer.sql

-- GND-KEEP: terminals by evidence, then re-inserted by the loader with no kind. GND-NEW: a ground plug with no history.
INSERT INTO public.harness_endpoints (id, design_id, code, endpoint_type, node_kind, node_kind_basis, is_superseded) VALUES
  ('00000000-0000-0000-0000-0000000e3201', '00000000-0000-0000-0000-0000000000d0', 'GND-KEEP', 'ground', 'terminals', 'evidence: a lamp socket with two leads', true),
  ('00000000-0000-0000-0000-0000000e3202', '00000000-0000-0000-0000-0000000000d0', 'GND-KEEP', 'ground', NULL, NULL, false),
  ('00000000-0000-0000-0000-0000000e3203', '00000000-0000-0000-0000-0000000000d0', 'GND-NEW', 'ground', NULL, NULL, false),
  -- DEV-RI: a device plug the loader re-inserted (its position changed)
  ('00000000-0000-0000-0000-0000000e3211', '00000000-0000-0000-0000-0000000000d0', 'DEV-RI', 'actuator', 'terminals', 'reshape v1 rule', true),
  ('00000000-0000-0000-0000-0000000e3212', '00000000-0000-0000-0000-0000000000d0', 'DEV-RI', 'actuator', 'terminals', 'reshape v1 rule', false);

-- EV2: its old row ended at DEV-RI's old row with a citation; its new row ends at DEV-RI's new row, same cavity.
INSERT INTO public.vehicle_custom_circuits (id, overlay_id, circuit_code, circuit_name, design_status, build_state, from_endpoint_id, to_endpoint_id, planned_length_ft, is_superseded) VALUES
  ('00000000-0000-0000-0000-0000000c3201', '00000000-0000-0000-0000-0000000000f0', 'EV2', 'cited lamp feed', 'decided', 'uncut',
   '00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000e3211', 3.0, true),
  ('00000000-0000-0000-0000-0000000c3202', '00000000-0000-0000-0000-0000000000f0', 'EV2', 'cited lamp feed', 'decided', 'uncut',
   '00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000e3212', 3.0, false);
INSERT INTO public.wire_termination_specs (id, vehicle_id, circuit_id, endpoint_id, cavity, is_superseded) VALUES
  ('00000000-0000-0000-0000-0000000d3201', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-0000000c3201', '00000000-0000-0000-0000-0000000e3211', 'p1', true),
  ('00000000-0000-0000-0000-0000000d3202', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-0000000c3202', '00000000-0000-0000-0000-0000000e3212', 'p1', false);
INSERT INTO public.harness_evidence (vehicle_id, observation_id, row_kind, row_id, field, relation) VALUES
  ('e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-0000000000b1', 'termination', '00000000-0000-0000-0000-0000000d3201', 'device end', 'supports');

\i supabase/migrations/20261015210000_k5_harness_kind_and_carry_by_plug_code.sql

DO $$
DECLARE r jsonb; got text; n int;
BEGIN
  SELECT node_kind || ' | ' || node_kind_basis INTO got FROM public.harness_endpoints WHERE id = '00000000-0000-0000-0000-0000000e3202';
  IF got IS DISTINCT FROM 'terminals | kept from this plug''s previous row (RSI pass 32): evidence: a lamp socket with two leads' THEN
    RAISE EXCEPTION 'GND-KEEP: %', got;
  END IF;
  SELECT node_kind INTO got FROM public.harness_endpoints WHERE id = '00000000-0000-0000-0000-0000000e3203';
  IF got IS DISTINCT FROM 'bus' THEN RAISE EXCEPTION 'GND-NEW: %', got; END IF;

  SELECT count(*) INTO n FROM public.harness_evidence WHERE row_kind = 'termination' AND row_id = '00000000-0000-0000-0000-0000000d3202'
    AND field = 'device end' AND relation = 'supports';
  IF n <> 1 THEN RAISE EXCEPTION 'EV2 citation did not follow onto the re-inserted plug (% links)', n; END IF;

  r := public.classify_harness_endpoint_nodes('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF (r->>'plugs_given_bus')::int + (r->>'plugs_given_terminals')::int <> 0 THEN RAISE EXCEPTION 'classify not idempotent: %', r; END IF;
  r := public.carry_harness_termination_evidence('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF (r->>'links_carried')::int <> 0 THEN RAISE EXCEPTION 'carry not idempotent: %', r; END IF;
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a measure has no grain'; END IF;
END $$;

SELECT 'test_k5_harness_kind_and_carry_by_plug_code: PASS';
