-- Each house's bid total and open lots, recorded every 15 minutes: the series behind the live board's share charts
-- and its per-house week-over-week comparison.
--
-- Until now only BaT had a history (BAT-LIVE-BIDS, hourly since 2026-06-29), so the board's headline added every
-- house while its week-ago comparison covered BaT alone. live_board_snapshots holds one row per house per
-- quarter-hour: open lots, lots with a recorded bid, and the dollars bid (USD-denominated bids only; a bid in another
-- currency is counted in lots but never added in, as on the page). Recording starts when this migration runs; nothing is
-- backfilled, so live_board_share() reports how far back the series goes and a house has a week-ago comparison only
-- once its own series is a week old.
-- Contract: supabase/sql/test_live_board_snapshots.sql.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.live_board_snapshots (
  taken_at timestamptz NOT NULL,
  house text NOT NULL,
  bid_usd numeric NOT NULL DEFAULT 0,
  lots integer NOT NULL,
  lots_with_bid integer NOT NULL,
  PRIMARY KEY (taken_at, house)
);
COMMENT ON TABLE public.live_board_snapshots IS
  'Per-house open lots, lots with a bid and dollars bid (USD only) on the live auctions board, every 15 minutes from '
  '2026-10-21. Written only by record_live_board_snapshot(); read through live_board_share().';
ALTER TABLE public.live_board_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS live_board_snapshots_read ON public.live_board_snapshots;
CREATE POLICY live_board_snapshots_read ON public.live_board_snapshots FOR SELECT USING (true);
REVOKE ALL ON public.live_board_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.live_board_snapshots TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_live_board_snapshot()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t timestamptz := date_trunc('hour', now()) + floor(extract(minute FROM now()) / 15) * interval '15 minutes';
  n integer;
BEGIN
  WITH bat AS (
    SELECT 'bringatrailer'::text AS house, count(*)::int AS lots,
           count(*) FILTER (WHERE a->>4 IS NOT NULL)::int AS lots_with_bid,
           coalesce(sum((a->>4)::numeric), 0) AS bid_usd
    FROM jsonb_array_elements(public.market_pulse_live()->'auctions') a
  ),
  others AS (
    SELECT a->>12 AS house, count(*)::int AS lots,
           count(*) FILTER (WHERE a->>4 IS NOT NULL)::int AS lots_with_bid,
           coalesce(sum((a->>4)::numeric) FILTER (WHERE a->>13 = 'USD'), 0) AS bid_usd
    FROM jsonb_array_elements(public.market_pulse_live_houses()->'auctions') a
    GROUP BY a->>12
  ),
  rows AS (
    SELECT * FROM bat WHERE lots > 0
    UNION ALL SELECT * FROM others
  )
  INSERT INTO public.live_board_snapshots (taken_at, house, bid_usd, lots, lots_with_bid)
  SELECT t, house, bid_usd, lots, lots_with_bid FROM rows
  ON CONFLICT (taken_at, house) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$function$;
REVOKE ALL ON FUNCTION public.record_live_board_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_live_board_snapshot() TO service_role;

-- The series for the page: hourly points (the last quarter-hour of each hour) over the last p_hours, how far back the
-- series goes, and each house's reading from a week ago (the one nearest 7 days back within 90 minutes), if recorded.
CREATE OR REPLACE FUNCTION public.live_board_share(p_hours integer DEFAULT 168)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH w AS (SELECT least(greatest(coalesce(p_hours, 168), 1), 720) AS h),
  hourly AS (
    SELECT DISTINCT ON (date_trunc('hour', s.taken_at), s.house)
           s.taken_at, s.house, s.bid_usd, s.lots, s.lots_with_bid
    FROM public.live_board_snapshots s, w
    WHERE s.taken_at > now() - make_interval(hours => w.h)
    ORDER BY date_trunc('hour', s.taken_at), s.house, s.taken_at DESC
  ),
  wk AS (
    SELECT DISTINCT ON (s.house) s.house, s.taken_at, s.bid_usd, s.lots, s.lots_with_bid
    FROM public.live_board_snapshots s
    WHERE s.taken_at BETWEEN now() - interval '7 days 90 minutes' AND now() - interval '7 days' + interval '90 minutes'
    ORDER BY s.house, abs(extract(epoch FROM s.taken_at - (now() - interval '7 days')))
  )
  SELECT jsonb_build_object(
    'columns', jsonb_build_array('taken_at', 'house', 'bid_usd', 'lots', 'lots_with_bid'),
    'first_at', (SELECT min(taken_at) FROM public.live_board_snapshots),
    'first_at_by_house', COALESCE((SELECT jsonb_object_agg(house, f) FROM (SELECT house, min(taken_at) AS f FROM public.live_board_snapshots GROUP BY house) x), '{}'::jsonb),
    'points', COALESCE((SELECT jsonb_agg(jsonb_build_array(taken_at, house, bid_usd, lots, lots_with_bid) ORDER BY taken_at, house) FROM hourly), '[]'::jsonb),
    'week_ago', COALESCE((SELECT jsonb_object_agg(house, jsonb_build_object('at', taken_at, 'bid_usd', bid_usd, 'lots', lots, 'lots_with_bid', lots_with_bid)) FROM wk), '{}'::jsonb)
  );
$function$;
REVOKE ALL ON FUNCTION public.live_board_share(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.live_board_share(integer) TO anon, authenticated, service_role;

DO $jobs$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'record-live-board-snapshot') THEN
    PERFORM cron.schedule('record-live-board-snapshot', '*/15 * * * *',
      $cmd$SET statement_timeout = '60s'; SELECT public.record_live_board_snapshot()$cmd$);
  END IF;
END $jobs$;

COMMIT;
