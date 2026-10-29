\set ON_ERROR_STOP on
-- Disposable synthetic contract for the close-out readers. Every name, amount and key below is synthetic.
\ir test_financial_accounting.sql
-- The production owner and hoisted delegate policies, as in the recent-activity contract.
ALTER TABLE auth.users ADD COLUMN email_confirmed_at timestamptz DEFAULT now();
CREATE TABLE accounting_access_grants(owner_id uuid, member_id uuid, active boolean NOT NULL DEFAULT true);
ALTER TABLE financial_document_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY financial_document_lines_owner_select ON financial_document_lines FOR SELECT USING (auth.uid()=owner_id);
CREATE POLICY financial_documents_delegate_read ON financial_documents FOR SELECT TO authenticated USING (false);
CREATE POLICY financial_lines_delegate_read ON financial_document_lines FOR SELECT TO authenticated USING (false);
CREATE POLICY financial_extractions_delegate_read ON financial_document_extractions FOR SELECT TO authenticated USING (false);
CREATE POLICY financial_concerns_delegate_read ON financial_review_queue FOR SELECT TO authenticated USING (false);
\ir ../migrations/20261023220500_accounting_delegate_read_hoisted.sql
-- The entities the evidence reader resolves ids against (minimal synthetic shapes).
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, year integer, make text, model text);
CREATE TABLE public.work_orders(id uuid PRIMARY KEY, title text);
INSERT INTO public.vehicles VALUES ('77777777-7777-4777-8777-777777777777', 1970, 'Synthetic', 'Roadster');
GRANT SELECT ON public.vehicles, public.work_orders TO authenticated;
\ir ../migrations/20261028174500_accounting_closeout_readers.sql
\ir ../migrations/20261028174500_accounting_closeout_readers.sql

BEGIN;
INSERT INTO auth.users(id) VALUES ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$ DECLARE
 u uuid:='11111111-1111-4111-8111-111111111111';
 base jsonb:=jsonb_build_object('source_sha256',repeat('a',64),'source_row',1,'year','2024','date','2024-03-01','account','Synthetic checking',
   'currency','USD','currency_basis','synthetic USD ledger','bank_links','[]'::jsonb,'recognition_status','retained_decision','payment_status','unresolved',
   'vehicle_status','unresolved','reimbursement_status','unresolved','entity_status','retained_scope_unallocated','record_kind','retained_ledger_decision');
 slice jsonb:=jsonb_build_object('sha256',repeat('a',64),'storage_path',u||'/slice.csv','byte_size',100);
 receipt jsonb:=jsonb_build_object('sha256',repeat('b',64),'storage_path',u||'/receipt.jpeg','byte_size',100,'source_filename','receipt.jpeg');
 draft jsonb:=jsonb_build_object('sha256',repeat('c',64),'storage_path',u||'/return.pdf','byte_size',100,'source_filename','return.pdf');
BEGIN
 PERFORM ingest_financial_evidence(u,slice,jsonb_build_object('idempotency_key','synthetic-books-20240301-0001','method','synthetic-books','version','1',
   'fields',jsonb_build_array(
     jsonb_build_object('field_key','batch','value_raw','synthetic batch','evidence',jsonb_build_object('stage','retained')),
     jsonb_build_object('field_key','expense_use_'||repeat('1',24),'value_raw','shop use','evidence',jsonb_build_object('stage','review'),
       'value_normalized',jsonb_build_object('source_key',repeat('1',64),'use_type','shop','vehicle_id',NULL,'destination_label','Synthetic shop','status','reviewer_assigned_use'))),
   'concerns',jsonb_build_array(jsonb_build_object('concern_type','tiers_non_identifie','detail','Who was paid for E-2?','resolver','Synthetic Owner')),
   'accounting_records',jsonb_build_array(
     base||jsonb_build_object('source_key',repeat('1',64),'local_id','E-1','section','Expense','category','Car restoration — parts & materials','amount','100.00',
       'decision','Parts for the roadster 77777777-7777-4777-8777-777777777777. Paid receipt 19b0217af0e48f1c names the card. Owner confirmed by phone.'),
     base||jsonb_build_object('source_key',repeat('2',64),'local_id','E-2','section','Expense','category','Tech & software subscriptions','amount','40.00','decision','Software.'),
     base||jsonb_build_object('source_key',repeat('3',64),'local_id','R-1','section','Revenue','category','Customer work','amount','500.00','decision','Customer paid.'),
     base||jsonb_build_object('source_key',repeat('4',64),'local_id','bank:0001','record_kind','retained_bank_movement','recognition_status','not_applicable',
       'section','Expense','amount','-100.00','description','CARD PURCHASE SYNTHETIC PARTS','bank_links',jsonb_build_array('E-1')))));
 PERFORM ingest_financial_evidence(u,receipt,jsonb_build_object('idempotency_key','synthetic-receipt-1','method','synthetic-receipt','version','1',
   'fields',jsonb_build_array(jsonb_build_object('field_key','bank_corroboration','value_raw','matches statement','evidence',jsonb_build_object('stage','review'),
     'value_normalized',jsonb_build_object('bank_source_key',repeat('4',64))))));
 PERFORM ingest_financial_evidence(u,draft,jsonb_build_object('idempotency_key','tax-return-draft-2024-cccccccc','method','tax-return-draft','version','1',
   'fields',jsonb_build_array(jsonb_build_object('field_key','tax_return_summary','value_raw','2024 return draft','evidence',jsonb_build_object('stage','generated_return_draft'),
     'value_normalized',jsonb_build_object('tax_year','2024','result','owe','amount',1234,'built_at','2026-10-25T22:00:00Z','books_as_of','2000-01-01T00:00:00Z')))));
