-- Standalone PG17 fixture; run only in an EMPTY disposable local database.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'This fixture requires an empty disposable local database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true),'')::uuid $$;
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, is_public boolean, user_id uuid, owner_id uuid, uploaded_by uuid,
  color text, color_source text, color_confidence numeric, color_source_image_id text
);
CREATE TABLE public.vehicle_field_provenance (
  vehicle_id uuid, field_name text, primary_source text, total_confidence numeric
);
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY, vehicle_id uuid, image_url text, is_sensitive boolean,
  is_superseded boolean, is_duplicate boolean, vision_gate_status text,
  image_vehicle_match_status text
);
CREATE TABLE public.observation_sources (id uuid, slug text, base_trust_score numeric);
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY, vehicle_id uuid, source_id uuid, structured_data jsonb,
  is_superseded boolean, content_text text, confidence_score numeric, observed_at timestamptz,
  ingested_at timestamptz, kind text, source_url text, extraction_method text,
  agent_model text, extraction_metadata jsonb
);
CREATE TABLE public.vehicle_field_sources (
  vehicle_id uuid, field_name text, field_value text, source_type text,
  confidence_score integer, is_verified boolean, ai_reasoning text,
  source_image_id uuid, created_at timestamptz
);
CREATE TABLE public.field_evidence (
  vehicle_id uuid, field_name text, proposed_value text, source_type text,
  source_confidence integer, status text, extraction_context text,
  raw_extraction_data jsonb, created_at timestamptz
);
\ir ../migrations/20261002201448_field_provenance_image_observation_citations.sql

INSERT INTO public.vehicles VALUES
 ('11111111-1111-1111-1111-111111111111', true, NULL, NULL, NULL, 'Silver Pearl', 'listing', .7, 'bad-uuid'),
 ('22222222-2222-2222-2222-222222222222', false, NULL, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, 'Black', NULL, NULL, NULL);
INSERT INTO public.observation_sources VALUES ('33333333-3333-3333-3333-333333333333', 'agent-submission', .5);
INSERT INTO public.vehicle_images
SELECT ('44444444-4444-4444-4444-'||lpad(n::text,12,'0'))::uuid,
       CASE WHEN n=3 THEN '22222222-2222-2222-2222-222222222222'::uuid ELSE '11111111-1111-1111-1111-111111111111'::uuid END,
       'https://images.example/'||n||'.jpg', n=4, n=6, n=5,
       CASE n WHEN 1 THEN 'approved' WHEN 9 THEN 'pending' WHEN 10 THEN 'review_needed'
         WHEN 11 THEN 'rejected_personal' ELSE NULL END,
       CASE n WHEN 7 THEN 'mismatch' WHEN 8 THEN 'unrelated' ELSE NULL END
FROM generate_series(1,11) n;
INSERT INTO public.vehicle_observations
SELECT ('55555555-5555-5555-5555-'||lpad(n::text,12,'0'))::uuid,
       '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333',
       jsonb_build_object('color','Silver Pearl','image_id','44444444-4444-4444-4444-'||lpad(n::text,12,'0'),
         'claim_role','corroboration','image_region',jsonb_build_object('label','bodywork'),
         'visual_relation','supports','is_inferred',true,
         'source_family','fixture-listing-event',
         'reference',jsonb_build_object('url','https://example.org/catalog.pdf','page_number',12)),
       false, 'Visible silver finish; factory paint name requires corroboration', .5,
       '2026-10-02T20:00:00Z', '2026-10-02T20:01:00Z', 'spec', 'https://images.example/'||n||'.jpg',
       'visual-review', 'fixture-model', '{"limitation":"Appearance does not establish original paint"}'
