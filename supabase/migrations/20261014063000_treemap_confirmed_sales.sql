-- The market map counts confirmed sales: area = public vehicle records with a confirmed sale and a recorded sold amount,
-- color = their median sold amount. Asks, bids and unknown outcomes are no longer counted as prices.
--
-- Measured 2026-10-14 (read-only, prod). The map (treemap_by_brand, treemap_models_by_brand, treemap_years) read the
-- mv_treemap_* views, which count every undeleted vehicle with coalesce(sale_price, sold_price) > 0 as "a recorded
-- price": 317 makes, 386,375 vehicles, $27.19B at the 05:04Z refresh; Chevrolet 67,276 at a median of $39,995. The
-- vehicles column comments say sale_price is a sale only when vehicle_sale_basis() is not null and sold_price is a
-- legacy copy. Over all 699,553 live rows, 275,759 have a sale basis. The views also counted private records, and
-- treemap_years took the median of per-source medians. treemap_models_batch (the browse page) reads the same views.
--
-- The measure, from the existing owners (docs/market/MARKET_MEASUREMENT_UI_CONTRACT.md, "Market shape and nested
-- vehicle maps"; AGENTS.md: incomplete price evidence supports a presentation count, never a confirmed sale):
--   population  public vehicle records: is_public, undeleted, not a non_vehicle_item lot, with a make label that
--               resolves to canonical_makes or passes the old text filter (which hid MG and AC: 2,254 sales)
--   sale        vehicle_sale_basis(...) is not null, evaluated per row (36.8 s over the whole table, measured)
--   amount      vehicle_price_facts' sold_amount: sale_price, else winning_bid, bat_sold_price, sold_price
--   no-sale     vehicle_price_facts' reserve_not_met outcome (not_sold/unsold/bid_to, reserve_not_met, no_sale)
-- Per cell: count = sales with an amount (area), median_price = their median when count >= 5 (color; null below,
-- the stacks' MIN_DISTRIBUTION), value/min/max over the same sales, sold_count = confirmed sales, auction_count =
-- known outcomes (sales + no-sales; sell-through = sold_count / auction_count), avg_bids/avg_watchers over the sales.
-- Makes with fewer than 5 sales are left off the top level. Amounts are nominal, all years; the rows carry no currency.
-- Expected at build (simulated 05:55Z): 427 makes, 241,919 sales; Chevrolet 27,878 at $36,000, Porsche 27,505 at $52,069.
--
-- New, beside the old views (which stay until the map is verified; a separate PR retires them):
--   mv_treemap_outcomes     one row per public record with a known outcome; years and the leaf read it directly
--   mv_treemap_sale_brands  per make, from the fold        mv_treemap_sale_models  per make and model, from the fold
--   treemap_sales(make, model, year)  the leaf: the cell's sales with their amount, live vehicle fields
--   treemap_populations()   the map's population receipt, written with each refresh to treemap_refreshes.populations
-- treemap_refresh_all refreshes the three new views after the ten old ones (each has a unique non-partial index, so
-- concurrently) and refreshes plainly a view that is not yet populated. Reader signatures and grants are unchanged.
-- Reversible: the readers' and treemap_refresh_all's previous bodies, read from prod today, are in
-- supabase/sql/helpers/treemap_map_live_20261014.sql; the old views are untouched.
BEGIN;
SET LOCAL statement_timeout = '120s'; -- the fold builds in 36.8 s warm (EXPLAIN ANALYZE, 2026-10-14); the repo cap is 120 s
SET LOCAL lock_timeout = '5s';

-- The sale rule this fold was measured against, and the reader bodies this replaces (SHA-256 of prosrc, read from prod
-- 2026-10-14). A different rule or a reader changed since needs its own review.
DO $guard$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.vehicle_sale_basis(text,text,text,text,text,numeric,text,jsonb,timestamptz)', '+q4wfzMqlwshjSDGpsEJsV1Dg9vnZiJ1JHXNuWC2HCs='),
    ('public.treemap_by_brand()', 'dS/5IHiRJYoJnNlrB77VrNEFmKU6Sp6SKZSknHHT+Zc='),
    ('public.treemap_models_by_brand(text)', 'SS8kHI9LDXauBSX/tCRufc/1wmpVJczqGDGXYZpHLZM='),
    ('public.treemap_models_batch(text[],integer)', 'og16mS3oBsVue/qhCcWi4c43WV/N4hyA95VL6S0ECv4='),
    ('public.treemap_years(text,text,text)', 'ZCtyv7wVsCMdLRzltGLg6D0BoJ9Pk34yzWx3e1Nn+Gc='),
    ('public.treemap_refresh_all()', 'Y+iYGLLQvdb3kmQ8hHs3WOEyMfiWZ768SNjw0KDI72I=')
  ) AS t(fn, sha) LOOP
    IF encode(sha256(convert_to((SELECT prosrc FROM pg_proc WHERE oid = r.fn::regprocedure), 'UTF8')), 'base64')
       IS DISTINCT FROM r.sha THEN
      RAISE EXCEPTION '% differs from the definition this migration was written against', r.fn;
    END IF;
  END LOOP;
END $guard$;

CREATE MATERIALIZED VIEW public.mv_treemap_outcomes AS
SELECT s.id,
       s.brand_name,
       s.model,
       s.year,
       CASE
         WHEN lower(s.auction_source) = ANY (ARRAY['bat', 'bringatrailer', 'bring a trailer']) THEN 'Bring a Trailer'
         WHEN lower(s.auction_source) = ANY (ARRAY['gooding', 'gooding & co']) THEN 'Gooding & Co'
         WHEN lower(s.auction_source) = ANY (ARRAY['rm sothebys', 'rm sotheby''s']) THEN 'RM Sotheby''s'
         WHEN lower(s.auction_source) = ANY (ARRAY['cars & bids', 'cars-and-bids']) THEN 'Cars & Bids'
         WHEN lower(s.auction_source) = 'mecum' THEN 'Mecum'
         WHEN lower(s.auction_source) = 'bonhams' THEN 'Bonhams'
         WHEN lower(s.auction_source) = 'broad arrow' THEN 'Broad Arrow'
         WHEN lower(s.auction_source) = ANY (ARRAY['collecting_cars', 'collecting cars']) THEN 'Collecting Cars'
         WHEN lower(s.auction_source) = 'sbx cars' THEN 'SBX Cars'
         WHEN lower(s.auction_source) = 'pcarmarket' THEN 'PCarMarket'
         WHEN lower(s.auction_source) = 'classic.com' THEN 'Classic.com'
       END AS source_name,
       CASE WHEN s.sale_basis IS NOT NULL THEN 'sold' ELSE 'not_sold' END AS outcome,
       s.sale_basis,
       CASE WHEN s.sale_basis IS NOT NULL
            THEN COALESCE(NULLIF(s.sale_price, 0)::numeric, NULLIF(s.winning_bid, 0)::numeric,
                          NULLIF(s.bat_sold_price, 0)::numeric, NULLIF(s.sold_price, 0)::numeric)
       END AS sold_amount,
       s.bat_bids,
       s.bat_watchers
FROM (
  SELECT v.id, COALESCE(cm.display_name, initcap(v.make)) AS brand_name, v.model, v.year, v.auction_source,
         v.sale_status, v.auction_outcome, v.reserve_status,
         v.sale_price, v.winning_bid, v.bat_sold_price, v.sold_price, v.bat_bids, v.bat_watchers,
         public.vehicle_sale_basis(v.sale_status, v.auction_outcome, v.canonical_platform, v.listing_url, v.discovery_url,
                                   v.sale_price::numeric, v.notes, v.import_metadata, v.created_at) AS sale_basis
  FROM public.vehicles v
  LEFT JOIN public.canonical_makes cm ON cm.id = v.canonical_make_id
  WHERE v.is_public IS TRUE
    AND v.deleted_at IS NULL
    AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    AND v.make IS NOT NULL
    AND (cm.id IS NOT NULL
         OR (length(v.make) > 2 AND v.make !~* '^[0-9]' AND v.make !~* 'mile|owner|reserve|unknown|other|n/a|none|tbd'))
  OFFSET 0 -- evaluate the sale basis once per row, not again for the select list
) s
WHERE s.sale_basis IS NOT NULL
   OR s.sale_status IN ('not_sold', 'unsold', 'bid_to')
   OR s.reserve_status = 'reserve_not_met'
   OR s.auction_outcome IN ('reserve_not_met', 'no_sale')
WITH DATA;

CREATE UNIQUE INDEX mv_treemap_outcomes_id ON public.mv_treemap_outcomes (id);
CREATE INDEX mv_treemap_outcomes_cell ON public.mv_treemap_outcomes (lower(brand_name), lower(model), year);

CREATE MATERIALIZED VIEW public.mv_treemap_sale_brands AS
SELECT o.brand_name AS name,
       count(*) FILTER (WHERE o.sold_amount > 0) AS count,
       (sum(o.sold_amount) FILTER (WHERE o.sold_amount > 0))::bigint AS value,
       CASE WHEN count(*) FILTER (WHERE o.sold_amount > 0) >= 5 THEN
         (percentile_cont(0.5) WITHIN GROUP (ORDER BY o.sold_amount::double precision) FILTER (WHERE o.sold_amount > 0))::bigint
       END AS median_price,
       (min(o.sold_amount) FILTER (WHERE o.sold_amount > 0))::bigint AS min_price,
       (max(o.sold_amount) FILTER (WHERE o.sold_amount > 0))::bigint AS max_price,
       count(*) FILTER (WHERE o.outcome = 'sold') AS sold_count,
       count(*) AS auction_count,
       round(avg(o.bat_bids) FILTER (WHERE o.sold_amount > 0 AND o.bat_bids > 0))::integer AS avg_bids,
       round(avg(o.bat_watchers) FILTER (WHERE o.sold_amount > 0 AND o.bat_watchers > 0))::integer AS avg_watchers
FROM public.mv_treemap_outcomes o
GROUP BY o.brand_name
HAVING count(*) FILTER (WHERE o.sold_amount > 0) >= 5
WITH DATA;

CREATE UNIQUE INDEX mv_treemap_sale_brands_name ON public.mv_treemap_sale_brands (name);

CREATE MATERIALIZED VIEW public.mv_treemap_sale_models AS
SELECT o.brand_name,
       o.model AS name,
       count(*) FILTER (WHERE o.sold_amount > 0) AS count,
       (sum(o.sold_amount) FILTER (WHERE o.sold_amount > 0))::bigint AS value,
       CASE WHEN count(*) FILTER (WHERE o.sold_amount > 0) >= 5 THEN
         (percentile_cont(0.5) WITHIN GROUP (ORDER BY o.sold_amount::double precision) FILTER (WHERE o.sold_amount > 0))::bigint
       END AS median_price,
       (min(o.sold_amount) FILTER (WHERE o.sold_amount > 0))::bigint AS min_price,
       (max(o.sold_amount) FILTER (WHERE o.sold_amount > 0))::bigint AS max_price,
       count(*) FILTER (WHERE o.outcome = 'sold') AS sold_count,
       count(*) AS auction_count,
       round(avg(o.bat_bids) FILTER (WHERE o.sold_amount > 0 AND o.bat_bids > 0))::integer AS avg_bids,
       round(avg(o.bat_watchers) FILTER (WHERE o.sold_amount > 0 AND o.bat_watchers > 0))::integer AS avg_watchers
FROM public.mv_treemap_outcomes o
WHERE o.model IS NOT NULL
GROUP BY o.brand_name, o.model
HAVING count(*) FILTER (WHERE o.sold_amount > 0) > 0
WITH DATA;

CREATE UNIQUE INDEX mv_treemap_sale_models_brand_name ON public.mv_treemap_sale_models (brand_name, name);

ANALYZE public.mv_treemap_outcomes;
ANALYZE public.mv_treemap_sale_brands;
ANALYZE public.mv_treemap_sale_models;

-- Public records only, read through the invoker readers below, as the old views were.
REVOKE ALL ON public.mv_treemap_outcomes, public.mv_treemap_sale_brands, public.mv_treemap_sale_models
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mv_treemap_outcomes, public.mv_treemap_sale_brands, public.mv_treemap_sale_models
  TO anon, authenticated, service_role;

COMMENT ON MATERIALIZED VIEW public.mv_treemap_outcomes IS
  'The market map''s fold: one row per public vehicle record (is_public, undeleted, not a non_vehicle_item lot, a make that resolves to canonical_makes or passes the text filter) with a known outcome. outcome = sold when vehicle_sale_basis() is not null (sale_basis says which basis), else not_sold for vehicle_price_facts'' no-sale states; unknown outcomes are not here. sold_amount is vehicle_price_facts'' sold_amount (nominal, no currency on the row). Refreshed by treemap_refresh_all (daily, job 175). 2026-10-14.';
COMMENT ON MATERIALIZED VIEW public.mv_treemap_sale_brands IS
  'The map''s makes, from mv_treemap_outcomes: count = confirmed sales with an amount (the area), median_price = their median, null under 5 sales (the color), value/min/max over the same sales, sold_count = confirmed sales, auction_count = known outcomes. Makes with fewer than 5 sales are left out. 2026-10-14.';
COMMENT ON MATERIALIZED VIEW public.mv_treemap_sale_models IS
  'The map''s models per make, from mv_treemap_outcomes, with the columns of mv_treemap_sale_brands; every model with at least one confirmed sale with an amount. 2026-10-14.';

CREATE OR REPLACE FUNCTION public.treemap_by_brand()
 RETURNS TABLE(name text, count bigint, value bigint, median_price bigint, min_price bigint, max_price bigint, sold_count bigint, auction_count bigint, avg_bids integer, avg_watchers integer)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT name, count, value, median_price, min_price, max_price, sold_count, auction_count, avg_bids, avg_watchers
  FROM public.mv_treemap_sale_brands ORDER BY value DESC, name;
$function$;

CREATE OR REPLACE FUNCTION public.treemap_models_by_brand(p_make text)
 RETURNS TABLE(name text, count bigint, value bigint, median_price bigint, min_price bigint, max_price bigint, sold_count bigint, auction_count bigint, avg_bids integer, avg_watchers integer)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT name, count, value, median_price, min_price, max_price, sold_count, auction_count, avg_bids, avg_watchers
  FROM public.mv_treemap_sale_models
  WHERE brand_name = p_make
  ORDER BY value DESC, name
  LIMIT 200;
$function$;

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
           ROW_NUMBER() OVER (PARTITION BY brand_name ORDER BY value DESC, name) AS rn
    FROM public.mv_treemap_sale_models
    WHERE brand_name = ANY(p_makes)
  ) ranked
  WHERE rn <= p_limit
  ORDER BY brand_name, value DESC, name;
