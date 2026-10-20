-- map_layers: the one map's ontology, one row per layer, each defined once.
--
-- WHY. The owner wants one map that navigates any map-oriented data, deterministic and fast (2026-10-19,
-- docs/proposals/2026-10-19-one-map.md). Today a count on a map can mean a located vehicle (vehicle_map_county_data),
-- a cell of observations (mv_map_public_cells) or a new listing (vehicle_map_county_listings), and nothing says which.
-- This table says: a layer is an entity counted once, by one source rule, on one clock, placed one way, valued one way.
-- Every fold (map_facts, step 4 of the plan) and every reader quotes a layer by this key and may not invent another.
--
-- WHAT. A reference table of five layers: listing, sale, vehicle, organization, photo. Written only by migrations.
-- Readable by every role (it holds no private data). Nothing executes the rule text; the fold that implements a layer
-- names it in `fold`, and supabase/sql/test_map_layers.sql proves the listing rule reproduces vehicle_map_county_listings.
--
-- LIVE CHECK (2026-10-20 03:40Z fold, UTC days 2026-10-17..19, created_at <= as_of): the listing rule written as a query
-- gives 5,447 vehicles, 4,092 priced, asking sum 312,444,729, 1,181 counties; the fold's day rows sum to the same four
-- numbers. The other rules on the same window: sale 287 events (238 placed by a listing observation, 287 priced);
-- vehicle 7,748 (6,798 with a county); organization 3,505 placeable of 4,548 public active; photo: not assessed
-- (no index on taken_at with GPS; a 20,000-row GPS sample was 100% is_approved, 47% attributed to a vehicle).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.map_layers (
  layer          text PRIMARY KEY CHECK (layer ~ '^[a-z_]{2,32}$'),
  sort_order     smallint NOT NULL UNIQUE,
  entity         text NOT NULL CHECK (entity IN ('vehicle', 'organization', 'image')),
  source_table   text NOT NULL,
  rule           text NOT NULL,
  clock          text NOT NULL,
  geography      text NOT NULL,
  value_basis    text,
  value_column   text,
  points_allowed boolean NOT NULL DEFAULT true,
  fold           text,
  since_migration text NOT NULL,
  CONSTRAINT map_layers_value_pair CHECK ((value_basis IS NULL) = (value_column IS NULL))
);

COMMENT ON TABLE public.map_layers IS
'The one map''s ontology: one row per layer (grain: one layer; PRIMARY KEY layer). A layer is one entity counted once per window, by one source rule, dated by one clock, placed by one geography and valued by one basis. Every map fold (map_facts) and reader quotes a layer by this key; a count on the map always means exactly one row here. Reference data written only by migrations (20261020193000); readable by every role. Five layers: listing, sale, vehicle, organization, photo. Plan: docs/proposals/2026-10-19-one-map.md.';
COMMENT ON COLUMN public.map_layers.layer IS 'The layer key, lowercase: listing, sale, vehicle, organization, photo. The value a fold stores in map_facts.layer and a reader passes as ?layer=.';
COMMENT ON COLUMN public.map_layers.sort_order IS 'Display order in a layer picker, 1 first.';
COMMENT ON COLUMN public.map_layers.entity IS 'What one unit of the count is: vehicle (vehicles.id), organization (organizations.id) or image (vehicle_images.id). An entity counts once per layer per window, never once per observation.';
COMMENT ON COLUMN public.map_layers.source_table IS 'The table whose rows establish membership in the layer, by its live name (information_schema.tables.table_name).';
COMMENT ON COLUMN public.map_layers.rule IS 'The inclusion rule, in words that name the exact columns and values tested. A fold implements it literally; a reader never re-tests it. Public, undeleted vehicles only (vehicles.is_public AND vehicles.deleted_at IS NULL), tested once in the fold.';
COMMENT ON COLUMN public.map_layers.clock IS 'The column that dates the entity on the map and decides which window it falls in. A NULL or future (> as_of) clock excludes the entity from date windows; it is counted separately as undated.';
COMMENT ON COLUMN public.map_layers.geography IS 'How the entity gets its area keys (state = left(county_fips, 2), county = county_fips, ZIP = zcta) and its point, and which row''s keys win when there are several.';
COMMENT ON COLUMN public.map_layers.value_basis IS 'The money measure the layer may sum: asking price, sale price, or NULL for none. Different bases are never summed together.';
COMMENT ON COLUMN public.map_layers.value_column IS 'The column read for value_basis, as table.column; NULL when value_basis is NULL (map_layers_value_pair).';
COMMENT ON COLUMN public.map_layers.points_allowed IS 'Whether the entity may be drawn as an individual point at point zoom. false for photo: photos are only ever aggregated to an area, never placed.';
COMMENT ON COLUMN public.map_layers.fold IS 'The object that computes this layer today (a materialized view or function by name), or NULL while nothing folds it yet. Updated by the migration that adds the fold.';
COMMENT ON COLUMN public.map_layers.since_migration IS 'The migration that defined the row as it stands.';

