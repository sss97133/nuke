-- Disposable PG17 contract for reworked vehicle_replica_accuracy.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_refinement_* database';
  END IF;
END $$;
SET TimeZone = 'UTC';

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'service_role'::text $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE FUNCTION public.assert(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF; END $$;

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, user_id uuid, owner_id uuid, uploaded_by uuid,
  make text, model text, year int, vin text, is_replica boolean, replica_quote text,
  is_public boolean DEFAULT true, deleted_at timestamptz
);
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE public.observation_properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), property_key text UNIQUE NOT NULL,
  label text NOT NULL, data_type text NOT NULL DEFAULT 'enum', namespace text NOT NULL DEFAULT 'core',
  category text, applies_to_kinds text[], cardinality text NOT NULL DEFAULT 'multi',
  description text, discriminator_key text, verification_scope text, ratified_at timestamptz
);
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL,
  taken_at timestamptz, created_at timestamptz DEFAULT now(), ai_scan_metadata jsonb,
  is_superseded boolean DEFAULT false, is_duplicate boolean DEFAULT false
);
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, kind text NOT NULL,
  property_id uuid, extraction_method text, structured_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_text text, confidence_score numeric, observed_at timestamptz NOT NULL,
  ingested_at timestamptz, is_superseded boolean DEFAULT false,
  subject_type text NOT NULL DEFAULT 'vehicle', analysis_deferred boolean NOT NULL DEFAULT false,
  rank text NOT NULL DEFAULT 'normal'
);

\ir ../migrations/20261122081000_replica_target_byok_component_fold.sql

INSERT INTO observation_properties(id, property_key, label) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'engine_block_casting', 'Engine block casting'),
  ('00000000-0000-0000-0000-0000000000e2', 'engine_code_stamp', 'Engine code stamp'),
  ('00000000-0000-0000-0000-0000000000e3', 'transmission_case_casting', 'Trans case casting'),
  ('00000000-0000-0000-0000-0000000000e4', 'transmission_id_stamp', 'Trans id stamp'),
  ('00000000-0000-0000-0000-0000000000e5', 'body_tag_style', 'Body tag style'),
  ('00000000-0000-0000-0000-0000000000e6', 'body_tag_option_codes', 'Body tag option codes');

INSERT INTO vehicles(id, make, model, year, vin, is_replica, replica_quote, is_public)
VALUES ('00000000-0000-0000-0000-0000000000a0', 'Pontiac', 'Firebird', 1973, '2S87D3N000001', false, null, true);
SELECT public.assert(
  (public.vehicle_replica_accuracy('00000000-0000-0000-0000-0000000000a0')->>'applicable')::boolean IS FALSE,
  'non-replica not applicable');

INSERT INTO vehicles(id, make, model, year, vin, is_replica, replica_quote, is_public)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'Pontiac', 'Firebird', 1973, '2S87D3N143591', true,
        'Built as a Trans Am SD-455 clone', true);

INSERT INTO vehicle_observations(vehicle_id, kind, property_id, extraction_method, structured_data, observed_at)
VALUES
 ('00000000-0000-0000-0000-0000000000a1', 'specification', '00000000-0000-0000-0000-0000000000e1',
  'engine_block_decode_v1', '{"engine_block_casting":"9799140"}', now()),
 ('00000000-0000-0000-0000-0000000000a1', 'specification', '00000000-0000-0000-0000-0000000000e2',
  'engine_block_decode_v1', '{"engine_code_stamp":"YH"}', now()),
 ('00000000-0000-0000-0000-0000000000a1', 'specification', '00000000-0000-0000-0000-0000000000e3',
  'trans_id_stamp_decode_v1', '{"transmission_case_casting":"3851325"}', now()),
 ('00000000-0000-0000-0000-0000000000a1', 'specification', '00000000-0000-0000-0000-0000000000e4',
  'trans_id_stamp_decode_v1', '{"transmission_id_stamp":"P0118"}', now()),
 ('00000000-0000-0000-0000-0000000000a1', 'specification', '00000000-0000-0000-0000-0000000000e5',
  'cowl_tag_decode_v1', '{"body_tag_style":"2FS87"}', now()),
 ('00000000-0000-0000-0000-0000000000a1', 'specification', '00000000-0000-0000-0000-0000000000e6',
  'cowl_tag_decode_v1', '{"body_tag_option_codes":[],"absent_codes_checked":["WS4","W66"]}', now());

INSERT INTO vehicle_images(id, vehicle_id, taken_at, ai_scan_metadata) VALUES
 ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', now(),
  '{"byok_deep_analysis":{"scene_type":"body_exterior","components_seen":[
     {"label":"Shaker scoop","confidence":0.99},
     {"label":"Hood bird graphic","confidence":0.95},
     {"label":"Rear spoiler","confidence":0.97},
     {"label":"Left front wheel and white-letter tire","confidence":0.9}
   ]}}'::jsonb);

SELECT public.fold_byok_component_observations('00000000-0000-0000-0000-0000000000a1', false);
SELECT public.decide_replica_components('00000000-0000-0000-0000-0000000000a1', false);

CREATE TEMP TABLE ra AS
  SELECT public.vehicle_replica_accuracy('00000000-0000-0000-0000-0000000000a1') AS j;

SELECT public.assert((j->>'applicable')::boolean, 'replica applicable') FROM ra;
SELECT public.assert(j->>'distinct_from' = 'originality_score', 'distinct from originality') FROM ra;
SELECT public.assert((j->'base_chassis'->>'excluded_from_score')::boolean IS TRUE,
  'base chassis excluded from score') FROM ra;
SELECT public.assert(
  NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(j->'components') c
     WHERE c->>'component' = 'identity_cowl_options'
  ), 'identity_cowl_options no longer scored as a weighted component') FROM ra;
SELECT public.assert(
  EXISTS (
    SELECT 1 FROM jsonb_array_elements(j->'components') c
     WHERE c->>'component' = 'engine_block' AND c->>'category' = 'period_correct_substitute'
  ), 'engine 9799140/YH is period_correct_substitute vs SD target') FROM ra;
SELECT public.assert(
  EXISTS (
    SELECT 1 FROM jsonb_array_elements(j->'components') c
     WHERE c->>'component' = 'hood_scoop' AND c->>'category' = 'factory_correct'
  ), 'shaker scoop scores factory_correct appearance') FROM ra;
SELECT public.assert(
  EXISTS (
    SELECT 1 FROM jsonb_array_elements(j->'components') c
     WHERE c->>'component' = 'transmission' AND c->>'category' <> 'unknown'
  ), 'drivetrain/transmission can score (not hard-coded unknown)') FROM ra;
SELECT public.assert(j ? 'accuracy_score_known_only', 'known-only score present') FROM ra;
SELECT public.assert((j->>'unknown_share')::numeric >= 0, 'unknown share reported') FROM ra;
SELECT public.assert(
  (j->>'accuracy_score_known_only')::numeric > 33.8,
  'reworked score exceeds prior 33.8 identity-penalty figure') FROM ra;

SELECT public.assert(true, 'vehicle_replica_accuracy contract complete');
