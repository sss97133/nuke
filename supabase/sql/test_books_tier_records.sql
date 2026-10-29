\set ON_ERROR_STOP on
-- Disposable synthetic contract for books_tier_records (migration 20261106130000). Every id, name and amount below is invented.
-- v_books_audit_tiers is a stand-in over the real v_financial_accounting_records (the tier logic is not this reader's job; the real view
-- needs its whole chain), and v_books_audit_tier_years is the real rollup definition of migration 20261104180000, copied, so the contract
-- can hold every class total equal to the rollup's own count and dollars.
-- Covered: each class returns exactly its rows, largest amount first, paged, with the record the records table renders and the row's
-- proof; total and amount cover the whole class and equal the rollup; a bad year, class, limit or offset is refused; a signed-in
-- stranger gets total 0; anon cannot execute; a re-apply changes nothing.
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
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- The tier stand-in: the class of each synthetic decision is set by its local id.
CREATE TABLE public.tier_fixture(local_id text PRIMARY KEY, tier text, pay_proof boolean, doc_proof boolean, purpose_proof boolean, has_owner_ruling boolean,
  is_274 boolean, needs_receipt boolean, is_caveat boolean, structural_rule text, proof_basis text, is_deduction boolean);
INSERT INTO public.tier_fixture VALUES
  ('D1', 'A', true,  true,  true,  false, false, false, false, NULL,             'bank_line',      true),
  ('D2', 'B', true,  false, true,  false, false, false, false, NULL,             'bank_line',      true),
  ('D3', 'B', false, false, true,  true,  false, false, false, 'asset_register', 'asset_register', true),
  ('D4', 'C', false, false, false, false, false, false, false, NULL,             NULL,             true),
  ('D5', 'C', true,  false, false, false, false, false, false, NULL,             NULL,             true),
  ('D6', 'X', false, false, false, false, false, false, false, 'credit_reduction', NULL,           false),
  ('D7', 'B', true,  false, true,  false, true,  true,  false, NULL,             'bank_line',      true),
  ('D8', 'C', false, false, false, false, false, false, false, NULL,             NULL,             true);
CREATE VIEW public.v_books_audit_tiers WITH (security_invoker = true) AS
SELECT v.id, v.owner_id, v.document_id, v.year, v.local_id, v.amount_value AS amount, v.category, v.description, f.tier,
  'synthetic reason for ' || v.local_id AS tier_reason, f.pay_proof, f.doc_proof, f.purpose_proof, f.has_owner_ruling, false AS is_cash, false AS is_contractor,
  f.is_274, f.is_caveat, false AS is_summary_row, f.needs_receipt,
  CASE WHEN f.pay_proof THEN jsonb_build_array('M-' || v.local_id) ELSE '[]'::jsonb END AS payment_cites,
  CASE WHEN f.doc_proof THEN jsonb_build_array(jsonb_build_object('kind', 'file', 'ref', 'receipt.pdf')) ELSE '[]'::jsonb END AS document_cites,
  '[]'::jsonb AS rule_cites, '' AS ruling_id,
  CASE WHEN f.has_owner_ruling THEN jsonb_build_array(jsonb_build_object('kind', 'owner_ruling', 'ref', 'ruling')) ELSE '[]'::jsonb END AS ruling_cites,
  f.is_deduction, CASE WHEN NOT f.is_deduction THEN 'synthetic exclusion' END AS exclusion_reason, f.structural_rule,
  CASE WHEN f.structural_rule IS NOT NULL THEN jsonb_build_array(jsonb_build_object('rule', f.structural_rule)) END AS structural_cites, f.proof_basis
