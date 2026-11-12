-- Receipt money roles through actual land_document_pages. No raw image or observation testimony.
-- Schema/link stand-ins reused from test_receipt_document_pages; original monetary gate remains in force.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_receipt_payment_roles%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_receipt_payment_roles* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, deleted_at timestamptz, is_anonymous boolean DEFAULT false);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.role', true), '') $$;

CREATE TABLE public.vehicles(id uuid PRIMARY KEY, user_id uuid, owner_id uuid, uploaded_by uuid, is_public boolean, deleted_at timestamptz, merged_into_vehicle_id uuid);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, vehicle_id uuid, taken_at timestamptz, is_duplicate boolean, is_superseded boolean, apple_ml_labels text[]);
CREATE TABLE public.work_sessions(id uuid PRIMARY KEY, vehicle_id uuid, session_date date);
CREATE TABLE public.vehicle_timeline_events(id uuid PRIMARY KEY, vehicle_id uuid, event_date date);
CREATE TABLE public.vehicle_documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, uploaded_by uuid, document_type text, title text,
  description text, file_url text, file_type text, amount numeric, vendor_name text, currency text, privacy_level text CHECK (privacy_level IN ('private','organization','public')),
  created_at timestamptz DEFAULT now());
CREATE TABLE public.receipts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, created_by uuid, vehicle_id uuid, scope_type text, scope_id text,
  file_url text, file_name text, file_type text, upload_date timestamptz, processing_status text, status text, processed_at timestamptz,
  vendor_name text, vendor_address text, transaction_date date, receipt_date date, purchase_date date, occurred_at timestamptz,
  invoice_number text, subtotal numeric, tax numeric, tax_amount numeric, total numeric, total_amount numeric, currency text,
  payment_method text, card_holder text, confidence_score numeric, source_document_table text, source_document_id uuid,
  ingest_kind text CHECK (ingest_kind IN ('live','backfill','import')), raw_extraction jsonb, raw_json jsonb, document_kind text,
  is_superseded boolean DEFAULT false, duplicate_of uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.receipt_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid REFERENCES public.receipts(id) ON DELETE CASCADE,
  line_number int, description text, part_number text, category text, quantity numeric, unit_price numeric, total_price numeric, created_at timestamptz DEFAULT now());
CREATE TABLE public.receipt_vehicle_links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid, vehicle_id uuid, user_id uuid,
  status text CHECK (status IN ('linked','held')), basis text, basis_ref jsonb, confidence numeric, hold_reason text, tie_kind text, type_gate text,
  page_date date, page_date_source text, run_id text, created_at timestamptz DEFAULT now(), retired_at timestamptz);

