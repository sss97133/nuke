-- land_document_pages: service role only, bounded envelope, privacy guard, idempotent on the first page, one savepoint per
-- document; the timeline leg counts linked receipts on their page date; the day reader masks money and payer for a
-- viewer not tied to the vehicle. The fold itself (receipt_link_one, receipt_vehicle_links_refresh) is live code with
-- its own contracts; here a stand-in links each receipt on its document date so the readers can be exercised.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_receipt_document_pages%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_receipt_document_pages* database';
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
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, vehicle_id uuid, taken_at timestamptz, is_duplicate boolean);
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

\ir ../migrations/20261109110000_receipt_document_pages.sql

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

-- A two-page work order with a dated labor line, and an undated slip.
CREATE TEMP TABLE payload AS SELECT jsonb_build_object(
  'storage_base', 'https://abcdefghijklmnopqrst.supabase.co', 'method', 'binder_document_transcription_v1', 'model', 'claude-opus-5-5',
  'documents', jsonb_build_array(
    jsonb_build_object('source_key', 'binder:IMG_0001', 'doc_type', 'work_order',
      'vendor', jsonb_build_object('name', 'Atomic Motors', 'address', '1 Shop St, Las Vegas NV', 'phone', null),
      'doc_number', '9810', 'doc_date', '2024-10-07', 'bill_to_name', 'Sam Builder', 'vehicle_noted', '1970 Pontiac 455',
      'pages', jsonb_build_array(
        jsonb_build_object('sha256', repeat('a', 64), 'storage_path', '0b9f107a-0000-4000-8000-000000000001/financial/' || repeat('a', 64) || '.heic', 'byte_size', '1234567', 'page_no', '1', 'role', 'page', 'source_filename', 'IMG_0001.heic'),
        jsonb_build_object('sha256', repeat('b', 64), 'storage_path', '0b9f107a-0000-4000-8000-000000000001/financial/' || repeat('b', 64) || '.heic', 'byte_size', '1234568', 'page_no', '2', 'role', 'continuation', 'source_filename', 'IMG_0002.heic')),
      'lines', jsonb_build_array(
        jsonb_build_object('description', 'Bore cylinders .060', 'line_date', '2024-11-13', 'performer', 'Frank', 'hours', '2.75'),
        jsonb_build_object('description', 'Piston set', 'part_number', 'KB-455', 'quantity', '1', 'unit_price', '650.00', 'amount', '650.00')),
      'subtotal', '650.00', 'tax', '54.76', 'total', '2190.00', 'payment', jsonb_build_object('method', 'Visa'), 'confidence', 0.9,
      'vehicle_context', 'shot in the car''s capture set; billed to the lot''s builder'),
    jsonb_build_object('source_key', 'binder:IMG_0003', 'doc_type', 'packing_slip',
      'vendor', jsonb_build_object('name', 'Andersen Restorations'), 'doc_date', null,
      'pages', jsonb_build_array(jsonb_build_object('sha256', repeat('c', 64), 'storage_path', '0b9f107a-0000-4000-8000-000000000001/financial/' || repeat('c', 64) || '.heic', 'byte_size', '99', 'page_no', '1')),
      'lines', jsonb_build_array(jsonb_build_object('description', 'Front coil springs (pr)'))))) AS j;

-- 1. Admission: anon and an account are refused; the custodian must be tied to the vehicle.
SELECT set_config('test.role', 'anon', false), set_config('test.uid', '', false);
SELECT pg_temp.expect_error($$SELECT public.land_document_pages('0b9f107a-0000-4000-8000-000000000001', '20d21fb0-0000-4000-8000-000000000001', 'run-1', (SELECT j FROM payload))$$, 'service admission', 'anon refused');
SELECT set_config('test.role', 'service_role', false);
SELECT pg_temp.expect_error($$SELECT public.land_document_pages('0b9f107a-0000-4000-8000-000000000002', '20d21fb0-0000-4000-8000-000000000001', 'run-1', (SELECT j FROM payload))$$, 'not tied', 'untied custodian refused');

-- 2. Privacy guard: card numbers and e-mail addresses never enter; sha256 names do not trip it.
SELECT pg_temp.expect_error($$SELECT public.land_document_pages('0b9f107a-0000-4000-8000-000000000001', '20d21fb0-0000-4000-8000-000000000001', 'run-1',
  jsonb_set((SELECT j FROM payload), '{documents,0,notes}', '"card 4111 1111 1111 1111"'))$$, 'card numbers', 'card number refused');
SELECT pg_temp.expect_error($$SELECT public.land_document_pages('0b9f107a-0000-4000-8000-000000000001', '20d21fb0-0000-4000-8000-000000000001', 'run-1',
  jsonb_set((SELECT j FROM payload), '{documents,0,notes}', '"mail sam@example.com"'))$$, 'card numbers', 'e-mail refused');

