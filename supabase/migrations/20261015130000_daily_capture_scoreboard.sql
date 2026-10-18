-- Daily capture scoreboard: per source, per UTC day, how many listings went online (listed), how many we hold
-- (captured) and how many landed whole.
--   - listed: a measurement from the source's own newest-listings feed, sitemap or newest-first search. It lives in
--     source_census (one row per source per day): census_day is the UTC day, universe_total the count listed that
--     day, census_method / census_confidence say how it was counted (enumerated, bounded, unknown). No row = not measured.
--   - captured: vehicles first seen that day (created_at), keyed by the listing's source.
--   - landed_whole: a proxy computed here, not the depth check itself: price, a description of 80+ characters,
--     3+ images, a location and year/make/model all present. The depth check (full gallery at full resolution,
--     attribute panel, seller) is landing_depth_measurements / v_landing_depth_drops; this view only flags where
--     the proxy already fails.
-- Window: the last 14 UTC days. Read by service_role and authenticated operators; not exposed to anon.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.source_census ADD COLUMN IF NOT EXISTS census_day date;
COMMENT ON COLUMN public.source_census.census_day IS
  'UTC day a daily-listed measurement covers (listings that went online that day). NULL for whole-universe censuses. universe_total then holds the count listed that day.';

CREATE OR REPLACE VIEW public.v_daily_capture_scoreboard WITH (security_invoker = true) AS
WITH cap AS (
  SELECT lower(coalesce(nullif(v.listing_source, ''), nullif(v.discovery_source, ''), nullif(v.platform_source, ''), '(none)')) AS source_key,
         (v.created_at AT TIME ZONE 'utc')::date AS day,
         count(*) AS captured,
         count(*) FILTER (WHERE coalesce(v.asking_price, v.price, v.sale_price, v.high_bid) > 0
                           AND length(coalesce(v.description, '')) >= 80
                           AND coalesce(v.image_count, 0) >= 3
                           AND coalesce(v.listing_location, v.location) IS NOT NULL
                           AND v.year IS NOT NULL AND v.make IS NOT NULL AND v.model IS NOT NULL) AS landed_whole_proxy
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
       coalesce(cap.landed_whole_proxy, 0) AS landed_whole_proxy
FROM cap FULL JOIN listed l ON l.source_key = cap.source_key AND l.day = cap.day;

COMMENT ON VIEW public.v_daily_capture_scoreboard IS
  'Per source and UTC day (last 14): listed (source_census rows with census_day, with method and confidence; NULL = not measured), captured (vehicles first seen that day), landed_whole_proxy (price, 80+ char description, 3+ images, location, year/make/model; a proxy, the depth check is landing_depth_measurements).';
REVOKE ALL ON public.v_daily_capture_scoreboard FROM PUBLIC, anon;
GRANT SELECT ON public.v_daily_capture_scoreboard TO authenticated, service_role;
