\set ON_ERROR_STOP on
-- Disposable synthetic contract for v_books_citation_links (migration 20261106120000). Every id, name and amount below is invented.
-- Covered: the five classes are exclusive and sum to the decisions of the year; the population is the Expense decisions that
-- v_books_audit_tiers tiers (a Closed status and a Revenue decision are outside); a link that is in no movement is counted as
-- written, not resolved; a movement shared by two decisions is larger than each and is not an amount match; anon cannot select;
-- a signed-in stranger sees no rows and the accounting reviewer sees what the book's delegate policy admits (pinned, by design); no API
-- role can write; a re-apply changes nothing.
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
-- Supabase's default privileges: write bits for the API roles on a new public object. The migration must take them away.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
\ir ../migrations/20261106120000_books_citation_links.sql
\ir ../migrations/20261106120000_books_citation_links.sql

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

BEGIN;
INSERT INTO auth.users(id) VALUES ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222'), ('33333333-3333-4333-8333-333333333333');
INSERT INTO accounting_access_grants(owner_id, member_id) VALUES ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333');
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $$ DECLARE
 u uuid := '11111111-1111-4111-8111-111111111111';
 o jsonb := jsonb_build_object('sha256', repeat('e', 64), 'storage_path', u || '/ledger.csv', 'byte_size', 100);
 dec jsonb := jsonb_build_object('record_kind', 'retained_ledger_decision', 'source_sha256', repeat('a', 64), 'source_row', 1, 'year', '2024', 'date', '2024-03-01',
   'account', 'Synthetic ledger', 'currency', 'USD', 'currency_basis', 'synthetic USD ledger', 'bank_links', '[]'::jsonb, 'recognition_status', 'retained_decision',
   'payment_status', 'unresolved', 'vehicle_status', 'unresolved', 'reimbursement_status', 'unresolved', 'entity_status', 'retained_scope_unallocated',
   'section', 'Expense', 'category', 'Parts', 'decision', 'Synthetic.');
 mv jsonb := dec || jsonb_build_object('record_kind', 'retained_bank_movement', 'recognition_status', 'not_applicable', 'account', 'Synthetic checking', 'section', NULL, 'category', NULL, 'decision', NULL);
 recs jsonb;
 n int := 0;
BEGIN
 recs := jsonb_build_array(
   -- 2024. D1 cites M1 and M1 lists D1 (both, amounts agree). D2 cites M2 only (cites_only). M3 lists D3 only (cited_by_only).
   dec || jsonb_build_object('local_id', 'D1', 'source_key', repeat('1', 64), 'amount', '100.00', 'bank_links', jsonb_build_array('M1')),
   dec || jsonb_build_object('local_id', 'D2', 'source_key', repeat('2', 64), 'amount', '50.00',  'bank_links', jsonb_build_array('M2')),
   dec || jsonb_build_object('local_id', 'D3', 'source_key', repeat('3', 64), 'amount', '70.00'),
   -- D4 cites an id that is in no movement (cites_missing); D5 cites nothing and nobody lists it (none).
   dec || jsonb_build_object('local_id', 'D4', 'source_key', repeat('4', 64), 'amount', '30.00',  'bank_links', jsonb_build_array('GHOST-1')),
   dec || jsonb_build_object('local_id', 'D5', 'source_key', repeat('5', 64), 'amount', '20.00'),
   -- D6 and D7 are both listed by the one 200.00 movement M4: tied, but the movement is larger than either.
   dec || jsonb_build_object('local_id', 'D6', 'source_key', repeat('6', 64), 'amount', '80.00'),
   dec || jsonb_build_object('local_id', 'D7', 'source_key', repeat('7', 64), 'amount', '120.00'),
   -- Outside the population: a Closed status (tiers skip it) and a Revenue decision.
   dec || jsonb_build_object('local_id', 'D8', 'source_key', repeat('8', 64), 'amount', '10.00',  'status', 'Closed: synthetic'),
   dec || jsonb_build_object('local_id', 'R1', 'source_key', repeat('9', 64), 'amount', '500.00', 'section', 'Revenue'),
   -- 2025. D10 cites M5 (in the books) and GHOST-2 (not): cites_only, two links, one resolved.
   dec || jsonb_build_object('local_id', 'D10', 'source_key', repeat('a', 64), 'amount', '40.00', 'year', '2025', 'date', '2025-02-01', 'bank_links', jsonb_build_array('M5', 'GHOST-2')),
   mv  || jsonb_build_object('local_id', 'M1', 'source_key', repeat('b', 64), 'amount', '-100.00', 'bank_links', jsonb_build_array('D1')),
   mv  || jsonb_build_object('local_id', 'M2', 'source_key', repeat('c', 64), 'amount', '-50.00'),
   mv  || jsonb_build_object('local_id', 'M3', 'source_key', repeat('d', 64), 'amount', '-70.00',  'bank_links', jsonb_build_array('D3')),
   mv  || jsonb_build_object('local_id', 'M4', 'source_key', repeat('e', 64), 'amount', '-200.00', 'bank_links', jsonb_build_array('D6', 'D7')),
   mv  || jsonb_build_object('local_id', 'M5', 'source_key', repeat('f', 64), 'amount', '-40.00', 'year', '2025', 'date', '2025-02-01'));
 PERFORM ingest_financial_evidence(u, o, jsonb_build_object('idempotency_key', 'synthetic-ties-1', 'method', 'synthetic-ties', 'version', '1',
   'fields', jsonb_build_array(jsonb_build_object('field_key', 'batch', 'value_raw', 'synthetic batch', 'evidence', jsonb_build_object('stage', 'retained'))),
   'accounting_records', recs));