-- 3. Landing: two documents, rows in every table, lines keep their own clock, payer stays as named.
CREATE TEMP TABLE r1 AS SELECT public.land_document_pages('0b9f107a-0000-4000-8000-000000000001', '20d21fb0-0000-4000-8000-000000000001', 'run-1', (SELECT j FROM payload)) AS r;
SELECT pg_temp.assert_true((SELECT (r->>'landed')::int = 2 AND (r->>'errors')::int = 0 AND (r->>'duplicates')::int = 0 FROM r1), 'two documents landed');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM public.vehicle_documents WHERE vehicle_id = '20d21fb0-0000-4000-8000-000000000001' AND privacy_level = 'private'), 'two private vehicle_documents');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM public.receipts WHERE source_document_table = 'vehicle_documents' AND ingest_kind = 'import' AND scope_type = 'vehicle'), 'two receipts cite their documents');
SELECT pg_temp.assert_true((SELECT card_holder = 'Sam Builder' AND raw_json #>> '{data_v2,payer_as_named}' = 'Sam Builder' AND receipt_date = '2024-10-07' AND total = 2190
   AND jsonb_array_length(raw_json #> '{document_pages,pages}') = 2 AND file_name = 'IMG_0001.heic' FROM public.receipts WHERE invoice_number = '9810'), 'work order fields as printed');
SELECT pg_temp.assert_true((SELECT count(*) = 3 FROM public.receipt_items), 'three lines');
SELECT pg_temp.assert_true((SELECT line_date = '2024-11-13' AND performer = 'Frank' AND hours = 2.75 AND total_price IS NULL FROM public.receipt_items WHERE description = 'Bore cylinders .060'), 'labor line keeps its date, performer and hours');
SELECT pg_temp.assert_true((SELECT total_price = 650 AND part_number = 'KB-455' FROM public.receipt_items WHERE description = 'Piston set'), 'part line keeps its amount');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.receipt_vehicle_links WHERE status = 'linked' AND retired_at IS NULL AND page_date = '2024-10-07'), 'dated document linked on its page date');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.receipt_vehicle_links WHERE status = 'held' AND retired_at IS NULL), 'undated slip held');
SELECT pg_temp.assert_true((SELECT r->'documents'->0->'link'->>'status' = 'linked' AND r->'documents'->1->'link'->>'status' = 'held' FROM r1), 'receipt reports each link');

-- 4. Idempotent: the same originals land once.
CREATE TEMP TABLE r2 AS SELECT public.land_document_pages('0b9f107a-0000-4000-8000-000000000001', '20d21fb0-0000-4000-8000-000000000001', 'run-2', (SELECT j FROM payload)) AS r;
SELECT pg_temp.assert_true((SELECT (r->>'landed')::int = 0 AND (r->>'duplicates')::int = 2 FROM r2), 'rerun reports duplicates');
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM public.receipts) AND (SELECT count(*) = 2 FROM public.vehicle_documents) AND (SELECT count(*) = 3 FROM public.receipt_items), 'no second copy');

-- 5. One bad document does not block the others (its own savepoint).
CREATE TEMP TABLE r3 AS SELECT public.land_document_pages('0b9f107a-0000-4000-8000-000000000001', '20d21fb0-0000-4000-8000-000000000001', 'run-3',
  jsonb_set(jsonb_set(jsonb_set((SELECT j FROM payload), '{documents,0,doc_type}', '"napkin"'),
            '{documents,1,pages,0,sha256}', to_jsonb(repeat('d', 64))),
            '{documents,1,pages,0,storage_path}', to_jsonb('0b9f107a-0000-4000-8000-000000000001/financial/' || repeat('d', 64) || '.heic'))) AS r;
SELECT pg_temp.assert_true((SELECT (r->>'errors')::int = 1 AND (r->>'duplicates')::int = 0 AND (r->>'landed')::int = 1 AND r->'documents'->0->>'error' LIKE 'invalid document%' FROM r3), 'bad document reported, good one lands');
SELECT pg_temp.assert_true((SELECT count(*) = 3 FROM public.receipts), 'three receipts after the partial run');

-- 6. The timeline leg: linked receipts on their page date, beside photos and work.
INSERT INTO public.vehicle_images(id, vehicle_id, taken_at) VALUES (gen_random_uuid(), '20d21fb0-0000-4000-8000-000000000001', '2024-10-07 18:00+00');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.get_vehicle_contribution_days('20d21fb0-0000-4000-8000-000000000001') WHERE kind = 'document' AND day = '2024-10-07' AND n = 1), 'document day on the timeline');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM public.get_vehicle_contribution_days('20d21fb0-0000-4000-8000-000000000001') WHERE kind = 'photo' AND day = '2024-10-07'), 'photo leg unchanged');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.get_vehicle_contribution_days('20d21fb0-0000-4000-8000-000000000001') WHERE kind = 'document' AND day IS NULL), 'held (undated) receipts stay off the bar');

