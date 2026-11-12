-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_facet_items -f this-file.sql
-- Proves the header facet items reader (vehicle_facet_items) and its place in vehicle_profile_read: VIN-decoded
-- identity items, engine as built vs current with a change, claim-role photo readings (body tag, transmission stamp and
-- castings, engine block) with uncertain characters as limitations, transmission reading / claim / conflict, derived
-- gearing from a cited rule row and candidate ratio sets left uncomputed, missing items with needed evidence, location
-- from the photo GPS fold recounted at read time (the same fixture and numbers as
-- test_field_provenance_photo_location.sql) at area grain with no points for anyone, and a private or deleted vehicle
-- returning nothing to a logged-out viewer. Every fixture is synthetic.
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
  tire_spec_rear text, is_replica boolean, bore_mm numeric, stroke_mm numeric,
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
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, vehicle_id uuid, image_url text DEFAULT 'https://x.invalid/i.jpg',
  is_sensitive boolean DEFAULT false, is_superseded boolean DEFAULT false, is_duplicate boolean DEFAULT false,
  vision_gate_status text, image_vehicle_match_status text, taken_at timestamptz, latitude numeric, longitude numeric);
CREATE TABLE public.vehicle_location_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_type text, source_platform text,
  source_url text, observed_at timestamptz, location_text_raw text, location_text_clean text, country_code text,
  region_code text, city text, postal_code text, latitude double precision, longitude double precision,
  precision text, confidence real, metadata jsonb, county_fips text, county_name text, zcta text,
  created_at timestamptz NOT NULL DEFAULT '2026-11-11T00:00Z');
-- The published city centres the shared photo GPS fold reads for a city-level area (anon cannot read it directly).
CREATE TABLE public.city_geocode_lookup (city text, state text, latitude numeric, longitude numeric, sample_size integer);
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
  drivetrain, rear_axle_ratio, rear_axle_type, tire_spec_rear, bore_mm, stroke_mm, city, state, location, listing_location,
  bat_location, discovery_url, listing_title) ON public.vehicles TO anon, authenticated;

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
-- Live: anon cannot read city centres directly; only the fold (SECURITY DEFINER) can.
REVOKE SELECT ON public.city_geocode_lookup FROM anon, authenticated;
-- The shared photo GPS fold exactly as 20261116007000 defines it (vehicle_location_fold and vehicle_location_areas).
-- That migration also replaces get_field_provenance, which this fixture lacks, so only its two fold functions are
-- applied, cut from the file itself. test_field_provenance_photo_location.sql proves the fold equals
-- get_field_provenance's location_areas; this contract proves the header items carry the fold's areas unchanged.
\set location_fold `awk '/^CREATE OR REPLACE FUNCTION public.vehicle_location_fold/{p=1} /^CREATE OR REPLACE FUNCTION public.get_field_provenance/{p=0} p' supabase/migrations/20261116007000_vehicle_location_areas.sql`
:location_fold
DO $$ BEGIN
  IF to_regprocedure('public.vehicle_location_areas(uuid)') IS NULL THEN
    RAISE EXCEPTION 'the shared fold from 20261116007000 was not applied';
  END IF;
END $$;
-- The live fold: the same bodies as plpgsql (its guard checks the bodies above are 007000's, unchanged).
\ir ../migrations/20261116012000_vehicle_location_fold_plpgsql.sql
-- Applied twice: the second run must be a no-op.
\ir ../migrations/20261116016000_vehicle_facet_items.sql
\ir ../migrations/20261116016000_vehicle_facet_items.sql

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
  listing_location, engine_type, bore_mm, stroke_mm) VALUES
 ('10000000-0000-0000-0000-000000000002', 1970, 'Synthetic', 'Roadster', 'Automatic', 'TH400', 3.42, 'P225/70R15', 'Austin, TX',
  'V8', 101.6, 76.2);
INSERT INTO public.vehicles (id, year, make, model) VALUES ('10000000-0000-0000-0000-000000000003', 1990, 'Acme', 'Thing');
-- v6: a model named, no case casting read: nothing narrows the ratio sets.
INSERT INTO public.vehicles (id, year, make, model, transmission, transmission_model) VALUES
 ('10000000-0000-0000-0000-000000000006', 1972, 'Synthetic', 'Coupe', 'manual', 'M20 or M21');
INSERT INTO public.vehicles (id, user_id, is_public, year, make, model, transmission) VALUES
 ('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', false, 1988, 'Chevrolet', 'Blazer', 'automatic');
INSERT INTO public.vehicles (id, user_id, deleted_at, year, make, model) VALUES
 ('10000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005', now(), 1979, 'Ford', 'Bronco');
INSERT INTO public.vehicle_images (id, vehicle_id) VALUES
 ('50000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-00000000000e', '10000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-00000000000f', '10000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000001');
