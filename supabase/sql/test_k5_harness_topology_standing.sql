-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_topology -f supabase/sql/test_k5_harness_topology_standing.sql
-- Proves 20261015013000_k5_harness_topology_standing.sql on top of RSI pass 11: the K5 route graph lands with its
-- standing (fallen points superseded by successors, branches on fallen points superseded), plugs key to live points by
-- the anchor the loader names, the straight-line check reads live points only, a later placement flows through the
-- fold into the check, the branch table is read-only to the public, and the fold is idempotent.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_resync_fold.sql

-- The live shape of vehicle_harness_landmarks (only the shim's id and vehicle_id exist so far), with the table-wide
-- grants it has in production.
ALTER TABLE public.vehicle_harness_landmarks
  ADD COLUMN landmark_code text, ADD COLUMN description text, ADD COLUMN distance_in numeric, ADD COLUMN method text,
  ADD COLUMN derived_on date, ADD COLUMN derived_by text, ADD COLUMN source_file text, ADD COLUMN assumptions text,
  ADD COLUMN superseded_by uuid REFERENCES public.vehicle_harness_landmarks(id), ADD COLUMN notes text,
  ADD COLUMN created_at timestamptz DEFAULT now(),
  ADD CONSTRAINT vehicle_harness_landmarks_key UNIQUE (vehicle_id, landmark_code, method);
ALTER TABLE public.vehicle_harness_landmarks ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.vehicle_harness_landmarks TO anon, authenticated;

-- Plugs as the loader writes them: a twin anchor or a twin object named in pos_source; LAMP-1 has a position from
-- somewhere else.
UPDATE public.harness_endpoints SET pos_x_m = -0.45, pos_y_m = -1.44, pos_z_m = 1.05,
  pos_source = 'digital-twin anchor M130: A1 passenger firewall (ASSERTED — the M130 location is an open call) (k5LandmarkPaths.ts DEFAULT_POSITIONS)'
WHERE code = 'M130-B';
UPDATE public.harness_endpoints SET pos_x_m = -0.35, pos_y_m = -1.46, pos_z_m = 0.90,
  pos_source = 'digital-twin anchor FWG_MAIN: A3 firewall hole H3 @ probed firewall plane (k5LandmarkPaths.ts DEFAULT_POSITIONS)'
WHERE code IN ('FIREWALL-CABIN', 'FIREWALL-ENGINE');
UPDATE public.harness_endpoints SET pos_x_m = 0.2, pos_y_m = -1.91, pos_z_m = 1.07,
  pos_source = 'digital-twin object K5H_CLT centre (K5_harness_workspace_v2.blend, twin_centers.json)'
WHERE code = 'CLT-ECU';
UPDATE public.harness_endpoints SET pos_x_m = -0.45, pos_y_m = -1.28, pos_z_m = 0.82,
  pos_source = 'digital-twin anchor PDM30: A2 under dash passenger (ASSERTED) (k5LandmarkPaths.ts DEFAULT_POSITIONS)'
WHERE code = 'PDM30-A';
UPDATE public.harness_endpoints SET pos_x_m = -0.3, pos_y_m = -1.45, pos_z_m = 0.57,
  pos_source = 'digital-twin object K5H_Starter centre (K5_harness_workspace_v2.blend, twin_centers.json)'
WHERE code = 'STARTER';
UPDATE public.harness_endpoints SET pos_x_m = 1, pos_y_m = 1, pos_z_m = 1, pos_source = 'fixture' WHERE code = 'LAMP-1';

DO $$
DECLARE n int;
BEGIN
  SELECT numerator INTO n FROM public.v_harness_coverage WHERE measure = 'segments with both plugs positioned';
  IF n IS NULL OR n < 1 THEN RAISE EXCEPTION 'fixture: copied positions should count before the pass, got %', n; END IF;
END $$;

\i supabase/migrations/20261015013000_k5_harness_topology_standing.sql

DO $$
DECLARE got text; n int; r jsonb;
BEGIN
  -- The graph and its standing.
  SELECT count(*) FILTER (WHERE NOT is_superseded) || '/' || count(*) FILTER (WHERE is_superseded) INTO got
  FROM public.harness_topology_nodes WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';
  IF got IS DISTINCT FROM '51/12' THEN RAISE EXCEPTION 'points live/fallen: %', got; END IF;
  SELECT string_agg(f.node_code || '>' || s.node_code, ' ' ORDER BY f.node_code COLLATE "C") INTO got
  FROM public.harness_topology_nodes f JOIN public.harness_topology_nodes s ON s.id = f.superseded_by
  WHERE f.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';
  IF got IS DISTINCT FROM 'ALT>ALT BAT>BAT CKP>CKP COIL1>DEL_STRIBUTOR COIL2>DEL_STRIBUTOR FWG_MAIN>FIREWALL_61 K5H_Alternator>ALT K5H_Battery>BAT M130>M130 O2_L>O2_L O2_R>O2_R PDM30>PDM30' THEN
    RAISE EXCEPTION 'supersession: %', got;
  END IF;
  IF EXISTS (SELECT 1 FROM public.harness_topology_nodes WHERE NOT is_superseded AND node_code IN ('M130', 'PDM30', 'DEL_STRIBUTOR', 'CKP', 'BAT', 'ALT', 'O2_L', 'O2_R') AND pos_x_m IS NOT NULL) THEN
    RAISE EXCEPTION 'a successor point was given coordinates nobody derived';
  END IF;
  SELECT pos_x_m || ',' || pos_y_m || ',' || pos_z_m INTO got FROM public.harness_topology_nodes WHERE node_code = 'FIREWALL_61';
  IF got IS DISTINCT FROM '0.50,-1.46,0.90' THEN RAISE EXCEPTION 'the 61-pin point: %', got; END IF;
  SELECT string_agg(landmark_code || CASE WHEN method = 'analytic_polyline_derived' THEN 'a' ELSE '' END, ' ' ORDER BY landmark_code COLLATE "C") INTO got
  FROM public.vehicle_harness_landmarks WHERE NOT is_superseded;
  IF got IS DISTINCT FROM 'L08 L09 L15a L21 L25 L26 L27' THEN RAISE EXCEPTION 'standing branches: %', got; END IF;
  SELECT count(*) INTO n FROM public.vehicle_harness_landmarks WHERE is_superseded;
  IF n <> 25 THEN RAISE EXCEPTION 'fallen branches: %, want 25', n; END IF;
  SELECT string_agg(l.landmark_code || '>' || coalesce(n2.landmark_code, '-'), ' ' ORDER BY l.landmark_code COLLATE "C") INTO got
  FROM public.vehicle_harness_landmarks l LEFT JOIN public.vehicle_harness_landmarks n2 ON n2.id = l.superseded_by
  WHERE l.superseded_by IS NOT NULL;
  IF got IS DISTINCT FROM 'L14>L14 L15>L15' THEN RAISE EXCEPTION 'branch successors: %', got; END IF;
  SELECT notes INTO got FROM public.vehicle_harness_landmarks WHERE landmark_code = 'L18' AND method = 'blender_polyline_derived_v2';
  IF got IS DISTINCT FROM 'Drawn from PDM30 to DASH_CLUSTER; PDM30 fell (see the point''s successor).' THEN RAISE EXCEPTION 'L18 note: %', got; END IF;
  SELECT count(*) INTO n FROM public.vehicle_harness_landmarks WHERE method = 'blender_polyline_derived_v2' AND jsonb_array_length(polyline_m) >= 2;
  IF n <> 30 THEN RAISE EXCEPTION 'twin branches with a polyline: %, want 30', n; END IF;

  -- Plugs at their live points.
  SELECT string_agg(e.code || '@' || coalesce(n2.node_code, '-'), ' ' ORDER BY e.code COLLATE "C") INTO got
  FROM public.harness_endpoints e LEFT JOIN public.harness_topology_nodes n2 ON n2.id = e.topology_node_id
  WHERE e.code IN ('M130-B', 'FIREWALL-CABIN', 'FIREWALL-ENGINE', 'CLT-ECU', 'PDM30-A', 'STARTER', 'LAMP-1');
  IF got IS DISTINCT FROM 'CLT-ECU@K5H_CLT FIREWALL-CABIN@FIREWALL_61 FIREWALL-ENGINE@FIREWALL_61 LAMP-1@- M130-B@M130 PDM30-A@PDM30 STARTER@K5H_Starter' THEN
    RAISE EXCEPTION 'plug keys: %', got;
  END IF;
  r := public.key_harness_endpoints_to_topology('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF (r->>'plugs_rekeyed')::int <> 0 THEN RAISE EXCEPTION 'the key fold is not idempotent: %', r; END IF;
  IF (r->>'positioned_plugs_with_no_point')::int <> 1 THEN RAISE EXCEPTION 'LAMP-1 should be the one positioned plug with no point: %', r; END IF;

  -- The straight line reads live points: the cab half sits on an unplaced M130, the engine half on the 61-pin.
  SELECT string_agg(from_plug || '>' || to_plug || ':' || coalesce(straight_ft::text, '-') || '/' || coalesce(from_point, '-') || '-' || coalesce(to_point, '-'), ' ' ORDER BY from_plug COLLATE "C")
    INTO got FROM public.v_harness_segment_geometry WHERE circuit_code = '110';
  IF got IS DISTINCT FROM 'FIREWALL-ENGINE>CLT-ECU:1.86/FIREWALL_61-K5H_CLT M130-B>FIREWALL-CABIN:-/M130-FIREWALL_61' THEN RAISE EXCEPTION 'geometry: %', got; END IF;
  SELECT numerator || '/' || denominator INTO got FROM public.v_harness_coverage WHERE measure = 'segments with both plugs at a standing position';
  IF got NOT LIKE '1/%' THEN RAISE EXCEPTION 'standing positions: %', got; END IF;
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE measure = 'segments with both plugs positioned') THEN
    RAISE EXCEPTION 'the copied-position measure is still on the scoreboard';
  END IF;
  SELECT numerator || '/' || denominator INTO got FROM public.v_harness_coverage WHERE measure = 'segments planned shorter than the straight line between their plugs (must be 0)';
  IF got IS DISTINCT FROM '1/1' THEN RAISE EXCEPTION 'geometry check: %', got; END IF;
  SELECT count(*) INTO n FROM public.v_harness_coverage WHERE grain IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'measures with no grain: %', n; END IF;
  SELECT count(*) INTO n FROM public.v_harness_coverage;
  IF n <> 25 THEN RAISE EXCEPTION 'scoreboard measures: %, want 25', n; END IF;
END $$;

-- The ends on unplaced points are the placement backlog.
DO $$
DECLARE at_node int; unplaced int; total int; want_at int; want_unplaced int;
BEGIN
  SELECT count(*) FILTER (WHERE n.id IS NOT NULL), count(*) FILTER (WHERE n.id IS NOT NULL AND n.pos_x_m IS NULL), count(*)
    INTO want_at, want_unplaced, total
  FROM public.wire_termination_specs t
  LEFT JOIN public.harness_endpoints e ON e.id = t.endpoint_id
  LEFT JOIN public.harness_topology_nodes n ON n.id = e.topology_node_id AND NOT n.is_superseded
  WHERE NOT t.is_superseded AND EXISTS (SELECT 1 FROM public.harness_segments s WHERE NOT s.is_superseded AND t.id IN (s.from_termination_id, s.to_termination_id));
  SELECT numerator INTO at_node FROM public.v_harness_coverage WHERE measure = 'wire ends at a topology node';
  SELECT numerator INTO unplaced FROM public.v_harness_coverage WHERE measure = 'wire ends at a node not yet placed';
  IF at_node <> want_at OR unplaced <> want_unplaced OR want_unplaced < 2 OR want_at <= want_unplaced THEN
    RAISE EXCEPTION 'ends at a node %/% (want %), unplaced % (want %)', at_node, total, want_at, unplaced, want_unplaced;
  END IF;
END $$;

-- A later placement: the M130 gets a spot. Supersede the open point; the fold re-keys its plug, and the check measures
-- the cab half without any other change.
INSERT INTO public.harness_topology_nodes (id, vehicle_id, node_code, kind, pos_x_m, pos_y_m, pos_z_m, pos_source, source, method, observed_at, trust)
VALUES ('00000000-0000-0000-0000-00000000c130', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', 'M130_DRIVER', 'device', 0.30, -1.40, 0.95,
        'fixture placement', 'fixture', 'fixture', now(), 'proposed');
UPDATE public.harness_topology_nodes SET is_superseded = true, superseded_by = '00000000-0000-0000-0000-00000000c130'
WHERE node_code = 'M130' AND NOT is_superseded AND id <> '00000000-0000-0000-0000-00000000c130';

DO $$
DECLARE got text; r jsonb;
BEGIN
  r := public.key_harness_endpoints_to_topology('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF (r->>'plugs_rekeyed')::int <> 1 THEN RAISE EXCEPTION 'placement: re-keyed %', r; END IF;
  SELECT straight_ft::text || '/' || from_point INTO got FROM public.v_harness_segment_geometry WHERE circuit_code = '110' AND from_plug = 'M130-B';
  IF got IS DISTINCT FROM '0.70/M130_DRIVER' THEN RAISE EXCEPTION 'placement geometry: %', got; END IF;
END $$;

-- The branch table and the fold, as the public sees them.
DO $$
DECLARE n int;
BEGIN
  IF has_table_privilege('anon', 'public.vehicle_harness_landmarks', 'INSERT') OR has_table_privilege('anon', 'public.vehicle_harness_landmarks', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.vehicle_harness_landmarks', 'DELETE') THEN
    RAISE EXCEPTION 'vehicle_harness_landmarks keeps a public write grant';
  END IF;
  IF has_function_privilege('anon', 'public.key_harness_endpoints_to_topology(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.key_harness_endpoints_to_topology(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the public can run the key fold';
  END IF;
  SELECT count(*) INTO n FROM public.stack_needs WHERE stack_id = 'SH';
  IF n <> 27 THEN RAISE EXCEPTION 'SH needs: %, want 27', n; END IF;
END $$;
GRANT USAGE ON SCHEMA auth, public TO anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon;
GRANT SELECT ON public.vehicles TO anon;
SET ROLE anon;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.vehicle_harness_landmarks;
  IF n <> 32 THEN RAISE EXCEPTION 'anon reads % branches of the public K5, want 32', n; END IF;
END $$;
RESET ROLE;

SELECT 'test_k5_harness_topology_standing: PASS' AS result;
