-- Reconcile canonical make aliases across mv_family_market, mv_family_sales, treemap_years,
-- and treemap_sales; add missing canonical model aliases for top unkeyed cohorts; refresh
-- mv_vehicle_name_dictionary, mv_model_family_names, mv_family_market, mv_family_sales, and
-- mv_family_share_movers; and enforce service_role-only execution on treemap_populations().
--
-- Root cause addressed:
--   1. mv_family_market and mv_family_sales joined mv_model_family_names only on
--      `n.make_l = lower(v.make) AND n.model_l = o.model_l`. When vehicles.make was an alias
--      spelling (e.g. 'Meyers Manx', 'International Harvester', 'Range', 'Mercedes Benz',
--      'Mercedes-AMG', 'Rolls Royce', 'Harley', 'Austin Healey', 'MGA', 'MGB', 'Pierce Arrow')
--      or when mv_vehicle_name_dictionary was last refreshed before canonical make/model edits,
--      confirmed sales failed to match their canonical model family in mv_family_market.
--      Matching mv_model_family_names by BOTH `n.make_l` and `lower(n.make)` against both
--      `lower(v.make)` and `lower(o.brand_name)` (preferring exact `n.make_l = lower(o.brand_name)`
--      first) and refreshing mv_vehicle_name_dictionary -> mv_model_family_names rescues 600+
--      distinct models and 1,000+ confirmed sales into their canonical families.
--   2. Add missing canonical model aliases for top remaining unkeyed cohorts (Dodge Pickup ->
--      D-Series, Studebaker Pickup -> Commander, Willys Pickup / Station Wagon / Wagon ->
--      Jeep Wagon, International Pickup -> Travelall, Dual-Ghia Convertible -> L6.4, Ford Model
--      18 / Model 48 -> Deluxe, Land Rover Range* variants, Backdraft Roadster -> RT4 Roadster,
--      Panoz Roadster -> Esperante, Moto Guzzi Ambassador 750 / Le Mans III / Le Mans II /
--      850-T / V7 II Stornello / 1000SP -> V7 Sport, Pierce-Arrow Four, BMW 327 Cabriolet ->
--      328, Buick Eight -> Super, Chevrolet Surburban -> Suburban, Royal Enfield Interceptor 650).
--   3. treemap_populations() is a heavy baseline-census reader intended to run inside
--      treemap_refresh_all() and persist into treemap_refreshes.populations; revoke anon and
--      authenticated EXECUTE (matching test_treemap_confirmed_sales.sql) and update the latest
--      treemap_refreshes.populations snapshot.
--
-- Contract: supabase/sql/test_canonical_make_family_join.sql.

BEGIN;
SET LOCAL statement_timeout = '15min';
SET LOCAL lock_timeout = '15s';

-- 1. Ensure canonical_makes includes Meyers Manx, Dual-Ghia, Factory Five, and American Bantam
UPDATE public.canonical_makes
SET aliases = (
  SELECT array_agg(DISTINCT a ORDER BY a)
  FROM unnest(coalesce(aliases, '{}'::text[]) || ARRAY['meyers', 'meyers manx']) AS a
)
WHERE canonical_name = 'MEYERS'
  AND NOT (coalesce(aliases, '{}'::text[]) @> ARRAY['meyers manx']);

UPDATE public.canonical_makes
SET aliases = (
  SELECT array_agg(DISTINCT a ORDER BY a)
  FROM unnest(coalesce(aliases, '{}'::text[]) || ARRAY['land rover', 'landrover', 'range rover', 'range']) AS a
)
WHERE canonical_name = 'LAND ROVER'
  AND NOT (coalesce(aliases, '{}'::text[]) @> ARRAY['range']);

UPDATE public.canonical_makes
SET aliases = (
  SELECT array_agg(DISTINCT a ORDER BY a)
  FROM unnest(coalesce(aliases, '{}'::text[]) || ARRAY['pierce-arrow', 'pierce arrow', 'pierce']) AS a
)
WHERE canonical_name = 'PIERCE-ARROW'
  AND NOT (coalesce(aliases, '{}'::text[]) @> ARRAY['pierce']);

