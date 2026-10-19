-- The calendar passes each sale's previous sale through: last year's final roster from the house's own index.
--
-- The calendar contract owed "last year's final roster as a baseline" (docs/market/MARKET_MEASUREMENT_UI_CONTRACT.md).
-- The Mecum census writer (intake-flow, agreed with skylar-f7 2026-10-15) adds raw_response.sales[sale_key].prior_sale =
-- {sale_key, lots, vehicle_lots, sold, bid_goes_on, median_price, ends_on} for the same series' previous sale, matched by
-- series and location (Mecum renames: dallas-2025 -> dallas-fort-worth-2026, las-vegas-motorcycles-2026 -> lv-motorcycles-2027).
-- Computed from the 2026-10-15 index pull: DFW <- Dallas 2025, 1,459 lots, 872 of 1,235 vehicles sold; Kissimmee 2027 <-
-- Kissimmee 2026, 4,905 lots, 2,942 of 3,819 sold (~/nuke-logs/market-coverage/mecum_last_year_rosters.json).
-- CHANGE: auction_calendar_read adds prior_sale (the census meta's object, or null) to each sale; nothing else changes.
-- Same signature and execution properties. Guarded on the 20261016160000 reader's hash.
-- Contract: supabase/sql/test_calendar_prior_source_clock.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE v text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO v FROM pg_proc
  WHERE oid = 'public.auction_calendar_read(integer,text,text,integer,integer)'::regprocedure;
  IF v IS DISTINCT FROM 'aLftZ3RfX2KkCLgQF3vSVy+aG6sXJUGdHAeQCt7chGw=' AND v IS DISTINCT FROM '6EyKaEjcLWrpM3m7xLzaPPtlbQrT7IkyNQ/fxpc5qSk=' THEN
    RAISE EXCEPTION 'auction_calendar_read is not the 20261016160000 definition this extends (sha256 %)', v;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.auction_calendar_read(p_days integer DEFAULT 200, p_house text DEFAULT NULL::text, p_sale_key text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 200), 1), 400);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_result jsonb;
