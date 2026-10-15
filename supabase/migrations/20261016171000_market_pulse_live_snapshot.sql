-- market_pulse_live serves a snapshot built every two minutes.
--
-- The live board (the market page's Live now and the phone's Live lens) reads market_pulse_live: about 1,229 live
-- Bring a Trailer lots, each with a lateral hammer_predictions lookup, plus the heat track record, the bid curve and
-- the hourly baseline. Warm it answers in about 1 s; while intake jobs hold the disk it reads thousands of cold pages
-- and failed for visitors on 2026-10-15: 500 after 15.1 s then 200 in 21.0 s (14:16Z, logged out), and the phone's
-- 500 after 17.0 s then 200 in 11.3 s (13:55Z, skylar-b3), "Couldn't read the board".
--
-- The payload is the same for every visitor, so it is built once instead of once per visitor:
-- market_pulse_live_build() is the previous definition unchanged (prosrc sha256 guarded below);
-- refresh_market_pulse_live_snapshot() stores its value with the build time and duration, every two minutes by cron
-- (refresh-market-pulse-live, statement_timeout 90 s; pg_cron runs one instance of a job at a time); and
-- market_pulse_live() returns that snapshot while it is under five minutes old, with lots that have ended since the
-- build dropped, and otherwise builds the payload live as before. The payload's shape and version (v 3, the clients'
-- positional columns) do not change, and synced_at still carries the newest lot update it saw.
-- Contract: supabase/sql/test_market_pulse_live_snapshot.sql.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE cur text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO cur
    FROM pg_proc WHERE oid = 'public.market_pulse_live()'::regprocedure;
  IF cur IS DISTINCT FROM 'ImO7ZyF0Hg93xU45isnTnx3V+FlIRlqfYhX4Q+Rx4F8=' AND cur IS DISTINCT FROM 'kJf4giESw0imvDqI7m8rd5A6Yt/+49b3rx6Bu+h+GCI=' THEN
    RAISE EXCEPTION 'market_pulse_live drifted from the definition this migration moves into market_pulse_live_build (sha256 %)', cur;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.market_pulse_live_build()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH live AS (
    SELECT v.id,
           v.year,
           COALESCE(cm.canonical_name, v.make) AS make,
           v.model,
           COALESCE(v.high_bid, v.sale_price) AS current_bid,
           v.auction_end_date::timestamptz AS ends_at,
           v.updated_at,
           v.created_at AS listed_at,
           v.primary_image_url AS image_url,
           COALESCE((v.origin_metadata->>'no_reserve')::boolean, false) AS no_reserve,
           v.listing_url,
           v.title,
           hp.predicted_low AS band_p10,
           hp.predicted_hammer AS band_p50,
           hp.predicted_high AS band_p90,
           hp.price_tier AS band_tier,
           hp.comp_count AS band_comps
    FROM public.vehicles v
    LEFT JOIN public.canonical_makes cm ON cm.id = v.canonical_make_id
    LEFT JOIN LATERAL (
      SELECT h.predicted_low, h.predicted_hammer, h.predicted_high, h.price_tier, h.comp_count
      FROM public.hammer_predictions h
      WHERE h.vehicle_id = v.id AND h.model_version = 31
      ORDER BY h.predicted_at DESC LIMIT 1
    ) hp ON true
    WHERE v.is_public AND v.deleted_at IS NULL
      AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
      AND v.sale_status = 'auction_live'
      AND v.platform_source = 'bringatrailer'
      AND v.auction_end_date IS NOT NULL
      AND v.auction_end_date::timestamptz > now()
  )
  SELECT jsonb_build_object(
    -- The payload's version and the name of each slot of an auctions row, in order. Both clients read the
    -- rows by position; a slot added or moved without bumping these fails their decode loudly instead of
    -- shifting a bid into a year. supabase/sql/test_market_pulse_live_columns.sql pins them.
    'v', 3,
    'columns', jsonb_build_array(
      'id', 'year', 'make', 'model', 'current_bid', 'ends_at', 'updated_at', 'listed_at',
      'image_url', 'no_reserve', 'listing_url', 'title',
      'band_p10', 'band_p50', 'band_p90', 'band_tier', 'band_comps', 'heat'),
    -- The verdict's three numbers and the track record behind the sentence, from the same read.
    'thresholds', public.heat_thresholds(),
    'backtest', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'horizon_hours', horizon_hours, 'label', label, 'hot_above', hot_above, 'cold_below', cold_below,
               'n_hot', n_hot, 'n_cold', n_cold, 'run_at', run_at, 'population', population,
               'lots_sold', lots_sold, 'source', source) ORDER BY horizon_hours DESC)
      FROM public.v_heat_tag_backtest), '[]'::jsonb),
    'synced_at', (SELECT max(updated_at) FROM live),
    'source', 'Bring a Trailer live auctions page, read every 15 minutes by sync-live-auctions',
    -- Median share of the final price that sold BaT cars had bid at each hours-left mark, by price tier of the
    -- band middle (a <$25k, b <$50k, c <$100k, d $100k+); 36,700 sales ending 2025-09-26..2026-09-26.
    'curve', public.bid_curve_v31(),
    'baseline', (
      WITH idx AS (SELECT id FROM public.market_indexes WHERE index_code = 'BAT-LIVE-BIDS'),
      hr AS (SELECT to_char(date_trunc('hour', now()) AT TIME ZONE 'UTC', 'HH24') AS now_hh,
                    date_trunc('hour', now() - interval '7 days') AS wk_t),
      wk AS (
        SELECT v.components_snapshot->'hourly'->to_char(hr.wk_t AT TIME ZONE 'UTC', 'HH24') AS snap,
               COALESCE(v.calculation_metadata->'sources'->>to_char(hr.wk_t AT TIME ZONE 'UTC', 'HH24'),
                        v.calculation_metadata->>'source') AS source
        FROM public.market_index_values v, idx, hr
        WHERE v.index_id = idx.id AND v.value_date = (hr.wk_t AT TIME ZONE 'UTC')::date
      ),
      same_hour AS (
        SELECT v.value_date, (v.components_snapshot->'hourly'->hr.now_hh->>'bids')::numeric AS bids
        FROM public.market_index_values v, idx, hr
        WHERE v.index_id = idx.id
          AND v.value_date >= (now() AT TIME ZONE 'UTC')::date - 84
          AND v.value_date < (now() AT TIME ZONE 'UTC')::date
          AND extract(dow FROM v.value_date) = extract(dow FROM (now() AT TIME ZONE 'UTC')::date)
      )
      SELECT jsonb_build_object(
        'week_ago', (SELECT jsonb_build_object('at', snap->>'at', 'bids', (snap->>'bids')::numeric, 'n', (snap->>'n')::int,
                                               'by_make', snap->'by_make', 'source', source)
                     FROM wk WHERE snap IS NOT NULL),
        'same_hour', (SELECT jsonb_build_object('hour_utc', (SELECT now_hh FROM hr), 'weekday_utc', to_char(now() AT TIME ZONE 'UTC', 'FMDay'),
                                                'low', min(bids), 'high', max(bids), 'weeks', count(*), 'first_day', min(value_date),
                                                'readings', jsonb_agg(jsonb_build_array(value_date, bids) ORDER BY value_date))
                      FROM same_hour WHERE bids IS NOT NULL)
      )
    ),
    'auctions', COALESCE((
      SELECT jsonb_agg(jsonb_build_array(
               id, year, make, model, current_bid, ends_at, updated_at, listed_at,
               image_url, no_reserve, listing_url, title,
               band_p10, band_p50, band_p90, band_tier, band_comps,
               public.heat_of(current_bid::float8, band_p50::float8, band_tier, ends_at, now()))
             ORDER BY ends_at)
      FROM live), '[]'::jsonb)
  );