-- Stand-ins for live helpers the migration calls.
CREATE FUNCTION public.receipt_user_vehicle_tie(p_user uuid, p_vehicle uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.vehicles WHERE id = p_vehicle AND (owner_id = p_user OR user_id = p_user OR uploaded_by = p_user)) THEN 'vehicles.owner_id' END $$;
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.receipt_link_one(p_receipt uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r public.receipts; l public.receipt_vehicle_links;
BEGIN
  SELECT * INTO r FROM public.receipts WHERE id = p_receipt;
  UPDATE public.receipt_vehicle_links SET retired_at = now() WHERE receipt_id = p_receipt AND retired_at IS NULL;
  INSERT INTO public.receipt_vehicle_links(receipt_id, vehicle_id, user_id, status, basis, basis_ref, confidence, hold_reason, tie_kind, type_gate, page_date, page_date_source, run_id)
  VALUES (p_receipt, CASE WHEN r.receipt_date IS NOT NULL THEN r.vehicle_id END, r.user_id,
          CASE WHEN r.receipt_date IS NOT NULL THEN 'linked' ELSE 'held' END,
          CASE WHEN r.receipt_date IS NOT NULL THEN 'cited_document' END, jsonb_build_object('table', r.source_document_table, 'id', r.source_document_id),
          0.9, CASE WHEN r.receipt_date IS NULL THEN 'no_identifier' END, 'vehicles.owner_id', 'unknown',
          r.receipt_date, 'receipt_date', 'test')
  RETURNING * INTO l;
  RETURN to_jsonb(l);
END $$;
CREATE FUNCTION public.jsonb_mask_money(j jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE jsonb_typeof(j)
    WHEN 'object' THEN coalesce((SELECT jsonb_object_agg(e.k, CASE WHEN e.k = ANY (ARRAY['total','total_amount','unit_price','price','amount','subtotal','tax','tax_amount','shipping','discount']) THEN 'null'::jsonb ELSE public.jsonb_mask_money(e.v) END) FROM jsonb_each(j) AS e(k, v)), '{}'::jsonb)
    WHEN 'array' THEN coalesce((SELECT jsonb_agg(public.jsonb_mask_money(a.e) ORDER BY a.o) FROM jsonb_array_elements(j) WITH ORDINALITY AS a(e, o)), '[]'::jsonb)
    ELSE j END $$;
CREATE FUNCTION public.jsonb_mask_keys(j jsonb, p_keys text[]) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE jsonb_typeof(j)
    WHEN 'object' THEN coalesce((SELECT jsonb_object_agg(e.k, CASE WHEN e.k = ANY (p_keys) THEN 'null'::jsonb ELSE public.jsonb_mask_keys(e.v, p_keys) END) FROM jsonb_each(j) AS e(k, v)), '{}'::jsonb)
    WHEN 'array' THEN coalesce((SELECT jsonb_agg(public.jsonb_mask_keys(a.e, p_keys) ORDER BY a.o) FROM jsonb_array_elements(j) WITH ORDINALITY AS a(e, o)), '[]'::jsonb)
    ELSE j END $$;

-- The supply register and organizations, as the second reading joins them (stand-ins; the resolver is live code).
CREATE FUNCTION public.supply_vendor_key(p_name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(btrim(regexp_replace(regexp_replace(lower(COALESCE(p_name, '')), '[^a-z0-9&'' ]+', ' ', 'g'), '\s+', ' ', 'g')), '') $$;
CREATE TABLE public.organizations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, logo_url text, website text, is_public boolean DEFAULT false, created_at timestamptz DEFAULT now());
CREATE TABLE public.supply_vendors(vendor_slug text PRIMARY KEY, business_name text NOT NULL, decision text NOT NULL, organization_id uuid REFERENCES public.organizations(id),
  domain text, supply_kinds text[] NOT NULL, basis text NOT NULL, reviewed_at date NOT NULL DEFAULT '2026-10-19');
CREATE TABLE public.supply_vendor_aliases(alias_key text PRIMARY KEY, vendor_slug text NOT NULL REFERENCES public.supply_vendors(vendor_slug));

\ir ../migrations/20261109110000_receipt_document_pages.sql
\ir ../migrations/20261111090000_day_documents_vendor_page_install.sql

CREATE FUNCTION pg_temp.assert_true(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'ok: %', label; END $$;
CREATE FUNCTION pg_temp.expect_error(sql text, needle text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE sql; RAISE EXCEPTION 'FAIL: % (no error)', label;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    IF position(needle in SQLERRM) = 0 THEN RAISE EXCEPTION 'FAIL: % (got: %)', label, SQLERRM; END IF;
  END;
  RAISE NOTICE 'ok: %', label;
END $$;

INSERT INTO auth.users(id) VALUES ('0b9f107a-0000-4000-8000-000000000001'), ('0b9f107a-0000-4000-8000-000000000002');
INSERT INTO public.vehicles(id, user_id, owner_id, uploaded_by, is_public) VALUES
  ('20d21fb0-0000-4000-8000-000000000001', '0b9f107a-0000-4000-8000-000000000001', '0b9f107a-0000-4000-8000-000000000001', '0b9f107a-0000-4000-8000-000000000001', true),
  ('20d21fb0-0000-4000-8000-000000000002', '0b9f107a-0000-4000-8000-000000000001', '0b9f107a-0000-4000-8000-000000000001', '0b9f107a-0000-4000-8000-000000000001', false);

CREATE FUNCTION pg_temp.land(p_number text,p_total numeric,p_payment jsonb,p_lines jsonb,
 p_vehicle uuid DEFAULT '20d21fb0-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE payload jsonb; result jsonb; sha text:=md5(p_number)||md5(p_number);
BEGIN
 payload:=jsonb_build_object('storage_base','https://abcdefghijklmnopqrst.supabase.co',
 'method','receipt_role_fixture','model','synthetic-test',
 'documents',jsonb_build_array(jsonb_build_object('source_key','fixture:'||p_number,
 'doc_type','work_order','doc_number',p_number,'doc_date','2025-04-02','vendor',jsonb_build_object('name','Fixture Vendor'),
 'bill_to_name','Fixture Payer','total',p_total,'lines',p_lines,
 'pages',jsonb_build_array(jsonb_build_object('sha256',sha,'storage_path',
 '0b9f107a-0000-4000-8000-000000000001/financial/'||sha||'.heic','byte_size',100,'page_no',1)))
 ||CASE WHEN p_payment IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('payment',p_payment) END));
 result:=public.land_document_pages('0b9f107a-0000-4000-8000-000000000001',p_vehicle,'roles-'||p_number,payload);
 RETURN result;
END $$;
SELECT set_config('test.role','service_role',false),set_config('test.uid','',false);
SELECT pg_temp.assert_true((pg_temp.land('invoice-and-card',125,'{"amount":130,"date":"2025-04-03","method":"Visa"}',
 '[{"description":"Technician valve work","hours":8,"line_date":"2025-04-01"},{"description":"Trainee valve work","hours":8,"line_date":"2025-04-01"},{"description":"Part","amount":50}]')->>'landed')::int=1,
 'writer retains one invoice with separate payment and concurrent hour entries');
SELECT pg_temp.assert_true((pg_temp.land('literal-zero',0,'{"amount":0}',
 '[{"description":"No-charge inspection","hours":0}]')->>'landed')::int=1,'writer retains explicit zero amounts and hours');
SELECT pg_temp.assert_true((pg_temp.land('date-only',NULL,'{"date":"2025-04-04"}','[]')->>'landed')::int=1,'writer retains payment date without amount');
SELECT pg_temp.assert_true((pg_temp.land('absent-payment',NULL,NULL,'[{"description":"Unpriced material"}]')->>'landed')::int=1,'writer retains absent payment and hours');
SELECT pg_temp.assert_true((pg_temp.land('null-fields',25,'{"amount":null,"date":null}',
 '[{"description":"Separate job","hours":2.75}]')->>'landed')::int=1,'writer retains explicit null payment fields');
SELECT pg_temp.assert_true((pg_temp.land('invalid-calendar-date',20,'{"amount":20,"date":"2025-02-30"}','[]')->>'landed')::int=1,
 'existing writer retains a literal impossible date for the reader to qualify');
SELECT pg_temp.assert_true((pg_temp.land('malformed-amount',20,'{"amount":"unreadable","date":"2025-04-03"}','[]')->>'errors')::int=1,
 'sanctioned writer refuses malformed monetary text instead of fabricating a number');
SELECT pg_temp.assert_true((pg_temp.land('malformed-date',20,'{"amount":20,"date":"April sometime"}','[]')->>'errors')::int=1,
 'sanctioned writer refuses malformed date text');
SELECT pg_temp.assert_true((pg_temp.land('private-receipt',75,'{"amount":80,"date":"2025-04-03"}',
 '[{"description":"Private work","hours":3}]','20d21fb0-0000-4000-8000-000000000002')->>'landed')::int=1,'private vehicle receipt enters through same writer');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT FROM public.vehicle_images),'no raw source images or observation rows are needed by this test');

\ir ../migrations/20261112100000_receipt_payment_and_recorded_hours.sql

SELECT set_config('test.role','authenticated',false),set_config('test.uid','0b9f107a-0000-4000-8000-000000000001',false);
CREATE TEMP TABLE tied AS SELECT public.get_vehicle_day_documents('20d21fb0-0000-4000-8000-000000000001','2025-04-02') j;
CREATE TEMP VIEW tied_docs AS SELECT d FROM tied,jsonb_array_elements(j->'documents') d;
SELECT pg_temp.assert_true((SELECT (j->>'tied')::boolean AND jsonb_array_length(j->'documents')=6 FROM tied),'owner sees six admitted documents, excluding malformed attempts');
SELECT pg_temp.assert_true((SELECT (d->>'total')::numeric=125 AND (d#>>'{recorded_payment,amount}')::numeric=130
 AND d#>>'{recorded_payment,date}'='2025-04-03' AND (d->>'recorded_hours')::numeric=16 AND (d->>'hour_entries')::int=2
 AND jsonb_array_length(d->'lines')=3 FROM tied_docs WHERE d->>'document_number'='invoice-and-card'),
 'invoice total and payment remain distinct; concurrent literal hours sum on this receipt only');
SELECT pg_temp.assert_true((SELECT (d#>>'{recorded_payment,amount}')::numeric=0 AND (d->>'total')::numeric=0
 AND (d->>'recorded_hours')::numeric=0 AND (d->>'hour_entries')::int=1 FROM tied_docs WHERE d->>'document_number'='literal-zero'),
 'explicit zero stays a recorded value, including a zero-hour entry');
SELECT pg_temp.assert_true((SELECT d#>'{recorded_payment,amount}'='null'::jsonb AND d#>>'{recorded_payment,date}'='2025-04-04'
 AND d->'recorded_hours'='null'::jsonb AND d->>'hour_entries'='0' FROM tied_docs WHERE d->>'document_number'='date-only'),
 'date-only payment does not create amount or labor hours');
SELECT pg_temp.assert_true((SELECT d->'recorded_payment'='null'::jsonb AND d->'recorded_hours'='null'::jsonb AND d->>'hour_entries'='0'
 FROM tied_docs WHERE d->>'document_number'='absent-payment'),'absent payment and unrecorded hours remain null');
SELECT pg_temp.assert_true((SELECT d->'recorded_payment'='null'::jsonb AND (d->>'recorded_hours')::numeric=2.75 AND d->>'hour_entries'='1'
 FROM tied_docs WHERE d->>'document_number'='null-fields'),'null fields stay absent and another receipt does not alter the first receipt hours');
SELECT pg_temp.assert_true((SELECT (d#>>'{recorded_payment,amount}')::numeric=20 AND d#>'{recorded_payment,date}'='null'::jsonb
 FROM tied_docs WHERE d->>'document_number'='invalid-calendar-date'),'invalid calendar day is not displayed as a payment date');

SELECT set_config('test.role','anon',false),set_config('test.uid','',false);
CREATE TEMP TABLE untied AS SELECT public.get_vehicle_day_documents('20d21fb0-0000-4000-8000-000000000001','2025-04-02') j;
SELECT pg_temp.assert_true((SELECT NOT (j->>'tied')::boolean AND jsonb_array_length(j->'documents')=6 FROM untied),'anonymous reader sees public document population');
SELECT pg_temp.assert_true(NOT EXISTS(SELECT FROM untied,jsonb_array_elements(j->'documents') d
 WHERE d->'recorded_payment'<>'null'::jsonb OR d->'total'<>'null'::jsonb OR d->'payer_as_named'<>'null'::jsonb
 OR d->'page'<>'null'::jsonb OR d->'page_paths'<>'null'::jsonb),'anonymous reader receives no payment amount/date, money, payer or private page');
SELECT pg_temp.assert_true((SELECT (d->>'recorded_hours')::numeric=16 AND d->>'hour_entries'='2'
 FROM untied,jsonb_array_elements(j->'documents') d WHERE d->>'document_number'='invoice-and-card'),'documented person-hours retain existing public line visibility');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(j->'documents')=0 FROM public.get_vehicle_day_documents('20d21fb0-0000-4000-8000-000000000002','2025-04-02') j),
 'private vehicle remains unavailable to anonymous reader');
SELECT set_config('test.role','authenticated',false),set_config('test.uid','0b9f107a-0000-4000-8000-000000000002',false);
SELECT pg_temp.assert_true((SELECT NOT (j->>'tied')::boolean AND NOT EXISTS(SELECT FROM jsonb_array_elements(j->'documents') d
 WHERE d->'recorded_payment'<>'null'::jsonb) FROM public.get_vehicle_day_documents('20d21fb0-0000-4000-8000-000000000001','2025-04-02') j),
 'signed-in untied viewer receives no payment');
SELECT pg_temp.assert_true(has_function_privilege('anon','public.get_vehicle_day_documents(uuid,date)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.land_document_pages(uuid,uuid,text,jsonb)','EXECUTE'),'existing reader/writer grants retained');
SELECT 'receipt payment roles and recorded hours PASS';

