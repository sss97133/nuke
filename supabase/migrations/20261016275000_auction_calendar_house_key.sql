-- The calendar keys a house once, whatever the writer's spelling: lots and the house's listed count join on it.
--
-- MEASURED 2026-10-15 18:37Z (skylar-f7): Broad Arrow's two sales showed twice each. Its events carry source_platform
-- broad_arrow (the label 2,100 older Broad Arrow events use), and its roster census is keyed by the observation_sources
-- slug broad-arrow, so 'broad_arrow' rows had 72 and 45 lots with no listed count, and 'broad-arrow' rows had the
-- listed 72 and 45 with no lots. Barrett-Jackson has the same split (barrettjackson / barrett-jackson).
-- CHANGE: auction_calendar_read groups lots, joins the census, draws run days and picks a roster on one house key,
-- COALESCE(market_venue_label(house), house): the map's own spelling-to-house mapping (20261016150000), so the calendar
-- and the map name houses from one place; a house it does not list keys by its own string, as before. A sale's house is
-- an event's spelling when lots landed (the frontend names and links every spelling), else the census's. A roster opens
-- under either spelling. Output keys unchanged. Guarded on the 20261016170000 reader's hash.
-- Contract: supabase/sql/test_calendar_prior_source_clock.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE v text;
BEGIN
  IF to_regprocedure('public.market_venue_label(text)') IS NULL THEN
    RAISE EXCEPTION 'apply 20261016150000_market_venue_label.sql first';
  END IF;
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO v FROM pg_proc
  WHERE oid = 'public.auction_calendar_read(integer,text,text,integer,integer)'::regprocedure;
  IF v IS DISTINCT FROM '6EyKaEjcLWrpM3m7xLzaPPtlbQrT7IkyNQ/fxpc5qSk=' AND v IS DISTINCT FROM 'HV4pxPxsUpmwHhRGPwo1JTzlowzZ5d1qTay40Zccncg=' THEN
    RAISE EXCEPTION 'auction_calendar_read is not the 20261016170000 definition this extends (sha256 %)', v;
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
    -- hk: one key per house whatever the writer's spelling (broad_arrow / broad-arrow, barrettjackson / barrett-jackson),
    -- from market_venue_label, the map's own house mapping; a house it does not list keys by its own string.
    SELECT c.*, COALESCE(public.market_venue_label(c.house), c.house) AS hk FROM public.mv_auction_calendar_lots c
    WHERE c.ended_at >= date_trunc('day', now())
      AND c.ended_at < now() + make_interval(days => v_days)
  ), census AS (
    SELECT * FROM public.house_roster_census()
  ), listed AS (
    SELECT COALESCE(public.market_venue_label(cs.house), cs.house) AS hk, cs.house, k.key AS sale_key,
           (k.value #>> '{}')::int AS lots_listed, cs.census_at AS listed_at,
           cs.raw_response -> 'sales' -> k.key AS meta
    FROM census cs, jsonb_each(cs.by_category) k
    WHERE jsonb_typeof(k.value) = 'number'
  ), landed AS (
    SELECT hk, min(house) AS house, sale_key, min(sale_name) AS sale_name, min(sale_location) AS location,
           COALESCE(min(sale_starts_on), min(run_on)) AS starts_on, COALESCE(max(sale_ends_on), max(run_on)) AS ends_on,
           count(*) AS lots, count(*) FILTER (WHERE prior_n > 0) AS seen_before,
           count(*) FILTER (WHERE has_reserve IS FALSE) AS no_reserve,
           min(roster_first_seen) AS first_seen_at,
           count(*) FILTER (WHERE roster_first_seen >= now() - interval '7 days') AS first_seen_7d,
           max(updated_at) AS updated_at
    FROM lot GROUP BY hk, sale_key
  ), sale AS (
    SELECT l.*, li.lots_listed, li.listed_at, li.meta -> 'prior_sale' AS prior_sale
    FROM landed l LEFT JOIN listed li ON li.hk = l.hk AND li.sale_key = l.sale_key
    UNION ALL
    SELECT li.hk, li.house, li.sale_key, COALESCE(li.meta ->> 'name', initcap(replace(li.sale_key, '-', ' '))), NULL,
           (li.meta ->> 'starts_on')::date, (li.meta ->> 'ends_on')::date, 0, 0, 0, NULL, 0, NULL, li.lots_listed, li.listed_at,
           li.meta -> 'prior_sale'
    FROM listed li
    WHERE NOT EXISTS (SELECT 1 FROM landed l WHERE l.hk = li.hk AND l.sale_key = li.sale_key)
  ), run_days AS (
    SELECT hk, sale_key, jsonb_agg(jsonb_build_object('day', run_on, 'lots', n) ORDER BY run_on) AS days
    FROM (SELECT hk, sale_key, run_on, count(*) AS n FROM lot GROUP BY 1, 2, 3) d
    GROUP BY hk, sale_key
  ), picked AS (
    SELECT lot.* FROM lot
    WHERE p_house IS NOT NULL AND p_sale_key IS NOT NULL
      AND lot.hk = COALESCE(public.market_venue_label(p_house), p_house) AND lot.sale_key = p_sale_key
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
      || (SELECT jsonb_build_object('sales', count(*), 'houses', count(DISTINCT hk),
            'listed', COALESCE(sum(GREATEST(lots, COALESCE(lots_listed, lots))), 0))
          FROM sale WHERE starts_on IS NULL OR starts_on < current_date + v_days)
      || jsonb_build_object('lots_built_at', (SELECT max(c.built_at) FROM public.mv_auction_calendar_lots c)),
    'sales', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'house', s.house, 'sale_key', s.sale_key, 'sale_name', s.sale_name, 'location', s.location,
        'starts_on', s.starts_on, 'ends_on', s.ends_on, 'lots', s.lots, 'seen_before', s.seen_before,
        'no_reserve', s.no_reserve, 'first_seen_at', s.first_seen_at, 'first_seen_7d', s.first_seen_7d,
        'updated_at', s.updated_at, 'lots_listed', s.lots_listed, 'listed_at', s.listed_at,
        'run_days', COALESCE(r.days, '[]'::jsonb), 'prior_sale', s.prior_sale) ORDER BY s.starts_on, s.house, s.sale_key)
      FROM sale s LEFT JOIN run_days r USING (hk, sale_key)
      WHERE s.starts_on IS NOT NULL AND s.starts_on < current_date + v_days), '[]'::jsonb),
    'unplaced', COALESCE((SELECT jsonb_agg(jsonb_build_object('house', s.house, 'sale_key', s.sale_key,
        'sale_name', s.sale_name, 'lots_listed', s.lots_listed, 'listed_at', s.listed_at) ORDER BY s.house, s.sale_key)
      FROM sale s WHERE s.starts_on IS NULL), '[]'::jsonb),
    'roster', CASE WHEN p_house IS NULL OR p_sale_key IS NULL THEN NULL ELSE jsonb_build_object(
      'house', p_house, 'sale_key', p_sale_key,
      'lots', (SELECT count(*) FROM lot WHERE hk = COALESCE(public.market_venue_label(p_house), p_house) AND sale_key = p_sale_key),
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
