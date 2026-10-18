-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_family_keys_gt40_syclone_pickup -f this-file.sql
-- Contract for 20261018061000_family_keys_gt40_syclone_pickup.sql. Synthetic rows only; never production.
-- Verifies that:
-- 1. Ford "gt40", "gt40 mk i", and "gt40 prototype" key to Ford GT40 (1964-2024) instead of Ford GT (2004+).
-- 2. GMC "syclone" keys to GMC Syclone (1991-1992) and GMC "1500" keys to GMC C1500.
-- 3. Chevrolet "silverado 1500" keys to Chevrolet Silverado instead of 1988-1998 C1500, and "pickup" / "custom pickup"
--    key to Chevrolet Pickup.
-- 4. Ford "hi-boy" keys to Roadster, "3-window custom coupe" keys to Coupe, "shelby super snake" keys to Mustang, and
--    "thunderbolt" keys to Fairlane.
-- 5. Applying the migration a second time is idempotent and changes nothing.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.canonical_models') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command) RETURNING jobid $$;

CREATE TABLE public.canonical_makes (id uuid PRIMARY KEY, canonical_name text, display_name text, short_name text,
  aliases text[], country_of_origin text, founded_year integer, parent_company text, is_active boolean,
  created_at timestamptz, brand_tier text);
CREATE TABLE public.canonical_models (id uuid PRIMARY KEY, make text, canonical_model text, canonical_series text,
  year_start integer, year_end integer, body_styles text[], aliases text[], generation text, notes text, created_at timestamptz);
CREATE TABLE public.mv_vehicle_name_dictionary (make_l text, model_l text, name_l text, vehicles bigint,
  PRIMARY KEY (make_l, model_l));

INSERT INTO public.canonical_makes (id, canonical_name, display_name, short_name, aliases) VALUES
  ('00000000-0000-4000-a000-000000000004', 'Chevrolet', 'Chevrolet', 'Chevy', '{}'),
  ('00000000-0000-4000-a000-000000000005', 'GMC', 'GMC', NULL, '{}'),
  ('00000000-0000-4000-a000-000000000002', 'Ford', 'Ford', NULL, '{}');

INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases, notes) VALUES
  ('00000000-0000-4000-b000-000000001500', 'Chevrolet', 'C1500', 1988, 1998, '{c1500,"c-1500",1500,"silverado 1500"}', NULL),
  ('00000000-0000-4000-b000-000000009900', 'Chevrolet', 'Silverado', NULL, NULL, '{silverado}', NULL),
  ('00000000-0000-4000-c000-000000001500', 'GMC', 'C1500', 1960, 1998, '{c1500,"c-1500"}', NULL),
  ('00000000-0000-4000-c000-000000009900', 'GMC', 'Sierra', 1999, 2024, '{sierra}', NULL),
  ('00000000-0000-4000-d000-000000002004', 'Ford', 'GT', 2004, NULL, '{gt,"ford gt","gt supercar",gt40,"gt 40"}', NULL),
  ('00000000-0000-4000-d000-000000001964', 'Ford', 'Mustang', 1964, NULL, '{mustang,"mustang gt"}', NULL),
  ('00000000-0000-4000-d000-000000001903', 'Ford', 'Roadster', 1903, 1936, '{roadster,"custom roadster"}', NULL),
  ('00000000-0000-4000-d000-000000001917', 'Ford', 'Coupe', 1917, 1940, '{coupe}', NULL),
  ('00000000-0000-4000-d000-000000001938', 'Ford', 'Deluxe', 1938, 1951, '{deluxe}', NULL),
  ('00000000-0000-4000-d000-000000001955', 'Ford', 'Fairlane', 1955, 1970, '{fairlane}', NULL);

INSERT INTO public.mv_vehicle_name_dictionary (make_l, model_l, name_l, vehicles) VALUES
  ('ford', 'gt40', 'ford gt40', 14),
  ('ford', 'gt40 mk i', 'ford gt40 mk i', 4),
  ('ford', 'gt', 'ford gt', 180),
  ('ford', 'hi-boy', 'ford hi-boy', 74),
  ('ford', '3-window custom coupe', 'ford 3-window custom coupe', 26),
  ('ford', 'shelby super snake', 'ford shelby super snake', 27),
  ('ford', 'thunderbolt', 'ford thunderbolt', 6),
  ('gmc', 'syclone', 'gmc syclone', 82),
  ('gmc', '1500', 'gmc 1500', 59),
  ('chevrolet', 'silverado 1500', 'chevrolet silverado 1500', 68),
  ('chevrolet', 'pickup', 'chevrolet pickup', 396),
  ('chevrolet', 'custom pickup', 'chevrolet custom pickup', 95);

\ir ../migrations/20261015090000_model_family_names.sql

SELECT pg_temp.ok('before: gt40 mis-keys to 2004+ GT, silverado 1500 mis-keys to C1500, and syclone has no family',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ford' AND model_l = 'gt40') = 'GT'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'silverado 1500') = 'C1500'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'gmc' AND model_l = 'syclone') IS NULL);

\ir ../migrations/20261018061000_family_keys_gt40_syclone_pickup.sql
CREATE TEMP TABLE once AS SELECT id, year_start, year_end, notes, aliases FROM public.canonical_models;
\ir ../migrations/20261018061000_family_keys_gt40_syclone_pickup.sql
REFRESH MATERIALIZED VIEW public.mv_model_family_names;

SELECT pg_temp.ok('after: Ford GT40 and GT40 Mk I key to GT40 while Ford GT stays GT',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ford' AND model_l = 'gt40') = 'GT40'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ford' AND model_l = 'gt40 mk i') = 'GT40'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ford' AND model_l = 'gt') = 'GT');

SELECT pg_temp.ok('after: GMC Syclone, GMC 1500, Chevrolet Silverado 1500, and Chevrolet Pickup key to their families',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'gmc' AND model_l = 'syclone') = 'Syclone'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'gmc' AND model_l = '1500') = 'C1500'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'silverado 1500') = 'Silverado'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'pickup') = 'Pickup'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'custom pickup') = 'Pickup');

SELECT pg_temp.ok('after: Ford Hi-Boy, 3-Window Custom Coupe, Shelby Super Snake, and Thunderbolt key to their families',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ford' AND model_l = 'hi-boy') = 'Roadster'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ford' AND model_l = '3-window custom coupe') = 'Coupe'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ford' AND model_l = 'shelby super snake') = 'Mustang'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ford' AND model_l = 'thunderbolt') = 'Fairlane');

SELECT pg_temp.ok('a second apply changes nothing',
  NOT EXISTS (SELECT 1 FROM public.canonical_models m JOIN once o USING (id)
              WHERE m.year_start IS DISTINCT FROM o.year_start
                 OR m.year_end IS DISTINCT FROM o.year_end
                 OR m.notes IS DISTINCT FROM o.notes
                 OR m.aliases IS DISTINCT FROM o.aliases));
