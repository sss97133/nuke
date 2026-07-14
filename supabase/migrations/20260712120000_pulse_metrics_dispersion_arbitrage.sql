-- 20260712120000_pulse_metrics_dispersion_arbitrage.sql
--
-- Extend the treemap data layer from "census" (count) to "pulse" (value / dispersion /
-- demand / arbitrage). Adds per-group metrics to BOTH engines that color the iOS
-- MarketTreemapView:
--   * mv_market_position (+ market_position RPC) — make-level materialized matview
--   * market_pulse_filtered RPC                  — live filtered aggregation
--
-- New per-group columns (all DEFENSIBLE from covered data, coverage flags included):
--   total_value bigint  SUM(price) over the group           -> AREA = $-value mode
--   p25,p50,p75 bigint  price percentiles (percentile_cont) -> DISPERSION / price-z color (never shown as a number)
--   price_n     int     rows in group that HAVE a price     -> coverage / honesty flag
--   watch_sum   bigint  SUM(bat_watchers)                   -> watchers-per-listing demand color
--   watch_n     int     count(bat_watchers non-null)        -> coverage for the demand color
--   auction_med bigint  median price among AUCTION sources  -> arbitrage color = auction_med/market_med - 1
--   market_med  bigint  median price among MARKETPLACE srcs  -> "                                          "
--
-- price := COALESCE(sale_price, sold_price, canonical_sold_price); only non-null summed/percentiled.
-- percentile_cont sort key cast to double precision (ordered-set aggregate requirement).
--
-- Source -> AUCTION / MARKETPLACE split derived from the actual DISTINCT `vehicles.source`
-- values in prod (2026-07-12). Editorial/aggregator/unknown/dealer-proper-name sources
-- (conceptcarz, classic-driver-editorial, 'unknown', named dealers) fall in NEITHER bucket
-- so they never contaminate the arbitrage medians. Coverage at write time:
--   auction: 296,538 priced rows | marketplace: 143,177 priced rows | neither: 39,150 rows.
--
-- AUCTION sources (lower(source)):
--   bat, bring_a_trailer, bringatrailer, mecum, barrett-jackson, cars_and_bids, bonhams,
--   rm-sothebys, gooding, leake, silver-auctions, kruse, auctions-america, mccormicks,
--   russo-and-steele, pcarmarket, gaa-classic-cars, palm-springs-exotic, themarket-bonhams,
--   h-and-h, coys, worldwide-auctioneers, shannons, broad_arrow, artcurial, collecting_cars,
--   branson-auctions, midamerica, gpk-auctions, historics, hollywood-car-auction, sbx-cars,
--   grand-prix-classics, carlisle
-- MARKETPLACE sources (lower(source)):
--   facebook_marketplace, facebook-marketplace, facebook-saved, classiccars-com,
--   classiccars.com, craigslist, ksl, jamesedition, erclassics, hemmings, ebay, classic-com,
--   dealer_website, barnfinds, classic-driver, dupont registry, autotrader, cars_com

-- ---------------------------------------------------------------------------
-- 0. Drop dependents first (return-type changes require DROP, not REPLACE).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.market_position(text, integer);
DROP FUNCTION IF EXISTS public.market_pulse_filtered(text, jsonb, integer);
DROP MATERIALIZED VIEW IF EXISTS public.mv_market_position;

-- ---------------------------------------------------------------------------
-- 1. Rebuild the make-level materialized matview with pulse metrics.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW public.mv_market_position AS
WITH v AS (
  SELECT
    make,
    bat_watchers AS watch,
    year,
    COALESCE(sale_price::numeric, sold_price::numeric, canonical_sold_price) AS price,
    (sale_status = 'sold' OR auction_status = 'sold') AS is_sold,
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
  FROM vehicles
  WHERE is_public AND make IS NOT NULL
)
SELECT
  'make'::text AS dim,
  make AS name,
  count(*) AS volume,
  round(100.0 * count(*) FILTER (WHERE is_sold) / count(*))::int AS sell_through,
  round(avg(watch))::int AS demand,
  round(avg(year))::int AS avg_year,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY price::double precision)::bigint AS median_price,
  -- pulse metrics --------------------------------------------------------
  sum(price) FILTER (WHERE price IS NOT NULL)::bigint AS total_value,
  percentile_cont(0.25) WITHIN GROUP (ORDER BY price::double precision)::bigint AS p25,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY price::double precision)::bigint AS p50,
  percentile_cont(0.75) WITHIN GROUP (ORDER BY price::double precision)::bigint AS p75,
  count(*) FILTER (WHERE price IS NOT NULL)::int AS price_n,
  sum(watch) FILTER (WHERE watch IS NOT NULL)::bigint AS watch_sum,
  count(*) FILTER (WHERE watch IS NOT NULL)::int AS watch_n,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY price::double precision)
    FILTER (WHERE is_auction)::bigint AS auction_med,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY price::double precision)
    FILTER (WHERE is_marketplace)::bigint AS market_med
