-- RSI pass 36 on the harness model: the route-graph writers keep their rows when nothing moved. Case ledger 13.12.3.
--
-- The pass 35 load (2026-10-15 19:36Z) stopped half-way. BRAKE_SW's point was written again with the same coordinates
-- and new words: the device-position study's end "follows node BRAKE_SW". load_harness_topology_points compared
-- pos_source as well as coordinates, so it superseded the point with a new row and a new id. Branch K5B_C06
-- (J_CAB_DASH to BRAKE_SW) still pointed at the old id. load_harness_branches saw the ends differ and tried to insert
-- the same code and geometry hash again, which the history-wide unique key (vehicle, code, method) refused. The loader
-- exited before routing, the net fold and the splices. Its remaining steps were run by hand through the same functions
-- at 19:38Z, and every check came back except one real finding: 8 cut-list lengths shorter than their plugs' straight line.
--
-- This pass re-issues both writers:
--   1. load_harness_topology_points writes a new row only when a point moves (to the millimetre). New words alone keep
--      the row.
--   2. load_harness_branches re-links a branch in place when its geometry is unchanged but an end point's row was
--      re-written. A branch drawn back to geometry it had before gets a revision mark, so code + method stays unique.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF to_regprocedure('public.load_harness_branches(uuid,jsonb,text)') IS NULL THEN RAISE EXCEPTION 'RSI pass 33 (20261015220000) has not run'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.load_harness_topology_points(p_vehicle_id uuid, p_rows jsonb, p_source text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE n_rows int; n_new int; n_moved int; n_kept int; n_bad int;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'p_rows must be a JSON array of placement rows'; END IF;
  CREATE TEMP TABLE IF NOT EXISTS topo_point (node_code text PRIMARY KEY, kind text, x numeric, y numeric, z numeric, pos_source text,
    method text, trust text, live_id uuid, new_id uuid) ON COMMIT DROP;
  TRUNCATE topo_point;

  INSERT INTO topo_point (node_code, kind, x, y, z, pos_source, method, trust)
  SELECT DISTINCT ON (btrim(r->>'node_code')) btrim(r->>'node_code'), coalesce(nullif(btrim(r->>'kind'), ''), 'device'),
         (r->>'x')::numeric, (r->>'y')::numeric, (r->>'z')::numeric, nullif(btrim(r->>'pos_source'), ''),
         coalesce(nullif(btrim(r->>'method'), ''), 'placement decision record'), coalesce(nullif(btrim(r->>'trust'), ''), 'T3')
  FROM jsonb_array_elements(p_rows) r
  WHERE btrim(coalesce(r->>'node_code', '')) <> '';
  GET DIAGNOSTICS n_rows = ROW_COUNT;
  SELECT count(*) INTO n_bad FROM topo_point WHERE x IS NULL OR y IS NULL OR z IS NULL OR pos_source IS NULL;
  IF n_bad > 0 THEN RAISE EXCEPTION '% placement rows lack x, y, z or pos_source', n_bad; END IF;

  UPDATE topo_point p SET live_id = (
    SELECT n.id FROM public.harness_topology_nodes n
    WHERE n.vehicle_id = p_vehicle_id AND n.node_code = p.node_code AND NOT n.is_superseded
    ORDER BY n.created_at DESC, n.id LIMIT 1)
  WHERE p.node_code IS NOT NULL;
  -- a new row only when the point moved (coordinates to the millimetre); new words alone do not move it (pass 36)
  UPDATE topo_point p SET new_id = gen_random_uuid()
  WHERE NOT EXISTS (SELECT 1 FROM public.harness_topology_nodes n
                    WHERE n.id = p.live_id AND round(n.pos_x_m, 3) = round(p.x, 3) AND round(n.pos_y_m, 3) = round(p.y, 3)
                      AND round(n.pos_z_m, 3) = round(p.z, 3));   -- RSI pass 36: a point that has not moved keeps its row
  SELECT count(*) FILTER (WHERE new_id IS NOT NULL AND live_id IS NULL), count(*) FILTER (WHERE new_id IS NOT NULL AND live_id IS NOT NULL),
         count(*) FILTER (WHERE new_id IS NULL)
    INTO n_new, n_moved, n_kept FROM topo_point;

  -- one live row per point (harness_topology_nodes_live_key): retire the live row, write the new one, then link them
  UPDATE public.harness_topology_nodes n SET is_superseded = true
  FROM topo_point p
  WHERE n.id = p.live_id AND p.new_id IS NOT NULL;
  INSERT INTO public.harness_topology_nodes (id, vehicle_id, node_code, kind, pos_x_m, pos_y_m, pos_z_m, pos_source, source, method, observed_at, trust)
  SELECT p.new_id, p_vehicle_id, p.node_code, p.kind, p.x, p.y, p.z, p.pos_source, p_source, p.method, now(), p.trust
  FROM topo_point p WHERE p.new_id IS NOT NULL;
  UPDATE public.harness_topology_nodes n SET superseded_by = p.new_id
  FROM topo_point p
  WHERE n.id = p.live_id AND p.new_id IS NOT NULL;

  RETURN jsonb_build_object('rows', n_rows, 'points_new', n_new, 'points_moved', n_moved, 'points_unchanged', n_kept);
END $fn$;

CREATE OR REPLACE FUNCTION public.load_harness_branches(p_vehicle_id uuid, p_rows jsonb, p_source text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE n_rows int; n_new int; n_moved int; n_kept int; n_bad int; n_relinked int;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'p_rows must be a JSON array of branch rows'; END IF;
  CREATE TEMP TABLE IF NOT EXISTS br_row (code text PRIMARY KEY, from_code text, to_code text, from_id uuid, to_id uuid, polyline jsonb,
    length_in numeric, description text, method text, assumptions text, live_id uuid, new_id uuid) ON COMMIT DROP;
  TRUNCATE br_row;

  INSERT INTO br_row (code, from_code, to_code, polyline, length_in, description, method, assumptions)
  SELECT DISTINCT ON (btrim(r->>'code')) btrim(r->>'code'), btrim(r->>'from'), btrim(r->>'to'), r->'polyline_m',
         (r->>'length_in')::numeric, nullif(btrim(r->>'description'), ''),
         coalesce(nullif(btrim(r->>'method'), ''), 'route study') || ' #'
           || left(md5(coalesce(r->>'polyline_m', '') || '|' || btrim(r->>'from') || '|' || btrim(r->>'to')), 8),
         nullif(btrim(r->>'assumptions'), '')
  FROM jsonb_array_elements(p_rows) r
  WHERE btrim(coalesce(r->>'code', '')) <> '';
  GET DIAGNOSTICS n_rows = ROW_COUNT;

  UPDATE br_row b SET
    from_id = (SELECT n.id FROM public.harness_topology_nodes n WHERE n.vehicle_id = p_vehicle_id AND n.node_code = b.from_code AND NOT n.is_superseded),
    to_id   = (SELECT n.id FROM public.harness_topology_nodes n WHERE n.vehicle_id = p_vehicle_id AND n.node_code = b.to_code AND NOT n.is_superseded),
    live_id = (SELECT l.id FROM public.vehicle_harness_landmarks l WHERE l.vehicle_id = p_vehicle_id AND l.landmark_code = b.code AND NOT l.is_superseded)
  WHERE b.code IS NOT NULL;
  SELECT count(*) INTO n_bad FROM br_row
  WHERE from_id IS NULL OR to_id IS NULL OR length_in IS NULL OR length_in <= 0 OR jsonb_typeof(polyline) IS DISTINCT FROM 'array';
  IF n_bad > 0 THEN
    RAISE EXCEPTION '% branch rows lack a live from/to point, a positive length_in or a polyline: %', n_bad,
      (SELECT string_agg(code, ', ') FROM br_row WHERE from_id IS NULL OR to_id IS NULL OR length_in IS NULL OR length_in <= 0
         OR jsonb_typeof(polyline) IS DISTINCT FROM 'array');
  END IF;

  -- RSI pass 36: the same geometry on a point whose row was re-written is re-linked in place, not re-inserted (code +
  -- method is unique across history, so a second row with the same geometry would be refused)
  UPDATE public.vehicle_harness_landmarks l SET from_node_id = b.from_id, to_node_id = b.to_id
  FROM br_row b
  WHERE l.id = b.live_id AND l.method = b.method AND (l.from_node_id IS DISTINCT FROM b.from_id OR l.to_node_id IS DISTINCT FROM b.to_id);
  GET DIAGNOSTICS n_relinked = ROW_COUNT;
  UPDATE br_row b SET new_id = gen_random_uuid()
  WHERE NOT EXISTS (SELECT 1 FROM public.vehicle_harness_landmarks l WHERE l.id = b.live_id AND l.method = b.method);
  -- geometry this code had before (a branch redrawn back): its method takes a revision mark so it stays unique
  UPDATE br_row b SET method = b.method || ' r' || (SELECT count(*) + 1 FROM public.vehicle_harness_landmarks l
                                                     WHERE l.vehicle_id = p_vehicle_id AND l.landmark_code = b.code AND l.method LIKE b.method || '%')
  WHERE b.new_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.vehicle_harness_landmarks l WHERE l.vehicle_id = p_vehicle_id AND l.landmark_code = b.code AND l.method = b.method);
  SELECT count(*) FILTER (WHERE new_id IS NOT NULL AND live_id IS NULL), count(*) FILTER (WHERE new_id IS NOT NULL AND live_id IS NOT NULL),
         count(*) FILTER (WHERE new_id IS NULL)
    INTO n_new, n_moved, n_kept FROM br_row;

  -- one live row per code (vehicle_harness_landmarks_live_key): retire, write, then link
  UPDATE public.vehicle_harness_landmarks l SET is_superseded = true
  FROM br_row b WHERE l.id = b.live_id AND b.new_id IS NOT NULL;
  INSERT INTO public.vehicle_harness_landmarks (id, vehicle_id, landmark_code, description, distance_in, method, derived_on, derived_by,
                                               source_file, assumptions, from_node_id, to_node_id, polyline_m)
  SELECT b.new_id, p_vehicle_id, b.code, b.description, b.length_in, b.method, current_date, 'load_harness_branches (RSI pass 33)',
         p_source, b.assumptions, b.from_id, b.to_id, b.polyline
  FROM br_row b WHERE b.new_id IS NOT NULL;
  UPDATE public.vehicle_harness_landmarks l SET superseded_by = b.new_id
  FROM br_row b WHERE l.id = b.live_id AND b.new_id IS NOT NULL;

  RETURN jsonb_build_object('rows', n_rows, 'branches_new', n_new, 'branches_redrawn', n_moved, 'branches_unchanged', n_kept,
                            'branches_relinked', n_relinked);
END $fn$;

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a scoreboard measure has no grain'; END IF;
  RAISE NOTICE 'RSI pass 36: the route-graph writers keep unmoved rows; the loader''s next run re-links K5B_C06';
END $check$;

COMMIT;