FROM generate_series(1,11) n;
-- Missing/malformed JSON IDs never raise casts or masquerade as joined photos.
INSERT INTO public.vehicle_observations (id,vehicle_id,structured_data,observed_at,ingested_at,kind)
VALUES
 ('55555555-5555-5555-5555-000000000012','11111111-1111-1111-1111-111111111111','{"color":"Silver Pearl","image_id":"invalid"}',now(),now(),'spec'),
 ('55555555-5555-5555-5555-000000000013','11111111-1111-1111-1111-111111111111','{"color":"Silver Pearl","image_id":null}',now(),now(),'spec'),
 ('55555555-5555-5555-5555-000000000014','11111111-1111-1111-1111-111111111111','{"color":"Silver Pearl","image_id":{"x":1}}',now(),now(),'spec'),
 ('55555555-5555-5555-5555-000000000015','11111111-1111-1111-1111-111111111111','{"color":"Silver Pearl"}',now(),now(),'spec'),
 ('55555555-5555-5555-5555-000000000016','11111111-1111-1111-1111-111111111111','{"transmission":"manual","image_id":"44444444-4444-4444-4444-000000000001"}',now(),now(),'spec');
INSERT INTO public.vehicle_observations (id,vehicle_id,structured_data,is_superseded)
VALUES ('55555555-5555-5555-5555-000000000017','11111111-1111-1111-1111-111111111111','{"color":"Silver Pearl","image_id":"44444444-4444-4444-4444-000000000001"}',true);
INSERT INTO public.field_evidence VALUES
 ('11111111-1111-1111-1111-111111111111','color','Silver Pearl','photo',90,'accepted','Valid cited photo','{"photo_id":"44444444-4444-4444-4444-000000000001"}',now()),
 ('11111111-1111-1111-1111-111111111111','color','Wrong','photo',99,'rejected','Rejected testimony','{"photo_id":"invalid"}',now()),
 ('11111111-1111-1111-1111-111111111111','color','Old','photo',98,'superseded','Superseded testimony','{"photo_id":"44444444-4444-4444-4444-000000000001"}',now());
INSERT INTO public.vehicle_field_sources VALUES
 ('11111111-1111-1111-1111-111111111111','color','Silver','photo',50,false,'Sensitive pointer must be masked','44444444-4444-4444-4444-000000000004',now());

DO $$ DECLARE p jsonb; BEGIN
 p := public.get_field_provenance('11111111-1111-1111-1111-111111111111','color');
 ASSERT p ?& ARRAY['field','vehicle_id','value','inline_source','inline_confidence','source_image_url','evidence','observations','image_observations'];
 ASSERT jsonb_array_length(p->'image_observations')=2, 'Only approved/null same-vehicle visible images are cited';
 ASSERT jsonb_array_length(p->'observations')=3, 'Legacy listing observation retained, blocked image citations withheld';
 ASSERT jsonb_array_length(p->'evidence')=2, 'Rejected/superseded field evidence withheld';
 ASSERT p->>'source_image_url'='https://images.example/1.jpg', 'Malformed inline UUID safely falls back to valid joined photo';
 ASSERT (p->'image_observations'->0->>'observed_at')::timestamptz='2026-10-02T20:00:00Z'::timestamptz;
 ASSERT (p->'image_observations'->0->>'ingested_at')::timestamptz='2026-10-02T20:01:00Z'::timestamptz;
 ASSERT p->'image_observations'->0->>'extraction_method'='visual-review';
 ASSERT p->'image_observations'->0->>'agent_model'='fixture-model';
 ASSERT p->'image_observations'->0->>'limitation'='Appearance does not establish original paint';
 ASSERT p->'image_observations'->0->'image_region'->>'label'='bodywork';
 ASSERT p->'image_observations'->0->'is_inferred'='true'::jsonb;
 ASSERT p->'image_observations'->0->'reference'->>'url'='https://example.org/catalog.pdf';
 ASSERT p->'image_observations'->0->'reference'->>'page_number'='12';
 ASSERT p->'image_observations'->0->>'source_family'='fixture-listing-event';
 ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p->'evidence') e
   WHERE e->>'source'='vehicle_field_sources' AND e->>'image_id' IS NOT NULL), 'Hidden image IDs never re-enter legacy evidence';
 ASSERT public.get_field_provenance('22222222-2222-2222-2222-222222222222','color') IS NULL, 'Private vehicle denied to anon';
 PERFORM set_config('test.auth_uid','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true);
 ASSERT public.get_field_provenance('22222222-2222-2222-2222-222222222222','color')->>'value'='Black', 'Owner gate preserved';
 RAISE NOTICE 'PASS: image citations, visibility, malformed IDs, legacy compatibility, clocks and owner gate';
END $$;
ROLLBACK;
