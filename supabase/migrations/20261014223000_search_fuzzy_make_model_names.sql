-- The fuzzy vehicle search ranks a daily list of make-and-model names instead of every public vehicle.
--
-- Measured 2026-10-14 (read-only, production). universal-search calls search_vehicles_fuzzy when its other vehicle
-- searches found fewer than 3 cars, which is what a typo produces. The function computes similarity() between the
-- query and lower(make || ' ' || coalesce(model, '')) for every public vehicle with a make (680,863 rows), and no index
-- can serve that predicate: search_vehicles_fuzzy('chevorlet', 10) took 16.2 s, pg_stat_statements since 2026-09-29
-- holds 25 calls at a mean of 23.1 s and a maximum of 56.6 s, and /search for "mustnag" took 20.1 s logged out.
--
-- A vehicle's similarity depends only on that name, and the 680,863 vehicles carry 120,403 distinct names. So:
--   mv_search_make_model_names  one row per (lower(make), lower(model)) among public vehicles with a make: the name the
--                               function compares and how many vehicles carry it. Built in 21 s on production; a
--                               trigram index serves the comparison. Refreshed daily, CONCURRENTLY, by cron job
--                               search-make-model-names-refresh (04:50 UTC).
--   search_vehicles_fuzzy       same signature, grants and invoker rights. It takes the names above the same 0.25
--                               similarity, most similar first, then up to p_limit public vehicles carrying each, read
--                               live through idx_vehicles_lower_make_model. The rows and relevance values are the old
--                               function's; only the order among vehicles of equal similarity can differ, and the old
--                               ORDER BY left that unspecified too. A vehicle that turns private drops out at once; a
--                               name no vehicle carried at the last refresh is matched from the next refresh on.
-- Reversible: the previous body, read from production today, is supabase/sql/helpers/search_vehicles_fuzzy_live_20261014.sql.
-- Contract: supabase/sql/test_search_fuzzy_make_model_names.sql (scripts/ci/run-db-contracts.sh, job db-contracts).
BEGIN;
SET LOCAL statement_timeout = '120s'; -- the names build in 21 s cold (EXPLAIN ANALYZE, 2026-10-14)
SET LOCAL lock_timeout = '5s';
SET LOCAL work_mem = '128MB';

-- The body this replaces (SHA-256 of prosrc, read from production 2026-10-14), or this migration's own on a re-run.
DO $guard$
DECLARE v_src text := (SELECT prosrc FROM pg_proc WHERE oid = 'public.search_vehicles_fuzzy(text,integer)'::regprocedure);
BEGIN
  IF encode(sha256(convert_to(v_src, 'UTF8')), 'base64') <> 'h5JjYO1IWqtL7xmXgCtL5LAYU5TQTT13//WQWKxdArY='
     AND v_src NOT LIKE '%mv_search_make_model_names%' THEN
    RAISE EXCEPTION 'search_vehicles_fuzzy differs from the definition this migration was written against';
  END IF;
END $guard$;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_search_make_model_names AS
SELECT lower(v.make) AS make_l,
       lower(v.model) AS model_l,
       lower(v.make || ' ' || coalesce(v.model, '')) AS name,
       count(*) AS vehicles
  FROM public.vehicles v
 WHERE v.is_public = true AND v.make IS NOT NULL
 GROUP BY 1, 2, 3;

-- The key CONCURRENTLY needs (model_l is null for a vehicle with no model), and the index the comparison uses.
CREATE UNIQUE INDEX IF NOT EXISTS mv_search_make_model_names_key
  ON public.mv_search_make_model_names (make_l, model_l, name) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS mv_search_make_model_names_trgm
  ON public.mv_search_make_model_names USING gin (name gin_trgm_ops);

-- search_vehicles_fuzzy runs with its caller's rights, so the API roles read the names it reads: make and model
-- labels of public vehicles and their counts.
REVOKE ALL ON public.mv_search_make_model_names FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.mv_search_make_model_names TO anon, authenticated, service_role;

COMMENT ON MATERIALIZED VIEW public.mv_search_make_model_names IS
  'One row per (lower(make), lower(model)) among public vehicles with a make: the name search_vehicles_fuzzy compares with a query, and how many vehicles carry it. Refreshed daily, CONCURRENTLY, by cron job search-make-model-names-refresh. 2026-10-14 (20261014223000).';