END $$;

GRANT SELECT ON financial_documents, financial_document_extractions, financial_document_lines, financial_review_queue TO authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE
 u uuid:='11111111-1111-4111-8111-111111111111'; c jsonb; y jsonb; items jsonb; d jsonb; e jsonb; doc uuid; a jsonb;
BEGIN
 c:=accounting_closeout(u);
 SELECT x INTO y FROM jsonb_array_elements(c->'years') x WHERE x->>'year'='2024';
 IF y IS NULL THEN RAISE EXCEPTION 'owner cannot read the 2024 close-out: %', c; END IF;
 SELECT jsonb_object_agg(i->>'key', i) INTO items FROM jsonb_array_elements(y->'items') i;
 IF (y->'return'->>'amount')::int<>1234 OR y->'return'->>'result'<>'owe' THEN RAISE EXCEPTION 'return draft not read: %', y->'return'; END IF;
 IF (y->>'draft_stale')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'a draft older than the books must read stale'; END IF;
 IF (items->'expense_no_proof'->>'n')::int<>1 OR (items->'expense_no_proof'->>'amount')::numeric<>40 OR (items->'expense_no_proof'->>'of')::int<>2 THEN
   RAISE EXCEPTION 'expense without statement line or receipt: %', items->'expense_no_proof'; END IF;
 IF (items->'expense_no_receipt'->>'n')::int<>0 THEN RAISE EXCEPTION 'receipt reached through its statement line was missed: %', items->'expense_no_receipt'; END IF;
 IF (items->'car_cost_no_car'->>'n')::int<>1 OR (items->'car_cost_no_car'->>'of')::int<>1 THEN RAISE EXCEPTION 'car cost with no car: %', items->'car_cost_no_car'; END IF;
 IF (items->'revenue_no_payer'->>'assessed')::boolean OR (accounting_closeout(u,true)->'years'->0->'items'->4->>'assessed')::boolean THEN RAISE EXCEPTION 'an absent revenue gate must read not assessed, never zero'; END IF;
 IF (y->'books'->>'revenue')::numeric<>500 OR (y->'books'->>'expense')::numeric<>140 THEN RAISE EXCEPTION 'books totals: %', y->'books'; END IF;
 IF (c->'questions'->>'pending_current')::int<>1 OR (c->'questions'->'by_resolver'->>'Synthetic Owner')::int<>1 THEN RAISE EXCEPTION 'questions: %', c->'questions'; END IF;

 d:=accounting_closeout_records(u,'2024','expense_no_proof',10,0);
 IF (d->>'total')::int<>1 OR (d->>'amount')::numeric<>40 OR d->'rows'->0->'record'->>'local_id'<>'E-2' OR d->'rows'->0->>'document_id' IS NULL THEN RAISE EXCEPTION 'drill: %', d; END IF;
 BEGIN PERFORM accounting_closeout_records(u,'2024','anything',10,0); RAISE EXCEPTION 'unknown item accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='unknown item accepted' THEN RAISE; END IF; END;

 SELECT (d->'rows'->0->>'document_id')::uuid INTO doc;
 e:=accounting_record_evidence(u,doc,repeat('1',64));
 IF e->>'strength'<>'artifact' THEN RAISE EXCEPTION 'receipt on the statement line is an artifact: %', e; END IF;
 IF jsonb_array_length(e->'statement_lines')<>1 OR e->'statement_lines'->0->>'local_id'<>'bank:0001' THEN RAISE EXCEPTION 'statement line: %', e->'statement_lines'; END IF;
 IF e->'artifacts'->0->>'kind'<>'image' OR e->'artifacts'->0->>'via'<>'matches_statement_line' THEN RAISE EXCEPTION 'artifact: %', e->'artifacts'; END IF;
 IF e->'messages'->0->>'id'<>'19b0217af0e48f1c' OR ((e->'messages'->0->>'sent_at')::timestamptz AT TIME ZONE 'UTC')::date<>'2025-12-09' OR position('19b0217af0e48f1c' IN e->'messages'->0->>'quote')=0 THEN
   RAISE EXCEPTION 'gmail id and its encoded send time: %', e->'messages'; END IF;
 IF e->'vehicles'->0->>'label'<>'1970 Synthetic Roadster' THEN RAISE EXCEPTION 'vehicle named in the notes: %', e->'vehicles'; END IF;
 IF jsonb_array_length(e->'attestations')<>1 THEN RAISE EXCEPTION 'owner statement in the notes: %', e->'attestations'; END IF;
 IF e->'use'->>'use_type'<>'shop' THEN RAISE EXCEPTION 'use cell: %', e->'use'; END IF;
 IF octet_length(e::text)>4000 THEN RAISE EXCEPTION 'evidence must stay compact: % bytes', octet_length(e::text); END IF;
 e:=accounting_record_evidence(u,doc,repeat('2',64));
 IF e->>'strength'<>'narrative' OR jsonb_array_length(e->'questions')<>1 THEN RAISE EXCEPTION 'unproven expense and its question: %', e; END IF;
 IF accounting_record_evidence(u,doc,repeat('9',64)) IS NOT NULL THEN RAISE EXCEPTION 'unknown record must read null'; END IF;

 a:=accounting_activity_runs(u,10);
 IF jsonb_array_length(a)<1 OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(a) x WHERE x->>'run_family'='synthetic-books-20240301'
     AND (x->>'records_changed')::int=4 AND (x->'years'->'2024'->>'amount')::numeric=640 AND (x->>'questions_opened')::int=1) THEN
   RAISE EXCEPTION 'activity passes: %', a; END IF;
