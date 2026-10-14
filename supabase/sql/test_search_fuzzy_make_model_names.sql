-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_search_fuzzy -f this-file.sql
-- Contract for 20261014223000_search_fuzzy_make_model_names.sql. Synthetic rows only; never production.
-- Starts from search_vehicles_fuzzy as production had it on 2026-10-14 (helpers/search_vehicles_fuzzy_live_20261014.sql)
-- over vehicles shaped like production's (the read policy, column grants and the (lower(make), lower(model)) index),
-- applies the migration as a deploy role that is not a superuser, and proves:
--   * for 15 queries x 7 limits, as the service role and as anon, the new function returns the same number of rows and
--     the same relevance values in the same order as the old one; where the limit leaves ties out, every vehicle above
--     the last relevance is the same, and every row is a public vehicle whose name has exactly that similarity;
--   * a negative limit raises the same error, an empty or null query returns nothing;
--   * a vehicle made private drops out at once, a new name is matched after REFRESH ... CONCURRENTLY;
--   * the migration refuses a function body it was not written against, applies twice, schedules its refresh once and
--     registers its writer; the API roles read the names and nothing else changes in their grants.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dm_contract_deployer') THEN CREATE ROLE dm_contract_deployer NOLOGIN; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, dm_contract_deployer;
GRANT CREATE ON SCHEMA public TO dm_contract_deployer;

-- pg_cron as production has it: owned by the superuser; the deploy role reads cron.job and calls cron.schedule.
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL,
  active boolean NOT NULL DEFAULT true, jobname text);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint
LANGUAGE sql SECURITY DEFINER AS
$$ INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command) RETURNING jobid $$;
GRANT USAGE ON SCHEMA cron TO dm_contract_deployer;
GRANT SELECT ON cron.job TO dm_contract_deployer;
GRANT EXECUTE ON FUNCTION cron.schedule(text, text, text) TO dm_contract_deployer;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

-- The deploy role owns the tables, as postgres does on production.
SET ROLE dm_contract_deployer;
CREATE TABLE public.pipeline_registry (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL,
  column_name text, owned_by text, description text, do_not_write_directly boolean, write_via text,
  UNIQUE (table_name, column_name));
CREATE TABLE public.vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), year integer, make text, model text,
  vin text, primary_image_url text, sale_price integer, is_public boolean NOT NULL DEFAULT true, user_id uuid);
CREATE INDEX idx_vehicles_lower_make_model ON public.vehicles USING btree (lower(make), lower(model));
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT USING (is_public = true);
GRANT SELECT (id, year, make, model, vin, primary_image_url, sale_price, is_public) ON public.vehicles
  TO anon, authenticated, service_role;

-- Names that tie, case variants of one name, no model, an empty model, a model that moves a word across the split,
-- misspelt makes, private vehicles, vehicles with no make, and names carried by more vehicles than a limit takes.
CREATE TABLE pg_temp.seed (make text, model text, copies integer, is_public boolean);
INSERT INTO pg_temp.seed VALUES
  ('Ford', 'Mustang', 7, true), ('FORD', 'MUSTANG', 2, true), ('ford', 'mustang', 1, false),
  ('Ford', 'Mustang GT', 4, true), ('Ford', 'Mustang Mach 1', 3, true), ('Ford Mustang', NULL, 2, true),
  ('Ford', NULL, 3, true), ('Ford', '', 2, true), ('Ford', 'F-100', 5, true), ('Ford Mustang', 'GT', 1, true),
  ('Mustang', 'Fastback', 2, true), ('Chevrolet', 'Camaro', 6, true), ('Chevrolet', 'Camaro Z28', 3, true),
  ('Chevrolet', 'C10', 4, true), ('Chevrolet', 'Corvette', 5, true), ('Chevorlet', 'C10', 1, true),
  ('Chevrolet', 'Chevelle', 2, false), ('Porsche', '911', 8, true), ('Porsche', '911 Turbo', 3, true),
  ('Porsche', '912', 2, true), ('PORSCHE', '911 turbo', 1, true), ('Porshe', '911', 1, true),
  ('Volkswagen', 'Bus', 2, true), ('Volkswagen', 'Beetle', 3, true), (NULL, 'Mustang', 2, true),
  ('Lotus', 'Europa', 1, true), ('Alfa Romeo', 'Spider', 2, true), ('Alfa', 'Romeo Spider', 1, true);
