-- Read-only seller-profile readers for the iOS seller page (MarketSellerView).
-- Adds three STABLE SECURITY DEFINER functions; no table, view, or existing function is changed.
--   bat_seller_profile(handle)   one BaT account's listings with outcome, price and photo, plus stats.
--   bat_market_baseline(months)  BaT-wide sell-through / median / average sold over a recent window.
--   bat_listing_cohort(vehicle)  median sold price of comparable BaT sales for one car.
-- Why a new reader: get_seller_analytics / get_seller_stats read bat_listings only (44 and 37 of Viva Las Vegas
-- Autos' 70 captured BaT listings), and the ZIP card's count is a ZIP-cohort count, not a seller total.
-- Listing identity = the BaT listing URL without #fragment or trailing slash. Outcome is resolved over every
-- auction_events row of the same vehicle and URL, because the canonical duplicate survivor often has no seller_name.
-- Only public, undeleted, non-merged vehicles are read. Rollback: DROP FUNCTION for each of the three functions.

CREATE OR REPLACE FUNCTION public.bat_seller_profile(p_handle text, p_limit integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '10s'
AS $function$
  WITH mine AS MATERIALIZED (
    SELECT DISTINCT e.vehicle_id,
           regexp_replace(regexp_replace(e.source_url, '#.*$', ''), '/+$', '') AS k
    FROM public.auction_events e
    WHERE e.source = 'bat' AND e.seller_name = p_handle AND e.source_url IS NOT NULL AND e.vehicle_id IS NOT NULL
  ), elig AS MATERIALIZED (
    SELECT v.id, v.year, v.make, v.model, v.primary_image_url
    FROM public.vehicles v
    WHERE v.id IN (SELECT vehicle_id FROM mine)
      AND v.is_public IS TRUE AND v.deleted_at IS NULL
      AND coalesce(v.status, '') NOT IN ('deleted', 'merged', 'rejected', 'duplicate')
      AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
  ), sib AS MATERIALIZED (
    SELECT e.vehicle_id, e.outcome, e.auction_end_date, e.total_bids, e.seller_name,
           coalesce(e.winning_bid, e.high_bid) AS amt,
           regexp_replace(regexp_replace(e.source_url, '#.*$', ''), '/+$', '') AS k
    FROM public.auction_events e
    WHERE e.source = 'bat' AND e.vehicle_id IN (SELECT id FROM elig) AND e.source_url IS NOT NULL
  ), listing AS MATERIALIZED (
    SELECT m.k, m.vehicle_id,
           bool_or(s.outcome = 'sold' AND s.amt > 0) AS sold,
           bool_or(s.outcome IN ('no_sale', 'reserve_not_met')) AS not_sold,
           coalesce(max(s.amt) FILTER (WHERE s.outcome = 'sold' AND s.amt > 0 AND s.seller_name = p_handle),
                    max(s.amt) FILTER (WHERE s.outcome = 'sold' AND s.amt > 0)) AS price,
           max(s.auction_end_date) AS ends_at,
           max(s.total_bids) AS bids
    FROM (SELECT DISTINCT ON (k) k, vehicle_id FROM mine
          WHERE vehicle_id IN (SELECT id FROM elig) ORDER BY k, vehicle_id) m
    JOIN sib s ON s.vehicle_id = m.vehicle_id AND s.k = m.k
    GROUP BY m.k, m.vehicle_id
  ), cls AS MATERIALIZED (
    SELECT l.k, l.vehicle_id, l.price, l.ends_at, l.bids, e.year, e.make, e.model, e.primary_image_url,
           CASE WHEN l.sold THEN 'sold'
                WHEN l.ends_at > now() AND NOT l.not_sold THEN 'live'
                WHEN l.not_sold THEN 'not_sold'
                ELSE 'unresolved' END AS status
    FROM listing l JOIN elig e ON e.id = l.vehicle_id
  ), agg AS (
    SELECT count(*) AS listings,
           count(*) FILTER (WHERE status = 'sold') AS sold,
           count(*) FILTER (WHERE status = 'not_sold') AS not_sold,
           count(*) FILTER (WHERE status = 'live') AS live,
           count(*) FILTER (WHERE status = 'unresolved') AS unresolved,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY price) FILTER (WHERE status = 'sold') AS median_sold,
           avg(price) FILTER (WHERE status = 'sold') AS avg_sold,
           max(price) FILTER (WHERE status = 'sold') AS max_sold,
           min(price) FILTER (WHERE status = 'sold') AS min_sold,
           sum(price) FILTER (WHERE status = 'sold') AS total_sold_usd,
           min(ends_at) AS first_listing, max(ends_at) FILTER (WHERE status <> 'live') AS last_listing
    FROM cls
  ), agg12 AS (
    SELECT count(*) FILTER (WHERE status IN ('sold', 'not_sold')) AS closed,
           count(*) FILTER (WHERE status = 'sold') AS sold,
           count(*) FILTER (WHERE status = 'not_sold') AS not_sold,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY price) FILTER (WHERE status = 'sold') AS median_sold,
           avg(price) FILTER (WHERE status = 'sold') AS avg_sold
    FROM cls WHERE ends_at >= now() - interval '12 months' AND ends_at < now()
  )
  SELECT jsonb_build_object(
    'handle', p_handle,
    'all_time', (SELECT jsonb_build_object(
        'listings', listings, 'sold', sold, 'not_sold', not_sold, 'live', live, 'unresolved', unresolved,
        'sell_through', CASE WHEN sold + not_sold > 0 THEN round(sold::numeric / (sold + not_sold), 4) END,
        'median_sold', median_sold, 'avg_sold', round(avg_sold), 'max_sold', max_sold, 'min_sold', min_sold,
        'total_sold_usd', total_sold_usd, 'first_listing', first_listing, 'last_listing', last_listing) FROM agg),
    'last_12m', (SELECT jsonb_build_object(
        'closed', closed, 'sold', sold, 'not_sold', not_sold,
        'sell_through', CASE WHEN sold + not_sold > 0 THEN round(sold::numeric / (sold + not_sold), 4) END,
        'median_sold', median_sold, 'avg_sold', round(avg_sold)) FROM agg12),
    'listings', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'vehicle_id', vehicle_id, 'url', k, 'year', year, 'make', make, 'model', model,
        'image_url', primary_image_url, 'status', status, 'price', price, 'ends_at', ends_at, 'bids', bids)
        ORDER BY (status = 'live') DESC, ends_at DESC NULLS LAST, vehicle_id)
      FROM (SELECT * FROM cls ORDER BY (status = 'live') DESC, ends_at DESC NULLS LAST, vehicle_id
            LIMIT greatest(1, least(coalesce(p_limit, 60), 200))) t), '[]'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.bat_market_baseline(p_months integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '10s'
AS $function$
  SELECT jsonb_build_object(
    'months', greatest(1, least(coalesce(p_months, 12), 36)),
    'sold', count(*) FILTER (WHERE e.outcome = 'sold' AND coalesce(e.winning_bid, e.high_bid) > 0),
    'not_sold', count(*) FILTER (WHERE e.outcome IN ('no_sale', 'reserve_not_met')),
    'sell_through', CASE WHEN count(*) FILTER (WHERE e.outcome IN ('sold', 'no_sale', 'reserve_not_met')) > 0
        THEN round((count(*) FILTER (WHERE e.outcome = 'sold' AND coalesce(e.winning_bid, e.high_bid) > 0))::numeric
             / nullif(count(*) FILTER (WHERE (e.outcome = 'sold' AND coalesce(e.winning_bid, e.high_bid) > 0)
                                          OR e.outcome IN ('no_sale', 'reserve_not_met')), 0), 4) END,
    'median_sold', percentile_cont(0.5) WITHIN GROUP (ORDER BY coalesce(e.winning_bid, e.high_bid))
        FILTER (WHERE e.outcome = 'sold' AND coalesce(e.winning_bid, e.high_bid) > 0),
    'avg_sold', round(avg(coalesce(e.winning_bid, e.high_bid))
        FILTER (WHERE e.outcome = 'sold' AND coalesce(e.winning_bid, e.high_bid) > 0)))
  FROM public.auction_events e
  WHERE e.source = 'bat' AND e.duplicate_of IS NULL AND e.auction_end_date < now()
    AND e.auction_end_date >= now() - make_interval(months => greatest(1, least(coalesce(p_months, 12), 36)));
$function$;

CREATE OR REPLACE FUNCTION public.bat_listing_cohort(p_vehicle_id uuid, p_exclude_handle text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '8s'
AS $function$
  -- Comparable sales: same make and normalized model, model year within 2, BaT sold within 24 months of this car's own
  -- sale (or of today when it has none), this car and the excluded seller's cars left out. Trim-blind by design:
  -- normalized_model is the model family. Medians are withheld below 5 comparables.
  WITH ref AS MATERIALIZED (
    SELECT v.id, v.year, lower(v.make) AS make, lower(v.normalized_model) AS nm,
           coalesce(v.sale_date, current_date) AS d
    FROM public.vehicles v
    WHERE v.id = p_vehicle_id AND v.is_public IS TRUE AND v.deleted_at IS NULL
      AND v.year IS NOT NULL AND v.make IS NOT NULL AND v.normalized_model IS NOT NULL
  ), seller_cars AS MATERIALIZED (
    SELECT DISTINCT vehicle_id FROM public.auction_events
    WHERE p_exclude_handle IS NOT NULL AND source = 'bat' AND seller_name = p_exclude_handle
  ), comps AS MATERIALIZED (
    SELECT coalesce(v.sale_price_usd, v.sale_price) AS price, v.year
    FROM ref r JOIN public.vehicles v
      ON lower(v.make) = r.make AND lower(v.normalized_model) = r.nm AND v.year BETWEEN r.year - 2 AND r.year + 2
    WHERE v.id <> r.id AND v.is_public IS TRUE AND v.deleted_at IS NULL
      AND v.sale_price > 0 AND v.sale_date IS NOT NULL AND v.canonical_platform = 'bat'
      AND coalesce(v.status, '') NOT IN ('deleted', 'merged', 'rejected', 'duplicate')
      AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
      AND v.sale_date BETWEEN r.d - interval '24 months' AND r.d + interval '24 months'
      AND v.id NOT IN (SELECT vehicle_id FROM seller_cars)
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM ref) THEN NULL ELSE jsonb_build_object(
    'basis', 'make + normalized model, model year +/-2, BaT sold +/-24 months',
    'n', (SELECT count(*) FROM comps),
    'median', (SELECT CASE WHEN count(*) >= 5 THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY price) END FROM comps),
    'avg', (SELECT CASE WHEN count(*) >= 5 THEN round(avg(price)) END FROM comps),
    'n_same_year', (SELECT count(*) FROM comps, ref WHERE comps.year = ref.year),
    'median_same_year', (SELECT CASE WHEN count(*) >= 5 THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY price) END
                         FROM comps, ref WHERE comps.year = ref.year)) END;
$function$;

GRANT EXECUTE ON FUNCTION public.bat_seller_profile(text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bat_market_baseline(integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bat_listing_cohort(uuid, text) TO anon, authenticated, service_role;
