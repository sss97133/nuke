-- 20260713010000_canonical_identity_pivots.sql
--
-- THE IDENTITY LAW: the iOS Pulse treemap pivots group by CANONICAL identity, not raw
-- listing strings. Before this migration the make/model dims grouped 594,873 public cars
-- by 8,962 raw make strings and 113,327 raw model strings (trim/casing/free-text junk).
-- After: make dim = canonical_makes display names (+ ONE honest 'Unresolved' group),
-- model dim = 'Make CanonicalModel' pairs validated against canonical_models (+ ONE
-- 'Unresolved' group). The Unresolved group hides nothing — it IS the work queue for
-- image/dossier analysis. Owner's ruling: "if the data is bad we fix the data."
--
-- Applied to prod 2026-07-13 via direct psql (matviews built under _new names, then
-- atomically swapped so market_pulse / market_position RPCs saw zero downtime).
--
-- ============================================================================
-- PART A (record only — data backfill, executed batched, NOT re-runnable here)
-- ============================================================================
-- The platform's own resolution routines (trg_auto_normalize_model ->
-- normalize_vehicle_model(), trigger_auto_classify_vehicle) fire only on
-- INSERT/UPDATE OF make, model, year — they never revisit historical rows.
-- A one-time set-based backfill mirroring their EXACT-match branches was run
-- (2026-07-13) in 1,000-row batches with pg_sleep + lock checks:
--
--   * normalized_model / normalized_series / generation / model_confidence=100
--     where lower(btrim(model)) — cleaned exactly like normalize_vehicle_model()
--     (strip " in <location>...", trailing truck/vehicle/car/for sale, collapse
--     spaces) — equals a canonical_models alias OR lower(canonical_model), with
--     make agreement (lower(cm.make) = lower(v.make)) and year within
--     [year_start, year_end] when the vehicle has a year. Only combos resolving
--     to exactly ONE canonical_model were written; ambiguous stayed NULL.
--     => 86,124 vehicles resolved (1,222 ambiguous left NULL).
--
--   * canonical_make_id where lower(btrim(make)) equals exactly one
--     canonical_makes canonical_name/display_name/alias (auto_classify_vehicle's
--     lookup, case-relaxed). Only unambiguous single-id matches written.
--     => 150,664 vehicles resolved (416 ambiguous left NULL).
--
-- Coverage (all 919,183 vehicles): canonical_make_id 74.8% -> 91.2%,
-- normalized_model 52.4% -> 61.7%.  (Numbers re-measured post-run; see report.)
--
-- ============================================================================
-- PART B (deployed DDL — the canonical pivot matviews)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. mv_market_pulse — make + model dims now canonical; other 7 dims unchanged.
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_market_pulse;
CREATE MATERIALIZED VIEW mv_market_pulse AS
WITH pairs AS (
  -- The canonical identity space: (canonical make, canonical model) pairs.
  SELECT DISTINCT mk.id AS make_id, cm.canonical_model
  FROM canonical_models cm
  JOIN canonical_makes mk
    ON lower(cm.make) IN (lower(mk.canonical_name), lower(mk.display_name))
),
v AS (
  SELECT
    COALESCE(mk.display_name, mk.canonical_name) AS canon_make,
    CASE WHEN p.canonical_model IS NOT NULL
         THEN COALESCE(mk.display_name, mk.canonical_name) || ' ' || veh.normalized_model
    END AS canon_model,
    veh.year, veh.city, veh.state, veh.sale_date, veh.color_family, veh.mileage,
    veh.bat_watchers AS watchers,
    COALESCE(veh.sale_price, veh.sold_price, veh.canonical_sold_price) AS price,
    veh.primary_image_url AS img,
    CASE WHEN veh.canonical_platform IN ('bat','cars-and-bids','barrett-jackson','mecum','bonhams','classiccars-com','gooding','rm-sothebys','broad-arrow') THEN 0 ELSE 1 END AS plat_rank
  FROM vehicles veh
  LEFT JOIN canonical_makes mk ON mk.id = veh.canonical_make_id
  LEFT JOIN pairs p ON p.make_id = veh.canonical_make_id
                   AND p.canonical_model = veh.normalized_model
  WHERE veh.is_public
)
SELECT * FROM (
SELECT 'make'::text dim, COALESCE(canon_make,'Unresolved') name, count(*)::bigint count, percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::bigint median_price, (array_agg(img ORDER BY plat_rank, price DESC NULLS LAST) FILTER (WHERE img IS NOT NULL AND img <> ''))[1] image_url FROM v GROUP BY COALESCE(canon_make,'Unresolved')
UNION ALL
SELECT 'model'::text dim, COALESCE(canon_model,'Unresolved') name, count(*)::bigint count, percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::bigint median_price, (array_agg(img ORDER BY plat_rank, price DESC NULLS LAST) FILTER (WHERE img IS NOT NULL AND img <> ''))[1] image_url FROM v GROUP BY COALESCE(canon_model,'Unresolved')
UNION ALL
SELECT 'year'::text dim, (year::text) name, count(*)::bigint count, percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::bigint median_price, (array_agg(img ORDER BY plat_rank, price DESC NULLS LAST) FILTER (WHERE img IS NOT NULL AND img <> ''))[1] image_url FROM v WHERE year BETWEEN 1885 AND 2027 GROUP BY (year::text)
UNION ALL
SELECT 'metro'::text dim, (city||', '||state) name, count(*)::bigint count, percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::bigint median_price, (array_agg(img ORDER BY plat_rank, price DESC NULLS LAST) FILTER (WHERE img IS NOT NULL AND img <> ''))[1] image_url FROM v WHERE city IS NOT NULL AND state IS NOT NULL GROUP BY (city||', '||state)
UNION ALL
SELECT 'dow'::text dim, (to_char(sale_date,'Dy')) name, count(*)::bigint count, percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::bigint median_price, (array_agg(img ORDER BY plat_rank, price DESC NULLS LAST) FILTER (WHERE img IS NOT NULL AND img <> ''))[1] image_url FROM v WHERE sale_date IS NOT NULL GROUP BY (to_char(sale_date,'Dy'))
UNION ALL
SELECT 'color'::text dim, (color_family) name, count(*)::bigint count, percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::bigint median_price, (array_agg(img ORDER BY plat_rank, price DESC NULLS LAST) FILTER (WHERE img IS NOT NULL AND img <> ''))[1] image_url FROM v WHERE color_family IS NOT NULL GROUP BY (color_family)
UNION ALL
SELECT 'price'::text dim, (CASE WHEN price IS NULL THEN NULL WHEN price<10000 THEN '<$10k' WHEN price<25000 THEN '$10-25k' WHEN price<50000 THEN '$25-50k' WHEN price<100000 THEN '$50-100k' WHEN price<250000 THEN '$100-250k' WHEN price<1000000 THEN '$250k-1M' ELSE '$1M+' END) name, count(*)::bigint count, percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::bigint median_price, (array_agg(img ORDER BY plat_rank, price DESC NULLS LAST) FILTER (WHERE img IS NOT NULL AND img <> ''))[1] image_url FROM v WHERE price IS NOT NULL GROUP BY (CASE WHEN price IS NULL THEN NULL WHEN price<10000 THEN '<$10k' WHEN price<25000 THEN '$10-25k' WHEN price<50000 THEN '$25-50k' WHEN price<100000 THEN '$50-100k' WHEN price<250000 THEN '$100-250k' WHEN price<1000000 THEN '$250k-1M' ELSE '$1M+' END)
UNION ALL
SELECT 'mileage'::text dim, (CASE WHEN mileage IS NULL THEN NULL WHEN mileage<1000 THEN 'Under 1k mi' WHEN mileage<10000 THEN '1-10k mi' WHEN mileage<50000 THEN '10-50k mi' WHEN mileage<100000 THEN '50-100k mi' WHEN mileage<150000 THEN '100-150k mi' ELSE '150k+ mi' END) name, count(*)::bigint count, percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::bigint median_price, (array_agg(img ORDER BY plat_rank, price DESC NULLS LAST) FILTER (WHERE img IS NOT NULL AND img <> ''))[1] image_url FROM v WHERE mileage IS NOT NULL AND mileage >= 0 GROUP BY (CASE WHEN mileage IS NULL THEN NULL WHEN mileage<1000 THEN 'Under 1k mi' WHEN mileage<10000 THEN '1-10k mi' WHEN mileage<50000 THEN '10-50k mi' WHEN mileage<100000 THEN '50-100k mi' WHEN mileage<150000 THEN '100-150k mi' ELSE '150k+ mi' END)
UNION ALL
SELECT 'popularity'::text dim, (CASE WHEN watchers IS NULL THEN NULL WHEN watchers>=500 THEN '500+ watching' WHEN watchers>=200 THEN '200-499 watching' WHEN watchers>=100 THEN '100-199 watching' WHEN watchers>=50 THEN '50-99 watching' WHEN watchers>=10 THEN '10-49 watching' ELSE 'Under 10 watching' END) name, count(*)::bigint count, percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::bigint median_price, (array_agg(img ORDER BY plat_rank, price DESC NULLS LAST) FILTER (WHERE img IS NOT NULL AND img <> ''))[1] image_url FROM v WHERE watchers IS NOT NULL GROUP BY (CASE WHEN watchers IS NULL THEN NULL WHEN watchers>=500 THEN '500+ watching' WHEN watchers>=200 THEN '200-499 watching' WHEN watchers>=100 THEN '100-199 watching' WHEN watchers>=50 THEN '50-99 watching' WHEN watchers>=10 THEN '10-49 watching' ELSE 'Under 10 watching' END)
) s WHERE name IS NOT NULL AND name <> '';

