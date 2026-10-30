\set ON_ERROR_STOP on
-- Disposable synthetic contract for books_large_sum_rows and books_gate_context (migration 20261106140000). Every id, name and amount is invented.
-- v_books_large_sums and v_books_audit_tiers are stand-ins over the real v_financial_accounting_records: the flags come from a fixture table, but the
-- head (dollar_rank, year_usd, cum_share, in_head) is the real view's own window logic, copied, so the contract holds the reader to the 80% rule.
-- Covered: the flagged head rows and nothing else, largest dollars first, with the record the evidence dialog opens; the year's totals equal the rows
-- (the same counts rule R12 reports); a cap per year trims rows and never totals; a document the owner attached shows beside its row, and a cell that names
-- another record does not; books_gate_context states the denominators; a signed-in stranger, the accounting reviewer and anon are refused; a re-apply
-- changes nothing.
\ir test_financial_accounting.sql
\ir ../migrations/20261023200300_financial_accounting_records_view.sql
\ir ../migrations/20261023201000_financial_accounting_records_view_grants.sql
\ir ../migrations/20261025083500_accounting_records_bounded_reads.sql
ALTER TABLE auth.users ADD COLUMN email_confirmed_at timestamptz DEFAULT now();
CREATE TABLE accounting_access_grants(owner_id uuid, member_id uuid, active boolean NOT NULL DEFAULT true);
ALTER TABLE financial_document_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY financial_document_lines_owner_select ON financial_document_lines FOR SELECT USING (auth.uid()=owner_id);
CREATE POLICY financial_documents_delegate_read ON financial_documents FOR SELECT TO authenticated USING (false);
CREATE POLICY financial_lines_delegate_read ON financial_document_lines FOR SELECT TO authenticated USING (false);
CREATE POLICY financial_extractions_delegate_read ON financial_document_extractions FOR SELECT TO authenticated USING (false);
CREATE POLICY financial_concerns_delegate_read ON financial_review_queue FOR SELECT TO authenticated USING (false);
\ir ../migrations/20261023220500_accounting_delegate_read_hoisted.sql
ALTER ROLE service_role BYPASSRLS;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- The fixture: the flags of each synthetic decision, set by its local id.
CREATE TABLE public.ls_fixture(local_id text PRIMARY KEY, tier text, pay_proof boolean, has_owner_ruling boolean, structural_rule text, is_deduction boolean,
  doc_proof boolean, proof_flag text, required_doc_kind text, required_doc_rule text, doc_found_n bigint, doc_cited_n integer, document_cites jsonb);
INSERT INTO public.ls_fixture VALUES
  -- 2024, amounts 1000 800 500 300 | 200 100 60 40 (sum 3000; the head is the rows to 2400 of it: L1..L4)
  ('L1', 'B', true,  false, NULL, true, false, NULL,                'invoice_or_agreement', 'contractor',    0, 0, '[]'),
  ('L2', 'C', false, false, NULL, true, false, 'no_payment_proof',  NULL,                   NULL,            0, 0, '[]'),
  ('L3', 'C', true,  false, NULL, true, false, 'filed_return_only', NULL,                   NULL,            0, 0, '[]'),
  ('L4', 'B', true,  false, NULL, true, false, NULL,                'receipt_or_order',     'parts_supplies', 0, 1, '[{"kind":"file","ref":"photo of the shelf"}]'),
  ('L5', 'B', true,  false, NULL, true, false, NULL,                'receipt_or_order',     'parts_supplies', 0, 0, '[]'),
  ('L6', 'A', true,  false, NULL, true, true,  NULL,                'receipt_or_order',     'parts_supplies', 1, 1, '[{"kind":"file","ref":"receipt 1.pdf"}]'),
  ('L7', 'B', false, true,  'asset_register', true, false, NULL,    'register_asset',       'depreciation',  1, 0, '[]'),
  ('L8', 'B', true,  false, NULL, true, false, NULL,                NULL,                   NULL,            0, 0, '[]'),
  -- 2024 revenue: never listed
  ('V1', 'A', true,  false, NULL, false, false, NULL,               NULL,                   NULL,            0, 0, '[]'),
  -- 2025: one flagged row, so the years stay apart
  ('M1', 'B', true,  false, NULL, true, false, NULL,                'purchase_agreement',   'vehicle_deal',  0, 0, '[]');