INSERT INTO public.vehicles (year, make, model, vin, primary_image_url, sale_price, is_public)
SELECT 1960 + (row_number() OVER ()) % 40, s.make, s.model, 'VIN' || lpad((row_number() OVER ())::text, 6, '0'),
       CASE WHEN g % 2 = 0 THEN 'https://img.example/' || g END, CASE WHEN g % 3 = 0 THEN 10000 + g END, s.is_public
  FROM pg_temp.seed s CROSS JOIN LATERAL generate_series(1, s.copies) g;
RESET ROLE;

CREATE TABLE pg_temp.cases (q text, lim integer);
INSERT INTO pg_temp.cases
SELECT q, lim
  FROM unnest(ARRAY['chevorlet', 'mustnag', 'ford mustang', 'FORD MUSTANG', ' ford mustang ', 'porshe 911', 'porsche',
                    'mustang', 'ford', 'camaro z28', 'vw bus', 'alfa romeo spider', 'zzzzzz', 'a', 'f']) q
 CROSS JOIN unnest(ARRAY[1, 3, 5, 10, 50, 0, NULL]::integer[]) lim;
CREATE TABLE pg_temp.answers (impl text, role text, q text, lim integer, ord integer, vehicle_id uuid, relevance real);
-- record_answers inserts as each role in turn.
GRANT SELECT ON pg_temp.cases TO PUBLIC;
GRANT SELECT, INSERT ON pg_temp.answers TO PUBLIC;
CREATE FUNCTION pg_temp.record_answers(p_impl text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c record; r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['service_role', 'anon'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', r);
    FOR c IN SELECT * FROM pg_temp.cases LOOP
      INSERT INTO pg_temp.answers
      SELECT p_impl, r, c.q, c.lim, f.ord::integer, f.vehicle_id, f.relevance
        FROM public.search_vehicles_fuzzy(c.q, c.lim)
             WITH ORDINALITY f(vehicle_id, year, make, model, vin, primary_image_url, sale_price, relevance, match_source, snippet, ord);
    END LOOP;
    RESET ROLE;
  END LOOP;
END $$;

-- Before: the function as production has it, owned by the deploy role as postgres owns it there.
SET ROLE dm_contract_deployer;
\ir helpers/search_vehicles_fuzzy_live_20261014.sql
GRANT EXECUTE ON FUNCTION public.search_vehicles_fuzzy(text, integer) TO PUBLIC, anon, authenticated, service_role;
RESET ROLE;
SELECT pg_temp.record_answers('old');
SELECT pg_temp.ok('the old function answers the cases (some with ties cut by the limit)',
  (SELECT count(*) FROM pg_temp.answers WHERE impl = 'old') > 300);

-- A body the migration was not written against is refused before anything is built. (The guard's error comes first;
-- the statements after it in the migration's transaction then report the aborted transaction.)
SET ROLE dm_contract_deployer;
CREATE OR REPLACE FUNCTION public.search_vehicles_fuzzy(p_query text, p_limit integer DEFAULT 10)
 RETURNS TABLE(vehicle_id uuid, year smallint, make text, model text, vin text, primary_image_url text, sale_price bigint, relevance real, match_source text, snippet text)
 LANGUAGE plpgsql STABLE AS $function$ BEGIN RETURN; END; $function$;
\echo 'Expected next: the migration refuses a changed function body (its errors print below).'
\set ON_ERROR_STOP off
\ir ../migrations/20261014223000_search_fuzzy_make_model_names.sql
\set ON_ERROR_STOP on
RESET ROLE;
SELECT pg_temp.ok('a changed body is refused: no names, no index, no job, no registry row, the body left as it was',
  to_regclass('public.mv_search_make_model_names') IS NULL
  AND NOT EXISTS (SELECT 1 FROM cron.job) AND NOT EXISTS (SELECT 1 FROM public.pipeline_registry)
  AND (SELECT prosrc FROM pg_proc WHERE oid = 'public.search_vehicles_fuzzy(text,integer)'::regprocedure) = ' BEGIN RETURN; END; ');
SET ROLE dm_contract_deployer;
\ir helpers/search_vehicles_fuzzy_live_20261014.sql
RESET ROLE;

-- The migration, as the deploy role, twice.
SET ROLE dm_contract_deployer;
\ir ../migrations/20261014223000_search_fuzzy_make_model_names.sql
\ir ../migrations/20261014223000_search_fuzzy_make_model_names.sql
RESET ROLE;
SELECT pg_temp.ok('applied twice: the names are built once, the refresh is scheduled once, the writer registered once',
  (SELECT count(*) FROM public.mv_search_make_model_names) = (
     SELECT count(DISTINCT (lower(make), lower(model), lower(make || ' ' || coalesce(model, ''))))
       FROM public.vehicles WHERE is_public AND make IS NOT NULL)
  AND (SELECT count(*) FROM cron.job WHERE jobname = 'search-make-model-names-refresh' AND schedule = '50 4 * * *'
         AND command LIKE '%REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_search_make_model_names;') = 1
  AND (SELECT count(*) FROM public.pipeline_registry WHERE table_name = 'mv_search_make_model_names') = 1);
SELECT pg_temp.ok('a name carried by different spellings is one row; a word moved across make and model is another row',
  (SELECT vehicles FROM public.mv_search_make_model_names WHERE make_l = 'ford' AND model_l = 'mustang') = 9
  AND (SELECT count(*) FROM public.mv_search_make_model_names WHERE name = 'ford mustang ') = 1
  AND (SELECT count(*) FROM public.mv_search_make_model_names WHERE name = 'ford ') = 2
  AND (SELECT count(*) FROM public.mv_search_make_model_names WHERE name = 'ford mustang gt') = 2);
SELECT pg_temp.ok('the API roles read the names; grants on the function are unchanged',
  has_table_privilege('anon', 'public.mv_search_make_model_names', 'SELECT')
  AND has_table_privilege('authenticated', 'public.mv_search_make_model_names', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.mv_search_make_model_names', 'INSERT')
  AND has_function_privilege('anon', 'public.search_vehicles_fuzzy(text,integer)', 'EXECUTE')
  AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.search_vehicles_fuzzy(text,integer)'::regprocedure));

SELECT pg_temp.record_answers('new');
SELECT pg_temp.ok('for every case and both roles: the same row count and the same relevance values in the same order',
  NOT EXISTS (
    SELECT 1 FROM (SELECT role, q, coalesce(lim, -1) AS lim, array_agg(relevance ORDER BY ord) AS rels
                     FROM pg_temp.answers WHERE impl = 'old' GROUP BY 1, 2, 3) o
    FULL JOIN (SELECT role, q, coalesce(lim, -1) AS lim, array_agg(relevance ORDER BY ord) AS rels
                 FROM pg_temp.answers WHERE impl = 'new' GROUP BY 1, 2, 3) n USING (role, q, lim)
     WHERE o.rels IS DISTINCT FROM n.rels));
SELECT pg_temp.ok('the cases include ties the limit cuts, and typos that match correctly spelt names',
  EXISTS (SELECT 1 FROM pg_temp.answers a WHERE impl = 'old' AND lim = 3
            AND (SELECT count(*) FROM pg_temp.answers b WHERE b.impl = 'old' AND b.lim IS NULL AND b.role = a.role
                   AND b.q = a.q AND b.relevance = a.relevance) > 3)
  AND (SELECT count(*) FROM pg_temp.answers WHERE impl = 'old' AND role = 'anon' AND q = 'chevorlet' AND lim = 10) = 10
  AND (SELECT count(*) FROM pg_temp.answers WHERE impl = 'old' AND role = 'anon' AND q = 'porshe 911' AND lim IS NULL
         AND relevance < 0.8) > 0);
SELECT pg_temp.ok('where nothing is cut, the very same vehicles; where ties are cut, the same vehicles above the last value',
  NOT EXISTS (
    SELECT 1 FROM (SELECT role, q, lim, min(relevance) AS floor FROM pg_temp.answers WHERE impl = 'old' GROUP BY 1, 2, 3) k
     WHERE EXISTS (
       (SELECT vehicle_id FROM pg_temp.answers WHERE impl = 'old' AND role = k.role AND q = k.q
          AND lim IS NOT DISTINCT FROM k.lim AND relevance > k.floor
        EXCEPT
        SELECT vehicle_id FROM pg_temp.answers WHERE impl = 'new' AND role = k.role AND q = k.q
          AND lim IS NOT DISTINCT FROM k.lim)
       UNION ALL
       (SELECT vehicle_id FROM pg_temp.answers WHERE impl = 'new' AND role = k.role AND q = k.q
          AND lim IS NOT DISTINCT FROM k.lim AND relevance > k.floor
        EXCEPT
        SELECT vehicle_id FROM pg_temp.answers WHERE impl = 'old' AND role = k.role AND q = k.q
          AND lim IS NOT DISTINCT FROM k.lim)))
  AND NOT EXISTS (
    (SELECT role, q, vehicle_id FROM pg_temp.answers WHERE impl = 'old' AND lim IS NULL
     EXCEPT SELECT role, q, vehicle_id FROM pg_temp.answers WHERE impl = 'new' AND lim IS NULL)
    UNION ALL
    (SELECT role, q, vehicle_id FROM pg_temp.answers WHERE impl = 'new' AND lim IS NULL
     EXCEPT SELECT role, q, vehicle_id FROM pg_temp.answers WHERE impl = 'old' AND lim IS NULL)));
SELECT pg_temp.ok('every new row is a distinct public vehicle whose name has exactly its similarity, above 0.25',
  NOT EXISTS (
    SELECT 1 FROM pg_temp.answers a LEFT JOIN public.vehicles v ON v.id = a.vehicle_id
     WHERE a.impl = 'new'
       AND (v.id IS NULL OR NOT v.is_public OR v.make IS NULL
            OR a.relevance <> (similarity(lower(v.make || ' ' || coalesce(v.model, '')), lower(trim(a.q))) * 0.8)::real
            OR similarity(lower(v.make || ' ' || coalesce(v.model, '')), lower(trim(a.q))) <= 0.25))
  AND NOT EXISTS (SELECT 1 FROM pg_temp.answers WHERE impl = 'new'
                   GROUP BY role, q, lim, vehicle_id HAVING count(*) > 1));

-- Edges.
CREATE FUNCTION pg_temp.limit_error() RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM * FROM public.search_vehicles_fuzzy('ford mustang', -1);
  RETURN NULL;
EXCEPTION WHEN invalid_row_count_in_limit_clause THEN
  RETURN SQLERRM;
END $$;
SELECT pg_temp.ok('a negative limit raises the error LIMIT raised before; an empty, blank or null query returns nothing',
  pg_temp.limit_error() = 'LIMIT must not be negative'
  AND NOT EXISTS (SELECT 1 FROM public.search_vehicles_fuzzy('', 10))
  AND NOT EXISTS (SELECT 1 FROM public.search_vehicles_fuzzy('   ', 10))
  AND NOT EXISTS (SELECT 1 FROM public.search_vehicles_fuzzy(NULL, 10)));
SELECT pg_temp.ok('the row shape is unchanged: match_source fuzzy, empty snippet',
  NOT EXISTS (SELECT 1 FROM public.search_vehicles_fuzzy('ford mustang', NULL) WHERE match_source <> 'fuzzy' OR snippet <> ''));

-- Freshness: privacy is read live, new names arrive with the refresh.
SET ROLE dm_contract_deployer;
UPDATE public.vehicles SET is_public = false WHERE make = 'Lotus';
INSERT INTO public.vehicles (year, make, model, is_public) VALUES (1967, 'Shelby', 'GT500', true);
RESET ROLE;
SELECT pg_temp.ok('a vehicle made private drops out before any refresh; a new name waits for the refresh',
  NOT EXISTS (SELECT 1 FROM public.search_vehicles_fuzzy('lotus europa', 10))
  AND NOT EXISTS (SELECT 1 FROM public.search_vehicles_fuzzy('shelby gt500', 10)));
SET ROLE dm_contract_deployer;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_search_make_model_names;
RESET ROLE;
SELECT pg_temp.ok('after REFRESH ... CONCURRENTLY the new name is matched and the private one is gone from the names',
  (SELECT count(*) FROM public.search_vehicles_fuzzy('shelby gt500', 10)) = 1
  AND NOT EXISTS (SELECT 1 FROM public.mv_search_make_model_names WHERE make_l = 'lotus'));
