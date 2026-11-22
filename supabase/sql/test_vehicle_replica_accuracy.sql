-- Disposable PG17 contract for vehicle_replica_accuracy.
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
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'anon'::text $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE FUNCTION public.assert(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF; END $$;

CREATE TYPE public.receipt_doc_kind AS ENUM ('parts_service', 'unknown', 'quote');
CREATE FUNCTION public.receipt_doc_kind_quoted(k public.receipt_doc_kind) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT false $$;
CREATE FUNCTION public.receipt_doc_kind_excluded(k public.receipt_doc_kind) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT false $$;

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, make text, model text, year int, vin text, is_replica boolean,
  replica_quote text, is_public boolean DEFAULT true, listing_kind text, value_score numeric,
  value_breakdown jsonb, color text, engine_size text, transmission text
);
CREATE TABLE public.timeline_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, cost_amount numeric, created_at timestamptz DEFAULT now());
CREATE TABLE public.work_order_parts (timeline_event_id uuid, total_price numeric);
CREATE TABLE public.work_order_labor (timeline_event_id uuid, total_cost numeric);
CREATE TABLE public.receipts (
  id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, scope_type text, scope_id text,
  total_amount numeric, total numeric, amount_check text, document_kind public.receipt_doc_kind,
  duplicate_of uuid, is_superseded boolean DEFAULT false
);
CREATE TABLE public.receipt_vehicle_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid, vehicle_id uuid, status text, retired_at timestamptz
);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, is_approved boolean DEFAULT true);
CREATE FUNCTION public.vehicle_image_gallery_eligible(vi public.vehicle_images) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;
CREATE TABLE public.observation_properties (id uuid PRIMARY KEY, property_key text UNIQUE);
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, kind text,
  extraction_method text, property_id uuid, structured_data jsonb, is_superseded boolean DEFAULT false,
  content_text text, observed_at timestamptz DEFAULT now()
);
CREATE TABLE public.vehicle_decode_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rule_key text, code text, value jsonb,
  citation_url text, cited_on date, superseded_at timestamptz
);
CREATE TABLE public.engine_blocks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid);
CREATE TABLE public.transmission_cases (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid);
CREATE TABLE public.vehicle_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, option_code text, UNIQUE(vehicle_id, option_code)
);
CREATE TABLE public.field_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, field_name text,
  proposed_value text, source_type text, source_confidence int, status text,
  assigned_at timestamptz, assigned_by text, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.vehicle_field_provenance (
  vehicle_id uuid, field_name text, current_value text, total_confidence int,
  primary_source text, supporting_sources text[], updated_at timestamptz,
  PRIMARY KEY (vehicle_id, field_name)
);
CREATE TYPE public.grade_dimension AS (
  dimension text, raw_score numeric, weight numeric, evidence_count integer, confidence text, notes text);
CREATE TYPE public.grade_result AS (
  vehicle_id uuid, grade numeric, grade_label text, grade_floor numeric, grade_ceiling numeric,
  confidence text, is_gradeable boolean, total_evidence integer, dimensions public.grade_dimension[],
  calculated_at timestamptz);
CREATE FUNCTION public.compute_vehicle_grade(p_vehicle_id uuid) RETURNS public.grade_result
LANGUAGE sql AS $$ SELECT ROW(p_vehicle_id, 5, 'A', 4, 6, 'low', true, 0, '{}'::grade_dimension[], now())::grade_result $$;

\ir ../migrations/20261122032000_vehicle_documented_spend_replica_accuracy.sql

INSERT INTO observation_properties(id, property_key) VALUES
  ('00000000-0000-0000-0000-0000000000p1', 'engine_block_casting'),
  ('00000000-0000-0000-0000-0000000000p2', 'engine_code_stamp'),
  ('00000000-0000-0000-0000-0000000000p6', 'body_tag_option_codes'),
  ('00000000-0000-0000-0000-0000000000p7', 'body_tag_style');

-- Non-replica → not applicable.
INSERT INTO vehicles(id, make, model, year, vin, is_replica)
VALUES ('00000000-0000-0000-0000-0000000000a0', 'Pontiac', 'Firebird', 1973, '2S87D3N000001', false);
SELECT public.assert(
  (public.vehicle_replica_accuracy('00000000-0000-0000-0000-0000000000a0')->>'applicable')::boolean IS FALSE,
  'non-replica is not applicable');

INSERT INTO vehicles(id, make, model, year, vin, is_replica, replica_quote)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'Pontiac', 'Firebird', 1973, '2S87D3N143591', true,
        'Built as a Trans Am SD-455 clone');

INSERT INTO vehicle_observations(vehicle_id, kind, extraction_method, property_id, structured_data) VALUES
 ('00000000-0000-0000-0000-0000000000a1', 'specification', 'engine_block_decode_v1',
  '00000000-0000-0000-0000-0000000000p1', '{"engine_block_casting":"9799140"}'),
 ('00000000-0000-0000-0000-0000000000a1', 'specification', 'engine_block_decode_v1',
  '00000000-0000-0000-0000-0000000000p2', '{"engine_code_stamp":"YH"}'),
 ('00000000-0000-0000-0000-0000000000a1', 'specification', 'cowl_tag_decode_v1',
  '00000000-0000-0000-0000-0000000000p7', '{"body_tag_style":"2FS87"}'),
 ('00000000-0000-0000-0000-0000000000a1', 'specification', 'cowl_tag_decode_v1',
  '00000000-0000-0000-0000-0000000000p6',
  '{"body_tag_option_codes":[],"absent_codes_checked":["WS4","W66"]}');

CREATE TEMP TABLE ra AS
  SELECT public.vehicle_replica_accuracy('00000000-0000-0000-0000-0000000000a1') AS j;

SELECT public.assert((j->>'applicable')::boolean, 'replica is applicable') FROM ra;
SELECT public.assert(j->>'distinct_from' = 'originality_score', 'distinct from originality') FROM ra;
SELECT public.assert((j->>'unknown_share')::numeric >= 0.2, 'unknown share reported (>= appearance+other+drivetrain)') FROM ra;
SELECT public.assert(
  EXISTS (
    SELECT 1 FROM jsonb_array_elements(j->'components') c
     WHERE c->>'component' = 'engine' AND c->>'category' = 'period_correct_substitute'
  ), 'engine scored period_correct_substitute for YH/9799140 vs SD-455') FROM ra;
SELECT public.assert(
  EXISTS (
    SELECT 1 FROM jsonb_array_elements(j->'components') c
     WHERE c->>'component' = 'identity_cowl_options' AND c->>'category' = 'non_correct'
  ), 'WS4 absence is non_correct vs Trans Am target') FROM ra;
SELECT public.assert(
  EXISTS (
    SELECT 1 FROM jsonb_array_elements(j->'components') c
     WHERE c->>'category' = 'unknown'
  ), 'at least one unknown component; never guessed') FROM ra;
SELECT public.assert(j ? 'accuracy_score_known_only', 'known-only score present') FROM ra;

SELECT public.assert(true, 'vehicle_replica_accuracy contract complete');
