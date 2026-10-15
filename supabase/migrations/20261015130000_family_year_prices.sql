-- mv_family_year_prices: what each factory model family has sold for, and been asked for, around each model year.
--
-- Skylar, 2026-10-15: the arrivals feed is led by Craigslist "not cuz its good but cuz its easy". A listing should rise
-- by what it is, defined in keys and folds with citation, so a 1967 Corvette asking $22K reads differently from a 1971
-- Buick asking $5,500 without anyone's taste in the code. The first fact that separates them is the family's own price
-- record: how many of that car have sold, for what, and where an ask sits among them.
--
-- Key: mv_model_family_names.family_id (20261015090000: public make and model names resolved to canonical_models;
-- 494,210 of 681,551 public vehicles keyed on 2026-10-15 04:02Z). A family whose year range excludes the vehicle (one
-- year of slack) does not claim it, as in mv_family_market.
--
-- Grain: one row per (family_id, model year, basis).
--   basis 'sold'   recorded sales: mv_treemap_outcomes rows with sold_amount > 0 (its sale_basis rules), all dates.
--                  offered = every recorded outcome, sold or not, so sold / offered is the family's sell-through.
--                  A sale whose own page (listing_url, else discovery_url) names the model year but not the family's
--                  matched phrase is another car recorded under the name: it is left out and counted in conflicts.
--   basis 'asked'  classified asking prices first seen in the 365 days before the refresh day: Facebook Marketplace
--                  (marketplace_listings, one per listing) and Craigslist, KSL and Facebook listing events
--                  (vehicle_events), one ask per vehicle, its latest. An ask is not a sale and is never pooled with one.
-- Year window: each row pools the narrowest of 0, 1, 2, 3 or 5 model years either side that holds 10 prices of its basis
-- (year_from .. year_to); with fewer than 10 even at 5 years, the row keeps what it found and thin = true, and a reader
-- gives no position. The window crosses generations when it has to; the row says how wide it went.
-- Columns per row: the pooled count, p10/p25/p50/p75/p90 (percentile_cont; null when thin), prices (sorted ascending,
-- whole dollars as recorded, currency not converted) so a reader can say how many sit at or below an ask, the dated
-- count and first/last date, the count in the last 24 months, by_source (count per venue) and as_of.
-- Readers: classified_ask_board (next migration) reads one row per listing; anon reads the fold (prices are already
-- public on the listings and sale pages; no seller, buyer or vehicle id is stored).
-- Refreshed daily at 09:40 UTC (after treemap_refresh_all at 09:10 and mv_model_family_names at 04:05), CONCURRENTLY,
-- by refresh_family_year_prices() (service role only).
-- Contract: supabase/sql/test_family_year_prices.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '300s';
SET LOCAL lock_timeout = '5s';
-- The family join is estimated at 1 row (it is ~400,000), and with nested loops the planner then pairs every year row
-- with every target year (EXPLAIN on production, 2026-10-15: a 0.5% sample ran past 10 s). Without them it reads
-- vehicles once (parallel seq scan, as mv_treemap_outcomes does nightly) and merge-joins on the family; the same query
-- over 170,252 sales and 111,553 asks took 0.84 s on PostgreSQL 17 locally. refresh_family_year_prices() does the same.
SET LOCAL enable_nestloop = off;

DO $guard$
BEGIN
  IF to_regclass('public.mv_model_family_names') IS NULL THEN
    RAISE EXCEPTION 'mv_model_family_names is missing; apply 20261015090000_model_family_names.sql first';
  END IF;
