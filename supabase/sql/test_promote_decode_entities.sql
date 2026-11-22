-- Disposable PG17 contract for promote_vehicle_decode_entities + identity reconcile.
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

-- Minimal stubs so the money/replica parts of the migration can load.
CREATE TYPE public.receipt_doc_kind AS ENUM ('parts_service', 'unknown', 'quote');
CREATE FUNCTION public.receipt_doc_kind_quoted(k public.receipt_doc_kind) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT k = 'quote'::public.receipt_doc_kind $$;
CREATE FUNCTION public.receipt_doc_kind_excluded(k public.receipt_doc_kind) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT false $$;

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, user_id uuid, owner_id uuid, uploaded_by uuid, make text, model text,
  year int, vin text, is_replica boolean, replica_quote text, is_public boolean DEFAULT true,
  deleted_at timestamptz, listing_kind text, value_score numeric, value_breakdown jsonb,
  color text, engine_size text, transmission text
);
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE public.timeline_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, cost_amount numeric, created_at timestamptz DEFAULT now());
CREATE TABLE public.work_order_parts (timeline_event_id uuid, total_price numeric);
CREATE TABLE public.work_order_labor (timeline_event_id uuid, total_cost numeric);
CREATE TABLE public.receipts (
  id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, scope_type text, scope_id text,
  total_amount numeric, total numeric, amount_check text, document_kind public.receipt_doc_kind,
  duplicate_of uuid, is_superseded boolean DEFAULT false, processing_status text
);
CREATE TABLE public.receipt_vehicle_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid, vehicle_id uuid,
  status text, retired_at timestamptz
);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, is_approved boolean DEFAULT true);
CREATE FUNCTION public.vehicle_image_gallery_eligible(vi public.vehicle_images) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;

CREATE TABLE public.observation_properties (id uuid PRIMARY KEY, property_key text UNIQUE);
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, kind text,
  extraction_method text, property_id uuid, structured_data jsonb,
  is_superseded boolean DEFAULT false, content_text text, observed_at timestamptz DEFAULT now()
);
CREATE TABLE public.vehicle_decode_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rule_key text, code text, value jsonb,
  citation_url text, cited_on date, superseded_at timestamptz, superseded_by uuid
);
CREATE TABLE public.engine_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL,
  casting_number text, block_suffix text, displacement_ci numeric, is_original boolean,
  provenance text DEFAULT 'unknown', provenance_detail text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.transmission_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL,
  casting_number text, serial_number text, tail_housing_type text,
  provenance text DEFAULT 'unknown', provenance_detail text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.vehicle_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL,
  option_code text NOT NULL, option_name text, category text, source text,
  verified_by_spid boolean DEFAULT false,
  UNIQUE (vehicle_id, option_code)
);
CREATE TABLE public.field_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, field_name text,
  proposed_value text, source_type text, source_confidence integer, status text,
  assigned_at timestamptz, assigned_by text, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.vehicle_field_provenance (
  vehicle_id uuid NOT NULL, field_name text NOT NULL, current_value text,
  total_confidence integer, primary_source text, supporting_sources text[],
  updated_at timestamptz, PRIMARY KEY (vehicle_id, field_name)
);

-- Shim grade so the migration patch finds the spend call already present / or skips safely.
CREATE TYPE public.grade_dimension AS (
  dimension text, raw_score numeric, weight numeric, evidence_count integer, confidence text, notes text);
CREATE TYPE public.grade_result AS (
  vehicle_id uuid, grade numeric, grade_label text, grade_floor numeric, grade_ceiling numeric,
  confidence text, is_gradeable boolean, total_evidence integer, dimensions public.grade_dimension[],
  calculated_at timestamptz);
CREATE FUNCTION public.compute_vehicle_grade(p_vehicle_id uuid) RETURNS public.grade_result
LANGUAGE sql AS $$
  SELECT ROW(p_vehicle_id, 5, 'A', 4, 6, 'low', true, 0, '{}'::grade_dimension[], now())::grade_result
$$;

\ir ../migrations/20261122032000_vehicle_documented_spend_replica_accuracy.sql

