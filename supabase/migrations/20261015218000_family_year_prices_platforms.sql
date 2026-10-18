-- mv_family_year_prices pools badge-engineered twins: a platform's families share one price record per model year.
--
-- The owner's acceptance case (2026-10-15): a 1995 GMC K1500 asking $3,500 had 6 recorded sales across 1990-2000, so
-- no position, while the same truck sells under the Chevrolet badge. canonical_models.platform (skylar-83, #1432,
-- deployed 06:55Z) names 13 GM platforms over 30 families (gm-k1500: Chevrolet and GMC K1500; gm-k5-blazer-jimmy;
-- gm-suburban; gm-silverado-sierra; ...). The fold now pools prices, windows, venues and odometers by platform when the
-- family's canonical row names one, and by the family alone otherwise; it still emits one row per family (the key is
-- unchanged), each pooled row naming its platform. The conflict guard stays per family (a page must name a phrase of
-- the sale's own family). by_source and venues say which badge's venues the pooled prices came from.
--   platform   text, null when the family pools alone.
-- The view is still unbuilt (its first build is the 09:40 UTC cron) and nothing depends on it, so it is replaced, as
-- 20261015215000 did; the guard refuses once it holds data without platform. Same name, key, grants, refresh function
-- and cron job; created WITH NO DATA again.
-- Contract: supabase/sql/test_family_year_prices.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL enable_nestloop = off;

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.mv_family_year_prices') AND attname = 'venues') THEN
    RAISE EXCEPTION 'apply 20261015215000_family_year_prices_venues.sql first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.canonical_models'::regclass AND attname = 'platform') THEN
    RAISE EXCEPTION 'canonical_models.platform is missing (skylar-83, #1432)';
  END IF;
  IF (SELECT relispopulated FROM pg_class WHERE oid = 'public.mv_family_year_prices'::regclass)
     AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.mv_family_year_prices'::regclass AND attname = 'platform') THEN
    RAISE EXCEPTION 'mv_family_year_prices has been built; not replacing a populated view';
  END IF;
END $guard$;

DO $replace$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.mv_family_year_prices'::regclass AND attname = 'platform') THEN
    DROP MATERIALIZED VIEW public.mv_family_year_prices;
  END IF;
