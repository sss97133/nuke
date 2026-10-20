-- map_facts: a county code that is not a county FIPS folds as "no county".
--
-- WHY. The first nightly rebuild (map-facts-nightly, 2026-10-20 09:20Z) failed after 142 s: "new row for relation map_facts
-- violates check constraint map_facts_area_key_shape ... (listing, county, _none, bat, 2025-11-03 ...)". 3,244
-- vehicle_location_observations rows carry county_fips '_none' (the 2026-03 geocoder's "no county" marker; the column
-- comment and its NOT VALID foreign key keep them unchecked), all older than the recent fold's 3-day window, so only the
-- 365-day rebuild reaches them. Its listing, vehicle and sale layers passed '_none' through as an area key (and
-- left('_none', 2) as a state). Measured 2026-10-20 09:40Z: '_none' is the only county_fips value that is not five digits.
--
-- WHAT. fold_map_facts_listing, fold_map_facts_vehicle and fold_map_facts_sale read county_fips only when it matches
--   ^[0-9]{5}$; anything else is NULL, so the entity lands in "no county" (and in its stated state when region_code names
--   a US state, 20261021130000). The sale fold's placing observation must carry such a code or a ZCTA. The testimony rows
--   are unchanged. Otherwise the three functions are as in 20261020220000 / 20261021130000.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fold_map_facts_listing(p_from date, p_to date, p_as_of timestamptz DEFAULT clock_timestamp(),
                                                         p_horizon interval DEFAULT interval '365 days')
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from timestamptz := p_from::timestamp AT TIME ZONE 'UTC';
  v_to   timestamptz := (p_to + 1)::timestamp AT TIME ZONE 'UTC';
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS map_fold_entities
    (entity_id uuid, source_platform text, day date, state text, county text, zcta text, value numeric) ON COMMIT DROP;
  TRUNCATE map_fold_entities;
  INSERT INTO map_fold_entities
  SELECT f.vehicle_id, coalesce(f.source_platform, 'unknown'), f.day, coalesce(left(f.county, 2), st.fips), f.county,
         f.zcta, v.asking_price
  FROM (
    SELECT DISTINCT ON (o.vehicle_id) o.vehicle_id, o.source_platform, (o.observed_at AT TIME ZONE 'UTC')::date AS day,
           CASE WHEN o.county_fips ~ '^[0-9]{5}$' THEN o.county_fips END AS county, o.zcta, o.region_code, o.country_code
    FROM public.vehicle_location_observations o
    WHERE o.source_type = 'listing' AND o.vehicle_id IS NOT NULL
      AND o.observed_at >= v_from AND o.observed_at < v_to AND o.observed_at <= p_as_of
      AND NOT EXISTS (SELECT 1 FROM public.vehicle_location_observations p
                      WHERE p.vehicle_id = o.vehicle_id AND p.source_type = 'listing'
                        AND p.observed_at < o.observed_at AND p.observed_at >= p_as_of - p_horizon)
    ORDER BY o.vehicle_id, o.observed_at
  ) f
  JOIN public.vehicles v ON v.id = f.vehicle_id AND v.is_public AND v.deleted_at IS NULL
  LEFT JOIN public.us_states st ON f.county IS NULL AND st.usps = f.region_code AND coalesce(f.country_code, 'US') = 'US';
  RETURN public.map_facts_write_layer('listing', p_from, p_to, ARRAY['state', 'county', 'zcta'], false, p_as_of);
END
$$;

