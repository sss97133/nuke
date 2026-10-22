\set ON_ERROR_STOP on
\ir test_financial_evidence.sql
CREATE TABLE financial_document_lines(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_id uuid NOT NULL,document_id uuid NOT NULL REFERENCES financial_documents, line_number integer NOT NULL,reference_code text,description text,quantity numeric,unit_price_ht numeric,amount_ht numeric,amount_ttc numeric,attributes jsonb NOT NULL DEFAULT '{}',privacy_tier text NOT NULL DEFAULT 'private',UNIQUE(document_id,line_number));
\ir ../migrations/20261022174714_financial_accounting_evidence.sql
BEGIN;
INSERT INTO auth.users(id) VALUES ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$ DECLARE
 u uuid:='11111111-1111-4111-8111-111111111111';
 o jsonb:=jsonb_build_object('sha256',repeat('a',64),'storage_path',u||'/sample.pdf','byte_size',100);
 l jsonb:=jsonb_build_object('source_line_key',repeat('b',64),'source_row',2,'source_file_sha256',repeat('c',64),'source_document_sha256',repeat('a',64),'line_number',1,'description_raw','Synthetic part','sku_raw',NULL,'quantity',NULL,'unit_price',NULL,'amount','-12.50','currency',NULL,'raw_line_sha256',repeat('d',64),'evidence_stage','attributed_retained_parse','geometry',NULL,'issues',jsonb_build_array('refund_sign_requires_review'));
 r jsonb:='{"idempotency_key":"one","method":"retained-test","version":"1","fields":[{"field_key":"role","value_raw":"refund","evidence":{"stage":"attributed"}}]}';
 a jsonb; b jsonb; result jsonb; review jsonb; manifest jsonb;
