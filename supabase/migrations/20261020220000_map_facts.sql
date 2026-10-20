-- map_facts: the one map's numbers, precomputed per layer, never counted at page time (plan step 4).
--
-- WHY. A live count joins every located vehicle to vehicles for the public test; on 2026-10-19 a 3-day listing window
-- took 5.2 s (2,092 lookups, 1,411 pages from disk). The map must answer in ~300 ms at any zoom, so every number it
-- shows is a row here, written by a fold that applies one map_layers rule, and the reader only sums rows.
--
-- WHAT.
--   1. map_facts: grain (layer, level, area_key, source_platform, day). level is state, county or zcta; area_key is the
--      state FIPS, county FIPS or ZCTA, or NULL for entities with no key at that level (reported as "no county" or
--      "no ZIP", never dropped). day is the UTC day of the layer's clock, or NULL for undated entities (photo with no
--      taken_at). entities counts the layer's entity once; priced and value_sum follow the layer's value basis.
--      as_of is the fold time. Public aggregates: every role reads.
--   2. One fold per layer (fold_map_facts_<layer>), each rewriting its layer's rows for a day range inside one
--      transaction through map_facts_write_layer(), which also checks the level invariant: for every (layer, source, day)
--      the entities at state level equal the entities at county level (and at zcta level where computed), because each
--      entity lands exactly once per level, in an area or in the NULL area.
--      listing: first listing observation per vehicle within the 365-day horizon (vehicle_map_county_listings' rule with
--        a longer horizon); keys of that observation; asking price.
--      vehicle: latest observation per vehicle within the horizon; its keys; no value.
--      sale: vehicle_events with event_status = 'sold' (bid-goes-on rows also carry sold_at and are excluded), latest
--        sale per vehicle in the range; placed by the vehicle's listing observation for that listing (same source_url,
--        else same platform), else its latest keyed observation; final_price.
--      organization: public active organizations, a current snapshot on the fold's UTC day (earlier days are removed);
--        placed by the organization's point, else its primary location's point, else its ZIP; no value.
--      photo: approved images with GPS of public vehicles; county by point-in-county; no ZIP level (the database holds no
--        ZCTA polygons, see 20261020210000); taken_at NULL lands as undated (day NULL). Never points.
--   3. refresh_map_facts(p_days): the recent fold (listing, vehicle, sale for the last p_days UTC days through today),
--      cron map-facts-recent every 10 minutes. rebuild_map_facts(): all five layers over the horizon, cron
--      map-facts-nightly at 09:20 UTC (02:20 Pacific). Both fail their run (so v_job_health shows it) when a layer that
--      had input rows landed nothing: rows landed, not exit 0, is success. Receipts in write_receipts.
--   4. assay_map_facts(): per layer rows, latest day, as_of age and status; the operator's rows-landed check.
--   5. The sale fold reads vehicle_events through the existing ended_at index (idx on ended_at DESC NULLS LAST): on
--      2026-10-20 all 5,527 sold events of the last 30 days had ended_at within a day of sold_at and none NULL, so the
--      fold takes rows with ended_at inside the window padded by 7 days and then tests sold_at exactly. No new index:
--      a concurrent build over the 1.9 GB table cannot finish inside the deploy role's 10 s statement_timeout
--      (20261020210000 and 20261020213000 both left an invalid index that way).
--   6. map_layers.fold becomes map_facts for every layer; the listing and photo rows say what changed.
-- COST. Measured after deploy in the PR: the first rebuild, one recent fold, and the one-area read.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.map_facts (
  layer           text NOT NULL REFERENCES public.map_layers (layer),
  level           text NOT NULL CHECK (level IN ('state', 'county', 'zcta')),
  area_key        text,
  source_platform text NOT NULL,
  day             date,
  entities        integer NOT NULL CHECK (entities > 0),
  priced          integer NOT NULL DEFAULT 0 CHECK (priced >= 0 AND priced <= entities),
  value_sum       numeric,
  as_of           timestamptz NOT NULL,
  CONSTRAINT map_facts_grain UNIQUE NULLS NOT DISTINCT (layer, level, area_key, source_platform, day),
  CONSTRAINT map_facts_area_key_shape CHECK (
    area_key IS NULL OR (level = 'state' AND area_key ~ '^[0-9]{2}$') OR (level <> 'state' AND area_key ~ '^[0-9]{5}$')),
  CONSTRAINT map_facts_value_pair CHECK ((priced = 0) = (value_sum IS NULL))
);
CREATE INDEX IF NOT EXISTS map_facts_level_day ON public.map_facts (layer, level, day, area_key);
CREATE INDEX IF NOT EXISTS map_facts_area ON public.map_facts (layer, level, area_key, day);

