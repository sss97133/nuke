\set ON_ERROR_STOP on
-- Reuse the established intake, delegation and expense contract fixtures.
\ir test_accounting_vehicle_costs.sql
CREATE TABLE public.work_orders(id uuid PRIMARY KEY,vehicle_id uuid);
CREATE TABLE public.receipts(id uuid PRIMARY KEY,vehicle_id uuid,scope_type text,scope_id uuid,is_active boolean,is_superseded boolean,duplicate_of uuid,user_id uuid);
CREATE TABLE public.receipt_items(id uuid PRIMARY KEY,receipt_id uuid REFERENCES public.receipts(id));
CREATE TABLE public.work_sessions(id uuid PRIMARY KEY,vehicle_id uuid);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY,vehicle_id uuid,is_sensitive boolean,is_superseded boolean);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY,vehicle_id uuid,is_superseded boolean);
-- Existing production prerequisite from 20261028161800_financial_revenue_evidence_gate.sql.
CREATE FUNCTION public.financial_try_date(p text) RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN IF p !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN NULL; END IF; RETURN p::date;
EXCEPTION WHEN others THEN RETURN NULL; END $$;
CREATE FUNCTION pg_temp.record(k text,amount text,kind text,section text,local_id text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('record_kind',kind,'source_key',k,'source_sha256',repeat('a',64),'source_row',1,
 'local_id',local_id,'year','2024','date','2024-06-01','account','Synthetic account','currency','USD','currency_basis','Synthetic USD',
 'amount',amount,'section',section,'category','Synthetic category','description','Synthetic item','decision','Synthetic retained attribution',
 'status','synthetic','source_reference','synthetic','bank_links','[]'::jsonb,
 'recognition_status',CASE WHEN kind='retained_bank_movement' THEN 'not_applicable' ELSE 'retained_decision' END,
 'payment_status','unresolved','vehicle_status','unresolved','reimbursement_status','unresolved','entity_status','retained_scope_unallocated') $$;
CREATE FUNCTION pg_temp.original(i integer) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('sha256',md5(i::text)||md5(i::text),'storage_path','11111111-1111-4111-8111-111111111111/fixture-'||i||'.txt',
 'source_filename','fixture-'||i||'.txt','source_kind','upload','byte_size',64) $$;
CREATE FUNCTION pg_temp.field(k text,v jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('field_key',k,'value_raw','Synthetic attributed use','value_type','text','value_normalized',v,
 'evidence',jsonb_build_object('source','Synthetic retained invoice and bank reference')) $$;
CREATE FUNCTION pg_temp.revision(k text,fields jsonb,records jsonb,prior uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object('idempotency_key',k,'method','synthetic-use-test','version','1',
 'fields',fields,'accounting_records',records,'supersedes_run_id',prior)) $$;

INSERT INTO public.vehicles(id,owner_id) VALUES
 ('aaaaaaaa-0000-4000-8000-00000000000a','11111111-1111-4111-8111-111111111111'),
 ('aaaaaaaa-0000-4000-8000-00000000000b','11111111-1111-4111-8111-111111111111');
INSERT INTO public.work_orders VALUES('bbbbbbbb-0000-4000-8000-00000000000a','aaaaaaaa-0000-4000-8000-00000000000a');
SELECT set_config('request.jwt.claim.role','service_role',false);
-- A pre-existing expense remains readable before and after the bounded projection.
SELECT ingest_financial_evidence('11111111-1111-4111-8111-111111111111',pg_temp.original(901),
 pg_temp.revision('legacy',jsonb_build_array(pg_temp.field('expense_use_'||left(repeat('a',64),24),
 jsonb_build_object('source_key',repeat('a',64),'use_type','vehicle','vehicle_id','aaaaaaaa-0000-4000-8000-00000000000a',
 'allocated_amount','25.00','book_amount','25.00','currency','USD','basis','Synthetic existing expense'))),
 jsonb_build_array(pg_temp.record(repeat('a',64),'25.00','retained_ledger_decision','Expense','legacy'))));
\ir ../migrations/20261031080833_financial_vehicle_use_projection.sql
BEGIN;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
DO $$ BEGIN
 IF (SELECT sum(allocated_amount) FROM accounting_vehicle_costs('aaaaaaaa-0000-4000-8000-00000000000a'))<>25 THEN RAISE EXCEPTION 'bootstrap hid existing costs'; END IF;
END $$;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT backfill_financial_vehicle_uses('11111111-1111-4111-8111-111111111111',NULL,25);
DO $$ BEGIN IF (SELECT count(*) FROM financial_vehicle_uses)<>1 THEN RAISE EXCEPTION 'legacy use not projected'; END IF; END $$;

CREATE TEMP TABLE state(k text PRIMARY KEY,receipt jsonb);
INSERT INTO state SELECT 'bank',ingest_financial_evidence('11111111-1111-4111-8111-111111111111',pg_temp.original(902),
 pg_temp.revision('bank',jsonb_build_array(pg_temp.field('batch_scope','{}')),
 jsonb_build_array(pg_temp.record(repeat('b',64),'100.00','retained_bank_movement',NULL,'bank-1'))));
INSERT INTO state SELECT 'income',ingest_financial_evidence('11111111-1111-4111-8111-111111111111',pg_temp.original(903),
 pg_temp.revision('income',jsonb_build_array(pg_temp.field('financial_use_'||left(repeat('c',64),24),
 jsonb_build_object('source_key',repeat('c',64),'phase','customer_receipt','book_amount','100.01','currency','USD',
 'bank_document_id',(SELECT receipt->>'document_id' FROM state WHERE k='bank'),'bank_source_key',repeat('b',64),
 'bank_line_id',(SELECT id FROM financial_document_lines WHERE document_id=(SELECT (receipt->>'document_id')::uuid FROM state WHERE k='bank') AND attributes->'accounting_record'->>'source_key'=repeat('b',64) LIMIT 1),
 'allocations',jsonb_build_array(
 jsonb_build_object('vehicle_id','aaaaaaaa-0000-4000-8000-00000000000a','work_order_id','bbbbbbbb-0000-4000-8000-00000000000a','allocated_amount','60.00','invoice_reference','SYNTHETIC-A','basis','Retained invoice allocation A'),
 jsonb_build_object('vehicle_id','aaaaaaaa-0000-4000-8000-00000000000b','allocated_amount','30.00','invoice_reference','SYNTHETIC-B','basis','Retained invoice allocation B'))))),
 jsonb_build_array(pg_temp.record(repeat('c',64),'100.01','retained_ledger_decision','Revenue','income-1'))));

SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r record; BEGIN
 SELECT * INTO r FROM accounting_vehicle_financials('aaaaaaaa-0000-4000-8000-00000000000a') WHERE phase='customer_receipt';
 IF r.allocated_amount::numeric<>60 OR r.book_amount::numeric<>100.01 OR r.bank_amount::numeric<>100 OR r.bank_remainder::numeric<>10
   OR r.qualification<>'ready' OR r.record_source_key<>repeat('c',64) OR r.bank_source_key<>repeat('b',64)
   OR r.invoice_reference<>'SYNTHETIC-A' OR r.work_order_id IS NULL THEN RAISE EXCEPTION 'cash/source/vehicle allocations blended or lost: %',r; END IF;
 IF (SELECT sum(allocated_amount) FROM accounting_vehicle_costs('aaaaaaaa-0000-4000-8000-00000000000a'))<>25 THEN RAISE EXCEPTION 'customer money entered expense subtotal'; END IF;
 BEGIN PERFORM 1 FROM financial_vehicle_uses; RAISE EXCEPTION 'direct state read admitted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM 1 FROM accounting_vehicle_costs_unprojected('aaaaaaaa-0000-4000-8000-00000000000a'); RAISE EXCEPTION 'private compatibility path admitted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- Synthetic rows exist only in the disposable contract database.
INSERT INTO public.receipts(id,user_id,scope_type,is_active,is_superseded)
 VALUES('cccccccc-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','unknown',true,false);
INSERT INTO public.vehicle_images VALUES('cccccccc-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-00000000000a',false,false);
INSERT INTO public.vehicle_observations VALUES('cccccccc-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-00000000000a',false);
-- Separate relationship testimony references immutable monetary rows; no books are copied.
SELECT set_config('request.jwt.claim.role','service_role',true);
INSERT INTO state SELECT 'refund-source',ingest_financial_evidence('11111111-1111-4111-8111-111111111111',pg_temp.original(905),
 pg_temp.revision('refund-source',jsonb_build_array(pg_temp.field('batch_scope','{}')),jsonb_build_array(
 pg_temp.record(repeat('e',64),'-10.00','retained_bank_movement',NULL,'refund-bank'),
 pg_temp.record(repeat('f',64),'10.00','retained_ledger_decision','Expense','refund-book'))));
INSERT INTO state SELECT 'refund-use',ingest_financial_evidence('11111111-1111-4111-8111-111111111111',pg_temp.original(906),
 pg_temp.revision('refund-use',jsonb_build_array(pg_temp.field('financial_use_'||left(repeat('f',64),24),jsonb_build_object(
 'source_key',repeat('f',64),'phase','customer_refund','book_amount','10.00','currency','USD',
 'record_document_id',(SELECT receipt->>'document_id' FROM state WHERE k='refund-source'),
 'record_line_id',(SELECT id FROM financial_document_lines WHERE document_id=(SELECT (receipt->>'document_id')::uuid FROM state WHERE k='refund-source') AND attributes->'accounting_record'->>'source_key'=repeat('f',64) LIMIT 1),
 'bank_document_id',(SELECT receipt->>'document_id' FROM state WHERE k='refund-source'),'bank_source_key',repeat('e',64),
 'bank_line_id',(SELECT id FROM financial_document_lines WHERE document_id=(SELECT (receipt->>'document_id')::uuid FROM state WHERE k='refund-source') AND attributes->'accounting_record'->>'source_key'=repeat('e',64) LIMIT 1),
 'allocations',jsonb_build_array(jsonb_build_object('vehicle_id','aaaaaaaa-0000-4000-8000-00000000000a','allocated_amount','10.00','basis','Synthetic refund with separate source','witnesses',jsonb_build_array(
 jsonb_build_object('receipt_id','cccccccc-0000-4000-8000-000000000001','label','Unfiled original source'),
 jsonb_build_object('image_id','cccccccc-0000-4000-8000-000000000002','label','Cited work context'),
 jsonb_build_object('observation_id','cccccccc-0000-4000-8000-000000000003','label','Retained work record'))))))),NULL));
DO $$ BEGIN
 IF (SELECT count(*) FROM financial_document_lines WHERE document_id=(SELECT (receipt->>'document_id')::uuid FROM state WHERE k='refund-source'))<>2
   OR EXISTS(SELECT 1 FROM financial_document_lines WHERE document_id=(SELECT (receipt->>'document_id')::uuid FROM state WHERE k='refund-use')) THEN
   RAISE EXCEPTION 'relationship testimony copied or rewrote monetary source rows'; END IF;
 PERFORM project_financial_vehicle_uses((SELECT (receipt->>'document_id')::uuid FROM state WHERE k='refund-use'));
 PERFORM project_financial_vehicle_uses((SELECT (receipt->>'document_id')::uuid FROM state WHERE k='refund-use'));
 IF (SELECT count(*) FROM financial_vehicle_uses WHERE source_extraction_id IN
   (SELECT id FROM financial_document_extractions WHERE document_id=(SELECT (receipt->>'document_id')::uuid FROM state WHERE k='refund-use')))<>1 THEN
   RAISE EXCEPTION 'projection replay duplicated an allocation'; END IF;
END $$;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (SELECT count(*) FROM accounting_vehicle_financials('aaaaaaaa-0000-4000-8000-00000000000a') WHERE phase='customer_refund' AND jsonb_array_length(witnesses)=3)<>1 THEN RAISE EXCEPTION 'source witnesses multiplied or lost the allocation'; END IF;
 IF NOT EXISTS(SELECT 1 FROM accounting_vehicle_financials('aaaaaaaa-0000-4000-8000-00000000000a') WHERE phase='customer_refund' AND allocated_amount::numeric=10 AND bank_amount::numeric=-10 AND qualification='ready') THEN
   RAISE EXCEPTION 'refund was not a separately sourced cash phase'; END IF;
 IF (SELECT sum(allocated_amount) FROM accounting_vehicle_costs('aaaaaaaa-0000-4000-8000-00000000000a'))<>25 THEN RAISE EXCEPTION 'refund cash was counted as a new book expense'; END IF;
END $$;
RESET ROLE;

-- A moved photo must not remain available through its old vehicle citation.
UPDATE public.vehicle_images SET vehicle_id='aaaaaaaa-0000-4000-8000-00000000000b' WHERE id='cccccccc-0000-4000-8000-000000000002';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM accounting_vehicle_financials('aaaaaaaa-0000-4000-8000-00000000000a') r,
   jsonb_array_elements(r.witnesses) w WHERE w->>'kind'='image' AND w ? 'id') THEN
   RAISE EXCEPTION 'moved photo remained bound to this vehicle'; END IF;
END $$;
-- More allocations on another source cannot spend the same bank movement twice.
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$ BEGIN
 BEGIN
  PERFORM ingest_financial_evidence('11111111-1111-4111-8111-111111111111',pg_temp.original(904),
   pg_temp.revision('overlap',jsonb_build_array(pg_temp.field('financial_use_'||left(repeat('d',64),24),
   jsonb_build_object('source_key',repeat('d',64),'phase','customer_receipt','book_amount','20.00','currency','USD',
   'bank_document_id',(SELECT receipt->>'document_id' FROM state WHERE k='bank'),'bank_source_key',repeat('b',64),
   'bank_line_id',(SELECT id FROM financial_document_lines WHERE document_id=(SELECT (receipt->>'document_id')::uuid FROM state WHERE k='bank') AND attributes->'accounting_record'->>'source_key'=repeat('b',64) LIMIT 1),
   'allocations',jsonb_build_array(jsonb_build_object('vehicle_id','aaaaaaaa-0000-4000-8000-00000000000a','allocated_amount','20.00','basis','Overlapping claim'))))),
   jsonb_build_array(pg_temp.record(repeat('d',64),'20.00','retained_ledger_decision','Revenue','income-2'))));
  RAISE EXCEPTION 'duplicate bank spending admitted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%shared bank movement%' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM financial_documents WHERE content_sha256=md5('904')||md5('904')) THEN RAISE EXCEPTION 'failed intake left partial source state'; END IF;
