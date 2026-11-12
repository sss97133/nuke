-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_facet_items -f this-file.sql
-- Proves the header facet items reader (vehicle_facet_items) and its place in vehicle_profile_read: VIN-decoded
-- identity items, engine as built vs current with a change, transmission reading / claim / conflict, derived gearing
-- from a cited rule row, missing items with needed evidence, location at area grain with no points for anyone, and a
-- private or deleted vehicle returning nothing to a logged-out viewer. Every fixture is synthetic.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

-- Supabase's auth shims and roles, as the live policies use them.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.auth_role', true), ''), 'anon') $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

-- The tables the reads touch, with the live SELECT policies that matter to them.
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, user_id uuid, owner_id uuid, uploaded_by uuid, created_by_user_id uuid, entry_type text,
  is_public boolean NOT NULL DEFAULT true, deleted_at timestamptz, vin text,
  year integer, make text, model text, normalized_model text, series text, trim text,
  transmission text, transmission_model text, transmission_code text, mileage integer, mileage_source text,
  canonical_body_style text, body_style text, engine_size text, engine_type text, engine_code text,
  cam_type text, intake_type text, carburetor_type text, drivetrain text, rear_axle_ratio numeric, rear_axle_type text,
  tire_spec_rear text, is_replica boolean,
  city text, state text, location text, listing_location text, bat_location text, discovery_url text, listing_title text);
CREATE TABLE public.field_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, field_name text, proposed_value text,
  source_type text, source_confidence integer, extracted_at timestamptz, status text,
  extraction_context text, raw_extraction_data jsonb);
CREATE TABLE public.vehicle_field_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, field_name text, value_text text, source_type text,
  extraction_method text, extracted_at timestamptz, flagged_as_incorrect boolean);
CREATE TABLE public.ownership_verifications (
  vehicle_id uuid, user_id uuid, status text, title_document_url text, drivers_license_url text);
CREATE TABLE public.vehicle_contributors (vehicle_id uuid, user_id uuid, role text, status text);
CREATE TABLE public.timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, event_type text, event_date date,
  created_at timestamptz DEFAULT now());
CREATE TABLE public.observation_sources (id uuid PRIMARY KEY, slug text, display_name text);
CREATE TABLE public.observation_properties (id uuid PRIMARY KEY, property_key text);
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, kind text, content_text text, source_url text,
  extraction_method text, observed_at timestamptz, is_superseded boolean DEFAULT false, structured_data jsonb,
  confidence_score numeric, ingested_at timestamptz DEFAULT now(), source_id uuid, property_id uuid,
  source_observation_id uuid);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, vehicle_id uuid, is_sensitive boolean DEFAULT false);
CREATE TABLE public.vehicle_location_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_type text, source_platform text,
  source_url text, observed_at timestamptz, location_text_raw text, location_text_clean text, country_code text,
  region_code text, city text, postal_code text, latitude double precision, longitude double precision,
  precision text, confidence real, metadata jsonb, county_fips text, county_name text, zcta text);
CREATE TABLE public.listing_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL, user_id uuid NOT NULL, platform text NOT NULL,
  export_format text NOT NULL, title text NOT NULL, description text, status text DEFAULT 'prepared',
  external_listing_url text, external_listing_id text, submitted_at timestamptz, activated_at timestamptz, metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.listing_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY view_own_exports ON public.listing_exports FOR SELECT USING (user_id = (SELECT auth.uid()));
CREATE TABLE public.test_price_facts (
  vehicle_id uuid PRIMARY KEY, price_kind text, price_amount numeric, price_as_of timestamptz,
  price_live boolean, platform text, source_url text);

CREATE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.vehicle_contributors
                 WHERE vehicle_id = p_vehicle_id AND user_id = p_user_id AND coalesce(status, 'active') = 'active') $$;
