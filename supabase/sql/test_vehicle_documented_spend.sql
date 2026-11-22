-- Disposable PG17 contract for vehicle_documented_spend and its consumers.
--   createdb dm_refinement_documented_spend
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_documented_spend -f supabase/sql/test_vehicle_documented_spend.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_refinement_* database';
  END IF;
END $$;
SET TimeZone = 'UTC';

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.auth_role', true), ''), 'anon') $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE FUNCTION public.assert(cond boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', msg; END IF; END $$;

CREATE TYPE public.receipt_doc_kind AS ENUM (
  'parts_service', 'unknown', 'quote', 'fuel', 'other'
);
CREATE FUNCTION public.receipt_doc_kind_quoted(k public.receipt_doc_kind) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT k = 'quote'::public.receipt_doc_kind $$;
CREATE FUNCTION public.receipt_doc_kind_excluded(k public.receipt_doc_kind) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$ SELECT false $$;

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, user_id uuid, owner_id uuid, uploaded_by uuid, make text, model text, year int,
  vin text, color text, engine_size text, transmission text, is_public boolean DEFAULT true,
  deleted_at timestamptz, listing_kind text, value_score numeric, value_breakdown jsonb,
  primary_image_url text, title_status text, mileage int, condition_rating numeric,
  data_quality_score numeric
);
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE public.timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, cost_amount numeric,
  event_type text, event_date date, mileage_at_event int, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.work_order_parts (timeline_event_id uuid, total_price numeric);
CREATE TABLE public.work_order_labor (timeline_event_id uuid, total_cost numeric);
CREATE TABLE public.receipts (
  id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, scope_type text, scope_id text,
  total_amount numeric, total numeric, amount_check text, document_kind public.receipt_doc_kind,
  duplicate_of uuid, is_superseded boolean DEFAULT false, processing_status text,
  vendor_name text, receipt_date date
);
CREATE TABLE public.receipt_vehicle_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid, vehicle_id uuid,
  status text, retired_at timestamptz, user_id uuid, basis text
);
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, kind text,
  structured_data jsonb, is_superseded boolean DEFAULT false, content_text text
);
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid,
  is_approved boolean DEFAULT true
);
CREATE FUNCTION public.vehicle_image_gallery_eligible(vi public.vehicle_images)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;
CREATE TABLE public.service_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, cost numeric
);
CREATE TABLE public.field_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, field_name text
);
CREATE TABLE public.ownership_transfers (vehicle_id uuid, agreed_price numeric);
CREATE TABLE public.bat_listings (
  vehicle_id uuid, sale_price numeric, bid_count int, comment_count int, listing_status text
);
CREATE TABLE public.external_listings (vehicle_id uuid);

CREATE TYPE public.grade_dimension AS (
  dimension text, raw_score numeric, weight numeric, evidence_count integer, confidence text, notes text);
CREATE TYPE public.grade_result AS (
  vehicle_id uuid, grade numeric, grade_label text, grade_floor numeric, grade_ceiling numeric,
  confidence text, is_gradeable boolean, total_evidence integer, dimensions public.grade_dimension[],
  calculated_at timestamptz);

-- Minimal compute_vehicle_grade that uses the same unmasked fold the production patch installs.
CREATE FUNCTION public.compute_vehicle_grade(p_vehicle_id uuid) RETURNS public.grade_result
LANGUAGE plpgsql STABLE AS $$
DECLARE
  result grade_result;
  rec_count int;
  cost_documented numeric;
  dim grade_dimension;
  dimensions grade_dimension[] := '{}';
BEGIN
  result.vehicle_id := p_vehicle_id;
  result.calculated_at := now();
  SELECT coalesce((spend_fold->>'receipt_count')::int, 0)
           + coalesce((spend_fold->>'work_record_count')::int, 0),
         coalesce((spend_fold->>'net_spend')::numeric, 0)
  INTO rec_count, cost_documented
  FROM (SELECT public._vehicle_documented_spend_unmasked(p_vehicle_id) AS spend_fold) s;
  dim.dimension := 'documentation';
  dim.raw_score := 5;
  dim.weight := 0.2;
  dim.evidence_count := rec_count;
  dim.confidence := 'high';
  dim.notes := FORMAT('VIN: Yes | Mileage: Unknown | Receipts: %s | Documented spend: $%s',
    rec_count, TO_CHAR(cost_documented, 'FM999,999.00'));
  dimensions := array_append(dimensions, dim);
  result.dimensions := dimensions;
  result.grade := 5;
  result.is_gradeable := true;
  result.total_evidence := rec_count;
  result.confidence := 'medium';
  result.grade_label := 'Average';
  result.grade_floor := 4;
  result.grade_ceiling := 6;
  RETURN result;
END $$;

\ir ../migrations/20261122032000_vehicle_documented_spend_replica_accuracy.sql

-- Fixtures: car A has $100 charge + -$10 credit + a quote (ignored) → net 90.
INSERT INTO public.vehicles(id, make, model, year, vin, is_public)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'Pontiac', 'Firebird', 1973, '2S87D3N143591', true);

