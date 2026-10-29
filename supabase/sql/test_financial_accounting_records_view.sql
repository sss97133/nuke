\set ON_ERROR_STOP on
\ir test_financial_accounting.sql
\ir ../migrations/20261023200300_financial_accounting_records_view.sql
\ir ../migrations/20261023201000_financial_accounting_records_view_grants.sql
\ir ../migrations/20261023233000_financial_accounting_categories_view.sql
CREATE TEMP TABLE records_view_properties AS
SELECT relowner,relacl,reloptions FROM pg_class WHERE oid='public.v_financial_accounting_records'::regclass;
-- Keep an independent copy of the original definition for bidirectional parity.
DO $$ BEGIN
 EXECUTE 'CREATE TEMP VIEW accounting_records_preimage WITH (security_invoker=true) AS '
   || pg_get_viewdef('public.v_financial_accounting_records'::regclass,true);
END $$;
\ir ../migrations/20261025083500_accounting_records_bounded_reads.sql
\ir ../migrations/20261025083500_accounting_records_bounded_reads.sql
DO $$ BEGIN
 IF EXISTS(SELECT * FROM records_view_properties EXCEPT SELECT relowner,relacl,reloptions
   FROM pg_class WHERE oid='public.v_financial_accounting_records'::regclass)
 THEN RAISE EXCEPTION 'view owner, grants or invoker options changed'; END IF;
END $$;
ALTER TABLE auth.users ADD COLUMN email_confirmed_at timestamptz DEFAULT now();
CREATE TABLE accounting_access_grants(owner_id uuid, member_id uuid, active boolean NOT NULL DEFAULT true);
ALTER TABLE financial_document_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY financial_document_lines_owner_select ON financial_document_lines FOR SELECT USING (auth.uid()=owner_id);
CREATE POLICY financial_documents_delegate_read ON financial_documents FOR SELECT TO authenticated USING (false);
CREATE POLICY financial_lines_delegate_read ON financial_document_lines FOR SELECT TO authenticated USING (false);
CREATE POLICY financial_extractions_delegate_read ON financial_document_extractions FOR SELECT TO authenticated USING (false);
CREATE POLICY financial_concerns_delegate_read ON financial_review_queue FOR SELECT TO authenticated USING (false);
\ir ../migrations/20261023220500_accounting_delegate_read_hoisted.sql
BEGIN;
INSERT INTO auth.users(id) VALUES ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$ DECLARE
 u uuid:='11111111-1111-4111-8111-111111111111';
 o jsonb:=jsonb_build_object('sha256',repeat('e',64),'storage_path',u||'/batch.csv','byte_size',100);
 record jsonb:=jsonb_build_object('record_kind','retained_ledger_decision','source_key',repeat('f',64),'source_sha256',repeat('a',64),'source_row',1,'local_id','synthetic-ledger-1','year','2024','date','2024-01-01','account','synthetic','currency','USD','currency_basis','synthetic USD ledger','amount','25.00','section','Expense','bank_links','[]'::jsonb,'recognition_status','retained_decision','payment_status','unresolved','vehicle_status','unresolved','reimbursement_status','unresolved','entity_status','retained_scope_unallocated');
 movement jsonb;
 r jsonb:='{"idempotency_key":"batch-one","method":"retained-test","version":"1","fields":[{"field_key":"batch","value_raw":"synthetic batch","evidence":{"stage":"retained"}}]}';
 a jsonb; b jsonb; workpapers jsonb; view_rows bigint; all_lines bigint; superseded_visible bigint;
