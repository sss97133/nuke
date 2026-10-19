-- v_daily_capture_scoreboard: say which field fails, not only that the proxy fails.
-- Measured 2026-10-15: the single landed_whole_proxy read 0 for Bonhams, Barn Finds, Mecum and RM Sotheby's, because
-- their vehicle rows hold no location (the sale location sits on the auction event) and Bonhams holds no image count.
-- Per-field counts beside the proxy make that visible. Columns are added at the end; existing columns are unchanged.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE OR REPLACE VIEW public.v_daily_capture_scoreboard WITH (security_invoker = true) AS
WITH cap AS (
  SELECT lower(coalesce(nullif(v.listing_source, ''), nullif(v.discovery_source, ''), nullif(v.platform_source, ''), '(none)')) AS source_key,
         (v.created_at AT TIME ZONE 'utc')::date AS day,
         count(*) AS captured,
         count(*) FILTER (WHERE coalesce(v.asking_price, v.price, v.sale_price, v.high_bid) > 0
                           AND length(coalesce(v.description, '')) >= 80
                           AND coalesce(v.image_count, 0) >= 3
                           AND coalesce(v.listing_location, v.location) IS NOT NULL
                           AND v.year IS NOT NULL AND v.make IS NOT NULL AND v.model IS NOT NULL) AS landed_whole_proxy,
         count(*) FILTER (WHERE coalesce(v.asking_price, v.price, v.sale_price, v.high_bid) > 0) AS with_price,
         count(*) FILTER (WHERE length(coalesce(v.description, '')) >= 80) AS with_description,
         count(*) FILTER (WHERE coalesce(v.image_count, 0) >= 3) AS with_3_images,
         count(*) FILTER (WHERE coalesce(v.listing_location, v.location) IS NOT NULL) AS with_location,
         count(*) FILTER (WHERE v.year IS NOT NULL AND v.make IS NOT NULL AND v.model IS NOT NULL) AS with_year_make_model
  FROM public.vehicles v
  WHERE v.created_at >= (date_trunc('day', now() AT TIME ZONE 'utc') - interval '13 days')
    AND v.deleted_at IS NULL
  GROUP BY 1, 2
), listed AS (
  SELECT DISTINCT ON (lower(os.slug), c.census_day)
         lower(os.slug) AS source_key, c.census_day AS day, c.universe_total AS listed,
         c.census_method AS listed_method, c.census_confidence AS listed_confidence, c.census_at AS listed_measured_at
  FROM public.source_census c
  JOIN public.observation_sources os ON os.id = c.source_id
  WHERE c.census_day >= (date_trunc('day', now() AT TIME ZONE 'utc') - interval '13 days')::date
  ORDER BY lower(os.slug), c.census_day, c.census_at DESC
)
SELECT coalesce(cap.source_key, l.source_key) AS source_key,
       coalesce(cap.day, l.day) AS day,
       l.listed, l.listed_method, l.listed_confidence, l.listed_measured_at,
       coalesce(cap.captured, 0) AS captured,
       coalesce(cap.landed_whole_proxy, 0) AS landed_whole_proxy,
       coalesce(cap.with_price, 0) AS with_price,
       coalesce(cap.with_description, 0) AS with_description,
       coalesce(cap.with_3_images, 0) AS with_3_images,
       coalesce(cap.with_location, 0) AS with_location,
       coalesce(cap.with_year_make_model, 0) AS with_year_make_model
FROM cap FULL JOIN listed l ON l.source_key = cap.source_key AND l.day = cap.day;