END $$;

-- A changed bank witness with the same stable key invalidates the old cash measurement.
SELECT ingest_financial_evidence('11111111-1111-4111-8111-111111111111',pg_temp.original(902),
 pg_temp.revision('bank-correction',jsonb_build_array(pg_temp.field('batch_scope','{}')),
 jsonb_build_array(pg_temp.record(repeat('b',64),'110.00','retained_bank_movement',NULL,'bank-1')),
 (SELECT (receipt->>'extraction_run_id')::uuid FROM state WHERE k='bank')));
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM accounting_vehicle_financials('aaaaaaaa-0000-4000-8000-00000000000a') WHERE phase='customer_receipt' AND qualification='bank_source_revised') THEN RAISE EXCEPTION 'revised cash witness remained qualified'; END IF;
END $$;
RESET ROLE;
-- Empty complete vectors explicitly withdraw a use; a second independent vector
-- must supersede the first, even when it would stay under the monetary cap.
SELECT set_config('request.jwt.claim.role','service_role',true);
INSERT INTO state SELECT 'withdraw',ingest_financial_evidence('11111111-1111-4111-8111-111111111111',pg_temp.original(907),
 pg_temp.revision('withdraw',jsonb_build_array(pg_temp.field('financial_use_'||left(repeat('a',64),24),jsonb_build_object(
 'source_key',repeat('a',64),'phase','book_expense','book_amount','25.00','currency','USD',
 'record_document_id',(SELECT id FROM financial_documents WHERE content_sha256=md5('901')||md5('901')),
 'record_line_id',(SELECT id FROM financial_document_lines WHERE attributes->'accounting_record'->>'source_key'=repeat('a',64) LIMIT 1),
 'allocations','[]'::jsonb))),NULL));
