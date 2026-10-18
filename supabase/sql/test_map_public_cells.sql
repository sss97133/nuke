-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_map_public_cells -f this-file.sql
-- Proves that mv_map_public_cells (20261014120000) answers map-vehicles' cluster and histogram reads exactly as the
-- live reads with the public test do, at every precision and both confidence bands; that private and deleted
-- vehicles never count; that the refresher fills it plainly the first time and concurrently after, with its clock;
-- the two cron jobs; and that the API roles can neither read it nor refresh it. The seeds are synthetic rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
-- pg_cron is not in a stock PG17: a stand-in schema with the two calls the migration makes.
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command) ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(p_name text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = p_name RETURNING true $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
SET TIME ZONE 'UTC';

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean, deleted_at timestamptz, sale_price integer);
CREATE TABLE public.vehicle_location_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL, source_type text NOT NULL, source_platform text,
  observed_at timestamptz NOT NULL, latitude double precision, longitude double precision, confidence real
);
-- 300 vehicles: every tenth private, every fifteenth deleted
INSERT INTO public.vehicles SELECT md5('mv' || g)::uuid, g % 10 <> 0, CASE WHEN g % 15 = 0 THEN now() END, 1000 * g
FROM generate_series(1, 300) g;
-- 6,000 observations: coordinates that round differently at 0.01, 0.1 and 1 degree (x.x49, x.x55, x.95, negative
-- halves), confidences around both bands (0.4 out, 0.5, 0.69, 0.7 exactly in real, 0.95, NULL), sources with NULL,
-- several event types, months over three years, a few rows without coordinates.
INSERT INTO public.vehicle_location_observations (vehicle_id, source_type, source_platform, observed_at, latitude, longitude, confidence)
SELECT md5('mv' || (1 + g % 300))::uuid,
       (ARRAY['listing', 'sighting', 'auction', 'sale'])[1 + g % 4],
       (ARRAY['bat', 'carsandbids', NULL, 'craigslist', 'bat'])[1 + g % 5],
       timestamptz '2024-01-01' + (g * 4.3) * interval '1 hour',
       CASE WHEN g % 211 = 0 THEN NULL ELSE 30 + (g % 17) * 0.149 + (g % 7) * 0.0055 + (ARRAY[0, 0.004, 0.0049, 0.005])[1 + g % 4] END,
       CASE WHEN g % 223 = 0 THEN NULL ELSE -120 + (g % 23) * 0.95 - (g % 5) * 0.0045 - (ARRAY[0, 0.005, 0.05, 0.5])[1 + g % 4] END,
       (ARRAY[0.4, 0.5, 0.69, 0.7, 0.95, NULL, 0.7, 0.85]::real[])[1 + g % 8]
FROM generate_series(1, 6000) g;

\ir ../migrations/20261014120000_map_public_cells.sql
\ir ../migrations/20261014120000_map_public_cells.sql

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;

-- 1. Created empty; the recurring job and the one-shot that unschedules itself first.
SELECT public.t_assert(NOT (SELECT relispopulated FROM pg_class WHERE oid = 'public.mv_map_public_cells'::regclass), 'created without data');
SELECT public.t_assert((SELECT schedule FROM cron.job WHERE jobname = 'map-public-cells-refresh') = '25 */6 * * *'
  AND (SELECT command FROM cron.job WHERE jobname = 'map-public-cells-refresh') LIKE '%SELECT public.refresh_map_public_cells();%', 'refresh every 6 hours');
SELECT public.t_assert((SELECT command FROM cron.job WHERE jobname = 'map-public-cells-fill-once-20261014') LIKE 'SELECT cron.unschedule(''map-public-cells-fill-once-20261014'');%',
  'the one-shot unschedules itself before it refreshes');

-- 2. First fill (plain), then the clock.
SELECT public.refresh_map_public_cells();
SELECT public.t_assert((SELECT relispopulated FROM pg_class WHERE oid = 'public.mv_map_public_cells'::regclass), 'filled');
SELECT public.t_assert((SELECT refreshed_at FROM public.mv_map_public_cells_clock) IS NOT NULL, 'clock set');

