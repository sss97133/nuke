\set ON_ERROR_STOP on
\ir test_financial_accounting.sql
\ir ../migrations/20261023234000_accounting_recent_activity.sql
-- The first reading commits on its own (each contract runs in a fresh database) so the correction is observably newer.
BEGIN;
INSERT INTO auth.users(id) VALUES ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$ DECLARE
 u uuid:='11111111-1111-4111-8111-111111111111';
 o jsonb:=jsonb_build_object('sha256',repeat('e',64),'storage_path',u||'/batch.csv','byte_size',100);
 record jsonb:=jsonb_build_object('record_kind','retained_ledger_decision','source_key',repeat('f',64),'source_sha256',repeat('a',64),'source_row',1,'local_id','synthetic-ledger-1','year','2024','date','2024-01-01','account','synthetic','currency','USD','currency_basis','synthetic USD ledger','amount','25.00','section','Expense','bank_links','[]'::jsonb,'recognition_status','retained_decision','payment_status','unresolved','vehicle_status','unresolved','reimbursement_status','unresolved','entity_status','retained_scope_unallocated');
 r jsonb:='{"idempotency_key":"batch-one","method":"retained-test","version":"1","fields":[{"field_key":"batch","value_raw":"synthetic batch","evidence":{"stage":"retained"}}]}';
BEGIN
 PERFORM ingest_financial_evidence(u,o,r||jsonb_build_object('accounting_records',jsonb_build_array(record,
   record||jsonb_build_object('record_kind','retained_bank_movement','source_key',repeat('b',64),'local_id','synthetic-bank-1','recognition_status','not_applicable','section',NULL,'amount','-25.00'))));
END $$;
COMMIT;
BEGIN;
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$ DECLARE
 u uuid:='11111111-1111-4111-8111-111111111111';
 o jsonb:=jsonb_build_object('sha256',repeat('e',64),'storage_path',u||'/batch.csv','byte_size',100);
 first_run uuid; b jsonb; records jsonb;
BEGIN
 SELECT (attributes->'runs'->0->>'run_id')::uuid INTO first_run FROM financial_documents WHERE owner_id=u;
 SELECT jsonb_agg(CASE WHEN l.attributes->'accounting_record'->>'record_kind'='retained_bank_movement' THEN l.attributes->'accounting_record'||'{"section":"Expense","category":"Synthetic parts"}'::jsonb ELSE l.attributes->'accounting_record' END ORDER BY l.line_number)
   INTO records FROM financial_document_lines l WHERE l.owner_id=u AND l.attributes->>'extraction_run_id'=first_run::text;
 b:=ingest_financial_evidence(u,o,'{"idempotency_key":"batch-two","method":"synthetic-classification","version":"1","fields":[{"field_key":"batch","value_raw":"synthetic batch","evidence":{"stage":"retained"}}]}'::jsonb
   ||jsonb_build_object('supersedes_run_id',first_run,'accounting_records',records));
 IF (SELECT count(*) FROM accounting_recent_activity(u,20))<>2 THEN RAISE EXCEPTION 'expected both revisions'; END IF;
 IF NOT EXISTS(SELECT 1 FROM accounting_recent_activity(u,20) x WHERE x.run_id=(b->>'extraction_run_id')::uuid AND x.records_changed=1 AND NOT x.first_reading AND x.actor_user_id=u AND x.method='synthetic-classification') THEN RAISE EXCEPTION 'the correction must count only the one changed record'; END IF;
 IF NOT EXISTS(SELECT 1 FROM accounting_recent_activity(u,20) x WHERE x.run_id=first_run AND x.records_changed=2 AND x.first_reading AND x.method='retained-test') THEN RAISE EXCEPTION 'a first reading counts every record'; END IF;
 IF (SELECT array_agg(x.run_id ORDER BY x.recorded_at DESC) FROM accounting_recent_activity(u,20) x)<>ARRAY[(b->>'extraction_run_id')::uuid,first_run] THEN RAISE EXCEPTION 'newest first'; END IF;
 IF (SELECT array_agg(x.run_id) FROM accounting_recent_activity(u,1) x)<>ARRAY[(b->>'extraction_run_id')::uuid] THEN RAISE EXCEPTION 'limit keeps the newest'; END IF;
 IF (SELECT count(*) FROM accounting_recent_activity(u,0))<>1 OR (SELECT count(*) FROM accounting_recent_activity(u,NULL))<>2 THEN RAISE EXCEPTION 'limit bounds'; END IF;
 IF (SELECT count(*) FROM accounting_recent_activity('22222222-2222-4222-8222-222222222222',20))<>0 THEN RAISE EXCEPTION 'activity crossed books'; END IF;
END $$;
-- Security invoker: the row policies of the caller decide. The owner reads the activity; another account reads nothing.
GRANT SELECT ON financial_documents, financial_document_extractions, financial_document_lines TO authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF (SELECT count(*) FROM accounting_recent_activity('11111111-1111-4111-8111-111111111111',20))<>2 THEN RAISE EXCEPTION 'owner cannot read its activity'; END IF; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF (SELECT count(*) FROM accounting_recent_activity('11111111-1111-4111-8111-111111111111',20))<>0 THEN RAISE EXCEPTION 'an account without access read the activity'; END IF; END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM accounting_recent_activity('11111111-1111-4111-8111-111111111111',20); RAISE EXCEPTION 'anon executed the activity reader'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT prosecdef FROM pg_proc WHERE proname='accounting_recent_activity') THEN RAISE EXCEPTION 'the activity reader must run as the caller'; END IF;
 RAISE NOTICE 'PASS accounting recent activity: newest first, records changed against the superseded revision, caller-scoped';
END $$;
ROLLBACK;
