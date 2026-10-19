-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_relink -f supabase/sql/test_k5_harness_route_writers_relink.sql
-- Proves 20261015240000_k5_harness_route_writers_relink.sql on top of RSI pass 34:
--   - a point loaded again with the same coordinates and new words keeps its row;
--   - a branch whose end point's row was re-written is re-linked in place on the next load, not refused;
--   - a branch drawn back to geometry it had before loads with a revision mark.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_route_length_plan.sql

\i supabase/migrations/20261015240000_k5_harness_route_writers_relink.sql

DO $$
DECLARE r jsonb; got text; n int; old_b uuid; new_b uuid; br jsonb;
BEGIN
  -- 1. same coordinates, new words: unchanged
  r := public.load_harness_topology_points('e08bf694-970f-4cbe-8a74-8715158a0f2e',
         '[{"node_code": "RT_B", "kind": "breakout", "x": 1, "y": 0, "z": 0, "pos_source": "fixture B, said differently"}]', 'fixture');
  IF r->>'points_unchanged' <> '1' THEN RAISE EXCEPTION 'same point re-written: %', r; END IF;

  -- 2. RT_B's row re-written by hand (as the pass 31 writer did on new words); the branch loader re-links
  SELECT id INTO old_b FROM public.harness_topology_nodes WHERE node_code = 'RT_B' AND NOT is_superseded;
  new_b := gen_random_uuid();
  UPDATE public.harness_topology_nodes SET is_superseded = true WHERE id = old_b;
  INSERT INTO public.harness_topology_nodes (id, vehicle_id, node_code, kind, pos_x_m, pos_y_m, pos_z_m, pos_source, source, method, observed_at, trust)
  VALUES (new_b, 'e08bf694-970f-4cbe-8a74-8715158a0f2e', 'RT_B', 'breakout', 1, 0, 0, 'fixture B again', 'fixture', 'fixture', now(), 'fixture');
  UPDATE public.harness_topology_nodes SET superseded_by = new_b WHERE id = old_b;
  br := '[{"code": "RTB_AB", "from": "RT_A", "to": "RT_B", "polyline_m": [[0,0,0],[0.5,0.2,0],[1,0,0]], "length_in": 45.0, "method": "fixture study"},
          {"code": "RTB_BC", "from": "RT_B", "to": "RT_C", "polyline_m": [[1,0,0],[1.5,0.1,0],[2,0,0]], "length_in": 39.4, "method": "fixture study"}]';
  r := public.load_harness_branches('e08bf694-970f-4cbe-8a74-8715158a0f2e', br, 'fixture relink');
  IF (r->>'branches_relinked')::int <> 2 OR (r->>'branches_new')::int + (r->>'branches_redrawn')::int <> 0 THEN RAISE EXCEPTION 'relink: %', r; END IF;
  SELECT count(*) INTO n FROM public.vehicle_harness_landmarks WHERE landmark_code IN ('RTB_AB', 'RTB_BC') AND NOT is_superseded
    AND new_b IN (from_node_id, to_node_id);
  IF n <> 2 THEN RAISE EXCEPTION 'branches on the new RT_B row: %', n; END IF;

  -- 3. B-C drawn back to its first geometry: a revision, not a refusal
  r := public.load_harness_branches('e08bf694-970f-4cbe-8a74-8715158a0f2e',
         '[{"code": "RTB_BC", "from": "RT_B", "to": "RT_C", "polyline_m": [[1,0,0],[2,0,0]], "length_in": 39.4, "method": "fixture study"}]', 'fixture back');
  IF r->>'branches_redrawn' <> '1' THEN RAISE EXCEPTION 'draw back: %', r; END IF;
  SELECT method INTO got FROM public.vehicle_harness_landmarks WHERE landmark_code = 'RTB_BC' AND NOT is_superseded;
  IF got NOT LIKE 'fixture study #% r%' THEN RAISE EXCEPTION 'revision mark: %', got; END IF;

  r := public.route_harness_segments('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a measure has no grain'; END IF;
END $$;

SELECT 'test_k5_harness_route_writers_relink: PASS';