BEGIN
 movement:=record||jsonb_build_object('record_kind','retained_bank_movement','source_key',repeat('b',64),'local_id','synthetic-bank-1','recognition_status','not_applicable','section',NULL,'amount','-25.00','description','SYNTHETIC CARD PURCHASE');
 a:=ingest_financial_evidence(u,o,r||jsonb_build_object('accounting_records',jsonb_build_array(record,movement)));
 -- A reviewer classifies the movement in a full revision; the first run stays retained but superseded.
 b:=ingest_financial_evidence(u,o,r||jsonb_build_object('idempotency_key','batch-two','supersedes_run_id',a->>'extraction_run_id','accounting_records',jsonb_build_array(record,movement||jsonb_build_object('section','Expense','category','Synthetic parts'))));
 workpapers:=read_financial_tax_workpapers(u,NULL,500);
 SELECT count(*) INTO view_rows FROM v_financial_accounting_records WHERE owner_id=u;
 IF view_rows<>2 OR view_rows<>(workpapers->>'total_rows')::bigint THEN RAISE EXCEPTION 'view rows % differ from workpaper total %', view_rows, workpapers->>'total_rows'; END IF;
 SELECT count(*) INTO all_lines FROM financial_document_lines WHERE owner_id=u AND attributes ? 'accounting_record';
 IF all_lines<>4 THEN RAISE EXCEPTION 'expected both runs retained in the table, found % lines', all_lines; END IF;
 -- Only the current run is visible; its columns carry the record fields and the retained record itself is unchanged.
 SELECT count(*) INTO superseded_visible FROM v_financial_accounting_records v
  WHERE EXISTS(SELECT 1 FROM financial_document_extractions e WHERE e.document_id=v.document_id AND e.extraction_run_id=v.extraction_run_id AND e.is_superseded);
 IF superseded_visible<>0 THEN RAISE EXCEPTION 'superseded run visible through the view'; END IF;
 IF NOT EXISTS(SELECT 1 FROM v_financial_accounting_records v WHERE v.owner_id=u AND v.record_kind='retained_bank_movement' AND v.local_id='synthetic-bank-1' AND v.year='2024' AND v.record_date='2024-01-01' AND v.account='synthetic' AND v.section='Expense' AND v.category='Synthetic parts' AND v.amount='-25.00' AND v.amount_value=-25.00 AND v.currency='USD' AND v.description='SYNTHETIC CARD PURCHASE' AND v.source_key=repeat('b',64) AND v.extraction_run_id=(b->>'extraction_run_id')::uuid
   AND v.record=(SELECT l.attributes->'accounting_record' FROM financial_document_lines l WHERE l.id=v.id)) THEN RAISE EXCEPTION 'record columns do not match the current retained record'; END IF;
 IF EXISTS(SELECT 1 FROM v_financial_accounting_records v WHERE v.owner_id=u AND v.section IS NULL) THEN RAISE EXCEPTION 'the superseded unclassified reading leaked into the view'; END IF;
 -- The other account sees nothing of this book through the view.
 IF (SELECT count(*) FROM v_financial_accounting_records WHERE owner_id='22222222-2222-4222-8222-222222222222')<>0 THEN RAISE EXCEPTION 'view crossed books'; END IF;
 -- Read-only and caller-scoped: no write rule, security_invoker on, no anon grant.
 IF EXISTS(SELECT 1 FROM pg_rewrite WHERE ev_class='public.v_financial_accounting_records'::regclass AND rulename<>'_RETURN') THEN RAISE EXCEPTION 'view carries a write rule'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='v_financial_accounting_records' AND c.reloptions @> ARRAY['security_invoker=true']) THEN RAISE EXCEPTION 'view must run as the caller'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='v_financial_accounting_records' AND grantee IN ('anon','PUBLIC')) THEN RAISE EXCEPTION 'anon must not read the books'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='v_financial_accounting_records' AND grantee IN ('authenticated','service_role') AND privilege_type<>'SELECT') THEN RAISE EXCEPTION 'readers hold a write privilege on the view'; END IF;
 -- Categories in use: one row per classified section/category of the current run, counted; the superseded unclassified
 -- reading and other books never appear; read-only and caller-scoped like the records view.
 IF (SELECT count(*) FROM v_financial_accounting_categories WHERE owner_id=u)<>2
   OR NOT EXISTS(SELECT 1 FROM v_financial_accounting_categories WHERE owner_id=u AND section='Expense' AND category='Synthetic parts' AND records=1)
   OR NOT EXISTS(SELECT 1 FROM v_financial_accounting_categories WHERE owner_id=u AND section='Expense' AND category='' AND records=1)
   OR EXISTS(SELECT 1 FROM v_financial_accounting_categories WHERE section IS NULL)
   OR (SELECT coalesce(sum(records),0) FROM v_financial_accounting_categories WHERE owner_id=u)<>(SELECT count(*) FROM v_financial_accounting_records WHERE owner_id=u AND section IS NOT NULL)
 THEN RAISE EXCEPTION 'categories view does not match the classified current records'; END IF;
 -- The ledger decision of the fixture carries no category: it counts under an empty category, never NULL.
 IF EXISTS(SELECT 1 FROM v_financial_accounting_categories WHERE category IS NULL) THEN RAISE EXCEPTION 'category must be text'; END IF;
 IF (SELECT count(*) FROM v_financial_accounting_categories WHERE owner_id='22222222-2222-4222-8222-222222222222')<>0 THEN RAISE EXCEPTION 'categories crossed books'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='v_financial_accounting_categories' AND c.reloptions @> ARRAY['security_invoker=true']) THEN RAISE EXCEPTION 'categories view must run as the caller'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='v_financial_accounting_categories' AND (grantee IN ('anon','PUBLIC') OR (grantee IN ('authenticated','service_role') AND privilege_type<>'SELECT'))) THEN RAISE EXCEPTION 'categories view grants must be select-only for readers'; END IF;
 RAISE NOTICE 'PASS current accounting records view: current run only, record columns, book isolation, read-only, caller-scoped';
 RAISE NOTICE 'PASS accounting categories view: classified pairs counted from current records, isolated, select-only';
