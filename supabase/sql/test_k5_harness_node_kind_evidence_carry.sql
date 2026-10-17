-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_carry -f supabase/sql/test_k5_harness_node_kind_evidence_carry.sql
-- Proves 20261015180000_k5_harness_node_kind_evidence_carry.sql on top of RSI pass 27:
--   - a plug the loader adds with no node_kind takes the reshape's rule: a splice is a bus, a device is terminals;
--   - a plug that has a kind keeps it (MARKER-LF stays terminals);
--   - a citation on a superseded wire end is copied to the live end of the same wire at the same plug and cavity, and not
--     to an end that moved; the old link stays;
--   - both functions are idempotent and not callable by visitors.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_net_parallel_outputs.sql

-- Two plugs the loader added after net fold v2, with no node_kind.
INSERT INTO public.harness_endpoints (id, design_id, code, endpoint_type) VALUES
  ('00000000-0000-0000-0000-00000000e281', '00000000-0000-0000-0000-0000000000d0', 'SPL-NEW-B16', 'splice'),
  ('00000000-0000-0000-0000-00000000e282', '00000000-0000-0000-0000-0000000000d0', 'DEV-NEW', 'actuator');

-- EV1: a wire the loader re-inserted. Its old row's ends both carry citations; the new row keeps the SW-1 end where it was
-- and moves the other end from the pin onto the splice node.
INSERT INTO public.vehicle_custom_circuits (id, overlay_id, circuit_code, circuit_name, design_status, build_state, from_endpoint_id, to_endpoint_id, planned_length_ft, is_superseded) VALUES
  ('00000000-0000-0000-0000-00000000e0e1', '00000000-0000-0000-0000-0000000000f0', 'EV1', 'cited feed', 'decided', 'uncut',
   '00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000ea', 3.0, true),
  ('00000000-0000-0000-0000-00000000e0e2', '00000000-0000-0000-0000-0000000000f0', 'EV1', 'cited feed', 'decided', 'uncut',
   '00000000-0000-0000-0000-00000000e281', '00000000-0000-0000-0000-0000000000ea', 3.0, false);
UPDATE public.vehicle_custom_circuits SET superseded_by = '00000000-0000-0000-0000-00000000e0e2' WHERE id = '00000000-0000-0000-0000-00000000e0e1';
INSERT INTO public.wire_termination_specs (id, vehicle_id, circuit_id, endpoint_id, cavity, is_superseded) VALUES
  ('00000000-0000-0000-0000-00000000e1e1', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000e0e1', '00000000-0000-0000-0000-0000000000ea', 'common', true),
  ('00000000-0000-0000-0000-00000000e1e2', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000e0e1', '00000000-0000-0000-0000-0000000000e8', 'A16', true),
  ('00000000-0000-0000-0000-00000000e1e3', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000e0e2', '00000000-0000-0000-0000-0000000000ea', 'common', false),
  ('00000000-0000-0000-0000-00000000e1e4', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000e0e2', '00000000-0000-0000-0000-00000000e281', 'splice 1', false);
INSERT INTO public.harness_evidence (vehicle_id, observation_id, row_kind, row_id, field, relation) VALUES
  ('e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-0000000000b1', 'termination', '00000000-0000-0000-0000-00000000e1e1', 'device end', 'supports'),
  ('e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-0000000000b2', 'termination', '00000000-0000-0000-0000-00000000e1e1', 'pull test', 'needs_bench'),
  ('e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-0000000000b1', 'termination', '00000000-0000-0000-0000-00000000e1e2', 'ECU end', 'supports');

\i supabase/migrations/20261015180000_k5_harness_node_kind_evidence_carry.sql

DO $$
DECLARE r jsonb; got text; n int;
BEGIN
  -- The migration's own run classified the two plugs and carried the links; a second run changes nothing.
  r := public.classify_harness_endpoint_nodes('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF (r->>'plugs_given_bus')::int <> 0 OR (r->>'plugs_given_terminals')::int <> 0 THEN RAISE EXCEPTION 'classify not idempotent: %', r; END IF;
  r := public.carry_harness_termination_evidence('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF (r->>'links_carried')::int <> 0 THEN RAISE EXCEPTION 'carry not idempotent: %', r; END IF;

  SELECT string_agg(code || '=' || node_kind, ' ' ORDER BY code) INTO got FROM public.harness_endpoints
  WHERE code IN ('SPL-NEW-B16', 'DEV-NEW', 'MARKER-LF', 'SPL-X', 'SW-1');
  IF got IS DISTINCT FROM 'DEV-NEW=terminals MARKER-LF=terminals SPL-NEW-B16=bus SPL-X=bus SW-1=terminals' THEN RAISE EXCEPTION 'kinds: %', got; END IF;
  SELECT node_kind_basis INTO got FROM public.harness_endpoints WHERE code = 'SPL-NEW-B16';
  IF got NOT LIKE 'reshape v1 rule, applied to a plug the loader added (RSI pass 28)%' THEN RAISE EXCEPTION 'basis: %', got; END IF;

  -- The SW-1 end kept both its citations; the end that moved to the splice got none; the old links stay.
  SELECT string_agg(field || '/' || relation, ' ' ORDER BY field) INTO got FROM public.harness_evidence
  WHERE row_kind = 'termination' AND row_id = '00000000-0000-0000-0000-00000000e1e3';
  IF got IS DISTINCT FROM 'device end/supports pull test/needs_bench' THEN RAISE EXCEPTION 'carried: %', got; END IF;
  SELECT count(*) INTO n FROM public.harness_evidence WHERE row_kind = 'termination' AND row_id = '00000000-0000-0000-0000-00000000e1e4';
  IF n <> 0 THEN RAISE EXCEPTION 'a moved end took % links', n; END IF;
  SELECT count(*) INTO n FROM public.harness_evidence WHERE row_kind = 'termination'
    AND row_id IN ('00000000-0000-0000-0000-00000000e1e1', '00000000-0000-0000-0000-00000000e1e2');
  IF n <> 3 THEN RAISE EXCEPTION 'old links: %', n; END IF;

  IF has_function_privilege('anon', 'public.classify_harness_endpoint_nodes(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.carry_harness_termination_evidence(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can run a pass 28 fold';
  END IF;
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a measure has no grain'; END IF;
END $$;

SELECT 'test_k5_harness_node_kind_evidence_carry: PASS';
