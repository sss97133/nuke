-- market_pulse_live v3: the verdict in the read, and the track record behind its sentence.
--
-- Hot and cold were computed in two clients (MarketPulse.tsx heatOf, LiveBoard.swift) from the band, the curve and
-- three typed thresholds, and the "track record" sentence came from a table typed into the web page. This moves
-- all of it to the read: heat_of() is the verdict (one SQL function, graded against the clients' shared fixture by
-- supabase/sql/test_market_pulse_live_heat.sql), bid_curve_v31() holds the curve once, heat_thresholds() the three
-- numbers once, and heat_tag_backtest holds the track record with its population, window and source. Every row of
-- the board gains an 18th slot, heat (null where there is no verdict); older clients ignore the appended slot and
-- the new keys. Nothing else in the payload moves.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

DO $guard$ BEGIN
  IF to_regprocedure('public.market_pulse_live()') IS NULL
     OR (public.market_pulse_live()->>'v')::int IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'market_pulse_live v3 applies over v2 (migration 20261013234500); apply that first';
  END IF;
END $guard$;

-- Median share of the final price that sold BaT cars had bid at each hours-left mark, by price tier of the band
-- middle (a <$25k, b <$50k, c <$100k, d $100k+); 36,700 sales ending 2025-09-26..2026-09-26 (migration 20260927230000).
CREATE OR REPLACE FUNCTION public.bid_curve_v31() RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public' AS $$
  SELECT '{"a":[[168,0.198],[120,0.35],[96,0.3903],[72,0.4324],[48,0.4762],[36,0.5098],[24,0.5364],[18,0.5769],[12,0.6071],[6,0.6235],[3,0.6621],[1,0.7077]],"b":[[168,0.204],[120,0.4194],[96,0.4615],[72,0.5],[48,0.543],[36,0.5714],[24,0.5942],[18,0.625],[12,0.6496],[6,0.6612],[3,0.6933],[1,0.7315]],"c":[[168,0.2658],[120,0.5006],[96,0.5436],[72,0.5764],[48,0.6075],[36,0.6357],[24,0.6544],[18,0.6808],[12,0.7018],[6,0.7115],[3,0.7355],[1,0.7692]],"d":[[168,0.4505],[120,0.6076],[96,0.6392],[72,0.6632],[48,0.6902],[36,0.7078],[24,0.7192],[18,0.7383],[12,0.7525],[6,0.7567],[3,0.7738],[1,0.8041]]}'::jsonb
$$;

CREATE OR REPLACE FUNCTION public.heat_thresholds() RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public' AS $$
  SELECT jsonb_build_object('hot', 1.25, 'cold', 0.8, 'max_hours', 120)
$$;

