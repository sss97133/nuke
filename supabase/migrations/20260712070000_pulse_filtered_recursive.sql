-- Recursive pulse — filter-aware group-by for all 9 dimensions (iOS Pulse drill +
-- the composable-pulse engine). A band filter (price/mileage/popularity) re-derives
-- its band and matches; representative images and leaf cars rank pro sources first.
-- Applied to prod 2026-07-12.

CREATE OR REPLACE FUNCTION market_pulse_filtered(p_group_by text, p_filters jsonb DEFAULT '{}'::jsonb, p_limit int DEFAULT 40)
RETURNS TABLE(name text, count bigint, value bigint, median_price bigint, avg_year int, image_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH v AS (SELECT make, model, year, city, state, sale_date, color_family, mileage,
           bat_watchers AS watchers,
           COALESCE(sale_price, sold_price, canonical_sold_price) AS price,
           primary_image_url AS img,
           CASE WHEN canonical_platform IN ('bat','cars-and-bids','barrett-jackson','mecum','bonhams','classiccars-com','gooding','rm-sothebys','broad-arrow') THEN 0 ELSE 1 END AS plat_rank FROM vehicles WHERE is_public)
  SELECT (CASE p_group_by WHEN 'make' THEN (make) WHEN 'model' THEN (model) WHEN 'year' THEN (year::text) WHEN 'metro' THEN (city||', '||state) WHEN 'dow' THEN (to_char(sale_date,'Dy')) WHEN 'color' THEN (color_family) WHEN 'price' THEN (CASE WHEN price IS NULL THEN NULL WHEN price<10000 THEN '<$10k' WHEN price<25000 THEN '$10-25k' WHEN price<50000 THEN '$25-50k' WHEN price<100000 THEN '$50-100k' WHEN price<250000 THEN '$100-250k' WHEN price<1000000 THEN '$250k-1M' ELSE '$1M+' END) WHEN 'mileage' THEN (CASE WHEN mileage IS NULL THEN NULL WHEN mileage<1000 THEN 'Under 1k mi' WHEN mileage<10000 THEN '1-10k mi' WHEN mileage<50000 THEN '10-50k mi' WHEN mileage<100000 THEN '50-100k mi' WHEN mileage<150000 THEN '100-150k mi' ELSE '150k+ mi' END) WHEN 'popularity' THEN (CASE WHEN watchers IS NULL THEN NULL WHEN watchers>=500 THEN '500+ watching' WHEN watchers>=200 THEN '200-499 watching' WHEN watchers>=100 THEN '100-199 watching' WHEN watchers>=50 THEN '50-99 watching' WHEN watchers>=10 THEN '10-49 watching' ELSE 'Under 10 watching' END) END) AS name, count(*)::bigint, count(*)::bigint,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::bigint, round(avg(year))::int, (array_agg(img ORDER BY plat_rank, price DESC NULLS LAST) FILTER (WHERE img IS NOT NULL AND img <> ''))[1]
  FROM v
  WHERE (CASE p_group_by WHEN 'make' THEN (make) WHEN 'model' THEN (model) WHEN 'year' THEN (year::text) WHEN 'metro' THEN (city||', '||state) WHEN 'dow' THEN (to_char(sale_date,'Dy')) WHEN 'color' THEN (color_family) WHEN 'price' THEN (CASE WHEN price IS NULL THEN NULL WHEN price<10000 THEN '<$10k' WHEN price<25000 THEN '$10-25k' WHEN price<50000 THEN '$25-50k' WHEN price<100000 THEN '$50-100k' WHEN price<250000 THEN '$100-250k' WHEN price<1000000 THEN '$250k-1M' ELSE '$1M+' END) WHEN 'mileage' THEN (CASE WHEN mileage IS NULL THEN NULL WHEN mileage<1000 THEN 'Under 1k mi' WHEN mileage<10000 THEN '1-10k mi' WHEN mileage<50000 THEN '10-50k mi' WHEN mileage<100000 THEN '50-100k mi' WHEN mileage<150000 THEN '100-150k mi' ELSE '150k+ mi' END) WHEN 'popularity' THEN (CASE WHEN watchers IS NULL THEN NULL WHEN watchers>=500 THEN '500+ watching' WHEN watchers>=200 THEN '200-499 watching' WHEN watchers>=100 THEN '100-199 watching' WHEN watchers>=50 THEN '50-99 watching' WHEN watchers>=10 THEN '10-49 watching' ELSE 'Under 10 watching' END) END) IS NOT NULL AND (CASE p_group_by WHEN 'make' THEN (make) WHEN 'model' THEN (model) WHEN 'year' THEN (year::text) WHEN 'metro' THEN (city||', '||state) WHEN 'dow' THEN (to_char(sale_date,'Dy')) WHEN 'color' THEN (color_family) WHEN 'price' THEN (CASE WHEN price IS NULL THEN NULL WHEN price<10000 THEN '<$10k' WHEN price<25000 THEN '$10-25k' WHEN price<50000 THEN '$25-50k' WHEN price<100000 THEN '$50-100k' WHEN price<250000 THEN '$100-250k' WHEN price<1000000 THEN '$250k-1M' ELSE '$1M+' END) WHEN 'mileage' THEN (CASE WHEN mileage IS NULL THEN NULL WHEN mileage<1000 THEN 'Under 1k mi' WHEN mileage<10000 THEN '1-10k mi' WHEN mileage<50000 THEN '10-50k mi' WHEN mileage<100000 THEN '50-100k mi' WHEN mileage<150000 THEN '100-150k mi' ELSE '150k+ mi' END) WHEN 'popularity' THEN (CASE WHEN watchers IS NULL THEN NULL WHEN watchers>=500 THEN '500+ watching' WHEN watchers>=200 THEN '200-499 watching' WHEN watchers>=100 THEN '100-199 watching' WHEN watchers>=50 THEN '50-99 watching' WHEN watchers>=10 THEN '10-49 watching' ELSE 'Under 10 watching' END) END) <> ''
    AND (NOT (p_filters ? 'make') OR (make) = p_filters->>'make')
    AND (NOT (p_filters ? 'model') OR (model) = p_filters->>'model')
    AND (NOT (p_filters ? 'year') OR (year::text) = p_filters->>'year')
    AND (NOT (p_filters ? 'metro') OR (city||', '||state) = p_filters->>'metro')
    AND (NOT (p_filters ? 'dow') OR (to_char(sale_date,'Dy')) = p_filters->>'dow')
    AND (NOT (p_filters ? 'color') OR (color_family) = p_filters->>'color')
    AND (NOT (p_filters ? 'price') OR (CASE WHEN price IS NULL THEN NULL WHEN price<10000 THEN '<$10k' WHEN price<25000 THEN '$10-25k' WHEN price<50000 THEN '$25-50k' WHEN price<100000 THEN '$50-100k' WHEN price<250000 THEN '$100-250k' WHEN price<1000000 THEN '$250k-1M' ELSE '$1M+' END) = p_filters->>'price')
    AND (NOT (p_filters ? 'mileage') OR (CASE WHEN mileage IS NULL THEN NULL WHEN mileage<1000 THEN 'Under 1k mi' WHEN mileage<10000 THEN '1-10k mi' WHEN mileage<50000 THEN '10-50k mi' WHEN mileage<100000 THEN '50-100k mi' WHEN mileage<150000 THEN '100-150k mi' ELSE '150k+ mi' END) = p_filters->>'mileage')
    AND (NOT (p_filters ? 'popularity') OR (CASE WHEN watchers IS NULL THEN NULL WHEN watchers>=500 THEN '500+ watching' WHEN watchers>=200 THEN '200-499 watching' WHEN watchers>=100 THEN '100-199 watching' WHEN watchers>=50 THEN '50-99 watching' WHEN watchers>=10 THEN '10-49 watching' ELSE 'Under 10 watching' END) = p_filters->>'popularity')
  GROUP BY (CASE p_group_by WHEN 'make' THEN (make) WHEN 'model' THEN (model) WHEN 'year' THEN (year::text) WHEN 'metro' THEN (city||', '||state) WHEN 'dow' THEN (to_char(sale_date,'Dy')) WHEN 'color' THEN (color_family) WHEN 'price' THEN (CASE WHEN price IS NULL THEN NULL WHEN price<10000 THEN '<$10k' WHEN price<25000 THEN '$10-25k' WHEN price<50000 THEN '$25-50k' WHEN price<100000 THEN '$50-100k' WHEN price<250000 THEN '$100-250k' WHEN price<1000000 THEN '$250k-1M' ELSE '$1M+' END) WHEN 'mileage' THEN (CASE WHEN mileage IS NULL THEN NULL WHEN mileage<1000 THEN 'Under 1k mi' WHEN mileage<10000 THEN '1-10k mi' WHEN mileage<50000 THEN '10-50k mi' WHEN mileage<100000 THEN '50-100k mi' WHEN mileage<150000 THEN '100-150k mi' ELSE '150k+ mi' END) WHEN 'popularity' THEN (CASE WHEN watchers IS NULL THEN NULL WHEN watchers>=500 THEN '500+ watching' WHEN watchers>=200 THEN '200-499 watching' WHEN watchers>=100 THEN '100-199 watching' WHEN watchers>=50 THEN '50-99 watching' WHEN watchers>=10 THEN '10-49 watching' ELSE 'Under 10 watching' END) END) ORDER BY count(*) DESC LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION market_pulse_filtered(text, jsonb, int) TO anon, authenticated;
CREATE OR REPLACE FUNCTION vehicles_by_filters(p_filters jsonb DEFAULT '{}'::jsonb, p_limit int DEFAULT 60)
RETURNS TABLE(id uuid, year int, make text, model text, "trim" text, primary_image_url text, city text, state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH v AS (SELECT id, trim AS trm, make, model, year, city, state, sale_date, color_family, mileage,
           bat_watchers AS watchers,
           COALESCE(sale_price, sold_price, canonical_sold_price) AS price,
           primary_image_url AS img,
           CASE WHEN canonical_platform IN ('bat','cars-and-bids','barrett-jackson','mecum','bonhams','classiccars-com','gooding','rm-sothebys','broad-arrow') THEN 0 ELSE 1 END AS plat_rank FROM vehicles WHERE is_public AND primary_image_url IS NOT NULL AND primary_image_url <> '')
  SELECT id, year, make, model, trm, img, city, state
  FROM v
  WHERE TRUE
    AND (NOT (p_filters ? 'make') OR (make) = p_filters->>'make')
    AND (NOT (p_filters ? 'model') OR (model) = p_filters->>'model')
    AND (NOT (p_filters ? 'year') OR (year::text) = p_filters->>'year')
    AND (NOT (p_filters ? 'metro') OR (city||', '||state) = p_filters->>'metro')
    AND (NOT (p_filters ? 'dow') OR (to_char(sale_date,'Dy')) = p_filters->>'dow')
    AND (NOT (p_filters ? 'color') OR (color_family) = p_filters->>'color')
    AND (NOT (p_filters ? 'price') OR (CASE WHEN price IS NULL THEN NULL WHEN price<10000 THEN '<$10k' WHEN price<25000 THEN '$10-25k' WHEN price<50000 THEN '$25-50k' WHEN price<100000 THEN '$50-100k' WHEN price<250000 THEN '$100-250k' WHEN price<1000000 THEN '$250k-1M' ELSE '$1M+' END) = p_filters->>'price')
    AND (NOT (p_filters ? 'mileage') OR (CASE WHEN mileage IS NULL THEN NULL WHEN mileage<1000 THEN 'Under 1k mi' WHEN mileage<10000 THEN '1-10k mi' WHEN mileage<50000 THEN '10-50k mi' WHEN mileage<100000 THEN '50-100k mi' WHEN mileage<150000 THEN '100-150k mi' ELSE '150k+ mi' END) = p_filters->>'mileage')
    AND (NOT (p_filters ? 'popularity') OR (CASE WHEN watchers IS NULL THEN NULL WHEN watchers>=500 THEN '500+ watching' WHEN watchers>=200 THEN '200-499 watching' WHEN watchers>=100 THEN '100-199 watching' WHEN watchers>=50 THEN '50-99 watching' WHEN watchers>=10 THEN '10-49 watching' ELSE 'Under 10 watching' END) = p_filters->>'popularity')
  ORDER BY plat_rank, (price IS NULL), price DESC NULLS LAST LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION vehicles_by_filters(jsonb, int) TO anon, authenticated;