-- The live reads map-vehicles sends (with the public test) and the fold reads it sends instead (cells.ts).
CREATE FUNCTION public.t_live_clusters(p int, conf real) RETURNS TABLE(lng float8, lat float8, count int, sources text[], event_types text[], avg_confidence float4)
LANGUAGE plpgsql AS $$ BEGIN RETURN QUERY EXECUTE format($q$
  SELECT ROUND(vlo.longitude::numeric, %1$s)::float8, ROUND(vlo.latitude::numeric, %1$s)::float8, COUNT(*)::int,
         array_agg(DISTINCT vlo.source_platform ORDER BY vlo.source_platform) FILTER (WHERE vlo.source_platform IS NOT NULL),
         array_agg(DISTINCT vlo.source_type ORDER BY vlo.source_type), AVG(vlo.confidence)::float4
  FROM public.vehicle_location_observations vlo
  JOIN public.vehicles v ON v.id = vlo.vehicle_id AND v.is_public AND v.deleted_at IS NULL
  WHERE vlo.latitude IS NOT NULL AND vlo.longitude IS NOT NULL AND vlo.latitude BETWEEN -90 AND 90 AND vlo.longitude BETWEEN -180 AND 180
    AND vlo.confidence >= $1
  GROUP BY 1, 2$q$, p) USING conf; END $$;
CREATE FUNCTION public.t_cell_clusters(p int, conf real) RETURNS TABLE(lng float8, lat float8, count int, sources text[], event_types text[], avg_confidence float4)
LANGUAGE plpgsql AS $$ BEGIN RETURN QUERY EXECUTE format($q$
  SELECT lng%1$s, lat%1$s, SUM(n)::int,
         array_agg(DISTINCT source_platform ORDER BY source_platform) FILTER (WHERE source_platform <> ''),
         array_agg(DISTINCT source_type ORDER BY source_type), (SUM(confidence_sum) / SUM(n))::float4
  FROM public.mv_map_public_cells
  WHERE lat2 BETWEEN -90 AND 90 AND lng2 BETWEEN -180 AND 180 %2$s
  GROUP BY 1, 2$q$, p, CASE WHEN conf >= 0.7::real THEN 'AND conf70' ELSE '' END); END $$;

-- 3. Every precision and band: the same cells, counts, sources and event types; the mean confidence to 1e-5.
DO $$
DECLARE p int; conf real; n_live int; n_diff int; n_conf int;
BEGIN
  FOREACH p IN ARRAY ARRAY[0, 1, 2] LOOP
    FOREACH conf IN ARRAY ARRAY[0.5, 0.7]::real[] LOOP
      SELECT count(*) INTO n_live FROM public.t_live_clusters(p, conf);
      SELECT count(*) INTO n_diff FROM (
        (SELECT lng, lat, count, sources, event_types FROM public.t_live_clusters(p, conf)
         EXCEPT SELECT lng, lat, count, sources, event_types FROM public.t_cell_clusters(p, conf))
        UNION ALL
        (SELECT lng, lat, count, sources, event_types FROM public.t_cell_clusters(p, conf)
         EXCEPT SELECT lng, lat, count, sources, event_types FROM public.t_live_clusters(p, conf))) d;
      SELECT count(*) INTO n_conf FROM public.t_live_clusters(p, conf) l JOIN public.t_cell_clusters(p, conf) c USING (lng, lat)
        WHERE abs(l.avg_confidence - c.avg_confidence) > 1e-5;
      PERFORM public.t_assert(n_live > 0 AND n_diff = 0 AND n_conf = 0,
        format('precision %s, confidence %s: %s live cells, %s differ, %s mean confidences differ', p, conf, n_live, n_diff, n_conf));
    END LOOP;
  END LOOP;
END $$;