-- GPS photos of v1, as in test_field_provenance_photo_location.sql: two on day 1, one on day 2, and a sensitive one
-- listed on day 2 that no reader may count.
INSERT INTO public.vehicle_images (id, vehicle_id, taken_at, latitude, longitude, is_sensitive) VALUES
 ('55555555-5555-5555-5555-000000000001', '10000000-0000-0000-0000-000000000001', '2026-10-06T15:00Z', 35.97261, -114.85575, false),
 ('55555555-5555-5555-5555-000000000002', '10000000-0000-0000-0000-000000000001', '2026-10-06T18:00Z', 35.97301, -114.85601, false),
 ('55555555-5555-5555-5555-000000000003', '10000000-0000-0000-0000-000000000001', '2026-10-07T01:00Z', 35.97261, -114.85575, false),
 ('55555555-5555-5555-5555-000000000004', '10000000-0000-0000-0000-000000000001', '2026-10-07T02:00Z', 35.97261, -114.85575, true);

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
 -- Claim-role photo readings (synthetic codes). Body tag on image d, read again on image e by the same reader.
 ('60000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', 'specification', NULL, 'cowl_tag_decode_v1',
  '2026-10-28T17:23:49Z', '{"image_id":"50000000-0000-0000-0000-00000000000d","claim_role":"cowl_tag_style","fisher_style_number":"ZFS00","body_style":"Hardtop coupe","reviewed_url":"https://x.invalid/users/private/path.jpg"}', NULL, NULL),
 ('60000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', 'specification', NULL, 'cowl_tag_decode_v1',
  '2026-10-28T17:23:49Z', '{"image_id":"50000000-0000-0000-0000-00000000000d","claim_role":"cowl_tag_body_number","fisher_body_number":"100001","uncertain_characters":"fourth digit 0 or 8"}', NULL, NULL),
 ('60000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001', 'specification', NULL, 'cowl_tag_decode_v1',
  '2026-10-28T17:23:49Z', '{"image_id":"50000000-0000-0000-0000-00000000000d","claim_role":"cowl_tag_trim","interior_trim_code":"999","seat_code":"Z00"}', NULL, NULL),
 ('60000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000001', 'specification', NULL, 'cowl_tag_decode_v1',
  '2026-10-28T17:23:49Z', '{"image_id":"50000000-0000-0000-0000-00000000000d","claim_role":"original_transmission_evidence","original_transmission":"unknown","proof_needed":["fixture build sheet","fixture billing history"]}', NULL, NULL),
 ('60000000-0000-0000-0000-000000000015', '10000000-0000-0000-0000-000000000001', 'specification', NULL, 'cowl_tag_decode_v1',
  '2026-10-28T17:23:49Z', '{"image_id":"50000000-0000-0000-0000-00000000000d","claim_role":"cowl_tag_option_codes","transmission_on_tag":"not_recorded"}', NULL, NULL),
 ('60000000-0000-0000-0000-000000000016', '10000000-0000-0000-0000-000000000001', 'specification', NULL, 'cowl_tag_decode_v1',
  '2026-10-28T17:24:01Z', '{"image_id":"50000000-0000-0000-0000-00000000000e","claim_role":"cowl_tag_transcription","fisher_style_number":"ZFS00","interior_trim_code":"999","seat_code":"Z00"}', NULL, NULL),
 -- Transmission: ID stamp on image f, case casting on image c (the image the interactive reader also read).
 ('60000000-0000-0000-0000-000000000017', '10000000-0000-0000-0000-000000000001', 'specification', NULL, 'trans_id_stamp_decode_v1',
  '2026-10-28T17:09:34Z', '{"image_id":"50000000-0000-0000-0000-00000000000f","claim_role":"transmission_id_stamp","transmission_code":"Z0101","transmission_assembly_date":"January 1 (fixture)","transmission":"Muncie 4-speed manual","factory_configuration_status":"not_original_unit"}', NULL, NULL),
 ('60000000-0000-0000-0000-000000000018', '10000000-0000-0000-0000-000000000001', 'specification', NULL, 'trans_id_stamp_decode_v1',
  '2026-10-28T17:09:31Z', '{"image_id":"50000000-0000-0000-0000-00000000000c","claim_role":"transmission_case_model","case_casting":"9990001","transmission_model":"Fixture M20 or M21 (case)","transmission":"Muncie 4-speed manual","excluded_models":["M22"],"factory_configuration_status":"not_original_unit"}', NULL, NULL),
 ('60000000-0000-0000-0000-000000000019', '10000000-0000-0000-0000-000000000001', 'specification', NULL, 'physical_transcription_v1',
  '2026-10-28T17:11:29Z', '{"image_id":"50000000-0000-0000-0000-000000000011","claim_role":"transmission_bellhousing","bellhousing_casting":"999003","uncertain_characters":"first digit 5 or 6"}', NULL, NULL),
 -- Tail housing, side cover and shifter, each on its own photo, in the shapes the transmission reader writes.
 ('60000000-0000-0000-0000-00000000001e', '10000000-0000-0000-0000-000000000001', 'specification', NULL, 'physical_transcription_v1',
  '2026-10-28T17:12:00Z', '{"image_id":"50000000-0000-0000-0000-000000000012","claim_role":"transmission_tailhousing","transmission_tailhousing":"999004","transmission":"Muncie four-speed","output_spline_count":27,"speedometer_output_side":"left","limitation":"Fixture: spline count read from a side view."}', NULL, NULL),
 ('60000000-0000-0000-0000-00000000001f', '10000000-0000-0000-0000-000000000001', 'specification', NULL, 'physical_transcription_v1',
  '2026-10-28T17:12:30Z', '{"image_id":"50000000-0000-0000-0000-000000000013","claim_role":"transmission_side_cover","transmission_side_cover_casting":"999005","uncertain_characters":"last digit 5 or 6"}', NULL, NULL),
 ('60000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000001', 'specification', NULL, 'physical_transcription_v1',
  '2026-10-28T17:13:00Z', '{"image_id":"50000000-0000-0000-0000-000000000014","claim_role":"transmission_shifter","shifter_bracket_marking":"ZZ-01","shifter_linkage":"fixture floor linkage"}', NULL, NULL),
 -- Engine: the block casting on image a (read before the interactive reading of the same photo), the code stamp on
 -- image 10.
 ('60000000-0000-0000-0000-00000000001a', '10000000-0000-0000-0000-000000000001', 'specification', NULL, 'engine_block_decode_v1',
  '2026-10-29T22:19:13Z', '{"image_id":"50000000-0000-0000-0000-00000000000a","claim_role":"engine_block_casting","engine_block_casting":"9990002","engine_size":"455","engine_type":"Pontiac V8","block_casting_year":1970,"factory_configuration_status":"not_original_engine"}', NULL, NULL),
 ('60000000-0000-0000-0000-00000000001b', '10000000-0000-0000-0000-000000000001', 'specification', NULL, 'engine_block_decode_v1',
  '2026-10-29T22:15:30Z', '{"image_id":"50000000-0000-0000-0000-000000000010","claim_role":"engine_code_stamp","engine_code":"ZZ","engine_size":"455","factory_configuration_status":"not_original_engine"}', NULL, NULL),
 -- A second role read from the block photo (one witness, not two), and a roled note this reader does not map.
 ('60000000-0000-0000-0000-00000000001c', '10000000-0000-0000-0000-000000000001', 'specification', NULL, 'engine_block_decode_v1',
  '2026-10-29T22:19:13Z', '{"image_id":"50000000-0000-0000-0000-00000000000a","claim_role":"engine_block_casting_dossier_fields","engine_block_casting":"9990002","engine_displacement_l":7.46,"engine_configuration":"V8","factory_configuration_status":"not_original_engine"}', NULL, NULL),
 ('60000000-0000-0000-0000-00000000001d', '10000000-0000-0000-0000-000000000001', 'specification', NULL, 'photo_map_harvest_v1',
  '2026-10-28T17:18:06Z', '{"image_id":"50000000-0000-0000-0000-00000000000b","claim_role":"inferred","engine_size":"350","transmission":"automatic"}', NULL, NULL),
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