CREATE FUNCTION public.vehicle_price_facts(p_vehicle_ids uuid[])
RETURNS TABLE (vehicle_id uuid, price_kind text, price_amount numeric, price_as_of timestamptz,
               price_live boolean, platform text, source_url text)
LANGUAGE sql STABLE AS $$
  SELECT vehicle_id, price_kind, price_amount, price_as_of, price_live, platform, source_url
  FROM public.test_price_facts WHERE vehicle_id = ANY (p_vehicle_ids) $$;
-- The live parent-custody check for retained listing projections; this contract's fixture parents always match.
CREATE FUNCTION public.retained_listing_property_result_matches(uuid, uuid, uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT true $$;

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT
  USING (is_public = true OR auth.role() = 'service_role');
CREATE POLICY vehicles_private_select ON public.vehicles FOR SELECT
  USING (is_public = false AND (SELECT auth.uid()) IS NOT NULL AND (
    (SELECT auth.uid()) = user_id OR (SELECT auth.uid()) = owner_id OR (SELECT auth.uid()) = uploaded_by
    OR public.vehicle_user_has_access(id, (SELECT auth.uid()))));
ALTER TABLE public.field_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view evidence" ON public.field_evidence FOR SELECT
  USING (auth.role() = 'authenticated'
    OR (coalesce(source_type, '') <> ALL (ARRAY['quickbooks', 'invoice', 'email_receipt', 'receipt', 'bank_statement', 'card_statement'])
        AND coalesce(field_name, '') <> ALL (ARRAY['seller_name', 'seller_profile_url', 'seller_phone', 'seller_email', 'buyer_name'])));
ALTER TABLE public.vehicle_field_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_vehicle_evidence ON public.vehicle_field_evidence FOR SELECT
  USING (vehicle_id IN (SELECT id FROM public.vehicles WHERE uploaded_by = (SELECT auth.uid())));
ALTER TABLE public.vehicle_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_obs ON public.vehicle_observations FOR SELECT
  USING (kind IN ('listing', 'specification') AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_observations.vehicle_id AND v.is_public = true));
CREATE POLICY owner_obs ON public.vehicle_observations FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_observations.vehicle_id
    AND (SELECT auth.uid()) IN (v.user_id, v.owner_id, v.uploaded_by)));
-- Live: observation_sources is readable by authenticated only.
ALTER TABLE public.observation_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY sources_authenticated ON public.observation_sources FOR SELECT TO authenticated USING (true);
ALTER TABLE public.observation_properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY properties_read ON public.observation_properties FOR SELECT USING (true);
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_images ON public.vehicle_images FOR SELECT
  USING (NOT is_sensitive AND EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_images.vehicle_id AND v.is_public));
-- Live: confidence >= 0.5, sightings for authenticated only; no vehicle visibility test (the reader states its own).
ALTER TABLE public.vehicle_location_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_locations ON public.vehicle_location_observations FOR SELECT
  USING (confidence >= 0.5 AND (source_type <> 'sighting' OR auth.role() = 'authenticated'));
ALTER TABLE public.timeline_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_vehicle_events ON public.timeline_events FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = timeline_events.vehicle_id AND v.is_public = true));
ALTER TABLE public.ownership_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_claims ON public.ownership_verifications FOR SELECT USING (user_id = (SELECT auth.uid()));
ALTER TABLE public.vehicle_contributors ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON public.vehicle_contributors FOR SELECT USING (user_id = (SELECT auth.uid()));
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
-- Production grants vehicles column by column: the readers may read only granted columns.
REVOKE SELECT ON public.vehicles FROM anon, authenticated;
GRANT SELECT (id, user_id, owner_id, uploaded_by, entry_type, is_public, deleted_at, vin, year, make, model,
  normalized_model, series, trim, transmission, transmission_model, transmission_code, mileage, mileage_source,
  canonical_body_style, body_style, engine_size, engine_type, engine_code, cam_type, intake_type, carburetor_type,
  drivetrain, rear_axle_ratio, rear_axle_type, tire_spec_rear, city, state, location, listing_location, bat_location,
  discovery_url, listing_title) ON public.vehicles TO anon, authenticated;

