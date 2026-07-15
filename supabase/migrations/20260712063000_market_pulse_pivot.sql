-- market_pulse — the pivot engine behind Explore's "Pulse" lens (iOS).
-- One market grouped by 9 dimensions (make/model/year/price/mileage/color/
-- popularity/metro/day-of-week); price/mileage/popularity are bands, color is
-- color_family. Each group carries a representative car photo chosen PRO-SOURCE
-- FIRST (bat/cars-and-bids/mecum/... over facebook/craigslist snapshots), so the
-- treemap is a clean photo mosaic. Applied to prod 2026-07-12.

DROP MATERIALIZED VIEW IF EXISTS mv_market_pulse;
CREATE MATERIALIZED VIEW mv_market_pulse AS
WITH v AS (
  SELECT make, model, year, city, state, sale_date, color_family, mileage,
         bat_watchers AS watchers,
         COALESCE(sale_price, sold_price, canonical_sold_price) AS price,
         primary_image_url AS img,
         CASE WHEN canonical_platform IN ('bat','cars-and-bids','barrett-jackson','mecum','bonhams','classiccars-com','gooding','rm-sothebys','broad-arrow') THEN 0 ELSE 1 END AS plat_rank
  FROM vehicles WHERE is_public
)
SELECT * FROM ( SELECT 'make'::text dim, (make) name, count(*)::bigint count, percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::bigint median_price, (array_agg(img ORDER BY plat_rank, price DESC NULLS LAST) FILTER (WHERE img IS NOT NULL AND img <> ''))[1] image_url FROM v WHERE make IS NOT NULL GROUP BY (make)
UNION ALL
SELECT 'model'::text dim, (btrim(make||' '||model)) name, count(*)::bigint count, percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::bigint median_price, (array_agg(img ORDER BY plat_rank, price DESC NULLS LAST) FILTER (WHERE img IS NOT NULL AND img <> ''))[1] image_url FROM v WHERE make IS NOT NULL AND model IS NOT NULL GROUP BY (btrim(make||' '||model))
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
SELECT 'popularity'::text dim, (CASE WHEN watchers IS NULL THEN NULL WHEN watchers>=500 THEN '500+ watching' WHEN watchers>=200 THEN '200-499 watching' WHEN watchers>=100 THEN '100-199 watching' WHEN watchers>=50 THEN '50-99 watching' WHEN watchers>=10 THEN '10-49 watching' ELSE 'Under 10 watching' END) name, count(*)::bigint count, percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::bigint median_price, (array_agg(img ORDER BY plat_rank, price DESC NULLS LAST) FILTER (WHERE img IS NOT NULL AND img <> ''))[1] image_url FROM v WHERE watchers IS NOT NULL GROUP BY (CASE WHEN watchers IS NULL THEN NULL WHEN watchers>=500 THEN '500+ watching' WHEN watchers>=200 THEN '200-499 watching' WHEN watchers>=100 THEN '100-199 watching' WHEN watchers>=50 THEN '50-99 watching' WHEN watchers>=10 THEN '10-49 watching' ELSE 'Under 10 watching' END) ) s WHERE name IS NOT NULL AND name <> '';
CREATE UNIQUE INDEX mv_market_pulse_pk ON mv_market_pulse (dim, name);
CREATE OR REPLACE FUNCTION market_pulse(p_dimension text, p_limit int DEFAULT 60)
RETURNS TABLE(name text, count bigint, value bigint, median_price bigint, image_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT name, count, count AS value, median_price, image_url
  FROM mv_market_pulse WHERE dim = p_dimension ORDER BY count DESC LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION market_pulse(text, int) TO anon, authenticated;

SELECT cron.schedule('refresh-market-pulse', '*/30 * * * *',
                     'REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_market_pulse');