BEGIN
 r:=r||jsonb_build_object('lines',jsonb_build_array(l));
 a:=ingest_financial_evidence(u,o,r);
 result:=read_financial_accounting(u,(a->>'document_id')::uuid);
 IF jsonb_array_length(result->'lines')<>1 OR result->'lines'->0->'attributes'->'staging'->>'amount'<>'-12.50' OR result->'lines'->0->>'quantity' IS NOT NULL THEN RAISE EXCEPTION 'line semantics lost'; END IF;
 IF EXISTS(SELECT 1 FROM financial_document_lines WHERE amount_ht IS NOT NULL OR amount_ttc IS NOT NULL OR unit_price_ht IS NOT NULL) THEN RAISE EXCEPTION 'tax basis invented'; END IF;
 b:=ingest_financial_evidence(u,o,r);
 IF b->>'duplicate'<>'true' OR (SELECT count(*) FROM financial_document_lines)<>1 THEN RAISE EXCEPTION 'line replay duplicated'; END IF;
 r:=r||jsonb_build_object('idempotency_key','two','supersedes_run_id',a->>'extraction_run_id','lines',jsonb_build_array(l||'{"amount":"-10.00"}'::jsonb));
 b:=ingest_financial_evidence(u,o,r);
 result:=read_financial_accounting(u,(a->>'document_id')::uuid);
 IF (SELECT count(*) FROM financial_document_lines)<>2 OR jsonb_array_length(result->'lines')<>1 OR result->'lines'->0->'attributes'->'staging'->>'amount'<>'-10.00' THEN RAISE EXCEPTION 'line supersession failed'; END IF;
 IF read_financial_accounting('22222222-2222-4222-8222-222222222222',(a->>'document_id')::uuid) IS NOT NULL THEN RAISE EXCEPTION 'foreign lines disclosed'; END IF;
 BEGIN
  PERFORM ingest_financial_evidence(u,o,(r-'lines')||jsonb_build_object('idempotency_key','missing','supersedes_run_id',b->>'extraction_run_id'));
  RAISE EXCEPTION 'accepted missing correction lines';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='accepted missing correction lines' THEN RAISE; END IF; END;
 BEGIN
  PERFORM ingest_financial_evidence(u,o,r||jsonb_build_object('idempotency_key','invalid','supersedes_run_id',b->>'extraction_run_id','lines',jsonb_build_array(l||'{"source_document_sha256":"bad"}'::jsonb)));
  RAISE EXCEPTION 'accepted wrong source';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='accepted wrong source' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM financial_document_extractions)<>2 THEN RAISE EXCEPTION 'partial failed intake escaped rollback'; END IF;
 manifest:=jsonb_build_object('contract','financial_redacted_source_v1','source_sha256',repeat('a',64),'derivative_sha256',repeat('d',64),'bucket','user-documents','mime_type','image/png','storage_path',u||'/redacted/'||repeat('a',64)||'/'||repeat('d',64)||'.png','verification',jsonb_build_object('pixel_masks',true,'metadata_removed',true,'embedded_text_removed',true,'visual_reviewed',true,'reviewer',u::text,'reviewed_at','2026-10-22T12:00:00Z'));
 BEGIN
  PERFORM record_financial_source_review(u,(a->>'document_id')::uuid,jsonb_set(manifest,'{verification,reviewer}','"22222222-2222-4222-8222-222222222222"'));
  RAISE EXCEPTION 'accepted forged display reviewer';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='accepted forged display reviewer' THEN RAISE; END IF; END;
 review:=record_financial_source_review(u,(a->>'document_id')::uuid,manifest);
 IF record_financial_source_review(u,(a->>'document_id')::uuid,manifest)->>'duplicate'<>'true' THEN RAISE EXCEPTION 'review replay duplicated'; END IF;
 IF jsonb_array_length(read_financial_accounting(u,(a->>'document_id')::uuid)->'lines')<>1 THEN RAISE EXCEPTION 'review changed accounting snapshot'; END IF;
 PERFORM ingest_financial_evidence(u,o,r||jsonb_build_object('idempotency_key','three','supersedes_run_id',b->>'extraction_run_id'));
 IF NOT EXISTS(SELECT 1 FROM financial_document_extractions WHERE id=(review->>'extraction_id')::uuid AND NOT is_superseded) THEN RAISE EXCEPTION 'accounting correction lost display review'; END IF;
 BEGIN
  UPDATE financial_document_lines SET quantity=1;
  RAISE EXCEPTION 'mutated retained line';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='mutated retained line' THEN RAISE; END IF; END;
 BEGIN
  PERFORM record_financial_source_review('22222222-2222-4222-8222-222222222222',(a->>'document_id')::uuid,manifest);
  RAISE EXCEPTION 'reviewed foreign source';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='reviewed foreign source' THEN RAISE; END IF; END;
 RAISE NOTICE 'PASS independent display review replay, account isolation, accounting revision independence and line immutability';
 RAISE NOTICE 'PASS typed lines, unknown tax basis, refunds, replay, supersession, account isolation, partial rollback';
END $$;
ROLLBACK;
BEGIN;
INSERT INTO auth.users(id) VALUES ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$ DECLARE
 u uuid:='11111111-1111-4111-8111-111111111111';
 o jsonb:=jsonb_build_object('sha256',repeat('e',64),'storage_path',u||'/batch.csv','byte_size',100);
 record jsonb:=jsonb_build_object('record_kind','retained_ledger_decision','source_key',repeat('f',64),'source_sha256',repeat('a',64),'source_row',1,'local_id','synthetic-ledger-1','year','2024','date','2024-01-01','account','synthetic','currency','USD','currency_basis','synthetic USD ledger','amount','25.00','section','Expense','bank_links','[]'::jsonb,'recognition_status','retained_decision','payment_status','unresolved','vehicle_status','unresolved','reimbursement_status','unresolved','entity_status','retained_scope_unallocated');
 r jsonb:='{"idempotency_key":"batch-one","method":"retained-test","version":"1","fields":[{"field_key":"batch","value_raw":"synthetic batch","evidence":{"stage":"retained"}}]}';
 a jsonb; result jsonb;