\ir ../migrations/20261013143000_vehicle_profile_read.sql
\ir ../migrations/20261013144500_vehicle_profile_read_acronyms.sql
\ir ../migrations/20261013161500_vehicle_profile_read_timeline.sql
\ir ../migrations/20261015070000_vehicle_profile_read_description.sql
\ir ../migrations/20261018153000_era_emblems_and_family_facets.sql
\ir ../migrations/20261018171500_mopar_european_identity_marks.sql
\ir ../migrations/20261018174500_land_cruiser_porsche_blazer_pontiac_jaguar_marks.sql
\ir ../migrations/20261018170000_vehicle_profile_read_facets_and_provenance.sql
\ir ../migrations/20261018190000_vehicle_profile_read_identity_marks.sql
\ir ../migrations/20261018193000_profile_read_masthead_identity_marks.sql
\ir ../migrations/20261018200000_identity_marks_require_recorded_trim.sql
\ir ../migrations/20261018220000_profile_read_title_claims.sql
\ir ../migrations/20261018230000_identity_marks_series_label_fallback.sql
\ir ../migrations/20261110090000_tribute_badges_and_engine_correction.sql
\ir ../migrations/20261110093000_vehicles_is_replica_column_grant.sql
\ir ../migrations/20261110100000_listing_submission_state.sql
-- Applied twice: the second run must be a no-op.
\ir ../migrations/20261116100000_vehicle_facet_items.sql
\ir ../migrations/20261116100000_vehicle_facet_items.sql

-- Seeds. v1 a documented VIN-decoded car; v2 listing-sourced with a transmission conflict and cited gearing;
-- v3 thin evidence; v4 private; v5 deleted.
INSERT INTO public.observation_sources VALUES
 ('30000000-0000-0000-0000-000000000001', 'gm_vin_chart', 'GM VIN chart'),
 ('30000000-0000-0000-0000-000000000002', 'fixture_auction', 'Fixture Auctions');
INSERT INTO public.observation_properties VALUES
 ('40000000-0000-0000-0000-000000000001', 'transmission_type');
INSERT INTO public.vehicles (id, user_id, vin, year, make, model, series, trim, is_replica, canonical_body_style,
  engine_type, transmission, city, state) VALUES
 ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'ZZ87D3Q000001', 1973, 'Pontiac',
  'Firebird', 'Firebird', 'Trans Am', true, 'COUPE', '455 V8', 'manual', 'Boulder City', 'NV');
INSERT INTO public.vehicles (id, year, make, model, transmission, transmission_model, rear_axle_ratio, tire_spec_rear,
  listing_location) VALUES
 ('10000000-0000-0000-0000-000000000002', 1970, 'Synthetic', 'Roadster', 'Automatic', 'TH400', 3.42, 'P225/70R15', 'Austin, TX');
INSERT INTO public.vehicles (id, year, make, model) VALUES ('10000000-0000-0000-0000-000000000003', 1990, 'Acme', 'Thing');
INSERT INTO public.vehicles (id, user_id, is_public, year, make, model, transmission) VALUES
 ('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', false, 1988, 'Chevrolet', 'Blazer', 'automatic');
INSERT INTO public.vehicles (id, user_id, deleted_at, year, make, model) VALUES
 ('10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005', now(), 1979, 'Ford', 'Bronco');
INSERT INTO public.vehicle_images (id, vehicle_id) VALUES
 ('50000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-000000000001');

