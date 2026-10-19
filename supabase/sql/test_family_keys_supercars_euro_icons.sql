-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_family_keys_supercars_euro_icons -f this-file.sql
-- Contract for 20261018062000_family_keys_supercars_euro_icons.sql. Synthetic rows only; never production.
-- Verifies that:
-- 1. Ferrari "laferrari", "laferrari aperta", "f12berlinetta", "f12tdf", and "f512 m" key to their Ferrari families.
-- 2. McLaren "f1", "f1 gtr", and "speedtail" key to McLaren F1 and Speedtail.
-- 3. Lamborghini "miura p400 sv" and "countach 5000 qv" key to Miura and Countach.
-- 4. Mercedes-Benz "sls amg black series", "clk63 amg black series", "560sec", and "e63 s 4matic wagon" key to their families.
-- 5. Aston Martin "db5", Audi "rs6 avant" & "rs4", Volkswagen "type ii", and Lancia "aurelia b24s spider america" key cleanly.
-- 6. Applying the migration a second time is idempotent and changes nothing.
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

INSERT INTO public.canonical_makes (id, canonical_name, display_name, aliases) VALUES
  ('00000000-0000-4000-a000-000000000010', 'Ferrari', 'Ferrari', '{}'),
  ('00000000-0000-4000-a000-000000000011', 'McLaren', 'McLaren', '{}'),
  ('00000000-0000-4000-a000-000000000012', 'Lamborghini', 'Lamborghini', '{}'),
  ('00000000-0000-4000-a000-000000000013', 'Mercedes-Benz', 'Mercedes-Benz', '{}'),
  ('00000000-0000-4000-a000-000000000014', 'Aston Martin', 'Aston Martin', '{}'),
  ('00000000-0000-4000-a000-000000000015', 'Audi', 'Audi', '{}'),
  ('00000000-0000-4000-a000-000000000016', 'Volkswagen', 'Volkswagen', '{}'),
  ('00000000-0000-4000-a000-000000000017', 'Jaguar', 'Jaguar', '{}'),
  ('00000000-0000-4000-a000-000000000018', 'Porsche', 'Porsche', '{}'),
  ('00000000-0000-4000-a000-000000000019', 'Shelby', 'Shelby', '{}');

INSERT INTO public.canonical_models (id, make, canonical_model, year_start, year_end, aliases, notes) VALUES
  ('00000000-0000-4000-f000-000000000001', 'Ferrari', 'La Ferrari', NULL, NULL, '{"la ferrari"}', NULL),
  ('00000000-0000-4000-f000-000000000002', 'Ferrari', 'F12 Berlinetta', NULL, NULL, '{"f12 berlinetta"}', NULL),
  ('00000000-0000-4000-f000-000000000003', 'Ferrari', 'Testarossa', 1984, 1996, '{testarossa,"512 tr","512 bb"}', NULL),
  ('00000000-0000-4000-f000-000000000004', 'Mercedes-Benz', 'AMG GT', NULL, NULL, '{"amg gt"}', NULL),
  ('00000000-0000-4000-f000-000000000005', 'Mercedes-Benz', 'CLK', 1997, 2010, '{clk350,"clk55 amg"}', NULL),
  ('00000000-0000-4000-f000-000000000006', 'Mercedes-Benz', 'S-Class', 1972, NULL, '{s500,560sel}', NULL),
  ('00000000-0000-4000-f000-000000000007', 'Mercedes-Benz', 'E-Class', 1993, NULL, '{e350,"e63 amg"}', NULL),
  ('00000000-0000-4000-f000-000000000008', 'Audi', 'RS 4', NULL, NULL, '{"rs 4"}', NULL),
  ('00000000-0000-4000-f000-000000000009', 'Audi', 'RS 6', NULL, NULL, '{"rs 6"}', NULL),
  ('00000000-0000-4000-f000-000000000010', 'Volkswagen', 'Type 2', 1950, 2013, '{bus,"type 2"}', NULL),
  ('00000000-0000-4000-f000-000000000011', 'Porsche', '935', 1976, 1984, '{935}', NULL),
  ('00000000-0000-4000-f000-000000000012', 'Shelby', 'GT350', 1965, 1970, '{gt350}', NULL);

