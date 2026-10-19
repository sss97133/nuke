-- The market map as production had it on 2026-10-14 before 20261014063000 (pg_get_viewdef / pg_get_functiondef):
-- three of its ten views, their unique indexes, its four readers and treemap_refresh_all. Loaded by
-- supabase/sql/test_treemap_confirmed_sales.sql as the before state; it is also the rollback text for the readers.

CREATE MATERIALIZED VIEW public.mv_treemap_by_brand AS
 SELECT COALESCE(cm.display_name, initcap(v.make)) AS name,
    count(*) AS count,
    sum(COALESCE(v.sale_price, v.sold_price)) AS value,
    percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (COALESCE(v.sale_price, v.sold_price)::double precision))::bigint AS median_price,
    min(COALESCE(v.sale_price, v.sold_price))::bigint AS min_price,
    max(COALESCE(v.sale_price, v.sold_price))::bigint AS max_price,
    count(*) FILTER (WHERE v.auction_outcome = 'sold'::text) AS sold_count,
    count(*) FILTER (WHERE v.auction_outcome IS NOT NULL) AS auction_count,
    round(avg(v.bat_bids) FILTER (WHERE v.bat_bids > 0))::integer AS avg_bids,
    round(avg(v.bat_watchers) FILTER (WHERE v.bat_watchers > 0))::integer AS avg_watchers
   FROM vehicles v
     LEFT JOIN canonical_makes cm ON v.canonical_make_id = cm.id
  WHERE v.deleted_at IS NULL AND (v.sale_price > 0 OR v.sold_price > 0) AND COALESCE(v.sale_price, v.sold_price) < 100000000 AND v.make IS NOT NULL AND length(v.make) > 2 AND v.make !~* '^[0-9]'::text AND v.make !~* 'mile|owner|reserve|unknown|other|n/a|none|tbd'::text
  GROUP BY (COALESCE(cm.display_name, initcap(v.make)))
 HAVING sum(COALESCE(v.sale_price, v.sold_price)) >= 1000000
  ORDER BY (sum(COALESCE(v.sale_price, v.sold_price))) DESC;

CREATE MATERIALIZED VIEW public.mv_treemap_models_by_brand AS
 SELECT COALESCE(cm.display_name, initcap(v.make)) AS brand_name,
    v.model AS name,
    count(*) AS count,
    sum(COALESCE(v.sale_price, v.sold_price)) AS value,
    percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (COALESCE(v.sale_price, v.sold_price)::double precision))::bigint AS median_price,
    min(COALESCE(v.sale_price, v.sold_price))::bigint AS min_price,
    max(COALESCE(v.sale_price, v.sold_price))::bigint AS max_price,
    count(*) FILTER (WHERE v.auction_outcome = 'sold'::text) AS sold_count,
    count(*) FILTER (WHERE v.auction_outcome IS NOT NULL) AS auction_count,
    round(avg(v.bat_bids) FILTER (WHERE v.bat_bids > 0))::integer AS avg_bids,
    round(avg(v.bat_watchers) FILTER (WHERE v.bat_watchers > 0))::integer AS avg_watchers
   FROM vehicles v
     LEFT JOIN canonical_makes cm ON v.canonical_make_id = cm.id
  WHERE v.deleted_at IS NULL AND (v.sale_price > 0 OR v.sold_price > 0) AND COALESCE(v.sale_price, v.sold_price) < 100000000 AND v.model IS NOT NULL AND v.make IS NOT NULL AND length(v.make) > 2
  GROUP BY (COALESCE(cm.display_name, initcap(v.make))), v.model
  ORDER BY (COALESCE(cm.display_name, initcap(v.make))), (sum(COALESCE(v.sale_price, v.sold_price))) DESC;