COMMENT ON TABLE public.map_facts IS
'The one map''s numbers: one row per (layer, level, area_key, source_platform, day) (grain: that tuple, map_facts_grain, NULLS NOT DISTINCT). Written only by the folds fold_map_facts_<layer>() through map_facts_write_layer(), scheduled by map-facts-recent (every 10 min, listing/vehicle/sale, last 3 days) and map-facts-nightly (09:20 UTC, every layer, 365-day horizon). A reader sums rows and never counts source tables. Invariant per (layer, source, day): sum(entities) is the same at every computed level. Public aggregates of public entities; every role reads. Migration 20261020220000; plan docs/proposals/2026-10-19-one-map.md.';
COMMENT ON COLUMN public.map_facts.layer IS 'map_layers.layer: which rule produced the row.';
COMMENT ON COLUMN public.map_facts.level IS 'The place level: state (us_states.fips), county (us_county_boundaries.fips) or zcta (us_zctas.zcta).';
COMMENT ON COLUMN public.map_facts.area_key IS 'The area at that level: two-digit state FIPS, five-digit county FIPS or five-digit ZCTA; NULL for entities with no key at this level ("no county", "no ZIP"), kept so totals stay whole.';
COMMENT ON COLUMN public.map_facts.source_platform IS 'The source facet: vehicle_location_observations.source_platform or vehicle_events.source_platform (NULL reads as unknown), vehicle_images.source for photo, nuke for organization.';
COMMENT ON COLUMN public.map_facts.day IS 'UTC day of the layer''s clock (map_layers.clock); NULL for undated entities (photo with no taken_at). organization rows carry the snapshot day.';
COMMENT ON COLUMN public.map_facts.entities IS 'How many of the layer''s entities (map_layers.entity) fall in this cell; each entity counts once per level.';
COMMENT ON COLUMN public.map_facts.priced IS 'How many of those carry the layer''s value (map_layers.value_column); 0 for layers with no value basis.';
COMMENT ON COLUMN public.map_facts.value_sum IS 'Sum of the layer''s value over the priced entities, in the currency as recorded (not converted); NULL when priced is 0. Asking prices and sale prices are never summed together: they are different layers.';
COMMENT ON COLUMN public.map_facts.as_of IS 'When the fold that wrote the row started (clock_timestamp()).';

ALTER TABLE public.map_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS map_facts_read ON public.map_facts;
CREATE POLICY map_facts_read ON public.map_facts FOR SELECT USING (true);
REVOKE ALL ON public.map_facts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.map_facts TO anon, authenticated, service_role;

-- Point-in-county, the one place the folds touch geometry.
CREATE OR REPLACE FUNCTION public.map_point_county(p_lon double precision, p_lat double precision)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT c.fips FROM public.us_county_boundaries c
  WHERE p_lon IS NOT NULL AND p_lat IS NOT NULL
    AND ST_Covers(c.geom, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326))
  LIMIT 1
$$;
COMMENT ON FUNCTION public.map_point_county(double precision, double precision) IS
'The county (us_county_boundaries.fips) whose geometry covers the point (longitude, latitude), or NULL; the one geometry call the map folds make. Migration 20261020220000.';

