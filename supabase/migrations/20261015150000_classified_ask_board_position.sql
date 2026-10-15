-- classified_ask_board says what each listing is and where its ask sits, so a listing can rise by what it is.
--
-- Skylar, 2026-10-15: the feed is led by Craigslist "not cuz its good but cuz its easy"; a listing should rise by what
-- it is, defined in keys and folds with citation, never by anyone's taste in the code. Each row now carries:
--   position: its factory model family (mv_model_family_names; the family's years with one year of slack) and, from
--     mv_family_year_prices for its model year (the fold's cited year window):
--       sold   the family's recorded sales: n, years, p25/p50/p75, at_or_below (how many sold at or below this ask),
--              offered, conflicts (sales refused because their own page is another car), first/last sale, by_source;
--       asked  other classified asks in the 365 days before the fold's refresh: the same, without this listing.
--     thin (fewer than 10) carries no percentiles and no at_or_below.
--   merit: the active listing_exit_models row's chance that a listing like this is gone within its horizon, computed
--     from the position (every feature the model names must be present; nothing is imputed). Null until a model is
--     active; p_sort => 'merit' orders by it, nulls last.
--   condition: the seller's declared condition, as stated (lower case), from the listing observation the row already
--     reads for miles and title: an attributed claim, not an inspection.
-- The response adds newest_seen_at (the newest first sighting in the window: capture time, where newest_at is posting
-- time), merit_model (the active model's version, horizon and base rate) and population counts keyed (rows with a
-- family), positioned_sold, positioned_asked and with_merit. compute_taste_score and the band are unchanged.
-- The body is otherwise the 20261015080000 body, guarded by its hash.
-- Contract: supabase/sql/test_classified_ask_board.sql (frontend-tests, classified ask board step).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
DECLARE v text;
BEGIN
  SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') INTO v
  FROM pg_proc WHERE oid = 'public.classified_ask_board(integer,double precision,double precision,integer,integer,text,text,integer,integer)'::regprocedure;
  IF v IS DISTINCT FROM '2wRKul4/2BnP7TJze1jUL3TZ5QrIfTDWMtWQKyMTdV8=' AND v IS DISTINCT FROM 'pHRpEW1AbLhotvpAhsBtS5AaJMl89Y1+QowPySC8Czo=' THEN
    RAISE EXCEPTION 'classified_ask_board is not the 20261015080000 body (sha256 %); not replacing it', v;
  END IF;
  IF to_regclass('public.mv_family_year_prices') IS NULL OR to_regclass('public.listing_exit_models') IS NULL THEN
    RAISE EXCEPTION 'apply 20261015130000_family_year_prices.sql and 20261015140000_listing_exit_models.sql first';
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
  IF coalesce(p_sort, 'newest') NOT IN ('newest', 'nearest', 'band', 'price', 'merit') OR (p_sort = 'nearest' AND p_lat IS NULL) THEN
    RAISE EXCEPTION 'p_sort is newest, nearest (with a point), band, price or merit' USING ERRCODE = '22023';
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
  ), model AS (
    -- The active exit model (listing_exit_models): its weights are fitted on recorded exits, not typed here.
    SELECT m.version, m.horizon_days, m.intercept, m.features, m.base_rate FROM public.listing_exit_models m WHERE m.active LIMIT 1
  ), known AS (
    -- What the listing is: its factory model family (mv_model_family_names; the family's years with one year of slack)
    -- and where its ask sits among the family's recorded sales and other classified asks around its model year
    -- (mv_family_year_prices, its cited year window). at_or_below counts the pooled prices at or below the ask. A
    -- listing first seen before the fold's refresh day is itself one of the asks, so it is taken out of their count.
    SELECT s.*, fam.family_id, fam.family,
      fs.n AS sold_n, fs.thin AS sold_thin, fs.year_from AS sold_from, fs.year_to AS sold_to,
      fs.p25 AS sold_p25, fs.p50 AS sold_p50, fs.p75 AS sold_p75, fs.offered AS sold_offered, fs.conflicts AS sold_conflicts,
      fs.first_on AS sold_first, fs.last_on AS sold_last, fs.by_source AS sold_sources, fs.as_of AS sold_as_of,
      CASE WHEN fs.thin IS FALSE AND s.current_price > 0 THEN width_bucket(s.current_price, fs.prices) END AS sold_below,
      fa.n - ai.self AS asked_n, fa.year_from AS asked_from, fa.year_to AS asked_to,
      fa.p25 AS asked_p25, fa.p50 AS asked_p50, fa.p75 AS asked_p75, fa.by_source AS asked_sources, fa.as_of AS asked_as_of,
      CASE WHEN fa.n - ai.self >= 10 AND s.current_price > 0
           THEN greatest(width_bucket(s.current_price, fa.prices) - ai.self, 0) END AS asked_below
    FROM shaped s
    LEFT JOIN public.mv_model_family_names fam
      ON fam.make_l = lower(s.make) AND fam.model_l = lower(coalesce(s.model, '')) AND fam.family_id IS NOT NULL
      AND s.year IS NOT NULL AND (fam.year_start IS NULL OR s.year >= fam.year_start - 1)
      AND (fam.year_end IS NULL OR s.year <= fam.year_end + 1)
    LEFT JOIN public.mv_family_year_prices fs ON fs.family_id = fam.family_id AND fs.year = s.year AND fs.basis = 'sold'
    LEFT JOIN public.mv_family_year_prices fa ON fa.family_id = fam.family_id AND fa.year = s.year AND fa.basis = 'asked'
    CROSS JOIN LATERAL (
      SELECT CASE WHEN fa.as_of IS NOT NULL AND s.current_price > 0 AND s.created_at < fa.as_of::date
                   AND s.created_at >= fa.as_of::date - 365 THEN 1 ELSE 0 END AS self
    ) ai
  ), scored AS (
    -- merit: the active model's chance that a listing like this is gone within its horizon, from the position above.
    -- Every feature the model names must be present for this listing; otherwise merit is null (nothing is imputed).
    SELECT k.*, mm.exit7
    FROM known k
    LEFT JOIN LATERAL (
      SELECT CASE WHEN count(*) > 0 AND count(*) FILTER (WHERE fv.v IS NULL) = 0 THEN
               1 / (1 + exp(-(max(md.intercept)
                 + sum((f->>'coef')::float8 * (fv.v - (f->>'mean')::float8) / nullif((f->>'sd')::float8, 0)))))
             END AS exit7
      FROM model md
      CROSS JOIN LATERAL jsonb_array_elements(md.features) f
      CROSS JOIN LATERAL (SELECT CASE f->>'name'
          WHEN 'log_sold_p50_over_ask' THEN CASE WHEN k.sold_p50 > 0 AND k.current_price > 0
                                                 THEN ln(k.sold_p50::float8 / k.current_price::float8) END
          WHEN 'share_sold_at_or_below' THEN k.sold_below::float8 / nullif(k.sold_n, 0)
          WHEN 'log_sold_n' THEN CASE WHEN k.sold_below IS NOT NULL THEN ln(k.sold_n::float8) END
          WHEN 'sell_through' THEN CASE WHEN k.sold_below IS NOT NULL THEN k.sold_n::float8 / nullif(k.sold_offered, 0) END
          WHEN 'log_ask' THEN CASE WHEN k.current_price > 0 THEN ln(k.current_price::float8) END
          WHEN 'log_asked_p50_over_ask' THEN CASE WHEN k.asked_below IS NOT NULL AND k.asked_p50 > 0
                                                  THEN ln(k.asked_p50::float8 / k.current_price::float8) END
          WHEN 'share_asked_at_or_below' THEN k.asked_below::float8 / nullif(k.asked_n, 0)
          WHEN 'log_asked_n' THEN CASE WHEN k.asked_below IS NOT NULL THEN ln(k.asked_n::float8) END
        END AS v) fv
    ) mm ON true
  ), picked AS (
    SELECT * FROM scored s
    WHERE (p_tier IS NULL OR s.tier = p_tier)
      AND (p_min_taste IS NULL OR s.taste >= p_min_taste)
      AND (p_radius_mi IS NULL OR s.distance_mi <= p_radius_mi)
  ), page AS (
    SELECT * FROM picked p
    ORDER BY
      CASE WHEN p_sort = 'merit' THEN p.exit7 END DESC NULLS LAST,
      CASE WHEN p_sort = 'nearest' THEN p.distance_mi END ASC NULLS LAST,
      CASE WHEN p_sort = 'band' THEN p.taste END DESC NULLS LAST,
      CASE WHEN p_sort = 'price' THEN p.current_price END ASC NULLS LAST,
      p.listed_at DESC, p.id DESC
    LIMIT v_limit OFFSET v_offset
  ), told AS (
    -- What the listing itself says, for the page's rows only: its stated miles, an odometer the seller disclosed as
    -- broken or rolled over, the title status and the seller's declared condition. Read from the listing observation the event points at, and only
    -- when that observation is about the same vehicle.
    SELECT page.*, o.listing_mileage, o.odometer, o.title_status, o.condition
    FROM page
    LEFT JOIN LATERAL (
      SELECT CASE WHEN vo.structured_data->>'mileage' ~ '^[0-9]{1,7}$' THEN (vo.structured_data->>'mileage')::integer END AS listing_mileage,
             CASE WHEN vo.structured_data->>'odometer_broken' = 'true' THEN 'broken'
                  WHEN vo.structured_data->>'odometer_rolled_over' = 'true' THEN 'rolled_over' END AS odometer,
             nullif(lower(btrim(vo.structured_data->>'title_status')), '') AS title_status,
             nullif(lower(btrim(vo.structured_data->>'condition')), '') AS condition
      FROM public.vehicle_observations vo
      WHERE vo.id = page.observation_id AND vo.vehicle_id = page.vehicle_id
    ) o ON true
  )
  SELECT jsonb_build_object(
    'as_of', now(),
    'since', v_since,
    'newest_at', (SELECT max(listed_at) FROM shaped),
    'newest_seen_at', (SELECT max(created_at) FROM shaped),
    'merit_model', (SELECT jsonb_build_object('version', version, 'horizon_days', horizon_days, 'base_rate', base_rate) FROM model),
    'window_hours', v_hours,
    'band_min_taste', v_band,
    'population', (SELECT jsonb_build_object(
        'asks', count(*),
        'priced', count(tier),
        'with_point', count(lat),
        'in_band', count(*) FILTER (WHERE taste >= v_band),
        'keyed', count(family_id),
        'positioned_sold', count(sold_below),
        'positioned_asked', count(asked_below),
        'with_merit', count(exit7),
        'by_source', coalesce((SELECT jsonb_object_agg(source_platform, n) FROM (
          SELECT source_platform, count(*) AS n FROM shaped GROUP BY 1) x), '{}'::jsonb),
        'by_tier', coalesce((SELECT jsonb_object_agg(coalesce(tier, 'unpriced'), n) FROM (
          SELECT tier, count(*) AS n FROM shaped GROUP BY 1) x), '{}'::jsonb))
      FROM scored),
    'matching', (SELECT count(*) FROM picked),
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'event_id', id, 'vehicle_id', vehicle_id, 'source', source_platform, 'url', source_url,
        'asking_price', current_price, 'tier', tier, 'first_seen_at', created_at, 'posted_at', posted_at, 'listed_at', listed_at,
        'year', year, 'make', make, 'model', model, 'drivetrain', drivetrain, 'body_style', body_style,
        'mileage', mileage, 'listing_mileage', listing_mileage, 'odometer', odometer, 'title_status', title_status,
        'condition', condition,
        'observation_id', observation_id, 'image', primary_image_url,
        'city', city, 'region', region_code, 'lat', lat, 'lng', lng, 'distance_mi', distance_mi,
        'taste', taste, 'in_band', taste >= v_band,
        'position', CASE WHEN family_id IS NOT NULL THEN jsonb_build_object(
          'family', family, 'family_id', family_id,
          'sold', CASE WHEN sold_n IS NOT NULL THEN jsonb_build_object(
            'n', sold_n, 'year_from', sold_from, 'year_to', sold_to, 'thin', sold_thin,
            'p25', sold_p25, 'p50', sold_p50, 'p75', sold_p75, 'at_or_below', sold_below,
            'offered', sold_offered, 'conflicts', sold_conflicts, 'first_on', sold_first, 'last_on', sold_last,
            'by_source', sold_sources, 'as_of', sold_as_of) END,
          'asked', CASE WHEN asked_n > 0 THEN jsonb_build_object(
            'n', asked_n, 'year_from', asked_from, 'year_to', asked_to, 'thin', asked_n < 10,
            'p25', CASE WHEN asked_n >= 10 THEN asked_p25 END, 'p50', CASE WHEN asked_n >= 10 THEN asked_p50 END,
            'p75', CASE WHEN asked_n >= 10 THEN asked_p75 END, 'at_or_below', asked_below,
            'by_source', asked_sources, 'as_of', asked_as_of) END) END,
        'merit', CASE WHEN exit7 IS NOT NULL THEN jsonb_build_object(
          'exit7', round(exit7::numeric, 3), 'model_version', (SELECT version FROM model)) END)
      ORDER BY
        CASE WHEN p_sort = 'merit' THEN exit7 END DESC NULLS LAST,
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
  '(asks, priced, with a point, in the band, keyed to a family, positioned against sales and asks, with merit, by source, '
  'by tier), newest_at (newest listed_at), newest_seen_at (newest first sighting) and merit_model beside the matching '
  'count and one page of rows. listed_at = least(posted_at, first seen); newest first orders by it. Page rows carry what '
  'the listing says (listing_mileage, odometer, title_status, condition, observation_id) and position: the family '
  '(mv_model_family_names) and where the ask sits among its recorded sales and other classified asks around its model '
  'year (mv_family_year_prices); merit = the active listing_exit_models chance of being gone within its horizon. '
  'p_sort: newest, nearest, band, price or merit. SECURITY INVOKER: callers see only what RLS already lets them read.';

REVOKE ALL ON FUNCTION public.classified_ask_board(integer, double precision, double precision, integer, integer, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classified_ask_board(integer, double precision, double precision, integer, integer, text, text, integer, integer) TO anon, authenticated, service_role;

DO $check$
BEGIN
  IF position('mv_family_year_prices' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.classified_ask_board(integer,double precision,double precision,integer,integer,text,text,integer,integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'classified_ask_board did not gain the family position';
  END IF;
END $check$;

COMMIT;