COMMENT ON COLUMN public.mv_search_make_model_names.make_l IS 'lower(vehicles.make).';
COMMENT ON COLUMN public.mv_search_make_model_names.model_l IS 'lower(vehicles.model); null for vehicles with no model.';
COMMENT ON COLUMN public.mv_search_make_model_names.name IS 'lower(make || '' '' || coalesce(model, '''')): the string search_vehicles_fuzzy ranks by similarity().';
COMMENT ON COLUMN public.mv_search_make_model_names.vehicles IS 'Public vehicles carrying this name at the last refresh.';

CREATE OR REPLACE FUNCTION public.search_vehicles_fuzzy(p_query text, p_limit integer DEFAULT 10)
 RETURNS TABLE(vehicle_id uuid, year smallint, make text, model text, vin text, primary_image_url text, sale_price bigint, relevance real, match_source text, snippet text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
 SET pg_trgm.similarity_threshold TO '0.25'
AS $function$
DECLARE
  v_query text := lower(trim(p_query));
  v_left bigint := p_limit;
  v_rows bigint;
  n record;
BEGIN
  IF trim(p_query) = '' THEN RETURN; END IF;
  IF p_limit < 0 THEN RAISE EXCEPTION 'LIMIT must not be negative' USING ERRCODE = '2201W'; END IF;

  -- The names that clear 0.25, most similar first (the trigram index finds them; % is that threshold), then the
  -- public vehicles carrying each, read live. Every vehicle of a name has the name's similarity.
  FOR n IN
    SELECT m.make_l, m.model_l, m.name, (similarity(m.name, v_query) * 0.8)::real AS relevance
      FROM mv_search_make_model_names m
     WHERE m.name % v_query
       AND similarity(m.name, v_query) > 0.25
     ORDER BY similarity(m.name, v_query) DESC, m.vehicles DESC, m.name, m.make_l, m.model_l
  LOOP
    EXIT WHEN v_left <= 0;
    IF n.model_l IS NULL THEN
      RETURN QUERY
        SELECT v.id, v.year::smallint, v.make, v.model, v.vin, v.primary_image_url, v.sale_price::bigint,
               n.relevance, 'fuzzy'::text, ''::text
          FROM vehicles v
         WHERE v.is_public = true AND lower(v.make) = n.make_l AND lower(v.model) IS NULL
           AND lower(v.make || ' ' || coalesce(v.model, '')) = n.name
         LIMIT v_left;
    ELSE
      RETURN QUERY
        SELECT v.id, v.year::smallint, v.make, v.model, v.vin, v.primary_image_url, v.sale_price::bigint,
               n.relevance, 'fuzzy'::text, ''::text
          FROM vehicles v
         WHERE v.is_public = true AND lower(v.make) = n.make_l AND lower(v.model) = n.model_l
           AND lower(v.make || ' ' || coalesce(v.model, '')) = n.name
         LIMIT v_left;
    END IF;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_left := v_left - v_rows;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.search_vehicles_fuzzy(text, integer) IS
  'Typo-tolerant vehicle search for universal-search: public vehicles whose lower(make || '' '' || coalesce(model, '''')) has similarity > 0.25 with the query, most similar first, relevance = similarity * 0.8. Ranks the names in mv_search_make_model_names, then reads each name''s vehicles live (20261014223000).';

-- The writer, registered and scheduled.
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT 'mv_search_make_model_names', NULL, 'search-make-model-names-refresh',
       'Make-and-model names of public vehicles with their counts; the dictionary search_vehicles_fuzzy ranks.', true,
       'REFRESH MATERIALIZED VIEW CONCURRENTLY only (pg_cron job search-make-model-names-refresh, daily 04:50 UTC). Migration 20261014223000.'
 WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry r
                    WHERE r.table_name = 'mv_search_make_model_names' AND r.column_name IS NULL);

SELECT cron.schedule('search-make-model-names-refresh', '50 4 * * *',
  $cmd$SET statement_timeout = '300s'; SET work_mem = '128MB'; REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_search_make_model_names;$cmd$)
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'search-make-model-names-refresh');

DO $verify$ BEGIN
  IF NOT (SELECT relispopulated FROM pg_class WHERE oid = 'public.mv_search_make_model_names'::regclass)
     OR NOT EXISTS (SELECT 1 FROM public.mv_search_make_model_names) THEN
    RAISE EXCEPTION 'mv_search_make_model_names is empty';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'search-make-model-names-refresh' AND active) <> 1 THEN
    RAISE EXCEPTION 'search-make-model-names-refresh is not scheduled once';
  END IF;
END $verify$;

COMMIT;
