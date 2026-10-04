-- Actual PG17 contract, EMPTY disposable dm_refinement_* database only.
-- No live fixtures. Existing privacy/atomic witness/batch migrations are used,
-- and the v1 payloads below were produced by projectImageProperties (no model).
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL
 THEN RAISE EXCEPTION 'Requires empty disposable dm_refinement_* database'; END IF;
END $$;
\ir test_comment_write_receipts.sql
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid',true),'')::uuid $$;
CREATE TYPE public.observation_kind AS ENUM ('listing','sale_result','comment','bid','specification','condition','media','splice');
CREATE TYPE public.confidence_level AS ENUM ('low','medium','high');
CREATE TABLE public.vehicles (
 id uuid PRIMARY KEY,is_public boolean,user_id uuid,owner_id uuid,uploaded_by uuid,color text
);
CREATE TABLE public.vehicle_images (
 id uuid PRIMARY KEY,vehicle_id uuid,image_url text,source text,is_sensitive boolean,
 is_superseded boolean,is_duplicate boolean,is_document boolean,vision_gate_status text,
 image_vehicle_match_status text,created_at timestamptz DEFAULT '2026-10-01T00:00Z'
);
CREATE TABLE public.observation_sources (
 id uuid PRIMARY KEY,slug text,base_trust_score numeric,supported_observations public.observation_kind[]
);
CREATE TABLE public.observation_properties (
 id uuid PRIMARY KEY,property_key text,namespace text,data_type text,discriminator_key text,
 applies_to_kinds public.observation_kind[],allowed_values jsonb,deprecated_at timestamptz
);
CREATE TABLE public.vehicle_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,source_id uuid,kind public.observation_kind,
 structured_data jsonb,is_superseded boolean DEFAULT false,observed_at timestamptz,
 ingested_at timestamptz DEFAULT '2026-10-04T06:00Z',content_text text,source_url text,
 extraction_method text,agent_model text,agent_tier text,agent_cost_cents numeric,
 raw_source_ref text,source_identifier text,confidence public.confidence_level,
 confidence_score numeric,confidence_factors jsonb,content_hash text,property_id uuid,
 vehicle_match_confidence numeric,extraction_metadata jsonb,submitted_by_user_id uuid,
 CONSTRAINT unique_observation UNIQUE(source_id,kind,source_identifier,content_hash)
);
CREATE INDEX idx_vobs_image_id_analysis ON public.vehicle_observations
 ((structured_data->>'image_id'),(structured_data->>'analysis_kind'));
CREATE INDEX idx_vobs_vehicle_ingest ON public.vehicle_observations(vehicle_id,ingested_at DESC,id DESC);
ALTER TABLE public.vehicle_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY vo_authenticated_read ON public.vehicle_observations FOR SELECT USING(false);
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.observation_witnesses(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),observation_id uuid REFERENCES public.vehicle_observations(id),
 image_id uuid,witness_role text,capture_method text,image_timestamp timestamptz,attestation_notes text,
 added_by_user_id uuid REFERENCES auth.users(id),added_by_agent_key text,added_at timestamptz DEFAULT now(),
 UNIQUE(observation_id,image_id,witness_role)
);
CREATE TABLE public.pipeline_registry(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 table_name text,column_name text,owned_by text,description text,do_not_write_directly boolean,write_via text,
 UNIQUE(table_name,column_name));
CREATE TABLE public.vehicle_field_provenance(vehicle_id uuid,field_name text,primary_source text,total_confidence numeric);
CREATE TABLE public.vehicle_field_sources(vehicle_id uuid,field_name text,field_value text,source_type text,
 confidence_score integer,is_verified boolean,ai_reasoning text,source_image_id uuid,created_at timestamptz);
CREATE TABLE public.field_evidence(vehicle_id uuid,field_name text,proposed_value text,source_type text,
 source_confidence integer,status text,extraction_context text,raw_extraction_data jsonb,created_at timestamptz);