END $replace$;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_family_year_prices AS
WITH sold AS (
  SELECT 'sold'::text AS basis, o.year, o.sold_amount AS price, o.outcome, coalesce(o.source_name, 'Other') AS source,
         coalesce(v.sale_date, v.bat_sale_date) AS priced_on, lower(v.make) AS make_l, lower(coalesce(v.model, '')) AS model_l,
         coalesce(v.listing_url, v.discovery_url) AS page, v.mileage AS miles
  FROM public.mv_treemap_outcomes o
  JOIN public.vehicles v ON v.id = o.id
  WHERE o.year IS NOT NULL
), asked AS (
  SELECT DISTINCT ON (a.vehicle_id) 'asked'::text AS basis, v.year, a.price, NULL::text AS outcome, a.source,
         a.priced_on, lower(v.make) AS make_l, lower(coalesce(v.model, '')) AS model_l, NULL::text AS page,
         coalesce(a.miles, v.mileage) AS miles
  FROM (
    SELECT m.vehicle_id, m.price::numeric AS price, 'Facebook Marketplace' AS source, m.first_seen_at::date AS priced_on,
           m.first_seen_at AS seen_at, m.mileage AS miles
    FROM public.marketplace_listings m
    WHERE m.vehicle_id IS NOT NULL AND m.price > 0 AND coalesce(m.status, '') NOT IN ('duplicate', 'blocked')
      AND m.first_seen_at >= current_date - 365 AND m.first_seen_at < current_date
    UNION ALL
    SELECT e.vehicle_id, e.current_price,
           CASE e.source_platform WHEN 'craigslist' THEN 'Craigslist' WHEN 'ksl' THEN 'KSL' ELSE 'Facebook Marketplace' END,
           e.created_at::date, e.created_at, NULL::integer
    FROM public.vehicle_events e
    WHERE e.source_platform IN ('craigslist', 'facebook_marketplace', 'ksl') AND e.vehicle_id IS NOT NULL
      AND e.current_price > 0 AND e.created_at >= current_date - 365 AND e.created_at < current_date
  ) a
  JOIN public.vehicles v ON v.id = a.vehicle_id AND v.deleted_at IS NULL AND v.is_public IS TRUE
    AND (v.listing_kind IS NULL OR v.listing_kind <> 'non_vehicle_item') AND v.year IS NOT NULL
  ORDER BY a.vehicle_id, a.seen_at DESC
), words AS (
  -- Every phrase that names a family: its canonical_models rows (the family_id row and its duplicates of the same make
  -- and model name, as mv_model_family_names merges them), their model name and aliases ("cuda", "vette", "sting ray"),
  -- three characters or more, lower case with punctuation as spaces.
  SELECT f.family_id, array_agg(DISTINCT w) AS words
  FROM (SELECT DISTINCT family_id FROM public.mv_model_family_names WHERE family_id IS NOT NULL) f
  JOIN public.canonical_models m0 ON m0.id = f.family_id
  JOIN public.canonical_models m ON lower(m.canonical_model) = lower(m0.canonical_model)
    AND regexp_replace(lower(m.make), '[^a-z0-9]', '', 'g') = regexp_replace(lower(m0.make), '[^a-z0-9]', '', 'g')
  CROSS JOIN LATERAL unnest(array_append(coalesce(m.aliases, '{}'::text[]), m.canonical_model)) a(x)
  CROSS JOIN LATERAL (SELECT btrim(regexp_replace(lower(a.x), '[^a-z0-9]+', ' ', 'g')) AS w) n
  WHERE length(n.w) >= 3
  GROUP BY f.family_id
), pool AS (
  -- The pooling key: a badge-engineered platform (canonical_models.platform, e.g. gm-k1500 for the Chevrolet and GMC
  -- K1500) pools its families' prices; any other family pools alone.
  SELECT f.family_id, nullif(btrim(m.platform), '') AS platform,
         coalesce('platform:' || nullif(btrim(m.platform), ''), 'family:' || f.family_id::text) AS pool
  FROM (SELECT DISTINCT family_id FROM public.mv_model_family_names WHERE family_id IS NOT NULL) f
  LEFT JOIN public.canonical_models m ON m.id = f.family_id
), named AS (
  SELECT x.basis, n.family_id, pl.pool, x.year, x.price, x.outcome, x.source, x.priced_on, x.miles,
         array_append(coalesce(wd.words, '{}'::text[]), n.matched) AS words,
         ' ' || btrim(regexp_replace(lower(regexp_replace(x.page, '^.*/([^/]+)/?$', '\1')), '[^a-z0-9]+', ' ', 'g')) || ' ' AS slug
  FROM (SELECT * FROM sold UNION ALL SELECT * FROM asked) x
  JOIN public.mv_model_family_names n ON n.make_l = x.make_l AND n.model_l = x.model_l
  LEFT JOIN words wd ON wd.family_id = n.family_id
  JOIN pool pl ON pl.family_id = n.family_id
  WHERE n.family_id IS NOT NULL
    AND (n.year_start IS NULL OR x.year >= n.year_start - 1)
    AND (n.year_end IS NULL OR x.year <= n.year_end + 1)
), p AS (
  -- A sale whose own page names its model year but no phrase of its family is another car recorded under this name
  -- (2026-10-15: 34 of 469 recorded 1967 Corvette sales were Camaros, Chevelles, Impalas, C10s, a Nova and El Caminos by
  -- their pages). Its price is not pooled; it is counted in conflicts. Phrases are compared with and without spaces
  -- ("sting ray" / "stingray", "f 150" / "f150").
  SELECT basis, pool, year, price, outcome, source, priced_on,
    CASE WHEN miles > 0 AND miles < 2000000 THEN miles END AS miles,
    coalesce(basis = 'sold' AND slug LIKE '% ' || year || ' %'
             AND NOT EXISTS (SELECT 1 FROM unnest(words) w
                             WHERE position(' ' || w || ' ' IN slug) > 0
                                OR position(replace(w, ' ', '') IN replace(slug, ' ', '')) > 0), false) AS conflict
  FROM named
), yr AS (
  -- Per family, model year and basis first, so a window pools at most 11 small rows, never every price of a family.
  SELECT basis, pool, year,
    count(*) FILTER (WHERE price > 0 AND NOT conflict) AS n,
    count(*) FILTER (WHERE NOT conflict) AS offered,
    count(*) FILTER (WHERE conflict) AS conflicts,
    array_agg(price ORDER BY price) FILTER (WHERE price > 0 AND NOT conflict) AS prices,
    array_agg(source ORDER BY price) FILTER (WHERE price > 0 AND NOT conflict) AS sources,
    array_agg(miles) FILTER (WHERE price > 0 AND NOT conflict AND miles IS NOT NULL) AS miles,
    count(*) FILTER (WHERE price > 0 AND NOT conflict AND priced_on IS NOT NULL) AS dated,
    min(priced_on) FILTER (WHERE price > 0 AND NOT conflict) AS first_on,
    max(priced_on) FILTER (WHERE price > 0 AND NOT conflict) AS last_on,
    count(*) FILTER (WHERE price > 0 AND NOT conflict AND priced_on > current_date - 730 AND priced_on <= current_date) AS n_24m
  FROM p GROUP BY 1, 2, 3
), t AS (
  SELECT DISTINCT basis, pool, year + d AS year FROM yr, generate_series(-5, 5) d WHERE yr.n > 0
), tw AS (
  -- The narrowest window holding 10 prices; 5 years when none does.
  SELECT t.basis, t.pool, t.year,
    CASE WHEN coalesce(sum(yr.n) FILTER (WHERE yr.year = t.year), 0) >= 10 THEN 0
         WHEN coalesce(sum(yr.n) FILTER (WHERE abs(yr.year - t.year) <= 1), 0) >= 10 THEN 1
         WHEN coalesce(sum(yr.n) FILTER (WHERE abs(yr.year - t.year) <= 2), 0) >= 10 THEN 2
         WHEN coalesce(sum(yr.n) FILTER (WHERE abs(yr.year - t.year) <= 3), 0) >= 10 THEN 3
         ELSE 5 END AS w
  FROM t
  JOIN yr ON yr.basis = t.basis AND yr.pool = t.pool AND yr.year BETWEEN t.year - 5 AND t.year + 5
  GROUP BY t.basis, t.pool, t.year
), mx AS (
  -- The odometer readings of the same priced rows (1 .. 1,999,999 miles; a zero or missing reading is unknown), pooled
  -- over the same window, so a reader can say where a listing's miles sit among them.
  SELECT tw.basis, tw.pool, tw.year, array_agg(m ORDER BY m) AS miles
  FROM tw
  JOIN yr ON yr.basis = tw.basis AND yr.pool = tw.pool AND yr.year BETWEEN tw.year - tw.w AND tw.year + tw.w
  CROSS JOIN LATERAL unnest(yr.miles) m
  GROUP BY tw.basis, tw.pool, tw.year
), vs AS (
  -- Each venue's own middle inside the window: count per source, and its median once it has 5 prices.
  SELECT tw.basis, tw.pool, tw.year, u.s AS source, count(*)::integer AS n,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY u.x::float8) AS p50
  FROM tw
  JOIN yr ON yr.basis = tw.basis AND yr.pool = tw.pool AND yr.year BETWEEN tw.year - tw.w AND tw.year + tw.w
  CROSS JOIN LATERAL unnest(yr.prices, yr.sources) u(x, s)
  GROUP BY tw.basis, tw.pool, tw.year, u.s
), vsj AS (
  SELECT basis, pool, year,
    jsonb_object_agg(source, jsonb_build_object('n', n, 'p50', CASE WHEN n >= 5 THEN round(p50)::integer END) ORDER BY source) AS venues
  FROM vs GROUP BY basis, pool, year
), agg AS (
  -- One aggregate over the window's year rows and their prices: a year row's own counts are taken once (i = 1), and a
  -- year with no admitted price still contributes its offered and conflict counts (one null price row).
  SELECT tw.basis, tw.pool, tw.year, tw.w,
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
  JOIN yr ON yr.basis = tw.basis AND yr.pool = tw.pool AND yr.year BETWEEN tw.year - tw.w AND tw.year + tw.w
  CROSS JOIN LATERAL unnest(coalesce(yr.prices, ARRAY[NULL::numeric]), coalesce(yr.sources, ARRAY[NULL::text]))
    WITH ORDINALITY u(x, s, i)
  GROUP BY tw.basis, tw.pool, tw.year, tw.w
)
SELECT pm.family_id, a.year, a.basis, a.year - a.w AS year_from, a.year + a.w AS year_to, pm.platform,
  a.n, CASE WHEN a.basis = 'sold' THEN a.offered END AS offered, CASE WHEN a.basis = 'sold' THEN a.conflicts END AS conflicts,
  a.n < 10 AS thin,
  CASE WHEN a.n >= 10 THEN round(a.q[1])::integer END AS p10,
  CASE WHEN a.n >= 10 THEN round(a.q[2])::integer END AS p25,
  CASE WHEN a.n >= 10 THEN round(a.q[3])::integer END AS p50,
  CASE WHEN a.n >= 10 THEN round(a.q[4])::integer END AS p75,
  CASE WHEN a.n >= 10 THEN round(a.q[5])::integer END AS p90,
  a.prices, a.dated, a.first_on, a.last_on, a.n_24m,
  coalesce(cardinality(x.miles), 0) AS n_miles, coalesce(x.miles, '{}'::integer[]) AS miles,
  CASE WHEN cardinality(x.miles) >= 10 THEN x.miles[(cardinality(x.miles) + 1) / 2] END AS miles_p50,
  (SELECT coalesce(jsonb_object_agg(z.s, z.c ORDER BY z.s), '{}'::jsonb)
   FROM (SELECT s, count(*)::integer AS c FROM unnest(a.sources) s GROUP BY s) z) AS by_source,
  coalesce(vj.venues, '{}'::jsonb) AS venues,
  now() AS as_of
