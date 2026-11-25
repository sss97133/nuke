-- hero_make_heat_v1: hero_heat reads its per-make block from a stored fold, and ranks comment velocity before it
-- touches vehicles.
--
-- WHY. Measured 2026-11-25 04:45-04:51 PT through REST as anon: hero_heat answered 500 (57014) at 10.1-10.4 s on 7 of
-- 11 calls; the slow backends waited in IO:DataFileRead with no lock wait. Warm, EXPLAIN (ANALYZE, BUFFERS) of the body
-- is 683 ms over 45,304 buffers: make_heat 35,779 (an index-only scan of all 119,175 heat > 0 rows with 37,266 heap
-- fetches, because vehicles' visibility map is mostly not all-visible), comment_velocity 9,492 (2,185 vehicles_pkey
-- lookups before its LIMIT 20), top_hot 33. Cold, those random heap pages are the 10 s.
--
-- FOLD. hero_make_heat(make, total_heat, vehicle_count, computed_at): the sum and count of heat_score per make over the
-- public, undeleted, vehicle-kind cars with heat_score > 0, the same test hero_heat applies. Written only by
-- hero_make_heat_refresh() (one statement: upsert every make's aggregate, delete makes no longer present), every 15
-- minutes by job 'hero-make-heat-refresh'. heat_score's only writer is compute_nuke_estimates_bulk, which no job runs on
-- a clock, so a 15-minute fold lags it by at most 15 minutes. A NULL make is folded as 'Unknown', as the reader shows it.
--
-- READER. hero_heat.make_heat reads the fold's top 20 and says when it was computed (make_heat_as_of). The fold is a
-- cache, never a gate: while it is empty the block is the live aggregate it replaced and make_heat_as_of is null.
-- comment_velocity ranks cars by their 7-day count from auction_comment_day_counts alone, then joins vehicles for the top
-- 200 only and applies the visibility test (2,183 of 2,185 ranked cars passed it on 2026-11-25). Keys and element shapes
-- of the answer are unchanged; each list is ordered explicitly (ties by id or make). search_path is pinned.
--
-- HEALTH. The refresh is the aggregate that can take 10 s cold (skeptic2, 2026-11-25: 57014 twice, then 0.84 s warm), so
-- a cold run can fail under the job's 10 s statement_timeout; it then rolls back and the reader keeps the last fold.
-- hero_make_heat_check() raises when the fold is empty or its newest computed_at is older than
-- stale_after_intervals x interval_minutes (platform_config 'hero_make_heat'); job 'hero-make-heat-check' runs it, so a
-- stale fold is a failing row in v_job_health with its reason, not only an old make_heat_as_of. Splitting the refresh
-- into bounded statements, so a cold run cannot fail, is the follow-up.
--
-- GUARD. Refuses to replace a hero_heat whose definition is not the live one measured above (md5 3103e96f...) unless it
-- is already this version.
SET lock_timeout = '5s';

DO $guard$
DECLARE d text := pg_get_functiondef('public.hero_heat()'::regprocedure);
BEGIN
  IF md5(d) <> '3103e96ff29ad556342b68324ebdf086' AND position('hero_make_heat_v1' IN d) = 0 THEN
    RAISE EXCEPTION 'hero_make_heat_v1: hero_heat drifted from the measured definition (md5 %)', md5(d);
  END IF;
END
$guard$;

CREATE TABLE IF NOT EXISTS public.hero_make_heat (
  make text PRIMARY KEY,
  total_heat numeric NOT NULL CHECK (total_heat > 0),
  vehicle_count integer NOT NULL CHECK (vehicle_count > 0),
  computed_at timestamptz NOT NULL
);
ALTER TABLE public.hero_make_heat ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hero_make_heat FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.hero_make_heat TO service_role;
COMMENT ON TABLE public.hero_make_heat IS
  'hero_make_heat_v1: sum and count of heat_score per make over public, undeleted, vehicle-kind cars with heat_score > 0. Written only by hero_make_heat_refresh() (job hero-make-heat-refresh, every 15 min). Read by hero_heat.make_heat.';

CREATE OR REPLACE FUNCTION public.hero_make_heat_refresh()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE n integer;
BEGIN
  WITH agg AS (
    SELECT COALESCE(v.make, 'Unknown') AS make, sum(v.heat_score) AS total_heat, count(*)::integer AS cnt
      FROM public.vehicles v
     WHERE v.heat_score IS NOT NULL AND v.heat_score > 0
       AND v.is_public = true AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
     GROUP BY 1
  ), gone AS (
    DELETE FROM public.hero_make_heat h WHERE NOT EXISTS (SELECT 1 FROM agg WHERE agg.make = h.make) RETURNING 1
  ), up AS (
    INSERT INTO public.hero_make_heat AS h (make, total_heat, vehicle_count, computed_at)
    SELECT make, total_heat, cnt, now() FROM agg
    ON CONFLICT (make) DO UPDATE
      SET total_heat = EXCLUDED.total_heat, vehicle_count = EXCLUDED.vehicle_count, computed_at = EXCLUDED.computed_at
    RETURNING 1
  )
  SELECT count(*)::integer INTO n FROM up;  -- gone runs to completion whether or not it is read
  RETURN n;
END
$f$;
REVOKE ALL ON FUNCTION public.hero_make_heat_refresh() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hero_make_heat_refresh() TO service_role;

INSERT INTO public.platform_config (config_key, config_value, description)
VALUES ('hero_make_heat',
        jsonb_build_object('interval_minutes', 15, 'stale_after_intervals', 2,
          'basis', 'refresh job hero-make-heat-refresh runs every 15 min; a fold older than 2 runs means at least two consecutive failed refreshes'),
        'hero_make_heat_v1: the refresh interval and the staleness limit hero_make_heat_check() enforces')
ON CONFLICT (config_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.hero_make_heat_check()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE newest timestamptz; lim interval;
BEGIN
  SELECT make_interval(mins => ((c.config_value ->> 'interval_minutes')::int * (c.config_value ->> 'stale_after_intervals')::int))
    INTO lim FROM public.platform_config c WHERE c.config_key = 'hero_make_heat';
  IF lim IS NULL THEN RAISE EXCEPTION 'hero_make_heat_check: platform_config hero_make_heat is missing its interval'; END IF;
  SELECT max(computed_at) INTO newest FROM public.hero_make_heat;
  IF newest IS NULL THEN RAISE EXCEPTION 'hero_make_heat_check: the fold is empty; hero_heat reads the live aggregate'; END IF;
  IF newest < now() - lim THEN
    RAISE EXCEPTION 'hero_make_heat_check: the fold was computed at %, older than % (hero-make-heat-refresh is failing)', newest, lim;
  END IF;
  RETURN newest;
END
$f$;
REVOKE ALL ON FUNCTION public.hero_make_heat_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hero_make_heat_check() TO service_role;

SELECT public.hero_make_heat_refresh() AS makes_folded;

DO $job$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'hero-make-heat-refresh';
  PERFORM cron.schedule('hero-make-heat-refresh', '*/15 * * * *',
    'SET client_min_messages = error; SET statement_timeout = ''10s''; SET lock_timeout = ''5s''; '
    'SELECT public.hero_make_heat_refresh();');
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'hero-make-heat-check';
  PERFORM cron.schedule('hero-make-heat-check', '7,22,37,52 * * * *',
    'SET client_min_messages = error; SET statement_timeout = ''10s''; SET lock_timeout = ''5s''; '
    'SELECT public.hero_make_heat_check();');
END
$job$;

CREATE OR REPLACE FUNCTION public.hero_heat()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '10s'
 SET search_path = public, pg_temp
AS $function$
  -- hero_make_heat_v1: make_heat from the stored fold (live aggregate only while it is empty); comment_velocity ranks
  -- from auction_comment_day_counts before it reads vehicles
  WITH hot_vehicles AS (
    SELECT
      v.id,
      v.year,
      COALESCE(v.make, 'Unknown') AS make,
      v.model,
      v.heat_score,
      v.primary_image_url AS thumbnail,
      COALESCE(
        NULLIF(v.sale_price, 0)::numeric,
        NULLIF(v.asking_price, 0::numeric),
        NULLIF(v.current_value, 0::numeric)
      ) AS price
    FROM public.vehicles v
    WHERE v.heat_score IS NOT NULL AND v.heat_score > 0
      AND v.is_public = true AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    ORDER BY v.heat_score DESC, v.id
    LIMIT 30
  ),
  velocity_rank AS (
    SELECT c.vehicle_id, sum(c.n)::bigint AS comment_count_7d
    FROM public.auction_comment_day_counts c
    WHERE c.posted_day > ((now() AT TIME ZONE 'UTC') - interval '7 days')::date
      AND c.n > 0
    GROUP BY c.vehicle_id
    ORDER BY sum(c.n) DESC, c.vehicle_id
    LIMIT 200
  ),
  comment_velocity AS (
    SELECT
      r.vehicle_id AS id,
      r.comment_count_7d,
      v.year,
      COALESCE(v.make, 'Unknown') AS make,
      v.model,
      v.primary_image_url AS thumbnail
    FROM velocity_rank r
    JOIN public.vehicles v ON v.id = r.vehicle_id
    WHERE v.is_public = true AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    ORDER BY r.comment_count_7d DESC, r.vehicle_id
    LIMIT 20
  ),
  make_fold AS (
    SELECT f.make, f.total_heat, f.vehicle_count::bigint AS cnt
    FROM public.hero_make_heat f
    ORDER BY f.total_heat DESC, f.make
    LIMIT 20
  ),
  make_live AS (
    SELECT
      COALESCE(v.make, 'Unknown') AS make,
      SUM(v.heat_score) AS total_heat,
      count(*) AS cnt
    FROM public.vehicles v
    WHERE NOT EXISTS (SELECT 1 FROM public.hero_make_heat)
      AND v.heat_score IS NOT NULL AND v.heat_score > 0
      AND v.is_public = true AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    GROUP BY 1
    ORDER BY total_heat DESC, 1
    LIMIT 20
  ),
  make_heat AS (
    SELECT make, total_heat, cnt FROM make_fold
    UNION ALL
    SELECT make, total_heat, cnt FROM make_live
  )
  SELECT jsonb_build_object(
    'top_hot', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'year', year, 'make', make, 'model', model,
      'heat_score', heat_score, 'thumbnail', thumbnail, 'price', price
    ) ORDER BY heat_score DESC, id), '[]'::jsonb) FROM hot_vehicles),
    'comment_velocity', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'year', year, 'make', make, 'model', model,
      'comment_count_7d', comment_count_7d, 'thumbnail', thumbnail
    ) ORDER BY comment_count_7d DESC, id), '[]'::jsonb) FROM comment_velocity),
    'make_heat', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'make', make, 'total_heat', total_heat, 'count', cnt
    ) ORDER BY total_heat DESC, make), '[]'::jsonb) FROM make_heat),
    'make_heat_as_of', (SELECT max(computed_at) FROM public.hero_make_heat)
  );
$function$;