FROM public.v_financial_accounting_records v JOIN public.tier_fixture f ON f.local_id = v.local_id
WHERE v.record_kind = 'retained_ledger_decision' AND v.section = 'Expense';
-- The rollup, as migration 20261104180000 defines it (the columns this contract compares).
CREATE VIEW public.v_books_audit_tier_years WITH (security_invoker = true) AS
SELECT t.owner_id, t.year, count(*) AS decisions,
  round(coalesce(sum(t.amount) FILTER (WHERE t.tier = 'A'), 0), 2) AS a_usd, round(coalesce(sum(t.amount) FILTER (WHERE t.tier = 'B'), 0), 2) AS b_usd, round(coalesce(sum(t.amount) FILTER (WHERE t.tier = 'C'), 0), 2) AS c_usd,
  count(*) FILTER (WHERE t.tier = 'A') AS a_n, count(*) FILTER (WHERE t.tier = 'B') AS b_n, count(*) FILTER (WHERE t.tier = 'C') AS c_n,
  round(coalesce(sum(t.amount) FILTER (WHERE t.needs_receipt AND NOT t.doc_proof), 0), 2) AS s274_needs_receipt_usd,
  round(coalesce(sum(t.amount) FILTER (WHERE t.is_deduction AND NOT t.pay_proof AND NOT t.has_owner_ruling AND t.structural_rule IS NULL), 0), 2) AS no_pay_no_ruling_usd,
  count(*) FILTER (WHERE NOT t.is_deduction) AS excluded_n, round(coalesce(sum(t.amount) FILTER (WHERE NOT t.is_deduction), 0), 2) AS excluded_usd,
  count(*) FILTER (WHERE t.tier = 'B' AND NOT t.pay_proof) AS b_nobank_n, round(coalesce(sum(t.amount) FILTER (WHERE t.tier = 'B' AND NOT t.pay_proof), 0), 2) AS b_nobank_usd
FROM public.v_books_audit_tiers t GROUP BY t.owner_id, t.year;
GRANT SELECT ON public.v_books_audit_tiers, public.v_books_audit_tier_years TO authenticated, service_role;

\ir ../migrations/20261106130000_books_tier_records.sql
\ir ../migrations/20261106130000_books_tier_records.sql

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
INSERT INTO auth.users(id) VALUES ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $$ DECLARE
 u uuid := '11111111-1111-4111-8111-111111111111';
 o jsonb := jsonb_build_object('sha256', repeat('e', 64), 'storage_path', u || '/ledger.csv', 'byte_size', 100);
 dec jsonb := jsonb_build_object('record_kind', 'retained_ledger_decision', 'source_sha256', repeat('a', 64), 'source_row', 1, 'year', '2024', 'date', '2024-03-01',
   'account', 'Synthetic ledger', 'currency', 'USD', 'currency_basis', 'synthetic USD ledger', 'bank_links', '[]'::jsonb, 'recognition_status', 'retained_decision',
   'payment_status', 'unresolved', 'vehicle_status', 'unresolved', 'reimbursement_status', 'unresolved', 'entity_status', 'retained_scope_unallocated',
   'section', 'Expense', 'category', 'Parts', 'decision', 'Synthetic.');
 recs jsonb := jsonb_build_array(
   dec || jsonb_build_object('local_id', 'D1', 'source_key', repeat('1', 64), 'amount', '100.00'),
   dec || jsonb_build_object('local_id', 'D2', 'source_key', repeat('2', 64), 'amount', '60.00'),
   dec || jsonb_build_object('local_id', 'D3', 'source_key', repeat('3', 64), 'amount', '300.00'),
   dec || jsonb_build_object('local_id', 'D4', 'source_key', repeat('4', 64), 'amount', '80.00'),
   dec || jsonb_build_object('local_id', 'D5', 'source_key', repeat('5', 64), 'amount', '20.00'),
   dec || jsonb_build_object('local_id', 'D6', 'source_key', repeat('6', 64), 'amount', '-10.00'),
   dec || jsonb_build_object('local_id', 'D7', 'source_key', repeat('7', 64), 'amount', '150.00'),
   dec || jsonb_build_object('local_id', 'D8', 'source_key', repeat('8', 64), 'amount', '5.00', 'year', '2025', 'date', '2025-01-02'));
BEGIN
 PERFORM ingest_financial_evidence(u, o, jsonb_build_object('idempotency_key', 'synthetic-tiers-1', 'method', 'synthetic-tiers', 'version', '1',
   'fields', jsonb_build_array(jsonb_build_object('field_key', 'batch', 'value_raw', 'synthetic batch', 'evidence', jsonb_build_object('stage', 'retained'))),
   'accounting_records', recs));
END $$;
COMMIT;
GRANT SELECT ON financial_documents, financial_document_extractions, financial_document_lines, financial_review_queue TO authenticated;
GRANT SELECT ON public.tier_fixture TO authenticated;