INSERT INTO observation_properties(id, property_key) VALUES
  ('00000000-0000-0000-0000-0000000000p1', 'engine_block_casting'),
  ('00000000-0000-0000-0000-0000000000p2', 'engine_code_stamp'),
  ('00000000-0000-0000-0000-0000000000p3', 'transmission_case_casting'),
  ('00000000-0000-0000-0000-0000000000p4', 'transmission_id_stamp'),
  ('00000000-0000-0000-0000-0000000000p5', 'transmission_tailhousing_casting'),
  ('00000000-0000-0000-0000-0000000000p6', 'body_tag_option_codes'),
  ('00000000-0000-0000-0000-0000000000p7', 'body_tag_style');

INSERT INTO vehicles(id, make, model, year, vin, is_replica, replica_quote)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'Pontiac', 'Firebird', 1973, '2S87D3N143591', true,
        'Built as a Trans Am SD-455 clone');

INSERT INTO vehicle_decode_rules(rule_key, code, value, citation_url)
VALUES ('block_casting', '9799140', '{"displacement_ci":455}', 'https://example.test/casting');

INSERT INTO vehicle_observations(id, vehicle_id, kind, extraction_method, property_id, structured_data) VALUES
 ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'specification',
  'engine_block_decode_v1', '00000000-0000-0000-0000-0000000000p1',
  '{"engine_block_casting":"9799140","claim_role":"engine_block_casting"}'),
 ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', 'specification',
  'engine_block_decode_v1', '00000000-0000-0000-0000-0000000000p2',
  '{"engine_code_stamp":"YH","claim_role":"engine_code_stamp"}'),
 ('00000000-0000-0000-0000-0000000000t1', '00000000-0000-0000-0000-0000000000a1', 'specification',
  'trans_id_stamp_decode_v1', '00000000-0000-0000-0000-0000000000p3',
  '{"transmission_case_casting":"3851325","claim_role":"transmission_case_model"}'),
 ('00000000-0000-0000-0000-0000000000t2', '00000000-0000-0000-0000-0000000000a1', 'specification',
  'trans_id_stamp_decode_v1', '00000000-0000-0000-0000-0000000000p4',
  '{"transmission_id_stamp":"P0118","claim_role":"transmission_id_stamp"}'),
 ('00000000-0000-0000-0000-0000000000t3', '00000000-0000-0000-0000-0000000000a1', 'specification',
  'trans_id_stamp_decode_v1', '00000000-0000-0000-0000-0000000000p5',
  '{"transmission_tailhousing_casting":"3857584","claim_role":"transmission_tailhousing"}'),
 ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'specification',
  'cowl_tag_decode_v1', '00000000-0000-0000-0000-0000000000p6',
  '{"body_tag_option_codes":[],"absent_codes_checked":["WS4","W66"],"claim_role":"cowl_tag_option_codes"}'),
 ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1', 'specification',
  'cowl_tag_decode_v1', '00000000-0000-0000-0000-0000000000p7',
  '{"body_tag_style":"2FS87","claim_role":"cowl_tag_style"}');

