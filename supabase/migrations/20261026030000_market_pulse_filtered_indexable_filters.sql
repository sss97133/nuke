-- market_pulse_filtered: make-level drill-down hit statement_timeout.
-- Cause: filters were written as `NOT (p_filters ? 'make') OR make = ...`
-- inside a SECURITY DEFINER SQL function (never inlined), so the planner
-- could not use any make/model index; every call scanned and projected all
-- ~1M public vehicles before filtering, then aggregated.
-- Fix: push the indexable make/model/year predicates into the base scan via
-- dynamic SQL (values quoted with %L), so a (make, model, year) partial index
-- drives the scan. Output columns and semantics are unchanged; remaining
-- filters (metro/dow/color/price/mileage/popularity) still apply as before.
-- A make like Chevrolet is ~180k public rows; even an index-driven scan of
-- those times out cold (EXPLAIN ANALYZE of a plain count hit the timeout),
-- so the make -> model drill is served from a per-(make, model) matview.
-- NOTE: on a large table consider building the index CONCURRENTLY by hand
-- before applying this migration.

CREATE INDEX IF NOT EXISTS idx_vehicles_public_make_model_pulse
  ON public.vehicles USING btree (make, model, year)
  WHERE is_public;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_market_pulse_make_model AS
WITH v AS (
    SELECT make, model, year, city, state, sale_date, color_family, mileage,
           bat_watchers AS watchers,
           (sale_status='sold' OR auction_status='sold') AS is_sold,
           COALESCE(sale_price, sold_price, canonical_sold_price) AS price,
           primary_image_url AS img,
           CASE WHEN canonical_platform IN ('bat','cars-and-bids','barrett-jackson','mecum','bonhams','classiccars-com','gooding','rm-sothebys','broad-arrow') THEN 0 ELSE 1 END AS plat_rank,
           lower(source) = ANY (ARRAY[
             'bat','bring_a_trailer','bringatrailer','mecum','barrett-jackson','cars_and_bids',
             'bonhams','rm-sothebys','gooding','leake','silver-auctions','kruse','auctions-america',
             'mccormicks','russo-and-steele','pcarmarket','gaa-classic-cars','palm-springs-exotic',
             'themarket-bonhams','h-and-h','coys','worldwide-auctioneers','shannons','broad_arrow',
             'artcurial','collecting_cars','branson-auctions','midamerica','gpk-auctions','historics',
             'hollywood-car-auction','sbx-cars','grand-prix-classics','carlisle']) AS is_auction,
           lower(source) = ANY (ARRAY[
             'facebook_marketplace','facebook-marketplace','facebook-saved','classiccars-com',
             'classiccars.com','craigslist','ksl','jamesedition','erclassics','hemmings','ebay',
             'classic-com','dealer_website','barnfinds','classic-driver','dupont registry',
             'autotrader','cars_com']) AS is_marketplace
    FROM vehicles WHERE is_public AND make IS NOT NULL AND model IS NOT NULL AND model <> ''
  )
  SELECT make, model AS name,
    count(*)::bigint AS count,
    count(*)::bigint AS value,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::bigint AS median_price,
    round(avg(year))::int AS avg_year,
    (array_agg(img ORDER BY plat_rank, price DESC NULLS LAST) FILTER (WHERE img IS NOT NULL AND img <> ''))[1] AS image_url,
    round(100.0*count(*) FILTER (WHERE is_sold)/count(*))::int AS sell_through,
    -- pulse metrics ----------------------------------------------------
    sum(price) FILTER (WHERE price IS NOT NULL)::bigint AS total_value,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY price)::bigint AS p25,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY price)::bigint AS p50,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY price)::bigint AS p75,
    count(*) FILTER (WHERE price IS NOT NULL)::int AS price_n,
    sum(watchers) FILTER (WHERE watchers IS NOT NULL)::bigint AS watch_sum,
    count(*) FILTER (WHERE watchers IS NOT NULL)::int AS watch_n,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY price) FILTER (WHERE is_auction)::bigint AS auction_med,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY price) FILTER (WHERE is_marketplace)::bigint AS market_med
  FROM v
  GROUP BY make, model
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_market_pulse_make_model_pk
  ON public.mv_market_pulse_make_model (make, name);
REVOKE ALL ON public.mv_market_pulse_make_model FROM anon, authenticated;