-- The writer every fold ends in. The caller fills the temp table map_fold_entities (entity_id, source_platform, day,
-- state, county, zcta, value) with its entities once each; this replaces the layer''s rows for the range and checks
-- the level invariant. Undated rows (day NULL) are replaced when p_undated.
CREATE OR REPLACE FUNCTION public.map_facts_write_layer(p_layer text, p_from date, p_to date, p_levels text[],
                                                        p_undated boolean, p_as_of timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted  integer;
  v_landed   integer;
  v_entities bigint;
  v_bad      text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.map_layers WHERE layer = p_layer) THEN
    RAISE EXCEPTION 'map_facts_write_layer: % is not a map layer', p_layer USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT count(*) INTO v_entities FROM map_fold_entities;
  IF (SELECT count(*) FROM (SELECT entity_id FROM map_fold_entities GROUP BY 1 HAVING count(*) > 1) d) > 0 THEN
    RAISE EXCEPTION 'map_facts_write_layer: % fold lists an entity twice', p_layer;
  END IF;

  DELETE FROM public.map_facts f
  WHERE f.layer = p_layer
    AND ((f.day IS NOT NULL AND f.day BETWEEN p_from AND p_to) OR (p_undated AND f.day IS NULL));
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO public.map_facts (layer, level, area_key, source_platform, day, entities, priced, value_sum, as_of)
  SELECT p_layer, lv.level,
         CASE lv.level WHEN 'state' THEN e.state WHEN 'county' THEN e.county ELSE e.zcta END,
         e.source_platform, e.day, count(*), count(e.value), sum(e.value), p_as_of
  FROM map_fold_entities e
  CROSS JOIN unnest(p_levels) AS lv (level)
  WHERE (e.day IS NOT NULL AND e.day BETWEEN p_from AND p_to) OR (p_undated AND e.day IS NULL)
  GROUP BY lv.level, 2, 3, e.source_platform, e.day;
  GET DIAGNOSTICS v_landed = ROW_COUNT;

  -- Level invariant: the same entities at every level.
  SELECT string_agg(format('%s/%s/%s', source_platform, day, array_to_string(sums, ',')), '; ') INTO v_bad
  FROM (
    SELECT source_platform, day, array_agg(s ORDER BY level) AS sums
    FROM (SELECT source_platform, day, level, sum(entities) AS s FROM public.map_facts
          WHERE layer = p_layer AND ((day IS NOT NULL AND day BETWEEN p_from AND p_to) OR (p_undated AND day IS NULL))
          GROUP BY 1, 2, 3) x
    GROUP BY 1, 2 HAVING count(DISTINCT s) > 1
  ) y;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'map_facts_write_layer: % levels disagree: %', p_layer, left(v_bad, 500);
  END IF;

  RETURN jsonb_build_object('layer', p_layer, 'from', p_from, 'to', p_to, 'entities', v_entities,
                            'rows_deleted', v_deleted, 'rows_landed', v_landed);
END
$$;

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
  SELECT f.vehicle_id, coalesce(f.source_platform, 'unknown'), f.day, left(f.county_fips, 2), f.county_fips, f.zcta, v.asking_price
  FROM (
    SELECT DISTINCT ON (o.vehicle_id) o.vehicle_id, o.source_platform, (o.observed_at AT TIME ZONE 'UTC')::date AS day,
           o.county_fips, o.zcta
    FROM public.vehicle_location_observations o
    WHERE o.source_type = 'listing' AND o.vehicle_id IS NOT NULL
      AND o.observed_at >= v_from AND o.observed_at < v_to AND o.observed_at <= p_as_of
      AND NOT EXISTS (SELECT 1 FROM public.vehicle_location_observations p
                      WHERE p.vehicle_id = o.vehicle_id AND p.source_type = 'listing'
                        AND p.observed_at < o.observed_at AND p.observed_at >= p_as_of - p_horizon)
    ORDER BY o.vehicle_id, o.observed_at
  ) f
  JOIN public.vehicles v ON v.id = f.vehicle_id AND v.is_public AND v.deleted_at IS NULL;
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
  SELECT f.vehicle_id, coalesce(f.source_platform, 'unknown'), f.day, left(f.county_fips, 2), f.county_fips, f.zcta, NULL
  FROM (
    SELECT DISTINCT ON (o.vehicle_id) o.vehicle_id, o.source_platform, (o.observed_at AT TIME ZONE 'UTC')::date AS day,
           o.county_fips, o.zcta
    FROM public.vehicle_location_observations o
    WHERE o.vehicle_id IS NOT NULL
      AND o.observed_at >= v_from AND o.observed_at < v_to AND o.observed_at <= p_as_of
      AND NOT EXISTS (SELECT 1 FROM public.vehicle_location_observations p
                      WHERE p.vehicle_id = o.vehicle_id AND p.observed_at > o.observed_at AND p.observed_at <= p_as_of)
    ORDER BY o.vehicle_id, o.observed_at DESC
  ) f
  JOIN public.vehicles v ON v.id = f.vehicle_id AND v.is_public AND v.deleted_at IS NULL;
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
  SELECT s.vehicle_id, coalesce(s.source_platform, 'unknown'), s.day, left(loc.county_fips, 2), loc.county_fips, loc.zcta, s.final_price
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
    SELECT o.county_fips, o.zcta
    FROM public.vehicle_location_observations o
    WHERE o.vehicle_id = s.vehicle_id AND (o.county_fips IS NOT NULL OR o.zcta IS NOT NULL)
    ORDER BY (o.source_url IS NOT DISTINCT FROM s.source_url AND s.source_url IS NOT NULL) DESC,
             (o.source_platform IS NOT DISTINCT FROM s.source_platform) DESC,
             o.observed_at DESC
    LIMIT 1
  ) loc ON true;
  RETURN public.map_facts_write_layer('sale', p_from, p_to, ARRAY['state', 'county', 'zcta'], false, p_as_of);
