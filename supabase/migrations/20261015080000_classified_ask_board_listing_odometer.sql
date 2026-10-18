-- classified_ask_board carries what each listing says about its odometer and title, so a disclosed broken odometer
-- is never shown as a mileage.
--
-- Found 2026-10-15 (market integration review, private receipt verified-odometer-gap.json): a 1969 Ford F600 listed
-- with "odometer broken" read "10 mi" on the board, from vehicles.mileage. The listing observation the event points at
-- (vehicle_events.metadata.observation_id) holds the listing's own attributes. In the 24 h to 02:10Z: 621 Craigslist
-- arrivals, all with that pointer; 619 state miles, 38 disclose a broken odometer and 38 a rolled-over one (2 both),
-- and 32 a title other than clean (lien, missing, parts only, rebuilt, salvage).
-- Per row, for the page only (one primary-key read each, never for the whole window):
--   - listing_mileage: the listing's stated miles (digits only, up to 7);
--   - odometer: 'broken' or 'rolled_over' when the seller disclosed it (broken wins when both);
--   - title_status: as stated, lower case;
--   - observation_id: the listing observation they come from.
-- An observation about another vehicle is not read. anon reads these observations already
-- (policy garage_correction_private_read). The body is otherwise the 20261015070000 body, guarded by its hash.
-- Contract: supabase/sql/test_classified_ask_board.sql (frontend-tests, classified ask board step).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
DECLARE v text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO v
  FROM pg_proc WHERE oid = 'public.classified_ask_board(integer,double precision,double precision,integer,integer,text,text,integer,integer)'::regprocedure;
  IF v IS DISTINCT FROM 'CipBgz6bgrnTIO9V32ZuwFDV4BvxyE0G8AUdwrx9uN0=' AND v IS DISTINCT FROM '2wRKul4/2BnP7TJze1jUL3TZ5QrIfTDWMtWQKyMTdV8=' THEN
    RAISE EXCEPTION 'classified_ask_board is not the 20261015070000 body (sha256 %); not replacing it', v;
  END IF;
END $guard$;

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
           THEN (ve.metadata->>'listing_posted_at')::timestamptz END AS posted_at,
      CASE WHEN ve.metadata->>'observation_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN (ve.metadata->>'observation_id')::uuid END AS observation_id
    FROM public.vehicle_events ve
    WHERE ve.source_platform IN ('craigslist', 'facebook_marketplace', 'ksl')
      AND ve.created_at >= v_since
      AND ve.vehicle_id IS NOT NULL
    ORDER BY ve.vehicle_id, ve.created_at DESC, ve.id DESC
  ), shaped AS (
    SELECT ev.*, least(ev.posted_at, ev.created_at) AS listed_at,
      v.year, v.make, v.model, v.drivetrain, v.body_style, v.mileage, v.primary_image_url,
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
      p.listed_at DESC, p.id DESC
    LIMIT v_limit OFFSET v_offset
  ), told AS (
    -- What the listing itself says, for the page's rows only: its stated miles, an odometer the seller disclosed as
    -- broken or rolled over, and the title status. Read from the listing observation the event points at, and only
    -- when that observation is about the same vehicle.
    SELECT page.*, o.listing_mileage, o.odometer, o.title_status
    FROM page
    LEFT JOIN LATERAL (
      SELECT CASE WHEN vo.structured_data->>'mileage' ~ '^[0-9]{1,7}$' THEN (vo.structured_data->>'mileage')::integer END AS listing_mileage,
             CASE WHEN vo.structured_data->>'odometer_broken' = 'true' THEN 'broken'
                  WHEN vo.structured_data->>'odometer_rolled_over' = 'true' THEN 'rolled_over' END AS odometer,
             nullif(lower(btrim(vo.structured_data->>'title_status')), '') AS title_status
      FROM public.vehicle_observations vo
      WHERE vo.id = page.observation_id AND vo.vehicle_id = page.vehicle_id
    ) o ON true
  )
  SELECT jsonb_build_object(
    'as_of', now(),
    'since', v_since,
    'newest_at', (SELECT max(listed_at) FROM shaped),
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
        'asking_price', current_price, 'tier', tier, 'first_seen_at', created_at, 'posted_at', posted_at, 'listed_at', listed_at,
        'year', year, 'make', make, 'model', model, 'drivetrain', drivetrain, 'body_style', body_style,
        'mileage', mileage, 'listing_mileage', listing_mileage, 'odometer', odometer, 'title_status', title_status,
        'observation_id', observation_id, 'image', primary_image_url,
        'city', city, 'region', region_code, 'lat', lat, 'lng', lng, 'distance_mi', distance_mi,
        'taste', taste, 'in_band', taste >= v_band)
      ORDER BY
        CASE WHEN p_sort = 'nearest' THEN distance_mi END ASC NULLS LAST,
        CASE WHEN p_sort = 'band' THEN taste END DESC NULLS LAST,
        CASE WHEN p_sort = 'price' THEN current_price END ASC NULLS LAST,
        listed_at DESC, id DESC) FROM told), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END
$$;

COMMENT ON FUNCTION public.classified_ask_board(integer, double precision, double precision, integer, integer, text, text, integer, integer) IS
  'Classified asks (Craigslist, Facebook Marketplace, KSL) first seen in the last p_hours (1..168), one row per vehicle, '
  'with place (city, region, point rounded to 0.01 degree), distance from an optional point, the owner''s taste score '
  '(compute_taste_score; band = taste >= band_min_taste) and a five-band asking-price tier. Returns the population '
  '(asks, priced, with a point, in the band, by source, by tier) and newest_at (the newest listed_at the caller can '
  'see in the window) beside the matching count and one page of rows. listed_at = least(posted_at, first seen); '
  'newest first orders by it. Page rows carry what the listing says: listing_mileage, odometer (broken | rolled_over) '
  'and title_status, from the listing observation (observation_id). '
  'SECURITY INVOKER: callers see only what RLS already lets them read.';

REVOKE ALL ON FUNCTION public.classified_ask_board(integer, double precision, double precision, integer, integer, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classified_ask_board(integer, double precision, double precision, integer, integer, text, text, integer, integer) TO anon, authenticated, service_role;

DO $check$
BEGIN
  IF position('title_status' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.classified_ask_board(integer,double precision,double precision,integer,integer,text,text,integer,integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'classified_ask_board did not gain the listing''s odometer and title';
  END IF;
END $check$;

COMMIT;
