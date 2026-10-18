-- classified_ask_board: the classified asks that came online in a window, nationwide, with three lenses the owner asked
-- for on 2026-10-13: near a point, his band, and the price tier ("what's happening at different levels of the economy").
--
-- Grain: one row per vehicle (its newest classified event in the window), so a post re-read twice counts once.
-- Reads only what anon can already read: vehicle_events (public), vehicles (is_public), and listing rows of
-- vehicle_location_observations (confidence >= 0.5). SECURITY INVOKER, so RLS applies to the caller.
--   - place: the newest listing row for the same vehicle and post URL (Craigslist writes it from the page's JSON-LD);
--     the point is rounded to 0.01 degree, coarser than Craigslist's own moved pin.
--   - band: compute_taste_score, the existing scorer of the owner's taste (make, model, year, body, region). It is
--     applied in production and not in this repo; this migration calls it and does not redefine it. band_min_taste
--     is returned with the result so the cutoff is visible.
--   - tier: the asking price in dollars, five bands. An unpriced ask is counted, never tiered.
-- Every count comes with its population: asks in the window, priced, with a point, in the band, per tier.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.classified_ask_board(
  p_hours integer DEFAULT 24,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_radius_mi integer DEFAULT NULL,
  p_min_taste integer DEFAULT NULL,
  p_tier text DEFAULT NULL,
  p_sort text DEFAULT 'newest',
  p_limit integer DEFAULT 60,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hours integer := least(greatest(coalesce(p_hours, 24), 1), 168);
  v_limit integer := least(greatest(coalesce(p_limit, 60), 1), 200);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 5000);
  v_since timestamptz := now() - make_interval(hours => least(greatest(coalesce(p_hours, 24), 1), 168));
  v_band integer := 60;
  v_out jsonb;
BEGIN
  IF (p_lat IS NULL) <> (p_lng IS NULL) OR abs(p_lat) > 90 OR abs(p_lng) > 180 THEN
    RAISE EXCEPTION 'p_lat and p_lng come together, as degrees' USING ERRCODE = '22023';
  END IF;
  IF p_radius_mi IS NOT NULL AND (p_lat IS NULL OR p_radius_mi < 1 OR p_radius_mi > 3000) THEN
    RAISE EXCEPTION 'p_radius_mi needs a point and is 1..3000 miles' USING ERRCODE = '22023';
  END IF;
  IF p_tier IS NOT NULL AND p_tier NOT IN ('under_5k', '5k_15k', '15k_40k', '40k_100k', '100k_plus') THEN
    RAISE EXCEPTION 'unknown tier %', p_tier USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_sort, 'newest') NOT IN ('newest', 'nearest', 'band', 'price') OR (p_sort = 'nearest' AND p_lat IS NULL) THEN
    RAISE EXCEPTION 'p_sort is newest, nearest (with a point), band or price' USING ERRCODE = '22023';
  END IF;

  WITH ev AS (
    SELECT DISTINCT ON (ve.vehicle_id)
      ve.id, ve.vehicle_id, ve.source_platform, ve.source_url, ve.current_price, ve.created_at,
      CASE WHEN ve.metadata->>'listing_posted_at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
           THEN (ve.metadata->>'listing_posted_at')::timestamptz END AS posted_at
    FROM public.vehicle_events ve
    WHERE ve.source_platform IN ('craigslist', 'facebook_marketplace', 'ksl')
      AND ve.created_at >= v_since
      AND ve.vehicle_id IS NOT NULL
    ORDER BY ve.vehicle_id, ve.created_at DESC, ve.id DESC
  ), shaped AS (
    SELECT ev.*, v.year, v.make, v.model, v.drivetrain, v.body_style, v.mileage, v.primary_image_url,
      loc.city, loc.region_code,
      round(loc.latitude::numeric, 2) AS lat, round(loc.longitude::numeric, 2) AS lng,
      public.compute_taste_score(concat_ws(' ', v.year, v.make, v.model, v.body_style, v.drivetrain), v.year, v.make,
        v.model, coalesce(loc.city || ', ' || loc.region_code, v.location))::integer AS taste,
      CASE WHEN ev.current_price IS NULL OR ev.current_price <= 0 THEN NULL
           WHEN ev.current_price < 5000 THEN 'under_5k'
           WHEN ev.current_price < 15000 THEN '5k_15k'
           WHEN ev.current_price < 40000 THEN '15k_40k'
           WHEN ev.current_price < 100000 THEN '40k_100k'
           ELSE '100k_plus' END AS tier,
      CASE WHEN p_lat IS NOT NULL AND loc.latitude IS NOT NULL THEN
        round((3958.8 * 2 * asin(least(1.0, sqrt(
          power(sin(radians(loc.latitude - p_lat) / 2), 2)
          + cos(radians(p_lat)) * cos(radians(loc.latitude)) * power(sin(radians(loc.longitude - p_lng) / 2), 2)))))::numeric)
      END AS distance_mi
    FROM ev
    JOIN public.vehicles v ON v.id = ev.vehicle_id
      AND v.deleted_at IS NULL AND v.is_public IS TRUE
      AND (v.listing_kind IS NULL OR v.listing_kind <> 'non_vehicle_item')
    LEFT JOIN LATERAL (
      SELECT o.city, o.region_code, o.latitude, o.longitude
      FROM public.vehicle_location_observations o
      WHERE o.vehicle_id = ev.vehicle_id AND o.source_type = 'listing' AND o.source_url = ev.source_url
      ORDER BY o.observed_at DESC
      LIMIT 1
    ) loc ON true
  ), picked AS (
    SELECT * FROM shaped s
    WHERE (p_tier IS NULL OR s.tier = p_tier)
      AND (p_min_taste IS NULL OR s.taste >= p_min_taste)
      AND (p_radius_mi IS NULL OR s.distance_mi <= p_radius_mi)
  ), page AS (
    SELECT * FROM picked p
    ORDER BY
      CASE WHEN p_sort = 'nearest' THEN p.distance_mi END ASC NULLS LAST,
      CASE WHEN p_sort = 'band' THEN p.taste END DESC NULLS LAST,
      CASE WHEN p_sort = 'price' THEN p.current_price END ASC NULLS LAST,
      p.created_at DESC, p.id DESC
    LIMIT v_limit OFFSET v_offset
  )
  SELECT jsonb_build_object(
    'as_of', now(),
    'since', v_since,
    'window_hours', v_hours,
    'band_min_taste', v_band,
    'population', (SELECT jsonb_build_object(
        'asks', count(*),
        'priced', count(tier),
        'with_point', count(lat),
        'in_band', count(*) FILTER (WHERE taste >= v_band),
        'by_source', coalesce((SELECT jsonb_object_agg(source_platform, n) FROM (
          SELECT source_platform, count(*) AS n FROM shaped GROUP BY 1) x), '{}'::jsonb),
        'by_tier', coalesce((SELECT jsonb_object_agg(coalesce(tier, 'unpriced'), n) FROM (
          SELECT tier, count(*) AS n FROM shaped GROUP BY 1) x), '{}'::jsonb))
      FROM shaped),
    'matching', (SELECT count(*) FROM picked),
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'event_id', id, 'vehicle_id', vehicle_id, 'source', source_platform, 'url', source_url,
        'asking_price', current_price, 'tier', tier, 'first_seen_at', created_at, 'posted_at', posted_at,
        'year', year, 'make', make, 'model', model, 'drivetrain', drivetrain, 'body_style', body_style,
        'mileage', mileage, 'image', primary_image_url,
        'city', city, 'region', region_code, 'lat', lat, 'lng', lng, 'distance_mi', distance_mi,
        'taste', taste, 'in_band', taste >= v_band)
      ORDER BY
        CASE WHEN p_sort = 'nearest' THEN distance_mi END ASC NULLS LAST,
        CASE WHEN p_sort = 'band' THEN taste END DESC NULLS LAST,
        CASE WHEN p_sort = 'price' THEN current_price END ASC NULLS LAST,
        created_at DESC, id DESC) FROM page), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END
$$;

COMMENT ON FUNCTION public.classified_ask_board(integer, double precision, double precision, integer, integer, text, text, integer, integer) IS
  'Classified asks (Craigslist, Facebook Marketplace, KSL) first seen in the last p_hours (1..168), one row per vehicle, '
  'with place (city, region, point rounded to 0.01 degree), distance from an optional point, the owner''s taste score '
  '(compute_taste_score; band = taste >= band_min_taste) and a five-band asking-price tier. Returns the population '
  '(asks, priced, with a point, in the band, by source, by tier) beside the matching count and one page of rows. '
  'SECURITY INVOKER: callers see only what RLS already lets them read.';

REVOKE ALL ON FUNCTION public.classified_ask_board(integer, double precision, double precision, integer, integer, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classified_ask_board(integer, double precision, double precision, integer, integer, text, text, integer, integer) TO anon, authenticated, service_role;