$function$;

-- A model's years, read from the fold through its (make, model, year) index: the exact median over every source
-- (the old reader took the median of per-source medians), or over one source when p_source is given.
CREATE OR REPLACE FUNCTION public.treemap_years(p_source text, p_make text, p_model text)
 RETURNS TABLE(name text, count bigint, value bigint, median_price bigint, sold_count bigint, auction_count bigint, avg_bids integer, avg_watchers integer)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT o.year::text AS name,
         count(*) FILTER (WHERE o.sold_amount > 0) AS count,
         (sum(o.sold_amount) FILTER (WHERE o.sold_amount > 0))::bigint AS value,
         CASE WHEN count(*) FILTER (WHERE o.sold_amount > 0) >= 5 THEN
           (percentile_cont(0.5) WITHIN GROUP (ORDER BY o.sold_amount::double precision) FILTER (WHERE o.sold_amount > 0))::bigint
         END AS median_price,
         count(*) FILTER (WHERE o.outcome = 'sold') AS sold_count,
         count(*) AS auction_count,
         round(avg(o.bat_bids) FILTER (WHERE o.sold_amount > 0 AND o.bat_bids > 0))::integer AS avg_bids,
         round(avg(o.bat_watchers) FILTER (WHERE o.sold_amount > 0 AND o.bat_watchers > 0))::integer AS avg_watchers
  FROM public.mv_treemap_outcomes o
  WHERE lower(o.brand_name) = lower(p_make)
    AND lower(o.model) = lower(p_model)
    AND o.year IS NOT NULL
    AND (p_source IS NULL OR o.source_name = p_source)
  GROUP BY o.year
  HAVING count(*) FILTER (WHERE o.sold_amount > 0) > 0
  ORDER BY value DESC, o.year DESC;
