-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_day_receipt -f this-file.sql
-- Proves that the day receipt and the work calendar carry money only to the signed-in owner, uploader
-- or contributor, mask it for every other caller, and read as NULL for a private vehicle the caller
-- may not see. Starts from the live definitions, then applies the migration.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

-- The tables the two readers touch, with the columns they read.
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, year integer, make text, model text, vin text, trim text,
  user_id uuid, owner_id uuid, uploaded_by uuid, is_public boolean NOT NULL DEFAULT true);
CREATE TABLE public.work_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, session_date date,
  title text, start_time timestamptz, end_time timestamptz, duration_minutes integer, work_type text,
  work_description text, status text, total_parts_cost numeric, total_labor_cost numeric, total_job_cost numeric,
  image_count integer);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, image_url text,
  thumbnail_url text, taken_at timestamptz, source text, file_name text, area text, part text, operation text,
  fabrication_stage text, image_type text, category text, caption text, vision_gate_status text,
  is_duplicate boolean, is_superseded boolean);
CREATE TABLE public.receipts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, vendor_name text,
  receipt_date date, total numeric, total_amount numeric, raw_json jsonb, invoice_number text, payment_method text);
CREATE TABLE public.work_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid);
CREATE TABLE public.component_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_type text, event_date date,
  description text, component_table text, cost_cents integer, work_order_id uuid);
CREATE TABLE public.work_order_line_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), component_event_id uuid,
  line_number integer, task_type text, task_description text, hours_labor numeric, parts_cost_cents integer,
  total_cost_cents integer, status text, notes text);
CREATE TABLE public.vehicle_contributors (vehicle_id uuid, user_id uuid, status text);
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.vehicle_contributors
                 WHERE vehicle_id = p_vehicle_id AND user_id = p_user_id AND coalesce(status, 'active') = 'active') $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;

\ir helpers/get_daily_work_receipt_live_20261013.sql
\ir helpers/get_vehicle_work_dates_live_20261013.sql
GRANT EXECUTE ON FUNCTION public.get_daily_work_receipt(uuid, date), public.get_vehicle_work_dates(uuid, date, date) TO anon, authenticated;
\ir ../migrations/20261013164500_day_receipt_money_owner_only.sql

