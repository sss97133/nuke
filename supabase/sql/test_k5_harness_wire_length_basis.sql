-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_basis -f supabase/sql/test_k5_harness_wire_length_basis.sql
-- Proves 20261015270000_k5_harness_wire_length_basis.sql on top of RSI pass 41:
--   - a wire's length carries its kind (checked) and basis;
--   - the planner names the kind: a design lead and a twin path are padded under their own names, a zone estimate keeps
--     the pass 39 wording, a taped wire is never re-planned; the planner stays idempotent and closed to visitors.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_deutsch_tool_catalog.sql

-- production's shape: the planner's input column (the pass 34 fixture adds harness_section)
\i supabase/migrations/20261015270000_k5_harness_wire_length_basis.sql

DO $$
DECLARE r jsonb; got text; n int;
  k5 constant uuid := 'e08bf694-970f-4cbe-8a74-8715158a0f2e';
  rt1 constant uuid := '00000000-0000-0000-0000-0000000a3301';
  rt2 constant uuid := '00000000-0000-0000-0000-0000000a3302';
BEGIN
  BEGIN
    UPDATE public.vehicle_custom_circuits SET planned_length_kind = 'guess' WHERE id = '00000000-0000-0000-0000-0000000c3301';
    RAISE EXCEPTION 'a kind outside the list was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 1. RT2 (not routed, engine section): a 0.33 ft design lead, padded under its own name
  UPDATE public.vehicle_custom_circuits SET planned_length_ft = 0.33, planned_length_kind = 'design',
    planned_length_basis = 'design call: 4 in from the contact to the splice' WHERE id = '00000000-0000-0000-0000-0000000c3302';
  r := public.plan_harness_segment_lengths(k5);
  SELECT planned_length_ft::text || ' | ' || planned_length_method INTO got FROM public.harness_segments WHERE id = rt2;
  IF got IS DISTINCT FROM '0.40 | design length x pad (RSI pass 42): the wire''s 0.33 ft design length x 1.20 (engine bay, K5_WIRING_STATE.md row 33); not routed' THEN
    RAISE EXCEPTION 'RT2 design lead: %', got;
  END IF;

  -- 2. RT1 (routed, 84.4 in): a 10.0 ft twin path, longer than the route, padded under its own name
  UPDATE public.vehicle_custom_circuits SET planned_length_ft = 10.0, planned_length_kind = 'twin' WHERE id = '00000000-0000-0000-0000-0000000c3301';
  UPDATE public.harness_segments SET planned_length_ft = NULL, planned_length_method = NULL WHERE id = rt1;
  r := public.plan_harness_segment_lengths(k5);
  SELECT planned_length_ft::text || ' | ' || planned_length_method INTO got FROM public.harness_segments WHERE id = rt1;
  IF got IS DISTINCT FROM '11.50 | twin path x pad (RSI pass 42): the wire''s 10.0 ft twin path x 1.15 (body, K5_WIRING_STATE.md row 33); longer than its route, 84.4 in over 2 branches' THEN
    RAISE EXCEPTION 'RT1 twin path: %', got;
  END IF;

  -- 3. a zone estimate keeps the pass 39 wording
  UPDATE public.vehicle_custom_circuits SET planned_length_kind = 'estimate' WHERE id = '00000000-0000-0000-0000-0000000c3301';
  r := public.plan_harness_segment_lengths(k5);
  SELECT planned_length_method INTO got FROM public.harness_segments WHERE id = rt1;
  IF got NOT LIKE 'zone estimate x pad (RSI pass 39): the wire''s 10.0 ft estimate x 1.15 (body%' THEN RAISE EXCEPTION 'RT1 estimate: %', got; END IF;

  -- 4. a taped wire is never re-planned, even with no plan on its segment
  UPDATE public.vehicle_custom_circuits SET planned_length_kind = 'tape' WHERE id = '00000000-0000-0000-0000-0000000c3301';
  UPDATE public.harness_segments SET planned_length_ft = NULL, planned_length_method = NULL WHERE id = rt1;
  r := public.plan_harness_segment_lengths(k5);
  SELECT coalesce(planned_length_ft::text, 'null') INTO got FROM public.harness_segments WHERE id = rt1;
  IF got <> 'null' THEN RAISE EXCEPTION 'taped wire re-planned: %', got; END IF;

  r := public.plan_harness_segment_lengths(k5);
  IF (r->>'segments_planned_from_route')::int + (r->>'segments_replanned')::int + (r->>'plans_cleared')::int <> 0 THEN
    RAISE EXCEPTION 'not idempotent: %', r;
  END IF;
  IF has_function_privilege('anon', 'public.plan_harness_segment_lengths(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'anon can run the planner'; END IF;
  SELECT count(*) INTO n FROM public.v_harness_coverage WHERE grain IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'measures with no grain: %', n; END IF;
END $$;

SELECT 'test_k5_harness_wire_length_basis: PASS';