$function$;

-- The leaf: the cell's confirmed sales with the amount the map counted, and the record's live title, image and
-- mileage. Invoker: vehicles' row security applies, so a record made private since the refresh is not returned.
CREATE OR REPLACE FUNCTION public.treemap_sales(p_make text, p_model text, p_year integer DEFAULT NULL)
 RETURNS TABLE(id uuid, year integer, make text, model text, listing_title text, sold_amount bigint, sale_basis text, primary_image_url text, mileage integer)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT v.id, v.year, v.make, v.model, COALESCE(v.listing_title, v.bat_listing_title) AS listing_title,
         o.sold_amount::bigint, o.sale_basis, v.primary_image_url, v.mileage
  FROM public.mv_treemap_outcomes o
  JOIN public.vehicles v ON v.id = o.id
  WHERE lower(o.brand_name) = lower(p_make)
    AND lower(o.model) = lower(p_model)
    AND (p_year IS NULL OR o.year = p_year)
    AND o.sold_amount > 0
    AND v.is_public IS TRUE AND v.deleted_at IS NULL
  ORDER BY o.sold_amount DESC, v.id
  LIMIT 200;
$function$;
REVOKE ALL ON FUNCTION public.treemap_sales(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_sales(text, text, integer) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.treemap_by_brand() IS
  'The market map''s makes (mv_treemap_sale_brands): count = public vehicle records with a confirmed sale and an amount, median_price = their median (null under 5), sold_count / auction_count = sell-through over known outcomes. 2026-10-14.';
COMMENT ON FUNCTION public.treemap_models_by_brand(text) IS
  'One make''s models on the market map (mv_treemap_sale_models), top 200 by the total of their confirmed sales. Columns as treemap_by_brand. 2026-10-14.';
COMMENT ON FUNCTION public.treemap_years(text, text, text) IS
  'One model''s years on the market map, read from mv_treemap_outcomes: confirmed sales with an amount per model year, over every source or one (p_source). Columns as treemap_by_brand. 2026-10-14.';
COMMENT ON FUNCTION public.treemap_sales(text, text, integer) IS
  'The market map''s leaf: up to 200 confirmed sales of one make, model and (optionally) year, largest first, with the amount the map counted (vehicle_price_facts'' sold_amount) and its sale_basis. 2026-10-14.';

-- The map's population receipt: what the area counts, out of what. Read by the legend from treemap_refreshes.
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
    'median_floor', 5);