END $$;
RESET ROLE;

-- Another account reads nothing from this book.
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE u uuid:='11111111-1111-4111-8111-111111111111'; c jsonb; BEGIN
 c:=accounting_closeout(u);
 IF jsonb_array_length(c->'years')<>0 OR (c->'questions'->>'pending_current')::int<>0 THEN RAISE EXCEPTION 'close-out crossed books: %', c; END IF;
 IF jsonb_array_length(accounting_activity_runs(u,10))<>0 THEN RAISE EXCEPTION 'activity crossed books'; END IF;
 IF (accounting_closeout_records(u,'2024','expense_no_proof',10,0)->>'total')::int<>0 THEN RAISE EXCEPTION 'drill crossed books'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM accounting_closeout('11111111-1111-4111-8111-111111111111'); RAISE EXCEPTION 'anon executed the close-out reader'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM accounting_record_evidence('11111111-1111-4111-8111-111111111111',gen_random_uuid(),repeat('1',64)); RAISE EXCEPTION 'anon executed the evidence reader'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM accounting_activity_runs('11111111-1111-4111-8111-111111111111',5); RAISE EXCEPTION 'anon executed the activity reader'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('accounting_closeout','accounting_closeout_records','accounting_record_evidence','accounting_activity_runs',
   'accounting_current_records','accounting_decision_proof','accounting_return_drafts') AND prosecdef) THEN RAISE EXCEPTION 'close-out readers must run as the caller'; END IF;
 RAISE NOTICE 'PASS accounting close-out readers: return draft, stale flag, proof flags, drill, compact evidence, passes, caller-scoped';
END $$;
ROLLBACK;