END
$$;

CREATE OR REPLACE FUNCTION public.fold_map_facts_organization(p_as_of timestamptz DEFAULT clock_timestamp())
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_day date := (p_as_of AT TIME ZONE 'UTC')::date;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS map_fold_entities
    (entity_id uuid, source_platform text, day date, state text, county text, zcta text, value numeric) ON COMMIT DROP;
  TRUNCATE map_fold_entities;
  INSERT INTO map_fold_entities
  SELECT o.id, 'nuke', v_day, left(k.county, 2), k.county, k.zcta, NULL
  FROM public.organizations o
  LEFT JOIN LATERAL (
    SELECT l.latitude, l.longitude, l.zip_code
    FROM public.organization_locations l
    WHERE l.organization_id = o.id AND (l.latitude IS NOT NULL OR l.zip_code ~ '^[0-9]{5}')
    ORDER BY l.is_primary DESC NULLS LAST, (l.latitude IS NOT NULL) DESC, l.geocode_confidence DESC NULLS LAST
    LIMIT 1
  ) l ON true
  CROSS JOIN LATERAL (
    SELECT coalesce(o.longitude, l.longitude) AS lon, coalesce(o.latitude, l.latitude) AS lat,
           left(coalesce(nullif(o.zip_code, ''), l.zip_code), 5) AS zip
  ) p
  CROSS JOIN LATERAL (
    SELECT coalesce(public.map_point_county(p.lon, p.lat), (SELECT z.fips FROM public.zip_to_fips z WHERE z.zip = p.zip)) AS county,
           (SELECT u.zcta FROM public.us_zctas u WHERE u.zcta = p.zip) AS zcta
  ) k
  WHERE o.is_public AND o.status = 'active';
  -- Current state only: every earlier snapshot goes.
  DELETE FROM public.map_facts WHERE layer = 'organization' AND day IS DISTINCT FROM v_day;
  RETURN public.map_facts_write_layer('organization', v_day, v_day, ARRAY['state', 'county', 'zcta'], false, p_as_of);
END
$$;

CREATE OR REPLACE FUNCTION public.fold_map_facts_photo(p_from date, p_to date, p_as_of timestamptz DEFAULT clock_timestamp())
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
  SELECT i.id, coalesce(i.source, 'unknown'),
         CASE WHEN i.taken_at IS NULL OR i.taken_at > p_as_of THEN NULL ELSE (i.taken_at AT TIME ZONE 'UTC')::date END,
         left(c.county, 2), c.county, NULL, NULL
  FROM public.vehicle_images i
  JOIN public.vehicles v ON v.id = i.vehicle_id AND v.is_public AND v.deleted_at IS NULL
  CROSS JOIN LATERAL (SELECT public.map_point_county(i.longitude, i.latitude) AS county) c
  WHERE i.is_approved AND i.latitude IS NOT NULL AND i.longitude IS NOT NULL AND i.vehicle_id IS NOT NULL
    AND (i.taken_at IS NULL OR i.taken_at > p_as_of OR (i.taken_at >= v_from AND i.taken_at < v_to));
  RETURN public.map_facts_write_layer('photo', p_from, p_to, ARRAY['state', 'county'], true, p_as_of);
END
$$;