$function$;
REVOKE ALL ON FUNCTION public.treemap_populations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.treemap_populations() TO service_role;

CREATE OR REPLACE FUNCTION public.treemap_refresh_all()
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
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
    'mv_treemap_models_by_source_make', 'mv_treemap_years', 'mv_treemap_nested_segment', 'mv_treemap_nested_brand',
    -- the confirmed-sale map (20261014063000): the fold before its two aggregates
    'mv_treemap_outcomes', 'mv_treemap_sale_brands', 'mv_treemap_sale_models'
  ] LOOP
    CONTINUE WHEN to_regclass(format('public.%I', v)) IS NULL;
    -- Concurrently needs a populated view and a valid unique index on plain columns covering every row.
    SELECT c.relispopulated AND EXISTS (
      SELECT 1 FROM pg_index i
       WHERE i.indrelid = c.oid AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indexprs IS NULL
    ) INTO concurrent
    FROM pg_class c WHERE c.oid = to_regclass(format('public.%I', v));
    IF concurrent THEN
      EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY public.%I', v);
      n_conc := n_conc + 1;
    ELSE
      EXECUTE format('REFRESH MATERIALIZED VIEW public.%I', v);
      n_plain := n_plain + 1;
    END IF;
  END LOOP;
  INSERT INTO public.treemap_refreshes (refreshed_at, seconds, note, populations)
  VALUES (now(), round(extract(epoch FROM (clock_timestamp() - t0))::numeric, 1),
          format('treemap_refresh_all: %s concurrently, %s plainly', n_conc, n_plain),
          CASE WHEN to_regclass('public.mv_treemap_sale_brands') IS NOT NULL THEN public.treemap_populations() END);