$function$;
REVOKE ALL ON FUNCTION public.market_pulse_live_build() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_pulse_live_build() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.market_pulse_live_build() IS
  'The live board payload (v 3) computed from the live lots now: market_pulse_live''s definition until 2026-10-15. '
  'market_pulse_live serves refresh_market_pulse_live_snapshot''s stored copy of it and falls back to this.';

CREATE TABLE IF NOT EXISTS public.market_pulse_live_snapshot (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  payload jsonb NOT NULL,
  built_at timestamptz NOT NULL,
  build_ms integer NOT NULL
);
COMMENT ON TABLE public.market_pulse_live_snapshot IS
  'One row: the latest market_pulse_live_build() value, when it was built (the build''s transaction time) and how '
  'long it took. Written only by refresh_market_pulse_live_snapshot(); read by market_pulse_live().';
ALTER TABLE public.market_pulse_live_snapshot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS market_pulse_live_snapshot_read ON public.market_pulse_live_snapshot;
CREATE POLICY market_pulse_live_snapshot_read ON public.market_pulse_live_snapshot FOR SELECT USING (true);
REVOKE ALL ON public.market_pulse_live_snapshot FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.market_pulse_live_snapshot TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refresh_market_pulse_live_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t0 timestamptz := clock_timestamp();
  p jsonb;
  ms integer;