CREATE MATERIALIZED VIEW public.mv_treemap_years AS
 SELECT
        CASE
            WHEN lower(auction_source) = ANY (ARRAY['bat'::text, 'bringatrailer'::text, 'bring a trailer'::text]) THEN 'Bring a Trailer'::text
            WHEN lower(auction_source) = ANY (ARRAY['gooding'::text, 'gooding & co'::text]) THEN 'Gooding & Co'::text
            WHEN lower(auction_source) = ANY (ARRAY['rm sothebys'::text, 'rm sotheby''s'::text]) THEN 'RM Sotheby''s'::text
            WHEN lower(auction_source) = ANY (ARRAY['cars & bids'::text, 'cars-and-bids'::text]) THEN 'Cars & Bids'::text
            WHEN lower(auction_source) = 'mecum'::text THEN 'Mecum'::text
            WHEN lower(auction_source) = 'bonhams'::text THEN 'Bonhams'::text
            WHEN lower(auction_source) = 'broad arrow'::text THEN 'Broad Arrow'::text
            WHEN lower(auction_source) = ANY (ARRAY['collecting_cars'::text, 'collecting cars'::text]) THEN 'Collecting Cars'::text
            WHEN lower(auction_source) = 'sbx cars'::text THEN 'SBX Cars'::text
            WHEN lower(auction_source) = 'pcarmarket'::text THEN 'PCarMarket'::text
            WHEN lower(auction_source) = 'classic.com'::text THEN 'Classic.com'::text
            ELSE NULL::text
        END AS source_name,
    lower(make) AS make_lower,
    lower(model) AS model_lower,
    year::text AS name,
    count(*) AS count,
    sum(COALESCE(sale_price, sold_price)) AS value,
    percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (COALESCE(sale_price, sold_price)::double precision))::bigint AS median_price,
    count(*) FILTER (WHERE auction_outcome = 'sold'::text) AS sold_count,
    count(*) FILTER (WHERE auction_outcome IS NOT NULL) AS auction_count,
    round(avg(bat_bids) FILTER (WHERE bat_bids > 0))::integer AS avg_bids,
    round(avg(bat_watchers) FILTER (WHERE bat_watchers > 0))::integer AS avg_watchers
   FROM vehicles v
  WHERE deleted_at IS NULL AND (sale_price > 0 OR sold_price > 0) AND COALESCE(sale_price, sold_price) < 100000000 AND year IS NOT NULL AND make IS NOT NULL AND model IS NOT NULL
  GROUP BY (
        CASE
            WHEN lower(auction_source) = ANY (ARRAY['bat'::text, 'bringatrailer'::text, 'bring a trailer'::text]) THEN 'Bring a Trailer'::text
            WHEN lower(auction_source) = ANY (ARRAY['gooding'::text, 'gooding & co'::text]) THEN 'Gooding & Co'::text
            WHEN lower(auction_source) = ANY (ARRAY['rm sothebys'::text, 'rm sotheby''s'::text]) THEN 'RM Sotheby''s'::text
            WHEN lower(auction_source) = ANY (ARRAY['cars & bids'::text, 'cars-and-bids'::text]) THEN 'Cars & Bids'::text
            WHEN lower(auction_source) = 'mecum'::text THEN 'Mecum'::text
            WHEN lower(auction_source) = 'bonhams'::text THEN 'Bonhams'::text
            WHEN lower(auction_source) = 'broad arrow'::text THEN 'Broad Arrow'::text
            WHEN lower(auction_source) = ANY (ARRAY['collecting_cars'::text, 'collecting cars'::text]) THEN 'Collecting Cars'::text
            WHEN lower(auction_source) = 'sbx cars'::text THEN 'SBX Cars'::text
            WHEN lower(auction_source) = 'pcarmarket'::text THEN 'PCarMarket'::text
            WHEN lower(auction_source) = 'classic.com'::text THEN 'Classic.com'::text
            ELSE NULL::text
        END), (lower(make)), (lower(model)), year;

CREATE UNIQUE INDEX idx_mv_treemap_brand_name ON public.mv_treemap_by_brand USING btree (name);

CREATE OR REPLACE FUNCTION public.treemap_by_brand()
 RETURNS TABLE(name text, count bigint, value bigint, median_price bigint, min_price bigint, max_price bigint, sold_count bigint, auction_count bigint, avg_bids integer, avg_watchers integer)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT name, count, value, median_price, min_price, max_price, sold_count, auction_count, avg_bids, avg_watchers
  FROM mv_treemap_by_brand ORDER BY value DESC;