END $$;

-- Last, so the table's exclusive lock is held for milliseconds, not for the build above.
ALTER TABLE public.treemap_refreshes ADD COLUMN IF NOT EXISTS populations jsonb;
COMMENT ON COLUMN public.treemap_refreshes.populations IS
  'The map''s population receipt at this refresh (treemap_populations()): public_records, known_outcomes, confirmed_sales, confirmed_sales_with_amount, mapped_makes, mapped_sales, make_floor, median_floor. Null before 2026-10-14.';

-- The new views were populated now, by this migration: the map's clock and receipt start here.
INSERT INTO public.treemap_refreshes (refreshed_at, seconds, note, populations)
VALUES (now(), round(extract(epoch FROM (clock_timestamp() - now()))::numeric, 1),
        'mv_treemap_outcomes, mv_treemap_sale_brands, mv_treemap_sale_models populated by 20261014063000',
        public.treemap_populations());

DO $check$
DECLARE r record; n bigint;
BEGIN
  SELECT count(*) INTO n FROM pg_class c
   WHERE c.oid IN ('public.mv_treemap_outcomes'::regclass, 'public.mv_treemap_sale_brands'::regclass, 'public.mv_treemap_sale_models'::regclass)
     AND c.relispopulated
     AND EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indexprs IS NULL);
  IF n <> 3 THEN RAISE EXCEPTION 'the three map views are not all populated with a unique index (%)', n; END IF;
  SELECT count(*) AS makes, min(count) AS fewest, count(*) FILTER (WHERE median_price IS NULL) AS no_median INTO r FROM public.treemap_by_brand();
  IF r.makes = 0 OR r.fewest < 5 OR r.no_median > 0 THEN RAISE EXCEPTION 'treemap_by_brand: %', r; END IF;
  SELECT count(*) INTO n FROM public.treemap_by_brand() WHERE name IN ('Chevrolet', 'Porsche') AND median_price > 0;
  IF n <> 2 THEN RAISE EXCEPTION 'Chevrolet and Porsche are not both on the map'; END IF;
  SELECT count(*) INTO n FROM public.treemap_years(NULL, 'Porsche', '911');
  IF n = 0 THEN RAISE EXCEPTION 'treemap_years found no Porsche 911 years'; END IF;
  SELECT count(*) INTO n FROM public.treemap_sales('Porsche', '911', NULL);
  IF n = 0 THEN RAISE EXCEPTION 'treemap_sales found no Porsche 911 sales'; END IF;
  IF pg_get_functiondef('public.treemap_refresh_all()'::regprocedure) NOT LIKE '%mv_treemap_sale_models%' THEN
    RAISE EXCEPTION 'treemap_refresh_all does not refresh the new views';
  END IF;
  SELECT populations INTO r FROM public.treemap_refreshes ORDER BY refreshed_at DESC LIMIT 1;
  IF r.populations->>'measure' IS DISTINCT FROM 'confirmed_sale_v1' THEN RAISE EXCEPTION 'no population receipt'; END IF;
END $check$;

COMMIT;