-- The verdict on one lot: the bid against where comparable sales usually sit with this much time left.
-- heat = bid / (band middle x the curve's share at hours-left); hot at 1.25 and above, cold at 0.8 and below;
-- no verdict without a bid, a band or a tier, after the close, or past 120 h where the curve rests on thin data.
-- Mirrors nuke_frontend/src/pages/market/MarketPulse.tsx heatOf to the operation, so the fixture grades both.
CREATE OR REPLACE FUNCTION public.heat_of(
  p_bid double precision, p_p50 double precision, p_tier text, p_ends_at timestamptz, p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path TO 'public' AS $$
DECLARE
  pts jsonb; n int; i int;
  hours double precision; h double precision; h1 double precision; v1 double precision; h2 double precision; v2 double precision;
  share double precision; typical double precision; ratio double precision; t jsonb;
BEGIN
  IF p_bid IS NULL OR p_bid <= 0 OR p_p50 IS NULL OR p_tier IS NULL OR p_ends_at IS NULL OR p_now IS NULL THEN
    RETURN NULL;
  END IF;
  t := public.heat_thresholds();
  hours := extract(epoch FROM (p_ends_at - p_now)) / 3600.0;
  IF hours <= 0 OR hours > (t->>'max_hours')::float8 THEN RETURN NULL; END IF;
  pts := public.bid_curve_v31() -> p_tier;
  IF pts IS NULL OR jsonb_typeof(pts) <> 'array' OR jsonb_array_length(pts) = 0 THEN RETURN NULL; END IF;
  n := jsonb_array_length(pts);
  h := greatest((pts->(n - 1)->>0)::float8, least((pts->0->>0)::float8, hours));
  share := NULL;
  FOR i IN 0..n - 2 LOOP
    h1 := (pts->i->>0)::float8; v1 := (pts->i->>1)::float8;
    h2 := (pts->(i + 1)->>0)::float8; v2 := (pts->(i + 1)->>1)::float8;
    IF h <= h1 AND h >= h2 THEN
      share := v1 + (v2 - v1) * (h1 - h) / (h1 - h2);
      EXIT;
    END IF;
  END LOOP;
  IF share IS NULL THEN share := (pts->(n - 1)->>1)::float8; END IF;
  IF share IS NULL OR share = 0 THEN RETURN NULL; END IF;
  typical := p_p50 * share;
  ratio := p_bid / typical;
  RETURN jsonb_build_object(
    'ratio', ratio,
    'state', CASE WHEN ratio >= (t->>'hot')::float8 THEN 'hot' WHEN ratio <= (t->>'cold')::float8 THEN 'cold' ELSE 'in line' END,
    'typical_now', typical, 'share', share, 'hours_left', hours);
END $$;

REVOKE ALL ON FUNCTION public.bid_curve_v31() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.heat_thresholds() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.heat_of(double precision, double precision, text, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bid_curve_v31() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.heat_thresholds() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.heat_of(double precision, double precision, text, timestamptz, timestamptz) TO anon, authenticated, service_role;

-- The track record: of the lots tagged hot with this much time left, the share that finished above the middle of
-- their comparable sales; of those tagged cold, the share that finished below it. One row per horizon per run.
CREATE TABLE IF NOT EXISTS public.heat_tag_backtest (
  id bigserial PRIMARY KEY,
  run_at timestamptz NOT NULL,
  population text NOT NULL,
  window_from date,
  window_to date,
  lots_sold integer,
  horizon_hours integer NOT NULL,
  label text NOT NULL,
  hot_above double precision NOT NULL,
  cold_below double precision NOT NULL,
  n_hot integer,
  n_cold integer,
  source text NOT NULL,
  UNIQUE (run_at, horizon_hours)
);
COMMENT ON TABLE public.heat_tag_backtest IS
  'Hot/cold tag track record by hours before close: share of hot-tagged lots that finished above their comps'' middle, share of cold-tagged lots that finished below it. One row per horizon per run; the latest run is v_heat_tag_backtest and rides in market_pulse_live as backtest. Written by scripts/market/live-bands (the 2026-09-28 run is seeded here from the numbers the web page carried).';
ALTER TABLE public.heat_tag_backtest ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS heat_tag_backtest_public_read ON public.heat_tag_backtest;
CREATE POLICY heat_tag_backtest_public_read ON public.heat_tag_backtest FOR SELECT USING (true);
GRANT SELECT ON public.heat_tag_backtest TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.v_heat_tag_backtest AS
  SELECT * FROM public.heat_tag_backtest
   WHERE run_at = (SELECT max(run_at) FROM public.heat_tag_backtest)
   ORDER BY horizon_hours DESC;
GRANT SELECT ON public.v_heat_tag_backtest TO anon, authenticated, service_role;

INSERT INTO public.heat_tag_backtest
  (run_at, population, window_from, window_to, lots_sold, horizon_hours, label, hot_above, cold_below, source)
VALUES
  ('2026-09-28T00:00:00Z', 'BaT lots sold 2026-06-27..2026-09-26, each priced only from sales before it', '2026-06-27', '2026-09-26', 10065, 120, '5 days', 0.784, 0.781, 'scripts/market/live-bands.sql (2026-09-28); carried in MarketPulse.tsx BACKTEST until this table'),
  ('2026-09-28T00:00:00Z', 'BaT lots sold 2026-06-27..2026-09-26, each priced only from sales before it', '2026-06-27', '2026-09-26', 10065, 96, '4 days', 0.808, 0.797, 'scripts/market/live-bands.sql (2026-09-28); carried in MarketPulse.tsx BACKTEST until this table'),
  ('2026-09-28T00:00:00Z', 'BaT lots sold 2026-06-27..2026-09-26, each priced only from sales before it', '2026-06-27', '2026-09-26', 10065, 72, '3 days', 0.833, 0.809, 'scripts/market/live-bands.sql (2026-09-28); carried in MarketPulse.tsx BACKTEST until this table'),
  ('2026-09-28T00:00:00Z', 'BaT lots sold 2026-06-27..2026-09-26, each priced only from sales before it', '2026-06-27', '2026-09-26', 10065, 48, '2 days', 0.855, 0.829, 'scripts/market/live-bands.sql (2026-09-28); carried in MarketPulse.tsx BACKTEST until this table'),
  ('2026-09-28T00:00:00Z', 'BaT lots sold 2026-06-27..2026-09-26, each priced only from sales before it', '2026-06-27', '2026-09-26', 10065, 24, 'a day', 0.884, 0.85, 'scripts/market/live-bands.sql (2026-09-28); carried in MarketPulse.tsx BACKTEST until this table'),
  ('2026-09-28T00:00:00Z', 'BaT lots sold 2026-06-27..2026-09-26, each priced only from sales before it', '2026-06-27', '2026-09-26', 10065, 12, '12 hours', 0.915, 0.876, 'scripts/market/live-bands.sql (2026-09-28); carried in MarketPulse.tsx BACKTEST until this table')
ON CONFLICT (run_at, horizon_hours) DO NOTHING;

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

DO $check$ DECLARE j jsonb; r jsonb; BEGIN
  j := public.market_pulse_live();
  IF (j->>'v')::int IS DISTINCT FROM 3 OR jsonb_array_length(j->'columns') <> 18 OR j->'columns'->>17 <> 'heat' THEN
    RAISE EXCEPTION 'market_pulse_live v3 did not state 18 columns ending in heat';
  END IF;
  IF jsonb_array_length(j->'backtest') <> 6 THEN RAISE EXCEPTION 'market_pulse_live v3 carries % backtest rows, expected 6', jsonb_array_length(j->'backtest'); END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(j->'auctions', '[]'::jsonb)) LOOP
    IF jsonb_array_length(r) <> 18 THEN RAISE EXCEPTION 'market_pulse_live row has % slots, not 18', jsonb_array_length(r); END IF;
  END LOOP;
END $check$;

COMMIT;
