-- mv_market_position gains the search page's per-make facets, and browse_stats reads them instead of scanning
-- vehicles four times.
--
-- Measured on production 2026-10-14: browse_stats(make) aggregated the make's public vehicles four times (totals,
-- sources, eras, models): Porsche 17.7 s, Ford 15.0 s, Chevrolet over 60 s. A visitor's call runs past anon's 15 s
-- statement timeout, so the search page's stats bar never fills for the big makes. mv_market_position already folds
-- public vehicles by canonical make every night (refresh-market-views-nightly, 03:40 UTC, CONCURRENTLY); its query
-- took 17.2 s. The same fold with the facets added (a with-photo count, the top 20 models, the top 10 sources, the
-- eras) took 17.7 s and still holds 152 rows.
--
-- mv_market_position keeps every column it had, with the same expressions, and gains with_images, by_model,
-- by_source, by_era and folded_at. A materialized view's query cannot be altered, so the extended fold is built
-- beside the live one and swapped in. The old one is dropped without CASCADE: nothing depends on it, and
-- market_position() reads its columns by name. The unique index the CONCURRENTLY refresh needs is recreated, and the
-- grants are restated (SELECT only).
--
-- browse_stats(make) answers from the fold row of the canonical make that matches the name, with the fold's
-- population (public vehicles of that canonical make; a price is a sale, sold or canonical sold price, as the fold
-- counts it) and its folded_at. A name with no fold row (an unresolved raw make, a typo) and the all-makes call keep
-- the live aggregate, unchanged: their populations are small, or unused.
-- Contract: supabase/sql/test_market_position_browse_facets.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '110s';

