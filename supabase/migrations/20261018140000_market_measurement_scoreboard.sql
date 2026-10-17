-- Market Measurement RSI Scoreboard & House Qualification Views (2026-10-18)
--
-- Expresses the market map's venue qualification rule and recursive self-improvement (RSI)
-- coverage scoreboard as first-class SQL relations:
--   1. public.v_market_house_coverage
--      One row per auction venue in mv_treemap_outcomes, joining source_census (population &
--      per-year by_year enumeration), mv_source_target_landed (landed lots), mv_treemap_outcomes
--      (confirmed sales & dollars), and mv_family_sales (dated sales in total and in each
--      365-day window). Computes `qualified_measured`: true when the house has a non-empty
--      per-year census (`by_year`) and landed_lots >= 90% of its enumerated population.
--   2. public.market_measured_houses()
--      IMMUTABLE-safe/STABLE SQL helper returning the ordered text[] of qualified measured
--      auction houses from v_market_house_coverage.
--   3. public.v_market_measurement_coverage
--      The 10-row RSI scoreboard across all six architectural layers (`baseline`, `log`,
--      `dimension`, `residual`, `key`, `fold`, `prediction`), reporting (layer, measure,
--      numerator, denominator, pct, grain).
--   4. public.treemap_populations()
--      Extended to include `measured_houses` (from v_market_house_coverage) and `dated` /
--      `qualified_measured` on each entry in `by_house`, so the frontend reads the qualified
--      houses directly from the data model rather than hardcoding venue names.
--   5. source_targets_slug_key_idx
--      Ensures the functional index on (source_slug, public.source_target_key(listing_url))
--      exists on public.source_targets so venue lot reconciliation is index-backed.

BEGIN;
SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '10s';

CREATE INDEX IF NOT EXISTS source_targets_slug_key_idx
  ON public.source_targets (source_slug, public.source_target_key(listing_url));

CREATE OR REPLACE VIEW public.v_market_house_coverage AS
WITH pop AS (
  SELECT DISTINCT ON (public.market_venue_label(o.slug))
         o.slug AS source_slug,
         public.market_venue_label(o.slug) AS house,
         c.universe_total,
         c.census_method,
         c.census_confidence,
         c.census_at
  FROM public.source_census c
  JOIN public.observation_sources o ON o.id = c.source_id
  WHERE public.market_venue_label(o.slug) IS NOT NULL
    AND (c.universe_total IS NULL OR c.universe_historical IS NOT NULL)
  ORDER BY public.market_venue_label(o.slug), c.census_at DESC
),
byr AS (
  SELECT DISTINCT ON (public.market_venue_label(o.slug))
         public.market_venue_label(o.slug) AS house,
         c.universe_total AS by_year_total,
         CASE WHEN jsonb_typeof(c.by_year) = 'object' AND c.by_year <> '{}'::jsonb THEN c.by_year END AS by_year
  FROM public.source_census c
  JOIN public.observation_sources o ON o.id = c.source_id
  WHERE public.market_venue_label(o.slug) IS NOT NULL
    AND c.by_year IS NOT NULL AND c.by_year <> '{}'::jsonb
  ORDER BY public.market_venue_label(o.slug), c.census_at DESC
),
lan AS (
  SELECT public.market_venue_label(source_slug) AS house,
         max(landed) AS landed_targets,
         max(landed_lots) AS landed_lots
  FROM public.mv_source_target_landed
  WHERE public.market_venue_label(source_slug) IS NOT NULL
  GROUP BY 1
),
outc AS (
  SELECT source_name AS house,
         count(*) FILTER (WHERE sold_amount > 0) AS confirmed_sold,
         (sum(sold_amount) FILTER (WHERE sold_amount > 0))::bigint AS confirmed_usd
  FROM public.mv_treemap_outcomes
  WHERE source_name IS NOT NULL
  GROUP BY source_name
),
dated AS (
  SELECT source AS house,
         count(*) AS dated_sold,
         count(*) FILTER (WHERE sale_date > current_date - 365 AND sale_date <= current_date) AS sold_12m,
         count(*) FILTER (WHERE sale_date > current_date - 730 AND sale_date <= current_date - 365) AS sold_prior_12m,
         (sum(usd) FILTER (WHERE sale_date > current_date - 365 AND sale_date <= current_date))::bigint AS usd_12m,
         (sum(usd) FILTER (WHERE sale_date > current_date - 730 AND sale_date <= current_date - 365))::bigint AS usd_prior_12m
  FROM public.mv_family_sales
  GROUP BY source
)
SELECT o.house,
       p.source_slug,
       coalesce(b.by_year_total, p.universe_total) AS census_total,
       p.census_method,
       p.census_confidence,
       l.landed_lots,
       round(100.0 * l.landed_lots / nullif(coalesce(b.by_year_total, p.universe_total), 0), 1) AS landed_pct,
       (b.by_year IS NOT NULL) AS has_by_year,
       o.confirmed_sold,
       o.confirmed_usd,
       coalesce(d.dated_sold, 0)::bigint AS dated_sold,
       round(100.0 * coalesce(d.dated_sold, 0) / nullif(o.confirmed_sold, 0), 1) AS dated_pct,
       coalesce(d.sold_12m, 0)::bigint AS sold_12m,
       coalesce(d.sold_prior_12m, 0)::bigint AS sold_prior_12m,
       coalesce(d.usd_12m, 0)::bigint AS usd_12m,
       coalesce(d.usd_prior_12m, 0)::bigint AS usd_prior_12m,
       (b.by_year IS NOT NULL
        AND coalesce(b.by_year_total, p.universe_total) > 0
        AND l.landed_lots >= 0.90 * coalesce(b.by_year_total, p.universe_total)) AS qualified_measured