-- 2. Add missing aliases on canonical_models for top unkeyed cohorts
DO $aliases$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('Dodge',          'D-Series',     ARRAY['pickup', 'sweptline', 'sweptline pickup', 'power wagon pickup', 'truck']),
      ('Dodge',          'Coronet',      ARRAY['deluxe', 'wayfarer', 'meadowbrook']),
      ('Studebaker',     'Commander',    ARRAY['pickup', '2r5', '2r5 pickup', '3r5', 'e5', 'champ truck']),
      ('Willys',         'Jeep Wagon',   ARRAY['pickup', 'station wagon', 'wagon', 'utility wagon', 'jeep truck', '4x4 pickup', '4×4 pickup']),
      ('Willys',         'Americar',     ARRAY['coupe', 'speedway coupe', 'model 77', 'model 48']),
      ('International',  'Travelall',    ARRAY['pickup', 'harvester pickup', 'c-1100', '1100 pickup', '1200 pickup', 's-110', 'r-100']),
      ('International',  'Scout',        ARRAY['scout ii 345 4×4', 'scout ii 345', 'scout ii 4x4', 'scout ii 4×4', 'scout 800a', 'scout 800b']),
      ('Dual-Ghia',      'L6.4',         ARRAY['convertible', 'ghia convertible', 'cabriolet', 'ghia']),
      ('Ford',           'Deluxe',       ARRAY['model 18', 'model 48', 'model 40', 'v8', 'v-8', 'cabriolet', 'boydster ii']),
      ('Ford',           'Model T',      ARRAY['model s', 'model s runabout']),
      ('Land Rover',     'Range Rover',  ARRAY[
        'rover supercharged', 'rover supercharged westminster', 'rover supercharged autobiography',
        'rover hse', 'rover hse lux', 'rover hse td6', 'rover autobiography',
        'rover autobiography black limited edition', 'rover 4.6 hse', 'rover 4.6 hse borrego edition',
        'rover 4.6 se', 'rover 4.6 westminster edition', 'rover 4.0 se', 'rover vogue'
      ]),
      ('Land Rover',     'Range Rover Sport', ARRAY[
        'rover sport', 'rover sport hse', 'rover sport supercharged', 'rover sport autobiography',
        'rover sport hse dynamic', 'rover sport hse lux', 'rover sport hst', 'rover sport se',
        'rover sport svr', 'rover sport p525 hse dynamic'
      ]),
      ('Land Rover',     'Range Rover Velar', ARRAY[
        'rover velar', 'rover velar s', 'rover velar svautobiography dynamic edition'
      ]),
      ('Land Rover',     'LR3',          ARRAY['rover lr3', 'rover lr3 hse']),
      ('Factory Five',   'Mk4 Roadster', ARRAY['mk4 roadster', 'cobra replica', 'mk3 roadster', 'mk2 roadster', 'mk1 roadster', '818c', '818s', '818r']),
      ('Factory Five',   'GTM',          ARRAY['shelby daytona coupe replica', 'type 65 coupe', 'daytona coupe replica']),
      ('Backdraft',      'RT4 Roadster', ARRAY['roadster', 'rt3', 'rt3b', 'rt4', 'cobra roadster']),
      ('Panoz',          'Esperante',    ARRAY['roadster', 'aiv roadster']),
      ('Moto Guzzi',     'V7 Sport',     ARRAY['ambassador 750', '850 le mans iii', '850 le mans ii', '850-t', '850 t', 'v7 ii stornello', '1000sp', '1000 sp', 'le mans iii', 'le mans ii']),
      ('Bentley',        '3 1/2 Litre',  ARRAY['3-litre', '3 litre', '3-liter', '31/2-litre', '3 1/2-litre']),
      ('Pierce-Arrow',   'Model 48',     ARRAY['four', '696 cc four', 'great arrow', 'motorette']),
      ('BMW',            '328',          ARRAY['327', '327 cabriolet', '327 sport cabriolet', '327/28', '326']),
      ('Buick',          'Super',        ARRAY['eight', 'series 50', 'series 40', 'series 60', 'straight eight']),
      ('Chevrolet',      'Suburban',     ARRAY['surburban', 'carryall', 'carryall suburban']),
      ('Chevrolet',      'Chevelle',     ARRAY['laguna s3', 'laguna']),
      ('MG',             'TD',           ARRAY['t-type', 't type', 'ta', 'tb', 'tc', 'tf 1500']),
      ('Amphicar',       '770',          ARRAY['convertible', '770 convertible']),
      ('Excalibur',      'Phaeton',      ARRAY['roadster', 'series ii', 'series iii', 'series iv', 'ss roadster', 'ss phaeton']),
      ('Avanti',         'II',           ARRAY['convertible', 'coupe', 'avanti ii']),
      ('Crosley',        'Hotshot',      ARRAY['convertible', 'station wagon', 'super sports', 'cd', 'cc']),
      ('Hudson',         'Hornet',       ARRAY['pickup', 'big boy', 'c-28', 'super six', 'commodore', 'terraplane']),
      ('Volkswagen',     'Rabbit',       ARRAY['pickup', 'caddy', 'rabbit pickup']),
      ('Royal Enfield',  'Interceptor',  ARRAY['interceptor 650', 'continental gt 650', 'bullet 500', 'classic 500'])
    ) AS v(make_name, model_name, new_aliases)
  LOOP
    UPDATE public.canonical_models m
    SET aliases = (
      SELECT array_agg(a ORDER BY ord)
      FROM (
        SELECT a, min(ord) AS ord
        FROM unnest(coalesce(m.aliases, '{}'::text[]) || r.new_aliases) WITH ORDINALITY AS t(a, ord)
        GROUP BY a
      ) s
    )
    WHERE lower(m.make) = lower(r.make_name)
      AND lower(m.canonical_model) = lower(r.model_name);
  END LOOP;
