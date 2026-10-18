-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_refold -f supabase/sql/test_k5_harness_net_refold_shared_pins.sql
-- Proves 20261015033000_k5_harness_net_refold_shared_pins.sql on top of RSI pass 13: two decided wires in one PDM pin
-- become one net (old nets superseded and pointing at it, segments re-pointed, protection re-folded), while 61-pin
-- contacts F and f, two lugs described alike on a stud plug, and a contradicted wire on the same pin stay apart; the
-- occupancy view counts the shared pin; the refold is idempotent.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_pdm15_pin_map_protection_fold.sql

INSERT INTO public.harness_endpoints (id, design_id, code, name, endpoint_type, location_zone, node_kind) VALUES
  ('00000000-0000-0000-0000-00000000e0aa', '00000000-0000-0000-0000-0000000000d0', 'AMP-BLOCK', 'amplifier studs', 'connector', 'rear', 'terminals');
INSERT INTO public.vehicle_custom_circuits (id, overlay_id, circuit_code, circuit_name, design_status, build_state, from_component) VALUES
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000f0', 'TP1', 'marker 1', 'decided', 'uncut', 'PDM30:OUT9 (A2)'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000f0', 'TP2', 'marker 2', 'decided', 'uncut', 'PDM30:OUT9 (A2)'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000f0', 'TQ1', 'sensor f', 'decided', 'uncut', NULL),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000000f0', 'TQ2', 'coil F', 'decided', 'uncut', NULL),
  ('00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-0000000000f0', 'TR1', 'amp power tail', 'decided', 'uncut', NULL),
  ('00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-0000000000f0', 'TR2', 'amp ground tail', 'decided', 'uncut', NULL),
  ('00000000-0000-0000-0000-00000000d007', '00000000-0000-0000-0000-0000000000f0', 'TC1', 'old marker', 'contradicted', 'uncut', NULL);