-- 4. The month histogram, both bands.
DO $$
DECLARE conf real; n_diff int;
BEGIN
  FOREACH conf IN ARRAY ARRAY[0.5, 0.7]::real[] LOOP
    SELECT count(*) INTO n_diff FROM (
      (SELECT to_char(date_trunc('month', vlo.observed_at), 'YYYY-MM') AS month, COUNT(*)::int AS count
       FROM public.vehicle_location_observations vlo JOIN public.vehicles v ON v.id = vlo.vehicle_id AND v.is_public AND v.deleted_at IS NULL
       WHERE vlo.latitude IS NOT NULL AND vlo.longitude IS NOT NULL AND vlo.confidence >= conf GROUP BY 1
       EXCEPT
       SELECT month, SUM(n)::int FROM public.mv_map_public_cells WHERE conf >= 0.7::real IS NOT TRUE OR conf70 GROUP BY 1)
      UNION ALL
      (SELECT month, SUM(n)::int FROM public.mv_map_public_cells WHERE conf >= 0.7::real IS NOT TRUE OR conf70 GROUP BY 1
       EXCEPT
       SELECT to_char(date_trunc('month', vlo.observed_at), 'YYYY-MM'), COUNT(*)::int
       FROM public.vehicle_location_observations vlo JOIN public.vehicles v ON v.id = vlo.vehicle_id AND v.is_public AND v.deleted_at IS NULL
       WHERE vlo.latitude IS NOT NULL AND vlo.longitude IS NOT NULL AND vlo.confidence >= conf GROUP BY 1)) d;
    PERFORM public.t_assert(n_diff = 0, format('histogram at confidence %s: %s months differ', conf, n_diff));
  END LOOP;
END $$;
SELECT public.t_assert((SELECT sum(n) FROM public.mv_map_public_cells WHERE conf70)
  = (SELECT count(*) FROM public.vehicle_location_observations vlo JOIN public.vehicles v ON v.id = vlo.vehicle_id
     WHERE v.is_public AND v.deleted_at IS NULL AND vlo.latitude IS NOT NULL AND vlo.longitude IS NOT NULL AND vlo.confidence >= 0.7::real),
  'the 0.7 band counts 0.7 stored as real, as the live untyped parameter does');

-- 5. Private and deleted vehicles never count.
SELECT public.t_assert((SELECT sum(n) FROM public.mv_map_public_cells)
  = (SELECT count(*) FROM public.vehicle_location_observations vlo JOIN public.vehicles v ON v.id = vlo.vehicle_id
     WHERE v.is_public AND v.deleted_at IS NULL AND vlo.latitude IS NOT NULL AND vlo.longitude IS NOT NULL AND vlo.confidence >= 0.5)
  AND (SELECT sum(n) FROM public.mv_map_public_cells)
  < (SELECT count(*) FROM public.vehicle_location_observations vlo WHERE vlo.latitude IS NOT NULL AND vlo.longitude IS NOT NULL AND vlo.confidence >= 0.5),
  'only public, undeleted vehicles count');

-- 6. A vehicle that turns private leaves the fold at the next (concurrent) refresh; the clock moves.
CREATE TEMP TABLE t_clock AS SELECT refreshed_at FROM public.mv_map_public_cells_clock;
CREATE TEMP TABLE t_before AS SELECT sum(n) AS n FROM public.mv_map_public_cells;
UPDATE public.vehicles SET is_public = false WHERE id = md5('mv1')::uuid;
SELECT pg_sleep(0.01);
SELECT public.refresh_map_public_cells();
SELECT public.t_assert((SELECT sum(n) FROM public.mv_map_public_cells)
  = (SELECT n FROM t_before) - (SELECT count(*) FROM public.vehicle_location_observations vlo
       WHERE vlo.vehicle_id = md5('mv1')::uuid AND vlo.latitude IS NOT NULL AND vlo.longitude IS NOT NULL AND vlo.confidence >= 0.5),
  'the newly private vehicle left the fold');
SELECT public.t_assert((SELECT refreshed_at FROM public.mv_map_public_cells_clock) > (SELECT refreshed_at FROM t_clock), 'the clock moved');

-- 7. Grants: the API roles cannot read the fold or refresh it.
SELECT public.t_assert(NOT has_table_privilege('anon', 'public.mv_map_public_cells', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.mv_map_public_cells', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.mv_map_public_cells_clock', 'SELECT'), 'anon and authenticated read neither view');
SELECT public.t_assert(has_table_privilege('service_role', 'public.mv_map_public_cells', 'SELECT'), 'the service role reads it');
SELECT public.t_assert(NOT has_function_privilege('anon', 'public.refresh_map_public_cells()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.refresh_map_public_cells()', 'EXECUTE'), 'the API roles cannot refresh it');

SELECT 'mv_map_public_cells contract: all checks passed' AS result;
