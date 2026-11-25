-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_hero_make_heat -f this-file.sql
-- Proves 20261126014500_hero_make_heat_fold.sql: the guard accepts the live hero_heat it measured; the fold equals the
-- live per-make aggregate over public, undeleted, vehicle-kind cars; a refresh follows heat changes and drops a make with
-- no hot car left; an empty fold falls back to the live aggregate; a stale fold is served with its as-of (a cache, never
-- a gate); comment_velocity ranks from the day counts and still excludes private cars; the answer read as anon equals
-- the old function's lists; anon reads neither the fold nor the writer; applying twice leaves one job.
-- Rows are a disposable database's rows, never testimony.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- pg_cron stand-in
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(p_jobid bigint) RETURNS boolean LANGUAGE sql AS
$$ DELETE FROM cron.job WHERE jobid = p_jobid RETURNING true $$;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, year integer, make text, model text, is_public boolean DEFAULT true,
  deleted_at timestamptz, listing_kind text, heat_score numeric(5,2), sale_price integer, asking_price numeric,
  current_value numeric, primary_image_url text);
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.platform_config (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), config_key text UNIQUE, config_value jsonb,
  description text, updated_at timestamptz DEFAULT now(), updated_by uuid);
CREATE TABLE public.auction_comment_day_counts (
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE, posted_day date NOT NULL,
  n integer NOT NULL CHECK (n >= 0), folded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (vehicle_id, posted_day));
ALTER TABLE public.auction_comment_day_counts ENABLE ROW LEVEL SECURITY;

-- hero_heat exactly as live on 2026-11-25 (pg_get_functiondef, md5 3103e96f...)
CREATE OR REPLACE FUNCTION public.hero_heat()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET statement_timeout TO '10s'
AS $function$
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
    FROM vehicles v
    WHERE v.heat_score IS NOT NULL AND v.heat_score > 0
      AND v.is_public = true AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    ORDER BY v.heat_score DESC
    LIMIT 30
  ),
  comment_velocity AS (
    -- auction_comment_day_counts_v1: the stored per-car, per-UTC-day fold, not a scan of auction_comments
    SELECT
      c.vehicle_id AS id,
      sum(c.n)::bigint AS comment_count_7d,
      v.year,
      COALESCE(v.make, 'Unknown') AS make,
      v.model,
      v.primary_image_url AS thumbnail
    FROM auction_comment_day_counts c
    JOIN vehicles v ON v.id = c.vehicle_id
    WHERE c.posted_day > ((now() AT TIME ZONE 'UTC') - interval '7 days')::date
      AND c.n > 0
      AND v.is_public = true AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    GROUP BY c.vehicle_id, v.year, v.make, v.model, v.primary_image_url
    ORDER BY sum(c.n) DESC
    LIMIT 20
  ),
  make_heat AS (
    SELECT
      COALESCE(v.make, 'Unknown') AS make,
      SUM(v.heat_score) AS total_heat,
      count(*) AS cnt
    FROM vehicles v
    WHERE v.heat_score IS NOT NULL AND v.heat_score > 0
      AND v.is_public = true AND v.deleted_at IS NULL AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    GROUP BY v.make
    ORDER BY total_heat DESC
    LIMIT 20
  )
  SELECT jsonb_build_object(
    'top_hot', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'year', year, 'make', make, 'model', model,
      'heat_score', heat_score, 'thumbnail', thumbnail, 'price', price
    )), '[]'::jsonb) FROM hot_vehicles),
    'comment_velocity', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'year', year, 'make', make, 'model', model,
      'comment_count_7d', comment_count_7d, 'thumbnail', thumbnail
    )), '[]'::jsonb) FROM comment_velocity),
    'make_heat', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'make', make, 'total_heat', total_heat, 'count', cnt
    )), '[]'::jsonb) FROM make_heat)
  );
$function$
;
GRANT EXECUTE ON FUNCTION public.hero_heat() TO anon, authenticated;
DO $$ BEGIN
  IF md5(pg_get_functiondef('public.hero_heat()'::regprocedure)) <> '3103e96ff29ad556342b68324ebdf086' THEN
    RAISE EXCEPTION 'fixture hero_heat is not the live definition (md5 %)', md5(pg_get_functiondef('public.hero_heat()'::regprocedure)); END IF;
END $$;