BEGIN;
SELECT set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE c AS
  SELECT cls, public.books_tier_records('11111111-1111-4111-8111-111111111111', '2024', cls, 50, 0) AS j
  FROM unnest(ARRAY['tier_a', 'tier_b', 'tier_c', 'excluded', 'b_no_bank', 's274_needs_receipt', 'no_pay_no_ruling']) cls;
GRANT SELECT ON c TO PUBLIC;
SELECT pg_temp.ok('each class returns exactly its rows: A {D1}, B {D2, D3, D7}, C {D4, D5}, excluded {D6}, B with no bank line {D3}, section 274 with no document {D7}, no payment and no ruling {D4}',
  (SELECT bool_and(CASE cls
     WHEN 'tier_a' THEN ids = ARRAY['D1'] WHEN 'tier_b' THEN ids = ARRAY['D3', 'D7', 'D2'] WHEN 'tier_c' THEN ids = ARRAY['D4', 'D5']
     WHEN 'excluded' THEN ids = ARRAY['D6'] WHEN 'b_no_bank' THEN ids = ARRAY['D3'] WHEN 's274_needs_receipt' THEN ids = ARRAY['D7']
     WHEN 'no_pay_no_ruling' THEN ids = ARRAY['D4'] END)
   FROM (SELECT cls, ARRAY(SELECT r->'record'->>'local_id' FROM jsonb_array_elements(j->'rows') r) AS ids FROM c) x));
SELECT pg_temp.ok('rows are largest amount first (B: 300, 150, 60), the credit by its absolute amount',
  (SELECT ARRAY(SELECT r->'record'->>'local_id' FROM jsonb_array_elements(j->'rows') r) = ARRAY['D3', 'D7', 'D2'] FROM c WHERE cls = 'tier_b'));
SELECT pg_temp.ok('total and amount cover the whole class and equal the rollup''s own counts and dollars',
  (SELECT (c1.j->>'total')::int = y.a_n AND (c1.j->>'amount')::numeric = y.a_usd FROM c c1, public.v_books_audit_tier_years y WHERE c1.cls = 'tier_a' AND y.year = '2024')
  AND (SELECT (c1.j->>'total')::int = y.b_n AND (c1.j->>'amount')::numeric = y.b_usd FROM c c1, public.v_books_audit_tier_years y WHERE c1.cls = 'tier_b' AND y.year = '2024')
  AND (SELECT (c1.j->>'total')::int = y.c_n AND (c1.j->>'amount')::numeric = y.c_usd FROM c c1, public.v_books_audit_tier_years y WHERE c1.cls = 'tier_c' AND y.year = '2024')
  AND (SELECT (c1.j->>'total')::int = y.excluded_n AND (c1.j->>'amount')::numeric = y.excluded_usd FROM c c1, public.v_books_audit_tier_years y WHERE c1.cls = 'excluded' AND y.year = '2024')
  AND (SELECT (c1.j->>'total')::int = y.b_nobank_n AND (c1.j->>'amount')::numeric = y.b_nobank_usd FROM c c1, public.v_books_audit_tier_years y WHERE c1.cls = 'b_no_bank' AND y.year = '2024')
  AND (SELECT (c1.j->>'amount')::numeric = y.s274_needs_receipt_usd FROM c c1, public.v_books_audit_tier_years y WHERE c1.cls = 's274_needs_receipt' AND y.year = '2024')
  AND (SELECT (c1.j->>'amount')::numeric = y.no_pay_no_ruling_usd FROM c c1, public.v_books_audit_tier_years y WHERE c1.cls = 'no_pay_no_ruling' AND y.year = '2024'));
SELECT pg_temp.ok('the envelope is the close-out drill''s: assessed, total, amount, rows; a row carries its document and the record the table renders',
  (SELECT (j->>'assessed')::boolean AND j->>'reader' = 'books_tier_records' AND (j->>'total')::int = 3 AND (j->>'amount')::numeric = 510
          AND (j->'rows'->0->>'document_id') IS NOT NULL AND j->'rows'->0->'record'->>'source_key' = repeat('3', 64) AND j->'rows'->0->'record'->>'record_kind' = 'retained_ledger_decision'
          AND j->'rows'->0->'record'->>'amount' = '300.00' AND j->'rows'->0->'record'->>'section' = 'Expense'
   FROM c WHERE cls = 'tier_b'));
