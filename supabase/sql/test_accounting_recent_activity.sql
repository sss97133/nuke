\set ON_ERROR_STOP on
\ir test_financial_accounting.sql
\ir ../migrations/20261023234000_accounting_recent_activity.sql
-- Preserve the previous reader as an independent payload comparison, then apply the
-- replacement twice: CREATE OR REPLACE must retain the caller's grants and semantics.
DO $$ BEGIN
 EXECUTE replace(pg_get_functiondef('public.accounting_recent_activity(uuid,integer)'::regprocedure),
                 'public.accounting_recent_activity(', 'pg_temp.accounting_recent_activity_preimage(');
END $$;
\ir ../migrations/20261025070103_accounting_recent_activity_bounded_reads.sql
\ir ../migrations/20261025070103_accounting_recent_activity_bounded_reads.sql
-- Reproduce the production owner and hoisted delegate policies in the disposable
-- fixture. The migration under test changes none of these policies or grants.
ALTER TABLE auth.users ADD COLUMN email_confirmed_at timestamptz DEFAULT now();
CREATE TABLE accounting_access_grants(owner_id uuid, member_id uuid, active boolean NOT NULL DEFAULT true);
ALTER TABLE financial_document_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY financial_document_lines_owner_select ON financial_document_lines FOR SELECT USING (auth.uid()=owner_id);
CREATE POLICY financial_documents_delegate_read ON financial_documents FOR SELECT TO authenticated USING (false);
CREATE POLICY financial_lines_delegate_read ON financial_document_lines FOR SELECT TO authenticated USING (false);
CREATE POLICY financial_extractions_delegate_read ON financial_document_extractions FOR SELECT TO authenticated USING (false);
CREATE POLICY financial_concerns_delegate_read ON financial_review_queue FOR SELECT TO authenticated USING (false);
\ir ../migrations/20261023220500_accounting_delegate_read_hoisted.sql
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
 IF EXISTS ((SELECT * FROM accounting_recent_activity(u,20) EXCEPT ALL SELECT * FROM pg_temp.accounting_recent_activity_preimage(u,20))
            UNION ALL (SELECT * FROM pg_temp.accounting_recent_activity_preimage(u,20) EXCEPT ALL SELECT * FROM accounting_recent_activity(u,20))) THEN
   RAISE EXCEPTION 'optimized activity changed the prior payload';
 END IF;
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
-- The granted reviewer sees the same revisions; revocation is effective on the next
-- call. This is an ordinary invoker call, not service-role proof of visibility.
INSERT INTO accounting_access_grants VALUES('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF (SELECT count(*) FROM accounting_recent_activity('11111111-1111-4111-8111-111111111111',20))<>2 THEN RAISE EXCEPTION 'granted reviewer cannot read shared activity'; END IF; END $$;
RESET ROLE;
UPDATE accounting_access_grants SET active=false;
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM accounting_recent_activity('11111111-1111-4111-8111-111111111111',20)) THEN RAISE EXCEPTION 'revoked reviewer retained shared activity'; END IF; END $$;
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

-- A retained history comparable to the shared book: 1,000 sources, five revisions,
-- 13 extraction cells and records per revision. All values below are synthetic.
-- Exercise the ordinary invoker with the existing 15-second API ceiling; a tiny
-- fixture alone cannot expose repeated scans across a growing revision history.
BEGIN;
SELECT set_config('request.jwt.claim.role','service_role',true);
INSERT INTO auth.users(id) VALUES ('33333333-3333-4333-8333-333333333333'),('44444444-4444-4444-8444-444444444444');
CREATE TEMP TABLE activity_scale_runs AS
SELECT d, r, md5('activity-document-'||d)::uuid AS document_id,
       md5('activity-run-'||d||'-'||r)::uuid AS run_id,
       CASE WHEN r>1 THEN md5('activity-run-'||d||'-'||(r-1))::uuid END AS prior_run_id
FROM generate_series(1,1000) d CROSS JOIN generate_series(1,5) r;
INSERT INTO financial_documents(id,owner_id,source_filename,attributes)
SELECT document_id,'33333333-3333-4333-8333-333333333333','synthetic-'||d||'.csv',
       jsonb_build_object('intake_mode','financial_evidence_v1','runs',
         jsonb_agg(jsonb_build_object('run_id',run_id,'supersedes_run_id',prior_run_id,
           'actor_user_id','33333333-3333-4333-8333-333333333333') ORDER BY r))
FROM activity_scale_runs GROUP BY document_id,d;
INSERT INTO financial_document_extractions(owner_id,document_id,extraction_run_id,field_key,value_raw,extractor,created_at)
SELECT '33333333-3333-4333-8333-333333333333',document_id,run_id,'synthetic-'||n,'synthetic value','synthetic-method',
       '2026-01-01Z'::timestamptz+(d*5+r)*interval '1 second'+n*interval '1 millisecond'
FROM activity_scale_runs CROSS JOIN generate_series(1,13) n;
INSERT INTO financial_document_lines(owner_id,document_id,line_number,attributes)
SELECT '33333333-3333-4333-8333-333333333333',document_id,(r-1)*13+n,
       jsonb_build_object('extraction_run_id',run_id,'accounting_record',
         jsonb_build_object('synthetic_row',n,'amount',CASE WHEN r=5 AND n=1 THEN 2 ELSE 1 END))
FROM activity_scale_runs CROSS JOIN generate_series(1,13) n;
-- Mirror the existing production access indexes; no new index is part of the repair.
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
DO $$ DECLARE u uuid:='33333333-3333-4333-8333-333333333333'; BEGIN
 IF (SELECT count(*) FROM accounting_recent_activity(u,20))<>20 THEN RAISE EXCEPTION 'scaled owner history lost revisions'; END IF;
 IF (SELECT count(*) FROM accounting_recent_activity(u,101))<>100 THEN RAISE EXCEPTION 'scaled upper limit escaped its bound'; END IF;
 IF EXISTS ((SELECT * FROM accounting_recent_activity(u,20) EXCEPT ALL SELECT * FROM pg_temp.accounting_recent_activity_preimage(u,20))
            UNION ALL (SELECT * FROM pg_temp.accounting_recent_activity_preimage(u,20) EXCEPT ALL SELECT * FROM accounting_recent_activity(u,20))) THEN
   RAISE EXCEPTION 'scaled ordinary caller payload changed';
 END IF;
END $$;
RESET ROLE;
INSERT INTO accounting_access_grants VALUES('33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444',true);
SELECT set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (SELECT count(*) FROM accounting_recent_activity('33333333-3333-4333-8333-333333333333',20))<>20 THEN RAISE EXCEPTION 'scaled shared history lost revisions'; END IF;
 RAISE NOTICE 'PASS scaled ordinary owner and delegate activity, upper limit and preimage payload';
END $$;
RESET ROLE;
ROLLBACK;