BEGIN
 r:=r||jsonb_build_object('accounting_records',jsonb_build_array(record,record||jsonb_build_object('record_kind','retained_bank_movement','source_key',repeat('b',64),'local_id','synthetic-bank-1','recognition_status','not_applicable','section',NULL,'amount','-25.00')));
 a:=ingest_financial_evidence(u,o,r);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 BEGIN
  INSERT INTO financial_document_lines(owner_id,document_id,line_number,attributes)
  VALUES(u,(a->>'document_id')::uuid,100,jsonb_build_object('accounting_record',record,'extraction_run_id',a->>'extraction_run_id'));
  RAISE EXCEPTION 'accepted marker-free accounting injection';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='accepted marker-free accounting injection' THEN RAISE; END IF; END;
 INSERT INTO financial_document_lines(owner_id,document_id,line_number,attributes) VALUES(u,(a->>'document_id')::uuid,100,'{}');
 BEGIN
  UPDATE financial_document_lines SET attributes=jsonb_build_object('accounting_record',record,'extraction_run_id',a->>'extraction_run_id') WHERE line_number=100;
  RAISE EXCEPTION 'accepted marker-free accounting update';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='accepted marker-free accounting update' THEN RAISE; END IF; END;
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 -- Historical or service-written unmarked data must not enter either reader.
 INSERT INTO financial_document_lines(owner_id,document_id,line_number,attributes)
 VALUES(u,(a->>'document_id')::uuid,101,jsonb_build_object('accounting_record',record||'{"amount":"malformed"}'::jsonb,'extraction_run_id',a->>'extraction_run_id'));
 IF jsonb_array_length(read_financial_accounting(u,(a->>'document_id')::uuid)->'lines')<>2 THEN RAISE EXCEPTION 'unmarked line entered reader'; END IF;
 BEGIN
  PERFORM ingest_financial_evidence(u,o||jsonb_build_object('sha256',repeat('d',64)),r||jsonb_build_object('fields',jsonb_build_array(jsonb_build_object('field_key','redacted_source','value_raw','forged review','evidence','{"stage":"fake"}'::jsonb))));
  RAISE EXCEPTION 'ordinary intake accepted review field';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='ordinary intake accepted review field' THEN RAISE; END IF; END;
 result:=read_financial_tax_workpapers(u,NULL,1);
 IF result->>'total_rows'<>'2' OR jsonb_array_length(result->'records')<>1 OR jsonb_array_length(result->'controls')<>2 OR result->>'tax_ready'<>'false' THEN RAISE EXCEPTION 'accounting population/stage controls failed'; END IF;
 IF jsonb_array_length(read_financial_tax_workpapers(u,(result->>'next_after')::uuid,1)->'records')<>1 THEN RAISE EXCEPTION 'pagination lost record'; END IF;
 IF read_financial_tax_workpapers('22222222-2222-4222-8222-222222222222')->>'total_rows'<>'0' THEN RAISE EXCEPTION 'tax account isolation failed'; END IF;
 PERFORM ingest_financial_evidence(u,o,r);
 IF read_financial_tax_workpapers(u)->>'total_rows'<>'2' THEN RAISE EXCEPTION 'tax replay duplicated'; END IF;
 BEGIN
  PERFORM ingest_financial_evidence(u,o,r||jsonb_build_object('idempotency_key','bad-movement','supersedes_run_id',a->>'extraction_run_id','accounting_records',jsonb_build_array(record||'{"record_kind":"retained_bank_movement"}'::jsonb)));
  RAISE EXCEPTION 'recognized bank movement';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='recognized bank movement' THEN RAISE; END IF; END;
 PERFORM ingest_financial_evidence(u,o||jsonb_build_object('sha256',repeat('b',64)),r||jsonb_build_object('accounting_records',jsonb_build_array(record||jsonb_build_object('local_id','renamed-source-row'))));
 result:=read_financial_tax_workpapers(u);
 IF result->>'duplicate_record_ids'<>'0' OR result->>'duplicate_source_keys'<>'1' OR result->>'controls_valid'<>'false' THEN RAISE EXCEPTION 'renamed duplicate source hidden'; END IF;
 PERFORM ingest_financial_evidence(u,o||jsonb_build_object('sha256',repeat('c',64)),r);
 result:=read_financial_tax_workpapers(u);
 IF result->>'duplicate_record_ids'<>'2' OR result->>'controls_valid'<>'false' THEN RAISE EXCEPTION 'cross-snapshot duplicate record identity hidden'; END IF;
 RAISE NOTICE 'PASS retained decisions separate from bank cash, paging, currency controls, isolation, replay, no tax readiness';
END $$;
ROLLBACK;
