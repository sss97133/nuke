-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_route -f supabase/sql/test_k5_harness_branches_and_routing.sql
-- Proves 20261015220000_k5_harness_branches_and_routing.sql on top of RSI pass 31:
--   - branches written from rows join live points; an unchanged branch stays, a redrawn one supersedes its row;
--   - a segment between two standing points is routed along the shortest branch chain (A-B-C, not the long A-C);
--   - re-routing is idempotent, a redrawn branch on the path re-routes the segment, and points no chain joins are
--     counted, not routed;
--   - a branch row without live points refuses the load; visitors cannot call either function.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_topology_points_writer.sql

\i supabase/migrations/20261015220000_k5_harness_branches_and_routing.sql

DO $$
DECLARE r jsonb; got text; n int; br jsonb;
BEGIN
  r := public.load_harness_topology_points('e08bf694-970f-4cbe-8a74-8715158a0f2e', '[
    {"node_code": "RT_A", "kind": "breakout", "x": 0, "y": 0, "z": 0, "pos_source": "fixture A"},
    {"node_code": "RT_B", "kind": "breakout", "x": 1, "y": 0, "z": 0, "pos_source": "fixture B"},
    {"node_code": "RT_C", "kind": "breakout", "x": 2, "y": 0, "z": 0, "pos_source": "fixture C"},
    {"node_code": "RT_D", "kind": "breakout", "x": 9, "y": 9, "z": 9, "pos_source": "fixture D, joined by nothing"}]', 'fixture');
  br := '[{"code": "RTB_AB", "from": "RT_A", "to": "RT_B", "polyline_m": [[0,0,0],[1,0,0]], "length_in": 39.4, "method": "fixture study"},
          {"code": "RTB_BC", "from": "RT_B", "to": "RT_C", "polyline_m": [[1,0,0],[2,0,0]], "length_in": 39.4, "method": "fixture study"},
          {"code": "RTB_AC", "from": "RT_A", "to": "RT_C", "polyline_m": [[0,0,0],[1,3,0],[2,0,0]], "length_in": 200, "method": "fixture study"}]';
  r := public.load_harness_branches('e08bf694-970f-4cbe-8a74-8715158a0f2e', br, 'fixture route_branches.yaml');
  IF r->>'branches_new' <> '3' THEN RAISE EXCEPTION 'branches: %', r; END IF;
  r := public.load_harness_branches('e08bf694-970f-4cbe-8a74-8715158a0f2e', br, 'fixture route_branches.yaml');
  IF r->>'branches_unchanged' <> '3' THEN RAISE EXCEPTION 'branches not idempotent: %', r; END IF;

  -- plugs on A, C and D; a wire A-C and a wire A-D
  INSERT INTO public.harness_endpoints (id, design_id, code, endpoint_type, node_kind, topology_node_id) VALUES
    ('00000000-0000-0000-0000-0000000e3301', '00000000-0000-0000-0000-0000000000d0', 'RT-PLUG-A', 'actuator', 'terminals',
     (SELECT id FROM public.harness_topology_nodes WHERE node_code = 'RT_A' AND NOT is_superseded)),
    ('00000000-0000-0000-0000-0000000e3302', '00000000-0000-0000-0000-0000000000d0', 'RT-PLUG-C', 'actuator', 'terminals',
     (SELECT id FROM public.harness_topology_nodes WHERE node_code = 'RT_C' AND NOT is_superseded)),
    ('00000000-0000-0000-0000-0000000e3303', '00000000-0000-0000-0000-0000000000d0', 'RT-PLUG-D', 'actuator', 'terminals',
     (SELECT id FROM public.harness_topology_nodes WHERE node_code = 'RT_D' AND NOT is_superseded));
  INSERT INTO public.vehicle_custom_circuits (id, overlay_id, circuit_code, circuit_name, design_status, build_state, from_endpoint_id, to_endpoint_id) VALUES
    ('00000000-0000-0000-0000-0000000c3301', '00000000-0000-0000-0000-0000000000f0', 'RT1', 'routed', 'decided', 'uncut',
     '00000000-0000-0000-0000-0000000e3301', '00000000-0000-0000-0000-0000000e3302'),
    ('00000000-0000-0000-0000-0000000c3302', '00000000-0000-0000-0000-0000000000f0', 'RT2', 'not joined', 'decided', 'uncut',
     '00000000-0000-0000-0000-0000000e3301', '00000000-0000-0000-0000-0000000e3303');
  INSERT INTO public.wire_termination_specs (id, vehicle_id, circuit_id, endpoint_id, cavity) VALUES
    ('00000000-0000-0000-0000-0000000d3301', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-0000000c3301', '00000000-0000-0000-0000-0000000e3301', '1'),
    ('00000000-0000-0000-0000-0000000d3302', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-0000000c3301', '00000000-0000-0000-0000-0000000e3302', '1'),
    ('00000000-0000-0000-0000-0000000d3303', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-0000000c3302', '00000000-0000-0000-0000-0000000e3301', '2'),
    ('00000000-0000-0000-0000-0000000d3304', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-0000000c3302', '00000000-0000-0000-0000-0000000e3303', '1');
  INSERT INTO public.harness_nets (id, vehicle_id, net_code, source, method, observed_at, trust) VALUES
    ('00000000-0000-0000-0000-0000000f3301', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', 'wire RT1', 'fixture', 'fixture', now(), 'fixture'),
    ('00000000-0000-0000-0000-0000000f3302', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', 'wire RT2', 'fixture', 'fixture', now(), 'fixture');
  INSERT INTO public.harness_segments (id, vehicle_id, net_id, vehicle_custom_circuit_id, from_termination_id, to_termination_id, design_status, source, method, observed_at, trust) VALUES
    ('00000000-0000-0000-0000-0000000a3301', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-0000000f3301', '00000000-0000-0000-0000-0000000c3301',
     '00000000-0000-0000-0000-0000000d3301', '00000000-0000-0000-0000-0000000d3302', 'decided', 'fixture', 'conform', now(), 'fixture'),
    ('00000000-0000-0000-0000-0000000a3302', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-0000000f3302', '00000000-0000-0000-0000-0000000c3302',
     '00000000-0000-0000-0000-0000000d3303', '00000000-0000-0000-0000-0000000d3304', 'decided', 'fixture', 'conform', now(), 'fixture');

  r := public.route_harness_segments('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF (r->>'segments_routed')::int < 1 OR (r->>'segments_points_not_joined')::int < 1 THEN RAISE EXCEPTION 'route: %', r; END IF;
  SELECT string_agg(l.landmark_code, ' > ' ORDER BY h.seq) INTO got FROM public.harness_routings h
  JOIN public.vehicle_harness_landmarks l ON l.id = h.landmark_id
  WHERE h.segment_id = '00000000-0000-0000-0000-0000000a3301' AND NOT h.is_superseded;
  IF got IS DISTINCT FROM 'RTB_AB > RTB_BC' THEN RAISE EXCEPTION 'RT1 path: %', got; END IF;
  SELECT count(*) INTO n FROM public.harness_routings WHERE segment_id = '00000000-0000-0000-0000-0000000a3302';
  IF n <> 0 THEN RAISE EXCEPTION 'RT2 was routed (% rows)', n; END IF;

  r := public.route_harness_segments('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF (r->>'segments_routed')::int <> 0 OR (r->>'segments_rerouted')::int <> 0 THEN RAISE EXCEPTION 'routing not idempotent: %', r; END IF;

  -- redraw B-C: the path's second branch is a new row, so RT1 re-routes onto it
  r := public.load_harness_branches('e08bf694-970f-4cbe-8a74-8715158a0f2e', jsonb_set(br, '{1,polyline_m}', '[[1,0,0],[1.5,0.1,0],[2,0,0]]'), 'fixture 2');
  IF r->>'branches_redrawn' <> '1' THEN RAISE EXCEPTION 'redraw: %', r; END IF;
  r := public.route_harness_segments('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF (r->>'segments_rerouted')::int < 1 THEN RAISE EXCEPTION 're-route: %', r; END IF;
  SELECT count(*) INTO n FROM public.harness_routings WHERE segment_id = '00000000-0000-0000-0000-0000000a3301' AND is_superseded;
  IF n <> 2 THEN RAISE EXCEPTION 'old path rows superseded: %', n; END IF;

  BEGIN
    r := public.load_harness_branches('e08bf694-970f-4cbe-8a74-8715158a0f2e',
           '[{"code": "RTB_X", "from": "RT_A", "to": "NOWHERE", "polyline_m": [[0,0,0]], "length_in": 5}]', 'bad');
    RAISE EXCEPTION 'a branch to no point loaded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%lack a live from/to point%' THEN RAISE; END IF;
  END;

  IF has_function_privilege('anon', 'public.load_harness_branches(uuid,jsonb,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.route_harness_segments(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'anon can run a pass 33 function'; END IF;
  SELECT numerator INTO n FROM public.v_harness_coverage WHERE measure = 'segments routed over topology';
  IF n < 1 THEN RAISE EXCEPTION 'scoreboard does not count the routed segment: %', n; END IF;
END $$;

SELECT 'test_k5_harness_branches_and_routing: PASS';
