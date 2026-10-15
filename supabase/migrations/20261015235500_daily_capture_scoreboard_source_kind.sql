-- v_daily_capture_scoreboard: the landed-whole proxy depends on what the source is.
-- Where a car was sold is not where the car is ("place is context, not a claim"), so an auction house is not asked for
-- a vehicle location, and a Barn Finds article is not asked for a price it never states. source_kind says which rule
-- applied: classified (price, description, 3+ images, vehicle location, year/make/model), auction (the same without
-- the location) and editorial (description, 3+ images, year/make/model; price and location where shown).
-- Existing columns are unchanged in name and type; landed_whole_proxy changes meaning for auction and editorial
-- sources, and source_kind is added at the end. The per-field counts are still the evidence.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE OR REPLACE VIEW public.v_daily_capture_scoreboard WITH (security_invoker = true) AS
WITH base AS (
  SELECT lower(coalesce(nullif(v.listing_source, ''), nullif(v.discovery_source, ''), nullif(v.platform_source, ''), '(none)')) AS source_key,
         (v.created_at AT TIME ZONE 'utc')::date AS day,
         coalesce(v.asking_price, v.price, v.sale_price, v.high_bid) > 0 AS has_price,
         length(coalesce(v.description, '')) >= 80 AS has_desc,
         coalesce(v.image_count, 0) >= 3 AS has_imgs,
         coalesce(v.listing_location, v.location) IS NOT NULL AS has_loc,
         (v.year IS NOT NULL AND v.make IS NOT NULL AND v.model IS NOT NULL) AS has_ymm
  FROM public.vehicles v
  WHERE v.created_at >= (date_trunc('day', now() AT TIME ZONE 'utc') - interval '13 days')
    AND v.deleted_at IS NULL
), kinded AS (
  SELECT b.*, CASE WHEN source_key IN ('craigslist', 'ksl', 'classiccars', 'facebook_marketplace', 'facebook-saved', 'autotrader', 'cars.com', 'cargurus', 'ebay', 'ebay_motors', 'hemmings')
                        OR source_key LIKE 'facebook%' THEN 'classified'
                   WHEN source_key IN ('barnfinds') THEN 'editorial'
                   ELSE 'auction' END AS source_kind
  FROM base b
), cap AS (
  SELECT source_key, day, max(source_kind) AS source_kind,
         count(*) AS captured,
         count(*) FILTER (WHERE has_desc AND has_imgs AND has_ymm
                           AND (source_kind = 'editorial' OR has_price)
                           AND (source_kind <> 'classified' OR has_loc)) AS landed_whole_proxy,
         count(*) FILTER (WHERE has_price) AS with_price,
         count(*) FILTER (WHERE has_desc) AS with_description,
         count(*) FILTER (WHERE has_imgs) AS with_3_images,
         count(*) FILTER (WHERE has_loc) AS with_location,
         count(*) FILTER (WHERE has_ymm) AS with_year_make_model
  FROM kinded
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
       coalesce(cap.with_year_make_model, 0) AS with_year_make_model,
       cap.source_kind
FROM cap FULL JOIN listed l ON l.source_key = cap.source_key AND l.day = cap.day;