INSERT INTO public.mv_vehicle_name_dictionary (make_l, model_l, name_l, vehicles) VALUES
  ('ferrari', 'laferrari', 'ferrari laferrari', 21),
  ('ferrari', 'laferrari aperta', 'ferrari laferrari aperta', 2),
  ('ferrari', 'f12berlinetta', 'ferrari f12berlinetta', 36),
  ('ferrari', 'f12tdf', 'ferrari f12tdf', 9),
  ('ferrari', 'f512 m', 'ferrari f512 m', 19),
  ('mclaren', 'f1 gtr', 'mclaren f1 gtr', 3),
  ('mclaren', 'speedtail', 'mclaren speedtail', 5),
  ('lamborghini', 'miura p400 sv', 'lamborghini miura p400 sv', 8),
  ('lamborghini', 'countach 5000 qv', 'lamborghini countach 5000 qv', 15),
  ('mercedes-benz', 'sls amg black series', 'mercedes-benz sls amg black series', 15),
  ('mercedes-benz', 'clk63 amg black series', 'mercedes-benz clk63 amg black series', 59),
  ('mercedes-benz', '560sec', 'mercedes-benz 560sec', 196),
  ('mercedes-benz', 'e63 s 4matic wagon', 'mercedes-benz e63 s 4matic wagon', 68),
  ('aston martin', 'db5', 'aston martin db5', 18),
  ('audi', 'rs6 avant', 'audi rs6 avant', 71),
  ('audi', 'rs4', 'audi rs4', 174),
  ('volkswagen', 'type ii', 'volkswagen type ii', 111),
  ('lancia', 'aurelia b24s spider america', 'lancia aurelia b24s spider america', 18);

\ir ../migrations/20261015090000_model_family_names.sql

SELECT pg_temp.ok('before: laferrari, f12berlinetta, miura, sls amg, db5, rs6 avant, and type ii have no family',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ferrari' AND model_l = 'laferrari') IS NULL
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'lamborghini' AND model_l = 'miura p400 sv') IS NULL
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mercedes-benz' AND model_l = 'sls amg black series') IS NULL
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'audi' AND model_l = 'rs6 avant') IS NULL);

\ir ../migrations/20261018062000_family_keys_supercars_euro_icons.sql
CREATE TEMP TABLE once AS SELECT id, year_start, year_end, notes, aliases FROM public.canonical_models;
\ir ../migrations/20261018062000_family_keys_supercars_euro_icons.sql
REFRESH MATERIALIZED VIEW public.mv_model_family_names;

SELECT pg_temp.ok('after: Ferrari LaFerrari, F12berlinetta, F12tdf, and F512 M key to their Ferrari families',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ferrari' AND model_l = 'laferrari') = 'La Ferrari'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ferrari' AND model_l = 'laferrari aperta') = 'La Ferrari'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ferrari' AND model_l = 'f12berlinetta') = 'F12 Berlinetta'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ferrari' AND model_l = 'f12tdf') = 'F12 Berlinetta'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'ferrari' AND model_l = 'f512 m') = 'Testarossa');

SELECT pg_temp.ok('after: McLaren F1 GTR, Speedtail, Lamborghini Miura, Countach, Aston Martin DB5, and Lancia Aurelia key cleanly',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mclaren' AND model_l = 'f1 gtr') = 'F1'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mclaren' AND model_l = 'speedtail') = 'Speedtail'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'lamborghini' AND model_l = 'miura p400 sv') = 'Miura'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'lamborghini' AND model_l = 'countach 5000 qv') = 'Countach'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'aston martin' AND model_l = 'db5') = 'DB5'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'lancia' AND model_l = 'aurelia b24s spider america') = 'Aurelia');

SELECT pg_temp.ok('after: Mercedes-Benz SLS AMG, CLK63, 560SEC, E63 S Wagon, Audi RS6/RS4, and VW Type II key cleanly',
  (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mercedes-benz' AND model_l = 'sls amg black series') = 'SLS AMG'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mercedes-benz' AND model_l = 'clk63 amg black series') = 'CLK'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mercedes-benz' AND model_l = '560sec') = 'S-Class'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'mercedes-benz' AND model_l = 'e63 s 4matic wagon') = 'E-Class'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'audi' AND model_l = 'rs6 avant') = 'RS 6'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'audi' AND model_l = 'rs4') = 'RS 4'
  AND (SELECT family FROM public.mv_model_family_names WHERE make_l = 'volkswagen' AND model_l = 'type ii') = 'Type 2');

SELECT pg_temp.ok('a second apply changes nothing',
  NOT EXISTS (SELECT 1 FROM public.canonical_models m JOIN once o USING (id)
              WHERE m.year_start IS DISTINCT FROM o.year_start
                 OR m.year_end IS DISTINCT FROM o.year_end
                 OR m.notes IS DISTINCT FROM o.notes
                 OR m.aliases IS DISTINCT FROM o.aliases));
