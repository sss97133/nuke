-- Contract for 20261124193300_evidence_judgment_edges (empty disposable PG17; dependencies stubbed, fixtures synthetic).
-- Asserts: property_id / receipt_item_id are derived from subject_id by subject_table and are real foreign keys;
-- record_fact_doubt_landing links
-- only the reading landed for that very request and is idempotent; anon reads none of it.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.vehicles (id uuid PRIMARY KEY);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, vehicle_id uuid);
CREATE TABLE public.observation_properties (id uuid PRIMARY KEY, property_key text);
CREATE TABLE public.receipt_items (id uuid PRIMARY KEY);
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY, vehicle_id uuid, property_id uuid, extraction_method text,
  structured_data jsonb, is_superseded boolean DEFAULT false, superseded_by uuid);
CREATE TABLE public.evidence_judgment_requests (id uuid PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles(id),
  question_kind text, status text, subject_table text, subject_id uuid, params jsonb, answer jsonb);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

INSERT INTO public.vehicles VALUES ('10000000-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000002');
INSERT INTO public.observation_properties VALUES ('40000000-0000-0000-0000-000000000001', 'transmission_case_casting'),
  ('40000000-0000-0000-0000-000000000002', 'engine_block_casting');
INSERT INTO public.receipt_items VALUES ('60000000-0000-0000-0000-000000000001');
INSERT INTO public.vehicle_images VALUES ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001');
-- Stored before the migration: the backfill must link these.
INSERT INTO public.evidence_judgment_requests VALUES
 ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'fact_doubt', 'answered', 'observation_properties',
  '40000000-0000-0000-0000-000000000001',
  '{"property_key":"transmission_case_casting","cited_image_ids":["50000000-0000-0000-0000-000000000001","not-a-uuid","50000000-0000-0000-0000-0000000000ff"]}',
  '{"outcome":"value","value":"X1","image_ids":["50000000-0000-0000-0000-000000000002","50000000-0000-0000-0000-000000000001"]}'),
 ('a0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'receipt_part_visible', 'pending', 'receipt_items',
  '60000000-0000-0000-0000-000000000001', '{"candidate_image_ids":["50000000-0000-0000-0000-000000000003","50000000-0000-0000-0000-000000000003"]}', NULL);

\ir ../migrations/20261124193300_evidence_judgment_edges.sql

CREATE OR REPLACE FUNCTION pg_temp.t_assert(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF; END $$;

DO $$
DECLARE
  n integer;
BEGIN
  -- typed subject keys
  PERFORM pg_temp.t_assert((SELECT property_id FROM evidence_judgment_requests WHERE id = 'a0000000-0000-0000-0000-000000000001')
    = '40000000-0000-0000-0000-000000000001' AND (SELECT receipt_item_id FROM evidence_judgment_requests WHERE id = 'a0000000-0000-0000-0000-000000000001') IS NULL,
    'fact doubt carries its property key');
  PERFORM pg_temp.t_assert((SELECT receipt_item_id FROM evidence_judgment_requests WHERE id = 'a0000000-0000-0000-0000-000000000002')
    = '60000000-0000-0000-0000-000000000001', 'receipt question carries its receipt line');
  SELECT count(*) INTO n FROM pg_constraint WHERE conrelid = 'evidence_judgment_requests'::regclass AND contype = 'f'
    AND confrelid IN ('observation_properties'::regclass, 'receipt_items'::regclass, 'vehicle_observations'::regclass);
  PERFORM pg_temp.t_assert(n = 3, 'three new foreign keys');
  BEGIN
    INSERT INTO evidence_judgment_requests (id, vehicle_id, question_kind, status, subject_table, subject_id, params)
    VALUES ('a0000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', 'fact_doubt', 'pending',
            'observation_properties', '40000000-0000-0000-0000-0000000000ff', '{}');
    RAISE EXCEPTION 'FAIL: a doubt about an unknown property was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END $$;

-- record_fact_doubt_landing
INSERT INTO public.vehicle_observations VALUES
 ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'fact_doubt_reread_v1',
  '{"fact_doubt_request_id":"a0000000-0000-0000-0000-000000000001"}', false, NULL),
 ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'photo_pipeline_v1',
  '{"fact_doubt_request_id":"a0000000-0000-0000-0000-000000000001"}', false, NULL),
 ('70000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 'fact_doubt_reread_v1',
  '{"fact_doubt_request_id":"a0000000-0000-0000-0000-000000000001"}', false, NULL);
DO $$
BEGIN
  BEGIN PERFORM record_fact_doubt_landing('a0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'FAIL: another method linked'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM record_fact_doubt_landing('a0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000003');
    RAISE EXCEPTION 'FAIL: another vehicle linked'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM record_fact_doubt_landing('a0000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FAIL: an unanswered doubt linked'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM pg_temp.t_assert(record_fact_doubt_landing('a0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001'), 'links');
  PERFORM pg_temp.t_assert(record_fact_doubt_landing('a0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001'), 'idempotent');
  PERFORM pg_temp.t_assert(NOT record_fact_doubt_landing('a0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000003'),
    'a linked request keeps its reading');
  PERFORM pg_temp.t_assert((SELECT answer_observation_id FROM evidence_judgment_requests WHERE id = 'a0000000-0000-0000-0000-000000000001')
    = '70000000-0000-0000-0000-000000000001', 'edge stored');
  PERFORM pg_temp.t_assert(NOT has_function_privilege('anon', 'record_fact_doubt_landing(uuid,uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'record_fact_doubt_landing(uuid,uuid)', 'EXECUTE'), 'grants');
END $$;
\ir ../migrations/20261124193300_evidence_judgment_edges.sql
SELECT 'evidence_judgment_edges: ok' AS result;