SELECT pg_temp.ok('a row carries its proof: tier, reason, proof basis, the flags and the citations the view used',
  (SELECT j->'rows'->0->'proof'->>'tier' = 'B' AND j->'rows'->0->'proof'->>'tier_reason' = 'synthetic reason for D3' AND j->'rows'->0->'proof'->>'proof_basis' = 'asset_register'
          AND j->'rows'->0->'proof'->>'structural_rule' = 'asset_register' AND (j->'rows'->0->'proof'->>'pay_proof')::boolean = false AND (j->'rows'->0->'proof'->>'has_owner_ruling')::boolean
          AND jsonb_array_length(j->'rows'->0->'proof'->'ruling_cites') = 1 AND jsonb_array_length(j->'rows'->0->'proof'->'structural_cites') = 1
   FROM c WHERE cls = 'tier_b'));
SELECT pg_temp.ok('paging: limit 1 offset 1 returns the second row and the same total',
  (SELECT (j->>'total')::int = 3 AND jsonb_array_length(j->'rows') = 1 AND j->'rows'->0->'record'->>'local_id' = 'D7'
   FROM (SELECT public.books_tier_records('11111111-1111-4111-8111-111111111111', '2024', 'tier_b', 1, 1) AS j) x));
SELECT pg_temp.ok('another year reads only its own rows; a year with no row in the class is total 0 with no rows',
  (SELECT (j->>'total')::int = 1 AND j->'rows'->0->'record'->>'local_id' = 'D8' FROM (SELECT public.books_tier_records('11111111-1111-4111-8111-111111111111', '2025', 'tier_c') AS j) x)
  AND (SELECT (j->>'total')::int = 0 AND (j->>'amount')::numeric = 0 AND jsonb_array_length(j->'rows') = 0 FROM (SELECT public.books_tier_records('11111111-1111-4111-8111-111111111111', '2025', 'tier_a') AS j) x));
SELECT pg_temp.fails('a bad year is refused', $q$SELECT public.books_tier_records('11111111-1111-4111-8111-111111111111', 'abc', 'tier_a')$q$, '22023');
SELECT pg_temp.fails('an unknown class is refused', $q$SELECT public.books_tier_records('11111111-1111-4111-8111-111111111111', '2024', 'tier_z')$q$, '22023');
SELECT pg_temp.fails('a limit of 0 is refused', $q$SELECT public.books_tier_records('11111111-1111-4111-8111-111111111111', '2024', 'tier_a', 0, 0)$q$, '22023');
SELECT pg_temp.fails('a limit above 250 is refused', $q$SELECT public.books_tier_records('11111111-1111-4111-8111-111111111111', '2024', 'tier_a', 251, 0)$q$, '22023');
SELECT pg_temp.fails('a negative offset is refused', $q$SELECT public.books_tier_records('11111111-1111-4111-8111-111111111111', '2024', 'tier_a', 10, -1)$q$, '22023');
COMMIT;

BEGIN;
SELECT set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok('a signed-in stranger reads total 0 and no rows of the owner''s book',
  (SELECT (j->>'total')::int = 0 AND jsonb_array_length(j->'rows') = 0 FROM (SELECT public.books_tier_records('11111111-1111-4111-8111-111111111111', '2024', 'tier_b') AS j) x));
COMMIT;
BEGIN;
SET LOCAL ROLE anon;
SELECT pg_temp.fails('anon cannot execute the reader (42501)', $q$SELECT public.books_tier_records('11111111-1111-4111-8111-111111111111', '2024', 'tier_a')$q$, '42501');
COMMIT;
SELECT pg_temp.ok('execute is granted to authenticated and service_role only; the reader is not a definer',
  has_function_privilege('authenticated', 'public.books_tier_records(uuid,text,text,integer,integer)', 'EXECUTE') AND has_function_privilege('service_role', 'public.books_tier_records(uuid,text,text,integer,integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.books_tier_records(uuid,text,text,integer,integer)', 'EXECUTE')
  AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.books_tier_records(uuid,text,text,integer,integer)'::regprocedure));
