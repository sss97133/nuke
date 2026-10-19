-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_estpad -f supabase/sql/test_k5_harness_estimate_plans_padded.sql
-- Proves 20261015250000_k5_harness_estimate_plans_padded.sql on top of RSI pass 36:
--   - a whole-wire estimate shorter than its segment's route gives way to route x pad, and the method says so;
--   - an estimate longer than the route stands, padded, naming the route; an unrouted estimate is padded;
--   - a plan this rule wrote with no route and no estimate left is cleared to unknown; a tape plan is never touched;
--   - the planner is idempotent, and visitors cannot run it.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_route_writers_relink.sql

\i supabase/migrations/20261015250000_k5_harness_estimate_plans_padded.sql

DO $$
DECLARE r jsonb; got text; n int;
  k5 constant uuid := 'e08bf694-970f-4cbe-8a74-8715158a0f2e';
  rt1 constant uuid := '00000000-0000-0000-0000-0000000a3301';
  rt2 constant uuid := '00000000-0000-0000-0000-0000000a3302';
BEGIN
  -- RT1 runs A-B-C, 45.0 + 39.4 in; its route plan from pass 34 stands
  r := public.plan_harness_segment_lengths(k5);
  SELECT planned_length_ft::text INTO got FROM public.harness_segments WHERE id = rt1;
  IF got <> '8.09' THEN RAISE EXCEPTION 'RT1 route plan: % (%)', got, r; END IF;

  -- 1. the wire's 2.0 ft estimate on its only segment, shorter than the 84.4 in route: the route wins
  UPDATE public.vehicle_custom_circuits SET planned_length_ft = 2.0 WHERE id = '00000000-0000-0000-0000-0000000c3301';
  UPDATE public.harness_segments SET planned_length_ft = 2.0, planned_length_method = 'whole-wire zone estimate from the legacy row (cut list v4.2 basis)'
  WHERE id = rt1;
  SELECT numerator INTO n FROM public.v_harness_coverage WHERE measure = 'routed segments planned shorter than their route (must be 0)';
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'short plan not counted: %', n; END IF;
  r := public.plan_harness_segment_lengths(k5);
  IF (r->>'estimates_shorter_than_their_route')::int <> 1 OR (r->>'segments_replanned')::int <> 1 THEN RAISE EXCEPTION 'short estimate: %', r; END IF;
  SELECT planned_length_ft::text || ' | ' || planned_length_method INTO got FROM public.harness_segments WHERE id = rt1;
  IF got IS DISTINCT FROM '8.09 | route length x pad (RSI pass 34): 84.4 in over 2 branches x 1.15 (body, K5_WIRING_STATE.md row 33); the wire''s 2.0 ft estimate is shorter than its route (RSI pass 39)' THEN
    RAISE EXCEPTION 'RT1 after a short estimate: %', got;
  END IF;
  SELECT numerator INTO n FROM public.v_harness_coverage WHERE measure = 'routed segments planned shorter than their route (must be 0)';
  IF n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'short plans left: %', n; END IF;

  -- 2. an estimate longer than the route stands, padded
  UPDATE public.vehicle_custom_circuits SET planned_length_ft = 10.0 WHERE id = '00000000-0000-0000-0000-0000000c3301';
  r := public.plan_harness_segment_lengths(k5);
  SELECT planned_length_ft::text || ' | ' || planned_length_method INTO got FROM public.harness_segments WHERE id = rt1;
  IF got IS DISTINCT FROM '11.50 | zone estimate x pad (RSI pass 39): the wire''s 10.0 ft estimate x 1.15 (body, K5_WIRING_STATE.md row 33); longer than its route, 84.4 in over 2 branches' THEN
    RAISE EXCEPTION 'RT1 on a long estimate: %', got;
  END IF;

  -- 3. an estimate within the registry's rounding of the route (7.1 ft over 84.4 in) is the route
  UPDATE public.vehicle_custom_circuits SET planned_length_ft = 7.1 WHERE id = '00000000-0000-0000-0000-0000000c3301';
  r := public.plan_harness_segment_lengths(k5);
  SELECT planned_length_ft::text INTO got FROM public.harness_segments WHERE id = rt1;
  IF got <> '8.09' THEN RAISE EXCEPTION 'RT1 on a rounded route: %', got; END IF;

  -- 4. RT2 is not routed: its estimate is padded (engine section, 1.20)
  UPDATE public.vehicle_custom_circuits SET planned_length_ft = 3.0, harness_section = 'engine' WHERE id = '00000000-0000-0000-0000-0000000c3302';
  UPDATE public.harness_segments SET planned_length_ft = 3.0, planned_length_method = 'whole-wire estimate from the wire row' WHERE id = rt2;
  r := public.plan_harness_segment_lengths(k5);
  IF (r->>'segments_on_a_padded_estimate')::int < 1 THEN RAISE EXCEPTION 'padded estimates: %', r; END IF;
  SELECT planned_length_ft::text || ' | ' || planned_length_method INTO got FROM public.harness_segments WHERE id = rt2;
  IF got IS DISTINCT FROM '3.60 | zone estimate x pad (RSI pass 39): the wire''s 3.0 ft estimate x 1.20 (engine bay, K5_WIRING_STATE.md row 33); not routed' THEN
    RAISE EXCEPTION 'RT2 padded: %', got;
  END IF;
  r := public.plan_harness_segment_lengths(k5);
  IF (r->>'segments_planned_from_route')::int + (r->>'segments_replanned')::int + (r->>'plans_cleared')::int <> 0 THEN
    RAISE EXCEPTION 'not idempotent: %', r;
  END IF;

  -- 5. the estimate leaves the wire: the plan this rule wrote is cleared to unknown
  UPDATE public.vehicle_custom_circuits SET planned_length_ft = NULL WHERE id = '00000000-0000-0000-0000-0000000c3302';
  r := public.plan_harness_segment_lengths(k5);
  IF (r->>'plans_cleared')::int <> 1 THEN RAISE EXCEPTION 'clear: %', r; END IF;
  SELECT coalesce(planned_length_ft::text, 'null') || ' | ' || planned_length_method INTO got FROM public.harness_segments WHERE id = rt2;
  IF got IS DISTINCT FROM 'null | unknown: no live route and no whole-wire estimate for this segment (RSI pass 39); it was 3.60' THEN
    RAISE EXCEPTION 'RT2 cleared: %', got;
  END IF;
  r := public.plan_harness_segment_lengths(k5);
  IF (r->>'plans_cleared')::int + (r->>'segments_replanned')::int <> 0 THEN RAISE EXCEPTION 'clear not idempotent: %', r; END IF;

  -- 6. a tape plan is never touched, even shorter than the route
  UPDATE public.harness_segments SET planned_length_ft = 5.0, planned_length_method = 'tape: measured on the truck' WHERE id = rt1;
  r := public.plan_harness_segment_lengths(k5);
  SELECT planned_length_ft::text || ' | ' || planned_length_method INTO got FROM public.harness_segments WHERE id = rt1;
  IF got IS DISTINCT FROM '5.0 | tape: measured on the truck' THEN RAISE EXCEPTION 'tape plan touched: %', got; END IF;

  IF has_function_privilege('anon', 'public.plan_harness_segment_lengths(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'anon can run the planner'; END IF;
  SELECT count(*) INTO n FROM public.v_harness_coverage WHERE grain IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'measures with no grain: %', n; END IF;
END $$;

SELECT 'test_k5_harness_estimate_plans_padded: PASS';