-- 7. The day reader: public viewer sees the paper and its lines, never the money or the payer; the owner sees both.
SELECT set_config('test.role', 'anon', false), set_config('test.uid', '', false);
CREATE TEMP TABLE pub AS SELECT public.get_vehicle_day_documents('20d21fb0-0000-4000-8000-000000000001', '2024-10-07') AS j;
SELECT pg_temp.assert_true((SELECT (j->>'tied')::boolean = false AND jsonb_array_length(j->'documents') = 1 FROM pub), 'public viewer sees one document');
SELECT pg_temp.assert_true((SELECT d->>'vendor' = 'Atomic Motors' AND d->>'document_number' = '9810' AND (d->>'pages')::int = 2 AND jsonb_array_length(d->'lines') = 2
   AND d->'total' = 'null'::jsonb AND d->'subtotal' = 'null'::jsonb AND d->'payer_as_named' = 'null'::jsonb AND d->'vendor_address' = 'null'::jsonb AND d->'payment_method' = 'null'::jsonb
   AND d->'lines'->1->'amount' = 'null'::jsonb AND d->'lines'->1->'unit_price' = 'null'::jsonb
   AND d->'lines'->0->>'performer' = 'Frank' AND d->'lines'->0->>'line_date' = '2024-11-13' AND (d->'lines'->0->>'hours')::numeric = 2.75
   FROM pub, jsonb_array_elements(j->'documents') d), 'public: lines, performer and hours visible; money, payer, address and card masked');
SELECT set_config('test.role', 'authenticated', false), set_config('test.uid', '0b9f107a-0000-4000-8000-000000000001', false);
SELECT pg_temp.assert_true((SELECT (j->>'tied')::boolean AND (j->'documents'->0->>'total')::numeric = 2190 AND j->'documents'->0->>'payer_as_named' = 'Sam Builder'
   AND (j->'documents'->0->'lines'->1->>'amount')::numeric = 650 FROM public.get_vehicle_day_documents('20d21fb0-0000-4000-8000-000000000001', '2024-10-07') j), 'owner sees money and payer');
SELECT set_config('test.role', 'anon', false), set_config('test.uid', '', false);
SELECT pg_temp.assert_true((SELECT jsonb_array_length(j->'documents') = 0 FROM public.get_vehicle_day_documents('20d21fb0-0000-4000-8000-000000000001', '2024-10-08') j), 'other days empty');
INSERT INTO public.receipts(id, user_id, vehicle_id, scope_type, scope_id, receipt_date, vendor_name, total, raw_json) VALUES ('c0000000-0000-4000-8000-000000000001', '0b9f107a-0000-4000-8000-000000000001', '20d21fb0-0000-4000-8000-000000000002', 'vehicle', '20d21fb0-0000-4000-8000-000000000002', '2024-10-07', 'Private Vendor', 10, '{}');
INSERT INTO public.receipt_vehicle_links(receipt_id, vehicle_id, user_id, status, basis, basis_ref, confidence, page_date, run_id) VALUES ('c0000000-0000-4000-8000-000000000001', '20d21fb0-0000-4000-8000-000000000002', '0b9f107a-0000-4000-8000-000000000001', 'linked', 'cited_document', '{}', 0.9, '2024-10-07', 'test');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(j->'documents') = 0 AND (j->>'tied')::boolean = false FROM public.get_vehicle_day_documents('20d21fb0-0000-4000-8000-000000000002', '2024-10-07') j), 'a private vehicle shows nothing to the public');

-- 8. Grants: the writer is service-role only; the reader is public.
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.land_document_pages(uuid,uuid,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.land_document_pages(uuid,uuid,text,jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.land_document_pages(uuid,uuid,text,jsonb)', 'EXECUTE'), 'writer grants');
SELECT pg_temp.assert_true(has_function_privilege('anon', 'public.get_vehicle_day_documents(uuid,date)', 'EXECUTE'), 'reader grant');

-- 9. Revert restores the three-leg reader and drops the writer.
\ir revert_20261109110000_receipt_document_pages.sql
SELECT pg_temp.assert_true(to_regprocedure('public.land_document_pages(uuid,uuid,text,jsonb)') IS NULL, 'revert drops the writer');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM public.get_vehicle_contribution_days('20d21fb0-0000-4000-8000-000000000001') WHERE kind = 'document'), 'revert removes the document leg');
SELECT 'receipt document pages contract passed' AS result;