-- The photo GPS fold's admitted rows for v1 (as test_field_provenance_photo_location.sql seeds them), a withdrawn row,
-- a legacy point row and a sighting the reader never reads, and listings.
INSERT INTO public.vehicle_location_observations (id, vehicle_id, source_type, source_platform, observed_at,
  location_text_raw, location_text_clean, country_code, region_code, city, postal_code, latitude, longitude, precision,
  confidence, zcta, county_fips, county_name, metadata) VALUES
 ('66666666-6666-6666-6666-000000000001', '10000000-0000-0000-0000-000000000001', 'exif', 'photo_exif', '2026-10-06T18:00Z',
  NULL, 'Boulder City, NV', 'US', 'NV', 'Boulder City', NULL, NULL, NULL, 'city', 0.7, NULL, '32003', 'Clark',
  '{"method":"photo_gps_fold_v1","utc_day":"2026-10-06","photos":2,"image_ids":["55555555-5555-5555-5555-000000000001","55555555-5555-5555-5555-000000000002"]}'),
 ('66666666-6666-6666-6666-000000000002', '10000000-0000-0000-0000-000000000001', 'exif', 'photo_exif', '2026-10-07T01:00Z',
  NULL, 'Boulder City, NV', 'US', 'NV', 'Boulder City', NULL, NULL, NULL, 'city', 0.7, NULL, '32003', 'Clark',
  '{"method":"photo_gps_fold_v1","utc_day":"2026-10-07","photos":1,"image_ids":["55555555-5555-5555-5555-000000000003","55555555-5555-5555-5555-000000000004"]}'),
 ('66666666-6666-6666-6666-000000000003', '10000000-0000-0000-0000-000000000001', 'exif', 'photo_exif', '2026-10-08T01:00Z',
  NULL, 'Henderson, NV', 'US', 'NV', 'Henderson', NULL, NULL, NULL, 'city', 0, NULL, '32003', 'Clark',
  '{"method":"photo_gps_fold_v1","utc_day":"2026-10-08","image_ids":["55555555-5555-5555-5555-000000000001"],"withdrawn_at":"2026-11-11"}'),
 ('66666666-6666-6666-6666-000000000005', '10000000-0000-0000-0000-000000000001', 'photo_gps', 'vehicle_images', '2026-11-08T12:00:00Z',
  '123 Fixture Lane', NULL, 'US', 'NV', 'Pahrump', '89048', 36.2091234, -115.9834567, 'gps', 0.9, '89048', '32023', 'Nye', '{}'),
 ('66666666-6666-6666-6666-000000000006', '10000000-0000-0000-0000-000000000001', 'sighting', 'photo_exif', '2026-11-08T12:00:00Z',
  NULL, NULL, 'US', 'NV', NULL, NULL, 36.2091234, -115.9834567, 'gps', 0.9, NULL, NULL, NULL, '{}'),
 ('66666666-6666-6666-6666-000000000007', '10000000-0000-0000-0000-000000000001', 'listing', 'fixture_auction', '2026-06-01T00:00:00Z',
  'Boulder City, Nevada', 'Boulder City, NV', 'US', 'NV', 'Boulder City', NULL, 35.97, -114.83, 'city', 0.8, '89005', '32003', 'Clark', '{}'),
 ('66666666-6666-6666-6666-000000000008', '10000000-0000-0000-0000-000000000001', 'listing', 'bat', '2026-05-01T00:00:00Z',
  'Reno, Nevada', 'Reno, NV', 'US', 'NV', 'Reno', NULL, NULL, NULL, 'city', 0.8, NULL, NULL, NULL, '{}'),
 ('66666666-6666-6666-6666-000000000009', '10000000-0000-0000-0000-000000000004', 'listing', 'fixture_auction', '2026-11-08T12:00:00Z',
  NULL, 'Henderson, NV', 'US', 'NV', 'Henderson', '89012', 36.01, -115.01, 'city', 0.9, '89012', '32003', 'Clark', '{}');

