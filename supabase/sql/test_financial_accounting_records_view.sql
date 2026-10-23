\set ON_ERROR_STOP on
\ir test_financial_accounting.sql
\ir ../migrations/20261023200000_financial_accounting_records_view.sql
\ir ../migrations/20261023201000_financial_accounting_records_view_grants.sql
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
 RAISE NOTICE 'PASS current accounting records view: current run only, record columns, book isolation, read-only, caller-scoped';
END $$;
ROLLBACK;