-- Cars: makes Alpha (3 hot), Beta (2 hot), Gamma (1 hot); a private, a deleted and a non-vehicle Alpha that must not count;
-- a NULL make; one cold car. Distinct heat sums so no ordering ties.
INSERT INTO public.vehicles (id, year, make, model, is_public, deleted_at, listing_kind, heat_score, primary_image_url) VALUES
  ('a0000000-0000-0000-0000-000000000001', 1970, 'Alpha', 'A1', true,  NULL, NULL, 40.00, 'i1'),
  ('a0000000-0000-0000-0000-000000000002', 1971, 'Alpha', 'A2', true,  NULL, 'vehicle', 30.50, 'i2'),
  ('a0000000-0000-0000-0000-000000000003', 1972, 'Alpha', 'A3', true,  NULL, NULL, 10.25, 'i3'),
  ('a0000000-0000-0000-0000-000000000004', 1973, 'Beta',  'B1', true,  NULL, NULL, 45.00, 'i4'),
  ('a0000000-0000-0000-0000-000000000005', 1974, 'Beta',  'B2', true,  NULL, NULL, 12.00, 'i5'),
  ('a0000000-0000-0000-0000-000000000006', 1975, 'Gamma', 'G1', true,  NULL, NULL, 20.00, 'i6'),
  ('a0000000-0000-0000-0000-000000000007', 1976, 'Alpha', 'AP', false, NULL, NULL, 99.00, 'i7'),
  ('a0000000-0000-0000-0000-000000000008', 1977, 'Alpha', 'AD', true,  now(), NULL, 98.00, 'i8'),
  ('a0000000-0000-0000-0000-000000000009', 1978, 'Alpha', 'AN', true,  NULL, 'non_vehicle_item', 97.00, 'i9'),
  ('a0000000-0000-0000-0000-00000000000a', 1979, NULL,    'U1', true,  NULL, NULL, 5.00, 'i10'),
  ('a0000000-0000-0000-0000-00000000000b', 1980, 'Delta', 'D1', true,  NULL, NULL, 0, 'i11');
INSERT INTO public.auction_comment_day_counts (vehicle_id, posted_day, n) VALUES
  ('a0000000-0000-0000-0000-000000000001', (now() AT TIME ZONE 'UTC')::date, 7),
  ('a0000000-0000-0000-0000-000000000001', (now() AT TIME ZONE 'UTC')::date - 2, 5),
  ('a0000000-0000-0000-0000-000000000004', (now() AT TIME ZONE 'UTC')::date - 1, 9),
  ('a0000000-0000-0000-0000-000000000006', (now() AT TIME ZONE 'UTC')::date, 3),
  ('a0000000-0000-0000-0000-000000000007', (now() AT TIME ZONE 'UTC')::date, 50),
  ('a0000000-0000-0000-0000-000000000008', (now() AT TIME ZONE 'UTC')::date, 40),
  ('a0000000-0000-0000-0000-00000000000b', (now() AT TIME ZONE 'UTC')::date - 9, 60),
  ('a0000000-0000-0000-0000-00000000000b', (now() AT TIME ZONE 'UTC')::date, 0);

-- The old answer, read as anon, kept for comparison
CREATE TABLE public.t_old AS SELECT NULL::jsonb AS j;
SET ROLE anon;
SELECT public.hero_heat() AS j \gset old_
RESET ROLE;
UPDATE public.t_old SET j = :'old_j'::jsonb;

\ir ../migrations/20261126014500_hero_make_heat_fold.sql
\ir ../migrations/20261126014500_hero_make_heat_fold.sql

DO $t$
DECLARE o jsonb := (SELECT j FROM public.t_old); n jsonb; k text;
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'hero-make-heat-refresh') <> 1
     OR (SELECT count(*) FROM cron.job WHERE jobname = 'hero-make-heat-check') <> 1 THEN RAISE EXCEPTION 'job count is not 1'; END IF;
  IF (SELECT (config_value ->> 'interval_minutes')::int * (config_value ->> 'stale_after_intervals')::int
        FROM public.platform_config WHERE config_key = 'hero_make_heat') <> 30 THEN RAISE EXCEPTION 'staleness limit row missing'; END IF;
  IF (SELECT command FROM cron.job WHERE jobname = 'hero-make-heat-refresh') NOT LIKE '%statement_timeout = ''10s''%' THEN
    RAISE EXCEPTION 'refresh job does not run under the default 10 s'; END IF;
  PERFORM public.hero_make_heat_check();  -- fresh fold passes
  -- the fold equals the live aggregate
  IF EXISTS (
      (SELECT make, total_heat, vehicle_count::bigint FROM public.hero_make_heat
       EXCEPT SELECT COALESCE(make, 'Unknown'), sum(heat_score), count(*) FROM public.vehicles
               WHERE heat_score > 0 AND is_public AND deleted_at IS NULL AND listing_kind IS DISTINCT FROM 'non_vehicle_item' GROUP BY 1)
      UNION ALL
      (SELECT COALESCE(make, 'Unknown'), sum(heat_score), count(*) FROM public.vehicles
               WHERE heat_score > 0 AND is_public AND deleted_at IS NULL AND listing_kind IS DISTINCT FROM 'non_vehicle_item' GROUP BY 1
       EXCEPT SELECT make, total_heat, vehicle_count::bigint FROM public.hero_make_heat)) THEN
    RAISE EXCEPTION 'fold differs from the live aggregate'; END IF;
  IF (SELECT total_heat FROM public.hero_make_heat WHERE make = 'Alpha') <> 80.75 THEN RAISE EXCEPTION 'Alpha counted a hidden car'; END IF;

  -- read as anon: same lists as the old function
  SET LOCAL ROLE anon;
  n := public.hero_heat();
  RESET ROLE;
  FOREACH k IN ARRAY ARRAY['top_hot', 'comment_velocity', 'make_heat'] LOOP
    IF n -> k IS DISTINCT FROM o -> k THEN RAISE EXCEPTION '% differs: old % new %', k, o -> k, n -> k; END IF;
  END LOOP;
  IF n ->> 'make_heat_as_of' IS NULL THEN RAISE EXCEPTION 'as-of missing while the fold is filled'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(n -> 'comment_velocity') e
              WHERE e ->> 'id' IN ('a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000008')) THEN
    RAISE EXCEPTION 'comment_velocity lists a private or deleted car'; END IF;
  IF jsonb_array_length(n -> 'comment_velocity') <> 3 THEN RAISE EXCEPTION 'comment_velocity length %', n -> 'comment_velocity'; END IF;