FROM agg a
JOIN pool pm ON pm.pool = a.pool
LEFT JOIN mx x ON x.basis = a.basis AND x.pool = a.pool AND x.year = a.year
LEFT JOIN vsj vj ON vj.basis = a.basis AND vj.pool = a.pool AND vj.year = a.year
WHERE a.n > 0
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_family_year_prices_key ON public.mv_family_year_prices (family_id, year, basis);
REVOKE ALL ON public.mv_family_year_prices FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mv_family_year_prices TO anon, authenticated, service_role;
COMMENT ON MATERIALIZED VIEW public.mv_family_year_prices IS
  'One row per factory model family (mv_model_family_names.family_id), model year and basis: sold = recorded sales '
  '(mv_treemap_outcomes, sold_amount > 0; offered = all recorded outcomes; conflicts = sales whose own page is another '
  'car), asked = classified asks first seen in the 365 days before the refresh day (Facebook Marketplace, Craigslist, '
  'KSL; one per vehicle, latest). Pools the narrowest of 0/1/2/3/5 model years either side holding 10 prices '
  '(year_from..year_to); thin = fewer than 10 at 5 years, no percentiles. prices = the pooled prices, sorted, whole '
  'dollars as recorded (currency not converted); miles = the same rows'' stated odometer readings, sorted (n_miles, '
  'miles_p50); venues = each source''s count and median (5 prices or more) in the window. Refreshed daily by cron job '
  'refresh-family-year-prices. Families of one canonical_models.platform pool their prices (platform names it).';

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.mv_family_year_prices'::regclass AND attname = 'platform')
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-family-year-prices') THEN
    RAISE EXCEPTION 'mv_family_year_prices did not gain platform, or its refresh is not scheduled';
  END IF;
END $check$;

COMMIT;