\ir ../migrations/20260928233000_observation_privacy_marking.sql
\ir ../migrations/20261002213353_enforce_atomic_image_witnesses.sql
\ir ../migrations/20261003023500_bulk_cached_image_projection.sql
-- Match the already-existing public reader grants; the repair adds none.
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_field_provenance(uuid,text) TO anon,authenticated,service_role;
\ir ../migrations/20261004064216_cached_image_source_ancestry.sql
\ir ../migrations/20261004052152_observe_image_observation_writes.sql
SET request.headers='{"x-nuke-writer":"ingest-observation-batch"}';
INSERT INTO public.vehicles(id,is_public,color) VALUES
 ('11111111-1111-1111-1111-111111111111',true,'fixture'),
 ('22222222-2222-2222-2222-222222222222',true,'other');
INSERT INTO public.vehicles(id,is_public,owner_id,color) VALUES
 ('99999999-9999-9999-9999-999999999999',false,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','private');
INSERT INTO public.observation_sources VALUES
 ('33333333-3333-3333-3333-333333333333','photo_pipeline',.5,ARRAY['condition']::public.observation_kind[]);
INSERT INTO public.observation_properties(id,property_key,namespace,data_type,discriminator_key,applies_to_kinds,allowed_values)
SELECT ('77777777-7777-7777-7777-'||lpad(n::text,12,'0'))::uuid,k,'core','enum','image_id',
 ARRAY['condition']::public.observation_kind[], vals::jsonb
FROM (VALUES(1,'image_visible_rust_severity','["none","surface","pitting","perforation"]'),
 (2,'image_visible_paint_stage','["bare_metal","primer","sealer","base","clear","aged"]'),
 (3,'image_visible_assembly_state','["stripped","partial","assembled"]')) x(n,k,vals);
CREATE TABLE public.fixture_cached_claims(parent_id uuid PRIMARY KEY,claims jsonb);
INSERT INTO public.vehicle_images(id,vehicle_id,image_url,source,vision_gate_status) VALUES('44444444-4444-4444-4444-000000000001','11111111-1111-1111-1111-111111111111','https://bringatrailer.com/wp-content/uploads/fixture.jpg','bat_import','approved');
INSERT INTO public.vehicle_observations(id,vehicle_id,source_id,kind,structured_data,observed_at,ingested_at,agent_model,extraction_method,confidence,confidence_score) VALUES('55555555-5555-5555-5555-000000000001','11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','condition','{"image_id": "44444444-4444-4444-4444-000000000001", "analysis_kind": "image_deep_byok", "state_observations": {"rust_severity": "surface", "paint_state": "aged", "completeness": "assembled"}}'::jsonb,'2026-02-04T18:25:14.303383+00:00','2026-06-16T19:57:10.002+00:00','fixture-declared-model','fixture-recorded-reading','medium',.82);
-- Hash the native payload at fixture runtime; fingerprints are not credentials.
INSERT INTO public.fixture_cached_claims
SELECT '55555555-5555-5555-5555-000000000001',jsonb_agg(jsonb_set(c,'{structured_data,source_result_hash}',to_jsonb(h.hash))
 ||jsonb_build_object('content_hash',encode(sha256(convert_to(c::text,'UTF8')),'hex'),
   'source_identifier','byok_image_properties_v1:'||'55555555-5555-5555-5555-000000000001'||':'||h.hash||':'||(c->>'property_key')))
FROM jsonb_array_elements('[
  {
    "source_slug": "photo_pipeline",
    "kind": "condition",
    "vehicle_id": "11111111-1111-1111-1111-111111111111",
    "property_key": "image_visible_rust_severity",
    "agent_inferred": true,
    "defer_analysis": true,
    "observed_at": "2026-06-16T19:57:10.002+00:00",
    "source_result_json": "{\"observation_id\":\"55555555-5555-5555-5555-000000000001\",\"image_id\":\"44444444-4444-4444-4444-000000000001\",\"vehicle_id\":\"11111111-1111-1111-1111-111111111111\",\"model\":\"fixture-declared-model\",\"method\":\"fixture-recorded-reading\",\"recorded_at\":\"2026-06-16T19:57:10.002+00:00\",\"state_observations\":{\"rust_severity\":\"surface\",\"paint_state\":\"aged\",\"completeness\":\"assembled\"}}",
    "raw_source_ref": "vehicle_observations:55555555-5555-5555-5555-000000000001",
    "agent_model": "fixture-declared-model",
    "extraction_method": "cached_byok_property_projection_v1",
    "agent_cost_cents": 0,
    "structured_data": {
      "image_visible_rust_severity": "surface",
      "image_id": "44444444-4444-4444-4444-000000000001",
      "property_key": "image_visible_rust_severity",
      "analysis_kind": "image_property_projection",
      "projection_version": "byok_image_properties_v1",
      "source_observation_id": "55555555-5555-5555-5555-000000000001",
      "source_extraction_method": "fixture-recorded-reading",
      "source_model_confidence": 0.82,
      "source_recorded_at": "2026-06-16T19:57:10.002+00:00",
      "source_observed_at": "2026-02-04T18:25:14.303383+00:00",
      "observed_at_basis": "source_testimony_recorded_at",
      "capture_at": null,
      "analyzed_at": null,
      "claim_role": "inferred",
      "source_family": "image:44444444-4444-4444-4444-000000000001",
      "limitation": "Projection of an existing model reading of one image. Capture and analysis clocks are unverified. Not whole-vehicle condition or independent corroboration."
    }
  },
  {
    "source_slug": "photo_pipeline",
    "kind": "condition",
    "vehicle_id": "11111111-1111-1111-1111-111111111111",
    "property_key": "image_visible_paint_stage",
    "agent_inferred": true,
    "defer_analysis": true,
    "observed_at": "2026-06-16T19:57:10.002+00:00",
    "source_result_json": "{\"observation_id\":\"55555555-5555-5555-5555-000000000001\",\"image_id\":\"44444444-4444-4444-4444-000000000001\",\"vehicle_id\":\"11111111-1111-1111-1111-111111111111\",\"model\":\"fixture-declared-model\",\"method\":\"fixture-recorded-reading\",\"recorded_at\":\"2026-06-16T19:57:10.002+00:00\",\"state_observations\":{\"rust_severity\":\"surface\",\"paint_state\":\"aged\",\"completeness\":\"assembled\"}}",
    "raw_source_ref": "vehicle_observations:55555555-5555-5555-5555-000000000001",
    "agent_model": "fixture-declared-model",
    "extraction_method": "cached_byok_property_projection_v1",
    "agent_cost_cents": 0,
    "structured_data": {
      "image_visible_paint_stage": "aged",
      "image_id": "44444444-4444-4444-4444-000000000001",
      "property_key": "image_visible_paint_stage",
      "analysis_kind": "image_property_projection",
      "projection_version": "byok_image_properties_v1",
      "source_observation_id": "55555555-5555-5555-5555-000000000001",
      "source_extraction_method": "fixture-recorded-reading",
      "source_model_confidence": 0.82,
      "source_recorded_at": "2026-06-16T19:57:10.002+00:00",
      "source_observed_at": "2026-02-04T18:25:14.303383+00:00",
      "observed_at_basis": "source_testimony_recorded_at",
      "capture_at": null,
      "analyzed_at": null,
      "claim_role": "inferred",
      "source_family": "image:44444444-4444-4444-4444-000000000001",
      "limitation": "Projection of an existing model reading of one image. Capture and analysis clocks are unverified. Not whole-vehicle condition or independent corroboration."
    }
  },
  {
    "source_slug": "photo_pipeline",
    "kind": "condition",
    "vehicle_id": "11111111-1111-1111-1111-111111111111",
    "property_key": "image_visible_assembly_state",
    "agent_inferred": true,
    "defer_analysis": true,
    "observed_at": "2026-06-16T19:57:10.002+00:00",
    "source_result_json": "{\"observation_id\":\"55555555-5555-5555-5555-000000000001\",\"image_id\":\"44444444-4444-4444-4444-000000000001\",\"vehicle_id\":\"11111111-1111-1111-1111-111111111111\",\"model\":\"fixture-declared-model\",\"method\":\"fixture-recorded-reading\",\"recorded_at\":\"2026-06-16T19:57:10.002+00:00\",\"state_observations\":{\"rust_severity\":\"surface\",\"paint_state\":\"aged\",\"completeness\":\"assembled\"}}",
    "raw_source_ref": "vehicle_observations:55555555-5555-5555-5555-000000000001",
    "agent_model": "fixture-declared-model",
    "extraction_method": "cached_byok_property_projection_v1",
    "agent_cost_cents": 0,
    "structured_data": {
      "image_visible_assembly_state": "assembled",
      "image_id": "44444444-4444-4444-4444-000000000001",
      "property_key": "image_visible_assembly_state",
      "analysis_kind": "image_property_projection",
      "projection_version": "byok_image_properties_v1",
      "source_observation_id": "55555555-5555-5555-5555-000000000001",
      "source_extraction_method": "fixture-recorded-reading",
      "source_model_confidence": 0.82,
      "source_recorded_at": "2026-06-16T19:57:10.002+00:00",
      "source_observed_at": "2026-02-04T18:25:14.303383+00:00",
      "observed_at_basis": "source_testimony_recorded_at",
      "capture_at": null,
      "analyzed_at": null,
      "claim_role": "inferred",
      "source_family": "image:44444444-4444-4444-4444-000000000001",
      "limitation": "Projection of an existing model reading of one image. Capture and analysis clocks are unverified. Not whole-vehicle condition or independent corroboration."
    }
  }
]'::jsonb) c
CROSS JOIN LATERAL(SELECT encode(sha256(convert_to(c->>'source_result_json','UTF8')),'hex') hash) h;
INSERT INTO public.vehicle_images(id,vehicle_id,image_url,source,vision_gate_status) VALUES('44444444-4444-4444-4444-000000000002','11111111-1111-1111-1111-111111111111','https://bringatrailer.com/wp-content/uploads/fixture.jpg','bat_import','approved');
INSERT INTO public.vehicle_observations(id,vehicle_id,source_id,kind,structured_data,observed_at,ingested_at,agent_model,extraction_method,confidence,confidence_score) VALUES('55555555-5555-5555-5555-000000000002','11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','condition','{"image_id": "44444444-4444-4444-4444-000000000002", "analysis_kind": "image_deep_byok", "state_observations": {"rust_severity": "surface", "paint_state": "aged", "completeness": "assembled"}}'::jsonb,'2026-02-04T18:25:14.303383+00:00','2026-06-16T19:57:10.002+00:00','fixture-declared-model','fixture-recorded-reading','medium',.82);
-- Hash the native payload at fixture runtime; fingerprints are not credentials.
INSERT INTO public.fixture_cached_claims
SELECT '55555555-5555-5555-5555-000000000002',jsonb_agg(jsonb_set(c,'{structured_data,source_result_hash}',to_jsonb(h.hash))
 ||jsonb_build_object('content_hash',encode(sha256(convert_to(c::text,'UTF8')),'hex'),
   'source_identifier','byok_image_properties_v1:'||'55555555-5555-5555-5555-000000000002'||':'||h.hash||':'||(c->>'property_key')))
FROM jsonb_array_elements('[
  {
    "source_slug": "photo_pipeline",
    "kind": "condition",
    "vehicle_id": "11111111-1111-1111-1111-111111111111",
    "property_key": "image_visible_rust_severity",
    "agent_inferred": true,
    "defer_analysis": true,
    "observed_at": "2026-06-16T19:57:10.002+00:00",
    "source_result_json": "{\"observation_id\":\"55555555-5555-5555-5555-000000000002\",\"image_id\":\"44444444-4444-4444-4444-000000000002\",\"vehicle_id\":\"11111111-1111-1111-1111-111111111111\",\"model\":\"fixture-declared-model\",\"method\":\"fixture-recorded-reading\",\"recorded_at\":\"2026-06-16T19:57:10.002+00:00\",\"state_observations\":{\"rust_severity\":\"surface\",\"paint_state\":\"aged\",\"completeness\":\"assembled\"}}",
    "raw_source_ref": "vehicle_observations:55555555-5555-5555-5555-000000000002",
    "agent_model": "fixture-declared-model",
    "extraction_method": "cached_byok_property_projection_v1",
    "agent_cost_cents": 0,
    "structured_data": {
      "image_visible_rust_severity": "surface",
      "image_id": "44444444-4444-4444-4444-000000000002",
      "property_key": "image_visible_rust_severity",
      "analysis_kind": "image_property_projection",
      "projection_version": "byok_image_properties_v1",
      "source_observation_id": "55555555-5555-5555-5555-000000000002",
      "source_extraction_method": "fixture-recorded-reading",
      "source_model_confidence": 0.82,
      "source_recorded_at": "2026-06-16T19:57:10.002+00:00",
      "source_observed_at": "2026-02-04T18:25:14.303383+00:00",
      "observed_at_basis": "source_testimony_recorded_at",
      "capture_at": null,
      "analyzed_at": null,
      "claim_role": "inferred",
      "source_family": "image:44444444-4444-4444-4444-000000000002",
      "limitation": "Projection of an existing model reading of one image. Capture and analysis clocks are unverified. Not whole-vehicle condition or independent corroboration."
    }
  },
  {
    "source_slug": "photo_pipeline",
    "kind": "condition",
    "vehicle_id": "11111111-1111-1111-1111-111111111111",
    "property_key": "image_visible_paint_stage",
    "agent_inferred": true,
    "defer_analysis": true,
    "observed_at": "2026-06-16T19:57:10.002+00:00",
    "source_result_json": "{\"observation_id\":\"55555555-5555-5555-5555-000000000002\",\"image_id\":\"44444444-4444-4444-4444-000000000002\",\"vehicle_id\":\"11111111-1111-1111-1111-111111111111\",\"model\":\"fixture-declared-model\",\"method\":\"fixture-recorded-reading\",\"recorded_at\":\"2026-06-16T19:57:10.002+00:00\",\"state_observations\":{\"rust_severity\":\"surface\",\"paint_state\":\"aged\",\"completeness\":\"assembled\"}}",
    "raw_source_ref": "vehicle_observations:55555555-5555-5555-5555-000000000002",
    "agent_model": "fixture-declared-model",
    "extraction_method": "cached_byok_property_projection_v1",
    "agent_cost_cents": 0,
    "structured_data": {
      "image_visible_paint_stage": "aged",
      "image_id": "44444444-4444-4444-4444-000000000002",
      "property_key": "image_visible_paint_stage",
      "analysis_kind": "image_property_projection",
      "projection_version": "byok_image_properties_v1",
      "source_observation_id": "55555555-5555-5555-5555-000000000002",
      "source_extraction_method": "fixture-recorded-reading",
      "source_model_confidence": 0.82,
      "source_recorded_at": "2026-06-16T19:57:10.002+00:00",
      "source_observed_at": "2026-02-04T18:25:14.303383+00:00",
      "observed_at_basis": "source_testimony_recorded_at",
      "capture_at": null,
      "analyzed_at": null,
      "claim_role": "inferred",
      "source_family": "image:44444444-4444-4444-4444-000000000002",
      "limitation": "Projection of an existing model reading of one image. Capture and analysis clocks are unverified. Not whole-vehicle condition or independent corroboration."
    }
  },
  {
    "source_slug": "photo_pipeline",
    "kind": "condition",
    "vehicle_id": "11111111-1111-1111-1111-111111111111",
    "property_key": "image_visible_assembly_state",
    "agent_inferred": true,
    "defer_analysis": true,
    "observed_at": "2026-06-16T19:57:10.002+00:00",
    "source_result_json": "{\"observation_id\":\"55555555-5555-5555-5555-000000000002\",\"image_id\":\"44444444-4444-4444-4444-000000000002\",\"vehicle_id\":\"11111111-1111-1111-1111-111111111111\",\"model\":\"fixture-declared-model\",\"method\":\"fixture-recorded-reading\",\"recorded_at\":\"2026-06-16T19:57:10.002+00:00\",\"state_observations\":{\"rust_severity\":\"surface\",\"paint_state\":\"aged\",\"completeness\":\"assembled\"}}",
    "raw_source_ref": "vehicle_observations:55555555-5555-5555-5555-000000000002",
    "agent_model": "fixture-declared-model",
    "extraction_method": "cached_byok_property_projection_v1",
    "agent_cost_cents": 0,
    "structured_data": {
      "image_visible_assembly_state": "assembled",
      "image_id": "44444444-4444-4444-4444-000000000002",
      "property_key": "image_visible_assembly_state",
      "analysis_kind": "image_property_projection",
      "projection_version": "byok_image_properties_v1",
      "source_observation_id": "55555555-5555-5555-5555-000000000002",
      "source_extraction_method": "fixture-recorded-reading",
      "source_model_confidence": 0.82,
      "source_recorded_at": "2026-06-16T19:57:10.002+00:00",
      "source_observed_at": "2026-02-04T18:25:14.303383+00:00",
      "observed_at_basis": "source_testimony_recorded_at",
      "capture_at": null,
      "analyzed_at": null,
      "claim_role": "inferred",
      "source_family": "image:44444444-4444-4444-4444-000000000002",
      "limitation": "Projection of an existing model reading of one image. Capture and analysis clocks are unverified. Not whole-vehicle condition or independent corroboration."
    }
  }
]'::jsonb) c
CROSS JOIN LATERAL(SELECT encode(sha256(convert_to(c->>'source_result_json','UTF8')),'hex') hash) h;
SET ROLE service_role;
DO $$ BEGIN
 ASSERT has_function_privilege('service_role','public.ingest_cached_image_property_batch(jsonb)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.ingest_cached_image_property_batch(jsonb)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.get_cached_image_projection_parents(uuid,uuid[],timestamptz)','EXECUTE');
END $$;
RESET ROLE;
-- Execute the actual canonical batch as service, using only its intended payload.
GRANT SELECT ON public.fixture_cached_claims TO service_role;
SET ROLE service_role;
DO $$ DECLARE r jsonb; BEGIN
 SELECT public.ingest_cached_image_property_batch(jsonb_agg(c)) INTO r
 FROM public.fixture_cached_claims f CROSS JOIN LATERAL jsonb_array_elements(f.claims) c;
 ASSERT r->>'inserted'='6' AND r->>'verified'='6';
 SELECT public.ingest_cached_image_property_batch(jsonb_agg(c)) INTO r
 FROM public.fixture_cached_claims f CROSS JOIN LATERAL jsonb_array_elements(f.claims) c;
 ASSERT r->>'inserted'='0' AND r->>'duplicates'='6' AND r->>'verified'='6', 'Replay must reuse original claims/witnesses';
END $$;
RESET ROLE;
-- Model the real measured gap: a child admitted previously must stop exposing
-- itself as soon as its original becomes restricted, without rewriting either.
UPDATE public.vehicle_observations SET structured_data=structured_data||'{"receipt_id":"fixture-restricted"}'
WHERE id='55555555-5555-5555-5555-000000000002';
SET ROLE anon;
DO $$ DECLARE p jsonb; x jsonb; BEGIN
 p:=public.get_field_provenance('11111111-1111-1111-1111-111111111111','image_visible_rust_severity');
 ASSERT jsonb_array_length(p->'image_observations')=1 AND jsonb_array_length(p->'observations')=1;
 x:=p->'image_observations'->0;
 ASSERT x->>'source_observation_id'='55555555-5555-5555-5555-000000000001';
 ASSERT x->>'observed_at_basis'='source_testimony_recorded_at';
 ASSERT (x->>'observed_at')::timestamptz=(x->>'source_recorded_at')::timestamptz;
 ASSERT (x->>'source_observed_at')::timestamptz='2026-02-04T18:25:14.303383Z'::timestamptz;
 ASSERT x->'capture_at'='null'::jsonb AND x->'analyzed_at'='null'::jsonb;
 ASSERT public.get_field_provenance('99999999-9999-9999-9999-999999999999','color') IS NULL;
 BEGIN
  PERFORM public.get_cached_image_projection_parents('11111111-1111-1111-1111-111111111111',
   ARRAY['44444444-4444-4444-4444-000000000001']::uuid[],'2026-10-04T06:00Z');
  RAISE EXCEPTION 'Anon selector must be denied';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE authenticated;
SET test.auth_uid='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
DO $$ BEGIN
 ASSERT public.get_field_provenance('99999999-9999-9999-9999-999999999999','color')->>'value'='private';
 ASSERT jsonb_array_length(public.get_field_provenance('11111111-1111-1111-1111-111111111111',
   'image_visible_rust_severity')->'image_observations')=1;
END $$;
RESET ROLE;
RESET test.auth_uid;
BEGIN;
DO $$ DECLARE before_rows bigint; p jsonb; r jsonb; BEGIN
 SELECT count(*) INTO before_rows FROM public.vehicle_observations;
 -- Atomic rejection includes a valid existing claim and an invalid parent.
 BEGIN
  SELECT public.ingest_cached_image_property_batch(jsonb_agg(c)) INTO r
  FROM public.fixture_cached_claims f CROSS JOIN LATERAL jsonb_array_elements(f.claims) c;
  RAISE EXCEPTION 'Restricted original must reject whole batch';
 EXCEPTION WHEN check_violation THEN NULL; END;
 ASSERT (SELECT count(*) FROM public.vehicle_observations)=before_rows;
 ASSERT (SELECT count(*) FROM public.observation_witnesses)=8;
 p:=public.get_cached_image_projection_parents('11111111-1111-1111-1111-111111111111',
  ARRAY['44444444-4444-4444-4444-000000000001','44444444-4444-4444-4444-000000000002']::uuid[],'2026-10-04T06:00Z');
 ASSERT p->'parents'->0->'parent'->'source_is_public'='true'::jsonb;
 ASSERT p->'parents'->1->'parent'->'source_is_public'='false'::jsonb;
 ASSERT NOT (p->'parents'->1->'parent'->'structured_data' ? 'receipt_id'), 'Do not expose full restricted original';
 -- Supersession, wrong kind, relink, malformed source and altered retained clocks
 -- all close BOTH observations and image_observations without a cast failure.
 UPDATE public.vehicle_observations SET is_superseded=true WHERE id='55555555-5555-5555-5555-000000000001';
 ASSERT jsonb_array_length(public.get_field_provenance('11111111-1111-1111-1111-111111111111','image_visible_rust_severity')->'image_observations')=0;
 BEGIN
  PERFORM public.ingest_cached_image_property_batch(claims) FROM public.fixture_cached_claims WHERE parent_id='55555555-5555-5555-5555-000000000001';
  RAISE EXCEPTION 'Superseded source must reject even a duplicate replay';
 EXCEPTION WHEN check_violation THEN NULL; END;
 UPDATE public.vehicle_observations SET is_superseded=false,kind='media' WHERE id='55555555-5555-5555-5555-000000000001';
 ASSERT jsonb_array_length(public.get_field_provenance('11111111-1111-1111-1111-111111111111','image_visible_rust_severity')->'observations')=0;
 UPDATE public.vehicle_observations SET kind='condition',vehicle_id='22222222-2222-2222-2222-222222222222' WHERE id='55555555-5555-5555-5555-000000000001';
 ASSERT jsonb_array_length(public.get_field_provenance('11111111-1111-1111-1111-111111111111','image_visible_rust_severity')->'image_observations')=0;
 BEGIN
  PERFORM public.ingest_cached_image_property_batch(claims) FROM public.fixture_cached_claims WHERE parent_id='55555555-5555-5555-5555-000000000001';
  RAISE EXCEPTION 'Relinked source must reject';
 EXCEPTION WHEN check_violation THEN NULL; END;
 UPDATE public.vehicle_observations SET vehicle_id='11111111-1111-1111-1111-111111111111' WHERE id='55555555-5555-5555-5555-000000000001';
 UPDATE public.vehicle_observations SET structured_data=jsonb_set(structured_data,'{image_id}','"44444444-4444-4444-4444-000000000002"') WHERE id='55555555-5555-5555-5555-000000000001';
 ASSERT jsonb_array_length(public.get_field_provenance('11111111-1111-1111-1111-111111111111','image_visible_rust_severity')->'image_observations')=0;
 UPDATE public.vehicle_observations SET structured_data=jsonb_set(structured_data,'{image_id}','"44444444-4444-4444-4444-000000000001"') WHERE id='55555555-5555-5555-5555-000000000001';
 UPDATE public.vehicle_observations SET structured_data=jsonb_set(structured_data,'{source_recorded_at}','"2026-06-16T19:57:10.002001Z"') WHERE extraction_method='cached_byok_property_projection_v1' AND structured_data->>'source_observation_id'='55555555-5555-5555-5555-000000000001';
 ASSERT jsonb_array_length(public.get_field_provenance('11111111-1111-1111-1111-111111111111','image_visible_rust_severity')->'image_observations')=0, 'Sub-ms clock drift must not relabel source clock';
 UPDATE public.vehicle_observations SET structured_data=jsonb_set(structured_data,'{source_recorded_at}','"not-a-time"') WHERE extraction_method='cached_byok_property_projection_v1';
 ASSERT jsonb_array_length(public.get_field_provenance('11111111-1111-1111-1111-111111111111','image_visible_rust_severity')->'image_observations')=0, 'Malformed clocks refuse without reader crash';
 UPDATE public.vehicle_observations SET structured_data=jsonb_set(structured_data,'{source_observation_id}','"bad-uuid"') WHERE extraction_method='cached_byok_property_projection_v1';
 ASSERT jsonb_array_length(public.get_field_provenance('11111111-1111-1111-1111-111111111111','image_visible_rust_severity')->'observations')=0;
END $$;
ROLLBACK;
-- Late-arriving newest original is returned at its ingestion cutoff, even when
-- restricted; no older favorable result is silently substituted. Original
-- observed_at precedes both ingestions and is never labeled capture time.
BEGIN;
INSERT INTO public.vehicle_observations(id,vehicle_id,kind,structured_data,observed_at,ingested_at,agent_model,extraction_method,confidence,confidence_score)
SELECT '55555555-5555-5555-5555-000000000003',vehicle_id,kind,
 structured_data||'{"receipt_id":"late-restricted"}',observed_at,'2026-10-05T00:00Z',agent_model,extraction_method,confidence,confidence_score
FROM public.vehicle_observations WHERE id='55555555-5555-5555-5555-000000000001';
DO $$ DECLARE p jsonb; BEGIN
 p:=public.get_cached_image_projection_parents('11111111-1111-1111-1111-111111111111',ARRAY['44444444-4444-4444-4444-000000000001']::uuid[],'2026-10-04T23:59Z');
 ASSERT p->'parents'->0->'parent'->>'id'='55555555-5555-5555-5555-000000000001';
 p:=public.get_cached_image_projection_parents('11111111-1111-1111-1111-111111111111',ARRAY['44444444-4444-4444-4444-000000000001']::uuid[],'2026-10-05T00:00Z');
 ASSERT p->'parents'->0->'parent'->>'id'='55555555-5555-5555-5555-000000000003';
 ASSERT p->'parents'->0->'parent'->'source_is_public'='false'::jsonb;
END $$;
ROLLBACK;
-- Preserve unrelated legacy reader paths, including unknown model/capture.
BEGIN;
INSERT INTO public.vehicle_observations(vehicle_id,kind,structured_data,extraction_method)
VALUES('11111111-1111-1111-1111-111111111111','specification','{"color":"silver","image_id":"44444444-4444-4444-4444-000000000001"}','fixture-unrelated-review');
DO $$ DECLARE p jsonb; BEGIN
 p:=public.get_field_provenance('11111111-1111-1111-1111-111111111111','color');
 ASSERT jsonb_array_length(p->'image_observations')=1;
 ASSERT p->'image_observations'->0->'agent_model'='null'::jsonb;
END $$;
ROLLBACK;
SELECT 'PASS: actual canonical admission/replay, source privacy/supersession/relink, safe clocks/IDs, late cached cutoff, anon/auth/service and legacy reader' AS result;