INSERT INTO public.vehicle_observations (id, vehicle_id, kind, source_url, extraction_method, observed_at, structured_data,
  source_id, property_id) VALUES
 -- The VIN decode of v1's current VIN.
 ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'specification',
  'https://example.org/gm-vin-chart', 'vin_decode_gm_chart_v1', '2026-11-11T17:00:00Z',
  '{"vin":"ZZ87D3Q000001","make":"Pontiac","year":1973,"model":"Firebird","series":"Firebird","body_style":"Coupe","decode_rule":"gm_1972_1980_car_vin_v1","series_code":"S","factory_engine":"250","factory_engine_code":"D"}',
  '30000000-0000-0000-0000-000000000001', NULL),
 -- A photo reading of the block (image a) and of the transmission case (image c).
 ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'specification',
  'https://example.org/a.jpg', 'interactive_physical_source_review_v1', '2026-11-09T18:00:00Z',
  '{"image_id":"50000000-0000-0000-0000-00000000000a","claim_role":"nominal_engine_displacement","engine_size":"455-based engine","limitation":"Nominal block marking."}',
  NULL, NULL),
 ('60000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'specification',
  'https://example.org/c.jpg', 'interactive_physical_source_review_v1', '2026-11-09T18:40:00Z',
  '{"image_id":"50000000-0000-0000-0000-00000000000c","claim_role":"identified_transmission_housing","transmission":"Muncie four-speed manual"}',
  NULL, NULL),
 -- A decode of a different VIN never speaks for this vehicle.
 ('60000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'specification',
  'https://example.org/gm-vin-chart', 'vin_decode_gm_chart_v1', '2026-11-10T17:00:00Z',
  '{"vin":"ZZ37X4Q000009","make":"Pontiac","year":1974,"model":"Firebird","decode_rule":"gm_1972_1980_car_vin_v1"}',
  '30000000-0000-0000-0000-000000000001', NULL),
 -- v2: a listing claim that the transmission is automatic.
 ('60000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', 'specification',
  'https://fixture-auction.example/lot/1', 'fixture_listing_property_v1', '2026-10-01T00:00:00Z',
  '{"claim_role":"listing_claim","property_key":"transmission_type","transmission_type":"automatic"}',
  '30000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001');

INSERT INTO public.field_evidence (vehicle_id, field_name, proposed_value, source_type, source_confidence, extracted_at,
  status, extraction_context, raw_extraction_data) VALUES
 -- The observation writer's mirrors of the decode: counted once with it.
 ('10000000-0000-0000-0000-000000000001', 'year', '1973', 'gm_vin_chart', 90, '2026-11-11T17:00:00Z', 'pending',
  'vin_decode_gm_chart_v1 via observation-writer:1.0.0', NULL),
 ('10000000-0000-0000-0000-000000000001', 'factory_engine', '250', 'gm_vin_chart', 90, '2026-11-11T17:00:00Z', 'pending',
  'vin_decode_gm_chart_v1 via observation-writer:1.0.0', NULL),
 -- The record's echo.
 ('10000000-0000-0000-0000-000000000001', 'transmission', 'manual', 'system_update', 60, '2026-11-04T14:30:00Z', 'accepted', NULL, NULL),
 -- A second reader on a second photo: the shifter (image b).
 ('10000000-0000-0000-0000-000000000001', 'transmission', 'manual', 'ai_visual', 95, '2026-11-04T14:26:00Z', 'accepted',
  'photo landing: visible manual shifter', '{"image_id":"50000000-0000-0000-0000-00000000000b","extractor":"photo_land_classification"}'),
 -- The same block photo read again by another reader: one witness, not two.
 ('10000000-0000-0000-0000-000000000001', 'engine_type', '455', 'ai_visual', 90, '2026-11-04T14:23:00Z', 'conflicted',
  'photo landing: stamped 455', '{"image_id":"50000000-0000-0000-0000-00000000000a","extractor":"photo_land_classification"}'),
 -- Superseded testimony is not read.
 ('10000000-0000-0000-0000-000000000001', 'engine_type', '232', 'ai_visual', 90, '2026-11-04T14:23:00Z', 'superseded', NULL, NULL),
 -- v2: a seller says manual.
 ('10000000-0000-0000-0000-000000000002', 'transmission', 'Manual', 'fixture_dealer', 70, '2026-09-01T00:00:00Z', 'accepted', NULL, NULL);