-- Seeds (a disposable database, never production): a public vehicle (owner u1, uploader u2,
-- contributor u6) with one work day; a private vehicle (user u4).
INSERT INTO public.vehicles VALUES
 ('10000000-0000-0000-0000-000000000001', 1977, 'Chevrolet', 'K5 Blazer', 'VIN1', 'Cheyenne',
  NULL, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', true),
 ('10000000-0000-0000-0000-000000000004', 1988, 'Chevrolet', 'K5 Blazer', 'VIN4', NULL,
  '20000000-0000-0000-0000-000000000004', NULL, NULL, false);
INSERT INTO public.vehicle_contributors VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006', 'active');
INSERT INTO public.work_sessions (vehicle_id, session_date, title, duration_minutes, work_type, work_description, status, total_parts_cost, total_labor_cost, total_job_cost, image_count) VALUES
 ('10000000-0000-0000-0000-000000000001', '2025-01-24', 'Engine bay', 240, 'heavy_work', 'Harness routing', 'completed', 120.50, 300, 420.50, 1),
 ('10000000-0000-0000-0000-000000000004', '2026-01-01', 'Private day', 60, 'work', 'x', 'completed', 10, 20, 30, 0);
INSERT INTO public.vehicle_images (vehicle_id, image_url, taken_at, source, file_name, category) VALUES
 ('10000000-0000-0000-0000-000000000001', 'https://x/1.jpg', '2025-01-24T15:00:00Z', 'iphoto', '1.jpg', 'engine');
INSERT INTO public.receipts (vehicle_id, vendor_name, receipt_date, total, total_amount, raw_json, invoice_number, payment_method) VALUES
 ('10000000-0000-0000-0000-000000000001', 'Summit Racing', '2025-01-24', 120.50, 120.50,
  '{"items": [{"name": "Alternator bracket", "quantity": 1, "unit_price": 120.50, "total": 120.50}], "order_number": "SR-1"}', NULL, 'card');
INSERT INTO public.work_orders VALUES ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
INSERT INTO public.component_events (id, event_type, event_date, description, component_table, cost_cents, work_order_id) VALUES
 ('40000000-0000-0000-0000-000000000001', 'installed', '2025-01-24', 'Bracket fitted', 'parts', 12050, '30000000-0000-0000-0000-000000000001');
INSERT INTO public.work_order_line_items (component_event_id, line_number, task_type, task_description, hours_labor, parts_cost_cents, total_cost_cents, status) VALUES
 ('40000000-0000-0000-0000-000000000001', 1, 'install', 'Fit bracket', 2, 12050, 42050, 'done');

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO anon, authenticated;

-- 1. Anonymous reader: the day with its money masked, nothing else lost.
SET ROLE anon;
DO $$
DECLARE d jsonb; w jsonb;
BEGIN
  d := public.get_daily_work_receipt('10000000-0000-0000-0000-000000000001', '2025-01-24');
  PERFORM public.t_assert(d->'money_masked' = 'true'::jsonb, 'anon: money_masked');
  PERFORM public.t_assert(d->'work_session'->'total_parts_cost' = 'null'::jsonb AND d->'work_session'->'total_labor_cost' = 'null'::jsonb
    AND d->'work_session'->'total_job_cost' = 'null'::jsonb, format('anon: session costs null; got %s', d->'work_session'));
  PERFORM public.t_assert(d->'work_session'->>'title' = 'Engine bay' AND (d->'work_session'->>'duration_minutes')::int = 240
    AND (d->'work_session'->>'image_count')::int = 1, 'anon: the session itself stays');
  PERFORM public.t_assert(d->'parts_total' = 'null'::jsonb AND (d->>'parts_count')::int = 1, 'anon: parts total masked, parts count kept');
  PERFORM public.t_assert(d->'receipts'->0->'total' = 'null'::jsonb AND d->'receipts'->0->'total_amount' = 'null'::jsonb
    AND d->'receipts'->0->>'vendor_name' = 'Summit Racing', 'anon: receipt totals masked, vendor kept');
  PERFORM public.t_assert(d->'receipts'->0->'items'->0->'unit_price' = 'null'::jsonb AND d->'receipts'->0->'items'->0->'total' = 'null'::jsonb
    AND d->'receipts'->0->'items'->0->>'name' = 'Alternator bracket' AND (d->'receipts'->0->'items'->0->>'quantity')::int = 1,
    format('anon: line prices masked at depth, names and quantities kept; got %s', d->'receipts'->0->'items'));
  PERFORM public.t_assert(d->'component_events'->0->'cost_cents' = 'null'::jsonb AND d->'component_events'->0->>'description' = 'Bracket fitted', 'anon: event cost masked');
  PERFORM public.t_assert(d->'line_items'->0->'parts_cost_cents' = 'null'::jsonb AND d->'line_items'->0->'total_cost_cents' = 'null'::jsonb
    AND (d->'line_items'->0->>'hours_labor')::numeric = 2, 'anon: line item costs masked, hours kept');
  PERFORM public.t_assert((d->>'photo_count')::int = 1 AND d->'summary'->'has_parts' = 'true'::jsonb AND d->'vehicle'->>'make' = 'Chevrolet',
    'anon: photos, flags and identity unchanged');

  w := public.get_vehicle_work_dates('10000000-0000-0000-0000-000000000001', '2025-01-01', '2025-12-31');
  PERFORM public.t_assert(w->'money_masked' = 'true'::jsonb AND w->'total_parts_spend' = 'null'::jsonb, format('anon: calendar spend masked; got %s', w));
  PERFORM public.t_assert(w->'sessions'->0->'total_parts_cost' = 'null'::jsonb AND w->'sessions'->0->'has_receipts' = 'true'::jsonb
    AND (w->>'total_sessions')::int = 1 AND (w->>'total_photos')::int = 1, 'anon: calendar sessions masked, counts and flags kept');

  PERFORM public.t_assert(public.get_daily_work_receipt('10000000-0000-0000-0000-000000000004', '2026-01-01') IS NULL, 'anon: a private vehicle reads as NULL');
  PERFORM public.t_assert(public.get_vehicle_work_dates('10000000-0000-0000-0000-000000000004', '2026-01-01', '2026-01-31') IS NULL, 'anon: a private calendar reads as NULL');
  PERFORM public.t_assert(public.get_daily_work_receipt('10000000-0000-0000-0000-000000000099', '2026-01-01')->>'error' = 'Vehicle not found', 'anon: unknown vehicle keeps its error');
END $$;
RESET ROLE;

-- 2. Signed-in readers.
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-000000000001';
DO $$
DECLARE d jsonb; w jsonb;
BEGIN
  d := public.get_daily_work_receipt('10000000-0000-0000-0000-000000000001', '2025-01-24');
  PERFORM public.t_assert(d->'money_masked' = 'false'::jsonb AND (d->'work_session'->>'total_parts_cost')::numeric = 120.50
    AND (d->>'parts_total')::numeric = 120.50 AND (d->'receipts'->0->>'total')::numeric = 120.50
    AND (d->'receipts'->0->'items'->0->>'unit_price')::numeric = 120.50 AND (d->'component_events'->0->>'cost_cents')::int = 12050,
    'owner: money present');
  w := public.get_vehicle_work_dates('10000000-0000-0000-0000-000000000001', '2025-01-01', '2025-12-31');
  PERFORM public.t_assert(w->'money_masked' = 'false'::jsonb AND (w->>'total_parts_spend')::numeric = 120.50
    AND (w->'sessions'->0->>'total_parts_cost')::numeric = 120.50, 'owner: calendar money present');
END $$;
SET test.auth_uid = '20000000-0000-0000-0000-000000000002';
SELECT public.t_assert(public.get_daily_work_receipt('10000000-0000-0000-0000-000000000001', '2025-01-24')->'money_masked' = 'false'::jsonb, 'uploader sees money');
SET test.auth_uid = '20000000-0000-0000-0000-000000000006';
SELECT public.t_assert(public.get_daily_work_receipt('10000000-0000-0000-0000-000000000001', '2025-01-24')->'money_masked' = 'false'::jsonb, 'contributor sees money');
SET test.auth_uid = '20000000-0000-0000-0000-000000000009';
SELECT public.t_assert(public.get_daily_work_receipt('10000000-0000-0000-0000-000000000001', '2025-01-24')->'money_masked' = 'true'::jsonb, 'a stranger is masked');
SELECT public.t_assert(public.get_daily_work_receipt('10000000-0000-0000-0000-000000000004', '2026-01-01') IS NULL, 'a stranger cannot read a private day');
SET test.auth_uid = '20000000-0000-0000-0000-000000000004';
SELECT public.t_assert((public.get_daily_work_receipt('10000000-0000-0000-0000-000000000004', '2026-01-01')->'work_session'->>'total_job_cost')::numeric = 30, 'a private vehicle reads for its user, with money');
RESET ROLE;

-- 3. The masker alone.
SELECT public.t_assert(public.jsonb_mask_money('{"a": {"total": 5, "n": 2, "items": [{"price": 1, "name": "x"}]}, "labor_rate": 95, "photo_count": 3}'::jsonb)
  = '{"a": {"total": null, "n": 2, "items": [{"price": null, "name": "x"}]}, "labor_rate": null, "photo_count": 3}'::jsonb, 'masker nulls money at every depth and keeps the rest');
SELECT public.t_assert(public.jsonb_mask_money('[]'::jsonb) = '[]'::jsonb AND public.jsonb_mask_money('{}'::jsonb) = '{}'::jsonb AND public.jsonb_mask_money('null'::jsonb) = 'null'::jsonb, 'masker on empty values');
SELECT 'day receipt money mask contract: PASS' AS result;