BEGIN
  WITH lot AS (
    -- The read model (mv_auction_calendar_lots) holds the lots; the window is applied at read time.
    SELECT c.* FROM public.mv_auction_calendar_lots c
    WHERE c.ended_at >= date_trunc('day', now())
      AND c.ended_at < now() + make_interval(days => v_days)
  ), census AS (
    SELECT * FROM public.house_roster_census()
  ), listed AS (
    SELECT cs.house, k.key AS sale_key, (k.value #>> '{}')::int AS lots_listed, cs.census_at AS listed_at,
           cs.raw_response -> 'sales' -> k.key AS meta
    FROM census cs, jsonb_each(cs.by_category) k
    WHERE jsonb_typeof(k.value) = 'number'
  ), landed AS (
    SELECT house, sale_key, min(sale_name) AS sale_name, min(sale_location) AS location,
           COALESCE(min(sale_starts_on), min(run_on)) AS starts_on, COALESCE(max(sale_ends_on), max(run_on)) AS ends_on,
           count(*) AS lots, count(*) FILTER (WHERE prior_n > 0) AS seen_before,
           count(*) FILTER (WHERE has_reserve IS FALSE) AS no_reserve,
           min(roster_first_seen) AS first_seen_at,
           count(*) FILTER (WHERE roster_first_seen >= now() - interval '7 days') AS first_seen_7d,
           max(updated_at) AS updated_at
    FROM lot GROUP BY house, sale_key
  ), sale AS (
    SELECT l.*, li.lots_listed, li.listed_at, li.meta -> 'prior_sale' AS prior_sale
    FROM landed l LEFT JOIN listed li USING (house, sale_key)
    UNION ALL
    SELECT li.house, li.sale_key, COALESCE(li.meta ->> 'name', initcap(replace(li.sale_key, '-', ' '))), NULL,
           (li.meta ->> 'starts_on')::date, (li.meta ->> 'ends_on')::date, 0, 0, 0, NULL, 0, NULL, li.lots_listed, li.listed_at,
           li.meta -> 'prior_sale'
    FROM listed li
    WHERE NOT EXISTS (SELECT 1 FROM landed l WHERE l.house = li.house AND l.sale_key = li.sale_key)
  ), run_days AS (
    SELECT house, sale_key, jsonb_agg(jsonb_build_object('day', run_on, 'lots', n) ORDER BY run_on) AS days
    FROM (SELECT house, sale_key, run_on, count(*) AS n FROM lot GROUP BY 1, 2, 3) d
    GROUP BY house, sale_key
  ), picked AS (
    SELECT lot.* FROM lot
    WHERE p_house IS NOT NULL AND p_sale_key IS NOT NULL AND lot.house = p_house AND lot.sale_key = p_sale_key
    ORDER BY lot.run_on, NULLIF(regexp_replace(COALESCE(lot.lot_number, ''), '\D', '', 'g'), '')::bigint NULLS LAST,
             lot.lot_number, lot.event_id
    LIMIT v_limit OFFSET v_offset
  )
  SELECT jsonb_build_object(
    'as_of', now(),
    'horizon_days', v_days,
    'population', (SELECT jsonb_build_object(
        'lots', count(*),
        'seen_before', count(*) FILTER (WHERE prior_n > 0), 'no_reserve', count(*) FILTER (WHERE has_reserve IS FALSE),
        'first_seen_7d', count(*) FILTER (WHERE roster_first_seen >= now() - interval '7 days'),
        'updated_at', max(updated_at))
      FROM lot)
      || (SELECT jsonb_build_object('sales', count(*), 'houses', count(DISTINCT house),
            'listed', COALESCE(sum(GREATEST(lots, COALESCE(lots_listed, lots))), 0))
          FROM sale WHERE starts_on IS NULL OR starts_on < current_date + v_days)
      || jsonb_build_object('lots_built_at', (SELECT max(c.built_at) FROM public.mv_auction_calendar_lots c)),
    'sales', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'house', s.house, 'sale_key', s.sale_key, 'sale_name', s.sale_name, 'location', s.location,
        'starts_on', s.starts_on, 'ends_on', s.ends_on, 'lots', s.lots, 'seen_before', s.seen_before,
        'no_reserve', s.no_reserve, 'first_seen_at', s.first_seen_at, 'first_seen_7d', s.first_seen_7d,
        'updated_at', s.updated_at, 'lots_listed', s.lots_listed, 'listed_at', s.listed_at,
        'run_days', COALESCE(r.days, '[]'::jsonb), 'prior_sale', s.prior_sale) ORDER BY s.starts_on, s.house, s.sale_key)
      FROM sale s LEFT JOIN run_days r USING (house, sale_key)
      WHERE s.starts_on IS NOT NULL AND s.starts_on < current_date + v_days), '[]'::jsonb),
    'unplaced', COALESCE((SELECT jsonb_agg(jsonb_build_object('house', s.house, 'sale_key', s.sale_key,
        'sale_name', s.sale_name, 'lots_listed', s.lots_listed, 'listed_at', s.listed_at) ORDER BY s.house, s.sale_key)
      FROM sale s WHERE s.starts_on IS NULL), '[]'::jsonb),
    'roster', CASE WHEN p_house IS NULL OR p_sale_key IS NULL THEN NULL ELSE jsonb_build_object(
      'house', p_house, 'sale_key', p_sale_key,
      'lots', (SELECT count(*) FROM lot WHERE house = p_house AND sale_key = p_sale_key),
      'offset', v_offset,
      'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'event_id', pk.event_id, 'vehicle_id', pk.vehicle_id, 'source_url', pk.source_url,
          'lot_number', NULLIF(NULLIF(pk.lot_number, ''), '0'), 'run_on', pk.run_on,
          'year', pk.year, 'make', pk.make, 'model', pk.model, 'image', pk.image, 'vin_present', pk.vin_present,
          'has_reserve', pk.has_reserve,
          'estimate_low', (pk.estimate_low)::numeric, 'estimate_high', (pk.estimate_high)::numeric,
          'currency', NULLIF(pk.currency, ''), 'first_seen_at', pk.roster_first_seen,
          -- Earlier records are read live, as the caller, for the lots on this page only.
          'prior', COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'house', p.source_platform, 'on', COALESCE(p.ended_at, p.sold_at)::date,
              'outcome', CASE WHEN p.event_status = 'sold' THEN 'sold'
                              WHEN p.event_status IN ('unsold', 'bid-goes-on') THEN 'not_sold'
                              WHEN p.event_status = 'active' THEN 'listed'
                              ELSE p.event_status END,
              'amount', NULLIF(COALESCE(p.final_price, p.current_price), 0),
              'currency', NULLIF(p.metadata->>'currency', ''),
              'basis', CASE WHEN p.event_status = 'sold' AND p.extraction_method = 'orphan-backfill-v1'
                             AND p.source_platform NOT IN ('gooding', 'barrettjackson', 'barrett-jackson')
                             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pk.corrections) c
                                             WHERE jsonb_typeof(c -> 'source' -> 'lots') = 'array'
                                               AND (c -> 'source' -> 'lots') ? COALESCE(substring(p.source_url FROM '/lots/(\d+)/'), ''))
                            THEN 'unconfirmed' ELSE 'source' END,
              'url', p.source_url) ORDER BY COALESCE(p.ended_at, p.sold_at, p.created_at) DESC)
            FROM (SELECT * FROM vehicle_events p0
                  WHERE p0.vehicle_id = pk.vehicle_id AND p0.id <> pk.event_id
                    AND p0.event_status NOT IN ('upcoming', 'pending')
                    AND COALESCE(p0.ended_at, p0.sold_at, p0.created_at) < now()
                  ORDER BY COALESCE(p0.ended_at, p0.sold_at, p0.created_at) DESC LIMIT 5) p), '[]'::jsonb))
        ORDER BY pk.run_on, NULLIF(regexp_replace(COALESCE(pk.lot_number, ''), '\D', '', 'g'), '')::bigint NULLS LAST,
                 pk.lot_number, pk.event_id)
        FROM (SELECT pl.*,
                     COALESCE((SELECT CASE WHEN jsonb_typeof(v.provenance_metadata -> 'sale_provenance_corrections') = 'array'
                                           THEN v.provenance_metadata -> 'sale_provenance_corrections' END
                               FROM vehicles v WHERE v.id = pl.vehicle_id), '[]'::jsonb) AS corrections
              FROM picked pl) pk), '[]'::jsonb)) END
  ) INTO v_result;
  RETURN v_result;
END
$function$;

COMMIT;