INSERT INTO public.vehicle_location_observations (vehicle_id, source_type, source_platform, observed_at, location_text_raw,
  location_text_clean, country_code, region_code, city, postal_code, latitude, longitude, precision, confidence, zcta,
  county_fips, county_name) VALUES
 ('10000000-0000-0000-0000-000000000001', 'photo_gps', 'vehicle_images', '2026-11-08T12:00:00Z', '123 Fixture Lane',
  NULL, 'US', 'NV', 'Boulder City', '89005', 35.9712345, -114.8345678, 'gps', 0.9, '89005', '32003', 'Clark County'),
 ('10000000-0000-0000-0000-000000000001', 'photo_gps', 'vehicle_images', '2026-11-09T12:00:00Z', '123 Fixture Lane',
  NULL, 'US', 'NV', 'Boulder City', '89005', 35.9712399, -114.8345611, 'gps', 0.9, '89005', '32003', 'Clark County'),
 ('10000000-0000-0000-0000-000000000001', 'listing', 'fixture_auction', '2026-06-01T00:00:00Z', 'Boulder City, Nevada',
  'Boulder City, NV', 'US', 'NV', 'Boulder City', NULL, 35.97, -114.83, 'city', 0.8, '89005', '32003', 'Clark County'),
 ('10000000-0000-0000-0000-000000000004', 'photo_gps', 'vehicle_images', '2026-11-08T12:00:00Z', NULL,
  NULL, 'US', 'NV', 'Henderson', '89012', 36.01, -115.01, 'gps', 0.9, '89012', '32003', 'Clark County');

INSERT INTO public.vehicle_decode_rules (rule_key, make, code, year_min, year_max, value, citation_url, citation_title) VALUES
 ('transmission_gear_ratios', NULL, 'TH400', 1964, 1990, '{"gears":[2.48,1.48,1.00],"reverse":2.08}',
  'https://example.org/th400-ratios', 'Fixture ratio table');

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
CREATE FUNCTION public.t_item(p_vehicle uuid, p_dim text, p_key text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT i FROM jsonb_array_elements(public.vehicle_facet_items(p_vehicle, p_dim)) i WHERE i->>'key' = p_key $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_item(uuid, text, text) TO anon, authenticated;

-- 0. Shape of the machine: invoker, stable, the profile reader's grants, no PUBLIC execute.
DO $$ BEGIN
  PERFORM public.t_assert((SELECT NOT prosecdef AND provolatile = 's' FROM pg_proc
    WHERE oid = 'public.vehicle_facet_items(uuid,text)'::regprocedure), 'reader is stable security invoker');
  PERFORM public.t_assert(NOT has_function_privilege('public', 'public.vehicle_facet_items(uuid,text)', 'EXECUTE')
    OR NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = 'public.vehicle_facet_items(uuid,text)'::regprocedure AND a.grantee = 0),
    'no PUBLIC execute');
  PERFORM public.t_assert(has_function_privilege('anon', 'public.vehicle_facet_items(uuid,text)', 'EXECUTE'), 'anon executes');
  PERFORM public.t_assert(position('facet_items_v1' in pg_get_functiondef('public.vehicle_profile_read(uuid)'::regprocedure)) > 0,
    'profile reader patched once');
  PERFORM public.t_assert((length(pg_get_functiondef('public.vehicle_profile_read(uuid)'::regprocedure))
    - length(replace(pg_get_functiondef('public.vehicle_profile_read(uuid)'::regprocedure), 'token_items AS (', '')))
    / length('token_items AS (') = 1, 'second application is a no-op');
  PERFORM public.t_assert(public.vehicle_facet_norm('displacement', '455 V8') = '7.5'
    AND public.vehicle_facet_norm('displacement', '7.456') = '7.5'
    AND public.vehicle_facet_norm('displacement', '5.7L V8') = '5.7'
    AND public.vehicle_facet_norm('displacement', '250') = '4.1'
    AND public.vehicle_facet_norm('displacement', 'V8') IS NULL
    AND public.vehicle_facet_norm('transmission_type', 'Muncie four-speed manual') = 'manual'
    AND public.vehicle_facet_norm('transmission_type', '4-speed automatic') = 'automatic'
    AND public.vehicle_facet_norm('configuration', '455 V8') = 'V8'
    AND public.vehicle_facet_norm('tire_diameter_in', 'P225/70R15') = '27.4', 'comparison keys');
