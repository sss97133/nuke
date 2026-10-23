\set ON_ERROR_STOP on
\ir test_financial_accounting.sql
\ir ../migrations/20261023235000_accounting_similar_classifications.sql
BEGIN;
INSERT INTO auth.users(id) VALUES ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$ DECLARE
 u uuid:='11111111-1111-4111-8111-111111111111';
 o jsonb:=jsonb_build_object('sha256',repeat('e',64),'storage_path',u||'/batch.csv','byte_size',100);
 base jsonb:=jsonb_build_object('record_kind','retained_bank_movement','source_sha256',repeat('a',64),'source_row',1,'year','2024','date','2024-01-01','account','Checking','currency','USD','currency_basis','synthetic USD row','amount','-10.00','bank_links','[]'::jsonb,'recognition_status','not_applicable','payment_status','unresolved','vehicle_status','unresolved','reimbursement_status','unresolved','entity_status','retained_scope_unallocated');
 r jsonb:='{"idempotency_key":"batch-one","method":"retained-test","version":"1","fields":[{"field_key":"batch","value_raw":"synthetic batch","evidence":{"stage":"retained"}}]}';
 a jsonb; rows jsonb;
BEGIN
 -- Key: digits, the PayPal type segment, a short channel prefix and separators go; the merchant text stays.
 IF accounting_description_key('VISA - 11/10 AMZN MKTP US*ST3RE92W3 AMZN.COM/BILL WA 0096')<>'amzn mktp us st re w amzn.com bill wa' THEN RAISE EXCEPTION 'key: card line %', accounting_description_key('VISA - 11/10 AMZN MKTP US*ST3RE92W3 AMZN.COM/BILL WA 0096'); END IF;
 IF accounting_description_key('SPIRIT AIRLINES ONBOAR | General PayPal Debit Card Transaction | ')<>'spirit airlines onboar' THEN RAISE EXCEPTION 'key: paypal line'; END IF;
 IF accounting_description_key('TST* CIPRIANI - LAS VEGAS')<>'tst cipriani - las vegas' THEN RAISE EXCEPTION 'key: a long merchant prefix stays'; END IF;
 IF accounting_description_key(NULL) IS NOT NULL OR accounting_description_key(' 0123 ') IS NOT NULL THEN RAISE EXCEPTION 'key: empty'; END IF;
 a:=ingest_financial_evidence(u,o,r||jsonb_build_object('accounting_records',jsonb_build_array(
   base||jsonb_build_object('source_key',repeat('1',64),'local_id','bank:1','description','VISA - 01/02 AMZN MKTP US*AAA111 AMZN.COM/BILL WA 0001','section','Expense','category','Parts'),
   base||jsonb_build_object('source_key',repeat('2',64),'local_id','bank:2','description','VISA - 03/04 AMZN MKTP US*BBB222 AMZN.COM/BILL WA 0002','section','Expense','category','Parts'),
   base||jsonb_build_object('source_key',repeat('3',64),'local_id','bank:3','description','VISA - 05/06 AMZN MKTP US*CCC333 AMZN.COM/BILL WA 0003','section','Owner','category','Personal'),
   base||jsonb_build_object('source_key',repeat('4',64),'local_id','bank:4','description','VISA - 07/08 SHELL OIL 57444 BOULDER CITY NV','section','Expense','category','Fuel'),
   base||jsonb_build_object('source_key',repeat('5',64),'local_id','bank:5','description','VISA - 09/10 AMZN MKTP US*DDD444 AMZN.COM/BILL WA 0004','section',NULL,'category',''))));
 rows:=(SELECT jsonb_agg(to_jsonb(x)) FROM accounting_similar_classifications(u,'VISA - 09/10 AMZN MKTP US*DDD444 AMZN.COM/BILL WA 0004',repeat('5',64)) x);
 IF rows->0->>'section'<>'Expense' OR rows->0->>'category'<>'Parts' OR (rows->0->>'records')::int<>2 THEN RAISE EXCEPTION 'most similar classification first: %', rows; END IF;
 IF NOT rows @> '[{"section":"Owner","category":"Personal","records":1}]' THEN RAISE EXCEPTION 'every similar classification is shown: %', rows; END IF;
 IF rows @> '[{"category":"Fuel"}]' THEN RAISE EXCEPTION 'a dissimilar merchant counted: %', rows; END IF;
 -- Unclassified records and the excluded record never count; nothing comes from another book or a too-short key.
 IF (SELECT count(*) FROM accounting_similar_classifications(u,'0123 4567')) <> 0 THEN RAISE EXCEPTION 'too short a key'; END IF;
 IF (SELECT count(*) FROM accounting_similar_classifications('22222222-2222-4222-8222-222222222222','VISA - 09/10 AMZN MKTP US*DDD444')) <> 0 THEN RAISE EXCEPTION 'crossed books'; END IF;
 -- After a correction only the current revision counts: reclassify record 3 and its old reading disappears.
 PERFORM ingest_financial_evidence(u,o,r||jsonb_build_object('idempotency_key','batch-two','supersedes_run_id',a->>'extraction_run_id','accounting_records',jsonb_build_array(
   base||jsonb_build_object('source_key',repeat('1',64),'local_id','bank:1','description','VISA - 01/02 AMZN MKTP US*AAA111 AMZN.COM/BILL WA 0001','section','Expense','category','Parts'),
   base||jsonb_build_object('source_key',repeat('2',64),'local_id','bank:2','description','VISA - 03/04 AMZN MKTP US*BBB222 AMZN.COM/BILL WA 0002','section','Expense','category','Parts'),
   base||jsonb_build_object('source_key',repeat('3',64),'local_id','bank:3','description','VISA - 05/06 AMZN MKTP US*CCC333 AMZN.COM/BILL WA 0003','section','Expense','category','Parts'),
   base||jsonb_build_object('source_key',repeat('4',64),'local_id','bank:4','description','VISA - 07/08 SHELL OIL 57444 BOULDER CITY NV','section','Expense','category','Fuel'),
   base||jsonb_build_object('source_key',repeat('5',64),'local_id','bank:5','description','VISA - 09/10 AMZN MKTP US*DDD444 AMZN.COM/BILL WA 0004','section',NULL,'category',''))));
 rows:=(SELECT jsonb_agg(to_jsonb(x)) FROM accounting_similar_classifications(u,'VISA - 09/10 AMZN MKTP US*DDD444 AMZN.COM/BILL WA 0004') x);
 IF jsonb_array_length(rows)<>1 OR (rows->0->>'records')::int<>3 OR rows->0->>'category'<>'Parts' THEN RAISE EXCEPTION 'superseded readings must not count: %', rows; END IF;
END $$;
-- Security invoker: another account reads nothing; anon cannot execute.
GRANT SELECT ON financial_documents, financial_document_extractions, financial_document_lines TO authenticated;
ALTER TABLE financial_document_lines ENABLE ROW LEVEL SECURITY;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF (SELECT count(*) FROM accounting_similar_classifications('11111111-1111-4111-8111-111111111111','VISA - 09/10 AMZN MKTP US*DDD444'))<>0 THEN RAISE EXCEPTION 'an account without access read classifications'; END IF; END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM accounting_similar_classifications('11111111-1111-4111-8111-111111111111','VISA AMZN'); RAISE EXCEPTION 'anon executed the reader'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT prosecdef FROM pg_proc WHERE proname='accounting_similar_classifications') THEN RAISE EXCEPTION 'must run as the caller'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='idx_fline_accounting_description_trgm') THEN RAISE EXCEPTION 'trigram index missing'; END IF;
 RAISE NOTICE 'PASS accounting similar classifications: key normalization, most similar first, current revision only, caller-scoped';
END $$;
ROLLBACK;