FROM outc o
LEFT JOIN pop p ON p.house = o.house
LEFT JOIN byr b ON b.house = o.house
LEFT JOIN lan l ON l.house = o.house
LEFT JOIN dated d ON d.house = o.house
ORDER BY o.confirmed_sold DESC, o.house;

REVOKE ALL ON public.v_market_house_coverage FROM PUBLIC;
GRANT SELECT ON public.v_market_house_coverage TO anon, authenticated, service_role;
COMMENT ON VIEW public.v_market_house_coverage IS
  'Per-venue market qualification fold joining source_census (population & per-year by_year enumeration), '
  'mv_source_target_landed (landed lots), mv_treemap_outcomes (confirmed sales), and mv_family_sales (dated sales). '
  'A house earns qualified_measured = true when it has a per-year census and we hold >=90% of its enumerated lots.';

CREATE OR REPLACE FUNCTION public.market_measured_houses()
 RETURNS text[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(house ORDER BY confirmed_sold DESC, house), ARRAY[]::text[])
  FROM public.v_market_house_coverage
  WHERE qualified_measured IS TRUE;
$function$;

REVOKE ALL ON FUNCTION public.market_measured_houses() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_measured_houses() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.market_measured_houses() IS
  'Ordered list of auction houses that pass the 90% per-year census qualification gate in v_market_house_coverage.';

CREATE OR REPLACE VIEW public.v_market_measurement_coverage AS
WITH hc AS (
  SELECT count(*) AS total_houses,
         count(*) FILTER (WHERE qualified_measured) AS measured_houses,
         sum(confirmed_sold)::bigint AS total_sold,
         sum(dated_sold)::bigint AS total_dated_sold,
         sum(confirmed_sold) FILTER (WHERE qualified_measured)::bigint AS measured_house_sold,
         sum(dated_sold) FILTER (WHERE qualified_measured)::bigint AS measured_house_dated_sold
  FROM public.v_market_house_coverage
),
outc_id AS (
  SELECT count(*) FILTER (WHERE sold_amount > 0) AS sold_total,
         count(*) FILTER (WHERE sold_amount > 0 AND nullif(btrim(model), '') IS NOT NULL) AS sold_with_model,
         count(*) FILTER (WHERE sold_amount > 0 AND nullif(btrim(model), '') IS NULL) AS sold_null_model
  FROM public.mv_treemap_outcomes
),
fam_cov AS (
  SELECT sum(sold)::bigint AS total_sold,
         sum(sold) FILTER (WHERE family_key <> 'other')::bigint AS keyed_sold,
         sum(usd)::bigint AS total_usd,
         sum(usd) FILTER (WHERE family_key <> 'other')::bigint AS keyed_usd,
         count(DISTINCT (brand, family_key)) FILTER (WHERE family_key <> 'other') AS total_families,
         count(DISTINCT (brand, family_key)) FILTER (WHERE family_key <> 'other' AND f_sold_12m >= 20 AND f_sold_prior_12m >= 20) AS families_passing_count,
         count(DISTINCT (brand, family_key)) FILTER (WHERE family_key <> 'other' AND f_sold_12m >= 20 AND f_sold_prior_12m >= 20 AND f_dated >= 0.5 * f_sold) AS families_colored
  FROM (
    SELECT brand, family_key, sold, usd,
           sum(sold) OVER (PARTITION BY brand, family_key) AS f_sold,
           sum(bat_dated) OVER (PARTITION BY brand, family_key) AS f_dated,
           sum(bat_sold_12m) OVER (PARTITION BY brand, family_key) AS f_sold_12m,
           sum(bat_sold_prior_12m) OVER (PARTITION BY brand, family_key) AS f_sold_prior_12m
    FROM public.mv_family_market
  ) m
),
brand_cov AS (
  SELECT count(*) AS total_brands,
         count(*) FILTER (WHERE sold_12m >= 20 AND sold_prior_12m >= 20) AS brands_passing_count,
         count(*) FILTER (WHERE sold_12m >= 20 AND sold_prior_12m >= 20 AND dated >= 0.5 * sold) AS brands_colored
  FROM public.treemap_brand_market()
),
hed_cov AS (
  SELECT count(*) AS eligible_families,
         (SELECT count(*) FROM public.family_price_change WHERE method = 'hedonic_v1' AND change_12m IS NOT NULL) AS fitted_families
  FROM (
    SELECT brand, family_key
    FROM public.mv_family_sales
    WHERE family_key <> 'other' AND usd >= 500 AND sale_date >= date '2016-01-01' AND sale_date <= current_date
    GROUP BY brand, family_key
    HAVING count(*) >= 150
       AND count(*) FILTER (WHERE sale_date > current_date - 365) >= 30
       AND count(*) FILTER (WHERE sale_date > current_date - 730 AND sale_date <= current_date - 365) >= 30
  ) e
)
SELECT layer,
       measure,
       numerator,
       denominator,
       round(100.0 * numerator / nullif(denominator, 0), 1) AS pct,
       grain
