-- search_vehicles_fuzzy ranks a daily dictionary of public make and model names instead of every public vehicle.
--
-- Measured 2026-10-14 logged out: universal-search took 20.2 s for "mustnag" and 8.9 s for "corvet". Neither is in the
-- synonym map, so the ranked search found little and the fuzzy reader ran. search_vehicles_fuzzy('chevorlet') took
-- 16.2 s as postgres, and pg_stat_statements since 09-29 shows 25 calls, mean 23 s, max 57 s. It computed similarity()
-- of lower(make || ' ' || coalesce(model, '')) for every public vehicle, with no index, then kept p_limit.
-- Every public vehicle of one make and model has the same score, so the function now ranks the distinct names in
-- mv_vehicle_name_dictionary (one row per lower(make), lower(coalesce(model, '')) among public vehicles), keeps the best
-- p_limit, and reads their current public vehicles through idx_vehicles_lower_make_model. Same rows up to ties, over
-- the names as of the last refresh: a make and model first seen since then reaches the fuzzy reader after the next
-- refresh (cron job refresh-vehicle-name-dictionary, daily 03:50 UTC, CONCURRENTLY). The dictionary holds public names
-- and counts only; anon and authenticated read it because the function runs as its caller (invoker, as before).
-- Contract: supabase/sql/test_search_fuzzy_name_dictionary.sql (db-contracts) compares it with the old body.
BEGIN;
SET LOCAL statement_timeout = '300s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE v text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO v
  FROM pg_proc WHERE oid = 'public.search_vehicles_fuzzy(text,integer)'::regprocedure;
  IF v IS DISTINCT FROM 'h5JjYO1IWqtL7xmXgCtL5LAYU5TQTT13//WQWKxdArY=' AND v IS DISTINCT FROM 'rM5kSY/R03VaS+Ec2h8M2S3cD77NSg0hjJnUff7Prio=' THEN
    RAISE EXCEPTION 'search_vehicles_fuzzy is not the 2026-10-14 definition this was written from (sha256 %)', v;
  END IF;
END $guard$;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_vehicle_name_dictionary AS
SELECT lower(make) AS make_l,
       lower(coalesce(model, '')) AS model_l,
       lower(make || ' ' || coalesce(model, '')) AS name_l,
       count(*)::bigint AS vehicles
FROM public.vehicles
WHERE is_public = true AND make IS NOT NULL
GROUP BY 1, 2, 3;
CREATE UNIQUE INDEX IF NOT EXISTS mv_vehicle_name_dictionary_key ON public.mv_vehicle_name_dictionary (make_l, model_l);
REVOKE ALL ON public.mv_vehicle_name_dictionary FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mv_vehicle_name_dictionary TO anon, authenticated, service_role;
COMMENT ON MATERIALIZED VIEW public.mv_vehicle_name_dictionary IS
  'One row per public make and model name (lowercased) with its vehicle count; ranked by search_vehicles_fuzzy. Refreshed daily by cron job refresh-vehicle-name-dictionary.';

CREATE OR REPLACE FUNCTION public.search_vehicles_fuzzy(p_query text, p_limit integer DEFAULT 10)
 RETURNS TABLE(vehicle_id uuid, year smallint, make text, model text, vin text, primary_image_url text, sale_price bigint, relevance real, match_source text, snippet text)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_q text := lower(trim(p_query));
BEGIN
  IF trim(p_query) = '' THEN RETURN; END IF;

  -- Every public vehicle of one make and model scores the same, so rank the distinct names, keep the best p_limit,
  -- then read their current public vehicles through idx_vehicles_lower_make_model. The old body ranked every vehicle.
  RETURN QUERY
  WITH names AS (
    SELECT d.make_l, d.model_l, similarity(d.name_l, v_q) AS sim
    FROM public.mv_vehicle_name_dictionary d
    WHERE similarity(d.name_l, v_q) > 0.25
    ORDER BY sim DESC
    LIMIT p_limit
  )
  SELECT h.id, h.year::smallint, h.make, h.model, h.vin, h.primary_image_url, h.sale_price::bigint,
         (h.sim * 0.8)::real, 'fuzzy'::text, ''::text
  FROM (
    SELECT x.id, x.year, x.make, x.model, x.vin, x.primary_image_url, x.sale_price, n.sim
    FROM names n
    CROSS JOIN LATERAL (
      SELECT v.id, v.year, v.make, v.model, v.vin, v.primary_image_url, v.sale_price
      FROM public.vehicles v
      WHERE lower(v.make) = n.make_l AND lower(v.model) = n.model_l AND v.is_public = true
      LIMIT p_limit
    ) x
    WHERE n.model_l <> ''
    UNION ALL
    SELECT x.id, x.year, x.make, x.model, x.vin, x.primary_image_url, x.sale_price, n.sim
    FROM names n
    CROSS JOIN LATERAL (
      SELECT v.id, v.year, v.make, v.model, v.vin, v.primary_image_url, v.sale_price
      FROM public.vehicles v
      WHERE lower(v.make) = n.make_l AND (lower(v.model) IS NULL OR lower(v.model) = '') AND v.is_public = true
      LIMIT p_limit
    ) x
    WHERE n.model_l = ''
  ) h
  ORDER BY h.sim DESC
  LIMIT p_limit;
END;
$function$;

DO $job$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-vehicle-name-dictionary') THEN
    PERFORM cron.schedule('refresh-vehicle-name-dictionary', '50 3 * * *',
      'REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_vehicle_name_dictionary');
  END IF;
END $job$;

COMMIT;