CREATE VIEW public.v_books_audit_tiers WITH (security_invoker = true) AS
SELECT v.id, v.owner_id, v.document_id, v.year, v.local_id, v.amount_value AS amount, f.pay_proof, f.has_owner_ruling, f.structural_rule, f.is_deduction
FROM public.v_financial_accounting_records v JOIN public.ls_fixture f ON f.local_id = v.local_id
WHERE v.record_kind = 'retained_ledger_decision' AND v.section = 'Expense';
CREATE VIEW public.v_books_large_sums WITH (security_invoker = true) AS
SELECT c.kind, c.owner_id, c.year, row_number() OVER w AS dollar_rank, c.local_id, c.id, c.document_id, c.amount, c.category, c.description, ''::text AS ruling_id,
       c.tier, c.pay_proof, c.doc_proof, c.pay_proof AS purpose_proof, NULL::text AS proof_basis,
       CASE WHEN c.doc_proof THEN 'documented' WHEN c.proof_flag = 'filed_return_only' THEN 'filed_return_only' WHEN c.tier IN ('A', 'B') THEN 'bank_and_rule' ELSE 'none' END AS basis_strength,
       c.proof_flag, c.required_doc_kind, c.required_doc_rule, '[]'::jsonb AS doc_found, c.doc_found_n,
       (c.required_doc_kind IS NOT NULL AND c.doc_found_n = 0) AS missing_doc, c.doc_cited_n, NULL::uuid[] AS vehicle_ids,
       round(sum(abs(c.amount)) OVER p, 2) AS year_usd, round(abs(c.amount) / nullif(sum(abs(c.amount)) OVER p, 0), 6) AS share,
       round(sum(abs(c.amount)) OVER w, 2) AS cum_usd, round(sum(abs(c.amount)) OVER w / nullif(sum(abs(c.amount)) OVER p, 0), 6) AS cum_share,
       (abs(c.amount) > 0 AND (sum(abs(c.amount)) OVER w - abs(c.amount)) < 0.8 * sum(abs(c.amount)) OVER p) AS in_head,
       '[]'::jsonb AS payment_cites, c.document_cites, '[]'::jsonb AS ruling_cites
FROM (
  SELECT 'deduction'::text AS kind, v.owner_id, v.year, v.id, v.document_id, v.local_id, v.amount_value AS amount, v.category, v.description,
         f.tier, f.pay_proof, f.doc_proof, f.proof_flag, f.required_doc_kind, f.required_doc_rule, f.doc_found_n, f.doc_cited_n, f.document_cites
  FROM public.v_financial_accounting_records v JOIN public.ls_fixture f ON f.local_id = v.local_id
  WHERE v.record_kind = 'retained_ledger_decision' AND v.section = 'Expense' AND f.is_deduction
  UNION ALL
  SELECT 'revenue', v.owner_id, v.year, v.id, v.document_id, v.local_id, v.amount_value, v.category, v.description,
         f.tier, f.pay_proof, f.doc_proof, f.proof_flag, f.required_doc_kind, f.required_doc_rule, f.doc_found_n, f.doc_cited_n, f.document_cites
  FROM public.v_financial_accounting_records v JOIN public.ls_fixture f ON f.local_id = v.local_id
  WHERE v.record_kind = 'retained_ledger_decision' AND v.section = 'Revenue'
) c
WINDOW p AS (PARTITION BY c.owner_id, c.year, c.kind),
       w AS (p ORDER BY abs(c.amount) DESC, c.local_id, c.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW);
GRANT SELECT ON public.v_books_audit_tiers, public.v_books_large_sums TO authenticated, service_role;

