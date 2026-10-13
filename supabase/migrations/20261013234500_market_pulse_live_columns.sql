-- market_pulse_live v2: the payload names its row slots.
--
-- The board reader returns each live lot as a 17-element array and both clients (nuke_frontend
-- useMarketPulse.ts, the phone's LiveBoard decode) read the slots by position. Nothing in the payload said
-- which slot is which or which version it was, and no test pinned the order: a slot added mid-array would
-- have shifted both clients silently (the web's Number() coercion hides it). This adds 'v' = 2 and a
-- 'columns' array naming the 17 slots in order; the rows themselves are unchanged. Clients that know the
-- names assert them on decode; older clients ignore the two new keys.
--
-- The body is the live definition of 2026-10-13 (migration 20261004061500, verified identical to prod
-- by md5 before this was written) plus the two keys. The guard below refuses to apply over a definition
-- that drifted since.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

DO $guard$ BEGIN
  IF to_regprocedure('public.market_pulse_live()') IS NOT NULL
     AND md5(pg_get_functiondef(to_regprocedure('public.market_pulse_live()'))) <> 'b18588b0f661a6bf539f531cbce53c22' THEN
    RAISE EXCEPTION 'market_pulse_live is not the 2026-10-13 definition this migration was written from; re-read it before applying';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.market_pulse_live()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY INVOKER
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
    'v', 2,
    'columns', jsonb_build_array(
      'id', 'year', 'make', 'model', 'current_bid', 'ends_at', 'updated_at', 'listed_at',
      'image_url', 'no_reserve', 'listing_url', 'title',
      'band_p10', 'band_p50', 'band_p90', 'band_tier', 'band_comps'),
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

DO $check$ DECLARE j jsonb; r jsonb; BEGIN
  j := public.market_pulse_live();
  IF (j->>'v')::int IS DISTINCT FROM 2 OR jsonb_array_length(j->'columns') <> 17 THEN
    RAISE EXCEPTION 'market_pulse_live v2 did not state 17 columns';
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(j->'auctions', '[]'::jsonb)) LOOP
    IF jsonb_array_length(r) <> 17 THEN RAISE EXCEPTION 'market_pulse_live row has % slots, not 17', jsonb_array_length(r); END IF;
  END LOOP;
END $check$;

COMMIT;