INSERT INTO public.receipts(id, user_id, vehicle_id, scope_type, scope_id, total_amount, total,
  amount_check, document_kind, processing_status) VALUES
 ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000f1',
  '00000000-0000-0000-0000-0000000000a1', 'vehicle', '00000000-0000-0000-0000-0000000000a1',
  100, 100, 'verified', 'parts_service', 'completed'),
 ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000f1',
  '00000000-0000-0000-0000-0000000000a1', 'vehicle', '00000000-0000-0000-0000-0000000000a1',
  -10, -10, 'verified', 'parts_service', 'completed'),
 ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000f1',
  '00000000-0000-0000-0000-0000000000a1', 'vehicle', '00000000-0000-0000-0000-0000000000a1',
  500, 500, 'verified', 'quote', 'completed');

INSERT INTO public.receipt_vehicle_links(receipt_id, vehicle_id, status, user_id, basis)
SELECT id, vehicle_id, 'linked', user_id, 'test' FROM public.receipts;

-- Unmasked fold (sibling writers / service path).
SELECT public.assert(
  (public._vehicle_documented_spend_unmasked('00000000-0000-0000-0000-0000000000a1')->>'net_spend')::numeric = 90,
  'unmasked net_spend nets credits and ignores quotes');
SELECT public.assert(
  (public._vehicle_documented_spend_unmasked('00000000-0000-0000-0000-0000000000a1')->>'gross_charges')::numeric = 100,
  'gross_charges is positives only');
SELECT public.assert(
  (public._vehicle_documented_spend_unmasked('00000000-0000-0000-0000-0000000000a1')->>'credits')::numeric = -10,
  'credits are negative');
SELECT public.assert(
  (public._vehicle_documented_spend_unmasked('00000000-0000-0000-0000-0000000000a1')->>'receipt_count')::int = 2,
  'quote excluded from receipt_count');

-- Anon stranger on a public vehicle: counts yes, amounts NULL.
SELECT set_config('test.auth_role', 'anon', false);
SELECT set_config('test.auth_uid', '', false);
SELECT public.assert(
  (public.vehicle_documented_spend('00000000-0000-0000-0000-0000000000a1')->>'amounts_visible')::boolean IS FALSE
  AND public.vehicle_documented_spend('00000000-0000-0000-0000-0000000000a1')->>'net_spend' IS NULL
  AND (public.vehicle_documented_spend('00000000-0000-0000-0000-0000000000a1')->>'receipt_count')::int = 2,
  'anon sees receipt_count but not amounts');

-- Service role sees amounts.
SELECT set_config('test.auth_role', 'service_role', false);
SELECT public.assert(
  (public.vehicle_documented_spend('00000000-0000-0000-0000-0000000000a1')->>'net_spend')::numeric = 90
  AND (public.vehicle_documented_spend('00000000-0000-0000-0000-0000000000a1')->>'amounts_visible')::boolean IS TRUE,
  'service_role sees amounts');

SELECT public.assert(
  (public.get_vehicle_total_invested('00000000-0000-0000-0000-0000000000a1') #>> '{breakdown,receipts}')::numeric = 90,
  'get_vehicle_total_invested receipts lens = net spend');
SELECT public.assert(
  (public.get_vehicle_total_invested('00000000-0000-0000-0000-0000000000a1')->>'total_invested')::numeric = 90,
  'total_invested uses net spend when WO/timeline are empty');

SELECT public.compute_vehicle_value('00000000-0000-0000-0000-0000000000a1');
SELECT public.assert(
  (SELECT (value_breakdown->>'receipts_total')::numeric FROM vehicles
    WHERE id = '00000000-0000-0000-0000-0000000000a1') = 90,
  'value_breakdown.receipts_total uses the fold (completed status included)');

SELECT public.assert(
  (public.compute_vehicle_grade('00000000-0000-0000-0000-0000000000a1')).dimensions[1].notes
    LIKE '%Documented spend: $90%',
  'grades Documented spend reads the fold, not service_records');

SELECT public.assert(
  (public._vehicle_documented_spend_unmasked('00000000-0000-0000-0000-0000000000a1')->>'net_spend')::numeric
    < (public._vehicle_documented_spend_unmasked('00000000-0000-0000-0000-0000000000a1')->>'gross_charges')::numeric,
  'net < gross when credits exist (explains 21161.81 vs 21213.41 on the proof vehicle)');

-- Private / deleted vehicle hidden from anon.
UPDATE public.vehicles SET is_public = false
 WHERE id = '00000000-0000-0000-0000-0000000000a1';
SELECT set_config('test.auth_role', 'anon', false);
SELECT public.assert(
  public.vehicle_documented_spend('00000000-0000-0000-0000-0000000000a1') IS NULL,
  'anon cannot read spend on a private vehicle');

SELECT public.assert(true, 'vehicle_documented_spend contract complete');
