-- map_facts: an observation that states its US state but has no county counts in that state.
--
-- WHY. The listing and vehicle folds (20261020220000) take state = left(county_fips, 2), so an observation that names its
-- state and has no county key is "no state" as well as "no county". On 2026-10-20 that was 378 of the 1,729
-- facebook_marketplace listings folded for 2026-10-17..20 (a "City, ST" whose city is not in city_geocode_lookup gets no
-- point and so no county). eBay's listing place (extract-ebay-motors browsePlace.ts) writes the stated state with no
-- point when the city is not in the lookup, when eBay's own masked ZIP prefix or state contradicts the lookup's point, or
-- when the description disputes the county: in a read-only rehearsal on 2026-10-20 07:54Z, 28 of the 179 Browse listings
-- and 133 of the 1,121 Firecrawl-era listings.
--
-- WHAT.
--   fold_map_facts_listing and fold_map_facts_vehicle: state = left(county_fips, 2), else the us_states.fips whose usps is
--   the observation's region_code when its country_code is US or NULL. County and ZCTA are unchanged, so a state-only
--   observation is still "no county" and "no ZIP". The level invariant (map_facts_write_layer) holds: each entity still
--   lands once per level. map_layers.geography says so for both layers. The sale, organization and photo folds are
--   unchanged (their places come from a keyed observation, an organization point or a photo point).
-- COST. One equality join on us_states (56 rows, primary key usps unique) per fold row; measured in the PR.
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
  SELECT f.vehicle_id, coalesce(f.source_platform, 'unknown'), f.day, coalesce(left(f.county_fips, 2), st.fips), f.county_fips,
         f.zcta, v.asking_price
  FROM (
    SELECT DISTINCT ON (o.vehicle_id) o.vehicle_id, o.source_platform, (o.observed_at AT TIME ZONE 'UTC')::date AS day,
           o.county_fips, o.zcta, o.region_code, o.country_code
    FROM public.vehicle_location_observations o
    WHERE o.source_type = 'listing' AND o.vehicle_id IS NOT NULL
      AND o.observed_at >= v_from AND o.observed_at < v_to AND o.observed_at <= p_as_of
      AND NOT EXISTS (SELECT 1 FROM public.vehicle_location_observations p
                      WHERE p.vehicle_id = o.vehicle_id AND p.source_type = 'listing'
                        AND p.observed_at < o.observed_at AND p.observed_at >= p_as_of - p_horizon)
    ORDER BY o.vehicle_id, o.observed_at
  ) f
  JOIN public.vehicles v ON v.id = f.vehicle_id AND v.is_public AND v.deleted_at IS NULL
  LEFT JOIN public.us_states st ON f.county_fips IS NULL AND st.usps = f.region_code AND coalesce(f.country_code, 'US') = 'US';
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
  SELECT f.vehicle_id, coalesce(f.source_platform, 'unknown'), f.day, coalesce(left(f.county_fips, 2), st.fips), f.county_fips,
         f.zcta, NULL
  FROM (
    SELECT DISTINCT ON (o.vehicle_id) o.vehicle_id, o.source_platform, (o.observed_at AT TIME ZONE 'UTC')::date AS day,
           o.county_fips, o.zcta, o.region_code, o.country_code
    FROM public.vehicle_location_observations o
    WHERE o.vehicle_id IS NOT NULL
      AND o.observed_at >= v_from AND o.observed_at < v_to AND o.observed_at <= p_as_of
      AND NOT EXISTS (SELECT 1 FROM public.vehicle_location_observations p
                      WHERE p.vehicle_id = o.vehicle_id AND p.observed_at > o.observed_at AND p.observed_at <= p_as_of)
    ORDER BY o.vehicle_id, o.observed_at DESC
  ) f
  JOIN public.vehicles v ON v.id = f.vehicle_id AND v.is_public AND v.deleted_at IS NULL
  LEFT JOIN public.us_states st ON f.county_fips IS NULL AND st.usps = f.region_code AND coalesce(f.country_code, 'US') = 'US';
  RETURN public.map_facts_write_layer('vehicle', p_from, p_to, ARRAY['state', 'county', 'zcta'], false, p_as_of);
END
$$;

REVOKE ALL ON FUNCTION public.fold_map_facts_listing(date, date, timestamptz, interval),
              public.fold_map_facts_vehicle(date, date, timestamptz)
  FROM PUBLIC, anon, authenticated;

UPDATE public.map_layers SET
  geography = 'the keys of that first observation: county_fips (zip_to_fips from postal_code, else point-in-county; trg_key_vehicle_location_county), state = left(county_fips, 2), else the us_states row of its region_code when the observation names a US state and has no county (20261021130000), zcta (trg_key_vehicle_location_zcta), point = latitude/longitude when present',
  since_migration = '20261021130000'
  WHERE layer = 'listing';
UPDATE public.map_layers SET
  geography = 'the keys of that latest observation: county_fips, state = left(county_fips, 2), else the us_states row of its region_code when it names a US state and has no county (20261021130000), zcta; an observation with no county_fips is ''no county''',
  since_migration = '20261021130000'
  WHERE layer = 'vehicle';

COMMIT;
