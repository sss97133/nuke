-- market_sources_read: count a source's live lots when their monitor was read within 24 hours, not 2.
--
-- Measured 2026-10-16 00:0xZ (prod, read-only): of 1,281 BaT monitors live with a future end, 339 were read in the last
-- 2 hours and all 1,281 in the last 24 (lots far from their close are read about daily), so the board showed 339 live
-- BaT lots against the live board's 1,281. Monitors left live since February (Cars & Bids, Collecting Cars, PCarMarket,
-- SBX) have ends in the past and stay out on the future-end test. Only the window changes.
-- Contract: supabase/sql/test_market_sources_board.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.market_sources_read()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH d AS (
    SELECT max(day) AS day FROM public.market_source_days
  ), cur AS (
    SELECT m.* FROM public.market_source_days m JOIN d ON m.day = d.day
  ), ago AS (
    SELECT DISTINCT ON (m.source_slug) m.source_slug, m.day, m.landed_lots
    FROM public.market_source_days m CROSS JOIN d
    WHERE m.day <= d.day - 7
    ORDER BY m.source_slug, m.day DESC
  ), live AS (
    SELECT regexp_replace(lower(s.slug), '[^a-z0-9]', '', 'g') AS nslug,
           count(*) FILTER (WHERE m.is_live AND m.auction_end_time > now() AND m.updated_at > now() - interval '24 hours')
             AS live_lots,
           max(m.updated_at) FILTER (WHERE m.is_live AND m.auction_end_time > now()) AS live_at
    FROM public.live_auction_sources s
    JOIN public.monitored_auctions m ON m.source_id = s.id
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'as_of', now(),
    'day', (SELECT day FROM d),
    'columns', jsonb_build_array('source', 'name', 'category', 'house', 'held_lots', 'held_at', 'population',
                                 'population_method', 'population_confidence', 'population_at', 'map_sales', 'map_usd',
                                 'sales_12m', 'usd_12m', 'sales_prior_12m', 'usd_prior_12m', 'months', 'live_lots', 'live_at',
                                 'held_lots_before', 'before_day'),
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_array(c.source_slug, c.display_name, c.category, c.house, c.landed_lots, c.landed_at,
                                         c.population, c.population_method, c.population_confidence, c.population_at,
                                         c.map_sales, c.map_usd, c.sales_12m, c.usd_12m, c.sales_prior_12m, c.usd_prior_12m,
                                         c.months, coalesce(l.live_lots, 0), l.live_at, a.landed_lots, a.day)
                       ORDER BY c.landed_lots DESC NULLS LAST, c.sales_12m DESC NULLS LAST, c.source_slug)
      FROM cur c
      LEFT JOIN ago a USING (source_slug)
      LEFT JOIN live l ON l.nslug = regexp_replace(lower(c.source_slug), '[^a-z0-9]', '', 'g')), '[]'::jsonb));
$$;
COMMENT ON FUNCTION public.market_sources_read() IS
  'The Sources board: every source holding data, ranked by lots held, with the same measures (held lots and when, census '
  'total, map sales, sales by sale date, live lots now (read within 24 h), held lots a week earlier). Anon. 2026-10-16.';
REVOKE ALL ON FUNCTION public.market_sources_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_sources_read() TO anon, authenticated, service_role;

COMMIT;