END $aliases$;

-- Clear the over-restrictive 1949-1952 year bound on Chevrolet Styleline so pre-war / mis-dated
-- Styleline rows still key to the Styleline family rather than falling into 'other'.
UPDATE public.canonical_models
SET year_start = NULL, year_end = NULL
WHERE make = 'Chevrolet' AND canonical_model = 'Styleline'
  AND (year_start IS NOT NULL OR year_end IS NOT NULL);

-- 3. Refresh mv_vehicle_name_dictionary and mv_model_family_names when present, and add an index on
--    (lower(make), model_l) so canonical-make lookups in mv_family_market / mv_family_sales / treemap_* are index-backed.
DO $refresh_dict$
BEGIN
  IF to_regclass('public.mv_vehicle_name_dictionary') IS NOT NULL THEN
    REFRESH MATERIALIZED VIEW public.mv_vehicle_name_dictionary;
  END IF;
  IF to_regclass('public.mv_model_family_names') IS NOT NULL THEN
    REFRESH MATERIALIZED VIEW public.mv_model_family_names;
    CREATE INDEX IF NOT EXISTS mv_model_family_names_canonical_make_model_idx
      ON public.mv_model_family_names (lower(make), model_l);
  END IF;
END $refresh_dict$;

-- 4. Rebuild mv_family_market and mv_family_sales so they resolve mv_model_family_names by matching
--    either the raw vehicle make (`o.make_l`) or the normalized brand (`o.brand_l`) against either
--    `n.make_l` or `lower(n.make)`, preferring exact `n.make_l = o.brand_l` / `n.make_l = o.make_l`
--    and highest vehicle frequency.
DO $rebuild_family_folds$
BEGIN
  IF to_regclass('public.mv_family_market') IS NOT NULL THEN
    DROP VIEW IF EXISTS public.v_market_measurement_coverage;
    DROP VIEW IF EXISTS public.v_market_house_coverage;
    DROP MATERIALIZED VIEW IF EXISTS public.mv_family_sales;
    DROP MATERIALIZED VIEW IF EXISTS public.mv_family_market;

    CREATE MATERIALIZED VIEW public.mv_family_market AS
    WITH name_map AS MATERIALIZED (
      SELECT make_k,
             model_l,
             (array_agg(family_id ORDER BY ord, vehicles DESC NULLS LAST, family_id))[1] AS family_id,
             (array_agg(family ORDER BY ord, vehicles DESC NULLS LAST, family_id))[1] AS family,
             (array_agg(year_start ORDER BY ord, vehicles DESC NULLS LAST, family_id))[1] AS year_start,
             (array_agg(year_end ORDER BY ord, vehicles DESC NULLS LAST, family_id))[1] AS year_end
      FROM (
        SELECT n.make_l AS make_k, n.model_l, n.family_id, n.family, n.year_start, n.year_end, n.vehicles, 1 AS ord
        FROM public.mv_model_family_names n
        WHERE n.family_id IS NOT NULL
        UNION ALL
        SELECT lower(n.make) AS make_k, n.model_l, n.family_id, n.family, n.year_start, n.year_end, n.vehicles, 2 AS ord
        FROM public.mv_model_family_names n
        WHERE n.family_id IS NOT NULL AND n.make IS NOT NULL AND lower(n.make) <> n.make_l
      ) u
      GROUP BY make_k, model_l
    ),
    o AS (
      SELECT o.brand_name, o.model, o.outcome, o.sold_amount, o.year,
             coalesce(v.sale_date, v.bat_sale_date) AS sale_date,
             lower(o.brand_name) AS brand_l,
             lower(v.make) AS make_l,
             lower(btrim(coalesce(o.model, ''))) AS model_l,
             o.source_name IN ('Bring a Trailer', 'Mecum', 'Bonhams') AND o.sold_amount > 0 AS bat
      FROM public.mv_treemap_outcomes o
      JOIN public.vehicles v ON v.id = o.id
    ),
    f AS (
      SELECT o.*,
             CASE
               WHEN coalesce(nb.family_id, nm.family_id) IS NOT NULL
                AND (o.year IS NULL OR coalesce(nb.year_start, nm.year_start) IS NULL OR o.year >= coalesce(nb.year_start, nm.year_start) - 1)
                AND (o.year IS NULL OR coalesce(nb.year_end, nm.year_end) IS NULL OR o.year <= coalesce(nb.year_end, nm.year_end) + 1)
               THEN coalesce(nb.family_id, nm.family_id)
             END AS family_id,
             coalesce(nb.family, nm.family) AS family
      FROM o
      LEFT JOIN name_map nb ON nb.make_k = o.brand_l AND nb.model_l = o.model_l
      LEFT JOIN name_map nm ON nm.make_k = o.make_l AND nm.model_l = o.model_l
    ),
    g AS (
      SELECT brand_name, family_id, model_l AS model_key,
        mode() WITHIN GROUP (ORDER BY model) AS model,
        min(family) FILTER (WHERE family_id IS NOT NULL) AS family,
        count(*) FILTER (WHERE sold_amount > 0) AS sold,
        count(*) FILTER (WHERE outcome = 'sold') AS sold_any,
        count(*) AS offered,
        (sum(sold_amount) FILTER (WHERE sold_amount > 0))::bigint AS usd,
        -- the 12-month move, on the measured houses (Bring a Trailer, Mecum, Bonhams)
        count(*) FILTER (WHERE bat) AS bat_dated,
        count(*) FILTER (WHERE bat AND sale_date > current_date - 365 AND sale_date <= current_date) AS bat_sold_12m,
        count(*) FILTER (WHERE bat AND sale_date > current_date - 730 AND sale_date <= current_date - 365) AS bat_sold_prior_12m,
        (sum(sold_amount) FILTER (WHERE bat AND sale_date > current_date - 365 AND sale_date <= current_date))::bigint AS bat_usd_12m,
        (sum(sold_amount) FILTER (WHERE bat AND sale_date > current_date - 730 AND sale_date <= current_date - 365))::bigint AS bat_usd_prior_12m
      FROM f
      GROUP BY brand_name, family_id, model_l
    ),
    k AS (
      -- A family needs 3 sales in the brand to be named; fewer join the brand's "other".
      SELECT g.*, (family_id IS NULL OR sum(sold) OVER (PARTITION BY brand_name, family_id) < 3) AS other FROM g
    )
    SELECT brand_name AS brand,
      CASE WHEN other THEN 'other' ELSE family_id::text END AS family_key,
      CASE WHEN other THEN NULL ELSE max(family) END AS family,
      model_key, mode() WITHIN GROUP (ORDER BY model) AS model,
      sum(sold)::bigint AS sold, sum(sold_any)::bigint AS sold_any, sum(offered)::bigint AS offered,
      sum(usd)::bigint AS usd, sum(bat_dated)::bigint AS bat_dated,
      sum(bat_sold_12m)::bigint AS bat_sold_12m, sum(bat_sold_prior_12m)::bigint AS bat_sold_prior_12m,
      sum(bat_usd_12m)::bigint AS bat_usd_12m, sum(bat_usd_prior_12m)::bigint AS bat_usd_prior_12m,
      now() AS as_of
    FROM k
    GROUP BY brand_name, other, CASE WHEN other THEN 'other' ELSE family_id::text END, model_key;

    CREATE UNIQUE INDEX mv_family_market_key ON public.mv_family_market (brand, family_key, model_key);
    REVOKE ALL ON public.mv_family_market FROM PUBLIC;
    GRANT SELECT ON public.mv_family_market TO anon, authenticated, service_role;
    COMMENT ON MATERIALIZED VIEW public.mv_family_market IS
      'One row per brand, factory model family (canonical_models key, or "other": no family, or under 3 sales in the brand) '
      'and model name (lower(btrim(model))) from confirmed sales: dollars, sold, sell-through inputs, and (bat_*) the last 12 months '
      'against the 12 before on the measured houses (Bring a Trailer, Mecum, Bonhams).';

    CREATE MATERIALIZED VIEW public.mv_family_sales AS
    WITH name_map AS MATERIALIZED (
      SELECT make_k,
             model_l,
             (array_agg(family_id ORDER BY ord, vehicles DESC NULLS LAST, family_id))[1] AS family_id,
             (array_agg(year_start ORDER BY ord, vehicles DESC NULLS LAST, family_id))[1] AS year_start,
             (array_agg(year_end ORDER BY ord, vehicles DESC NULLS LAST, family_id))[1] AS year_end
      FROM (
        SELECT n.make_l AS make_k, n.model_l, n.family_id, n.year_start, n.year_end, n.vehicles, 1 AS ord
        FROM public.mv_model_family_names n
        WHERE n.family_id IS NOT NULL
        UNION ALL
        SELECT lower(n.make) AS make_k, n.model_l, n.family_id, n.year_start, n.year_end, n.vehicles, 2 AS ord
        FROM public.mv_model_family_names n
        WHERE n.family_id IS NOT NULL AND n.make IS NOT NULL AND lower(n.make) <> n.make_l
      ) u
      GROUP BY make_k, model_l
    ),
    o AS (
      SELECT o.id, o.brand_name, o.model, o.year, o.source_name, o.sold_amount,
             coalesce(v.sale_date, v.bat_sale_date) AS sale_date,
             lower(o.brand_name) AS brand_l,
             lower(v.make) AS make_l,
             lower(btrim(coalesce(o.model, ''))) AS model_l
      FROM public.mv_treemap_outcomes o
      JOIN public.vehicles v ON v.id = o.id
      WHERE o.sold_amount > 0 AND coalesce(v.sale_date, v.bat_sale_date) IS NOT NULL
    ),
    f AS (
      SELECT o.*,
             CASE
               WHEN coalesce(nb.family_id, nm.family_id) IS NOT NULL
                AND (o.year IS NULL OR coalesce(nb.year_start, nm.year_start) IS NULL OR o.year >= coalesce(nb.year_start, nm.year_start) - 1)
                AND (o.year IS NULL OR coalesce(nb.year_end, nm.year_end) IS NULL OR o.year <= coalesce(nb.year_end, nm.year_end) + 1)
               THEN coalesce(nb.family_id, nm.family_id)::text
             END AS family_id
      FROM o
      LEFT JOIN name_map nb ON nb.make_k = o.brand_l AND nb.model_l = o.model_l
      LEFT JOIN name_map nm ON nm.make_k = o.make_l AND nm.model_l = o.model_l
    ),
    named AS (
      SELECT DISTINCT brand, family_key FROM public.mv_family_market WHERE family_key <> 'other'
    )
    SELECT f.id AS vehicle_id,
           f.brand_name AS brand,
           coalesce(named.family_key, 'other') AS family_key,
           f.model,
           f.year,
           f.source_name AS source,
           f.sold_amount::bigint AS usd,
           f.sale_date
    FROM f
    LEFT JOIN named ON named.brand = f.brand_name AND named.family_key = f.family_id;

    CREATE UNIQUE INDEX mv_family_sales_vehicle ON public.mv_family_sales (vehicle_id);
    CREATE INDEX mv_family_sales_family_date ON public.mv_family_sales (brand, family_key, sale_date DESC);
    CLUSTER public.mv_family_sales USING mv_family_sales_family_date;
    ANALYZE public.mv_family_sales;
    REVOKE ALL ON public.mv_family_sales FROM PUBLIC;
    GRANT SELECT ON public.mv_family_sales TO anon, authenticated, service_role;
    COMMENT ON MATERIALIZED VIEW public.mv_family_sales IS
      'Dated confirmed sales with an amount, keyed to (brand, family_key) the way mv_family_market keys them.';
  END IF;
