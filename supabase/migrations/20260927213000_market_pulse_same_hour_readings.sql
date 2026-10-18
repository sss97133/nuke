-- market_pulse_live(): the same-weekday-and-hour baseline returns its readings, not only low/high.
--
-- The homepage showed "same time on Sundays, last 11 weeks: $34.3M - $47.7M" as a bare range. With the
-- individual readings the page can draw each week as a tick and say where now ranks ("higher than 10 of 11
-- Sundays at this hour"): a distribution with its n, not a range. Adds same_hour.readings =
-- [[value_date, bids], ...] (at most 12 small pairs). Nothing else in the function changes.

SET statement_timeout = '120s';

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
           v.title
    FROM public.vehicles v
    LEFT JOIN public.canonical_makes cm ON cm.id = v.canonical_make_id
    WHERE v.sale_status = 'auction_live'
      AND v.platform_source = 'bringatrailer'
      AND v.auction_end_date IS NOT NULL
      AND v.auction_end_date::timestamptz > now()
  )
  SELECT jsonb_build_object(
    'synced_at', (SELECT max(updated_at) FROM live),
    'source', 'Bring a Trailer live auctions page, read every 15 minutes by sync-live-auctions',
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
               image_url, no_reserve, listing_url, title)
             ORDER BY ends_at)
      FROM live), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.market_pulse_live() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_pulse_live() TO anon, authenticated, service_role;

RESET statement_timeout;

NOTIFY pgrst, 'reload schema';

-- POST-APPLY (read-only):
--   SELECT public.market_pulse_live()->'baseline'->'same_hour'->'readings';   -- ~11 [date, bids] pairs