END $$;
-- Duplicate cells must not multiply records. Noncanonical UUID strings remain
-- excluded, and a run with both superseded and current cells remains current.
INSERT INTO financial_document_extractions(owner_id,document_id,extraction_run_id,field_key,value_raw)
SELECT owner_id,document_id,extraction_run_id,'parity-extra','synthetic'
FROM v_financial_accounting_records LIMIT 1;
INSERT INTO financial_document_lines(owner_id,document_id,line_number,attributes)
SELECT owner_id,document_id,9999,jsonb_build_object('intake_mode','financial_evidence_v1',
  'extraction_run_id',upper(extraction_run_id::text),'accounting_record',record)
FROM v_financial_accounting_records WHERE extraction_run_id::text ~ '[a-f]' LIMIT 1;
INSERT INTO financial_document_lines(owner_id,document_id,line_number,attributes)
SELECT owner_id,document_id,10000,jsonb_build_object('intake_mode','financial_evidence_v1',
  'extraction_run_id','not-a-uuid','accounting_record',record)
FROM v_financial_accounting_records LIMIT 1;
INSERT INTO financial_document_extractions(owner_id,document_id,extraction_run_id,field_key,value_raw,is_superseded)
SELECT owner_id,document_id,extraction_run_id,'parity-superseded-cell','synthetic',true
FROM v_financial_accounting_records LIMIT 1;
GRANT SELECT ON financial_documents,financial_document_extractions,financial_document_lines,accounting_records_preimage TO authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (SELECT count(*) FROM v_financial_accounting_records)<>2 THEN RAISE EXCEPTION 'owner lost current rows or duplicated cells'; END IF;
 IF EXISTS ((SELECT * FROM v_financial_accounting_records EXCEPT ALL SELECT * FROM accounting_records_preimage)
   UNION ALL (SELECT * FROM accounting_records_preimage EXCEPT ALL SELECT * FROM v_financial_accounting_records)) THEN
   RAISE EXCEPTION 'ordinary owner payload changed'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM v_financial_accounting_records) THEN RAISE EXCEPTION 'nonmember saw a book'; END IF; END $$;
RESET ROLE;
INSERT INTO accounting_access_grants VALUES('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (SELECT count(*) FROM v_financial_accounting_records)<>2 THEN RAISE EXCEPTION 'delegate lost current rows'; END IF;
 IF EXISTS ((SELECT * FROM v_financial_accounting_records EXCEPT ALL SELECT * FROM accounting_records_preimage)
   UNION ALL (SELECT * FROM accounting_records_preimage EXCEPT ALL SELECT * FROM v_financial_accounting_records)) THEN
   RAISE EXCEPTION 'delegate payload changed'; END IF;
END $$;
RESET ROLE;
UPDATE accounting_access_grants SET active=false;
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM v_financial_accounting_records) THEN RAISE EXCEPTION 'revoked delegate saw a book'; END IF; END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM 1 FROM v_financial_accounting_records LIMIT 1; RAISE EXCEPTION 'anon read books';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;