DO $mig$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(attname::text, ',' ORDER BY attnum) INTO v_cols
  FROM pg_attribute
  WHERE attrelid = to_regclass('public.mv_market_position') AND attnum > 0 AND NOT attisdropped;
  IF v_cols = 'dim,name,volume,sell_through,demand,avg_year,median_price,total_value,p25,p50,p75,price_n,watch_sum,'
      || 'watch_n,auction_med,market_med,with_images,by_model,by_source,by_era,folded_at' THEN
    RETURN;  -- already extended: a re-run
  END IF;
  -- The fold as read on 2026-10-14, or nothing changes.
  IF v_cols IS DISTINCT FROM 'dim,name,volume,sell_through,demand,avg_year,median_price,total_value,p25,p50,p75,'
      || 'price_n,watch_sum,watch_n,auction_med,market_med'
    OR encode(sha256(convert_to(pg_get_viewdef('public.mv_market_position'::regclass), 'UTF8')), 'base64')
      <> 'FUJLg2PUd+m3EverI9QR5l2Wjyfcn3IK7Q0dHXIQ1Q0=' THEN
    RAISE EXCEPTION 'mv_market_position drifted from the 2026-10-14 read; not rebuilding it';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid
             WHERE d.refobjid = 'public.mv_market_position'::regclass
               AND r.ev_class <> 'public.mv_market_position'::regclass) THEN
    RAISE EXCEPTION 'a view depends on mv_market_position; not rebuilding it';
  END IF;

  DROP MATERIALIZED VIEW IF EXISTS public.mv_market_position_next;
  EXECUTE $def$
    CREATE MATERIALIZED VIEW public.mv_market_position_next AS
    WITH v AS MATERIALIZED (
      SELECT COALESCE(mk.display_name, mk.canonical_name, 'Unresolved'::text) AS canon_make,
        veh.bat_watchers AS watch,
        veh.year,
        COALESCE(veh.sale_price::numeric, veh.sold_price::numeric, veh.canonical_sold_price) AS price,
        (veh.sale_status = 'sold'::text OR veh.auction_status = 'sold'::text) AS is_sold,
        lower(veh.source) = ANY (ARRAY['bat'::text, 'bring_a_trailer'::text, 'bringatrailer'::text, 'mecum'::text, 'barrett-jackson'::text, 'cars_and_bids'::text, 'bonhams'::text, 'rm-sothebys'::text, 'gooding'::text, 'leake'::text, 'silver-auctions'::text, 'kruse'::text, 'auctions-america'::text, 'mccormicks'::text, 'russo-and-steele'::text, 'pcarmarket'::text, 'gaa-classic-cars'::text, 'palm-springs-exotic'::text, 'themarket-bonhams'::text, 'h-and-h'::text, 'coys'::text, 'worldwide-auctioneers'::text, 'shannons'::text, 'broad_arrow'::text, 'artcurial'::text, 'collecting_cars'::text, 'branson-auctions'::text, 'midamerica'::text, 'gpk-auctions'::text, 'historics'::text, 'hollywood-car-auction'::text, 'sbx-cars'::text, 'grand-prix-classics'::text, 'carlisle'::text]) AS is_auction,
        lower(veh.source) = ANY (ARRAY['facebook_marketplace'::text, 'facebook-marketplace'::text, 'facebook-saved'::text, 'classiccars-com'::text, 'classiccars.com'::text, 'craigslist'::text, 'ksl'::text, 'jamesedition'::text, 'erclassics'::text, 'hemmings'::text, 'ebay'::text, 'classic-com'::text, 'dealer_website'::text, 'barnfinds'::text, 'classic-driver'::text, 'dupont registry'::text, 'autotrader'::text, 'cars_com'::text]) AS is_marketplace,
        veh.primary_image_url IS NOT NULL AS has_image,
        veh.source,
        veh.era,
        veh.model
      FROM vehicles veh
        LEFT JOIN canonical_makes mk ON mk.id = veh.canonical_make_id
      WHERE veh.is_public
    ), agg AS (
      SELECT canon_make,
        count(*) AS volume,
        round(100.0 * count(*) FILTER (WHERE is_sold)::numeric / count(*)::numeric)::integer AS sell_through,
        round(avg(watch))::integer AS demand,
        round(avg(year))::integer AS avg_year,
        percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (price::double precision))::bigint AS median_price,
        sum(price) FILTER (WHERE price IS NOT NULL)::bigint AS total_value,
        percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (price::double precision))::bigint AS p25,
        percentile_cont(0.50::double precision) WITHIN GROUP (ORDER BY (price::double precision))::bigint AS p50,
        percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (price::double precision))::bigint AS p75,
        count(*) FILTER (WHERE price IS NOT NULL)::integer AS price_n,
        sum(watch) FILTER (WHERE watch IS NOT NULL) AS watch_sum,
        count(*) FILTER (WHERE watch IS NOT NULL)::integer AS watch_n,
        percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (price::double precision)) FILTER (WHERE is_auction)::bigint AS auction_med,
        percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (price::double precision)) FILTER (WHERE is_marketplace)::bigint AS market_med,
        count(*) FILTER (WHERE has_image)::integer AS with_images
      FROM v
      GROUP BY canon_make
    ), facet AS (
      SELECT canon_make, 'model'::text AS facet, model AS value, count(*) AS n FROM v WHERE model IS NOT NULL GROUP BY canon_make, model
      UNION ALL
      SELECT canon_make, 'source'::text, source, count(*) FROM v WHERE source IS NOT NULL GROUP BY canon_make, source
      UNION ALL
      SELECT canon_make, 'era'::text, era, count(*) FROM v WHERE era IS NOT NULL GROUP BY canon_make, era
    ), ranked AS (
      SELECT canon_make, facet, value, n,
        row_number() OVER (PARTITION BY canon_make, facet ORDER BY n DESC, value) AS rk
      FROM facet
    ), facets AS (
      SELECT canon_make,
        jsonb_agg(jsonb_build_object('model', value, 'count', n) ORDER BY rk) FILTER (WHERE facet = 'model' AND rk <= 20) AS by_model,
        jsonb_agg(jsonb_build_object('source', value, 'count', n) ORDER BY rk) FILTER (WHERE facet = 'source' AND rk <= 10) AS by_source,
        jsonb_agg(jsonb_build_object('era', value, 'count', n) ORDER BY rk) FILTER (WHERE facet = 'era') AS by_era
      FROM ranked
      GROUP BY canon_make
    )
    SELECT 'make'::text AS dim,
      a.canon_make AS name,
      a.volume, a.sell_through, a.demand, a.avg_year, a.median_price, a.total_value, a.p25, a.p50, a.p75, a.price_n,
      a.watch_sum, a.watch_n, a.auction_med, a.market_med,
      a.with_images,
      COALESCE(f.by_model, '[]'::jsonb) AS by_model,
      COALESCE(f.by_source, '[]'::jsonb) AS by_source,
      COALESCE(f.by_era, '[]'::jsonb) AS by_era,
      now() AS folded_at
    FROM agg a
      LEFT JOIN facets f ON f.canon_make = a.canon_make
  $def$;
  CREATE UNIQUE INDEX mv_market_position_next_pk ON public.mv_market_position_next USING btree (dim, name);
  DROP MATERIALIZED VIEW public.mv_market_position;
  ALTER MATERIALIZED VIEW public.mv_market_position_next RENAME TO mv_market_position;
  ALTER INDEX public.mv_market_position_next_pk RENAME TO mv_market_position_pk;
END $mig$;

REVOKE ALL ON public.mv_market_position FROM anon, authenticated, service_role;
GRANT SELECT ON public.mv_market_position TO anon, authenticated, service_role;