END $guard$;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_family_year_prices AS
WITH sold AS (
  SELECT 'sold'::text AS basis, o.year, o.sold_amount AS price, o.outcome, coalesce(o.source_name, 'Other') AS source,
         coalesce(v.sale_date, v.bat_sale_date) AS priced_on, lower(v.make) AS make_l, lower(coalesce(v.model, '')) AS model_l,
         coalesce(v.listing_url, v.discovery_url) AS page
  FROM public.mv_treemap_outcomes o
  JOIN public.vehicles v ON v.id = o.id
  WHERE o.year IS NOT NULL
), asked AS (
  SELECT DISTINCT ON (a.vehicle_id) 'asked'::text AS basis, v.year, a.price, NULL::text AS outcome, a.source,
         a.priced_on, lower(v.make) AS make_l, lower(coalesce(v.model, '')) AS model_l, NULL::text AS page
  FROM (
    SELECT m.vehicle_id, m.price::numeric AS price, 'Facebook Marketplace' AS source, m.first_seen_at::date AS priced_on,
           m.first_seen_at AS seen_at
    FROM public.marketplace_listings m
    WHERE m.vehicle_id IS NOT NULL AND m.price > 0 AND coalesce(m.status, '') NOT IN ('duplicate', 'blocked')
      AND m.first_seen_at >= current_date - 365 AND m.first_seen_at < current_date
    UNION ALL
    SELECT e.vehicle_id, e.current_price,
           CASE e.source_platform WHEN 'craigslist' THEN 'Craigslist' WHEN 'ksl' THEN 'KSL' ELSE 'Facebook Marketplace' END,
           e.created_at::date, e.created_at
    FROM public.vehicle_events e
    WHERE e.source_platform IN ('craigslist', 'facebook_marketplace', 'ksl') AND e.vehicle_id IS NOT NULL
      AND e.current_price > 0 AND e.created_at >= current_date - 365 AND e.created_at < current_date
  ) a
  JOIN public.vehicles v ON v.id = a.vehicle_id AND v.deleted_at IS NULL AND v.is_public IS TRUE
    AND (v.listing_kind IS NULL OR v.listing_kind <> 'non_vehicle_item') AND v.year IS NOT NULL
  ORDER BY a.vehicle_id, a.seen_at DESC
), named AS (
  SELECT x.basis, n.family_id, x.year, x.price, x.outcome, x.source, x.priced_on, n.matched,
         ' ' || btrim(regexp_replace(lower(regexp_replace(x.page, '^.*/([^/]+)/?$', '\1')), '[^a-z0-9]+', ' ', 'g')) || ' ' AS slug
  FROM (SELECT * FROM sold UNION ALL SELECT * FROM asked) x
  JOIN public.mv_model_family_names n ON n.make_l = x.make_l AND n.model_l = x.model_l
  WHERE n.family_id IS NOT NULL
    AND (n.year_start IS NULL OR x.year >= n.year_start - 1)
    AND (n.year_end IS NULL OR x.year <= n.year_end + 1)
), p AS (
  -- A sale whose own page names its model year but not the family's phrase is another car recorded under this name
  -- (2026-10-15: 34 of 469 recorded 1967 Corvette sales were Camaros, Chevelles, Impalas, C10s, a Nova and El Caminos by
  -- their pages). Its price is not pooled; it is counted in conflicts.
  SELECT basis, family_id, year, price, outcome, source, priced_on,
    coalesce(basis = 'sold' AND slug LIKE '% ' || year || ' %'
             AND position(' ' || matched || ' ' IN slug) = 0
             AND position(replace(matched, ' ', '') IN replace(slug, ' ', '')) = 0, false) AS conflict
  FROM named
), yr AS (
  -- Per family, model year and basis first, so a window pools at most 11 small rows, never every price of a family.
  SELECT basis, family_id, year,
    count(*) FILTER (WHERE price > 0 AND NOT conflict) AS n,
    count(*) FILTER (WHERE NOT conflict) AS offered,
    count(*) FILTER (WHERE conflict) AS conflicts,
    array_agg(price ORDER BY price) FILTER (WHERE price > 0 AND NOT conflict) AS prices,
    array_agg(source ORDER BY price) FILTER (WHERE price > 0 AND NOT conflict) AS sources,
    count(*) FILTER (WHERE price > 0 AND NOT conflict AND priced_on IS NOT NULL) AS dated,
    min(priced_on) FILTER (WHERE price > 0 AND NOT conflict) AS first_on,
    max(priced_on) FILTER (WHERE price > 0 AND NOT conflict) AS last_on,
    count(*) FILTER (WHERE price > 0 AND NOT conflict AND priced_on > current_date - 730 AND priced_on <= current_date) AS n_24m
  FROM p GROUP BY 1, 2, 3
), t AS (
  SELECT DISTINCT basis, family_id, year + d AS year FROM yr, generate_series(-5, 5) d WHERE yr.n > 0
), tw AS (
  -- The narrowest window holding 10 prices; 5 years when none does.
  SELECT t.basis, t.family_id, t.year,
    CASE WHEN coalesce(sum(yr.n) FILTER (WHERE yr.year = t.year), 0) >= 10 THEN 0
         WHEN coalesce(sum(yr.n) FILTER (WHERE abs(yr.year - t.year) <= 1), 0) >= 10 THEN 1
         WHEN coalesce(sum(yr.n) FILTER (WHERE abs(yr.year - t.year) <= 2), 0) >= 10 THEN 2
         WHEN coalesce(sum(yr.n) FILTER (WHERE abs(yr.year - t.year) <= 3), 0) >= 10 THEN 3
         ELSE 5 END AS w
  FROM t
  JOIN yr ON yr.basis = t.basis AND yr.family_id = t.family_id AND yr.year BETWEEN t.year - 5 AND t.year + 5
  GROUP BY t.basis, t.family_id, t.year
), agg AS (
  -- One aggregate over the window's year rows and their prices: a year row's own counts are taken once (i = 1), and a
  -- year with no admitted price still contributes its offered and conflict counts (one null price row).
  SELECT tw.basis, tw.family_id, tw.year, tw.w,
    count(u.x)::integer AS n,
    sum(yr.offered) FILTER (WHERE u.i = 1)::integer AS offered,
    sum(yr.conflicts) FILTER (WHERE u.i = 1)::integer AS conflicts,
    sum(yr.dated) FILTER (WHERE u.i = 1)::integer AS dated,
    min(yr.first_on) AS first_on, max(yr.last_on) AS last_on,
    sum(yr.n_24m) FILTER (WHERE u.i = 1)::integer AS n_24m,
    percentile_cont(ARRAY[0.1, 0.25, 0.5, 0.75, 0.9]) WITHIN GROUP (ORDER BY u.x::float8) AS q,
    array_agg(round(u.x)::integer ORDER BY u.x) FILTER (WHERE u.x IS NOT NULL) AS prices,
    array_agg(u.s) FILTER (WHERE u.x IS NOT NULL) AS sources
  FROM tw
  JOIN yr ON yr.basis = tw.basis AND yr.family_id = tw.family_id AND yr.year BETWEEN tw.year - tw.w AND tw.year + tw.w
  CROSS JOIN LATERAL unnest(coalesce(yr.prices, ARRAY[NULL::numeric]), coalesce(yr.sources, ARRAY[NULL::text]))
    WITH ORDINALITY u(x, s, i)
  GROUP BY tw.basis, tw.family_id, tw.year, tw.w
)
SELECT a.family_id, a.year, a.basis, a.year - a.w AS year_from, a.year + a.w AS year_to,
  a.n, CASE WHEN a.basis = 'sold' THEN a.offered END AS offered, CASE WHEN a.basis = 'sold' THEN a.conflicts END AS conflicts,
  a.n < 10 AS thin,
  CASE WHEN a.n >= 10 THEN round(a.q[1])::integer END AS p10,
  CASE WHEN a.n >= 10 THEN round(a.q[2])::integer END AS p25,
  CASE WHEN a.n >= 10 THEN round(a.q[3])::integer END AS p50,
  CASE WHEN a.n >= 10 THEN round(a.q[4])::integer END AS p75,
  CASE WHEN a.n >= 10 THEN round(a.q[5])::integer END AS p90,
  a.prices, a.dated, a.first_on, a.last_on, a.n_24m,
  (SELECT coalesce(jsonb_object_agg(z.s, z.c ORDER BY z.s), '{}'::jsonb)
   FROM (SELECT s, count(*)::integer AS c FROM unnest(a.sources) s GROUP BY s) z) AS by_source,
  now() AS as_of