FROM (
  SELECT 'baseline' AS layer, 'auction houses qualified as measured (>=90% census & by_year)' AS measure, measured_houses AS numerator, total_houses AS denominator, 'houses' AS grain FROM hc
  UNION ALL
  SELECT 'log', 'confirmed sales carrying a sale_date on vehicles', total_dated_sold, total_sold, 'sales' FROM hc
  UNION ALL
  SELECT 'log', 'confirmed sales at measured houses carrying a sale_date', measured_house_dated_sold, measured_house_sold, 'sales' FROM hc
  UNION ALL
  SELECT 'dimension', 'confirmed sales carrying a non-null model', sold_with_model, sold_total, 'sales' FROM outc_id
  UNION ALL
  SELECT 'residual', 'confirmed sales missing model (must approach 0)', sold_null_model, sold_total, 'sales' FROM outc_id
  UNION ALL
  SELECT 'key', 'confirmed sales keyed to a named canonical model family', keyed_sold, total_sold, 'sales' FROM fam_cov
  UNION ALL
  SELECT 'key', 'confirmed sale dollars keyed to a named canonical model family', keyed_usd, total_usd, 'usd' FROM fam_cov
  UNION ALL
  SELECT 'fold', 'brands with >=20 sales/yr passing the 50% measured-house share gate', brands_colored, brands_passing_count, 'brands' FROM brand_cov
  UNION ALL
  SELECT 'fold', 'named families with >=20 sales/yr passing the 50% measured-house share gate', families_colored, families_passing_count, 'families' FROM fam_cov
  UNION ALL
  SELECT 'prediction', 'eligible model families (30/30/150 floor) fitted with hedonic_v1 price index', fitted_families, eligible_families, 'families' FROM hed_cov
) s;

REVOKE ALL ON public.v_market_measurement_coverage FROM PUBLIC;
GRANT SELECT ON public.v_market_measurement_coverage TO anon, authenticated, service_role;
COMMENT ON VIEW public.v_market_measurement_coverage IS
  'Recursive self-improvement (RSI) coverage scoreboard for the market treemap & price-index stack across '
  'baseline, log, dimension, residual, key, fold, and prediction layers.';

CREATE OR REPLACE FUNCTION public.treemap_populations()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'measure', 'confirmed_sale_v1',
    'public_records', (SELECT count(*) FROM public.vehicles v
                        WHERE v.is_public IS TRUE AND v.deleted_at IS NULL
                          AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'),
    'known_outcomes', (SELECT count(*) FROM public.mv_treemap_outcomes),
    'confirmed_sales', (SELECT count(*) FROM public.mv_treemap_outcomes WHERE outcome = 'sold'),
    'confirmed_sales_with_amount', (SELECT count(*) FROM public.mv_treemap_outcomes WHERE sold_amount > 0),
    'mapped_makes', (SELECT count(*) FROM public.mv_treemap_sale_brands),
    'mapped_sales', (SELECT COALESCE(sum(count), 0) FROM public.mv_treemap_sale_brands),
    'make_floor', 5,
    'median_floor', 5,
    'measured_houses', to_jsonb(public.market_measured_houses()),
    'by_house', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                          'house', h.house,
                          'sales', h.confirmed_sold,
                          'amount', h.confirmed_usd,
                          'dated', h.dated_sold,
                          'sold_12m', h.sold_12m,
                          'sold_prior_12m', h.sold_prior_12m,
                          'qualified_measured', h.qualified_measured
                        ) ORDER BY h.confirmed_sold DESC, h.house NULLS LAST), '[]'::jsonb)
                 FROM public.v_market_house_coverage h));
$function$;

REVOKE ALL ON FUNCTION public.treemap_populations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_populations() TO anon, authenticated, service_role;

COMMIT;