CREATE OR REPLACE FUNCTION public.fold_map_facts_vehicle(p_from date, p_to date, p_as_of timestamptz DEFAULT clock_timestamp())
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from timestamptz := p_from::timestamp AT TIME ZONE 'UTC';
  v_to   timestamptz := (p_to + 1)::timestamp AT TIME ZONE 'UTC';
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS map_fold_entities
    (entity_id uuid, source_platform text, day date, state text, county text, zcta text, value numeric) ON COMMIT DROP;
  TRUNCATE map_fold_entities;
  INSERT INTO map_fold_entities
  SELECT f.vehicle_id, coalesce(f.source_platform, 'unknown'), f.day, coalesce(left(f.county, 2), st.fips), f.county,
         f.zcta, NULL
  FROM (
    SELECT DISTINCT ON (o.vehicle_id) o.vehicle_id, o.source_platform, (o.observed_at AT TIME ZONE 'UTC')::date AS day,
           CASE WHEN o.county_fips ~ '^[0-9]{5}$' THEN o.county_fips END AS county, o.zcta, o.region_code, o.country_code
    FROM public.vehicle_location_observations o
    WHERE o.vehicle_id IS NOT NULL
      AND o.observed_at >= v_from AND o.observed_at < v_to AND o.observed_at <= p_as_of
      AND NOT EXISTS (SELECT 1 FROM public.vehicle_location_observations p
                      WHERE p.vehicle_id = o.vehicle_id AND p.observed_at > o.observed_at AND p.observed_at <= p_as_of)
    ORDER BY o.vehicle_id, o.observed_at DESC
  ) f
  JOIN public.vehicles v ON v.id = f.vehicle_id AND v.is_public AND v.deleted_at IS NULL
  LEFT JOIN public.us_states st ON f.county IS NULL AND st.usps = f.region_code AND coalesce(f.country_code, 'US') = 'US';
  RETURN public.map_facts_write_layer('vehicle', p_from, p_to, ARRAY['state', 'county', 'zcta'], false, p_as_of);
END
$$;

CREATE OR REPLACE FUNCTION public.fold_map_facts_sale(p_from date, p_to date, p_as_of timestamptz DEFAULT clock_timestamp())
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from timestamptz := p_from::timestamp AT TIME ZONE 'UTC';
  v_to   timestamptz := (p_to + 1)::timestamp AT TIME ZONE 'UTC';
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS map_fold_entities
    (entity_id uuid, source_platform text, day date, state text, county text, zcta text, value numeric) ON COMMIT DROP;
  TRUNCATE map_fold_entities;
  INSERT INTO map_fold_entities
  SELECT s.vehicle_id, coalesce(s.source_platform, 'unknown'), s.day, left(loc.county, 2), loc.county, loc.zcta, s.final_price
  FROM (
    SELECT DISTINCT ON (e.vehicle_id) e.vehicle_id, e.source_platform, e.source_url, (e.sold_at AT TIME ZONE 'UTC')::date AS day,
           e.final_price
    FROM public.vehicle_events e
    WHERE e.event_status = 'sold' AND e.sold_at IS NOT NULL AND e.vehicle_id IS NOT NULL
      AND e.ended_at >= v_from - interval '7 days' AND e.ended_at < v_to + interval '7 days'
      AND e.sold_at >= v_from AND e.sold_at < v_to AND e.sold_at <= p_as_of
    ORDER BY e.vehicle_id, e.sold_at DESC
  ) s
  JOIN public.vehicles v ON v.id = s.vehicle_id AND v.is_public AND v.deleted_at IS NULL
  LEFT JOIN LATERAL (
    SELECT CASE WHEN o.county_fips ~ '^[0-9]{5}$' THEN o.county_fips END AS county, o.zcta
    FROM public.vehicle_location_observations o
    WHERE o.vehicle_id = s.vehicle_id AND (o.county_fips ~ '^[0-9]{5}$' OR o.zcta IS NOT NULL)
    ORDER BY (o.source_url IS NOT DISTINCT FROM s.source_url AND s.source_url IS NOT NULL) DESC,
             (o.source_platform IS NOT DISTINCT FROM s.source_platform) DESC,
             o.observed_at DESC
    LIMIT 1
  ) loc ON true;
  RETURN public.map_facts_write_layer('sale', p_from, p_to, ARRAY['state', 'county', 'zcta'], false, p_as_of);
END
$$;

REVOKE ALL ON FUNCTION public.fold_map_facts_listing(date, date, timestamptz, interval),
              public.fold_map_facts_vehicle(date, date, timestamptz),
              public.fold_map_facts_sale(date, date, timestamptz)
  FROM PUBLIC, anon, authenticated;

COMMIT;
