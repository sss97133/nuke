-- Live board snapshots also record the dollars bid with bids in other currencies converted, rate by rate.
-- Before: record_live_board_snapshot() added USD-denominated bids only (bid_usd); a lot bid in EUR, GBP, AUD, NZD or CHF
-- was counted in lots but never in dollars. Since #3056 the live board headline adds those bids at fx_usd_rate, so the house
-- history and week-on-week, which read these snapshots, could only compare the dollar-only part (193 of 1,860 lots on
-- 2026-11-08 were bid in another currency, all at Collecting Cars).
-- After, each new reading also keeps:
--   bid_usd_converted  dollar bids plus each foreign bid x fx_usd_rate(currency, the reading's UTC date); null on readings
--                      before this migration (nothing is backfilled: a past reading's rates were not recorded with it).
--   lots_unconverted   lots with a bid in a currency that had no published rate in fx_usd_rate's 7-day window (not added).
--   fx                 per currency: {rate, rate_date, source_url, lots} - the rate used, the publisher's reference date and
--                      its source, so every converted reading can be replayed.
-- bid_usd keeps its meaning (USD-denominated only), so existing history is unchanged.
-- live_board_share() appends bid_usd_converted to each point (slot 6), adds it to week_ago, and returns converted_first_at:
-- the page switches its house history and week-on-week to converted dollars once that history is a week old.

set lock_timeout = '5s';
set statement_timeout = '10s';

alter table public.live_board_snapshots
  add column if not exists bid_usd_converted numeric,
  add column if not exists lots_unconverted integer,
  add column if not exists fx jsonb;

comment on column public.live_board_snapshots.bid_usd_converted is
  'Dollars bid with bids in other currencies converted at fx_usd_rate(currency, reading date UTC); null before 2026-11-08 (not backfilled).';
comment on column public.live_board_snapshots.lots_unconverted is
  'Lots with a bid in a currency that had no published rate at the reading (listed, not added to bid_usd_converted).';
comment on column public.live_board_snapshots.fx is
  'Rates used for bid_usd_converted, per currency: {rate (USD per unit), rate_date (publisher reference date), source_url, lots}.';

create or replace function public.record_live_board_snapshot()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  t timestamptz := date_trunc('hour', now()) + floor(extract(minute FROM now()) / 15) * interval '15 minutes';
  n integer;
BEGIN
  WITH bat AS (
    SELECT 'bringatrailer'::text AS house, count(*)::int AS lots,
           count(*) FILTER (WHERE a->>4 IS NOT NULL)::int AS lots_with_bid,
           coalesce(sum((a->>4)::numeric), 0) AS bid_usd,
           coalesce(sum((a->>4)::numeric), 0) AS bid_usd_converted,
           0 AS lots_unconverted, '{}'::jsonb AS fx
    FROM jsonb_array_elements(public.market_pulse_live()->'auctions') a
  ),
  h AS MATERIALIZED (
    SELECT a->>12 AS house, upper(coalesce(a->>13, 'USD')) AS cur, (a->>4)::numeric AS bid
    FROM jsonb_array_elements(public.market_pulse_live_houses()->'auctions') a
  ),
  rates AS (
    SELECT c.cur, r.rate, r.rate_date, r.source_url
    FROM (SELECT DISTINCT cur FROM h WHERE cur <> 'USD') c
    CROSS JOIN LATERAL public.fx_usd_rate(c.cur, (t AT TIME ZONE 'UTC')::date) r
  ),
  fx AS (
    SELECT c.house, jsonb_object_agg(c.cur, jsonb_build_object('rate', r.rate, 'rate_date', r.rate_date,
             'source_url', r.source_url, 'lots', c.lots)) AS fx
    FROM (SELECT house, cur, count(*) FILTER (WHERE bid IS NOT NULL)::int AS lots FROM h WHERE cur <> 'USD' GROUP BY 1, 2) c
    JOIN rates r ON r.cur = c.cur
    GROUP BY c.house
  ),
  others AS (
    SELECT o.*, coalesce(fx.fx, '{}'::jsonb) AS fx
    FROM (
      SELECT h.house, count(*)::int AS lots,
             count(*) FILTER (WHERE h.bid IS NOT NULL)::int AS lots_with_bid,
             coalesce(sum(h.bid) FILTER (WHERE h.cur = 'USD'), 0) AS bid_usd,
             coalesce(sum(CASE WHEN h.cur = 'USD' THEN h.bid ELSE round(h.bid * r.rate) END), 0) AS bid_usd_converted,
             count(*) FILTER (WHERE h.bid IS NOT NULL AND h.cur <> 'USD' AND r.rate IS NULL)::int AS lots_unconverted
      FROM h LEFT JOIN rates r ON r.cur = h.cur
      GROUP BY h.house) o
    LEFT JOIN fx ON fx.house = o.house
  ),
  rows AS (
    SELECT * FROM bat WHERE lots > 0
    UNION ALL SELECT * FROM others
  )
  INSERT INTO public.live_board_snapshots (taken_at, house, bid_usd, lots, lots_with_bid, bid_usd_converted, lots_unconverted, fx)
  SELECT t, house, bid_usd, lots, lots_with_bid, bid_usd_converted, lots_unconverted, fx FROM rows
  ON CONFLICT (taken_at, house) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$function$;

create or replace function public.live_board_share(p_hours integer default 168)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
  WITH w AS (SELECT least(greatest(coalesce(p_hours, 168), 1), 720) AS h),
  hourly AS (
    -- every quarter-hour for the last 48 hours (a chart of a day reads like a tape), the last reading of each hour before
    SELECT s.taken_at, s.house, s.bid_usd, s.lots, s.lots_with_bid, s.bid_usd_converted
    FROM public.live_board_snapshots s, w
    WHERE s.taken_at > now() - make_interval(hours => w.h) AND s.taken_at > now() - interval '48 hours'
    UNION ALL
    SELECT * FROM (
      SELECT DISTINCT ON (date_trunc('hour', s.taken_at), s.house) s.taken_at, s.house, s.bid_usd, s.lots, s.lots_with_bid, s.bid_usd_converted
      FROM public.live_board_snapshots s, w
      WHERE s.taken_at > now() - make_interval(hours => w.h) AND s.taken_at <= now() - interval '48 hours'
      ORDER BY date_trunc('hour', s.taken_at), s.house, s.taken_at DESC) older
  ),
  wk AS (
    SELECT DISTINCT ON (s.house) s.house, s.taken_at, s.bid_usd, s.lots, s.lots_with_bid, s.bid_usd_converted
    FROM public.live_board_snapshots s
    WHERE s.taken_at BETWEEN now() - interval '7 days 90 minutes' AND now() - interval '7 days' + interval '90 minutes'
    ORDER BY s.house, abs(extract(epoch FROM s.taken_at - (now() - interval '7 days')))
  )
  SELECT jsonb_build_object(
    'columns', jsonb_build_array('taken_at', 'house', 'bid_usd', 'lots', 'lots_with_bid', 'bid_usd_converted'),
    'first_at', (SELECT min(taken_at) FROM public.live_board_snapshots),
    'converted_first_at', (SELECT min(taken_at) FROM public.live_board_snapshots WHERE bid_usd_converted IS NOT NULL),
    'first_at_by_house', COALESCE((SELECT jsonb_object_agg(house, f) FROM (SELECT house, min(taken_at) AS f FROM public.live_board_snapshots GROUP BY house) x), '{}'::jsonb),
    'points', COALESCE((SELECT jsonb_agg(jsonb_build_array(taken_at, house, bid_usd, lots, lots_with_bid, bid_usd_converted) ORDER BY taken_at, house) FROM hourly), '[]'::jsonb),
    'week_ago', COALESCE((SELECT jsonb_object_agg(house, jsonb_build_object('at', taken_at, 'bid_usd', bid_usd, 'lots', lots,
      'lots_with_bid', lots_with_bid, 'bid_usd_converted', bid_usd_converted)) FROM wk), '{}'::jsonb)
  );
$function$;

revoke all on function public.record_live_board_snapshot() from public, anon, authenticated;
grant execute on function public.record_live_board_snapshot() to service_role;
grant execute on function public.live_board_share(integer) to anon, authenticated, service_role;
