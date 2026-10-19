-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_points -f supabase/sql/test_k5_harness_topology_points_writer.sql
-- Proves 20261015200000_k5_harness_topology_points_writer.sql on top of RSI pass 30:
--   - a point the record placed (M130, standing with no coordinates since pass 12) gets a new row, and the live one is
--     superseded onto it;
--   - a code with no live row gets one;
--   - re-running with the same rows changes nothing, and moving a point supersedes again;
--   - a row without coordinates refuses the whole load;
--   - the plug keyed through its anchor reaches the placed point;
--   - visitors cannot call the writer.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_segment_keys_fold.sql

\i supabase/migrations/20261015200000_k5_harness_topology_points_writer.sql

DO $$
DECLARE r jsonb; got text; n int; rows_ jsonb; old_m130 uuid;
BEGIN
  SELECT id INTO old_m130 FROM public.harness_topology_nodes
  WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND node_code = 'M130' AND NOT is_superseded;
  rows_ := '[{"node_code": "M130", "kind": "device", "x": 0.55, "y": -1.22, "z": 0.987,
              "pos_source": "digital-twin anchor M130: dash underside, driver side (proposed)", "trust": "proposed"},
             {"node_code": "NEWBOX", "kind": "device", "x": 0.3, "y": -1.3, "z": 0.997,
              "pos_source": "digital-twin anchor NEWBOX: beside it (proposed)", "trust": "proposed"}]';
  r := public.load_harness_topology_points('e08bf694-970f-4cbe-8a74-8715158a0f2e', rows_, 'fixture mounts.yaml @ test');
  IF r->>'points_new' <> (CASE WHEN old_m130 IS NULL THEN '2' ELSE '1' END)
     OR r->>'points_moved' <> (CASE WHEN old_m130 IS NULL THEN '0' ELSE '1' END) THEN RAISE EXCEPTION 'first load: %', r; END IF;

  SELECT pos_x_m || '/' || pos_y_m || '/' || pos_z_m || ' ' || trust INTO got FROM public.harness_topology_nodes
  WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND node_code = 'M130' AND NOT is_superseded;
  IF got IS DISTINCT FROM '0.55/-1.22/0.987 proposed' THEN RAISE EXCEPTION 'M130 point: %', got; END IF;
  IF old_m130 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.harness_topology_nodes o JOIN public.harness_topology_nodes nw ON nw.id = o.superseded_by
                                          WHERE o.id = old_m130 AND o.is_superseded AND NOT nw.is_superseded) THEN
    RAISE EXCEPTION 'the old M130 point is not superseded onto the new one';
  END IF;
  SELECT count(*) INTO n FROM public.harness_topology_nodes WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND node_code IN ('M130', 'NEWBOX') AND NOT is_superseded;
  IF n <> 2 THEN RAISE EXCEPTION 'live points: %', n; END IF;

  -- Same rows: nothing changes. A moved point supersedes again.
  r := public.load_harness_topology_points('e08bf694-970f-4cbe-8a74-8715158a0f2e', rows_, 'fixture mounts.yaml @ test');
  IF r->>'points_unchanged' <> '2' OR r->>'points_new' <> '0' OR r->>'points_moved' <> '0' THEN RAISE EXCEPTION 'not idempotent: %', r; END IF;
  r := public.load_harness_topology_points('e08bf694-970f-4cbe-8a74-8715158a0f2e',
         jsonb_set(rows_, '{1,x}', '0.31'), 'fixture mounts.yaml @ test 2');
  IF r->>'points_moved' <> '1' OR r->>'points_unchanged' <> '1' THEN RAISE EXCEPTION 'move: %', r; END IF;
  SELECT count(*) INTO n FROM public.harness_topology_nodes WHERE node_code = 'NEWBOX';
  IF n <> 2 THEN RAISE EXCEPTION 'NEWBOX rows: %', n; END IF;

  -- A row with no coordinates refuses the load.
  BEGIN
    r := public.load_harness_topology_points('e08bf694-970f-4cbe-8a74-8715158a0f2e', '[{"node_code": "M130", "pos_source": "x"}]', 'bad');
    RAISE EXCEPTION 'a row without coordinates loaded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%lack x, y, z or pos_source%' THEN RAISE; END IF;
  END;

  -- A plug whose pos_source names the anchor keys to the placed point.
  UPDATE public.harness_endpoints SET pos_source = 'digital-twin anchor M130: dash underside, driver side (proposed)'
  WHERE code = 'M130-B';
  r := public.key_harness_endpoints_to_topology('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  SELECT t.pos_x_m::text INTO got FROM public.harness_endpoints e JOIN public.harness_topology_nodes t ON t.id = e.topology_node_id
  WHERE e.code = 'M130-B';
  IF got IS DISTINCT FROM '0.55' THEN RAISE EXCEPTION 'M130-B keyed to: %', got; END IF;

  IF has_function_privilege('anon', 'public.load_harness_topology_points(uuid,jsonb,text)', 'EXECUTE') THEN RAISE EXCEPTION 'anon can run the writer'; END IF;
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a measure has no grain'; END IF;
END $$;

SELECT 'test_k5_harness_topology_points_writer: PASS';