INSERT INTO public.wire_termination_specs (id, vehicle_id, circuit_id, endpoint_id, cavity) VALUES
  ('00000000-0000-0000-0000-0000000d0011', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000e8', 'A02'),
  ('00000000-0000-0000-0000-0000000d0021', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000e8', 'A2'),
  ('00000000-0000-0000-0000-0000000d0031', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000e3', 'f'),
  ('00000000-0000-0000-0000-0000000d0041', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000000e3', 'F'),
  ('00000000-0000-0000-0000-0000000d0051', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-00000000e0aa', 'stud, lug DL438'),
  ('00000000-0000-0000-0000-0000000d0061', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-00000000e0aa', 'stud, lug DL438'),
  ('00000000-0000-0000-0000-0000000d0071', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000d007', '00000000-0000-0000-0000-0000000000e8', 'A2');
INSERT INTO public.harness_nets (id, vehicle_id, net_code, source, method, observed_at, trust)
SELECT ('00000000-0000-0000-0000-0000000b' || lpad(i::text, 4, '0'))::uuid, 'e08bf694-970f-4cbe-8a74-8715158a0f2e', code, 'fixture', 'fixture', now(), 'fixture'
FROM (VALUES (1, 'TP1'), (2, 'TP2'), (3, 'TQ1'), (4, 'TQ2'), (5, 'TR1'), (6, 'TR2'), (7, 'TC1')) v(i, code);
INSERT INTO public.harness_segments (vehicle_id, net_id, vehicle_custom_circuit_id, from_termination_id, to_termination_id, design_status, source, method, observed_at, trust)
SELECT 'e08bf694-970f-4cbe-8a74-8715158a0f2e', ('00000000-0000-0000-0000-0000000b' || lpad(i::text, 4, '0'))::uuid, w::uuid, t::uuid, NULL, ds, 'fixture', 'fixture', now(), 'fixture'
FROM (VALUES (1, '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000d0011', 'decided'),
             (2, '00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000d0021', 'decided'),
             (3, '00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000d0031', 'decided'),
             (4, '00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000d0041', 'decided'),
             (5, '00000000-0000-0000-0000-00000000d005', '00000000-0000-0000-0000-0000000d0051', 'decided'),
             (6, '00000000-0000-0000-0000-00000000d006', '00000000-0000-0000-0000-0000000d0061', 'decided'),
             (7, '00000000-0000-0000-0000-00000000d007', '00000000-0000-0000-0000-0000000d0071', 'contradicted')) v(i, w, t, ds);

\i supabase/migrations/20261015033000_k5_harness_net_refold_shared_pins.sql

DO $$
DECLARE got text; n int; r jsonb; merged uuid;
BEGIN
  SELECT string_agg(c.circuit_code || '>' || n2.net_code, ' ' ORDER BY c.circuit_code COLLATE "C") INTO got
  FROM public.harness_segments s JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
  JOIN public.harness_nets n2 ON n2.id = s.net_id
  WHERE NOT s.is_superseded AND c.circuit_code IN ('TP1', 'TP2', 'TQ1', 'TQ2', 'TR1', 'TR2', 'TC1');
  IF got IS DISTINCT FROM 'TC1>TC1 TP1>PDM30-A A2 TP2>PDM30-A A2 TQ1>TQ1 TQ2>TQ2 TR1>TR1 TR2>TR2' THEN RAISE EXCEPTION 'nets after the refold: %', got; END IF;
  SELECT id INTO merged FROM public.harness_nets WHERE net_code = 'PDM30-A A2' AND NOT is_superseded;
  SELECT string_agg(net_code || ':' || is_superseded || ':' || (superseded_by = merged), ' ' ORDER BY net_code) INTO got
  FROM public.harness_nets WHERE id IN ('00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000b0002');
  IF got IS DISTINCT FROM 'TP1:true:true TP2:true:true' THEN RAISE EXCEPTION 'old nets: %', got; END IF;
  SELECT count(*) INTO n FROM public.harness_signals g JOIN public.harness_nets n2 ON n2.signal_id = g.id WHERE n2.id = merged AND NOT g.is_superseded;
  IF n <> 1 THEN RAISE EXCEPTION 'the merged net has % live signal(s)', n; END IF;
  SELECT replace(u.model, 'MoTeC ', '') || ' OUT' || ch.channel_number INTO got
  FROM public.harness_nets n2 JOIN public.pdm_channels ch ON ch.id = n2.protection_pdm_channel_id JOIN public.pdm_units u ON u.id = ch.pdm_unit_id
  WHERE n2.id = merged;
  IF got IS DISTINCT FROM 'PDM30 OUT9' THEN RAISE EXCEPTION 'merged net protection: %', got; END IF;
  SELECT plug || ' ' || cavity || ' x' || wires INTO got FROM public.v_harness_pin_occupancy WHERE plug = 'PDM30-A' AND cavity = 'A2';
  IF got IS DISTINCT FROM 'PDM30-A A2 x2' THEN RAISE EXCEPTION 'occupancy: %', got; END IF;
  IF EXISTS (SELECT 1 FROM public.v_harness_pin_occupancy WHERE plug = 'AMP-BLOCK') THEN RAISE EXCEPTION 'a stud lug counted as a pin'; END IF;
  SELECT string_agg(cavity || ' x' || wires, ' ' ORDER BY cavity COLLATE "C") INTO got FROM public.v_harness_pin_occupancy WHERE plug = 'FIREWALL-CABIN' AND cavity IN ('f', 'F');
  IF got IS DISTINCT FROM 'F x1 f x1' THEN RAISE EXCEPTION '61-pin contacts: %', got; END IF;
  SELECT numerator INTO n FROM public.v_harness_coverage WHERE measure LIKE 'pin cavities shared by several wires%';
  IF n < 1 THEN RAISE EXCEPTION 'shared pin cavities on the scoreboard: %', n; END IF;
  SELECT numerator INTO n FROM public.v_harness_coverage WHERE measure = 'nets that join a supply to ground (must be 0)';
  IF n <> 0 THEN RAISE EXCEPTION 'supply joined to ground: %', n; END IF;
  SELECT count(*) INTO n FROM public.v_harness_coverage;
  IF n <> 27 THEN RAISE EXCEPTION 'scoreboard measures: %, want 27', n; END IF;
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a measure has no grain'; END IF;

  r := public.refold_harness_nets('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF (r->>'nets_superseded')::int + (r->>'nets_created')::int + (r->>'segments_repointed')::int <> 0 THEN RAISE EXCEPTION 'not idempotent: %', r; END IF;

  -- A wire end that leaves the shared pin splits the node again.
  UPDATE public.wire_termination_specs SET cavity = 'A3' WHERE id = '00000000-0000-0000-0000-0000000d0021';
  r := public.refold_harness_nets('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF (r->>'nets_superseded')::int <> 1 OR (r->>'nets_created')::int <> 2 THEN RAISE EXCEPTION 'split: %', r; END IF;
  SELECT string_agg(c.circuit_code || '>' || n2.net_code, ' ' ORDER BY c.circuit_code COLLATE "C") INTO got
  FROM public.harness_segments s JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id JOIN public.harness_nets n2 ON n2.id = s.net_id
  WHERE NOT s.is_superseded AND c.circuit_code IN ('TP1', 'TP2');
  IF got IS DISTINCT FROM 'TP1>TP1 TP2>TP2' THEN RAISE EXCEPTION 'after the split: %', got; END IF;

  IF has_function_privilege('anon', 'public.refold_harness_nets(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'the public can run the refold'; END IF;
  IF has_table_privilege('anon', 'public.v_harness_pin_occupancy', 'INSERT') THEN RAISE EXCEPTION 'the occupancy view keeps a public write grant'; END IF;
  SELECT count(*) INTO n FROM public.stack_needs WHERE stack_id = 'SH';
  IF n <> 32 THEN RAISE EXCEPTION 'SH needs: %, want 32', n; END IF;
END $$;

SELECT 'test_k5_harness_net_refold_shared_pins: PASS' AS result;