\ir ../migrations/20261106140000_books_large_sum_rows.sql
\ir ../migrations/20261106140000_books_large_sum_rows.sql

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
CREATE FUNCTION pg_temp.fails(label text, stmt text, want_state text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text;
BEGIN
  BEGIN EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS got = RETURNED_SQLSTATE;
    IF got = want_state THEN RAISE NOTICE 'PASS % (refused %)', label, got; RETURN; END IF;
    RAISE EXCEPTION 'Contract failed: % was refused with % (wanted %): %', label, got, want_state, SQLERRM;
  END;
  RAISE EXCEPTION 'Contract failed: % was admitted', label;
END $$;

BEGIN;
INSERT INTO auth.users(id) VALUES ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222'), ('33333333-3333-4333-8333-333333333333');
INSERT INTO accounting_access_grants(owner_id, member_id) VALUES ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333');
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $$ DECLARE
 u uuid := '11111111-1111-4111-8111-111111111111';
 o jsonb := jsonb_build_object('sha256', repeat('e', 64), 'storage_path', u || '/ledger.csv', 'byte_size', 100, 'source_filename', 'ledger.csv');
 dec jsonb := jsonb_build_object('record_kind', 'retained_ledger_decision', 'source_sha256', repeat('a', 64), 'source_row', 1, 'year', '2024', 'date', '2024-03-01',
   'account', 'Synthetic ledger', 'currency', 'USD', 'currency_basis', 'synthetic USD ledger', 'bank_links', '[]'::jsonb, 'recognition_status', 'retained_decision',
   'payment_status', 'unresolved', 'vehicle_status', 'unresolved', 'reimbursement_status', 'unresolved', 'entity_status', 'retained_scope_unallocated',
   'section', 'Expense', 'category', 'Synthetic category', 'decision', 'Synthetic.');
 recs jsonb := jsonb_build_array(
   dec || jsonb_build_object('local_id', 'L1', 'source_key', repeat('1', 64), 'amount', '1000.00', 'date', '2024-01-05', 'description', 'Painter Co — paint and bodywork'),
   dec || jsonb_build_object('local_id', 'L2', 'source_key', repeat('2', 64), 'amount', '800.00',  'date', '2024-02-10', 'description', 'Cash purchase — wheels'),
   dec || jsonb_build_object('local_id', 'L3', 'source_key', repeat('3', 64), 'amount', '500.00',  'date', '2024-03-15', 'description', 'Welder Co — frame work'),
   dec || jsonb_build_object('local_id', 'L4', 'source_key', repeat('4', 64), 'amount', '300.00',  'date', '2024-04-20', 'description', 'Parts House — brackets'),
   dec || jsonb_build_object('local_id', 'L5', 'source_key', repeat('5', 64), 'amount', '200.00',  'date', '2024-05-01', 'description', 'Parts House — fittings'),
   dec || jsonb_build_object('local_id', 'L6', 'source_key', repeat('6', 64), 'amount', '100.00',  'date', '2024-06-01', 'description', 'Parts House — clips'),
   dec || jsonb_build_object('local_id', 'L7', 'source_key', repeat('7', 64), 'amount', '60.00',   'date', '2024-07-01', 'description', 'Machine — depreciation'),
   dec || jsonb_build_object('local_id', 'L8', 'source_key', repeat('8', 64), 'amount', '40.00',   'date', '2024-08-01', 'description', 'Misc — small'),
   dec || jsonb_build_object('local_id', 'V1', 'source_key', repeat('9', 64), 'amount', '900.00',  'date', '2024-09-01', 'description', 'Customer — sale', 'section', 'Revenue'),
   dec || jsonb_build_object('local_id', 'M1', 'source_key', repeat('b', 64), 'amount', '700.00',  'date', '2025-01-02', 'year', '2025', 'description', 'Seller — vehicle purchase'));
BEGIN
 PERFORM ingest_financial_evidence(u, o, jsonb_build_object('idempotency_key', 'synthetic-large-1', 'method', 'synthetic-large', 'version', '1',
   'fields', jsonb_build_array(jsonb_build_object('field_key', 'batch', 'value_raw', 'synthetic batch', 'evidence', jsonb_build_object('stage', 'retained'))),
   'accounting_records', recs));
 -- an invoice the owner attached to L1 (the cell the office's Add documents flow writes), and a cell that carries L2's key but names L3 (it must not count)
 PERFORM ingest_financial_evidence(u, jsonb_build_object('sha256', repeat('c', 64), 'storage_path', u || '/invoice.pdf', 'byte_size', 100, 'source_filename', 'invoice-1.pdf'),
   jsonb_build_object('idempotency_key', 'attach-1', 'method', 'authenticated_document_attachment', 'version', '1', 'fields', jsonb_build_array(
     jsonb_build_object('field_key', 'capture_status', 'value_raw', 'captured', 'evidence', jsonb_build_object('stage', 'original_capture_only')),
     jsonb_build_object('field_key', 'supports_record_' || left(repeat('1', 64), 24), 'value_raw', 'Invoice for L1', 'evidence', jsonb_build_object('stage', 'owner_document_attachment'),
       'value_normalized', jsonb_build_object('year', '2024', 'local_id', 'L1', 'source_key', repeat('1', 64), 'decision_document_id', NULL, 'doc_kind', 'Invoice',
         'ref', 'Invoice: invoice-1.pdf (sha256 cccccccccccc)', 'status', 'pending_link')),
     jsonb_build_object('field_key', 'supports_record_' || left(repeat('2', 64), 24), 'value_raw', 'Mislabelled', 'evidence', jsonb_build_object('stage', 'owner_document_attachment'),
       'value_normalized', jsonb_build_object('year', '2024', 'local_id', 'L3', 'source_key', repeat('3', 64), 'doc_kind', 'Receipt', 'ref', 'Receipt: wrong.pdf', 'status', 'pending_link')))));
END $$;
COMMIT;
GRANT SELECT ON financial_documents, financial_document_extractions, financial_document_lines, financial_review_queue TO authenticated, service_role;
GRANT SELECT ON public.ls_fixture TO authenticated, service_role;

-- The owner ---------------------------------------------------------------------------------------------------------------------------
BEGIN;
SELECT set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE r1 AS SELECT public.books_large_sum_rows('11111111-1111-4111-8111-111111111111') AS j;
GRANT SELECT ON r1 TO PUBLIC;
SELECT pg_temp.ok('years are the years that have deductions, newest first; revenue is not listed',
  (SELECT array_agg(y->>'year' ORDER BY y->>'year' DESC) FROM r1, jsonb_array_elements(j->'years') y) = ARRAY['2025', '2024']
  AND (SELECT j->>'reader' = 'books_large_sum_rows' AND j->>'owner_id' = '11111111-1111-4111-8111-111111111111' FROM r1));
SELECT pg_temp.ok('2024 lists the flagged head rows and nothing else, largest dollars first: L1 (missing invoice), L2 (no payment proof), L3 (filed return only), L4 (missing receipt)',
  (SELECT array_agg(r->>'local_id' ORDER BY ord) FROM r1, jsonb_array_elements(j->'years') y, jsonb_array_elements(y->'rows') WITH ORDINALITY q(r, ord) WHERE y->>'year' = '2024')
    = ARRAY['L1', 'L2', 'L3', 'L4']);
SELECT pg_temp.ok('L5 misses a receipt but lies below the 80% line, so it is not listed; it is counted beside the totals as a missing document beyond the head',
  (SELECT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(y->'rows') r WHERE r->>'local_id' = 'L5') AND (y->>'beyond_head_missing_doc_n')::int = 1 AND (y->>'beyond_head_missing_doc_usd')::numeric = 200
   FROM r1, jsonb_array_elements(j->'years') y WHERE y->>'year' = '2024'));
SELECT pg_temp.ok('a row carries the view''s flags and the record the evidence dialog opens, and the date of the decision',
  (SELECT r->>'document_id' IS NOT NULL AND r->>'proof_flag' IS NULL AND r->>'required_doc_kind' = 'invoice_or_agreement' AND r->>'required_doc_rule' = 'contractor' AND (r->>'missing_doc')::boolean
          AND (r->>'amount')::numeric = 1000 AND r->>'tier' = 'B' AND (r->>'pay_proof')::boolean AND (r->>'dollar_rank')::int = 1
          AND r->'record'->>'source_key' = repeat('1', 64) AND r->'record'->>'date' = '2024-01-05' AND r->'record'->>'record_kind' = 'retained_ledger_decision'
          AND r->'record'->>'amount' = '1000.00' AND r->'record'->>'description' = 'Painter Co — paint and bodywork'
   FROM r1, jsonb_array_elements(j->'years') y, jsonb_array_elements(y->'rows') r WHERE y->>'year' = '2024' AND r->>'local_id' = 'L1'));
SELECT pg_temp.ok('the flags of the other rows are the view''s: L2 no payment proof, L3 filed return only, L4 a missing receipt that already cites one other document',
  (SELECT bool_and(CASE r->>'local_id'
     WHEN 'L2' THEN r->>'proof_flag' = 'no_payment_proof' AND NOT (r->>'missing_doc')::boolean
     WHEN 'L3' THEN r->>'proof_flag' = 'filed_return_only' AND r->>'basis_strength' = 'filed_return_only'
     WHEN 'L4' THEN (r->>'missing_doc')::boolean AND (r->>'doc_cited_n')::int = 1 AND r->'cites'->0->>'ref' = 'photo of the shelf' END)
   FROM r1, jsonb_array_elements(j->'years') y, jsonb_array_elements(y->'rows') r WHERE y->>'year' = '2024'));
SELECT pg_temp.ok('the year''s totals are the counts rule R12 reports over the same rows: head 4 of 8 rows and 2600 of 3000 dollars, 4 flagged for 2600, 2 missing a document for 1300, 1 with no payment proof, 1 filed return only',
  (SELECT (y->>'deductions_n')::int = 8 AND (y->>'year_usd')::numeric = 3000 AND (y->>'head_n')::int = 4 AND (y->>'head_usd')::numeric = 2600
          AND (y->>'flagged_n')::int = 4 AND (y->>'flagged_usd')::numeric = 2600 AND (y->>'missing_doc_n')::int = 2 AND (y->>'missing_doc_usd')::numeric = 1300
          AND (y->>'no_payment_n')::int = 1 AND (y->>'no_payment_usd')::numeric = 800 AND (y->>'filed_return_only_n')::int = 1 AND (y->>'filed_return_only_usd')::numeric = 500
          AND (y->>'rows_shown')::int = 4
   FROM r1, jsonb_array_elements(j->'years') y WHERE y->>'year' = '2024'));
SELECT pg_temp.ok('the totals equal the sums of the rows listed (nothing was capped)',
  (SELECT (y->>'flagged_usd')::numeric = (SELECT sum(abs((r->>'amount')::numeric)) FROM jsonb_array_elements(y->'rows') r)
          AND (y->>'missing_doc_n')::int = (SELECT count(*) FROM jsonb_array_elements(y->'rows') r WHERE (r->>'missing_doc')::boolean)
   FROM r1, jsonb_array_elements(j->'years') y WHERE y->>'year' = '2024'));
SELECT pg_temp.ok('2025 is its own year: one flagged row, a missing purchase agreement',
  (SELECT (y->>'flagged_n')::int = 1 AND y->'rows'->0->>'local_id' = 'M1' AND y->'rows'->0->>'required_doc_kind' = 'purchase_agreement'
   FROM r1, jsonb_array_elements(j->'years') y WHERE y->>'year' = '2025'));
SELECT pg_temp.ok('a document the owner attached shows beside its row, with what she said it is and the citation text; a cell that names another record does not count',
  (SELECT jsonb_array_length(r->'attached') = 1 AND r->'attached'->0->>'filename' = 'invoice-1.pdf' AND r->'attached'->0->>'doc_kind' = 'Invoice'
          AND r->'attached'->0->>'ref' = 'Invoice: invoice-1.pdf (sha256 cccccccccccc)' AND r->'attached'->0->>'document_id' IS NOT NULL AND r->'attached'->0->>'attached_at' IS NOT NULL
   FROM r1, jsonb_array_elements(j->'years') y, jsonb_array_elements(y->'rows') r WHERE y->>'year' = '2024' AND r->>'local_id' = 'L1')
  AND (SELECT bool_and(jsonb_array_length(r->'attached') = 0) FROM r1, jsonb_array_elements(j->'years') y, jsonb_array_elements(y->'rows') r WHERE y->>'year' = '2024' AND r->>'local_id' IN ('L2', 'L3', 'L4')));
SELECT pg_temp.ok('the row stays flagged after the document is attached: the view decides, not the cell',
  (SELECT (r->>'missing_doc')::boolean FROM r1, jsonb_array_elements(j->'years') y, jsonb_array_elements(y->'rows') r WHERE y->>'year' = '2024' AND r->>'local_id' = 'L1'));
SELECT pg_temp.ok('a cap per year trims the rows and never the totals',
  (SELECT jsonb_array_length(y->'rows') = 2 AND (y->>'rows_shown')::int = 2 AND (y->>'flagged_n')::int = 4 AND (y->>'missing_doc_usd')::numeric = 1300
          AND y->'rows'->0->>'local_id' = 'L1' AND y->'rows'->1->>'local_id' = 'L2'
   FROM (SELECT public.books_large_sum_rows('11111111-1111-4111-8111-111111111111', 2) AS j) c, jsonb_array_elements(j->'years') y WHERE y->>'year' = '2024'));
SELECT pg_temp.fails('a rows-per-year of 0 is refused', $q$SELECT public.books_large_sum_rows('11111111-1111-4111-8111-111111111111', 0)$q$, '22023');
SELECT pg_temp.fails('a rows-per-year above 300 is refused', $q$SELECT public.books_large_sum_rows('11111111-1111-4111-8111-111111111111', 301)$q$, '22023');
COMMIT;

-- books_gate_context, as the service role (the recorder) -------------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE service_role;
CREATE TEMP TABLE c1 AS SELECT public.books_gate_context('11111111-1111-4111-8111-111111111111', 2024) AS j, public.books_gate_context('11111111-1111-4111-8111-111111111111', 2022) AS empty;
GRANT SELECT ON c1 TO PUBLIC;
SELECT pg_temp.ok('the context states the deduction denominator, the deductions with no bank line, rule R10 part b and the head of rule R12',
  (SELECT (j->'deductions'->>'n')::int = 8 AND (j->'deductions'->>'usd')::numeric = 3000
          AND (j->'no_bank'->>'n')::int = 2 AND (j->'no_bank'->>'usd')::numeric = 860
          AND (j->'no_pay_no_ruling'->>'n')::int = 1 AND (j->'no_pay_no_ruling'->>'usd')::numeric = 800
          AND (j->'head'->>'n')::int = 4 AND (j->'head'->>'usd')::numeric = 2600 AND (j->'head'->>'year_usd')::numeric = 3000 FROM c1));
SELECT pg_temp.ok('the context agrees with the reader over the same rows (head rows and dollars, the year''s dollars)',
  (SELECT (c.j->'head'->>'n')::int = (y->>'head_n')::int AND (c.j->'head'->>'usd')::numeric = (y->>'head_usd')::numeric AND (c.j->'head'->>'year_usd')::numeric = (y->>'year_usd')::numeric
   FROM c1 c, (SELECT public.books_large_sum_rows('11111111-1111-4111-8111-111111111111') AS j) r, jsonb_array_elements(r.j->'years') y WHERE y->>'year' = '2024'));
SELECT pg_temp.ok('a year with no deductions has a context of zeros and a null year total, not an error',
  (SELECT (empty->'deductions'->>'n')::int = 0 AND (empty->'no_pay_no_ruling'->>'usd')::numeric = 0 AND (empty->'head'->>'n')::int = 0 AND jsonb_typeof(empty->'head'->'year_usd') = 'null' FROM c1));
COMMIT;

-- Who may read --------------------------------------------------------------------------------------------------------------------------
BEGIN;
SELECT set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.fails('a signed-in stranger is refused the owner''s large sums (42501), not handed an empty list', $q$SELECT public.books_large_sum_rows('11111111-1111-4111-8111-111111111111')$q$, '42501');
SELECT pg_temp.ok('a signed-in stranger asking for their own book reads an empty list',
  (SELECT jsonb_array_length(public.books_large_sum_rows('22222222-2222-4222-8222-222222222222')->'years') = 0));
SELECT pg_temp.fails('authenticated cannot call the recorder''s context (42501)', $q$SELECT public.books_gate_context('22222222-2222-4222-8222-222222222222', 2024)$q$, '42501');
COMMIT;
BEGIN;
SELECT set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.fails('the accounting reviewer is refused the owner''s large sums (42501)', $q$SELECT public.books_large_sum_rows('11111111-1111-4111-8111-111111111111')$q$, '42501');
COMMIT;
BEGIN;
SET LOCAL ROLE anon;
SELECT pg_temp.fails('anon cannot execute the reader (42501)', $q$SELECT public.books_large_sum_rows('11111111-1111-4111-8111-111111111111')$q$, '42501');
SELECT pg_temp.fails('anon cannot execute the context (42501)', $q$SELECT public.books_gate_context('11111111-1111-4111-8111-111111111111', 2024)$q$, '42501');
COMMIT;
SELECT pg_temp.ok('the reader is granted to authenticated and service_role, the context to service_role only; neither is a definer',
  has_function_privilege('authenticated', 'public.books_large_sum_rows(uuid,integer)', 'EXECUTE') AND has_function_privilege('service_role', 'public.books_large_sum_rows(uuid,integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.books_large_sum_rows(uuid,integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.books_gate_context(uuid,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.books_gate_context(uuid,integer)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.books_gate_context(uuid,integer)', 'EXECUTE')
  AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid IN ('public.books_large_sum_rows(uuid,integer)'::regprocedure, 'public.books_gate_context(uuid,integer)'::regprocedure) AND prosecdef));
SELECT pg_temp.ok('the migration was applied twice without error and left one function of each name',
  (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('books_large_sum_rows', 'books_gate_context')) = 2);
