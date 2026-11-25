-- Contract for 20261124193100_fact_doubt_reread_landing (empty disposable PG17; dependencies stubbed, every fixture
-- synthetic). Asserts: fact_doubt_readings_to_land returns answered value doubts of form property, one row each, with the
-- first answer image that is a current photo of that vehicle as the witness; it skips other outcomes, other statuses, a
-- reader pair, a blank value, an unnamed model and an answer with no usable photo; a request is landed by its request id,
-- and a re-ask that read the same value with the same model is landed too, while another model's read is not;
-- a class-scope property is neither landed nor raised; fact_doubt_evidence_state ignores the loop's own landed rows and still changes on any other keyed reading; only the
-- service role can list what to land.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.vehicles (id uuid PRIMARY KEY);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, vehicle_id uuid, taken_at timestamptz, is_superseded boolean DEFAULT false,
  is_duplicate boolean DEFAULT false);
CREATE TABLE public.observation_properties (id uuid PRIMARY KEY, property_key text, verification_scope text DEFAULT 'instance');
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, property_id uuid,
  extraction_method text, agent_model text, structured_data jsonb, is_superseded boolean DEFAULT false);
CREATE TABLE public.evidence_judgment_requests (id uuid PRIMARY KEY, vehicle_id uuid, question_kind text, status text,
  subject_table text, subject_id uuid, params jsonb, answer jsonb, answer_model text, answered_at timestamptz,
  -- as 20261124193300 makes them
  property_id uuid GENERATED ALWAYS AS (CASE WHEN subject_table = 'observation_properties' THEN subject_id END) STORED,
  answer_observation_id uuid);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;

INSERT INTO public.vehicles VALUES ('10000000-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000002');
INSERT INTO public.observation_properties VALUES
 ('40000000-0000-0000-0000-000000000001', 'transmission_case_casting'),
 ('40000000-0000-0000-0000-000000000002', 'engine_block_casting');
INSERT INTO public.observation_properties VALUES ('40000000-0000-0000-0000-000000000003', 'engine_configuration', 'class');
INSERT INTO public.vehicle_images (id, vehicle_id, taken_at, is_superseded) VALUES
 ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '2026-10-28T17:00Z', true),
 ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '2026-10-28T17:05Z', false),
 ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '2026-10-28T17:06Z', false),
 ('50000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '2026-10-28T17:07Z', false);
-- A stored reading of the case casting, by another method.
INSERT INTO public.vehicle_observations (vehicle_id, property_id, extraction_method, agent_model, structured_data) VALUES
 ('10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'trans_id_stamp_decode_v1', 'model-a',
  '{"transmission_case_casting":"3851325","image_id":"50000000-0000-0000-0000-000000000004"}');

INSERT INTO public.evidence_judgment_requests (id, vehicle_id, question_kind, status, subject_table, subject_id, params, answer, answer_model, answered_at)
SELECT x.id::uuid, x.vid::uuid, 'fact_doubt', x.status, 'observation_properties', x.prop::uuid,
       jsonb_build_object('doubt_form', x.form, 'property_key', x.pk), x.answer::jsonb, x.model, x.at::timestamptz
FROM (VALUES
  -- r1: lands; the superseded first image and the other car's image are passed over for the second
  ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'answered', 'property', 'transmission_case_casting', '40000000-0000-0000-0000-000000000001',
   '{"outcome":"value","value":" 3851325 ","confidence":0.8,"quote":"SECRETQUOTE","image_ids":["50000000-0000-0000-0000-000000000001","50000000-0000-0000-0000-000000000003","50000000-0000-0000-0000-000000000002"]}', 'model-b', '2026-11-22T05:10Z'),
  -- r2: block casting, lands
  ('a0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'answered', 'property', 'engine_block_casting', '40000000-0000-0000-0000-000000000002',
   '{"outcome":"value","value":"9799140","confidence":0.7,"image_ids":["50000000-0000-0000-0000-000000000004"]}', 'model-b', '2026-11-22T05:11Z'),
  -- not landable: cannot_tell, withdrawn, reader pair, blank value, no model, only another car's photo
  ('a0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'answered', 'property', 'engine_block_casting', '40000000-0000-0000-0000-000000000002',
   '{"outcome":"cannot_tell","image_ids":["50000000-0000-0000-0000-000000000002"]}', 'model-b', '2026-11-22T05:12Z'),
  ('a0000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'withdrawn', 'property', 'engine_block_casting', '40000000-0000-0000-0000-000000000002',
   '{"outcome":"value","value":"9799140","image_ids":["50000000-0000-0000-0000-000000000002"]}', 'model-c', '2026-11-20T05:12Z'),
  ('a0000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'answered', 'reader_pair', 'engine_block_casting', '40000000-0000-0000-0000-000000000002',
   '{"outcome":"value","value":"9799140","image_ids":["50000000-0000-0000-0000-000000000002"]}', 'model-c', '2026-11-22T05:13Z'),
  ('a0000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'answered', 'property', 'engine_block_casting', '40000000-0000-0000-0000-000000000002',
   '{"outcome":"value","value":"  ","image_ids":["50000000-0000-0000-0000-000000000002"]}', 'model-c', '2026-11-22T05:14Z'),
  ('a0000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 'answered', 'property', 'engine_block_casting', '40000000-0000-0000-0000-000000000002',
   '{"outcome":"value","value":"9799140","image_ids":["50000000-0000-0000-0000-000000000002"]}', NULL, '2026-11-22T05:15Z'),
  ('a0000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', 'answered', 'property', 'engine_block_casting', '40000000-0000-0000-0000-000000000002',
   '{"outcome":"value","value":"9799140","image_ids":["50000000-0000-0000-0000-000000000003"]}', 'model-c', '2026-11-22T05:16Z'),
  -- raised before the scope rule: a class-scope property is not landed
  ('a0000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', 'answered', 'property', 'engine_configuration', '40000000-0000-0000-0000-000000000003',
   '{"outcome":"value","value":"400","image_ids":["50000000-0000-0000-0000-000000000002"]}', 'model-c', '2026-11-22T05:17Z')
) x(id, vid, status, form, pk, prop, answer, model, at);