-- browse_stats: the live function as read on 2026-10-14, or this migration's (a re-run); anything else is drift.
DO $$ BEGIN
  IF encode(sha256(convert_to((SELECT prosrc FROM pg_proc WHERE oid = 'public.browse_stats(text)'::regprocedure), 'UTF8')), 'base64')
       <> '+vTFxYVgPcaz4moloy6Wyt2BEhjbm94/UJWjWySn/Ho='
     AND (SELECT prosrc FROM pg_proc WHERE oid = 'public.browse_stats(text)'::regprocedure) NOT LIKE '%FROM mv_market_position f%' THEN
    RAISE EXCEPTION 'browse_stats drifted from the 2026-10-14 read; not replacing it';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.browse_stats(p_make text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_total BIGINT;
  v_with_images BIGINT;
  v_with_price BIGINT;
  v_avg_price NUMERIC;
  v_by_source JSONB;
  v_by_era JSONB;
  v_by_model JSONB;
  v_fold RECORD;
BEGIN
  -- A canonical make's row of the nightly fold, when the name has one.
  IF p_make IS NOT NULL THEN
    SELECT f.name, f.volume, f.with_images, f.price_n, f.total_value, f.by_source, f.by_era, f.by_model, f.folded_at
      INTO v_fold
      FROM mv_market_position f
     WHERE f.dim = 'make' AND lower(f.name) = lower(p_make) AND f.name <> 'Unresolved'
     ORDER BY f.volume DESC
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'total', v_fold.volume,
        'with_images', v_fold.with_images,
        'with_price', v_fold.price_n,
        'avg_price', CASE WHEN v_fold.price_n > 0 THEN round(v_fold.total_value::numeric / v_fold.price_n, 2) END,
        'by_source', v_fold.by_source,
        'by_era', v_fold.by_era,
        'by_model', v_fold.by_model,
        'as_of', v_fold.folded_at,
        'population', 'public vehicles of the canonical make ' || v_fold.name || ' (mv_market_position)'
      );
    END IF;
  END IF;

  -- No fold row: the live aggregate.
  -- If no make provided, return stats for all public vehicles
  IF p_make IS NULL THEN
    SELECT
      count(*),
      count(*) FILTER (WHERE primary_image_url IS NOT NULL),
      count(*) FILTER (WHERE sold_price IS NOT NULL AND sold_price > 0),
      round(avg(sold_price) FILTER (WHERE sold_price IS NOT NULL AND sold_price > 0), 2)
    INTO v_total, v_with_images, v_with_price, v_avg_price
    FROM vehicles
    WHERE is_public = true;
  ELSE
    SELECT
      count(*),
      count(*) FILTER (WHERE primary_image_url IS NOT NULL),
      count(*) FILTER (WHERE sold_price IS NOT NULL AND sold_price > 0),
      round(avg(sold_price) FILTER (WHERE sold_price IS NOT NULL AND sold_price > 0), 2)
    INTO v_total, v_with_images, v_with_price, v_avg_price
    FROM vehicles
    WHERE is_public = true
      AND lower(make) = lower(p_make);
  END IF;

  -- by_source: top 10
  SELECT coalesce(jsonb_agg(row_to_json(s)::jsonb), '[]'::jsonb)
  INTO v_by_source
  FROM (
    SELECT source, count(*) AS count
    FROM vehicles
    WHERE is_public = true
      AND (p_make IS NULL OR lower(make) = lower(p_make))
      AND source IS NOT NULL
    GROUP BY source
    ORDER BY count DESC
    LIMIT 10
  ) s;

  -- by_era
  SELECT coalesce(jsonb_agg(row_to_json(e)::jsonb), '[]'::jsonb)
  INTO v_by_era
  FROM (
    SELECT era, count(*) AS count
    FROM vehicles
    WHERE is_public = true
      AND (p_make IS NULL OR lower(make) = lower(p_make))
      AND era IS NOT NULL
    GROUP BY era
    ORDER BY count DESC
  ) e;

  -- by_model: top 20
  SELECT coalesce(jsonb_agg(row_to_json(m)::jsonb), '[]'::jsonb)
  INTO v_by_model
  FROM (
    SELECT model, count(*) AS count
    FROM vehicles
    WHERE is_public = true
      AND (p_make IS NULL OR lower(make) = lower(p_make))
      AND model IS NOT NULL
    GROUP BY model
    ORDER BY count DESC
    LIMIT 20
  ) m;

  v_result := jsonb_build_object(
    'total', v_total,
    'with_images', v_with_images,
    'with_price', v_with_price,
    'avg_price', v_avg_price,
    'by_source', v_by_source,
    'by_era', v_by_era,
    'by_model', v_by_model
  );

  RETURN v_result;
END;
$function$;

COMMIT;