-- History plus a large retained batch: 70,000 lines and 67,000 extraction
-- fields. The old per-line correlated lookup especially revisited batch fields.
-- Synthetic fixtures exercise the same owner/delegate RLS as ordinary API reads.
BEGIN;
SELECT set_config('request.jwt.claim.role','service_role',true);
INSERT INTO auth.users(id) VALUES ('33333333-3333-4333-8333-333333333333'),('44444444-4444-4444-8444-444444444444');
CREATE TEMP TABLE records_scale_runs AS
SELECT d,r,md5('records-document-'||d)::uuid AS document_id,
       md5('records-run-'||d||'-'||r)::uuid AS run_id,
       r=5 AS current_run,13 AS line_count,13 AS field_count
FROM generate_series(1,1000) d CROSS JOIN generate_series(1,5) r
UNION ALL
SELECT 1001,r,md5('records-batch')::uuid,md5('records-batch-'||r)::uuid,r=2,2500,1000
FROM generate_series(1,2) r;
INSERT INTO financial_documents(id,owner_id,source_filename,attributes)
SELECT document_id,'33333333-3333-4333-8333-333333333333','synthetic-'||d||'.csv',
       '{"intake_mode":"financial_evidence_v1"}'::jsonb
FROM records_scale_runs GROUP BY document_id,d;
INSERT INTO financial_document_extractions(owner_id,document_id,extraction_run_id,field_key,value_raw,is_superseded)
SELECT '33333333-3333-4333-8333-333333333333',document_id,run_id,'synthetic-'||n,'synthetic value',NOT current_run
FROM records_scale_runs CROSS JOIN LATERAL generate_series(1,field_count) n;
INSERT INTO financial_document_lines(owner_id,document_id,line_number,attributes)
SELECT '33333333-3333-4333-8333-333333333333',document_id,(r-1)*line_count+n,
       jsonb_build_object('intake_mode','financial_evidence_v1','extraction_run_id',run_id,'accounting_record',
         jsonb_build_object('record_kind','retained_ledger_decision','local_id',d||'-'||r||'-'||n,
           'year','2025','date','2025-01-01','currency','USD','section','Expense','amount','25.00'))
FROM records_scale_runs CROSS JOIN LATERAL generate_series(1,line_count) n;
-- Mirror production's existing access indexes; this migration adds none.
CREATE INDEX ON financial_documents(owner_id);
CREATE INDEX ON financial_document_extractions(owner_id);
CREATE INDEX ON financial_document_extractions(document_id);
CREATE INDEX ON financial_document_extractions(extraction_run_id);
CREATE INDEX ON financial_document_lines(owner_id);
CREATE INDEX ON financial_document_lines(document_id);
ANALYZE financial_documents;
ANALYZE financial_document_extractions;
ANALYZE financial_document_lines;
GRANT SELECT ON financial_documents,financial_document_extractions,financial_document_lines TO authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
SET LOCAL ROLE authenticated;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF (SELECT count(*) FROM v_financial_accounting_records
     WHERE owner_id='33333333-3333-4333-8333-333333333333' AND year='2025'
       AND record_kind='retained_ledger_decision' AND section='Expense' AND currency='USD')<>15500
 THEN RAISE EXCEPTION 'scaled owner reader lost or multiplied current records'; END IF;
 IF (SELECT count(*) FROM (SELECT id,document_id,record FROM v_financial_accounting_records
     WHERE owner_id='33333333-3333-4333-8333-333333333333' AND year='2025'
       AND record_kind='retained_ledger_decision' AND section='Expense' AND currency='USD'
     ORDER BY record_date DESC NULLS LAST,id LIMIT 100 OFFSET 100) page)<>100
 THEN RAISE EXCEPTION 'scaled filtered second page failed'; END IF;
END $$;
RESET ROLE;
INSERT INTO accounting_access_grants VALUES('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444',true);
SELECT set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (SELECT count(*) FROM v_financial_accounting_records WHERE owner_id='33333333-3333-4333-8333-333333333333')<>15500
 THEN RAISE EXCEPTION 'scaled delegated reader lost current records'; END IF;
 IF (SELECT sum(records) FROM v_financial_accounting_categories WHERE owner_id='33333333-3333-4333-8333-333333333333')<>15500
 THEN RAISE EXCEPTION 'dependent categories lost current records'; END IF;
 RAISE NOTICE 'PASS scaled current records: owner, delegate, filters, ordered second page and dependent categories';
END $$;
RESET ROLE;
ROLLBACK;
