-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_routelen -f supabase/sql/test_k5_harness_route_length_plan.sql
-- Proves 20261015230000_k5_harness_route_length_plan.sql on top of RSI pass 33:
--   - a routed segment with no plan gets route x pad (1.15 outside the engine section) with a method naming both;
--   - a plan from the cut list is never touched; a plan shorter than its route is counted by the scoreboard;
--   - a changed route re-plans only the plans this rule wrote; the planner is idempotent.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_branches_and_routing.sql

-- production's shape: wires carry their harness section (the registry loader writes it)
ALTER TABLE public.vehicle_custom_circuits ADD COLUMN IF NOT EXISTS harness_section text;

\i supabase/migrations/20261015230000_k5_harness_route_length_plan.sql

DO $$
DECLARE r jsonb; got text; n int;
BEGIN
  -- RT1 runs A-B-C after the redraw: 39.4 + 39.4 in, no plan before this pass.
  SELECT planned_length_ft::text || ' | ' || planned_length_method INTO got FROM public.harness_segments WHERE id = '00000000-0000-0000-0000-0000000a3301';
  IF got IS DISTINCT FROM '7.55 | route length x pad (RSI pass 34): 78.8 in over 2 branches x 1.15 (body, K5_WIRING_STATE.md row 33)' THEN
    RAISE EXCEPTION 'RT1 plan: %', got;
  END IF;
  r := public.plan_harness_segment_lengths('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF (r->>'segments_planned_from_route')::int + (r->>'segments_replanned')::int <> 0 THEN RAISE EXCEPTION 'not idempotent: %', r; END IF;

  -- a cut-list plan shorter than the route: kept, and counted
  UPDATE public.harness_segments SET planned_length_ft = 2.0, planned_length_method = 'whole-wire zone estimate from the legacy row (cut list v4.2 basis)'
  WHERE id = '00000000-0000-0000-0000-0000000a3301';
  r := public.plan_harness_segment_lengths('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  SELECT planned_length_ft::text INTO got FROM public.harness_segments WHERE id = '00000000-0000-0000-0000-0000000a3301';
  IF got <> '2.0' THEN RAISE EXCEPTION 'cut-list plan touched: %', got; END IF;
  SELECT numerator INTO n FROM public.v_harness_coverage WHERE measure = 'routed segments planned shorter than their route (must be 0)';
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'short-plan measure: %', n; END IF;

  -- back to a route plan; a rerouted path re-plans it
  UPDATE public.harness_segments SET planned_length_ft = NULL, planned_length_method = NULL WHERE id = '00000000-0000-0000-0000-0000000a3301';
  r := public.plan_harness_segment_lengths('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  r := public.load_harness_branches('e08bf694-970f-4cbe-8a74-8715158a0f2e',
         '[{"code": "RTB_AB", "from": "RT_A", "to": "RT_B", "polyline_m": [[0,0,0],[0.5,0.2,0],[1,0,0]], "length_in": 45.0, "method": "fixture study"}]', 'fixture 3');
  r := public.route_harness_segments('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  r := public.plan_harness_segment_lengths('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF (r->>'segments_replanned')::int < 1 THEN RAISE EXCEPTION 're-plan: %', r; END IF;
  SELECT planned_length_ft::text INTO got FROM public.harness_segments WHERE id = '00000000-0000-0000-0000-0000000a3301';
  IF got <> '8.09' THEN RAISE EXCEPTION 'RT1 re-plan: %', got; END IF;

  IF has_function_privilege('anon', 'public.plan_harness_segment_lengths(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'anon can run the planner'; END IF;
  SELECT count(*) INTO n FROM public.v_harness_coverage WHERE grain IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'measures with no grain: %', n; END IF;
END $$;

SELECT 'test_k5_harness_route_length_plan: PASS';