\ir ../migrations/20261124193100_fact_doubt_reread_landing.sql
\ir ../migrations/20261124193100_fact_doubt_reread_landing.sql

DO $$
DECLARE r record; n int; s1 jsonb; s2 jsonb;
BEGIN
  SELECT count(*) INTO n FROM public.fact_doubt_readings_to_land(50);
  ASSERT n = 2, 'two answers to land, got ' || n;
  SELECT * INTO r FROM public.fact_doubt_readings_to_land(50) WHERE request_id = 'a0000000-0000-0000-0000-000000000001';
  ASSERT r.image_id = '50000000-0000-0000-0000-000000000002', 'witness is the first current photo of this car, got ' || r.image_id;
  ASSERT r.value = '3851325' AND r.property_key = 'transmission_case_casting' AND r.model = 'model-b' AND r.confidence = 0.8
     AND r.taken_at = '2026-10-28T17:05Z' AND jsonb_array_length(r.image_ids) = 3, 'row carries value, key, model, confidence, capture time and all ids';
  ASSERT (SELECT count(*) FROM public.fact_doubt_readings_to_land(1)) = 1, 'the limit holds';
  ASSERT NOT EXISTS (SELECT 1 FROM public.fact_doubt_readings_to_land(50) t, LATERAL to_jsonb(t) j WHERE j::text LIKE '%SECRETQUOTE%'),
    'no quote leaves the store';

  -- the loop's own landed row does not change the doubt's evidence state; any other keyed reading does
  s1 := public.fact_doubt_evidence_state('10000000-0000-0000-0000-000000000001', 'transmission_case_casting', ARRAY['50000000-0000-0000-0000-000000000002'::uuid], '{}');
  INSERT INTO public.vehicle_observations (vehicle_id, property_id, extraction_method, agent_model, structured_data) VALUES
   ('10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'fact_doubt_reread_v1', 'model-b',
    '{"transmission_case_casting":"3851325","image_id":"50000000-0000-0000-0000-000000000002","fact_doubt_request_id":"a0000000-0000-0000-0000-000000000001"}');
  s2 := public.fact_doubt_evidence_state('10000000-0000-0000-0000-000000000001', 'transmission_case_casting', ARRAY['50000000-0000-0000-0000-000000000002'::uuid], '{}');
  ASSERT s1 = s2, 'a landed doubt answer is not new evidence';
  INSERT INTO public.vehicle_observations (vehicle_id, property_id, extraction_method, agent_model, structured_data) VALUES
   ('10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'physical_transcription_v1', 'model-d',
    '{"transmission_case_casting":"3851325"}');
  ASSERT s2 <> public.fact_doubt_evidence_state('10000000-0000-0000-0000-000000000001', 'transmission_case_casting', ARRAY['50000000-0000-0000-0000-000000000002'::uuid], '{}'),
    'another keyed reading still changes the state';

  ASSERT NOT EXISTS (SELECT 1 FROM public.fact_doubt_readings_to_land(50) WHERE request_id = 'a0000000-0000-0000-0000-000000000001'),
    'landed by request id';
  -- a re-ask by the same model that read the same value is already landed; another model's read is not
  INSERT INTO public.evidence_judgment_requests (id, vehicle_id, question_kind, status, subject_table, subject_id, params, answer, answer_model, answered_at) VALUES
   ('a0000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', 'fact_doubt', 'answered', 'observation_properties', '40000000-0000-0000-0000-000000000001',
    '{"doubt_form":"property","property_key":"transmission_case_casting"}', '{"outcome":"value","value":"3851325","image_ids":["50000000-0000-0000-0000-000000000002"]}', 'model-b', '2026-11-23T05:00Z'),
   ('a0000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'fact_doubt', 'answered', 'observation_properties', '40000000-0000-0000-0000-000000000001',
    '{"doubt_form":"property","property_key":"transmission_case_casting"}', '{"outcome":"value","value":"3851325","image_ids":["50000000-0000-0000-0000-000000000002"]}', 'model-e', '2026-11-23T05:01Z');
  ASSERT NOT EXISTS (SELECT 1 FROM public.fact_doubt_readings_to_land(50) WHERE request_id = 'a0000000-0000-0000-0000-000000000009'),
    'a same-model re-ask of the same value adds nothing';
  ASSERT EXISTS (SELECT 1 FROM public.fact_doubt_readings_to_land(50) WHERE request_id = 'a0000000-0000-0000-0000-00000000000a'),
    'another model''s read lands';
  -- linked by record_fact_doubt_landing (20261124193300): not listed again
  UPDATE public.evidence_judgment_requests SET answer_observation_id = gen_random_uuid() WHERE id = 'a0000000-0000-0000-0000-00000000000a';
  ASSERT NOT EXISTS (SELECT 1 FROM public.fact_doubt_readings_to_land(50) WHERE request_id = 'a0000000-0000-0000-0000-00000000000a'),
    'a linked request is landed';
  ASSERT NOT EXISTS (SELECT 1 FROM public.fact_doubt_readings_to_land(50) WHERE request_id = 'a0000000-0000-0000-0000-00000000000b'),
    'a class-scope property is not landed';
  -- the registry row refuses a new fact doubt on a class-scope property, and admits one on an instance-scope property
  BEGIN
    INSERT INTO public.evidence_judgment_requests (id, vehicle_id, question_kind, status, subject_table, subject_id, params)
    VALUES ('a0000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-000000000001', 'fact_doubt', 'pending', 'observation_properties',
            '40000000-0000-0000-0000-000000000003', '{"doubt_form":"property","property_key":"engine_configuration"}');
    RAISE EXCEPTION 'FAIL: a class-scope fact doubt was raised';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    UPDATE public.evidence_judgment_requests SET status = 'pending' WHERE id = 'a0000000-0000-0000-0000-00000000000b';
    RAISE EXCEPTION 'FAIL: a class-scope fact doubt was revived';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  UPDATE public.evidence_judgment_requests SET status = 'withdrawn' WHERE id = 'a0000000-0000-0000-0000-00000000000b';
  INSERT INTO public.evidence_judgment_requests (id, vehicle_id, question_kind, status, subject_table, subject_id, params)
  VALUES ('a0000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-000000000001', 'fact_doubt', 'pending', 'observation_properties',
          '40000000-0000-0000-0000-000000000002', '{"doubt_form":"property","property_key":"engine_block_casting"}');
END $$;

SET ROLE anon;
DO $$ BEGIN
  PERFORM public.fact_doubt_readings_to_land(1);
  RAISE EXCEPTION 'FAIL: anon listed what to land';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
SET ROLE service_role;
DO $$ BEGIN PERFORM public.fact_doubt_readings_to_land(1); END $$;
RESET ROLE;
\echo fact_doubt_reread_landing: ok
