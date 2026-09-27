-- Hot/cold on the homepage: each live BaT lot's expected-price band and the bid-to-close curve.
--
-- Skylar asked for hot/cold bids. A bid alone can't be hot or cold: auctions climb toward the close. Two
-- measured pieces make it meaningful:
--   * the band: an expected-price range from comparable BaT sales on the lot's model page, priced from
--     title-only features by scripts/market/live-bands.mjs and stored once per lot in the prediction ledger
--     (hammer_predictions, model_version 30; the dormant ledger THEORY.md says to revive; each band can later
--     be scored against the lot's real hammer in actual_hammer);
--   * the curve: where bids usually sit, as a share of the final price, with N hours left.
-- The page computes heat = current bid / (band middle x curve at the hours left) with its own clock.
-- Backtest (6,424 cars sold 2026-07-27..09-26, band from sales before each): at 24 h left, lots bid
-- >= 1.25x typical finished above the band middle 90% of the time (median 1.43x), lots <= 0.8x did 13%
-- (median 0.70x); at 72 h 85% / 17%. Title-to-model-page match: 96.4% right on 9,365 lots.
--
-- 1. anon/authenticated may read model-30 rows only: bands derived from public BaT sales for public live
--    lots (the script reads the board with the anon key). Earlier model versions stay unreadable.
-- 2. market_pulse_live() adds band_p10/p50/p90, band_tier and band_comps to each row (a lateral lookup on
--    idx_hammer_predictions_vehicle) and the curve; everything else is unchanged.

SET statement_timeout = '120s';
SET lock_timeout = '10s';

GRANT SELECT ON public.hammer_predictions TO anon, authenticated;
DROP POLICY IF EXISTS hammer_predictions_live_bands_read ON public.hammer_predictions;
CREATE POLICY hammer_predictions_live_bands_read ON public.hammer_predictions
  FOR SELECT TO anon, authenticated
  USING (model_version = 30);

RESET lock_timeout;

CREATE OR REPLACE FUNCTION public.market_pulse_live()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path = public
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
      WHERE h.vehicle_id = v.id AND h.model_version = 30
      ORDER BY h.predicted_at DESC LIMIT 1
    ) hp ON true
    WHERE v.sale_status = 'auction_live'
      AND v.platform_source = 'bringatrailer'
      AND v.auction_end_date IS NOT NULL
      AND v.auction_end_date::timestamptz > now()
  )
  SELECT jsonb_build_object(
    'synced_at', (SELECT max(updated_at) FROM live),
    'source', 'Bring a Trailer live auctions page, read every 15 minutes by sync-live-auctions',
    -- Median share of the final price that sold BaT cars had bid at each hours-left mark, by price tier of the
    -- band middle (a <$25k, b <$50k, c <$100k, d $100k+); 36,700 sales ending 2025-09-26..2026-09-26.
    'curve', '{"a":[[168,0.198],[120,0.35],[96,0.3903],[72,0.4324],[48,0.4762],[36,0.5098],[24,0.5364],[18,0.5769],[12,0.6071],[6,0.6235],[3,0.6621],[1,0.7077]],"b":[[168,0.204],[120,0.4194],[96,0.4615],[72,0.5],[48,0.543],[36,0.5714],[24,0.5942],[18,0.625],[12,0.6496],[6,0.6612],[3,0.6933],[1,0.7315]],"c":[[168,0.2658],[120,0.5006],[96,0.5436],[72,0.5764],[48,0.6075],[36,0.6357],[24,0.6544],[18,0.6808],[12,0.7018],[6,0.7115],[3,0.7355],[1,0.7692]],"d":[[168,0.4505],[120,0.6076],[96,0.6392],[72,0.6632],[48,0.6902],[36,0.7078],[24,0.7192],[18,0.7383],[12,0.7525],[6,0.7567],[3,0.7738],[1,0.8041]]}'::jsonb,
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
               band_p10, band_p50, band_p90, band_tier, band_comps)
             ORDER BY ends_at)
      FROM live), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.market_pulse_live() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_pulse_live() TO anon, authenticated, service_role;

RESET statement_timeout;

NOTIFY pgrst, 'reload schema';

-- POST-APPLY (read-only):
--   SELECT count(*) FROM hammer_predictions WHERE model_version = 30;          -- after npm run market:live-bands
--   SELECT jsonb_array_length(public.market_pulse_live()->'auctions'), public.market_pulse_live()->'curve'->'a'->0;
