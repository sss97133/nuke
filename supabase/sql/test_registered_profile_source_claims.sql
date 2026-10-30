-- Actual canonical cached intake and provenance owner, then the real bulk
-- record/profile reader. Canonical ranking is the isolated image branch;
-- unrelated retained-record binding normalization is a dependency boundary.
\set ON_ERROR_STOP on
\i supabase/sql/test_cached_image_source_ancestry.sql
RESET ROLE;
ALTER TABLE public.vehicles ADD COLUMN year integer,ADD COLUMN make text,ADD COLUMN model text,ADD COLUMN vin text,
 ADD COLUMN trim text,ADD COLUMN mileage integer,ADD COLUMN interior_color text,ADD COLUMN transmission text,
 ADD COLUMN drivetrain text,ADD COLUMN engine_type text,ADD COLUMN engine_size text,ADD COLUMN body_style text,
 ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.observation_properties ADD COLUMN label text,ADD COLUMN unit text,
 ADD COLUMN ratified_at timestamptz DEFAULT now();
ALTER TABLE public.vehicle_images ADD COLUMN doc_flag boolean;
ALTER TABLE public.vehicle_observations ADD COLUMN source_observation_id uuid,
 ADD COLUMN subject_type text DEFAULT 'vehicle',ADD COLUMN subject_id uuid,
 ADD COLUMN analysis_deferred boolean NOT NULL DEFAULT false;
-- Unrelated retained-listing/identifier branches are closed fixture boundaries;
-- none of these helpers qualifies an image or a claim under test.
DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['retained_description_property_matches','retained_listing_identity_matches',
  'retained_craigslist_odometer_matches','retained_craigslist_year_matches','retained_description_year_matches',
  'retained_description_identity_matches'] LOOP
  EXECUTE format('CREATE FUNCTION public.%I(public.vehicle_observations,public.vehicle_observations) RETURNS boolean LANGUAGE sql AS $fn$SELECT false$fn$',f);
 END LOOP;
