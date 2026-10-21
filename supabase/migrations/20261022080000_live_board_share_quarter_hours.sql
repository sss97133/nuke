-- The share reader returns every quarter-hour for the last 48 hours, so a day's chart has a point per snapshot.
--
-- live_board_share() thinned everything to one point per hour, which left a chart of the last day with 24 points and the
-- first hours of recording with one. The last 48 hours now come at the recorded resolution (15 minutes); older readings
-- stay hourly. Nothing else about the function changes. Contract: supabase/sql/test_live_board_snapshots.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.live_board_share(p_hours integer DEFAULT 168)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH w AS (SELECT least(greatest(coalesce(p_hours, 168), 1), 720) AS h),
  hourly AS (
    -- every quarter-hour for the last 48 hours (a chart of a day reads like a tape), the last reading of each hour before
    SELECT s.taken_at, s.house, s.bid_usd, s.lots, s.lots_with_bid
    FROM public.live_board_snapshots s, w
    WHERE s.taken_at > now() - make_interval(hours => w.h) AND s.taken_at > now() - interval '48 hours'
    UNION ALL
    SELECT * FROM (
      SELECT DISTINCT ON (date_trunc('hour', s.taken_at), s.house) s.taken_at, s.house, s.bid_usd, s.lots, s.lots_with_bid
      FROM public.live_board_snapshots s, w
      WHERE s.taken_at > now() - make_interval(hours => w.h) AND s.taken_at <= now() - interval '48 hours'
      ORDER BY date_trunc('hour', s.taken_at), s.house, s.taken_at DESC) older
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

COMMIT;