$function$

;

CREATE OR REPLACE FUNCTION public.treemap_models_by_brand(p_make text)
 RETURNS TABLE(name text, count bigint, value bigint, median_price bigint, min_price bigint, max_price bigint, sold_count bigint, auction_count bigint, avg_bids integer, avg_watchers integer)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT name, count, value, median_price, min_price, max_price, sold_count, auction_count, avg_bids, avg_watchers
  FROM mv_treemap_models_by_brand
  WHERE brand_name = p_make
  ORDER BY value DESC
  LIMIT 200;
$function$

;

CREATE OR REPLACE FUNCTION public.treemap_models_batch(p_makes text[], p_limit integer DEFAULT 3)
 RETURNS TABLE(brand_name text, name text, count bigint, value bigint, median_price bigint, min_price bigint, max_price bigint, sold_count bigint, auction_count bigint, avg_bids integer, avg_watchers integer)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT brand_name, name, count, value, median_price, min_price, max_price,
         sold_count, auction_count, avg_bids, avg_watchers
  FROM (
    SELECT brand_name, name, count, value, median_price, min_price, max_price,
           sold_count, auction_count, avg_bids, avg_watchers,
           ROW_NUMBER() OVER (PARTITION BY brand_name ORDER BY value DESC) AS rn
    FROM mv_treemap_models_by_brand
    WHERE brand_name = ANY(p_makes)
  ) ranked
  WHERE rn <= p_limit
  ORDER BY brand_name, value DESC;
$function$

;

CREATE OR REPLACE FUNCTION public.treemap_years(p_source text, p_make text, p_model text)
 RETURNS TABLE(name text, count bigint, value bigint, median_price bigint, sold_count bigint, auction_count bigint, avg_bids integer, avg_watchers integer)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT name, SUM(count)::bigint as count, SUM(value)::bigint as value,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY median_price)::bigint as median_price,
    SUM(sold_count)::bigint as sold_count,
    SUM(auction_count)::bigint as auction_count,
    ROUND(AVG(avg_bids))::int as avg_bids,
    ROUND(AVG(avg_watchers))::int as avg_watchers
  FROM mv_treemap_years
  WHERE make_lower = LOWER(p_make)
    AND model_lower = LOWER(p_model)
    AND (p_source IS NULL OR source_name = p_source)
  GROUP BY name
  ORDER BY value DESC;
$function$

;

CREATE OR REPLACE FUNCTION public.treemap_refresh_all()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  t0 timestamptz := clock_timestamp();
  v text;
  concurrent boolean;
  n_conc int := 0;
  n_plain int := 0;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'mv_treemap_by_source', 'mv_treemap_by_brand', 'mv_treemap_by_segment',
    'mv_treemap_makes_by_source', 'mv_treemap_makes_by_segment', 'mv_treemap_models_by_brand',
    'mv_treemap_models_by_source_make', 'mv_treemap_years', 'mv_treemap_nested_segment', 'mv_treemap_nested_brand'
  ] LOOP
    CONTINUE WHEN to_regclass(format('public.%I', v)) IS NULL;
    SELECT EXISTS (
      SELECT 1 FROM pg_index i
       WHERE i.indrelid = to_regclass(format('public.%I', v))
         AND i.indisunique AND i.indisvalid AND i.indpred IS NULL
    ) INTO concurrent;
    IF concurrent THEN
      EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY public.%I', v);
      n_conc := n_conc + 1;
    ELSE
      EXECUTE format('REFRESH MATERIALIZED VIEW public.%I', v);
      n_plain := n_plain + 1;
    END IF;
  END LOOP;
  INSERT INTO public.treemap_refreshes (refreshed_at, seconds, note)
  VALUES (now(), round(extract(epoch FROM (clock_timestamp() - t0))::numeric, 1),
          format('treemap_refresh_all: %s concurrently, %s plainly', n_conc, n_plain));
END $function$

;