END $$;

-- 1. Logged-out viewer.
SET ROLE anon;
SET test.auth_role = 'anon';
DO $$
DECLARE all_items jsonb; i jsonb; p jsonb; txt text;
BEGIN
  all_items := public.vehicle_facet_items('10000000-0000-0000-0000-000000000001');
  PERFORM public.t_assert((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(all_items) k)
    = ARRAY['body_style','drivetrain','engine','location','make','model','transmission','trim','year'], 'every token');

  -- VIN-decoded identity.
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'year', 'year.decode');
  PERFORM public.t_assert(i->>'status' = 'established' AND i->>'value' = '1973' AND i->>'facet' = 'decode', 'year decode established');
  PERFORM public.t_assert(i#>>'{rule,key}' = 'gm_1972_1980_car_vin_v1' AND i#>>'{rule,citation_url}' = 'https://example.org/gm-vin-chart',
    'decode cites its rule');
  PERFORM public.t_assert(i#>>'{sources,0,slug}' = 'gm_vin_chart', 'source named for a logged-out viewer');
  PERFORM public.t_assert((i->>'lead')::boolean, 'VIN decode leads identity');
  PERFORM public.t_assert(jsonb_array_length(i->'sources') = 1, 'decode of another VIN is not read');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'year', 'year.recorded');
  PERFORM public.t_assert(i->>'status' = 'established' AND NOT (i->>'lead')::boolean, 'record agrees with the decode');
  PERFORM public.t_assert(jsonb_array_length(i->'sources') = 2, 'decode and its field_evidence mirror count once (decode + record)');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'year', 'year.title');
  PERFORM public.t_assert(i->>'status' = 'missing' AND i->>'needed' = 'photo of the title or registration' AND i->'value' = 'null',
    'missing title claim names its evidence');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'body_style', 'body_style.recorded');
  PERFORM public.t_assert(i->>'status' = 'established' AND i->>'value' = 'Coupe', 'COUPE record and Coupe decode agree; decode leads');

  -- Engine: as built vs current, with the change derived.
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'engine', 'engine.as_built.engine');
  PERFORM public.t_assert(i->>'status' = 'established' AND i->>'value' = '250' AND i->>'normalized' = '4.1'
    AND i#>>'{rule,code}' = 'D', 'as-built engine from the VIN engine code');
  PERFORM public.t_assert(jsonb_array_length(i->'sources') = 1, 'factory_engine mirror counts once');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'engine', 'engine.current.displacement');
  PERFORM public.t_assert(i->>'status' = 'reading' AND i->>'normalized' = '7.5', 'one photo of the block is a reading');
  PERFORM public.t_assert(i->>'needed' IS NOT NULL, 'a reading names what would establish it');
  PERFORM public.t_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(i->'sources') s WHERE s->>'value' = '232'),
    'superseded testimony is not read');
  PERFORM public.t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(i->'sources') s
    WHERE s#>>'{witness,kind}' = 'image' AND s#>>'{witness,id}' = '50000000-0000-0000-0000-00000000000a'), 'photo witness attached');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'engine', 'engine.derived.changed');
  PERFORM public.t_assert(i->>'value' = 'true' AND i->>'status' = 'reading' AND i->>'facet' = 'derived'
    AND i#>>'{equation,as_built_l}' = '4.1' AND i#>>'{equation,current_l}' = '7.5', 'engine change derived with its equation');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'engine', 'engine.current.family');
  PERFORM public.t_assert(i->>'normalized' = 'V8' AND i->>'status' = 'claim', 'record-only family is a claim');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'engine', 'engine.current.block_casting');
  PERFORM public.t_assert(i->>'status' = 'missing' AND i->>'needed' = 'photo of the block casting number', 'missing casting');

  -- Transmission: two readers on two photos establish the type; the case reading is the model.
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'transmission', 'transmission.current.type');
  PERFORM public.t_assert(i->>'status' = 'established' AND i->>'normalized' = 'manual', 'two independent readings establish manual');
  PERFORM public.t_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(i->'sources') s WHERE s->>'slug' = 'system_update'),
    'the record echo is not a source');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'transmission', 'transmission.current.model');
  PERFORM public.t_assert(i->>'status' = 'reading' AND i->>'value' = 'Muncie four-speed manual', 'case reading is the model');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'transmission', 'transmission.current.id_stamp');
  PERFORM public.t_assert(i->>'status' = 'missing' AND i->>'needed' = 'photo of the transmission ID stamp', 'missing ID stamp');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'transmission', 'transmission.current.gear_ratios');
  PERFORM public.t_assert(i->>'status' = 'missing' AND i->'value' = 'null', 'no cited table for an unidentified model');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'transmission', 'transmission.derived.rpm_at_60');
  PERFORM public.t_assert(i->>'status' = 'missing' AND i->>'needed' IS NOT NULL AND i#>>'{equation,expression}' IS NOT NULL,
    'derived number missing with its equation and needed inputs');

  -- Transmission conflict, claims and cited gearing on the listing-sourced car.
  i := public.t_item('10000000-0000-0000-0000-000000000002', 'transmission', 'transmission.current.type');
  PERFORM public.t_assert(i->>'status' = 'conflict' AND jsonb_array_length(i->'sides') = 2, 'listing says automatic, seller says manual');
  PERFORM public.t_assert((SELECT bool_and(jsonb_array_length(s->'sources') >= 1) FROM jsonb_array_elements(i->'sides') s),
    'every side carries its sources');
  i := public.t_item('10000000-0000-0000-0000-000000000002', 'transmission', 'transmission.current.gear_ratios');
  PERFORM public.t_assert(i->>'status' = 'claim' AND i->'value' = '[2.48, 1.48, 1.00]'::jsonb
    AND i#>>'{rule,citation_url}' = 'https://example.org/th400-ratios', 'ratios from the cited table for the claimed model');
  i := public.t_item('10000000-0000-0000-0000-000000000002', 'transmission', 'transmission.derived.final_drive');
  PERFORM public.t_assert(i->'value' = '[8.48, 5.06, 3.42]'::jsonb AND i->>'status' = 'claim', 'final drive per gear');
  i := public.t_item('10000000-0000-0000-0000-000000000002', 'transmission', 'transmission.derived.rpm_at_60');
  PERFORM public.t_assert(i->>'value' = '2517' AND i->>'unit' = 'rpm' AND i#>>'{equation,tire_diameter_in}' = '27.4',
    'rpm at 60 from top gear, axle and tire');

  -- Thin evidence: every item is present, almost all missing, each with what would establish it.
  all_items := public.vehicle_facet_items('10000000-0000-0000-0000-000000000003');
  PERFORM public.t_assert((SELECT count(*) FROM jsonb_each(all_items) e, jsonb_array_elements(e.value) x) = 45, 'fixed item list');
  PERFORM public.t_assert(NOT EXISTS (SELECT 1 FROM jsonb_each(all_items) e, jsonb_array_elements(e.value) x
    WHERE x->>'status' = 'missing' AND nullif(x->>'needed', '') IS NULL), 'every missing item names its evidence');

  -- Location: area grain only, no points, no raw text.
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'location', 'location.current.area');
  PERFORM public.t_assert(i#>>'{value,zcta}' = '89005' AND i#>>'{value,city}' = 'Boulder City' AND i->>'status' = 'established',
    'photo GPS and a listing agree on the area');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'location', 'location.sources.photo_gps');
  PERFORM public.t_assert((i#>>'{value,photos}')::int = 2 AND i#>>'{value,first_at}' IS NOT NULL, 'photo count and date range');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'location', 'location.map');
  PERFORM public.t_assert(i#>>'{value,zcta}' = '89005' AND i#>'{value,bounds}' = 'null' AND i->>'needed' IS NOT NULL,
    'map at ZCTA; bounds missing, never drawn from points');
  txt := public.vehicle_facet_items('10000000-0000-0000-0000-000000000001', 'location')::text;
  PERFORM public.t_assert(txt NOT LIKE '%35.97%' AND txt NOT LIKE '%114.83%' AND txt NOT LIKE '%latitude%'
    AND txt NOT LIKE '%Fixture Lane%', 'no coordinate or raw address reaches the item');

  -- Private and deleted vehicles return nothing.
  PERFORM public.t_assert(public.vehicle_facet_items('10000000-0000-0000-0000-000000000004') IS NULL, 'private vehicle: nothing');
  PERFORM public.t_assert(public.vehicle_facet_items('10000000-0000-0000-0000-000000000004', 'location') IS NULL, 'private location: nothing');
  PERFORM public.t_assert(public.vehicle_facet_items('10000000-0000-0000-0000-000000000005') IS NULL, 'deleted vehicle: nothing');

  -- The profile reader carries the items.
  p := public.vehicle_profile_read('10000000-0000-0000-0000-000000000001');
  PERFORM public.t_assert((SELECT count(*) FROM jsonb_object_keys(p#>'{sections,0,token_items}')) = 9, 'masthead carries every token');
  PERFORM public.t_assert(p#>'{sections,0,token_items,drivetrain}' IS NOT NULL, 'a token with no strip facet still has items');
  PERFORM public.t_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p#>'{sections,1,facets}') f
    WHERE jsonb_typeof(f->'items') <> 'array'), 'every strip facet carries its items');
  PERFORM public.t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(p#>'{sections,1,facets}') f
    WHERE f->>'dimension' = 'transmission' AND f->'items' = p#>'{sections,0,token_items,transmission}'), 'strip items are the token items');
  p := public.vehicle_profile_read('10000000-0000-0000-0000-000000000003');
  PERFORM public.t_assert(p#>'{sections,0,token_items,engine}' IS NOT NULL, 'thin car: items without a strip');
END $$;
RESET ROLE;

-- 2. The private vehicle's owner sees its items; still no coordinates.
SET ROLE authenticated;
SET test.auth_role = 'authenticated';
SET test.auth_uid = '20000000-0000-0000-0000-000000000004';
DO $$
DECLARE i jsonb;
BEGIN
  i := public.t_item('10000000-0000-0000-0000-000000000004', 'transmission', 'transmission.current.type');
  PERFORM public.t_assert(i->>'status' = 'claim' AND i->>'normalized' = 'automatic', 'owner reads the private record');
  i := public.t_item('10000000-0000-0000-0000-000000000004', 'location', 'location.current.area');
  PERFORM public.t_assert(i#>>'{value,zcta}' = '89012' AND i::text NOT LIKE '%36.01%', 'owner: area grain, no point');
  PERFORM public.t_assert(public.vehicle_facet_items('10000000-0000-0000-0000-000000000005') IS NULL, 'deleted: nothing even to a party');
END $$;
RESET ROLE;
SELECT 'vehicle facet items: PASS' AS result;
