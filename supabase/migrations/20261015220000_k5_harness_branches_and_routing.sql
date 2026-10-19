-- RSI pass 33 on the harness model: branches come from the design record, and every segment whose plugs stand on the
-- graph is routed over them. Case ledger 13.12.3.
--
-- Routing has been 0 / 670 since the route graph landed (pass 12): 24 of the June twin's 30 branches fell with the points
-- the record overtook, the standing 7 joined no two plugs, and nothing could write a branch or a routing after the
-- pass-12 migration. Pass 31 placed the M130 and PDM30. Live as anon at 18:34Z, 143 / 670 segments have both plugs at a
-- standing point.
--
-- This pass:
--   1. load_harness_branches(vehicle, rows, source) writes the design record's branches (vehicle_harness_landmarks):
--      {code, from, to (route-graph point codes), polyline_m, length_in, description, method, assumptions}. Append-only:
--      a branch whose geometry or ends changed gets a new row (its method carries a geometry hash, since code + method
--      is unique across history) and the live one is superseded onto it; an unchanged branch is left alone.
--   2. route_harness_segments(vehicle): each live segment whose two plugs sit on standing points is routed along the
--      shortest chain of live branches between them (the branches as an undirected graph on point codes, weighted by
--      length; shortest paths by repeated relaxation). Its routing rows (harness_routings, seq 1..n) are written when
--      it has none or its path changed; an old path is superseded. Segments whose plugs share a point, or whose
--      points no branch chain joins, are counted, not routed.
-- The registry loader reads the branches from docs/wiring/calc-data/catalog/route_branches.yaml (junction points through
-- load_harness_topology_points first), writes them, then routes.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF to_regprocedure('public.load_harness_topology_points(uuid,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'RSI pass 31 (20261015200000) has not run';
  END IF;
  IF to_regprocedure('public.load_harness_branches(uuid,jsonb,text)') IS NOT NULL OR to_regprocedure('public.route_harness_segments(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'RSI pass 33 functions already exist';
  END IF;
END $guard$;

-- 1. The branch writer.
CREATE FUNCTION public.load_harness_branches(p_vehicle_id uuid, p_rows jsonb, p_source text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE n_rows int; n_new int; n_moved int; n_kept int; n_bad int;
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

  UPDATE br_row b SET new_id = gen_random_uuid()
  WHERE NOT EXISTS (SELECT 1 FROM public.vehicle_harness_landmarks l
                    WHERE l.id = b.live_id AND l.method = b.method AND l.from_node_id = b.from_id AND l.to_node_id = b.to_id);
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

  RETURN jsonb_build_object('rows', n_rows, 'branches_new', n_new, 'branches_redrawn', n_moved, 'branches_unchanged', n_kept);
END $fn$;
COMMENT ON FUNCTION public.load_harness_branches(uuid, jsonb, text) IS 'Writes the design record''s route-graph branches (vehicle_harness_landmarks) for the vehicle: rows {code, from, to (live point codes), polyline_m, length_in, description, method, assumptions}. A branch whose geometry or ends changed gets a new row and the live one is superseded onto it (append-only; the method carries a geometry hash because code + method is unique); an unchanged branch is left alone; branches the rows do not name are untouched. Refuses rows without live points, a positive length or a polyline. Idempotent; service role. RSI pass 33, case ledger 13.12.3.';
REVOKE ALL ON FUNCTION public.load_harness_branches(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.load_harness_branches(uuid, jsonb, text) TO service_role;

-- 2. Routing.
CREATE FUNCTION public.route_harness_segments(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE n_changed int; n_iter int := 0; n_routed int; n_rerouted int; n_kept int; n_same int; n_unjoined int; n_unplaced int;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS rt_edge (a text, b text, landmark_id uuid, w numeric) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS rt_seg (seg_id uuid PRIMARY KEY, a text, b text) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS rt_dist (src text, node text, d numeric, prev_node text, prev_lm uuid, PRIMARY KEY (src, node)) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS rt_path (seg_id uuid, seq int, landmark_id uuid) ON COMMIT DROP;
  TRUNCATE rt_edge, rt_seg, rt_dist, rt_path;

  -- the graph: live branches between live points, both ways, on point codes
  INSERT INTO rt_edge
  SELECT x.a, x.b, l.id, l.distance_in
  FROM public.vehicle_harness_landmarks l
  JOIN public.harness_topology_nodes f ON f.id = l.from_node_id
  JOIN public.harness_topology_nodes t ON t.id = l.to_node_id
  CROSS JOIN LATERAL (VALUES (f.node_code, t.node_code), (t.node_code, f.node_code)) x(a, b)
  WHERE l.vehicle_id = p_vehicle_id AND NOT l.is_superseded AND l.distance_in > 0 AND f.node_code <> t.node_code
    AND EXISTS (SELECT 1 FROM public.harness_topology_nodes lf WHERE lf.vehicle_id = p_vehicle_id AND lf.node_code = f.node_code AND NOT lf.is_superseded AND lf.pos_x_m IS NOT NULL)
    AND EXISTS (SELECT 1 FROM public.harness_topology_nodes lt WHERE lt.vehicle_id = p_vehicle_id AND lt.node_code = t.node_code AND NOT lt.is_superseded AND lt.pos_x_m IS NOT NULL);

  -- each live segment's two plugs' standing points
  INSERT INTO rt_seg
  SELECT s.id, na.node_code, nb.node_code
  FROM public.harness_segments s
  JOIN public.wire_termination_specs ta ON ta.id = s.from_termination_id
  JOIN public.harness_endpoints ea ON ea.id = ta.endpoint_id
  JOIN public.wire_termination_specs tb ON tb.id = s.to_termination_id
  JOIN public.harness_endpoints eb ON eb.id = tb.endpoint_id
  LEFT JOIN public.harness_topology_nodes na ON na.id = ea.topology_node_id AND NOT na.is_superseded AND na.pos_x_m IS NOT NULL
  LEFT JOIN public.harness_topology_nodes nb ON nb.id = eb.topology_node_id AND NOT nb.is_superseded AND nb.pos_x_m IS NOT NULL
  WHERE s.vehicle_id = p_vehicle_id AND NOT s.is_superseded;
  SELECT count(*) FILTER (WHERE a IS NULL OR b IS NULL), count(*) FILTER (WHERE a = b) INTO n_unplaced, n_same FROM rt_seg;

  -- shortest paths from every source point a segment needs, by repeated relaxation
  INSERT INTO rt_dist SELECT DISTINCT a, a, 0::numeric, NULL::text, NULL::uuid FROM rt_seg WHERE a IS NOT NULL AND b IS NOT NULL AND a <> b;
  LOOP
    n_iter := n_iter + 1;
    INSERT INTO rt_dist (src, node, d, prev_node, prev_lm)
    SELECT DISTINCT ON (d.src, e.b) d.src, e.b, d.d + e.w, d.node, e.landmark_id
    FROM rt_dist d JOIN rt_edge e ON e.a = d.node
    ORDER BY d.src, e.b, d.d + e.w, e.landmark_id
    ON CONFLICT (src, node) DO UPDATE SET d = EXCLUDED.d, prev_node = EXCLUDED.prev_node, prev_lm = EXCLUDED.prev_lm
    WHERE EXCLUDED.d < rt_dist.d - 0.0001;
    GET DIAGNOSTICS n_changed = ROW_COUNT;
    EXIT WHEN n_changed = 0 OR n_iter > 200;
  END LOOP;

  -- each segment's path, walked back from its far point
  WITH RECURSIVE walk(seg_id, src, node, lm, depth) AS (
    SELECT s.seg_id, s.a, d.prev_node, d.prev_lm, 1
    FROM rt_seg s JOIN rt_dist d ON d.src = s.a AND d.node = s.b
    WHERE s.a <> s.b AND d.prev_lm IS NOT NULL
    UNION ALL
    SELECT w.seg_id, w.src, d.prev_node, d.prev_lm, w.depth + 1
    FROM walk w JOIN rt_dist d ON d.src = w.src AND d.node = w.node
    WHERE d.prev_lm IS NOT NULL AND w.depth < 100)
  INSERT INTO rt_path
  SELECT seg_id, row_number() OVER (PARTITION BY seg_id ORDER BY depth DESC), lm FROM walk;
  SELECT count(*) INTO n_unjoined FROM rt_seg s
  WHERE s.a IS NOT NULL AND s.b IS NOT NULL AND s.a <> s.b AND NOT EXISTS (SELECT 1 FROM rt_path p WHERE p.seg_id = s.seg_id);

  -- write where the path is new or changed
  CREATE TEMP TABLE IF NOT EXISTS rt_change (seg_id uuid PRIMARY KEY, had boolean) ON COMMIT DROP;
  TRUNCATE rt_change;
  INSERT INTO rt_change
  SELECT p.seg_id, EXISTS (SELECT 1 FROM public.harness_routings r WHERE r.segment_id = p.seg_id AND NOT r.is_superseded)
  FROM (SELECT DISTINCT seg_id FROM rt_path) p
  WHERE (SELECT array_agg(landmark_id ORDER BY seq) FROM rt_path q WHERE q.seg_id = p.seg_id)
        IS DISTINCT FROM (SELECT array_agg(r.landmark_id ORDER BY r.seq) FROM public.harness_routings r WHERE r.segment_id = p.seg_id AND NOT r.is_superseded);
  SELECT count(*) FILTER (WHERE NOT had), count(*) FILTER (WHERE had) INTO n_routed, n_rerouted FROM rt_change;
  SELECT count(DISTINCT seg_id) - n_routed - n_rerouted INTO n_kept FROM rt_path;

  UPDATE public.harness_routings r SET is_superseded = true
  FROM rt_change c WHERE r.segment_id = c.seg_id AND NOT r.is_superseded;
  INSERT INTO public.harness_routings (segment_id, landmark_id, seq, source, observed_at, trust)
  SELECT p.seg_id, p.landmark_id, p.seq, 'route_harness_segments: the shortest chain of live branches between the plugs'' standing points (RSI pass 33)',
         now(), 'T3'
  FROM rt_path p JOIN rt_change c ON c.seg_id = p.seg_id;

  RETURN jsonb_build_object('segments_routed', n_routed, 'segments_rerouted', n_rerouted, 'segments_unchanged', n_kept,
                            'segments_plugs_share_a_point', n_same, 'segments_points_not_joined', n_unjoined,
                            'segments_with_an_unplaced_plug', n_unplaced, 'relaxation_rounds', n_iter);
END $fn$;
COMMENT ON FUNCTION public.route_harness_segments(uuid) IS 'Routes each live segment of the vehicle whose two plugs sit on standing, placed route-graph points along the shortest chain of live branches between them (undirected, weighted by distance_in). Writes harness_routings (seq 1..n) where a segment has no path or its path changed, superseding the old one; counts segments whose plugs share a point, whose points no branch chain joins, and whose plug is unplaced. Idempotent; the registry loader calls it after the branches. RSI pass 33, case ledger 13.12.3.';
REVOKE ALL ON FUNCTION public.route_harness_segments(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.route_harness_segments(uuid) TO service_role;

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, note) VALUES
  ('SH', 1, 'dimension', 'function', 'load_harness_branches', NULL, 'the design record''s branches land on the route graph after every load'),
  ('SH', 1, 'dimension', 'function', 'route_harness_segments', NULL, 'every segment between standing points is routed over the branches');

DO $check$
DECLARE r jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a scoreboard measure has no grain'; END IF;
  r := public.route_harness_segments('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  RAISE NOTICE 'RSI pass 33 on the K5 (branches arrive with the loader): %', r;
END $check$;

COMMIT;