END
$t$;

-- a cache, never a gate: a heat change is served stale (with its as-of) until the refresh, then followed; a make with no
-- hot car left leaves the fold
UPDATE public.vehicles SET heat_score = 0 WHERE id = 'a0000000-0000-0000-0000-000000000006';
UPDATE public.vehicles SET heat_score = 50 WHERE id = 'a0000000-0000-0000-0000-000000000005';
DO $t$
DECLARE n jsonb;
BEGIN
  SET LOCAL ROLE anon; n := public.hero_heat(); RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(n -> 'make_heat') e WHERE e ->> 'make' = 'Gamma') THEN
    RAISE EXCEPTION 'stale fold not served before the refresh'; END IF;
  PERFORM public.hero_make_heat_refresh();
  SET LOCAL ROLE anon; n := public.hero_heat(); RESET ROLE;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(n -> 'make_heat') e WHERE e ->> 'make' = 'Gamma')
     OR EXISTS (SELECT 1 FROM public.hero_make_heat WHERE make = 'Gamma') THEN RAISE EXCEPTION 'cold make kept after refresh'; END IF;
  IF (n -> 'make_heat' -> 0 ->> 'make') <> 'Beta' OR (n -> 'make_heat' -> 0 ->> 'total_heat')::numeric <> 95 THEN
    RAISE EXCEPTION 'refresh did not follow the heat change: %', n -> 'make_heat'; END IF;
END
$t$;

-- an empty fold falls back to the live aggregate, with no as-of
CREATE TABLE public.t_keep AS SELECT * FROM public.hero_make_heat;
DELETE FROM public.hero_make_heat;
DO $t$
DECLARE n jsonb;
BEGIN
  SET LOCAL ROLE anon; n := public.hero_heat(); RESET ROLE;
  IF jsonb_array_length(n -> 'make_heat') <> 3 OR (n -> 'make_heat' -> 0 ->> 'make') <> 'Beta' OR n ->> 'make_heat_as_of' IS NOT NULL THEN
    RAISE EXCEPTION 'empty fold did not fall back to the live aggregate: %', n; END IF;
END
$t$;

-- anon and authenticated reach neither the fold nor its writer
DO $t$
BEGIN
  IF has_table_privilege('anon', 'public.hero_make_heat', 'select') OR has_table_privilege('authenticated', 'public.hero_make_heat', 'select')
     OR has_function_privilege('anon', 'public.hero_make_heat_refresh()', 'execute')
     OR has_function_privilege('authenticated', 'public.hero_make_heat_refresh()', 'execute') THEN
    RAISE EXCEPTION 'fold or writer reachable by an API role'; END IF;
  IF NOT has_function_privilege('anon', 'public.hero_heat()', 'execute') THEN RAISE EXCEPTION 'anon lost hero_heat'; END IF;
END
$t$;
-- the refresh job's own command runs as written (refills the fold emptied above)
SELECT command AS refresh_cmd FROM cron.job WHERE jobname = 'hero-make-heat-refresh' \gset
:refresh_cmd
RESET statement_timeout;
RESET lock_timeout;

-- the check: an aged fold and an empty fold are failures (a raise is a failing job row in v_job_health)
UPDATE public.hero_make_heat SET computed_at = now() - interval '31 minutes';
DO $t$ BEGIN
  BEGIN PERFORM public.hero_make_heat_check(); RAISE EXCEPTION 'stale fold passed the check';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'stale fold passed the check' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%older than%' THEN RAISE; END IF; END;
END $t$;
UPDATE public.hero_make_heat SET computed_at = now() - interval '29 minutes';
SELECT public.hero_make_heat_check() IS NOT NULL AS within_two_intervals;
DELETE FROM public.hero_make_heat;
DO $t$ BEGIN
  BEGIN PERFORM public.hero_make_heat_check(); RAISE EXCEPTION 'empty fold passed the check';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'empty fold passed the check' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%empty%' THEN RAISE; END IF; END;
  IF has_function_privilege('anon', 'public.hero_make_heat_check()', 'execute') THEN RAISE EXCEPTION 'anon runs the check'; END IF;
END $t$;
\echo hero_make_heat_fold: ok