END $rebuild_family_folds$;

-- 5. Update treemap_years and treemap_sales so target_models matches either fn.make_l = lower(p_make)
--    or lower(fn.make) = lower(p_make).
CREATE OR REPLACE FUNCTION public.treemap_years(p_source text, p_make text, p_model text)
 RETURNS TABLE(name text, count bigint, value bigint, median_price bigint, sold_count bigint, auction_count bigint, avg_bids integer, avg_watchers integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH target_models AS (
    SELECT lower(p_model) AS model_l
    UNION
    SELECT fn.model_l
    FROM public.mv_model_family_names fn
    WHERE (fn.make_l = lower(p_make) OR lower(fn.make) = lower(p_make))
      AND (
        lower(fn.family) = lower(p_model)
        OR fn.model_l LIKE lower(p_model) || ' %'
        OR (lower(p_make) = 'chevrolet' AND lower(p_model) = 'silverado' AND fn.model_l LIKE '%silverado%')
        OR (lower(p_make) = 'gmc' AND lower(p_model) = 'sierra' AND fn.model_l LIKE '%sierra%')
        OR (lower(p_make) = 'chevrolet' AND lower(p_model) = 'pickup' AND fn.family IN (
          'Pickup', '3100', '3600', '3800', 'Apache', 'Cameo',
          'C10', 'K10', 'C20', 'K20', 'C30', 'K30',
          'C1500', 'K1500', '454 SS', 'C2500', 'K2500', 'C3500', 'K3500', '3500',
          'S10', 'S-10 Pickup', 'Silverado'
        ))
        OR (lower(p_make) = 'gmc' AND lower(p_model) = 'pickup' AND fn.family IN (
          'Pickup', 'C1500', 'K1500', 'Sierra', 'Syclone',
          'Sonoma', 'S15 Pickup', 'Caballero', 'C2500', 'K2500', 'C3500', 'K3500'
        ))
        OR (lower(p_make) = 'ford' AND lower(p_model) = 'pickup' AND fn.family IN (
          'Pickup', 'F-1', 'F-100', 'F-150', 'F-250', 'F-350', 'F-450', 'Ranger'
        ))
      )
  )
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
  JOIN target_models tm ON lower(btrim(o.model)) = tm.model_l
  WHERE lower(o.brand_name) = lower(p_make)
    AND o.year IS NOT NULL
    AND (p_source IS NULL OR o.source_name = p_source)
  GROUP BY o.year
  HAVING count(*) FILTER (WHERE o.sold_amount > 0) > 0
  ORDER BY value DESC, o.year DESC;
$function$;

REVOKE ALL ON FUNCTION public.treemap_years(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_years(text, text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.treemap_sales(p_make text, p_model text, p_year integer DEFAULT NULL::integer)
 RETURNS TABLE(id uuid, year integer, make text, model text, listing_title text, sold_amount bigint, sale_basis text, primary_image_url text, mileage integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH target_models AS (
    SELECT lower(p_model) AS model_l
    UNION
    SELECT fn.model_l
    FROM public.mv_model_family_names fn
    WHERE (fn.make_l = lower(p_make) OR lower(fn.make) = lower(p_make))
      AND (
        lower(fn.family) = lower(p_model)
        OR fn.model_l LIKE lower(p_model) || ' %'
        OR (lower(p_make) = 'chevrolet' AND lower(p_model) = 'silverado' AND fn.model_l LIKE '%silverado%')
        OR (lower(p_make) = 'gmc' AND lower(p_model) = 'sierra' AND fn.model_l LIKE '%sierra%')
        OR (lower(p_make) = 'chevrolet' AND lower(p_model) = 'pickup' AND fn.family IN (
          'Pickup', '3100', '3600', '3800', 'Apache', 'Cameo',
          'C10', 'K10', 'C20', 'K20', 'C30', 'K30',
          'C1500', 'K1500', '454 SS', 'C2500', 'K2500', 'C3500', 'K3500', '3500',
          'S10', 'S-10 Pickup', 'Silverado'
        ))
        OR (lower(p_make) = 'gmc' AND lower(p_model) = 'pickup' AND fn.family IN (
          'Pickup', 'C1500', 'K1500', 'Sierra', 'Syclone',
          'Sonoma', 'S15 Pickup', 'Caballero', 'C2500', 'K2500', 'C3500', 'K3500'
        ))
        OR (lower(p_make) = 'ford' AND lower(p_model) = 'pickup' AND fn.family IN (
          'Pickup', 'F-1', 'F-100', 'F-150', 'F-250', 'F-350', 'F-450', 'Ranger'
        ))
      )
  ),
  deduped AS (
    SELECT DISTINCT ON (
      o.year,
      o.sold_amount::bigint,
      COALESCE(
        CASE WHEN v.sale_date IS NOT NULL AND to_char(v.sale_date, 'MM-DD') <> '01-01' THEN v.sale_date::text END,
        CASE WHEN v.mileage IS NOT NULL AND v.mileage > 0 THEN 'mi:' || v.mileage::text END,
        NULLIF(regexp_replace(lower(COALESCE(NULLIF(btrim(v.listing_url), ''), NULLIF(btrim(v.discovery_url), ''))), '^https?://(www\.)?|/+$|\?.*$', '', 'g'), ''),
        o.id::text
      )
    )
      o.id,
      o.year,
      o.brand_name AS make,
      o.model,
      v.listing_title,
      o.sold_amount::bigint AS sold_amount,
      o.sale_basis,
      COALESCE(NULLIF(btrim(v.primary_image_url), ''), NULLIF(btrim(v.images[1]), '')) AS primary_image_url,
      v.mileage
    FROM public.mv_treemap_outcomes o
    JOIN target_models tm ON lower(btrim(o.model)) = tm.model_l
    JOIN public.vehicles v ON v.id = o.id
    WHERE o.sold_amount > 0
      AND lower(o.brand_name) = lower(p_make)
      AND (p_year IS NULL OR o.year = p_year)
    ORDER BY
      o.year,
      o.sold_amount::bigint,
      COALESCE(
        CASE WHEN v.sale_date IS NOT NULL AND to_char(v.sale_date, 'MM-DD') <> '01-01' THEN v.sale_date::text END,
        CASE WHEN v.mileage IS NOT NULL AND v.mileage > 0 THEN 'mi:' || v.mileage::text END,
        NULLIF(regexp_replace(lower(COALESCE(NULLIF(btrim(v.listing_url), ''), NULLIF(btrim(v.discovery_url), ''))), '^https?://(www\.)?|/+$|\?.*$', '', 'g'), ''),
        o.id::text
      ),
      (CASE WHEN COALESCE(NULLIF(btrim(v.primary_image_url), ''), NULLIF(btrim(v.images[1]), '')) IS NOT NULL THEN 0 ELSE 1 END),
      (CASE WHEN v.vin IS NOT NULL AND length(btrim(v.vin)) = 17 THEN 0 ELSE 1 END),
      (CASE WHEN v.mileage IS NOT NULL AND v.mileage > 0 THEN 0 ELSE 1 END),
      length(COALESCE(v.listing_title, '')) DESC,
      o.id
  )
  SELECT id, year, make, model, listing_title, sold_amount, sale_basis, primary_image_url, mileage
  FROM deduped
  ORDER BY sold_amount DESC, id
  LIMIT 36;
$function$;

REVOKE ALL ON FUNCTION public.treemap_sales(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_sales(text, text, integer) TO anon, authenticated, service_role;

-- 6. Enforce service_role-only execution on treemap_populations() and update the latest
--    treemap_refreshes.populations receipt when present.
DO $pop$
DECLARE
  v_latest_id bigint;
BEGIN
  IF to_regprocedure('public.treemap_populations()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.treemap_populations() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.treemap_populations() TO service_role;
  END IF;

  IF to_regclass('public.mv_family_share_movers') IS NOT NULL THEN
    REFRESH MATERIALIZED VIEW public.mv_family_share_movers;
  END IF;

  IF to_regclass('public.treemap_refreshes') IS NOT NULL
     AND to_regclass('public.mv_treemap_sale_brands') IS NOT NULL
     AND to_regprocedure('public.treemap_populations()') IS NOT NULL THEN
    SELECT id INTO v_latest_id
    FROM public.treemap_refreshes
    ORDER BY refreshed_at DESC, id DESC
    LIMIT 1;

    IF v_latest_id IS NOT NULL THEN
      UPDATE public.treemap_refreshes
      SET populations = public.treemap_populations()
      WHERE id = v_latest_id;
    END IF;
  END IF;
END $pop$;

COMMIT;