BEGIN
  p := public.market_pulse_live_build();
  ms := round(extract(epoch FROM clock_timestamp() - t0) * 1000)::integer;
  INSERT INTO public.market_pulse_live_snapshot AS s (id, payload, built_at, build_ms)
  VALUES (1, p, now(), ms)
  ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, built_at = EXCLUDED.built_at, build_ms = EXCLUDED.build_ms;
  RETURN jsonb_build_object('built_at', now(), 'build_ms', ms,
                            'auctions', jsonb_array_length(coalesce(p->'auctions', '[]'::jsonb)));
END
$function$;
REVOKE ALL ON FUNCTION public.refresh_market_pulse_live_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_market_pulse_live_snapshot() TO service_role;
COMMENT ON FUNCTION public.refresh_market_pulse_live_snapshot() IS
  'Store market_pulse_live_build() in market_pulse_live_snapshot with its build time and duration. Cron '
  'refresh-market-pulse-live, every two minutes. service_role only.';

CREATE OR REPLACE FUNCTION public.market_pulse_live()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- The stored board while it is under five minutes old, minus lots that have ended since it was built (slot 5 is
  -- ends_at); otherwise the board built now, as before 2026-10-15.
  SELECT CASE
    WHEN s.payload IS NULL THEN public.market_pulse_live_build()
    ELSE jsonb_set(s.payload, '{auctions}', coalesce(
      (SELECT jsonb_agg(a ORDER BY o) FROM jsonb_array_elements(s.payload->'auctions') WITH ORDINALITY e(a, o)
        WHERE (a->>5)::timestamptz > now()), '[]'::jsonb))
  END
  FROM (SELECT (SELECT payload FROM public.market_pulse_live_snapshot
                WHERE id = 1 AND built_at > now() - interval '5 minutes') AS payload) s
$function$;
REVOKE ALL ON FUNCTION public.market_pulse_live() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_pulse_live() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.market_pulse_live() IS
  'The live board payload (v 3): the snapshot refresh-market-pulse-live stores every two minutes while it is under '
  'five minutes old (ended lots dropped), else built now by market_pulse_live_build(). 2026-10-15.';

DO $jobs$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-market-pulse-live') THEN
    PERFORM cron.schedule('refresh-market-pulse-live', '*/2 * * * *',
      $cmd$SET statement_timeout = '90s'; SELECT public.refresh_market_pulse_live_snapshot()$cmd$);
  END IF;
END $jobs$;

COMMIT;
