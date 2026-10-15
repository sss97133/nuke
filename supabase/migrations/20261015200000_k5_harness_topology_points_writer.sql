-- RSI pass 31 on the harness model: the design record's placements land on the route graph. Case ledger 13.12.3.
--
-- Pass 12 (20261015013000) wrote the route graph once, in its migration. Where the record had overtaken a twin anchor
-- and the new spot was open, it left a successor point with no coordinates: M130 and PDM30, "not placed: follows the
-- 61-pin to the driver side; the spot is open". Nothing could write a coordinate later, so the placement backlog
-- could only grow. Live as anon on 2026-10-15 18:18Z:
--   - wire ends at a node not yet placed: 254 / 985;
--   - segments with both plugs at a standing position: 46 / 670;
--   - segments routed over topology: 0 / 670.
--
-- The placement is now made. The system's engineering call (owner, 2026-09-29: "we are building this system") is
-- recorded as proposed in docs/wiring/calc-data/catalog/mounts.yaml, from a free-space study of the twin
-- (docs/wiring/research/2026-10-15_m130-pdm30-cab-placement.md):
--   - M130 at (0.55, -1.22, 0.987);
--   - PDM30 at (0.30, -1.30, 0.997);
-- in the twin frame, metres, on the dash underside left of the column, at medium-low confidence.
--
-- This pass: load_harness_topology_points(vehicle, rows, source) writes the design record's points. Each row is
-- {node_code, kind, x, y, z, pos_source, method, trust}. Writes are append-only, like every route-graph change since
-- pass 12:
--   - a point whose live row already has those coordinates and that pos_source is left alone;
--   - otherwise a new row is written and the live one is superseded onto it;
--   - a code with no live row gets one.
-- Points the rows do not name are untouched; the graph's other history stays with pass 12. The registry loader reads
-- the placed boxes from mounts.yaml and calls it before the plugs are keyed to the graph.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF to_regprocedure('public.key_harness_endpoints_to_topology(uuid)') IS NULL THEN
    RAISE EXCEPTION 'RSI pass 12 (20261015013000) has not run';
  END IF;
  IF to_regprocedure('public.load_harness_topology_points(uuid,jsonb,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'load_harness_topology_points already exists';
  END IF;
END $guard$;

CREATE FUNCTION public.load_harness_topology_points(p_vehicle_id uuid, p_rows jsonb, p_source text) RETURNS jsonb
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
  -- a new row unless the live one has the same coordinates (to the millimetre) and the same pos_source
  UPDATE topo_point p SET new_id = gen_random_uuid()
  WHERE NOT EXISTS (SELECT 1 FROM public.harness_topology_nodes n
                    WHERE n.id = p.live_id AND round(n.pos_x_m, 3) = round(p.x, 3) AND round(n.pos_y_m, 3) = round(p.y, 3)
                      AND round(n.pos_z_m, 3) = round(p.z, 3) AND n.pos_source IS NOT DISTINCT FROM p.pos_source);
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
COMMENT ON FUNCTION public.load_harness_topology_points(uuid, jsonb, text) IS 'Writes the design record''s placed points onto the vehicle''s route graph (harness_topology_nodes): a point whose live row has other coordinates or another pos_source gets a new row, and the live one is superseded onto it (append-only, as since RSI pass 12); an unchanged point is left alone; a code with no live row gets one. Rows: {node_code, kind, x, y, z (twin frame, m), pos_source, method, trust}. The registry loader passes the placed boxes of catalog/mounts.yaml and then keys the plugs. Idempotent; service role. RSI pass 31, case ledger 13.12.3.';
REVOKE ALL ON FUNCTION public.load_harness_topology_points(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.load_harness_topology_points(uuid, jsonb, text) TO service_role;

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, note) VALUES
  ('SH', 1, 'dimension', 'function', 'load_harness_topology_points', NULL, 'the design record''s placements land on the route graph after every load');

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a scoreboard measure has no grain'; END IF;
  RAISE NOTICE 'RSI pass 31: placements land with the loader''s next call to load_harness_topology_points';
END $check$;

COMMIT;
