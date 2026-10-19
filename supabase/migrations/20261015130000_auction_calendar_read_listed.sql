-- auction_calendar_read: each sale's lots landed against the lots the house lists, non-vehicle lots out, and earlier
-- results the house's own record has since confirmed (2026-10-15).
--   - listed: house_roster_census(), the newest source_census row per house with census_method 'house_roster_facet' (the Mecum intake lane
--     writes one per read of Mecum's lot index; by_category = {sale_key: lots listed}). A sale returns lots_listed and
--     listed_at beside lots (landed). A listed sale with no lot landed yet returns lots 0 when the census carries its days
--     (raw_response.sales.<key>.starts_on/ends_on), else it is returned in `unplaced` (name and count, no days).
--   - non-vehicle lots: vehicles.listing_kind 'non_vehicle_item' is left out, as on the market map (Mecum road art).
--   - earlier results: a 'sold' written by orphan-backfill-v1 stays 'unconfirmed' unless a sale correction on the vehicle
--     (vehicles.provenance_metadata.sale_provenance_corrections) cites this lot among source.lots, i.e. the house's own
--     result for this lot was read and applied.
-- Everything else is unchanged from 20261015070000_auction_calendar_read_updated_at.sql.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- The newest house roster census per house, with the house's slug. observation_sources is readable by signed-in users
-- only, so a logged-out calendar could not name the house of a census row; this returns that one public claim (lots
-- listed per sale, read time, sale names and days) and nothing else from either table.
CREATE OR REPLACE FUNCTION public.house_roster_census()
RETURNS TABLE (house text, census_at timestamptz, by_category jsonb, raw_response jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $hr$
  SELECT DISTINCT ON (c.source_id) o.slug, c.census_at, c.by_category,
         CASE WHEN jsonb_typeof(c.raw_response -> 'sales') = 'object'
              THEN jsonb_build_object('sales', c.raw_response -> 'sales') END
  FROM source_census c JOIN observation_sources o ON o.id = c.source_id
  WHERE c.census_method = 'house_roster_facet' AND jsonb_typeof(c.by_category) = 'object'
  ORDER BY c.source_id, c.census_at DESC
$hr$;
COMMENT ON FUNCTION public.house_roster_census() IS
  'Newest source_census row per house with census_method house_roster_facet: house slug, read time, lots listed per sale '
  '(by_category) and raw_response.sales (names and days) only. SECURITY DEFINER so a logged-out reader can name the house.';
REVOKE ALL ON FUNCTION public.house_roster_census() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.house_roster_census() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.auction_calendar_read(
  p_days integer DEFAULT 200,
  p_house text DEFAULT NULL,
  p_sale_key text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 200), 1), 400);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_result jsonb;
BEGIN
  WITH raw AS (
    SELECT e.id AS event_id, e.vehicle_id, e.source_platform AS house, e.source_url, e.metadata AS m, e.updated_at,
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
           v.year, v.make, v.model, v.primary_image_url AS image,
           (v.vin IS NOT NULL AND length(v.vin) >= 5) AS vin_present,
           CASE WHEN jsonb_typeof(v.provenance_metadata -> 'sale_provenance_corrections') = 'array'
                THEN v.provenance_metadata -> 'sale_provenance_corrections' ELSE '[]'::jsonb END AS corrections
    FROM vehicle_events e
    JOIN vehicles v ON v.id = e.vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL
     AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
    WHERE e.event_status IN ('upcoming', 'pending')
      AND e.ended_at >= date_trunc('day', now())
      AND e.ended_at < now() + make_interval(days => v_days)
      AND e.metadata->>'withdrawn_at' IS NULL
  ), lots AS (
    -- One lot per vehicle per sale: a house that renames a lot URL leaves two events for one car (Gooding Geneva,
    -- 2026-10-15: 15 events, 12 cars). Keep the newest event and the earliest time the car was first seen.
    SELECT DISTINCT ON (house, sale_key, vehicle_id) *,
           min(first_seen_at) OVER (PARTITION BY house, sale_key, vehicle_id) AS roster_first_seen
    FROM raw
    ORDER BY house, sale_key, vehicle_id, updated_at DESC NULLS LAST, event_id
  ), seen AS (
    SELECT l.event_id, count(p.id) AS prior_n
    FROM lots l
    LEFT JOIN vehicle_events p ON p.vehicle_id = l.vehicle_id AND p.id <> l.event_id
     AND p.event_status NOT IN ('upcoming', 'pending')
     AND COALESCE(p.ended_at, p.sold_at, p.created_at) < now()
    GROUP BY l.event_id
  ), lot AS (
    SELECT l.*, s.prior_n FROM lots l JOIN seen s USING (event_id)
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
    ORDER BY lot.run_on, NULLIF(regexp_replace(COALESCE(lot.m->>'lot_number', ''), '\D', '', 'g'), '')::bigint NULLS LAST,
             lot.m->>'lot_number', lot.event_id
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
          FROM sale WHERE starts_on IS NULL OR starts_on < current_date + v_days),
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
          'lot_number', NULLIF(NULLIF(pk.m->>'lot_number', ''), '0'), 'run_on', pk.run_on,
          'year', pk.year, 'make', pk.make, 'model', pk.model, 'image', pk.image, 'vin_present', pk.vin_present,
          'has_reserve', pk.has_reserve,
          'estimate_low', (pk.m->>'estimate_low')::numeric, 'estimate_high', (pk.m->>'estimate_high')::numeric,
          'currency', NULLIF(pk.m->>'currency', ''), 'first_seen_at', pk.roster_first_seen,
          'prior', COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'house', p.source_platform, 'on', COALESCE(p.ended_at, p.sold_at, p.created_at)::date,
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
        ORDER BY pk.run_on, NULLIF(regexp_replace(COALESCE(pk.m->>'lot_number', ''), '\D', '', 'g'), '')::bigint NULLS LAST,
                 pk.m->>'lot_number', pk.event_id)
        FROM picked pk), '[]'::jsonb)) END
  ) INTO v_result;
  RETURN v_result;
END
$fn$;

COMMENT ON FUNCTION public.auction_calendar_read(integer, text, text, integer, integer) IS
  'Scheduled auction sales from today to p_days ahead (upcoming/pending lots on public vehicles, non-vehicle lots out), each with lots landed and, from the newest house_roster_facet census, lots_listed; listed sales with no landed lot and no days in unplaced; population '
  'counts, and with p_house + p_sale_key one sale''s roster by run day: each lot''s vehicle, reserve, estimate and up to '
  'five earlier results on any venue (basis unconfirmed for orphan-backfill-v1 sold labels). Day precision. '
  'SECURITY INVOKER: callers see only what RLS already lets them read.';

REVOKE ALL ON FUNCTION public.auction_calendar_read(integer, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auction_calendar_read(integer, text, text, integer, integer) TO anon, authenticated, service_role;