END $$;
COMMIT;
GRANT SELECT ON financial_documents, financial_document_extractions, financial_document_lines, financial_review_queue TO authenticated;

-- The owner reads the book.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE y24 AS SELECT * FROM public.v_books_citation_links WHERE year = '2024';
CREATE TEMP TABLE y25 AS SELECT * FROM public.v_books_citation_links WHERE year = '2025';
GRANT SELECT ON y24, y25 TO PUBLIC;
SELECT pg_temp.ok('2024: seven Expense decisions (the Closed row and the Revenue row are outside), placed in exclusive classes that sum to seven',
  (SELECT decisions = 7 AND both_n + cites_only_n + cited_by_only_n + cites_missing_n + none_n = decisions FROM y24));
SELECT pg_temp.ok('2024 classes: both 1 (D1), cites_only 1 (D2), cited_by_only 3 (D3, D6, D7), cites_missing 1 (D4), none 1 (D5)',
  (SELECT both_n = 1 AND cites_only_n = 1 AND cited_by_only_n = 3 AND cites_missing_n = 1 AND none_n = 1 FROM y24));
SELECT pg_temp.ok('2024 links: three written (D1, D2, D4), two in the books; five decisions tied in either direction',
  (SELECT links = 3 AND links_resolved = 2 AND tied_n = 5 FROM y24));
SELECT pg_temp.ok('2024 amounts: D1, D2 and D3 equal their movement to the cent; D6 and D7 share a larger movement and do not count',
  (SELECT amount_equal_n = 3 FROM y24));
SELECT pg_temp.ok('2025: one decision that cites one movement in the books and one that is not: cites_only, two links, one resolved, amount equal',
  (SELECT decisions = 1 AND cites_only_n = 1 AND links = 2 AND links_resolved = 1 AND tied_n = 1 AND amount_equal_n = 1 AND both_n = 0 AND none_n = 0 FROM y25));
SELECT pg_temp.ok('a year with no Expense decision has no row', (SELECT count(*) FROM public.v_books_citation_links WHERE year NOT IN ('2024', '2025')) = 0);
COMMIT;

-- A signed-in stranger sees nothing of this book; the accounting reviewer sees what the book's delegate policy admits.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok('a signed-in stranger reads no rows', (SELECT count(*) FROM public.v_books_citation_links) = 0);
COMMIT;
BEGIN;
SELECT set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
SET LOCAL ROLE authenticated;
-- Known limit, pinned so it cannot change silently: the view reads the same RLS-bound base as v_books_audit_tiers and every older
-- accounting reader, and the book's own delegate policy admits an active reviewer grant to that base. The docket hides itself in a
-- shared book; narrowing the reviewer's read is the owner's call. (The gate store, books_gate_runs, does exclude the reviewer.)
SELECT pg_temp.ok('the accounting reviewer reads the same two year rows the book''s delegate policy admits (by design, as for the tier views)', (SELECT count(*) FROM public.v_books_citation_links) = 2);
COMMIT;

-- anon cannot select, and no API role can write.
DO $$ BEGIN
 SET LOCAL ROLE anon;
 BEGIN PERFORM count(*) FROM public.v_books_citation_links; RAISE EXCEPTION 'anon selected the citation links'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RESET ROLE;
 RAISE NOTICE 'PASS anon is refused with insufficient_privilege (42501)';
END $$;
SELECT pg_temp.ok('no API role holds a write bit on the view; authenticated and service_role may select; anon and PUBLIC may not',
  has_table_privilege('authenticated', 'public.v_books_citation_links', 'SELECT') AND has_table_privilege('service_role', 'public.v_books_citation_links', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.v_books_citation_links', 'SELECT')
  AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
                  WHERE has_table_privilege('anon', 'public.v_books_citation_links', p) OR has_table_privilege('authenticated', 'public.v_books_citation_links', p)
                     OR has_table_privilege('service_role', 'public.v_books_citation_links', p)));
SELECT pg_temp.ok('the view runs as its caller (security_invoker)',
  (SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class WHERE oid = 'public.v_books_citation_links'::regclass));