FROM agg a
WHERE a.n > 0;

CREATE UNIQUE INDEX IF NOT EXISTS mv_family_year_prices_key ON public.mv_family_year_prices (family_id, year, basis);
REVOKE ALL ON public.mv_family_year_prices FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mv_family_year_prices TO anon, authenticated, service_role;
COMMENT ON MATERIALIZED VIEW public.mv_family_year_prices IS
  'One row per factory model family (mv_model_family_names.family_id), model year and basis: sold = recorded sales '
  '(mv_treemap_outcomes, sold_amount > 0; offered = all recorded outcomes), asked = classified asks first seen in the 365 '
  'days before the refresh day (Facebook Marketplace, Craigslist, KSL; one per vehicle, latest). Pools the narrowest of '
  '0/1/2/3/5 model years either side holding 10 prices (year_from..year_to); thin = fewer than 10 at 5 years, no '
  'percentiles. prices = the pooled prices, sorted, whole dollars as recorded (currency not converted). Refreshed daily '
  'by cron job refresh-family-year-prices.';

CREATE OR REPLACE FUNCTION public.refresh_family_year_prices()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
 SET enable_nestloop TO 'off'
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_year_prices;
END $function$;
REVOKE ALL ON FUNCTION public.refresh_family_year_prices() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_family_year_prices() TO service_role;
COMMENT ON FUNCTION public.refresh_family_year_prices() IS
  'Refreshes mv_family_year_prices CONCURRENTLY without nested loops (see its migration, 20261015130000). Cron job '
  'refresh-family-year-prices, daily 09:40 UTC. Not callable by anon or authenticated.';

DO $job$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-family-year-prices') THEN
    PERFORM cron.schedule('refresh-family-year-prices', '40 9 * * *',
      'SET statement_timeout = ''300s''; SELECT public.refresh_family_year_prices()');
  END IF;
END $job$;

DO $check$
BEGIN
  IF NOT (SELECT relispopulated FROM pg_class WHERE oid = 'public.mv_family_year_prices'::regclass) THEN
    RAISE EXCEPTION 'mv_family_year_prices is not populated';
  END IF;
END $check$;

COMMIT;