-- Dry run writes nothing.
SELECT public.assert(
  (public.promote_vehicle_decode_entities('00000000-0000-0000-0000-0000000000a1', true) #>> '{engine_block,casting_number}') = '9799140',
  'dry-run reports casting');
SELECT public.assert(
  (SELECT count(*) FROM engine_blocks) = 0, 'dry-run inserts no engine_blocks');

-- Apply once.
SELECT public.promote_vehicle_decode_entities('00000000-0000-0000-0000-0000000000a1', false);
SELECT public.assert(
  (SELECT casting_number FROM engine_blocks WHERE coalesce(is_superseded,false) IS NOT TRUE) = '9799140',
  'engine_blocks casting folded');
SELECT public.assert(
  (SELECT block_suffix FROM engine_blocks WHERE coalesce(is_superseded,false) IS NOT TRUE) = 'YH',
  'engine_blocks stamp folded');
SELECT public.assert(
  (SELECT displacement_ci FROM engine_blocks WHERE coalesce(is_superseded,false) IS NOT TRUE) = 455,
  'displacement from decode rules');
SELECT public.assert(
  (SELECT serial_number FROM transmission_cases WHERE coalesce(is_superseded,false) IS NOT TRUE) = 'P0118',
  'transmission id stamp folded');
SELECT public.assert(
  (SELECT count(*) FROM vehicle_options WHERE is_present IS FALSE AND option_code IN ('WS4','W66')) = 2,
  'explicit absences folded');

-- Idempotent re-run.
SELECT public.assert(
  (public.promote_vehicle_decode_entities('00000000-0000-0000-0000-0000000000a1', false) #>> '{engine_block,action}') = 'unchanged',
  'second promote is idempotent');
SELECT public.assert((SELECT count(*) FROM engine_blocks) = 1, 'no duplicate engine rows');

-- Supersede-before-insert: changed casting must not trip one-current unique index.
UPDATE vehicle_observations
   SET structured_data = '{"engine_block_casting":"3970010","claim_role":"engine_block_casting"}'
 WHERE id = '00000000-0000-0000-0000-0000000000e1';
SELECT public.assert(
  (public.promote_vehicle_decode_entities('00000000-0000-0000-0000-0000000000a1', false) #>> '{engine_block,action}')
    = 'superseded_prior',
  'changed casting supersedes prior current row');
SELECT public.assert(
  (SELECT count(*) FROM engine_blocks) = 2
  AND (SELECT casting_number FROM engine_blocks WHERE coalesce(is_superseded,false) IS NOT TRUE) = '3970010'
  AND (SELECT count(*) FROM engine_blocks WHERE is_superseded IS TRUE) = 1,
  'one current engine row after supersede');

-- Identity: Corvette ai_visual superseded; 13-char VIN 2… → Pontiac wins.
INSERT INTO field_evidence(vehicle_id, field_name, proposed_value, source_type, source_confidence, status)
VALUES
 ('00000000-0000-0000-0000-0000000000a1', 'make', 'Corvette', 'ai_visual', 95, 'accepted'),
 ('00000000-0000-0000-0000-0000000000a1', 'make', 'Pontiac', 'gm_vin_chart', 90, 'pending');
INSERT INTO vehicle_field_provenance(vehicle_id, field_name, current_value, total_confidence, primary_source)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'make', 'Corvette', 95, 'field_evidence:ai_visual');

SELECT public.reconcile_identity_field_provenance('00000000-0000-0000-0000-0000000000a1', false);
SELECT public.assert(
  (SELECT status FROM field_evidence WHERE proposed_value = 'Corvette') = 'superseded',
  'AI Corvette claim superseded not deleted');
SELECT public.assert(
  (SELECT current_value FROM vehicle_field_provenance WHERE field_name = 'make') = 'Pontiac',
  'provenance cache refreshed to Pontiac');
SELECT public.assert(
  (SELECT count(*) FROM field_evidence WHERE proposed_value = 'Corvette') = 1,
  'superseded row kept');

-- 17-char modern VIN must not use the pre-1981 first-digit GM map (1G2… ≠ Chevrolet).
INSERT INTO vehicles(id, make, model, year, vin, is_public)
VALUES ('00000000-0000-0000-0000-0000000000a2', 'Toyota', 'Supra', 1994, 'JT2JA82J0R0012345', true);
INSERT INTO field_evidence(vehicle_id, field_name, proposed_value, source_type, source_confidence, status)
VALUES ('00000000-0000-0000-0000-0000000000a2', 'make', 'Toyota', 'title', 99, 'accepted');
INSERT INTO vehicle_field_provenance(vehicle_id, field_name, current_value, total_confidence, primary_source)
VALUES ('00000000-0000-0000-0000-0000000000a2', 'make', 'Toyota', 99, 'field_evidence:title');
SELECT public.reconcile_identity_field_provenance('00000000-0000-0000-0000-0000000000a2', false);
SELECT public.assert(
  (SELECT current_value FROM vehicle_field_provenance
    WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a2' AND field_name = 'make') = 'Toyota',
  '17-char VIN does not overwrite make via GM first-digit map');
SELECT public.assert(
  NOT EXISTS (
    SELECT 1 FROM field_evidence
     WHERE vehicle_id = '00000000-0000-0000-0000-0000000000a2'
       AND source_type = 'gm_vin_chart'),
  'no gm_vin_chart row minted for modern VIN');

SELECT public.assert(true, 'promote_decode_entities contract complete');