END $$;
CREATE FUNCTION public.retained_powertrain_value(text,jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;
CREATE FUNCTION public.identifier_consensus(uuid,text) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
\i supabase/sql/helpers/image_provenance_reader_live_20261030.sql
CREATE VIEW public.vehicle_canonical AS WITH ranked AS(
 SELECT o.*,row_number() OVER(PARTITION BY vehicle_id,property_id,structured_data->>'image_id'
  ORDER BY confidence_score DESC,observed_at DESC,id) AS rn FROM public.vehicle_observations o
 WHERE property_id IS NOT NULL AND is_superseded IS NOT TRUE)
 SELECT vehicle_id,property_id,id AS observation_id,structured_data FROM ranked WHERE rn=1;
CREATE FUNCTION public.retained_vehicle_record_property_bindings(jsonb) RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT '[]'::jsonb$$;
\i supabase/sql/helpers/profile_record_reader_live_20261030.sql
\i supabase/migrations/20261030171525_connect_registered_profile_source_claims.sql
CREATE FUNCTION pg_temp.profile(p_cursor jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT r FROM public.get_vehicle_specs(ARRAY['11111111-1111-1111-1111-111111111111']::uuid[],true,p_cursor) r
$$;
CREATE FUNCTION pg_temp.ok(label text,passed boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF passed IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %',label; END IF; RAISE NOTICE 'PASS %',label; END $$;
SELECT pg_temp.ok('actual admitted image properties reach the profile reader with original source and image witnesses',
 (SELECT count(*)=3 AND bool_and(c->>'evidence_state'='interpreted' AND c->>'measurement_scope'='one_image_reading'
  AND c->>'mechanical_verification'='unestablished' AND c->>'image_id'='44444444-4444-4444-4444-000000000001'
  AND c->>'source_observation_id'='55555555-5555-5555-5555-000000000001')
  FROM jsonb_array_elements(pg_temp.profile()->'typed_claims')c));
SELECT pg_temp.ok('the registered property keeps an exact sourced value rather than a vehicle-level assertion',
 EXISTS(SELECT FROM jsonb_array_elements(pg_temp.profile()->'typed_claims')c
  WHERE c->>'property_key'='image_visible_rust_severity' AND c->>'value'='surface'
   AND c#>>'{qualifiers,current_configuration_status}'='unknown'));
CREATE TEMP TABLE claim_page1 AS SELECT pg_temp.profile('{"limit":2}') AS r;
CREATE TEMP TABLE claim_page2 AS SELECT pg_temp.profile(jsonb_build_object('limit',2,'after',r#>>'{claim_page,next_after}')) AS r
 FROM claim_page1;
SELECT pg_temp.ok('bounded source pages account for every claim without repeating a source',
 (SELECT (r#>>'{claim_page,has_more}')::boolean AND jsonb_array_length(r->'typed_claims')=2 FROM claim_page1)
 AND (SELECT NOT(r#>>'{claim_page,has_more}')::boolean AND jsonb_array_length(r->'typed_claims')=1 FROM claim_page2)
 AND (SELECT count(DISTINCT c->>'observation_id')=3 FROM(
  SELECT r FROM claim_page1 UNION ALL SELECT r FROM claim_page2) pages CROSS JOIN LATERAL jsonb_array_elements(r->'typed_claims')c));
BEGIN;
UPDATE public.vehicle_observations SET is_superseded=true WHERE id='55555555-5555-5555-5555-000000000001';
SELECT pg_temp.ok('withdrawn original reading removes its derived properties from the actual profile API',
 jsonb_array_length(pg_temp.profile()->'typed_claims')=0);
ROLLBACK;
UPDATE public.observation_sources SET supported_observations=ARRAY['condition','specification']::public.observation_kind[]
 WHERE slug='photo_pipeline';
INSERT INTO public.observation_properties(id,property_key,namespace,data_type,discriminator_key,applies_to_kinds,label)
 VALUES('77777777-7777-7777-7777-000000000004','image_spid_rpo_codes','core','jsonb','image_id',
 ARRAY['specification']::public.observation_kind[],'RPO codes on label');
INSERT INTO public.vehicle_observations(vehicle_id,source_id,kind,structured_data,observed_at,extraction_method,agent_model,confidence_score,property_id)
 SELECT '11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','specification',
  jsonb_build_object('image_id','44444444-4444-4444-4444-000000000001','image_spid_rpo_codes',codes,
   'model_name','fixture-reader','reading_role','spid_label_rpo_codes','vin_match_status','not_evaluated',
   'originality_status','unknown','factory_configuration_status','unknown'),now(),'fixture_rpo_reading','fixture-model',0.6,
  '77777777-7777-7777-7777-000000000004' FROM(VALUES('["L82","Z49"]'::jsonb),('["Z49","L82"]'::jsonb))r(codes);
SELECT pg_temp.ok('option codes reach the source reader as an image reading and order alone creates no dispute',
 EXISTS(SELECT FROM jsonb_array_elements(pg_temp.profile()->'typed_claims')c WHERE c->>'property_key'='image_spid_rpo_codes'
  AND jsonb_typeof(c->'value')='array' AND c->>'evidence_state'='interpreted' AND c->>'mechanical_verification'='unestablished'));
DO $$ BEGIN
 BEGIN
  INSERT INTO public.vehicle_observations(vehicle_id,source_id,kind,structured_data,observed_at,extraction_method,confidence_score,property_id)
   VALUES('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','condition',
    '{"image_id":"44444444-4444-4444-4444-000000000001","image_visible_rust_severity":"surface"}',now(),'fixture_wrong_vehicle',0.6,
    '77777777-7777-7777-7777-000000000001');
  RAISE EXCEPTION 'Expected source/vehicle refusal';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT pg_temp.ok('unrelated vehicle cannot acquire another image reading through intake or the profile reader',
 NOT EXISTS(SELECT FROM public.vehicle_observations WHERE extraction_method='fixture_wrong_vehicle')
 AND (SELECT jsonb_array_length(r->'typed_claims')=0 FROM public.get_vehicle_specs(
  ARRAY['22222222-2222-2222-2222-222222222222']::uuid[],true,'{}')r));
BEGIN;
UPDATE public.vehicle_images SET is_sensitive=true WHERE id='44444444-4444-4444-4444-000000000001';
SELECT pg_temp.ok('a privacy change cannot leave a cached image reading exposed',jsonb_array_length(pg_temp.profile()->'typed_claims')=0);
ROLLBACK;
BEGIN;
UPDATE public.vehicle_images SET is_document=true WHERE id='44444444-4444-4444-4444-000000000001';
SELECT pg_temp.ok('document flags cannot acquire a public image-witness route',jsonb_array_length(pg_temp.profile()->'typed_claims')=0);
ROLLBACK;
BEGIN;
UPDATE public.vehicles SET is_public=false WHERE id='11111111-1111-1111-1111-111111111111';
SELECT pg_temp.ok('new public source page preserves the existing private-record boundary',pg_temp.profile() IS NULL);
ROLLBACK;
SELECT pg_temp.ok('unsupported/unregistered properties are explicit unresolved routes, not manufactured evidence',
 EXISTS(SELECT FROM jsonb_array_elements(pg_temp.profile()->'unresolved_properties')p
  WHERE p->>'property_key'='engine_family_label' AND p->>'reason'='property_unregistered'));

-- A newly admitted retained-source version uses the actual canonical batch and
-- preserves its explicit scheduling hold. Existing rows are not rewritten.
DO $$ DECLARE source public.vehicle_observations; payload jsonb; receipt jsonb; BEGIN
 SELECT * INTO source FROM public.vehicle_observations WHERE id='55555555-5555-5555-5555-000000000001';
 source.id:='55555555-5555-5555-5555-000000000003';
 INSERT INTO public.vehicle_observations SELECT (source).*;
 WITH moved AS(SELECT replace(c::text,'55555555-5555-5555-5555-000000000001',source.id::text)::jsonb AS c
  FROM public.fixture_cached_claims f CROSS JOIN LATERAL jsonb_array_elements(f.claims)c
  WHERE parent_id='55555555-5555-5555-5555-000000000001'),
 hashed AS(SELECT c,encode(sha256(convert_to(c->>'source_result_json','UTF8')),'hex') AS h FROM moved)
 SELECT jsonb_agg(jsonb_set(c,'{structured_data,source_result_hash}',to_jsonb(h))||jsonb_build_object(
  'source_identifier','byok_image_properties_v1:'||source.id||':'||h||':'||(c->>'property_key'),
  'content_hash',encode(sha256(convert_to(c::text,'UTF8')),'hex'))) INTO payload FROM hashed;
 receipt:=public.ingest_cached_image_property_batch(payload);
 ASSERT receipt->>'inserted'='3' AND receipt->>'verified'='3';
 ASSERT (SELECT bool_and(analysis_deferred) FROM public.vehicle_observations
  WHERE structured_data->>'source_observation_id'=source.id::text);
END $$;
INSERT INTO public.vehicle_observations(vehicle_id,source_id,kind,structured_data,observed_at,extraction_method,agent_model,confidence_score,property_id)
 SELECT '11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','condition',
 '{"image_id":"44444444-4444-4444-4444-000000000001","image_visible_rust_severity":"pitting"}',
 now(),'fixture_second_reading','fixture-model',0.6,id FROM public.observation_properties WHERE property_key='image_visible_rust_severity';
SELECT pg_temp.ok('different admissible readings of one image remain disputed with cited alternatives',
 EXISTS(SELECT FROM jsonb_array_elements(pg_temp.profile()->'typed_claims')c
  WHERE c->>'property_key'='image_visible_rust_severity' AND c->>'evidence_state'='disputed'
   AND jsonb_array_length(c->'alternative_readings')>0 AND c->>'mechanical_verification'='unestablished'));
-- Refusal comes from the exact current provenance owner, not a manufactured zero.
BEGIN;
INSERT INTO public.vehicle_observations(vehicle_id,source_id,kind,structured_data,observed_at,extraction_method,agent_model,confidence_score,property_id)
 SELECT '11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','condition',
 '{"image_id":"44444444-4444-4444-4444-000000000001","image_visible_rust_severity":"surface"}',
 now(),'fixture_reading_'||n,'fixture-model',0.5,p.id FROM generate_series(1,1001)n
 CROSS JOIN public.observation_properties p WHERE p.property_key='image_visible_rust_severity';
SELECT pg_temp.ok('an actual provenance ceiling propagates explicit unresolved state rather than zero evidence',
 EXISTS(SELECT FROM jsonb_array_elements(pg_temp.profile()->'unresolved_properties')p
  WHERE p->>'property_key'='image_visible_rust_severity' AND p->>'reason'='source_reader_refused_input_limit')
 AND NOT EXISTS(SELECT FROM jsonb_array_elements(pg_temp.profile()->'typed_claims')c WHERE c->>'property_key'='image_visible_rust_severity'));
ROLLBACK;