SELECT set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM accounting_vehicle_costs('aaaaaaaa-0000-4000-8000-00000000000a')) THEN RAISE EXCEPTION 'withdrawal resurrected a legacy cost'; END IF; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$ BEGIN
 BEGIN
  PERFORM ingest_financial_evidence('11111111-1111-4111-8111-111111111111',pg_temp.original(908),
   pg_temp.revision('second-vector',jsonb_build_array(pg_temp.field('financial_use_'||left(repeat('a',64),24),jsonb_build_object(
   'source_key',repeat('a',64),'phase','book_expense','book_amount','25.00','currency','USD',
   'record_document_id',(SELECT id FROM financial_documents WHERE content_sha256=md5('901')||md5('901')),
   'record_line_id',(SELECT id FROM financial_document_lines WHERE attributes->'accounting_record'->>'source_key'=repeat('a',64) LIMIT 1),
   'allocations','[]'::jsonb))),NULL));
  RAISE EXCEPTION 'a second active vector was admitted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%supersede the current use statement%' THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SET LOCAL ROLE authenticated;
SELECT set_accounting_access('22222222-2222-4222-8222-222222222222','review');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM accounting_vehicle_financials('aaaaaaaa-0000-4000-8000-00000000000a')) THEN RAISE EXCEPTION 'book grant alone disclosed vehicle finance'; END IF; END $$;
RESET ROLE;
INSERT INTO public.vehicle_contributors VALUES('aaaaaaaa-0000-4000-8000-00000000000a','22222222-2222-4222-8222-222222222222');
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM accounting_vehicle_financials('aaaaaaaa-0000-4000-8000-00000000000a')) THEN RAISE EXCEPTION 'joint book and vehicle permission lost'; END IF; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SET LOCAL ROLE authenticated;
SELECT set_accounting_access('22222222-2222-4222-8222-222222222222','revoke');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM accounting_vehicle_financials('aaaaaaaa-0000-4000-8000-00000000000a')) THEN RAISE EXCEPTION 'revoked grant disclosed vehicle finance'; END IF; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM accounting_vehicle_financials('aaaaaaaa-0000-4000-8000-00000000000a')) THEN RAISE EXCEPTION 'unrelated viewer read private finance'; END IF; END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM accounting_vehicle_financials('aaaaaaaa-0000-4000-8000-00000000000a'); RAISE EXCEPTION 'anon executed private reader'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- The same retained expense and bank witness can support expense recognition and
-- refund cash as distinct phases, without consuming one phase's capacity twice.
SELECT set_config('request.jwt.claim.role','service_role',true),set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
INSERT INTO state SELECT 'expense-cash-witness',ingest_financial_evidence('11111111-1111-4111-8111-111111111111',pg_temp.original(909),
 pg_temp.revision('expense-cash-witness',jsonb_build_array(pg_temp.field('financial_use_'||left(repeat('f',64),24),jsonb_build_object(
 'source_key',repeat('f',64),'phase','book_expense','book_amount','10.00','currency','USD',
 'record_document_id',(SELECT receipt->>'document_id' FROM state WHERE k='refund-source'),
 'record_line_id',(SELECT id FROM financial_document_lines WHERE document_id=(SELECT (receipt->>'document_id')::uuid FROM state WHERE k='refund-source') AND attributes->'accounting_record'->>'source_key'=repeat('f',64) LIMIT 1),
 'bank_document_id',(SELECT receipt->>'document_id' FROM state WHERE k='refund-source'),'bank_source_key',repeat('e',64),
 'bank_line_id',(SELECT id FROM financial_document_lines WHERE document_id=(SELECT (receipt->>'document_id')::uuid FROM state WHERE k='refund-source') AND attributes->'accounting_record'->>'source_key'=repeat('e',64) LIMIT 1),
 'allocations',jsonb_build_array(jsonb_build_object('vehicle_id','aaaaaaaa-0000-4000-8000-00000000000a','allocated_amount','10.00','basis','Expense recognition with explicit bank witness'))))),NULL));
SELECT set_config('request.jwt.claim.role','authenticated',true);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM accounting_vehicle_financials('aaaaaaaa-0000-4000-8000-00000000000a') WHERE phase='book_expense' AND qualification='ready' AND bank_remainder::numeric=0) THEN
   RAISE EXCEPTION 'expense cash witness lost phase-specific conservation'; END IF;
 IF (SELECT sum(allocated_amount) FROM accounting_vehicle_costs('aaaaaaaa-0000-4000-8000-00000000000a'))<>10 THEN
   RAISE EXCEPTION 'expense and refund phases were combined'; END IF;
END $$;
DO $$ BEGIN RAISE NOTICE 'PASS financial vehicle uses: exact cash vs book amounts, mixed-vehicle conservation, source keys, stale witnesses, compatible costs and privacy'; END $$;
ROLLBACK;
