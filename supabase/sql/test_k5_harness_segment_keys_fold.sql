-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_segkeys -f supabase/sql/test_k5_harness_segment_keys_fold.sql
-- Proves 20261015190000_k5_harness_segment_keys_fold.sql on top of RSI pass 28:
--   - a segment the conform made for a new wire gets the catalog's exact M22759 part for its wire and the option
--     couplings of its plugs;
--   - a key the catalog cannot back is left alone;
--   - the fold is idempotent, and visitors cannot call it.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_node_kind_evidence_carry.sql

-- KP1: a wire the loader added (M22759/32 20 AWG red, M130-B B09 to SW-1), its segment made by the conform with no keys.
-- KQ1: a wire whose colour the catalog has no part for; its segment keeps the key it had.
INSERT INTO public.vehicle_custom_circuits (id, overlay_id, circuit_code, circuit_name, design_status, build_state, wire_type, wire_gauge_awg, wire_color,
                                            from_endpoint_id, to_endpoint_id, planned_length_ft) VALUES
  ('00000000-0000-0000-0000-00000000f0a1', '00000000-0000-0000-0000-0000000000f0', 'KP1', 'new lamp feed', 'decided', 'uncut', 'M22759/32', 20, 'red',
   '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000ea', 2.0),
  ('00000000-0000-0000-0000-00000000f0b1', '00000000-0000-0000-0000-0000000000f0', 'KQ1', 'odd colour', 'decided', 'uncut', 'M22759/32', 20, 'violet/orange',
   '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000ea', 2.0);
INSERT INTO public.wire_termination_specs (id, vehicle_id, circuit_id, endpoint_id, cavity) VALUES
  ('00000000-0000-0000-0000-00000000f1a1', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000f0a1', '00000000-0000-0000-0000-0000000000e1', 'B09'),
  ('00000000-0000-0000-0000-00000000f1a2', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000f0a1', '00000000-0000-0000-0000-0000000000ea', 'lamp'),
  ('00000000-0000-0000-0000-00000000f1b1', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000f0b1', '00000000-0000-0000-0000-0000000000e1', 'B10'),
  ('00000000-0000-0000-0000-00000000f1b2', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000f0b1', '00000000-0000-0000-0000-0000000000ea', 'lamp 2');
INSERT INTO public.harness_nets (id, vehicle_id, net_code, source, method, observed_at, trust) VALUES
  ('00000000-0000-0000-0000-00000000f2a1', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', 'wire KP1', 'fixture', 'fixture', now(), 'fixture'),
  ('00000000-0000-0000-0000-00000000f2b1', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', 'wire KQ1', 'fixture', 'fixture', now(), 'fixture');
INSERT INTO public.harness_segments (id, vehicle_id, net_id, vehicle_custom_circuit_id, from_termination_id, to_termination_id, wire_part_id, planned_length_ft, planned_length_method, design_status, source, method, observed_at, trust) VALUES
  ('00000000-0000-0000-0000-00000000f3a1', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000f2a1', '00000000-0000-0000-0000-00000000f0a1',
   '00000000-0000-0000-0000-00000000f1a1', '00000000-0000-0000-0000-00000000f1a2', NULL, 2.0, 'whole-wire zone estimate', 'decided', 'fixture', 'conform (pass 25)', now(), 'fixture'),
  ('00000000-0000-0000-0000-00000000f3b1', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000f2b1', '00000000-0000-0000-0000-00000000f0b1',
   '00000000-0000-0000-0000-00000000f1b1', '00000000-0000-0000-0000-00000000f1b2',
   (SELECT id FROM public.catalog_parts WHERE part_number = 'M22759/32-20-2' ORDER BY id LIMIT 1), 2.0, 'whole-wire zone estimate', 'decided', 'fixture', 'reshape', now(), 'fixture');

\i supabase/migrations/20261015190000_k5_harness_segment_keys_fold.sql

DO $$
DECLARE r jsonb; got text; n int;
BEGIN
  r := public.key_harness_segments('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF (r->>'segments_keyed_to_a_part')::int <> 0 OR (r->>'segments_rekeyed')::int <> 0 OR (r->>'option_links_added')::int <> 0 THEN
    RAISE EXCEPTION 'not idempotent: %', r;
  END IF;

  SELECT cp.part_number INTO got FROM public.harness_segments s JOIN public.catalog_parts cp ON cp.id = s.wire_part_id
  WHERE s.id = '00000000-0000-0000-0000-00000000f3a1';
  IF got IS DISTINCT FROM 'M22759/32-20-2' THEN RAISE EXCEPTION 'KP1 part: %', got; END IF;
  SELECT cp.part_number INTO got FROM public.harness_segments s JOIN public.catalog_parts cp ON cp.id = s.wire_part_id
  WHERE s.id = '00000000-0000-0000-0000-00000000f3b1';
  IF got IS DISTINCT FROM 'M22759/32-20-2' THEN RAISE EXCEPTION 'KQ1 kept part: %', got; END IF;

  -- M130-B is coupled with option dd01 in the fixture: the new segment carries it.
  SELECT string_agg(decision_id::text || '/' || relation, ' ') INTO got FROM public.wiring_decision_links
  WHERE segment_id = '00000000-0000-0000-0000-00000000f3a1';
  IF got IS DISTINCT FROM '00000000-0000-0000-0000-00000000dd01/coupled_with' THEN RAISE EXCEPTION 'KP1 links: %', got; END IF;

  IF has_function_privilege('anon', 'public.key_harness_segments(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'anon can run the fold'; END IF;
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a measure has no grain'; END IF;
END $$;

SELECT 'test_k5_harness_segment_keys_fold: PASS';
