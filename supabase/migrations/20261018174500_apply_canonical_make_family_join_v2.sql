-- Apply Canonical Make Family Join, Model Aliases & Recreate Dependent Scoreboard Views (2026-10-18)
--
-- Migration 20261018170000_canonical_make_family_join_and_aliases.sql rolled back on production
-- because DROP MATERIALIZED VIEW public.mv_family_sales failed due to dependent views
-- public.v_market_measurement_coverage and public.v_market_house_coverage.
--
-- This migration drops those two dependent views before rebuilding mv_family_market and
-- mv_family_sales, and recreates them immediately afterward so the entire transaction commits
-- cleanly on production and in idempotent tests.

BEGIN;
SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '10s';

-- 1. Canonical make aliases for brand/make spellings used on confirmed sales
UPDATE public.canonical_makes
SET aliases = (
  SELECT array_agg(DISTINCT a ORDER BY a)
  FROM unnest(coalesce(aliases, ARRAY[]::text[]) || ARRAY['meyers manx']) AS a
)
WHERE canonical_name = 'MEYERS'
  AND NOT (coalesce(aliases, ARRAY[]::text[]) @> ARRAY['meyers manx']);

UPDATE public.canonical_makes
SET aliases = (
  SELECT array_agg(DISTINCT a ORDER BY a)
  FROM unnest(coalesce(aliases, ARRAY[]::text[]) || ARRAY['range', 'range rover']) AS a
)
WHERE canonical_name = 'LAND ROVER'
  AND NOT (coalesce(aliases, ARRAY[]::text[]) @> ARRAY['range', 'range rover']);

UPDATE public.canonical_makes
SET aliases = (
  SELECT array_agg(DISTINCT a ORDER BY a)
  FROM unnest(coalesce(aliases, ARRAY[]::text[]) || ARRAY['pierce']) AS a
)
WHERE canonical_name = 'PIERCE-ARROW'
  AND NOT (coalesce(aliases, ARRAY[]::text[]) @> ARRAY['pierce']);

-- 2. Canonical model aliases for the remaining unkeyed model cohorts
DO $aliases$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- Dodge
      ('Dodge', 'D-Series', ARRAY['Pickup', 'D100 Pickup', 'D150 Pickup', 'D200 Pickup', 'W100 Pickup', 'W150 Pickup', 'W200 Pickup']),
      ('Dodge', 'Coronet', ARRAY['Deluxe']),
      -- Studebaker
      ('Studebaker', 'Commander', ARRAY['Pickup', '2R5 Pickup', '3R5 Pickup', 'E-Series Pickup', 'M-Series Pickup', 'Transtar Pickup']),
      -- Willys
      ('Willys', 'Jeep Wagon', ARRAY['Pickup', 'Station Wagon', 'Wagon']),
      ('Willys', 'Americar', ARRAY['Coupe']),
      -- International
      ('International', 'Travelall', ARRAY['Pickup']),
      ('International', 'Scout', ARRAY['Scout II 345 4×4', 'Scout II 345 4x4']),
      -- Dual-Ghia
      ('Dual-Ghia', 'L6.4', ARRAY['Convertible']),
      -- Ford
      ('Ford', 'Deluxe', ARRAY['Model 18', 'Model 48', 'Cabriolet']),
      ('Ford', 'Model T', ARRAY['Model S Runabout', 'Model S']),
      -- Land Rover (vehicles where v.make = 'Range' and v.model = 'Rover ...')
      ('Land Rover', 'Range Rover', ARRAY['Rover Supercharged', 'Rover HSE', 'Rover Westminster', 'Rover Autobiography']),
      ('Land Rover', 'Range Rover Sport', ARRAY['Rover Sport HSE', 'Rover Sport Supercharged', 'Rover Sport Autobiography', 'Rover Sport SVR']),
      ('Land Rover', 'Range Rover Velar', ARRAY['Rover Velar P250 R-Dynamic S', 'Rover Velar P380 R-Dynamic SE', 'Rover Velar P380 R-Dynamic HSE', 'Rover Velar']),
      ('Land Rover', 'LR3', ARRAY['Rover LR3 HSE', 'Rover LR3 SE', 'Rover LR3']),
      ('Land Rover', 'LR4', ARRAY['Rover LR4 HSE', 'Rover LR4 LUX', 'Rover LR4']),
      -- Factory Five
      ('Factory Five', 'Mk4 Roadster', ARRAY['Roadster', 'Mk4', 'Mk3 Roadster', 'MkII Roadster', 'MkI Roadster']),
      ('Factory Five', 'Shelby Daytona Coupe Replica', ARRAY['Type 65 Coupe']),
      -- Backdraft
      ('Backdraft', 'RT4 Roadster', ARRAY['Roadster', 'RT3 Roadster', 'RT3B Roadster']),
      -- Panoz
      ('Panoz', 'Esperante', ARRAY['Roadster', 'AIV Roadster']),
      -- Moto Guzzi
      ('Moto Guzzi', 'V7 Sport', ARRAY['Ambassador 750', '850 Le Mans III', '850 Le Mans II', '850 Le Mans', '850-T', 'V7 II Stornello', '1000SP', 'Eldorado 850', 'California 1100']),
      -- Bentley
      ('Bentley', '3 1/2 Litre', ARRAY['3-Litre']),
      -- Pierce-Arrow
      ('Pierce-Arrow', 'Model 48', ARRAY['Four']),
      -- BMW
      ('BMW', '328', ARRAY['327 Cabriolet', '327', '327/28']),
      -- Buick
      ('Buick', 'Super', ARRAY['Eight']),
      -- Chevrolet
      ('Chevrolet', 'Suburban', ARRAY['Surburban']),
      ('Chevrolet', 'Chevelle', ARRAY['Laguna S3', 'Chevelle Laguna S3']),
      -- MG
      ('MG', 'TD', ARRAY['T-Type']),
      -- Amphicar
      ('Amphicar', '770', ARRAY['Convertible']),
      -- Excalibur
      ('Excalibur', 'Phaeton', ARRAY['Roadster']),
      -- Avanti
      ('Avanti', 'II', ARRAY['Convertible']),
      -- Crosley
      ('Crosley', 'Hotshot', ARRAY['Convertible', 'Station Wagon']),
      -- Hudson
      ('Hudson', 'Hornet', ARRAY['Pickup']),
      -- Volkswagen
      ('Volkswagen', 'Rabbit', ARRAY['Pickup', 'Caddy Pickup']),
      -- Royal Enfield
      ('Royal Enfield', 'Interceptor', ARRAY['Interceptor 650'])
    ) AS t(make_name, model_name, new_aliases)
  LOOP
    UPDATE public.canonical_models cm
    SET aliases = (
      SELECT array_agg(DISTINCT a ORDER BY a)
      FROM unnest(coalesce(cm.aliases, ARRAY[]::text[]) || r.new_aliases) AS a
    )
    WHERE cm.make = r.make_name
      AND cm.canonical_model = r.model_name
      AND NOT (coalesce(cm.aliases, ARRAY[]::text[]) @> r.new_aliases);
  END LOOP;