-- Add the new matview to the (currently paused) nightly refresh job.
DO $do$
DECLARE v_id bigint;
BEGIN
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'refresh-market-views-nightly';
  IF v_id IS NOT NULL THEN
    PERFORM cron.alter_job(job_id := v_id, command := (SELECT command FROM cron.job WHERE jobid = v_id)
      || E'\nREFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_market_pulse_make_model;')
    WHERE (SELECT command FROM cron.job WHERE jobid = v_id) NOT LIKE '%mv_market_pulse_make_model%';
  END IF;
END
$do$;

CREATE OR REPLACE FUNCTION public.market_pulse_filtered(p_group_by text, p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 40)
 RETURNS TABLE(name text, count bigint, value bigint, median_price bigint, avg_year integer, image_url text, sell_through integer, total_value bigint, p25 bigint, p50 bigint, p75 bigint, price_n integer, watch_sum bigint, watch_n integer, auction_med bigint, market_med bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_where text := 'is_public';
BEGIN
  -- Fast path: Explore make -> model drill, served from the matview once it
  -- has been populated (it is created WITH NO DATA; run one manual
  -- REFRESH MATERIALIZED VIEW public.mv_market_pulse_make_model).
  IF p_group_by = 'model' AND p_filters ? 'make'
     AND (SELECT count(*) FROM jsonb_object_keys(p_filters)) = 1
     AND (SELECT relispopulated FROM pg_class WHERE oid = 'public.mv_market_pulse_make_model'::regclass) THEN
    RETURN QUERY
      SELECT m.name, m.count, m.value, m.median_price, m.avg_year, m.image_url, m.sell_through,
             m.total_value, m.p25, m.p50, m.p75, m.price_n, m.watch_sum, m.watch_n,
             m.auction_med, m.market_med
      FROM public.mv_market_pulse_make_model m
      WHERE m.make = p_filters->>'make'
      ORDER BY m.count DESC
      LIMIT p_limit;
    RETURN;
  END IF;

  IF p_filters ? 'make' THEN
    v_where := v_where || format(' AND make = %L', p_filters->>'make');
  END IF;
  IF p_filters ? 'model' THEN
    v_where := v_where || format(' AND model = %L', p_filters->>'model');
  END IF;
  IF p_filters ? 'year' AND (p_filters->>'year') ~ '^[0-9]{1,4}$' THEN
    v_where := v_where || format(' AND year = %s', (p_filters->>'year')::int);
  END IF;

  RETURN QUERY EXECUTE format($q$
WITH v AS (
    SELECT make, model, year, city, state, sale_date, color_family, mileage,
           bat_watchers AS watchers,
           (sale_status='sold' OR auction_status='sold') AS is_sold,
           COALESCE(sale_price, sold_price, canonical_sold_price) AS price,
           primary_image_url AS img,
           CASE WHEN canonical_platform IN ('bat','cars-and-bids','barrett-jackson','mecum','bonhams','classiccars-com','gooding','rm-sothebys','broad-arrow') THEN 0 ELSE 1 END AS plat_rank,
           lower(source) = ANY (ARRAY[
             'bat','bring_a_trailer','bringatrailer','mecum','barrett-jackson','cars_and_bids',
             'bonhams','rm-sothebys','gooding','leake','silver-auctions','kruse','auctions-america',
             'mccormicks','russo-and-steele','pcarmarket','gaa-classic-cars','palm-springs-exotic',
             'themarket-bonhams','h-and-h','coys','worldwide-auctioneers','shannons','broad_arrow',
             'artcurial','collecting_cars','branson-auctions','midamerica','gpk-auctions','historics',
             'hollywood-car-auction','sbx-cars','grand-prix-classics','carlisle']) AS is_auction,
           lower(source) = ANY (ARRAY[
             'facebook_marketplace','facebook-marketplace','facebook-saved','classiccars-com',
             'classiccars.com','craigslist','ksl','jamesedition','erclassics','hemmings','ebay',
             'classic-com','dealer_website','barnfinds','classic-driver','dupont registry',
             'autotrader','cars_com']) AS is_marketplace
    FROM vehicles WHERE %s
  )
  SELECT
    (CASE $1 WHEN 'make' THEN (make) WHEN 'model' THEN (model) WHEN 'year' THEN (year::text) WHEN 'metro' THEN (city||', '||state) WHEN 'dow' THEN (to_char(sale_date,'Dy')) WHEN 'color' THEN (color_family) WHEN 'price' THEN (CASE WHEN price IS NULL THEN NULL WHEN price<10000 THEN '<$10k' WHEN price<25000 THEN '$10-25k' WHEN price<50000 THEN '$25-50k' WHEN price<100000 THEN '$50-100k' WHEN price<250000 THEN '$100-250k' WHEN price<1000000 THEN '$250k-1M' ELSE '$1M+' END) WHEN 'mileage' THEN (CASE WHEN mileage IS NULL THEN NULL WHEN mileage<1000 THEN 'Under 1k mi' WHEN mileage<10000 THEN '1-10k mi' WHEN mileage<50000 THEN '10-50k mi' WHEN mileage<100000 THEN '50-100k mi' WHEN mileage<150000 THEN '100-150k mi' ELSE '150k+ mi' END) WHEN 'popularity' THEN (CASE WHEN watchers IS NULL THEN NULL WHEN watchers>=500 THEN '500+ watching' WHEN watchers>=200 THEN '200-499 watching' WHEN watchers>=100 THEN '100-199 watching' WHEN watchers>=50 THEN '50-99 watching' WHEN watchers>=10 THEN '10-49 watching' ELSE 'Under 10 watching' END) END) AS name,
    count(*)::bigint,
    count(*)::bigint,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::bigint,
    round(avg(year))::int,
    (array_agg(img ORDER BY plat_rank, price DESC NULLS LAST) FILTER (WHERE img IS NOT NULL AND img <> ''))[1],
    round(100.0*count(*) FILTER (WHERE is_sold)/count(*))::int,
    -- pulse metrics ----------------------------------------------------
    sum(price) FILTER (WHERE price IS NOT NULL)::bigint AS total_value,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY price)::bigint AS p25,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY price)::bigint AS p50,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY price)::bigint AS p75,
    count(*) FILTER (WHERE price IS NOT NULL)::int AS price_n,
    sum(watchers) FILTER (WHERE watchers IS NOT NULL)::bigint AS watch_sum,
    count(*) FILTER (WHERE watchers IS NOT NULL)::int AS watch_n,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY price) FILTER (WHERE is_auction)::bigint AS auction_med,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY price) FILTER (WHERE is_marketplace)::bigint AS market_med
  FROM v
  WHERE (CASE $1 WHEN 'make' THEN (make) WHEN 'model' THEN (model) WHEN 'year' THEN (year::text) WHEN 'metro' THEN (city||', '||state) WHEN 'dow' THEN (to_char(sale_date,'Dy')) WHEN 'color' THEN (color_family) WHEN 'price' THEN (CASE WHEN price IS NULL THEN NULL WHEN price<10000 THEN '<$10k' WHEN price<25000 THEN '$10-25k' WHEN price<50000 THEN '$25-50k' WHEN price<100000 THEN '$50-100k' WHEN price<250000 THEN '$100-250k' WHEN price<1000000 THEN '$250k-1M' ELSE '$1M+' END) WHEN 'mileage' THEN (CASE WHEN mileage IS NULL THEN NULL WHEN mileage<1000 THEN 'Under 1k mi' WHEN mileage<10000 THEN '1-10k mi' WHEN mileage<50000 THEN '10-50k mi' WHEN mileage<100000 THEN '50-100k mi' WHEN mileage<150000 THEN '100-150k mi' ELSE '150k+ mi' END) WHEN 'popularity' THEN (CASE WHEN watchers IS NULL THEN NULL WHEN watchers>=500 THEN '500+ watching' WHEN watchers>=200 THEN '200-499 watching' WHEN watchers>=100 THEN '100-199 watching' WHEN watchers>=50 THEN '50-99 watching' WHEN watchers>=10 THEN '10-49 watching' ELSE 'Under 10 watching' END) END) IS NOT NULL
    AND (CASE $1 WHEN 'make' THEN (make) WHEN 'model' THEN (model) WHEN 'year' THEN (year::text) WHEN 'metro' THEN (city||', '||state) WHEN 'dow' THEN (to_char(sale_date,'Dy')) WHEN 'color' THEN (color_family) WHEN 'price' THEN (CASE WHEN price IS NULL THEN NULL WHEN price<10000 THEN '<$10k' WHEN price<25000 THEN '$10-25k' WHEN price<50000 THEN '$25-50k' WHEN price<100000 THEN '$50-100k' WHEN price<250000 THEN '$100-250k' WHEN price<1000000 THEN '$250k-1M' ELSE '$1M+' END) WHEN 'mileage' THEN (CASE WHEN mileage IS NULL THEN NULL WHEN mileage<1000 THEN 'Under 1k mi' WHEN mileage<10000 THEN '1-10k mi' WHEN mileage<50000 THEN '10-50k mi' WHEN mileage<100000 THEN '50-100k mi' WHEN mileage<150000 THEN '100-150k mi' ELSE '150k+ mi' END) WHEN 'popularity' THEN (CASE WHEN watchers IS NULL THEN NULL WHEN watchers>=500 THEN '500+ watching' WHEN watchers>=200 THEN '200-499 watching' WHEN watchers>=100 THEN '100-199 watching' WHEN watchers>=50 THEN '50-99 watching' WHEN watchers>=10 THEN '10-49 watching' ELSE 'Under 10 watching' END) END) <> ''
    AND (NOT ($2 ? 'make') OR (make) = $2->>'make')
    AND (NOT ($2 ? 'model') OR (model) = $2->>'model')
    AND (NOT ($2 ? 'year') OR (year::text) = $2->>'year')
    AND (NOT ($2 ? 'metro') OR (city||', '||state) = $2->>'metro')
    AND (NOT ($2 ? 'dow') OR (to_char(sale_date,'Dy')) = $2->>'dow')
    AND (NOT ($2 ? 'color') OR (color_family) = $2->>'color')
    AND (NOT ($2 ? 'price') OR (CASE WHEN price IS NULL THEN NULL WHEN price<10000 THEN '<$10k' WHEN price<25000 THEN '$10-25k' WHEN price<50000 THEN '$25-50k' WHEN price<100000 THEN '$50-100k' WHEN price<250000 THEN '$100-250k' WHEN price<1000000 THEN '$250k-1M' ELSE '$1M+' END) = $2->>'price')
    AND (NOT ($2 ? 'mileage') OR (CASE WHEN mileage IS NULL THEN NULL WHEN mileage<1000 THEN 'Under 1k mi' WHEN mileage<10000 THEN '1-10k mi' WHEN mileage<50000 THEN '10-50k mi' WHEN mileage<100000 THEN '50-100k mi' WHEN mileage<150000 THEN '100-150k mi' ELSE '150k+ mi' END) = $2->>'mileage')
    AND (NOT ($2 ? 'popularity') OR (CASE WHEN watchers IS NULL THEN NULL WHEN watchers>=500 THEN '500+ watching' WHEN watchers>=200 THEN '200-499 watching' WHEN watchers>=100 THEN '100-199 watching' WHEN watchers>=50 THEN '50-99 watching' WHEN watchers>=10 THEN '10-49 watching' ELSE 'Under 10 watching' END) = $2->>'popularity')
  GROUP BY (CASE $1 WHEN 'make' THEN (make) WHEN 'model' THEN (model) WHEN 'year' THEN (year::text) WHEN 'metro' THEN (city||', '||state) WHEN 'dow' THEN (to_char(sale_date,'Dy')) WHEN 'color' THEN (color_family) WHEN 'price' THEN (CASE WHEN price IS NULL THEN NULL WHEN price<10000 THEN '<$10k' WHEN price<25000 THEN '$10-25k' WHEN price<50000 THEN '$25-50k' WHEN price<100000 THEN '$50-100k' WHEN price<250000 THEN '$100-250k' WHEN price<1000000 THEN '$250k-1M' ELSE '$1M+' END) WHEN 'mileage' THEN (CASE WHEN mileage IS NULL THEN NULL WHEN mileage<1000 THEN 'Under 1k mi' WHEN mileage<10000 THEN '1-10k mi' WHEN mileage<50000 THEN '10-50k mi' WHEN mileage<100000 THEN '50-100k mi' WHEN mileage<150000 THEN '100-150k mi' ELSE '150k+ mi' END) WHEN 'popularity' THEN (CASE WHEN watchers IS NULL THEN NULL WHEN watchers>=500 THEN '500+ watching' WHEN watchers>=200 THEN '200-499 watching' WHEN watchers>=100 THEN '100-199 watching' WHEN watchers>=50 THEN '50-99 watching' WHEN watchers>=10 THEN '10-49 watching' ELSE 'Under 10 watching' END) END)
  ORDER BY count(*) DESC
  LIMIT $3
$q$, v_where)
  USING p_group_by, p_filters, p_limit;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.market_pulse_filtered(text, jsonb, integer) TO anon, authenticated, service_role;
