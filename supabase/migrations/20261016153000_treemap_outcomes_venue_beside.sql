-- The map's fold names every house it can (market_venue_label), built beside the live chain and filled on its own job.
--
-- MEASURED 2026-10-15 13:3xZ (read-only, prod): 37,688 of the 286,610 confirmed sales with an amount in
-- mv_treemap_outcomes have no house (source_name null). The fold's CASE (20261014063000) misses the slugs
-- vehicles.auction_source holds (cars_and_bids, barrett-jackson, rm-sothebys, sbx-cars, broad_arrow) and rows whose house
-- is only in canonical_platform. mv_family_sales has no Cars & Bids, Barrett-Jackson or RM rows (FamilySalesChart's venues).
--
-- A matview's query cannot be replaced in place, and six views read this one (the map's two aggregates, mv_brand_market,
-- mv_family_market, mv_family_sales through mv_family_market, mv_family_year_prices), so the chain is copied, not dropped:
--   mv_treemap_outcomes_v2   this fold with source_name = market_venue_label(auction_source, canonical_platform); every
--                            other column, the population and the outcome rule are the live definition's, unchanged
--   <view>_v2                for mv_treemap_sale_brands, mv_treemap_sale_models, mv_brand_market, mv_family_market,
--                            mv_family_sales and mv_family_year_prices: the live definition (pg_get_viewdef) with its
--                            parents read as their _v2 copies; the same indexes (named <index>_v2), grants and comment
-- All are created WITH NO DATA.
-- market_venue_v2_fill() fills the next unfilled copy, one view per call, in dependency order (a plain REFRESH, each in
-- its own job run and transaction under the job's 20 min limit). It skips 09:00-10:20Z (treemap_refresh_all and the
-- family folds) and 18:30-19:30Z (refresh-family-year-prices), and runs when fewer than 10 sessions wait on a lock.
-- mv_family_year_prices_v2 (skylar-08's fold; classified_ask_board reads it after #1382) fills only 19:30-09:00Z, with
-- refresh_family_year_prices' settings (one sequential pass of vehicles, about 4.5 min).
-- Job market-venue-v2-fill calls it every 10 min. The rename swap (a later migration, one transaction, lock_timeout 5 s)
-- refuses unless every copy is filled; it unschedules this job. Nothing reads the copies until then.
-- Disk: the seven views take 171 MB (pg_total_relation_size, 13:5xZ); 98 GB of 279 GB free (Management API, 13:41Z).
-- Contract: supabase/sql/test_treemap_outcomes_venue_beside.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE
  v_chain text[];
  v_reads text;
BEGIN
  IF to_regprocedure('public.market_venue_label(text,text)') IS NULL THEN
    RAISE EXCEPTION 'apply 20261016150000_market_venue_label.sql first';
  END IF;
  -- The live fold still names houses with the 20261014063000 CASE; a fold changed since needs its own review.
  IF pg_get_viewdef('public.mv_treemap_outcomes'::regclass) NOT LIKE '%''cars-and-bids''::text%'
     OR pg_get_viewdef('public.mv_treemap_outcomes'::regclass) LIKE '%market_venue_label%' THEN
    RAISE EXCEPTION 'mv_treemap_outcomes is not the 20261014063000 definition this copies';
  END IF;
  -- Every view that reads the fold, directly or through another, is copied here.
  WITH RECURSIVE dep(oid) AS (
    SELECT 'public.mv_treemap_outcomes'::regclass::oid
    UNION
    SELECT r.ev_class FROM dep d
    JOIN pg_depend pd ON pd.refobjid = d.oid AND pd.classid = 'pg_rewrite'::regclass
    JOIN pg_rewrite r ON r.oid = pd.objid
    WHERE r.ev_class <> d.oid
  )
  SELECT array_agg(c.relname::text ORDER BY c.relname) INTO v_chain
  FROM dep JOIN pg_class c ON c.oid = dep.oid
  WHERE c.oid <> 'public.mv_treemap_outcomes'::regclass AND c.relname !~ '_v2$';
  IF v_chain IS DISTINCT FROM ARRAY['mv_brand_market', 'mv_family_market', 'mv_family_sales', 'mv_family_year_prices',
                                     'mv_treemap_sale_brands', 'mv_treemap_sale_models'] THEN
    RAISE EXCEPTION 'the views reading mv_treemap_outcomes are %, not the six this was written for', v_chain;
  END IF;
  -- The copied views read no other view of the chain than the ones repointed below.
  SELECT string_agg(DISTINCT c.relname || ' reads ' || p.relname, ', ') INTO v_reads
  FROM pg_class c
  JOIN pg_rewrite r ON r.ev_class = c.oid
  JOIN pg_depend pd ON pd.objid = r.oid AND pd.classid = 'pg_rewrite'::regclass
  JOIN pg_class p ON p.oid = pd.refobjid AND p.oid <> c.oid AND p.relkind IN ('m', 'v')
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relname IN ('mv_treemap_sale_brands', 'mv_treemap_sale_models', 'mv_brand_market', 'mv_family_market', 'mv_family_sales',
                      'mv_family_year_prices')
    AND p.relname NOT IN ('mv_treemap_outcomes', 'mv_family_market', 'mv_model_family_names');
  IF v_reads IS NOT NULL THEN
    RAISE EXCEPTION 'a copied view reads a view this does not repoint: %', v_reads;
  END IF;
END $guard$;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_treemap_outcomes_v2 AS
SELECT s.id,
       s.brand_name,
       s.model,
       s.year,
       public.market_venue_label(s.auction_source, s.canonical_platform) AS source_name,
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
         v.canonical_platform, v.sale_status, v.auction_outcome, v.reserve_status,
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
WITH NO DATA;

-- The six dependents, from their live definitions, reading the copies (parents first).
DO $copies$
DECLARE
  v text;
  def text;
BEGIN
  FOREACH v IN ARRAY ARRAY['mv_treemap_sale_brands', 'mv_treemap_sale_models', 'mv_brand_market', 'mv_family_market',
                           'mv_family_sales', 'mv_family_year_prices'] LOOP
    CONTINUE WHEN to_regclass(format('public.%I', v || '_v2')) IS NOT NULL;
    def := pg_get_viewdef(format('public.%I', v)::regclass);
    def := regexp_replace(def, '\mmv_treemap_outcomes\M', 'mv_treemap_outcomes_v2', 'g');
    def := regexp_replace(def, '\mmv_family_market\M', 'mv_family_market_v2', 'g');
    def := regexp_replace(def, ';\s*$', '');
    EXECUTE format('CREATE MATERIALIZED VIEW public.%I AS %s WITH NO DATA', v || '_v2', def);
  END LOOP;
END $copies$;

-- Indexes (named <index>_v2), grants and comments: each copy as its live view has them.
DO $alike$
DECLARE
  v text;
  ix record;
  ddl text;
  g record;
BEGIN
  FOREACH v IN ARRAY ARRAY['mv_treemap_outcomes', 'mv_treemap_sale_brands', 'mv_treemap_sale_models', 'mv_brand_market',
                           'mv_family_market', 'mv_family_sales', 'mv_family_year_prices'] LOOP
    FOR ix IN
      SELECT ic.relname AS name, pg_get_indexdef(i.indexrelid) AS def
      FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
      WHERE i.indrelid = format('public.%I', v)::regclass
    LOOP
      CONTINUE WHEN to_regclass(format('public.%I', ix.name || '_v2')) IS NOT NULL;
      ddl := replace(ix.def, format(' INDEX %s ON public.%s ', quote_ident(ix.name), quote_ident(v)),
                             format(' INDEX %s ON public.%s ', quote_ident(ix.name || '_v2'), quote_ident(v || '_v2')));
      IF ddl = ix.def THEN
        RAISE EXCEPTION 'could not name the copy of index % (%)', ix.name, ix.def;
      END IF;
      EXECUTE ddl;
    END LOOP;

    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', v || '_v2');
    FOR g IN
      SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END AS grantee,
             a.privilege_type
      FROM pg_class c, aclexplode(c.relacl) a
      WHERE c.oid = format('public.%I', v)::regclass AND a.grantee <> c.relowner
    LOOP
      EXECUTE format('GRANT %s ON public.%I TO %s', g.privilege_type, v || '_v2', g.grantee);
    END LOOP;

    EXECUTE format('COMMENT ON MATERIALIZED VIEW public.%I IS %L', v || '_v2',
      coalesce(obj_description(format('public.%I', v)::regclass, 'pg_class'), '')
      || CASE WHEN v = 'mv_treemap_outcomes'
              THEN ' source_name = market_venue_label(auction_source, canonical_platform) (20261016153000).' ELSE '' END);
  END LOOP;
END $alike$;

CREATE OR REPLACE FUNCTION public.market_venue_v2_fill(p_now timestamptz DEFAULT now())
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  t time := (p_now AT TIME ZONE 'UTC')::time;
  v text;
  t0 timestamptz;
BEGIN
  IF t >= '09:00' AND t < '10:20' THEN
    RETURN 'skipped: treemap_refresh_all and the family folds run 09:00-10:20Z';
  END IF;
  IF t >= '18:30' AND t < '19:30' THEN
    RETURN 'skipped: refresh-family-year-prices runs 18:40Z';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext('market_venue_v2_fill')) THEN
    RETURN 'skipped: a fill is running';
  END IF;
  IF (SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock') >= 10 THEN
    RETURN 'skipped: 10 or more sessions wait on a lock';
  END IF;
  -- Parents before the views that read them; one view per call.
  FOREACH v IN ARRAY ARRAY['mv_treemap_outcomes_v2', 'mv_treemap_sale_brands_v2', 'mv_treemap_sale_models_v2',
                           'mv_brand_market_v2', 'mv_family_market_v2', 'mv_family_sales_v2', 'mv_family_year_prices_v2'] LOOP
    CONTINUE WHEN to_regclass(format('public.%I', v)) IS NULL;
    CONTINUE WHEN (SELECT relispopulated FROM pg_class WHERE oid = format('public.%I', v)::regclass);
    IF v = 'mv_family_year_prices_v2' THEN
      IF t >= '09:00' AND t < '19:30' THEN
        RETURN 'waiting: mv_family_year_prices_v2 fills 19:30-09:00Z';
      END IF;
      -- refresh_family_year_prices' settings (20261016015000): one sequential pass of vehicles.
      PERFORM set_config('enable_nestloop', 'off', true), set_config('random_page_cost', '4', true),
              set_config('work_mem', '32MB', true);
    END IF;
    t0 := clock_timestamp();
    EXECUTE format('REFRESH MATERIALIZED VIEW public.%I', v);
    RETURN format('filled %s in %s s', v, round(extract(epoch FROM clock_timestamp() - t0)::numeric, 1));
  END LOOP;
  RETURN 'all filled';
END $function$;

REVOKE ALL ON FUNCTION public.market_venue_v2_fill(timestamptz) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.market_venue_v2_fill(timestamptz) IS
  'Fills the next unfilled _v2 copy of the map''s chain (20261016153000), one view per call, outside the chain''s refresh windows. Called by job market-venue-v2-fill until the rename swap.';

DO $job$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'market-venue-v2-fill') THEN
    PERFORM cron.schedule('market-venue-v2-fill', '*/10 * * * *',
      $cmd$SET statement_timeout = '20min'; SELECT public.market_venue_v2_fill()$cmd$);
  END IF;
END $job$;

COMMIT;