-- The receipt a scheduled fold leaves, and the check that rows landed.
CREATE OR REPLACE FUNCTION public.map_facts_receipt(p_writer text, p_results jsonb, p_started timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows integer := (SELECT coalesce(sum((r->>'rows_landed')::int), 0) FROM jsonb_array_elements(p_results) r);
BEGIN
  INSERT INTO public.write_receipts (tbl, op, rows, writer, db_role, app_name, txid)
  VALUES ('map_facts', 'INSERT', v_rows, p_writer, current_user, current_setting('application_name', true), txid_current());
  RETURN jsonb_build_object('writer', p_writer, 'rows_landed', v_rows, 'layers', p_results,
                            'ms', round(extract(epoch FROM clock_timestamp() - p_started) * 1000));
END
$$;

CREATE OR REPLACE FUNCTION public.refresh_map_facts(p_days integer DEFAULT 3)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_today   date := (v_started AT TIME ZONE 'UTC')::date;
  v_from    date;
  v_results jsonb := '[]'::jsonb;
  v_r       jsonb;
BEGIN
  IF p_days IS NULL OR p_days < 1 OR p_days > 31 THEN
    RAISE EXCEPTION 'refresh_map_facts: p_days must be between 1 and 31, got %', p_days USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_from := v_today - p_days;
  PERFORM set_config('app.writer', 'refresh_map_facts', true);
  v_r := public.fold_map_facts_listing(v_from, v_today, v_started); v_results := v_results || v_r;
  -- Rows landed, not exit 0: a listing fold that lands nothing while listing rows exist in the range has failed.
  IF (v_r->>'entities')::int = 0 AND EXISTS (SELECT 1 FROM public.vehicle_location_observations o
        WHERE o.source_type = 'listing' AND o.observed_at >= v_from::timestamp AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'refresh_map_facts: listing fold landed no entities for % .. % although listing rows exist', v_from, v_today;
  END IF;
  v_results := v_results || public.fold_map_facts_vehicle(v_from, v_today, v_started);
  v_results := v_results || public.fold_map_facts_sale(v_from, v_today, v_started);
  RETURN public.map_facts_receipt('refresh_map_facts', v_results, v_started);
END
$$;

CREATE OR REPLACE FUNCTION public.rebuild_map_facts(p_horizon interval DEFAULT interval '365 days')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_today   date := (v_started AT TIME ZONE 'UTC')::date;
  v_from    date := ((v_started - p_horizon) AT TIME ZONE 'UTC')::date;
  v_results jsonb := '[]'::jsonb;
  v_r       jsonb;
BEGIN
  IF p_horizon IS NULL OR p_horizon < interval '1 day' OR p_horizon > interval '3660 days' THEN
    RAISE EXCEPTION 'rebuild_map_facts: p_horizon must be between 1 and 3660 days, got %', p_horizon USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM set_config('app.writer', 'rebuild_map_facts', true);
  v_r := public.fold_map_facts_listing(v_from, v_today, v_started, p_horizon); v_results := v_results || v_r;
  IF (v_r->>'entities')::int = 0 AND EXISTS (SELECT 1 FROM public.vehicle_location_observations o
        WHERE o.source_type = 'listing' AND o.observed_at >= v_from::timestamp AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'rebuild_map_facts: listing fold landed no entities for % .. % although listing rows exist', v_from, v_today;
  END IF;
  v_results := v_results || public.fold_map_facts_vehicle(v_from, v_today, v_started);
  v_results := v_results || public.fold_map_facts_sale(v_from, v_today, v_started);
  v_results := v_results || public.fold_map_facts_organization(v_started);
  v_results := v_results || public.fold_map_facts_photo(v_from, v_today, v_started);
  -- Days older than the horizon leave, so the table is exactly the horizon.
  DELETE FROM public.map_facts WHERE day IS NOT NULL AND day < v_from;
  RETURN public.map_facts_receipt('rebuild_map_facts', v_results, v_started);
END
$$;

CREATE OR REPLACE FUNCTION public.assay_map_facts()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH per_layer AS (
    SELECT l.layer,
           count(f.layer) AS rows,
           max(f.day) AS latest_day,
           max(f.as_of) AS as_of,
           coalesce(sum(f.entities) FILTER (WHERE f.level = 'county' AND f.day >= current_date - 7), 0) AS entities_7d_county,
           count(DISTINCT f.level) AS levels,
           CASE WHEN l.layer IN ('listing', 'vehicle', 'sale') THEN interval '30 minutes' ELSE interval '26 hours' END AS fresh_for
    FROM public.map_layers l LEFT JOIN public.map_facts f ON f.layer = l.layer
    GROUP BY l.layer, l.sort_order ORDER BY l.sort_order
  )
  SELECT jsonb_build_object(
    'checked_at', clock_timestamp(),
    'status', CASE WHEN bool_and(rows > 0 AND as_of > clock_timestamp() - fresh_for) THEN 'ok'
                   WHEN bool_or(rows > 0) THEN 'stale' ELSE 'empty' END,
    'layers', jsonb_agg(jsonb_build_object('layer', layer, 'rows', rows, 'latest_day', latest_day, 'as_of', as_of,
                'entities_7d_county', entities_7d_county, 'levels', levels,
                'status', CASE WHEN rows = 0 THEN 'empty' WHEN as_of > clock_timestamp() - fresh_for THEN 'ok' ELSE 'stale' END)))
  FROM per_layer
$$;
COMMENT ON FUNCTION public.assay_map_facts() IS
'The map folds'' rows-landed check: per layer the rows in map_facts, latest day, as_of and status (ok within 30 min for listing/vehicle/sale, 26 h for organization/photo; stale beyond; empty with no rows), and the whole: ok, stale or empty. Read by operators beside v_job_health rows map-facts-recent and map-facts-nightly. Migration 20261020220000.';

REVOKE ALL ON FUNCTION public.map_point_county(double precision, double precision),
              public.map_facts_write_layer(text, date, date, text[], boolean, timestamptz),
              public.fold_map_facts_listing(date, date, timestamptz, interval),
              public.fold_map_facts_vehicle(date, date, timestamptz),
              public.fold_map_facts_sale(date, date, timestamptz),
              public.fold_map_facts_organization(timestamptz),
              public.fold_map_facts_photo(date, date, timestamptz),
              public.map_facts_receipt(text, jsonb, timestamptz),
              public.refresh_map_facts(integer), public.rebuild_map_facts(interval), public.assay_map_facts()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_map_facts(integer), public.rebuild_map_facts(interval), public.assay_map_facts() TO service_role;

COMMENT ON FUNCTION public.refresh_map_facts(integer) IS
'The recent fold: listing, vehicle and sale rows for the last p_days UTC days through today (1..31, default 3), each layer rewritten in this transaction; fails when the listing fold lands no entities although listing rows exist in the range. Returns the receipt {writer, rows_landed, layers[], ms} and records it in write_receipts. SECURITY DEFINER, service_role only; cron map-facts-recent every 10 minutes. Migration 20261020220000.';
COMMENT ON FUNCTION public.rebuild_map_facts(interval) IS
'The nightly fold: every layer over the horizon (default 365 days) through today, organization as a current snapshot, photo with undated rows; rows older than the horizon removed; same rows-landed check as refresh_map_facts(). SECURITY DEFINER, service_role only; cron map-facts-nightly at 09:20 UTC. Migration 20261020220000.';

UPDATE public.map_layers SET fold = 'map_facts', since_migration = '20261020220000';
UPDATE public.map_layers SET
  rule = 'vehicle_location_observations rows with source_type = ''listing'' and vehicle_id NOT NULL; every source_platform (NULL reads as ''unknown''); the vehicle''s first such observation within the fold''s horizon (map_facts: 365 days; vehicle_map_county_listings: 30 days), so a vehicle counts once, on the day it was first seen listed; its county_fips may be NULL (counted as ''no county''); vehicles.is_public AND vehicles.deleted_at IS NULL.',
  geography = 'the keys of that first observation: county_fips (zip_to_fips from postal_code, else point-in-county; trg_key_vehicle_location_county), state = left(county_fips, 2), zcta (trg_key_vehicle_location_zcta), point = latitude/longitude when present'
  WHERE layer = 'listing';
UPDATE public.map_layers SET
  geography = 'county by point-in-county from the image''s own coordinates (map_point_county), state = left(county_fips, 2); no ZIP level (the database holds no ZCTA polygons); aggregated to the area, never drawn as a point (points_allowed = false)'
  WHERE layer = 'photo';
UPDATE public.map_layers SET
  geography = 'the keys of that latest observation: county_fips, state = left(county_fips, 2), zcta; an observation with no county_fips is ''no county'''
  WHERE layer = 'vehicle';

SELECT cron.schedule('map-facts-recent', '*/10 * * * *',
  $cron$SET statement_timeout = '5min'; SELECT public.refresh_map_facts(3);$cron$);
SELECT cron.schedule('map-facts-nightly', '20 9 * * *',
  $cron$SET statement_timeout = '25min'; SELECT public.rebuild_map_facts();$cron$);

COMMIT;