INSERT INTO public.vehicle_decode_rules (rule_key, make, code, year_min, year_max, value, citation_url, citation_title) VALUES
 ('transmission_gear_ratios', NULL, 'TH400', 1964, 1990, '{"gears":[2.48,1.48,1.00],"reverse":2.08}',
  'https://example.org/th400-ratios', 'Fixture ratio table'),
 -- The v1 case reading names M20 or M21; each comes in two countershaft sizes. The case casting read off the unit
 -- (9990001, 7/8 in) leaves one set per model: shown as candidates, never computed over. The 1-inch M20 set, the one
 -- the car's own model year would pick, is excluded.
 ('transmission_gear_ratios', NULL, 'M20', 1963, 1965, '{"gears":[2.56,1.91,1.48,1.00],"reverse":3.16,"countershaft_in":"7/8"}',
  'https://example.org/muncie-ratios', 'Fixture Muncie table'),
 ('transmission_gear_ratios', NULL, 'M20', 1965, 1974, '{"gears":[2.52,1.88,1.46,1.00],"reverse":3.11,"countershaft_in":"1"}',
  'https://example.org/muncie-ratios', 'Fixture Muncie table'),
 ('transmission_gear_ratios', NULL, 'M21', 1963, 1965, '{"gears":[2.20,1.64,1.28,1.00],"reverse":2.27,"countershaft_in":"7/8"}',
  'https://example.org/muncie-ratios', 'Fixture Muncie table'),
 ('transmission_gear_ratios', NULL, 'M21', 1965, 1974, '{"gears":[2.20,1.64,1.28,1.00],"reverse":2.27,"countershaft_in":"1"}',
  'https://example.org/muncie-ratios', 'Fixture Muncie table'),
 ('transmission_case_casting', NULL, '9990001', 1963, 1965, '{"countershaft_in":"7/8"}',
  'https://example.org/muncie-cases', 'Fixture case table');
INSERT INTO public.city_geocode_lookup VALUES ('Boulder City', 'NV', 35.97864, -114.83245, 40), ('Boulder City', 'NV', 35.9, -114.9, 2);
-- One current row per rule, scope and citation.
DO $$ BEGIN
  BEGIN
    INSERT INTO public.vehicle_decode_rules (rule_key, code, year_min, year_max, value, citation_url) VALUES
      ('transmission_gear_ratios', 'M20', 1963, 1965, '{"gears":[1]}', 'https://example.org/muncie-ratios');
    RAISE EXCEPTION 'FAIL: a duplicate current rule row was admitted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