-- UNIQUE index required for REFRESH MATERIALIZED VIEW CONCURRENTLY (cron).
CREATE UNIQUE INDEX mv_market_pulse_pk ON mv_market_pulse (dim, name);
GRANT SELECT ON mv_market_pulse TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. mv_market_position — make dim canonical; ALL pulse-metric columns kept
--    (exact column set from 20260712120000_pulse_metrics_dispersion_arbitrage).
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_market_position;
CREATE MATERIALIZED VIEW mv_market_position AS
WITH v AS (
  SELECT
    COALESCE(mk.display_name, mk.canonical_name, 'Unresolved') AS canon_make,
    veh.bat_watchers AS watch,
    veh.year,
    COALESCE(veh.sale_price::numeric, veh.sold_price::numeric, veh.canonical_sold_price) AS price,
    (veh.sale_status = 'sold' OR veh.auction_status = 'sold') AS is_sold,
    lower(veh.source) = ANY (ARRAY[
      'bat','bring_a_trailer','bringatrailer','mecum','barrett-jackson','cars_and_bids',
      'bonhams','rm-sothebys','gooding','leake','silver-auctions','kruse','auctions-america',
      'mccormicks','russo-and-steele','pcarmarket','gaa-classic-cars','palm-springs-exotic',
      'themarket-bonhams','h-and-h','coys','worldwide-auctioneers','shannons','broad_arrow',
      'artcurial','collecting_cars','branson-auctions','midamerica','gpk-auctions','historics',
      'hollywood-car-auction','sbx-cars','grand-prix-classics','carlisle']) AS is_auction,
    lower(veh.source) = ANY (ARRAY[
      'facebook_marketplace','facebook-marketplace','facebook-saved','classiccars-com',
      'classiccars.com','craigslist','ksl','jamesedition','erclassics','hemmings','ebay',
      'classic-com','dealer_website','barnfinds','classic-driver','dupont registry',
      'autotrader','cars_com']) AS is_marketplace
  FROM vehicles veh
  LEFT JOIN canonical_makes mk ON mk.id = veh.canonical_make_id
  WHERE veh.is_public
)
SELECT
  'make'::text AS dim,
  canon_make AS name,
  count(*) AS volume,
  round(100.0 * count(*) FILTER (WHERE is_sold) / count(*))::int AS sell_through,
  round(avg(watch))::int AS demand,
  round(avg(year))::int AS avg_year,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY price::double precision)::bigint AS median_price,
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
GROUP BY canon_make;

CREATE UNIQUE INDEX mv_market_position_pk ON mv_market_position (dim, name);
GRANT SELECT ON mv_market_position TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. mv_market_position previously had NO refresh cron (it was frozen at build
--    time). Extend the existing refresh-market-pulse job to refresh both.
-- ---------------------------------------------------------------------------
SELECT cron.schedule('refresh-market-pulse', '*/30 * * * *',
  'REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_market_pulse; REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_market_position');

NOTIFY pgrst, 'reload schema';

-- NOTE (out of scope, flagged): market_pulse_filtered() still groups the model
-- dim by RAW vehicles.model when drilling. Its make/model grouping should get the
-- same canonical treatment in a follow-up so top-level and drilled views agree.
-- The market_pulse / market_position RPC signatures are unchanged by this migration.