END $aliases$;

-- Chevrolet Styleline was produced 1949-1952, plus pre-war Stylemaster/Fleetmaster aliases mapped to it;
-- clear the narrow year gate on Chevrolet Styleline so 1942-1948 Fleetmaster/Stylemaster sales key cleanly.
UPDATE public.canonical_models
SET year_start = NULL,
    year_end = NULL
WHERE make = 'Chevrolet'
  AND canonical_model = 'Styleline'
  AND (year_start IS NOT NULL OR year_end IS NOT NULL);

-- 3. Refresh mv_vehicle_name_dictionary and mv_model_family_names so the new make & model aliases
--    propagate into the family lookup table, and index lower(make) on mv_model_family_names.
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

-- 4. Rebuild mv_family_market and mv_family_sales so that:
--    - Dependent views (v_market_measurement_coverage, v_market_house_coverage) are dropped first
--      and recreated after mv_family_sales is rebuilt.
--    - Both `o.brand_l` (`lower(o.brand_name)`) and `o.make_l` (`lower(v.make)`) can match either
--      `n.make_l` or `lower(n.make)`, preferring exact `n.make_l = o.brand_l` / `n.make_l = o.make_l`
--      and highest vehicle frequency.
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

-- 5. Recreate v_market_house_coverage, market_measured_houses(), and v_market_measurement_coverage
--    whenever their underlying relations exist.
DO $recreate_scoreboard_views$
BEGIN
  IF to_regclass('public.source_census') IS NOT NULL
     AND to_regclass('public.mv_source_target_landed') IS NOT NULL
     AND to_regclass('public.mv_treemap_outcomes') IS NOT NULL
     AND to_regclass('public.mv_family_sales') IS NOT NULL THEN

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
  END IF;
END $recreate_scoreboard_views$;

-- 6. Update treemap_years and treemap_sales so target_models matches either fn.make_l = lower(p_make)
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
        v.id::text
      )
    )
      v.id, v.year, v.make, v.model,
      COALESCE(v.listing_title, v.bat_listing_title) AS listing_title,
      o.sold_amount::bigint AS sold_amount,
      o.sale_basis, v.primary_image_url, v.mileage
    FROM public.mv_treemap_outcomes o
    JOIN target_models tm ON lower(o.model) = tm.model_l
    JOIN public.vehicles v ON v.id = o.id
    WHERE lower(o.brand_name) = lower(p_make)
      AND (p_year IS NULL OR o.year = p_year)
      AND o.sold_amount > 0
      AND v.is_public IS TRUE AND v.deleted_at IS NULL
    ORDER BY
      o.year,
      o.sold_amount::bigint DESC,
      COALESCE(
        CASE WHEN v.sale_date IS NOT NULL AND to_char(v.sale_date, 'MM-DD') <> '01-01' THEN v.sale_date::text END,
        CASE WHEN v.mileage IS NOT NULL AND v.mileage > 0 THEN 'mi:' || v.mileage::text END,
        NULLIF(regexp_replace(lower(COALESCE(NULLIF(btrim(v.listing_url), ''), NULLIF(btrim(v.discovery_url), ''))), '^https?://(www\.)?|/+$|\?.*$', '', 'g'), ''),
        v.id::text
      ),
      (COALESCE(v.listing_title, v.bat_listing_title) IS NOT NULL) DESC,
      (v.primary_image_url IS NOT NULL) DESC,
      (NULLIF(btrim(v.vin), '') IS NOT NULL) DESC,
      (NULLIF(btrim(v.listing_url), '') IS NOT NULL) DESC,
      length(COALESCE(v.model, '')) DESC,
      v.id
  )
  SELECT id, year, make, model, listing_title, sold_amount, sale_basis, primary_image_url, mileage
  FROM deduped
  ORDER BY sold_amount DESC, id
  LIMIT 200;
$function$;

REVOKE ALL ON FUNCTION public.treemap_sales(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_sales(text, text, integer) TO anon, authenticated, service_role;

-- 7. Enforce service_role-only execution on treemap_populations() and update the latest
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
