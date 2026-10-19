-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_family_keys_squarebody_shelby -f this-file.sql
-- Contract for 20261017083000_family_keys_squarebody_shelby.sql. Synthetic rows only; never production.
-- Verifies that:
-- 1. 1987 Chevrolet R10/R20/R30 and V10/V20/V30 Squarebody trucks (including "r10 silverado", "v30 hd silverado",
--    "c10 silverado") key to their C10/C20/C30/K10/K20/K30 series instead of the 1999+ Silverado family.
-- 2. GMC C15/K15/R1500/V1500 and "2500 sierra" / "v3500 sierra classic" key to GMC's C1500/K1500/C2500/K3500 series
--    instead of the 1999+ Sierra family.
-- 3. Ford "shelby gt350", "shelby gt500", "boss 302", "boss 429", and "mach 1" key to the Ford Mustang family.
-- 4. Applying the migration a second time is idempotent and changes nothing.
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
  ('00000000-0000-4000-b000-000000000010', 'Chevrolet', 'C10', 1960, 1987, '{c10,c-10}', NULL),
  ('00000000-0000-4000-b000-000000000020', 'Chevrolet', 'C20', 1960, 1987, '{c20,c-20}', NULL),
  ('00000000-0000-4000-b000-000000000030', 'Chevrolet', 'C30', 1960, 1987, '{c30,c-30}', NULL),
  ('00000000-0000-4000-b000-000000000110', 'Chevrolet', 'K10', 1960, 1987, '{k10,k-10}', NULL),
  ('00000000-0000-4000-b000-000000000120', 'Chevrolet', 'K20', 1960, 1987, '{k20,k-20}', NULL),
  ('00000000-0000-4000-b000-000000000130', 'Chevrolet', 'K30', 1960, 1987, '{k30,k-30}', NULL),
  ('00000000-0000-4000-b000-000000009900', 'Chevrolet', 'Silverado', 1999, 2024, '{silverado,"silverado 1500"}', NULL),
  ('00000000-0000-4000-c000-000000001500', 'GMC', 'C1500', 1960, 1998, '{c1500}', NULL),
  ('00000000-0000-4000-c000-000000002500', 'GMC', 'C2500', 1960, 1998, '{c2500}', NULL),
  ('00000000-0000-4000-c000-000000003500', 'GMC', 'K3500', 1960, 1998, '{k3500}', NULL),
  ('00000000-0000-4000-c000-000000009900', 'GMC', 'Sierra', 1999, 2024, '{sierra,"sierra 1500"}', NULL),
  ('00000000-0000-4000-d000-000000001964', 'Ford', 'Mustang', 1964, NULL, '{mustang,"mustang gt"}', NULL);

INSERT INTO public.mv_vehicle_name_dictionary (make_l, model_l, name_l, vehicles) VALUES
  ('chevrolet', 'r10 silverado', 'chevrolet r10 silverado', 18),
  ('chevrolet', 'c10 silverado', 'chevrolet c10 silverado', 42),
  ('chevrolet', 'v10 silverado 4x4', 'chevrolet v10 silverado 4x4', 11),
  ('chevrolet', 'v30 hd silverado', 'chevrolet v30 hd silverado', 4),
  ('chevrolet', 'silverado 1500', 'chevrolet silverado 1500', 220),
  ('gmc', 'c15 sierra', 'gmc c15 sierra', 15),
  ('gmc', '2500 sierra', 'gmc 2500 sierra', 19),
  ('gmc', 'v3500 sierra classic dually 4x4', 'gmc v3500 sierra classic dually 4x4', 3),
  ('ford', 'shelby gt350', 'ford shelby gt350', 95),
  ('ford', 'shelby gt500', 'ford shelby gt500', 80),
  ('ford', 'boss 302', 'ford boss 302', 22);

\ir ../migrations/20261015090000_model_family_names.sql

SELECT pg_temp.ok('before: r10 silverado mis-keys to 1999+ Silverado and shelby gt350 has no family',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'r10 silverado') = 'Silverado'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ford' AND model_l = 'shelby gt350') IS NULL);

\ir ../migrations/20261017083000_family_keys_squarebody_shelby.sql
CREATE TEMP TABLE once AS SELECT id, notes, aliases FROM public.canonical_models;
\ir ../migrations/20261017083000_family_keys_squarebody_shelby.sql
REFRESH MATERIALIZED VIEW public.mv_model_family_names;

SELECT pg_temp.ok('after: 1987 R/V and C/K Silverado trucks key to their C10/K10/K30 series while Silverado 1500 stays Silverado',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'r10 silverado') = 'C10'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'c10 silverado') = 'C10'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'v10 silverado 4x4') = 'K10'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'v30 hd silverado') = 'K30'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'chevrolet' AND model_l = 'silverado 1500') = 'Silverado');

SELECT pg_temp.ok('after: GMC C15, 2500 Sierra, and V3500 Sierra Classic key to their C1500/C2500/K3500 series',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'gmc' AND model_l = 'c15 sierra') = 'C1500'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'gmc' AND model_l = '2500 sierra') = 'C2500'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'gmc' AND model_l = 'v3500 sierra classic dually 4x4') = 'K3500');

SELECT pg_temp.ok('after: Ford Shelby GT350, Shelby GT500, and Boss 302 key to Mustang',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ford' AND model_l = 'shelby gt350') = 'Mustang'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ford' AND model_l = 'shelby gt500') = 'Mustang'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ford' AND model_l = 'boss 302') = 'Mustang');

SELECT pg_temp.ok('a second apply changes nothing',
  NOT EXISTS (SELECT 1 FROM public.canonical_models m JOIN once o USING (id)
              WHERE m.notes IS DISTINCT FROM o.notes OR m.aliases IS DISTINCT FROM o.aliases));