INSERT INTO public.map_layers
  (layer, sort_order, entity, source_table, rule, clock, geography, value_basis, value_column, points_allowed, fold, since_migration)
VALUES
  ('listing', 1, 'vehicle', 'vehicle_location_observations',
   'vehicle_location_observations rows with source_type = ''listing'', vehicle_id NOT NULL and county_fips ~ ''^[0-9]{5}$''; every source_platform (NULL reads as ''unknown''); the vehicle''s first such observation in the fold''s 30-day window, so a vehicle counts once, on the day it was first seen listed; vehicles.is_public AND vehicles.deleted_at IS NULL.',
   'vehicle_location_observations.observed_at of the first listing observation in the window, as a UTC day',
   'the keys of that first observation: county_fips (zip_to_fips from postal_code, else point-in-county; trg_key_vehicle_location_county), state = left(county_fips, 2), point = latitude/longitude when present',
   'asking price', 'vehicles.asking_price', true, 'vehicle_map_county_listings', '20261020193000'),
  ('sale', 2, 'vehicle', 'vehicle_events',
   'vehicle_events rows with event_status = ''sold'' and sold_at NOT NULL (bid-goes-on rows also carry sold_at and are excluded); one event per vehicle per window (the latest sold_at); vehicles.is_public AND vehicles.deleted_at IS NULL.',
   'vehicle_events.sold_at, as a UTC day',
   'the vehicle''s listing location observation for that listing (same source_url, else same source_platform, latest observed_at with a county_fips), else the vehicle''s latest public location observation with a county_fips; state = left(county_fips, 2). A vehicle with no placed observation is counted as ''no county''.',
   'sale price', 'vehicle_events.final_price', true, NULL, '20261020193000'),
  ('vehicle', 3, 'vehicle', 'vehicle_location_observations',
   'any vehicle_location_observations row with vehicle_id NOT NULL; the vehicle''s latest observation (observed_at DESC) decides its place; vehicles.is_public AND vehicles.deleted_at IS NULL.',
   'vehicle_location_observations.observed_at of the latest observation, as a UTC day',
   'the keys of that latest observation: county_fips, state = left(county_fips, 2), point when present; an observation with no county_fips is ''no county''',
   NULL, NULL, true, NULL, '20261020193000'),
  ('organization', 4, 'organization', 'organizations',
   'organizations rows with is_public AND status = ''active''; placed by organizations.latitude/longitude, else the primary organization_locations row with a point (is_primary first, then geocode_confidence DESC), else organizations.zip_code through zip_to_fips; an organization with none of these is ''no county''.',
   'none: current state, no history; the window does not apply and as_of is the fold time',
   'point-in-county from the chosen point (us_county_boundaries), else zip_to_fips from zip_code; state = left(county_fips, 2)',
   NULL, NULL, true, NULL, '20261020193000'),
  ('photo', 5, 'image', 'vehicle_images',
   'vehicle_images rows with is_approved, latitude and longitude NOT NULL, vehicle_id NOT NULL; vehicles.is_public AND vehicles.deleted_at IS NULL; each image counts once.',
   'vehicle_images.taken_at, as a UTC day; NULL taken_at is undated',
   'point-in-county and point-in-ZIP from the image''s own coordinates, aggregated to the area; never drawn as a point (points_allowed = false)',
   NULL, NULL, false, NULL, '20261020193000')
ON CONFLICT (layer) DO NOTHING;

ALTER TABLE public.map_layers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS map_layers_read ON public.map_layers;
CREATE POLICY map_layers_read ON public.map_layers FOR SELECT USING (true);
REVOKE ALL ON public.map_layers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.map_layers TO anon, authenticated, service_role;

COMMIT;
