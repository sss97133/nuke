-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_search_fuzzy -f this-file.sql
-- Contract for 20261015010000_search_fuzzy_name_dictionary.sql. Synthetic rows only; never production.
-- The live search_vehicles_fuzzy (helper, hash-checked by the migration) is kept as search_vehicles_fuzzy_old, the
-- migration builds mv_vehicle_name_dictionary and replaces the function, and both answer the same queries:
--   * with a limit covering every match, the same vehicles with the same relevance;
--   * for any limit, the same relevance values (vehicles tied on a name may swap), never a private vehicle;
--   * typos, mixed case, null and empty models, no match and an empty query;
--   * anon can call it (it runs as its caller), the dictionary refreshes CONCURRENTLY, the refresh job is registered
--     once, and the migration is idempotent.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '120s';
SET lock_timeout = '3s';
CREATE EXTENSION IF NOT EXISTS pg_trgm;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- pg_cron stand-in: the migration registers its refresh job through cron.schedule.
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command) RETURNING jobid $$;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, year integer, make text, model text, vin text, primary_image_url text,
  sale_price integer, is_public boolean);
CREATE INDEX idx_vehicles_lower_make_model ON public.vehicles USING btree (lower(make), lower(model));
GRANT SELECT ON public.vehicles TO anon, authenticated, service_role;

-- 2,400 vehicles: makes in mixed case, models including null and empty, private rows and rows with no make.
INSERT INTO public.vehicles (id, year, make, model, vin, primary_image_url, sale_price, is_public)
SELECT ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
       1950 + g % 70,
       CASE WHEN g % 97 = 0 THEN NULL
            ELSE (ARRAY['Ford', 'FORD', 'Chevrolet', 'chevrolet', 'Porsche', 'Lotus', 'Mercedes-Benz', 'Pontiac'])[1 + g % 8] END,
       (ARRAY['Mustang', 'Mustang II', 'Corvette', '911', 'Elan', 'Camaro', 'K5 Blazer', NULL, '', 'GTO', 'SL'])[1 + g % 11],
       'VIN' || g, 'https://example.invalid/' || g || '.jpg', 5000 + g * 13,
       g % 7 <> 0
FROM generate_series(1, 2400) g;

\ir helpers/search_vehicles_fuzzy_live_20261014.sql
DO $$ BEGIN
  EXECUTE replace(pg_get_functiondef('public.search_vehicles_fuzzy(text,integer)'::regprocedure),
                  'FUNCTION public.search_vehicles_fuzzy(', 'FUNCTION public.search_vehicles_fuzzy_old(');
END $$;
GRANT EXECUTE ON FUNCTION public.search_vehicles_fuzzy_old(text, integer) TO anon, authenticated, service_role;

\ir ../migrations/20261015010000_search_fuzzy_name_dictionary.sql
-- A second application changes nothing and passes its own guard.
\ir ../migrations/20261015010000_search_fuzzy_name_dictionary.sql

SELECT pg_temp.ok('the refresh job is registered once, daily, CONCURRENTLY',
  (SELECT count(*) FROM cron.job WHERE jobname = 'refresh-vehicle-name-dictionary') = 1
  AND (SELECT command FROM cron.job WHERE jobname = 'refresh-vehicle-name-dictionary')
      = 'REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_vehicle_name_dictionary');
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_vehicle_name_dictionary;
SELECT pg_temp.ok('the dictionary holds one row per public lowercased make and model',
  (SELECT count(*) FROM public.mv_vehicle_name_dictionary)
  = (SELECT count(DISTINCT (lower(make), lower(coalesce(model, '')))) FROM public.vehicles WHERE is_public AND make IS NOT NULL)
  AND (SELECT sum(vehicles) FROM public.mv_vehicle_name_dictionary)
      = (SELECT count(*) FROM public.vehicles WHERE is_public AND make IS NOT NULL));

CREATE TEMP TABLE probe(q text);
INSERT INTO probe VALUES ('mustnag'), ('ford mustng'), ('chevorlet'), ('corvet'), ('porshe 911'), ('ford'), ('FORD MUSTANG'),
  ('lotus elan'), ('mercedes sl'), ('pontiac gto'), ('chevrolet '), ('xyzzy'), ('');

SELECT pg_temp.ok('full answer for "' || q || '": same vehicles with the same relevance',
  NOT EXISTS (SELECT vehicle_id, relevance FROM public.search_vehicles_fuzzy_old(q, 5000)
              EXCEPT ALL SELECT vehicle_id, relevance FROM public.search_vehicles_fuzzy(q, 5000))
  AND NOT EXISTS (SELECT vehicle_id, relevance FROM public.search_vehicles_fuzzy(q, 5000)
                  EXCEPT ALL SELECT vehicle_id, relevance FROM public.search_vehicles_fuzzy_old(q, 5000))
  AND NOT EXISTS (SELECT * FROM public.search_vehicles_fuzzy(q, 5000)
                  EXCEPT ALL SELECT * FROM public.search_vehicles_fuzzy_old(q, 5000)))
FROM probe;
SELECT pg_temp.ok('the typo queries match many vehicles (the contract exercises the ranking)',
  (SELECT count(*) FROM public.search_vehicles_fuzzy_old('ford mustng', 5000)) > 100
  AND (SELECT count(*) FROM public.search_vehicles_fuzzy_old('chevorlet', 5000)) > 100);

CREATE TEMP TABLE lims(l int);
INSERT INTO lims VALUES (1), (3), (10), (25), (300);
SELECT pg_temp.ok(format('limit %s for "%s": same relevance values, public rows only', l, q),
  (SELECT array_agg(relevance ORDER BY relevance DESC) FROM public.search_vehicles_fuzzy_old(q, l))
  IS NOT DISTINCT FROM
  (SELECT array_agg(relevance ORDER BY relevance DESC) FROM public.search_vehicles_fuzzy(q, l))
  AND NOT EXISTS (SELECT 1 FROM public.search_vehicles_fuzzy(q, l) f JOIN public.vehicles v ON v.id = f.vehicle_id
                  WHERE NOT v.is_public OR v.make IS NULL))
FROM probe, lims WHERE q <> '';

SET ROLE anon;
SELECT pg_temp.ok('anon calls it and gets rows (it reads the dictionary as its caller)',
  (SELECT count(*) FROM public.search_vehicles_fuzzy('ford mustng', 10)) = 10);
RESET ROLE;
SELECT pg_temp.ok('invoker, STABLE, same signature',
  (SELECT NOT prosecdef AND provolatile = 's' FROM pg_proc WHERE oid = 'public.search_vehicles_fuzzy(text,integer)'::regprocedure));
