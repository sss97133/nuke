-- The auction calendar reads its lots from a read model, not from vehicle_events and vehicles on every call.
--
-- MEASURED 2026-10-15 14:4xZ (prod, during the Mecum roster walk): auction_calendar_read(400) as anon returned HTTP 500
-- (57014 statement timeout) twice, at 16.3 s and 16.0 s; the public calendar page was down. Parts, read-only as postgres:
-- finding the 1,744 upcoming lots with their public vehicles took 7.7 s (the plan is two bitmap index scans, ~1,900 rows;
-- the time is random heap reads of vehicle_events and vehicles while the disk is busy), and counting each lot's earlier
-- events was cancelled at 10 s. Population: 1,881 upcoming/pending events (1,678 upcoming, 203 pending).
--
-- CHANGE:
--   mv_auction_calendar_lots  one row per lot (house x sale x vehicle, the reader's own dedupe) for lots ending from
--                             yesterday through 401 days out: the reader's lot fields, the four metadata fields it shows
--                             (lot number, estimates as stored, currency), the earliest time the car was first seen,
--                             prior_n (its earlier events, as the reader counted them) and built_at. Public, undeleted,
--                             vehicle lots only, as before. Refreshed concurrently by job refresh-auction-calendar at :07
--                             and :37 under a 5 min limit; built in this migration.
--   auction_calendar_read     same signature, output and execution properties (SECURITY INVOKER, STABLE). It takes its
--                             lots from the read model filtered to [today, now + p_days) and adds population.lots_built_at,
--                             the read model's build time. A roster's earlier records (prior) are still read live, as the
--                             caller, for the at most 200 lots on the page.
-- Row security: vehicle_events is readable by everyone (policy vehicle_events_public_read: true) and vehicles when
-- is_public, so prior_n counted by the owner equals the caller's count; the read model holds public vehicles only. A
-- signed-in owner no longer sees their own private vehicle's upcoming lot on the public calendar.
-- Reversible: the previous reader body is 20261015130000 as patched by 20261015170000 (guarded below by its hash).
-- Contract: supabase/sql/test_calendar_prior_source_clock.sql (the reader's output is unchanged for anon, roster included).
BEGIN;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE v text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO v FROM pg_proc
  WHERE oid = 'public.auction_calendar_read(integer,text,text,integer,integer)'::regprocedure;
  IF v IS DISTINCT FROM 'x70Ikk+BKvJEApzpyq4++hB2EQnQzXIeI7c36Qkv8IY=' AND v IS DISTINCT FROM 'aLftZ3RfX2KkCLgQF3vSVy+aG6sXJUGdHAeQCt7chGw=' THEN
    RAISE EXCEPTION 'auction_calendar_read is not the 20261015170000 definition this replaces (sha256 %)', v;
  END IF;
END $guard$;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_auction_calendar_lots AS
WITH raw AS (
  SELECT e.id AS event_id, e.vehicle_id, e.source_platform AS house, e.source_url, e.updated_at, e.ended_at,
         COALESCE((e.metadata->>'roster_first_seen_at')::timestamptz, e.created_at) AS first_seen_at,
         COALESCE((e.metadata->'auction_session_days'->>0)::date, e.ended_at::date) AS run_on,
         -- A sale name that already ends in its year ("Dallas/Fort Worth 2026") keeps one year in the key.
         COALESCE(NULLIF(e.metadata->>'sale_key', ''),
                  regexp_replace(trim(BOTH '-' FROM lower(regexp_replace(COALESCE(e.metadata->>'auction_name', e.source_platform),
                                                                         '[^[:alnum:]]+', '-', 'g'))),
                                 '-' || extract(year FROM e.ended_at)::int || '$', '')
                    || '-' || extract(year FROM e.ended_at)::int) AS sale_key,
         COALESCE(NULLIF(e.metadata->>'auction_name', ''), initcap(e.source_platform) || ' sale') AS sale_name,
         NULLIF(e.metadata->>'sale_location', '') AS sale_location,
         (e.metadata->>'sale_starts_on')::date AS sale_starts_on,
         (e.metadata->>'sale_ends_on')::date AS sale_ends_on,
         CASE WHEN e.metadata ? 'has_reserve' THEN (e.metadata->>'has_reserve')::boolean END AS has_reserve,
         e.metadata->>'lot_number' AS lot_number,
         e.metadata->>'estimate_low' AS estimate_low,
         e.metadata->>'estimate_high' AS estimate_high,
         e.metadata->>'currency' AS currency,
         v.year, v.make, v.model, v.primary_image_url AS image,
         (v.vin IS NOT NULL AND length(v.vin) >= 5) AS vin_present
  FROM public.vehicle_events e
  JOIN public.vehicles v ON v.id = e.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL
   AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
  WHERE e.event_status IN ('upcoming', 'pending')
    AND e.ended_at >= date_trunc('day', now()) - interval '1 day'
    AND e.ended_at < now() + interval '401 days'
    AND e.metadata->>'withdrawn_at' IS NULL
), lots AS (
  -- One lot per vehicle per sale: a house that renames a lot URL leaves two events for one car (Gooding Geneva,
  -- 2026-10-15: 15 events, 12 cars). Keep the newest event and the earliest time the car was first seen.
  SELECT DISTINCT ON (house, sale_key, vehicle_id) *,
         min(first_seen_at) OVER (PARTITION BY house, sale_key, vehicle_id) AS roster_first_seen
  FROM raw
  ORDER BY house, sale_key, vehicle_id, updated_at DESC NULLS LAST, event_id
)
SELECT l.event_id, l.vehicle_id, l.house, l.source_url, l.updated_at, l.ended_at, l.run_on, l.sale_key, l.sale_name,
       l.sale_location, l.sale_starts_on, l.sale_ends_on, l.has_reserve, l.lot_number, l.estimate_low, l.estimate_high,
       l.currency, l.year, l.make, l.model, l.image, l.vin_present, l.roster_first_seen,
       (SELECT count(*) FROM public.vehicle_events p
        WHERE p.vehicle_id = l.vehicle_id AND p.id <> l.event_id
          AND p.event_status NOT IN ('upcoming', 'pending')
          AND COALESCE(p.ended_at, p.sold_at, p.created_at) < now()) AS prior_n,
       now() AS built_at
FROM lots l
WITH DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_auction_calendar_lots_event ON public.mv_auction_calendar_lots (event_id);
CREATE INDEX IF NOT EXISTS mv_auction_calendar_lots_sale ON public.mv_auction_calendar_lots (house, sale_key);
REVOKE ALL ON public.mv_auction_calendar_lots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mv_auction_calendar_lots TO anon, authenticated, service_role;
COMMENT ON MATERIALIZED VIEW public.mv_auction_calendar_lots IS
  'The auction calendar''s lots (20261016160000): one row per upcoming/pending lot of a public vehicle, house x sale x vehicle, ending yesterday through 401 days out, with its earlier-event count (prior_n) and build time. Read by auction_calendar_read; refreshed by job refresh-auction-calendar (:07, :37).';

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
    SELECT l.*, li.lots_listed, li.listed_at FROM landed l LEFT JOIN listed li USING (house, sale_key)
    UNION ALL
    SELECT li.house, li.sale_key, COALESCE(li.meta ->> 'name', initcap(replace(li.sale_key, '-', ' '))), NULL,
           (li.meta ->> 'starts_on')::date, (li.meta ->> 'ends_on')::date, 0, 0, 0, NULL, 0, NULL, li.lots_listed, li.listed_at
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
        'run_days', COALESCE(r.days, '[]'::jsonb)) ORDER BY s.starts_on, s.house, s.sale_key)
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

DO $job$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-auction-calendar') THEN
    PERFORM cron.schedule('refresh-auction-calendar', '7,37 * * * *',
      $cmd$SET statement_timeout = '5min'; REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_auction_calendar_lots$cmd$);
  END IF;
END $job$;

COMMIT;