FROM v
GROUP BY make;

-- UNIQUE index required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX mv_market_position_pk ON public.mv_market_position USING btree (dim, name);

-- ---------------------------------------------------------------------------
-- 2. market_position RPC — return the new columns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.market_position(p_dimension text, p_limit integer DEFAULT 120)
RETURNS TABLE(
  name text, volume bigint, sell_through integer, demand integer, avg_year integer, median_price bigint,
  total_value bigint, p25 bigint, p50 bigint, p75 bigint, price_n integer,
  watch_sum bigint, watch_n integer, auction_med bigint, market_med bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT name, volume, sell_through, demand, avg_year, median_price,
         total_value, p25, p50, p75, price_n, watch_sum, watch_n, auction_med, market_med
  FROM mv_market_position
  WHERE dim = p_dimension AND volume >= 5
  ORDER BY volume DESC
  LIMIT p_limit;
$function$;

-- ---------------------------------------------------------------------------
-- 3. market_pulse_filtered RPC — same filter logic, plus pulse metrics.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.market_pulse_filtered(
  p_group_by text, p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 40)
RETURNS TABLE(
  name text, count bigint, value bigint, median_price bigint, avg_year integer,
  image_url text, sell_through integer,
  total_value bigint, p25 bigint, p50 bigint, p75 bigint, price_n integer,
  watch_sum bigint, watch_n integer, auction_med bigint, market_med bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    FROM vehicles WHERE is_public
  )
  SELECT
    (CASE p_group_by WHEN 'make' THEN (make) WHEN 'model' THEN (model) WHEN 'year' THEN (year::text) WHEN 'metro' THEN (city||', '||state) WHEN 'dow' THEN (to_char(sale_date,'Dy')) WHEN 'color' THEN (color_family) WHEN 'price' THEN (CASE WHEN price IS NULL THEN NULL WHEN price<10000 THEN '<$10k' WHEN price<25000 THEN '$10-25k' WHEN price<50000 THEN '$25-50k' WHEN price<100000 THEN '$50-100k' WHEN price<250000 THEN '$100-250k' WHEN price<1000000 THEN '$250k-1M' ELSE '$1M+' END) WHEN 'mileage' THEN (CASE WHEN mileage IS NULL THEN NULL WHEN mileage<1000 THEN 'Under 1k mi' WHEN mileage<10000 THEN '1-10k mi' WHEN mileage<50000 THEN '10-50k mi' WHEN mileage<100000 THEN '50-100k mi' WHEN mileage<150000 THEN '100-150k mi' ELSE '150k+ mi' END) WHEN 'popularity' THEN (CASE WHEN watchers IS NULL THEN NULL WHEN watchers>=500 THEN '500+ watching' WHEN watchers>=200 THEN '200-499 watching' WHEN watchers>=100 THEN '100-199 watching' WHEN watchers>=50 THEN '50-99 watching' WHEN watchers>=10 THEN '10-49 watching' ELSE 'Under 10 watching' END) END) AS name,
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
  WHERE (CASE p_group_by WHEN 'make' THEN (make) WHEN 'model' THEN (model) WHEN 'year' THEN (year::text) WHEN 'metro' THEN (city||', '||state) WHEN 'dow' THEN (to_char(sale_date,'Dy')) WHEN 'color' THEN (color_family) WHEN 'price' THEN (CASE WHEN price IS NULL THEN NULL WHEN price<10000 THEN '<$10k' WHEN price<25000 THEN '$10-25k' WHEN price<50000 THEN '$25-50k' WHEN price<100000 THEN '$50-100k' WHEN price<250000 THEN '$100-250k' WHEN price<1000000 THEN '$250k-1M' ELSE '$1M+' END) WHEN 'mileage' THEN (CASE WHEN mileage IS NULL THEN NULL WHEN mileage<1000 THEN 'Under 1k mi' WHEN mileage<10000 THEN '1-10k mi' WHEN mileage<50000 THEN '10-50k mi' WHEN mileage<100000 THEN '50-100k mi' WHEN mileage<150000 THEN '100-150k mi' ELSE '150k+ mi' END) WHEN 'popularity' THEN (CASE WHEN watchers IS NULL THEN NULL WHEN watchers>=500 THEN '500+ watching' WHEN watchers>=200 THEN '200-499 watching' WHEN watchers>=100 THEN '100-199 watching' WHEN watchers>=50 THEN '50-99 watching' WHEN watchers>=10 THEN '10-49 watching' ELSE 'Under 10 watching' END) END) IS NOT NULL
    AND (CASE p_group_by WHEN 'make' THEN (make) WHEN 'model' THEN (model) WHEN 'year' THEN (year::text) WHEN 'metro' THEN (city||', '||state) WHEN 'dow' THEN (to_char(sale_date,'Dy')) WHEN 'color' THEN (color_family) WHEN 'price' THEN (CASE WHEN price IS NULL THEN NULL WHEN price<10000 THEN '<$10k' WHEN price<25000 THEN '$10-25k' WHEN price<50000 THEN '$25-50k' WHEN price<100000 THEN '$50-100k' WHEN price<250000 THEN '$100-250k' WHEN price<1000000 THEN '$250k-1M' ELSE '$1M+' END) WHEN 'mileage' THEN (CASE WHEN mileage IS NULL THEN NULL WHEN mileage<1000 THEN 'Under 1k mi' WHEN mileage<10000 THEN '1-10k mi' WHEN mileage<50000 THEN '10-50k mi' WHEN mileage<100000 THEN '50-100k mi' WHEN mileage<150000 THEN '100-150k mi' ELSE '150k+ mi' END) WHEN 'popularity' THEN (CASE WHEN watchers IS NULL THEN NULL WHEN watchers>=500 THEN '500+ watching' WHEN watchers>=200 THEN '200-499 watching' WHEN watchers>=100 THEN '100-199 watching' WHEN watchers>=50 THEN '50-99 watching' WHEN watchers>=10 THEN '10-49 watching' ELSE 'Under 10 watching' END) END) <> ''
    AND (NOT (p_filters ? 'make') OR (make) = p_filters->>'make')
    AND (NOT (p_filters ? 'model') OR (model) = p_filters->>'model')
    AND (NOT (p_filters ? 'year') OR (year::text) = p_filters->>'year')
    AND (NOT (p_filters ? 'metro') OR (city||', '||state) = p_filters->>'metro')
    AND (NOT (p_filters ? 'dow') OR (to_char(sale_date,'Dy')) = p_filters->>'dow')
    AND (NOT (p_filters ? 'color') OR (color_family) = p_filters->>'color')
    AND (NOT (p_filters ? 'price') OR (CASE WHEN price IS NULL THEN NULL WHEN price<10000 THEN '<$10k' WHEN price<25000 THEN '$10-25k' WHEN price<50000 THEN '$25-50k' WHEN price<100000 THEN '$50-100k' WHEN price<250000 THEN '$100-250k' WHEN price<1000000 THEN '$250k-1M' ELSE '$1M+' END) = p_filters->>'price')
    AND (NOT (p_filters ? 'mileage') OR (CASE WHEN mileage IS NULL THEN NULL WHEN mileage<1000 THEN 'Under 1k mi' WHEN mileage<10000 THEN '1-10k mi' WHEN mileage<50000 THEN '10-50k mi' WHEN mileage<100000 THEN '50-100k mi' WHEN mileage<150000 THEN '100-150k mi' ELSE '150k+ mi' END) = p_filters->>'mileage')
    AND (NOT (p_filters ? 'popularity') OR (CASE WHEN watchers IS NULL THEN NULL WHEN watchers>=500 THEN '500+ watching' WHEN watchers>=200 THEN '200-499 watching' WHEN watchers>=100 THEN '100-199 watching' WHEN watchers>=50 THEN '50-99 watching' WHEN watchers>=10 THEN '10-49 watching' ELSE 'Under 10 watching' END) = p_filters->>'popularity')
  GROUP BY (CASE p_group_by WHEN 'make' THEN (make) WHEN 'model' THEN (model) WHEN 'year' THEN (year::text) WHEN 'metro' THEN (city||', '||state) WHEN 'dow' THEN (to_char(sale_date,'Dy')) WHEN 'color' THEN (color_family) WHEN 'price' THEN (CASE WHEN price IS NULL THEN NULL WHEN price<10000 THEN '<$10k' WHEN price<25000 THEN '$10-25k' WHEN price<50000 THEN '$25-50k' WHEN price<100000 THEN '$50-100k' WHEN price<250000 THEN '$100-250k' WHEN price<1000000 THEN '$250k-1M' ELSE '$1M+' END) WHEN 'mileage' THEN (CASE WHEN mileage IS NULL THEN NULL WHEN mileage<1000 THEN 'Under 1k mi' WHEN mileage<10000 THEN '1-10k mi' WHEN mileage<50000 THEN '10-50k mi' WHEN mileage<100000 THEN '50-100k mi' WHEN mileage<150000 THEN '100-150k mi' ELSE '150k+ mi' END) WHEN 'popularity' THEN (CASE WHEN watchers IS NULL THEN NULL WHEN watchers>=500 THEN '500+ watching' WHEN watchers>=200 THEN '200-499 watching' WHEN watchers>=100 THEN '100-199 watching' WHEN watchers>=50 THEN '50-99 watching' WHEN watchers>=10 THEN '10-49 watching' ELSE 'Under 10 watching' END) END)
  ORDER BY count(*) DESC
  LIMIT p_limit;
$function$;

-- Grants mirror the prior objects (anon/authenticated call these RPCs from the app).
GRANT EXECUTE ON FUNCTION public.market_position(text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.market_pulse_filtered(text, jsonb, integer) TO anon, authenticated, service_role;
GRANT SELECT ON public.mv_market_position TO anon, authenticated, service_role;