CREATE FUNCTION public.t_item(p_vehicle uuid, p_dim text, p_key text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT i FROM jsonb_array_elements(public.vehicle_facet_items(p_vehicle, p_dim)) i WHERE i->>'key' = p_key $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_item(uuid, text, text) TO anon, authenticated;

-- Visibility is unchanged by the observation-id patch (20261116031000): every viewer (logged out, signed in but untied,
-- the owner) gets the same items from every reader call, on a public and on a private vehicle, before and after it.
CREATE TABLE public.t_facet_snap (phase text, who text, vid uuid, call text, doc jsonb);
CREATE FUNCTION public.t_facet_snapshot(p_phase text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE w record; c record; d jsonb;
BEGIN
  FOR w IN SELECT * FROM (VALUES
      ('anon', 'anon', ''),
      ('untied', 'authenticated', '20000000-0000-0000-0000-000000000099'),
      ('owner_v1', 'authenticated', '20000000-0000-0000-0000-000000000001'),
      ('owner_v4', 'authenticated', '20000000-0000-0000-0000-000000000004')) x(who, role, uid) LOOP
    FOR c IN SELECT * FROM (VALUES
        ('10000000-0000-0000-0000-000000000001'::uuid), ('10000000-0000-0000-0000-000000000002'::uuid),
        ('10000000-0000-0000-0000-000000000004'::uuid), ('10000000-0000-0000-0000-000000000005'::uuid)) v(vid)
      CROSS JOIN (VALUES ('all'), ('masthead'), ('location'), ('profile')) k(call) LOOP
      PERFORM set_config('test.auth_role', w.role, true);
      PERFORM set_config('test.auth_uid', w.uid, true);
      EXECUTE format('SET LOCAL ROLE %I', w.role);
      d := CASE c.call
        WHEN 'all' THEN public.vehicle_facet_items(c.vid)
        WHEN 'profile' THEN public.vehicle_profile_read(c.vid)#>'{sections,0,token_items}'
        ELSE public.vehicle_facet_items(c.vid, c.call) END;
      RESET ROLE;
      INSERT INTO public.t_facet_snap VALUES (p_phase, w.who, c.vid, c.call, d);
    END LOOP;
  END LOOP;
  PERFORM set_config('test.auth_role', '', true);
  PERFORM set_config('test.auth_uid', '', true);
END $$;
SELECT public.t_facet_snapshot('before');
-- The reader reads observations by id (row policies on the rows that can speak to a token); applied twice: a no-op.
\ir ../migrations/20261116031000_vehicle_facet_items_observation_ids.sql
\ir ../migrations/20261116031000_vehicle_facet_items_observation_ids.sql
SELECT public.t_facet_snapshot('after');
DO $$ BEGIN
  PERFORM public.t_assert((SELECT count(*) FROM public.t_facet_snap WHERE phase = 'before') = 64, 'snapshot taken');
  PERFORM public.t_assert(NOT EXISTS (
    SELECT 1 FROM public.t_facet_snap b JOIN public.t_facet_snap a
      ON a.phase = 'after' AND a.who = b.who AND a.vid = b.vid AND a.call = b.call
    WHERE b.phase = 'before' AND a.doc IS DISTINCT FROM b.doc), 'every viewer, every call: the same items before and after');
  PERFORM public.t_assert((SELECT bool_and(doc IS NULL OR doc = 'null'::jsonb) FROM public.t_facet_snap
    WHERE vid = '10000000-0000-0000-0000-000000000004' AND who IN ('anon', 'untied', 'owner_v1')),
    'private vehicle: nothing to anyone but its party');
  PERFORM public.t_assert((SELECT bool_and(doc IS NOT NULL) FROM public.t_facet_snap
    WHERE vid = '10000000-0000-0000-0000-000000000004' AND who = 'owner_v4' AND call <> 'profile'),
    'private vehicle: its owner reads its items');
  PERFORM public.t_assert((SELECT bool_and(doc IS NOT NULL AND jsonb_typeof(doc) <> 'null') FROM public.t_facet_snap
    WHERE vid = '10000000-0000-0000-0000-000000000001'), 'public vehicle: everyone reads its items');
  PERFORM public.t_assert((SELECT bool_and(doc IS NULL OR doc = 'null'::jsonb) FROM public.t_facet_snap
    WHERE vid = '10000000-0000-0000-0000-000000000005'), 'deleted vehicle: nothing to anyone');
END $$;
-- The id helper: ids only, no PUBLIC execute.
DO $$ BEGIN
  PERFORM public.t_assert((SELECT prosecdef AND prorettype = 'uuid[]'::regtype FROM pg_proc
    WHERE oid = 'public.vehicle_facet_observation_ids(uuid,text[])'::regprocedure), 'helper returns ids only');
  PERFORM public.t_assert(NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
    WHERE p.oid = 'public.vehicle_facet_observation_ids(uuid,text[])'::regprocedure AND a.grantee = 0), 'helper: no PUBLIC execute');
END $$;

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

  -- Body tag readings: as-built items with their image witness; the same reader on two photos stays a reading.
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'body_style', 'body_style.body_tag');
  PERFORM public.t_assert(i->>'status' = 'reading' AND i->>'value' = 'ZFS00' AND i->>'facet' = 'as_built'
    AND jsonb_array_length(i->'sources') = 2, 'body tag style number, one reader on two photos');
  PERFORM public.t_assert(i::text NOT LIKE '%x.invalid/users%', 'a reading''s stored URLs never reach the item');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'body_style', 'body_style.body_number');
  PERFORM public.t_assert(i->>'value' = '100001' AND i#>>'{sources,0,limitation}' = 'uncertain characters: fourth digit 0 or 8',
    'uncertain characters travel as a limitation');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'trim', 'trim.as_built.interior');
  PERFORM public.t_assert(i->>'value' = '999' AND i#>>'{sources,0,decoded,seat_code}' = 'Z00', 'trim code with its seat code');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'body_style', 'body_style.build_date');
  PERFORM public.t_assert(i->>'status' = 'missing' AND i->>'needed' IS NOT NULL, 'unread build date is missing');

  -- Engine: as built vs current, with the change derived.
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'engine', 'engine.as_built.engine');
  PERFORM public.t_assert(i->>'status' = 'established' AND i->>'value' = '4.1' AND i->>'stated' = '250' AND i->>'unit' = 'L'
    AND i#>>'{rule,code}' = 'D', 'as-built engine from the VIN engine code, in liters');
  PERFORM public.t_assert(jsonb_array_length(i->'sources') = 1, 'factory_engine mirror counts once');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'engine', 'engine.current.displacement');
  PERFORM public.t_assert(i->>'status' = 'established' AND i->>'value' = '7.5' AND i->>'unit' = 'L',
    'two photos read by two readers establish 7.5 L');
  PERFORM public.t_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(i->'sources') s WHERE s->>'value' = '232'),
    'superseded testimony is not read');
  PERFORM public.t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(i->'sources') s
    WHERE s#>>'{witness,kind}' = 'image' AND s#>>'{witness,id}' = '50000000-0000-0000-0000-00000000000a'), 'photo witness attached');
  PERFORM public.t_assert((SELECT count(*) FROM jsonb_array_elements(i->'sources') s
    WHERE s#>>'{witness,id}' = '50000000-0000-0000-0000-00000000000a') = 1, 'one photo is one witness however many readers');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'engine', 'engine.derived.changed');
  PERFORM public.t_assert(i->>'value' = 'true' AND i->>'status' = 'established' AND i->>'facet' = 'derived'
    AND i#>>'{equation,as_built_l}' = '4.1' AND i#>>'{equation,current_l}' = '7.5' AND i->'needed' = 'null'
    AND jsonb_array_length(i->'sources') = 2, 'engine change derived, with the not-original readings as sources');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'engine', 'engine.current.family');
  PERFORM public.t_assert(i->>'normalized' = 'V8' AND i->>'status' = 'reading', 'block reading and record agree on V8');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'engine', 'engine.current.block_casting');
  PERFORM public.t_assert(i->>'status' = 'reading' AND i->>'value' = '9990002'
    AND i#>>'{sources,0,decoded,block_casting_year}' = '1970', 'block casting with its decoded year');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'engine', 'engine.current.engine_code_stamp');
  PERFORM public.t_assert(i->>'status' = 'reading' AND i->>'value' = 'ZZ', 'engine code stamp');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'engine', 'engine.derived.displacement_ci');
  PERFORM public.t_assert(i->>'status' = 'missing' AND i->>'needed' = 'the current bore, stroke and cylinder count',
    'no bore or stroke: no computed displacement');
  i := public.t_item('10000000-0000-0000-0000-000000000002', 'engine', 'engine.derived.displacement_ci');
  PERFORM public.t_assert(i->>'value' = '301.6' AND i->>'unit' = 'ci' AND i->>'status' = 'claim' AND (i#>>'{equation,cylinders}')::int = 8,
    'displacement from bore, stroke and the family''s cylinder count');

  -- Transmission: readers on several photos establish the type; the case reading is the model.
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'transmission', 'transmission.current.type');
  PERFORM public.t_assert(i->>'status' = 'established' AND i->>'normalized' = 'manual', 'independent readings establish manual');
  PERFORM public.t_assert(i->>'value' = 'manual' AND i->>'stated' IS NOT NULL AND i->>'stated' <> 'manual',
    'established on what the readings share; the most specific words stay in stated, not as the value');
  PERFORM public.t_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(i->'sources') s WHERE s->>'slug' = 'system_update'),
    'the record echo is not a source');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'transmission', 'transmission.current.model');
  PERFORM public.t_assert(i->>'status' = 'reading' AND i->>'value' = 'Fixture M20 or M21 (case)'
    AND i#>'{sources,0,decoded,excluded_models}' = '["M22"]'::jsonb, 'case reading is the model, as a candidate set');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'transmission', 'transmission.current.id_stamp');
  PERFORM public.t_assert(i->>'status' = 'reading' AND i->>'value' = 'Z0101', 'ID stamp reading');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'transmission', 'transmission.current.bellhousing_casting');
  PERFORM public.t_assert(i->>'value' = '999003' AND i#>>'{sources,0,limitation}' LIKE '%first digit 5 or 6%', 'bellhousing, uncertain digit');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'transmission', 'transmission.current.tailhousing_casting');
  PERFORM public.t_assert(i->>'status' = 'reading' AND i->>'value' = '999004'
    AND i#>>'{sources,0,decoded,output_spline_count}' = '27' AND i#>>'{sources,0,witness,id}' = '50000000-0000-0000-0000-000000000012'
    AND i#>>'{sources,0,limitation}' LIKE '%side view%', 'tail housing casting, with its decoded spline count and limitation');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'transmission', 'transmission.current.side_cover_casting');
  PERFORM public.t_assert(i->>'status' = 'reading' AND i->>'value' = '999005'
    AND i#>>'{sources,0,limitation}' LIKE '%last digit 5 or 6%', 'side cover casting, uncertain digit');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'transmission', 'transmission.current.shifter');
  PERFORM public.t_assert(i->>'status' = 'reading' AND i->>'value' = 'ZZ-01'
    AND i#>>'{sources,0,decoded,shifter_linkage}' = 'fixture floor linkage', 'shifter marking with its linkage');
  i := public.t_item('10000000-0000-0000-0000-000000000003', 'transmission', 'transmission.current.tailhousing_casting');
  PERFORM public.t_assert(i->>'status' = 'missing' AND i->>'needed' = 'photo of the tail housing casting number', 'missing tail housing');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'transmission', 'transmission.as_built.type');
  PERFORM public.t_assert(i->>'status' = 'missing' AND i->>'needed' = 'fixture billing history; fixture build sheet'
    AND jsonb_array_length(i->'examined') = 2, 'as-built transmission: examined, not stated, with the proof the reader names');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'transmission', 'transmission.derived.changed');
  PERFORM public.t_assert(i->>'value' = 'true' AND i->>'status' = 'reading' AND jsonb_array_length(i->'sources') = 2,
    'readers say the unit is not original: a reading of a change');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'transmission', 'transmission.current.gear_ratios');
  PERFORM public.t_assert(i->>'status' = 'missing' AND i->'value' = 'null' AND jsonb_array_length(i->'candidates') = 2
    AND i->>'needed' = 'unit year or ratio-set identification', 'two candidate ratio sets: shown, not chosen');
  PERFORM public.t_assert(i#>>'{rule,narrowed_by,countershaft_in}' = '7/8'
    AND (SELECT array_agg(c->>'code' ORDER BY c->>'code') FROM jsonb_array_elements(i->'candidates') c) = ARRAY['M20', 'M21']
    AND (SELECT bool_and(c->>'countershaft_in' = '7/8') FROM jsonb_array_elements(i->'candidates') c)
    AND i::text NOT LIKE '%2.52%', 'the case casting''s countershaft narrows the sets; the car''s year never picks one');
  i := public.t_item('10000000-0000-0000-0000-000000000006', 'transmission', 'transmission.current.gear_ratios');
  PERFORM public.t_assert(i->>'status' = 'missing' AND i->'value' = 'null' AND i#>'{rule,narrowed_by}' = 'null'
    AND jsonb_array_length(i->'candidates') = 4 AND i::text LIKE '%2.52%' AND i::text LIKE '%2.56%'
    AND i->>'needed' LIKE 'countershaft size from the case casting%',
    'no case casting: every candidate set for the named codes, and the case casting named as needed');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'transmission', 'transmission.derived.final_drive');
  PERFORM public.t_assert(i->>'status' = 'missing' AND i->'value' = 'null', 'nothing computed over candidates');
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
    AND i#>>'{rule,rows,0,citation_url}' = 'https://example.org/th400-ratios'
    AND NOT (i ? 'candidates'), 'ratios from the cited table for the claimed model');
  i := public.t_item('10000000-0000-0000-0000-000000000002', 'transmission', 'transmission.derived.final_drive');
  PERFORM public.t_assert(i->'value' = '[8.48, 5.06, 3.42]'::jsonb AND i->>'status' = 'claim', 'final drive per gear');
  i := public.t_item('10000000-0000-0000-0000-000000000002', 'transmission', 'transmission.derived.rpm_at_60');
  PERFORM public.t_assert(i->>'value' = '2517' AND i->>'unit' = 'rpm' AND i#>>'{equation,tire_diameter_in}' = '27.4',
    'rpm at 60 from top gear, axle and tire');

  -- Thin evidence: every item is present, almost all missing, each with what would establish it.
  all_items := public.vehicle_facet_items('10000000-0000-0000-0000-000000000003');
  PERFORM public.t_assert((SELECT count(*) FROM jsonb_each(all_items) e, jsonb_array_elements(e.value) x) = 58, 'fixed item list');
  PERFORM public.t_assert(NOT EXISTS (SELECT 1 FROM jsonb_each(all_items) e, jsonb_array_elements(e.value) x
    WHERE x->>'status' = 'missing' AND nullif(x->>'needed', '') IS NULL), 'every missing item names its evidence');
  PERFORM public.t_assert(NOT EXISTS (SELECT 1 FROM jsonb_each(all_items) e, jsonb_array_elements(e.value) x
    WHERE NOT (x ?& ARRAY['key', 'facet', 'value', 'unit', 'status', 'sources', 'rule', 'equation', 'needed'])),
    'every item carries the spec shape');

  -- Location: the photo GPS fold recounted from visible photos, the same numbers get_field_provenance('location')
  -- returns for this fixture (test_field_provenance_photo_location.sql); area grain only, no points, no raw text.
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'location', 'location.current.area');
  PERFORM public.t_assert(i#>>'{value,label}' = 'Boulder City, NV' AND i#>>'{value,level}' = 'city'
    AND i#>>'{value,county_fips}' = '32003' AND i#>'{value,zcta}' = 'null' AND i->>'status' = 'established',
    'photo GPS and a listing agree on the area');
  PERFORM public.t_assert((SELECT count(*) FROM jsonb_array_elements(i->'sources') s WHERE s->>'kind' = 'record') = 1,
    'the record agrees and is listed, not counted');
  PERFORM public.t_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(i->'sources') s WHERE s->>'value' LIKE 'Reno%'),
    'a listing elsewhere is not a source for this area');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'location', 'location.sources.photo_gps');
  PERFORM public.t_assert(jsonb_array_length(i#>'{value,areas}') = 1, 'one area: withdrawn, legacy and sighting rows are not read');
  PERFORM public.t_assert((i#>>'{value,areas,0,photos}')::int = 3 AND (i#>>'{value,areas,0,days}')::int = 2
    AND (i#>>'{value,areas,0,first_taken_at}')::timestamptz = '2026-10-06T15:00Z'
    AND (i#>>'{value,areas,0,last_taken_at}')::timestamptz = '2026-10-07T01:00Z'
    AND i#>>'{value,areas,0,latest_observation_id}' = '66666666-6666-6666-6666-000000000002',
    'fold parity: 3 photos (the sensitive one not counted), 2 days, the dates and latest row');
  -- Parity with the shared fold: the header's photo area is vehicle_location_areas()[0], field for field.
  p := public.vehicle_location_areas('10000000-0000-0000-0000-000000000001')->0;
  PERFORM public.t_assert(i#>>'{value,areas,0,label}' = p->>'label' AND i#>'{value,areas,0,photos}' = p->'photos'
    AND i#>'{value,areas,0,days}' = p->'days' AND (i#>>'{value,areas,0,first_taken_at}')::timestamptz = (p->>'first_taken_at')::timestamptz
    AND (i#>>'{value,areas,0,last_taken_at}')::timestamptz = (p->>'last_taken_at')::timestamptz
    AND i#>>'{value,areas,0,latest_observation_id}' = p->>'latest_observation_id' AND NOT (p ? 'point'),
    'the header carries the shared fold''s area unchanged');
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'location', 'location.map');
  PERFORM public.t_assert(i#>>'{value,county_fips}' = '32003' AND i->>'needed' LIKE 'the ZCTA%'
    AND i#>'{value,bounds}' = '{"grain": "county", "county_fips": "32003", "geojson": "map-data/geo/v1/county/32003.geojson"}'::jsonb
    AND i#>>'{value,centroid,lat}' = '35.9786' AND i#>>'{value,centroid,basis}' = 'city_centroid',
    'map at city grain: the county outline as bounds, centred on the city''s published centre; the ZCTA named as needed');
  txt := public.vehicle_facet_items('10000000-0000-0000-0000-000000000001')::text;
  PERFORM public.t_assert(txt !~ '35\.972|35\.973|114\.855|114\.856|36\.209|115\.98|35\.97[^0-9]' AND txt NOT LIKE '%latitude%'
    AND txt NOT LIKE '%Fixture Lane%' AND txt NOT LIKE '%Pahrump%', 'no coordinate or raw address reaches any item');

  -- The observation id list: only rows that can speak to a token, and none for a vehicle the viewer cannot see.
  PERFORM public.t_assert(NOT ('60000000-0000-0000-0000-00000000001d'::uuid = ANY (public.vehicle_facet_observation_ids(
      '10000000-0000-0000-0000-000000000001', ARRAY['cowl_tag_style', 'engine_block_casting'])))
    AND '60000000-0000-0000-0000-00000000001a'::uuid = ANY (public.vehicle_facet_observation_ids(
      '10000000-0000-0000-0000-000000000001', ARRAY['cowl_tag_style', 'engine_block_casting'])),
    'the id list keeps the mapped roles and drops the harvest note');
  PERFORM public.t_assert(cardinality(public.vehicle_facet_observation_ids('10000000-0000-0000-0000-000000000004',
      ARRAY['cowl_tag_style'])) = 0 AND cardinality(public.vehicle_facet_observation_ids('10000000-0000-0000-0000-000000000005',
      ARRAY['cowl_tag_style'])) = 0, 'no ids for a private or deleted vehicle');
  PERFORM public.t_assert(position('obs_ids' in pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure)) > 0
    AND (length(pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure))
      - length(replace(pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure), 'obs_ids AS MATERIALIZED', '')))
      / length('obs_ids AS MATERIALIZED') = 1, 'the reader reads observations by id, patched once');

  -- Private and deleted vehicles return nothing.
  PERFORM public.t_assert(public.vehicle_facet_items('10000000-0000-0000-0000-000000000004') IS NULL, 'private vehicle: nothing');
  PERFORM public.t_assert(public.vehicle_facet_items('10000000-0000-0000-0000-000000000004', 'location') IS NULL, 'private location: nothing');
  PERFORM public.t_assert(public.vehicle_facet_items('10000000-0000-0000-0000-000000000005') IS NULL, 'deleted vehicle: nothing');

  -- The profile reader carries the items of the eight eager tokens; location is read on click, in the same shape.
  p := public.vehicle_profile_read('10000000-0000-0000-0000-000000000001');
  PERFORM public.t_assert((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p#>'{sections,0,token_items}') k)
    = ARRAY['body_style', 'drivetrain', 'engine', 'make', 'model', 'transmission', 'trim', 'year'],
    'masthead carries every token but location');
  PERFORM public.t_assert(p#>'{sections,0,token_items}' = public.vehicle_facet_items('10000000-0000-0000-0000-000000000001') - 'location',
    'the masthead tokens are the full reader''s, item for item');
  PERFORM public.t_assert(public.vehicle_facet_items('10000000-0000-0000-0000-000000000001', 'location')
    = public.vehicle_facet_items('10000000-0000-0000-0000-000000000001')->'location',
    'the click call returns the location items the full reader returns');
  PERFORM public.t_assert(p#>'{sections,0,token_items,drivetrain}' IS NOT NULL, 'a token with no strip facet still has items');
  PERFORM public.t_assert(p#>'{sections,0,token_items,transmission}' = public.vehicle_facet_items('10000000-0000-0000-0000-000000000001', 'transmission'),
    'masthead items are the reader''s items');
  PERFORM public.t_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p#>'{sections,1,facets}') f WHERE f ? 'items'),
    'strip facets are unchanged: the masthead is the single home for items');
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

-- 2b. The profile read never calls the photo GPS fold: with the fold replaced by a trap, the profile still reads,
-- while the location click call trips it.
BEGIN;
CREATE OR REPLACE FUNCTION public.vehicle_location_areas(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $trap$
BEGIN RAISE EXCEPTION 'fold_trap: vehicle_location_areas was called'; END $trap$;
SET LOCAL ROLE anon;
SET LOCAL test.auth_role = 'anon';
SET LOCAL test.auth_uid = '';
DO $$
DECLARE p jsonb; tripped boolean := false;
BEGIN
  p := public.vehicle_profile_read('10000000-0000-0000-0000-000000000001');
  PERFORM public.t_assert(p#>'{sections,0,token_items,engine}' IS NOT NULL, 'profile read with the fold trapped: no fold call');
  BEGIN
    PERFORM public.vehicle_facet_items('10000000-0000-0000-0000-000000000001', 'location');
  EXCEPTION WHEN raise_exception THEN tripped := SQLERRM LIKE 'fold_trap%';
  END;
  PERFORM public.t_assert(tripped, 'the location click call reads the fold (the trap is live)');
END $$;
ROLLBACK;

-- 3. A photo withdrawn after the fold ran drops out at once, before the hourly writer runs.
BEGIN;
UPDATE public.vehicle_images SET is_sensitive = true WHERE id = '55555555-5555-5555-5555-000000000003';
SET LOCAL ROLE anon;
SET LOCAL test.auth_role = 'anon';
SET LOCAL test.auth_uid = '';
DO $$
DECLARE i jsonb;
BEGIN
  i := public.t_item('10000000-0000-0000-0000-000000000001', 'location', 'location.sources.photo_gps');
  PERFORM public.t_assert((i#>>'{value,areas,0,photos}')::int = 2 AND (i#>>'{value,areas,0,days}')::int = 1
    AND (i#>>'{value,areas,0,last_taken_at}')::timestamptz = '2026-10-06T18:00Z'
    AND i#>>'{value,areas,0,latest_observation_id}' = '66666666-6666-6666-6666-000000000001',
    'withdrawn photo: its day leaves the area at read time');
END $$;
ROLLBACK;
-- The documented fixture car as a logged-out viewer sees it (printed for review).
SET ROLE anon;
SET test.auth_role = 'anon';
RESET test.auth_uid;
SELECT d AS dimension, jsonb_pretty(public.vehicle_facet_items('10000000-0000-0000-0000-000000000001', d)) AS items
FROM unnest(ARRAY['year', 'engine', 'transmission', 'location']) d;
RESET ROLE;
SELECT 'vehicle facet items: PASS' AS result;
