\set ON_ERROR_STOP on
-- Disposable synthetic contract for books_gate_runs and its writer and readers (migration 20261106110000). Every id, name and
-- amount below is invented; books_year_gate is a stand-in whose definition the contract changes.
-- Covered: the store's keys, checks, append-only trigger, RLS and grants; the writer (service_role only, one receipt per run, a
-- result must name its owner and year, a failed run needs a reason, a context belongs to a complete run); the reader: rules in R-order with an unknown id last and
-- never dropped, no failing ids or detail text, stale when a document is touched or the gate definition changes, trusted only
-- for a fresh pass with no rule that checked nothing, the latest attempt, drafts on file, open return items by actor equal to
-- books_year_state's open_items, the summary; a stranger, the accounting reviewer and anon are refused; a re-apply changes nothing.
\ir test_financial_accounting.sql
ALTER TABLE auth.users ADD COLUMN email_confirmed_at timestamptz DEFAULT now();
CREATE TABLE accounting_access_grants(owner_id uuid, member_id uuid, active boolean NOT NULL DEFAULT true);
ALTER TABLE financial_document_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY financial_document_lines_owner_select ON financial_document_lines FOR SELECT USING (auth.uid()=owner_id);
CREATE POLICY financial_documents_delegate_read ON financial_documents FOR SELECT TO authenticated USING (false);
CREATE POLICY financial_lines_delegate_read ON financial_document_lines FOR SELECT TO authenticated USING (false);
CREATE POLICY financial_extractions_delegate_read ON financial_document_extractions FOR SELECT TO authenticated USING (false);
CREATE POLICY financial_concerns_delegate_read ON financial_review_queue FOR SELECT TO authenticated USING (false);
\ir ../migrations/20261023220500_accounting_delegate_read_hoisted.sql
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, year integer, make text, model text);
CREATE TABLE public.work_orders(id uuid PRIMARY KEY, title text);
GRANT SELECT ON public.vehicles, public.work_orders TO authenticated;
\ir ../migrations/20261028174500_accounting_closeout_readers.sql
\ir ../migrations/20261101170000_books_year_state.sql

-- Supabase's default privileges and its service role, which bypasses RLS.
ALTER ROLE service_role BYPASSRLS;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
-- Live shapes the migration relies on: the registry's append-only trigger function, the receipts table and the gate.
CREATE FUNCTION public.vein_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only: register a new version or append a new run', TG_TABLE_NAME; END $$;
CREATE TABLE public.write_receipts (
  id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), tbl text NOT NULL, op text NOT NULL, rows integer NOT NULL,
  writer text NOT NULL, db_role text NOT NULL, app_name text, txid bigint NOT NULL);
CREATE FUNCTION public.books_year_gate(p_owner_id uuid, p_year integer) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"stand_in": 1}'::jsonb $$;
\ir ../migrations/20261106110000_books_gate_runs.sql
\ir ../migrations/20261106110000_books_gate_runs.sql

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

-- Shape ------------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('the store carries its key, six checks, the append-only trigger and RLS with one owner-only SELECT policy',
  EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.books_gate_runs'::regclass AND contype = 'p')
  AND (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.books_gate_runs'::regclass AND contype = 'c') = 6
  AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'books_gate_runs_append_only' AND tgrelid = 'public.books_gate_runs'::regclass)
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.books_gate_runs'::regclass)
  AND (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.books_gate_runs'::regclass) = 1
  AND (SELECT polcmd = 'r' FROM pg_policy WHERE polrelid = 'public.books_gate_runs'::regclass));
SELECT pg_temp.ok('anon holds nothing on the store; authenticated may select but not write; only service_role may insert',
  NOT EXISTS (SELECT 1 FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p WHERE has_table_privilege('anon', 'public.books_gate_runs', p))
  AND has_table_privilege('authenticated', 'public.books_gate_runs', 'SELECT')
  AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p WHERE has_table_privilege('authenticated', 'public.books_gate_runs', p))
  AND has_table_privilege('service_role', 'public.books_gate_runs', 'SELECT') AND has_table_privilege('service_role', 'public.books_gate_runs', 'INSERT')
  AND NOT has_table_privilege('service_role', 'public.books_gate_runs', 'UPDATE') AND NOT has_table_privilege('service_role', 'public.books_gate_runs', 'DELETE'));
SELECT pg_temp.ok('the writer is callable by service_role only; the reader by authenticated and service_role, not anon; none is a definer',
  has_function_privilege('service_role', 'public.record_books_gate_run(uuid,integer,text,timestamptz,timestamptz,text,text,jsonb,text,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.record_books_gate_run(uuid,integer,text,timestamptz,timestamptz,text,text,jsonb,text,text,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.record_books_gate_run(uuid,integer,text,timestamptz,timestamptz,text,text,jsonb,text,text,jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.books_gate_status(uuid)', 'EXECUTE') AND has_function_privilege('service_role', 'public.books_gate_status(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.books_gate_status(uuid)', 'EXECUTE')
  AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid IN ('public.books_gate_status(uuid)'::regprocedure, 'public.record_books_gate_run(uuid,integer,text,timestamptz,timestamptz,text,text,jsonb,text,text,jsonb)'::regprocedure,
                                                    'public.books_book_signature(uuid)'::regprocedure, 'public.books_gate_md5()'::regprocedure) AND prosecdef));

-- The synthetic book: two 2024 drafts and one 2025 draft, and the facts register with open items for different actors ------------
BEGIN;
INSERT INTO auth.users(id) VALUES ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222'), ('33333333-3333-4333-8333-333333333333');
INSERT INTO accounting_access_grants(owner_id, member_id) VALUES ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333');
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $$ DECLARE
 u uuid := '11111111-1111-4111-8111-111111111111';
 draft1 jsonb := jsonb_build_object('sha256', repeat('c', 64), 'storage_path', u || '/draft-a.pdf', 'byte_size', 100, 'source_filename', 'draft-a.pdf');
 draft2 jsonb := jsonb_build_object('sha256', repeat('d', 64), 'storage_path', u || '/draft-b.pdf', 'byte_size', 100, 'source_filename', 'draft-b.pdf');
 draft3 jsonb := jsonb_build_object('sha256', repeat('e', 64), 'storage_path', u || '/draft-c.pdf', 'byte_size', 100, 'source_filename', 'draft-c.pdf');
 reg jsonb := jsonb_build_object('sha256', repeat('f', 64), 'storage_path', u || '/register.txt', 'byte_size', 100, 'source_filename', 'return-facts-register.txt');
 fact jsonb := jsonb_build_object('year', 2024, 'topic', 'other', 'date', '2026-10-29', 'decision', 'Synthetic.');
BEGIN
 PERFORM ingest_financial_evidence(u, draft1, jsonb_build_object('idempotency_key', 'draft-2024-a', 'method', 'tax-return-draft', 'version', '1',
   'fields', jsonb_build_array(jsonb_build_object('field_key', 'tax_return_summary', 'value_raw', '2024 draft a', 'evidence', jsonb_build_object('stage', 'generated_return_draft'),
     'value_normalized', jsonb_build_object('tax_year', '2024', 'result', 'owe', 'amount', 100, 'built_at', '2026-10-20T10:00:00Z')))));
 PERFORM ingest_financial_evidence(u, draft2, jsonb_build_object('idempotency_key', 'draft-2024-b', 'method', 'tax-return-draft', 'version', '1',
   'fields', jsonb_build_array(jsonb_build_object('field_key', 'tax_return_summary', 'value_raw', '2024 draft b', 'evidence', jsonb_build_object('stage', 'generated_return_draft'),
     'value_normalized', jsonb_build_object('tax_year', '2024', 'result', 'owe', 'amount', 120, 'built_at', '2026-10-25T10:00:00Z')))));
 PERFORM ingest_financial_evidence(u, draft3, jsonb_build_object('idempotency_key', 'draft-2025-a', 'method', 'tax-return-draft', 'version', '1',
   'fields', jsonb_build_array(jsonb_build_object('field_key', 'tax_return_summary', 'value_raw', '2025 draft', 'evidence', jsonb_build_object('stage', 'generated_return_draft'),
     'value_normalized', jsonb_build_object('tax_year', '2025', 'result', 'refund', 'amount', 50, 'built_at', '2026-10-26T10:00:00Z')))));
 PERFORM ingest_financial_evidence(u, reg, jsonb_build_object('idempotency_key', 'register-1', 'method', 'return_facts_register', 'version', '1',
   'fields', jsonb_build_array(
     jsonb_build_object('field_key', 'fact:2024:a', 'value_raw', 'a', 'evidence', jsonb_build_object('source', 's'), 'value_normalized', fact || jsonb_build_object('local_id', '2024-FACT-a', 'key', 'a', 'status', 'open', 'closes_with', 'x', 'actor', 'owner')),
     jsonb_build_object('field_key', 'fact:2024:b', 'value_raw', 'b', 'evidence', jsonb_build_object('source', 's'), 'value_normalized', fact || jsonb_build_object('local_id', '2024-FACT-b', 'key', 'b', 'status', 'open', 'closes_with', 'x', 'actor', 'cpa')),
     jsonb_build_object('field_key', 'fact:2024:c', 'value_raw', 'c', 'evidence', jsonb_build_object('source', 's'), 'value_normalized', fact || jsonb_build_object('local_id', '2024-FACT-c', 'key', 'c', 'status', 'open', 'closes_with', 'x')),
     jsonb_build_object('field_key', 'fact:2024:d', 'value_raw', 'd', 'evidence', jsonb_build_object('source', 's'), 'value_normalized', fact || jsonb_build_object('local_id', '2024-FACT-d', 'key', 'd', 'status', 'settled')),
     jsonb_build_object('field_key', 'fact:2024:e', 'value_raw', 'e', 'evidence', jsonb_build_object('source', 's'), 'value_normalized', fact || jsonb_build_object('local_id', '2024-FACT-e', 'key', 'e', 'status', 'open', 'closes_with', 'x', 'actor', 'owner', 'retired', true)),
     jsonb_build_object('field_key', 'fact:2025:a', 'value_raw', 'f', 'evidence', jsonb_build_object('source', 's'), 'value_normalized', fact || jsonb_build_object('local_id', '2025-FACT-a', 'key', 'a', 'year', 2025, 'status', 'open', 'closes_with', 'x', 'actor', 'agent')))));
END $$;
COMMIT;
GRANT SELECT ON financial_documents, financial_document_extractions, financial_document_lines, financial_review_queue TO authenticated, service_role;

-- The writer, as the service role -----------------------------------------------------------------------------------------------
CREATE FUNCTION pg_temp.gate_result(p_year int, p_pass boolean, p_rules jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('owner_id', '11111111-1111-4111-8111-111111111111', 'year', p_year, 'read_at', now(), 'pass', p_pass, 'failing', '[]'::jsonb, 'rules', p_rules)
$$;
CREATE FUNCTION pg_temp.rule(p_rule text, p_status text, p_n int, p_of int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('rule', p_rule, 'title', 'title of ' || p_rule, 'status', p_status, 'n', p_n, 'of', p_of, 'amount', 0, 'ids', jsonb_build_array('SECRET-ID-1'), 'detail', 'SECRET detail 12,345.67')
$$;
SET ROLE service_role;
CREATE TEMP TABLE written(label text, id uuid);
GRANT ALL ON written TO PUBLIC;
DO $$ DECLARE
 u uuid := '11111111-1111-4111-8111-111111111111'; sig text := public.books_book_signature(u); md5g text := public.books_gate_md5(); id uuid; t0 timestamptz := now() - interval '40 seconds';
BEGIN
 -- 2024: every rule passes but R2i checked nothing; supplied out of order, with an unknown id and one that has no number.
 id := public.record_books_gate_run(u, 2024, 'complete', t0, t0 + interval '30 seconds', sig, md5g,
   pg_temp.gate_result(2024, true, jsonb_build_array(pg_temp.rule('R10', 'pass', 0, 50) || '{"tiers":{"A":1},"b_no_bank":{"n":0},"excluded":{"n":0}}', pg_temp.rule('X1', 'pass', 0, 5), pg_temp.rule('R8b', 'pass', 0, 3),
     pg_temp.rule('R2i', 'pass', 0, 0), pg_temp.rule('R5', 'pass', 0, 170) || '{"grades":{"A":1,"B":2,"C":3,"R":4,"D":0},"ruling_only":{"n":4,"amount":10}}', pg_temp.rule('R11', 'pass', 0, 9), pg_temp.rule('R2', 'pass', 0, 27),
     (pg_temp.rule('R8a', 'pass', 0, 1) - 'of'))), NULL, 'contract',
   '{"deductions":{"n":50,"usd":5000},"no_bank":{"n":4,"usd":300},"no_pay_no_ruling":{"n":1,"usd":120},"head":{"n":40,"usd":4000,"year_usd":5000}}');
 INSERT INTO written VALUES ('2024', id);
 -- 2025: one rule fails and one is not assessed.
 id := public.record_books_gate_run(u, 2025, 'complete', t0, t0 + interval '20 seconds', sig, md5g,
   pg_temp.gate_result(2025, false, jsonb_build_array(pg_temp.rule('R1', 'pass', 0, 100), pg_temp.rule('R3', 'fail', 2, 100), pg_temp.rule('R8b', 'not_assessed', 0, 4),
     pg_temp.rule('R12', 'fail', 3, 40) || '{"by_flag":{"missing_doc":{"n":3,"amount":900}},"missing_doc":{"n":3,"amount":900,"cite_no_document":1,"by_kind":{"invoice_or_agreement":{"n":3,"amount":900}},"ids":["SECRET-ID-2"]}}')), NULL, 'contract');
 INSERT INTO written VALUES ('2025', id);
 -- 2021: a clean year (no draft): every rule passed over a population, so it is trusted while fresh.
 id := public.record_books_gate_run(u, 2021, 'complete', t0, t0 + interval '10 seconds', sig, md5g,
   pg_temp.gate_result(2021, true, jsonb_build_array(pg_temp.rule('R1', 'pass', 0, 10), pg_temp.rule('R2', 'pass', 0, 4))), NULL, 'contract');
 INSERT INTO written VALUES ('2021', id);
 -- 2023: an earlier complete run, then a later attempt that timed out: the year shows the run and the later attempt.
 id := public.record_books_gate_run(u, 2023, 'complete', t0 - interval '1 day', t0 - interval '1 day' + interval '25 seconds', sig, md5g,
   pg_temp.gate_result(2023, true, jsonb_build_array(pg_temp.rule('R1', 'pass', 0, 10))), NULL, 'contract');
 id := public.record_books_gate_run(u, 2023, 'timed_out', t0, t0 + interval '120 seconds', sig, md5g, NULL, 'statement timeout after 120 s', 'contract');
 INSERT INTO written VALUES ('2023 timed out', id);
 -- 2022: only a failed attempt.
 id := public.record_books_gate_run(u, 2022, 'error', t0, t0 + interval '2 seconds', sig, md5g, NULL, 'synthetic error', 'contract');
END $$;
RESET ROLE;
SELECT pg_temp.ok('six attempts were stored with six receipts under the writer, the duration derived from the clock',
  (SELECT count(*) FROM public.books_gate_runs) = 6
  AND (SELECT count(*) FROM public.write_receipts WHERE tbl = 'books_gate_runs' AND op = 'INSERT' AND rows = 1 AND writer = 'record_books_gate_run' AND db_role = 'service_role') = 6
  AND (SELECT duration_ms FROM public.books_gate_runs WHERE tax_year = 2024) = 30000);

-- The writer's refusals -----------------------------------------------------------------------------------------------------------
SELECT pg_temp.fails('a result that names another year is not filed under this one', $q$SELECT public.record_books_gate_run('11111111-1111-4111-8111-111111111111', 2024, 'complete', now(), now(), 's', 'm',
  pg_temp.gate_result(2025, true, '[]'), NULL, 'attack')$q$, '22023');
SELECT pg_temp.fails('a result that names another owner is not filed under this one', $q$SELECT public.record_books_gate_run('22222222-2222-4222-8222-222222222222', 2024, 'complete', now(), now(), 's', 'm',
  pg_temp.gate_result(2024, true, '[]'), NULL, 'attack')$q$, '22023');
SELECT pg_temp.fails('a complete run needs a result', $q$SELECT public.record_books_gate_run('11111111-1111-4111-8111-111111111111', 2024, 'complete', now(), now(), 's', 'm', NULL, NULL, 'attack')$q$, '22023');
SELECT pg_temp.fails('a run that did not complete needs a reason', $q$SELECT public.record_books_gate_run('11111111-1111-4111-8111-111111111111', 2024, 'timed_out', now(), now(), 's', 'm', NULL, NULL, 'attack')$q$, '23514');
SELECT pg_temp.fails('a context belongs to a complete run', $q$SELECT public.record_books_gate_run('11111111-1111-4111-8111-111111111111', 2024, 'error', now(), now(), 's', 'm', NULL, 'x', 'attack', '{"a":1}')$q$, '22023');
SELECT pg_temp.fails('a context is an object', $q$SELECT public.record_books_gate_run('11111111-1111-4111-8111-111111111111', 2024, 'complete', now(), now(), 's', 'm',
  pg_temp.gate_result(2024, true, '[]'), NULL, 'attack', '[1]')$q$, '22023');
SELECT pg_temp.fails('the writer must name its caller', $q$SELECT public.record_books_gate_run('11111111-1111-4111-8111-111111111111', 2024, 'error', now(), now(), 's', 'm', NULL, 'x', ' ')$q$, '22023');
SELECT pg_temp.fails('an unknown status is refused', $q$SELECT public.record_books_gate_run('11111111-1111-4111-8111-111111111111', 2024, 'maybe', now(), now(), 's', 'm', NULL, 'x', 'attack')$q$, '23514');
SELECT pg_temp.fails('a year outside 2000-2100 is refused', $q$SELECT public.record_books_gate_run('11111111-1111-4111-8111-111111111111', 1999, 'error', now(), now(), 's', 'm', NULL, 'x', 'attack')$q$, '23514');
SELECT pg_temp.fails('a stored pass that disagrees with the result is refused', $q$INSERT INTO public.books_gate_runs (owner_id, tax_year, status, started_at, finished_at, duration_ms, book_signature, gate_md5, pass, result, registered_by)
  VALUES ('11111111-1111-4111-8111-111111111111', 2024, 'complete', now(), now(), 0, 's', 'm', false, pg_temp.gate_result(2024, true, '[]'), 'attack')$q$, '23514');
SELECT pg_temp.fails('UPDATE is refused (append-only)', $q$UPDATE public.books_gate_runs SET error = 'x'$q$, 'P0001');
SELECT pg_temp.fails('DELETE is refused (append-only)', $q$DELETE FROM public.books_gate_runs$q$, 'P0001');
SELECT pg_temp.ok('the refused attempts left nothing behind', (SELECT count(*) FROM public.books_gate_runs) = 6);

-- The reader, as the owner ---------------------------------------------------------------------------------------------------------
BEGIN;
SELECT set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE s1 AS SELECT public.books_gate_status('11111111-1111-4111-8111-111111111111') AS j;
GRANT SELECT ON s1 TO PUBLIC;
SELECT pg_temp.ok('years are the return drafts union the stored runs, newest first: 2025, 2024, 2023, 2022, 2021',
  (SELECT array_agg((y->>'year')::int) FROM s1, jsonb_array_elements(j->'years') y) = ARRAY[2025, 2024, 2023, 2022, 2021]);
SELECT pg_temp.ok('2024 rules come back in R-order: R2, R2i, R5, R8a, R8b, R10, then the unknown R11 and the unnumbered X1; none dropped',
  (SELECT array_agg(r->>'rule') FROM s1, jsonb_array_elements(j->'years') y, jsonb_array_elements(y->'run'->'rules') r WHERE y->>'year' = '2024')
    = ARRAY['R2', 'R2i', 'R5', 'R8a', 'R8b', 'R10', 'R11', 'X1']);
SELECT pg_temp.ok('no failing id and no detail text is returned anywhere',
  (SELECT j::text !~ 'SECRET' AND j::text !~ '"ids"' AND j::text !~ '"detail"' FROM s1));
SELECT pg_temp.ok('R5 carries its grades and R10 its extras; n, of and amount ride on every rule',
  (SELECT (r->'grades'->>'R')::int = 4 AND (r->'ruling_only'->>'n')::int = 4 FROM s1, jsonb_array_elements(j->'years') y, jsonb_array_elements(y->'run'->'rules') r WHERE y->>'year' = '2024' AND r->>'rule' = 'R5')
  AND (SELECT r->'tiers'->>'A' = '1' FROM s1, jsonb_array_elements(j->'years') y, jsonb_array_elements(y->'run'->'rules') r WHERE y->>'year' = '2024' AND r->>'rule' = 'R10')
  AND (SELECT bool_and(r ? 'n' AND r ? 'of' AND r ? 'amount') FROM s1, jsonb_array_elements(j->'years') y, jsonb_array_elements(y->'run'->'rules') r WHERE y->>'year' = '2024' AND r->>'rule' <> 'R8a'));
SELECT pg_temp.ok('the run carries its context (the denominators) exactly as stored; a run recorded without one reports null',
  (SELECT y->'run'->'context'->'deductions'->>'usd' = '5000' AND y->'run'->'context'->'no_pay_no_ruling'->>'n' = '1' AND y->'run'->'context'->'head'->>'year_usd' = '5000'
   FROM s1, jsonb_array_elements(j->'years') y WHERE y->>'year' = '2024')
  AND (SELECT jsonb_typeof(y->'run'->'context') = 'null' FROM s1, jsonb_array_elements(j->'years') y WHERE y->>'year' = '2025'));
SELECT pg_temp.ok('R12 carries what it found by kind of document and flag, with no id',
  (SELECT (r->'missing_doc'->>'n')::int = 3 AND (r->'missing_doc'->>'amount')::numeric = 900 AND (r->'missing_doc'->'by_kind'->'invoice_or_agreement'->>'n')::int = 3
          AND (r->'by_flag'->'missing_doc'->>'amount')::numeric = 900 AND NOT (r->'missing_doc' ? 'ids') AND NOT (r ? 'ids')
   FROM s1, jsonb_array_elements(j->'years') y, jsonb_array_elements(y->'run'->'rules') r WHERE y->>'year' = '2025' AND r->>'rule' = 'R12'));
SELECT pg_temp.ok('2024: a fresh pass in which R2i checked nothing is passed but not trusted; rule_counts say why',
  (SELECT (y->'run'->>'pass')::boolean AND NOT (y->'run'->>'stale')::boolean AND NOT (y->'run'->>'trusted')::boolean
          AND (y->'run'->'rule_counts'->>'empty')::int = 1 AND (y->'run'->'rule_counts'->>'total')::int = 8 AND (y->'run'->'rule_counts'->>'pass')::int = 8
   FROM s1, jsonb_array_elements(j->'years') y WHERE y->>'year' = '2024'));
SELECT pg_temp.ok('2021: a fresh pass over populations only is trusted',
  (SELECT (y->'run'->>'trusted')::boolean FROM s1, jsonb_array_elements(j->'years') y WHERE y->>'year' = '2021'));
SELECT pg_temp.ok('2025: failing rules and a rule not assessed are counted apart and the year is not trusted',
  (SELECT NOT (y->'run'->>'pass')::boolean AND NOT (y->'run'->>'trusted')::boolean AND (y->'run'->'rule_counts'->>'fail')::int = 2 AND (y->'run'->'rule_counts'->>'not_assessed')::int = 1
   FROM s1, jsonb_array_elements(j->'years') y WHERE y->>'year' = '2025'));
SELECT pg_temp.ok('2023: the complete run is kept and the later attempt that timed out is reported beside it',
  (SELECT jsonb_typeof(y->'run') = 'object' AND y->'attempt'->>'status' = 'timed_out' AND (y->'attempt'->>'duration_ms')::int = 120000
   FROM s1, jsonb_array_elements(j->'years') y WHERE y->>'year' = '2023'));
SELECT pg_temp.ok('2022: only a failed attempt: no run, the attempt says error',
  (SELECT jsonb_typeof(y->'run') = 'null' AND y->'attempt'->>'status' = 'error' FROM s1, jsonb_array_elements(j->'years') y WHERE y->>'year' = '2022'));
SELECT pg_temp.ok('drafts on file are counted and the newest draft''s document is named',
  (SELECT (y->>'drafts_on_file')::int = 2 AND (y->>'draft_document_id')::uuid = (SELECT document_id FROM public.accounting_return_drafts('11111111-1111-4111-8111-111111111111') WHERE tax_year = '2024')
   FROM s1, jsonb_array_elements(j->'years') y WHERE y->>'year' = '2024')
  AND (SELECT (y->>'drafts_on_file')::int = 1 FROM s1, jsonb_array_elements(j->'years') y WHERE y->>'year' = '2025')
  AND (SELECT y->>'draft_document_id' IS NULL FROM s1, jsonb_array_elements(j->'years') y WHERE y->>'year' = '2021'));
SELECT pg_temp.ok('open return items by who closes them: 2024 owner 1, cpa 1, unassigned 1 (the settled and the retired cells are not open); 2025 agent 1',
  (SELECT (y->'open_items'->>'total')::int = 3 AND (y->'open_items'->>'owner')::int = 1 AND (y->'open_items'->>'cpa')::int = 1 AND (y->'open_items'->>'agent')::int = 0 AND (y->'open_items'->>'unassigned')::int = 1
   FROM s1, jsonb_array_elements(j->'years') y WHERE y->>'year' = '2024')
  AND (SELECT (y->'open_items'->>'total')::int = 1 AND (y->'open_items'->>'agent')::int = 1 FROM s1, jsonb_array_elements(j->'years') y WHERE y->>'year' = '2025'));
SELECT pg_temp.ok('the open count is the one books_year_state lists: one definition of open',
  jsonb_array_length(public.books_year_state('11111111-1111-4111-8111-111111111111', 2024)->'open_items') = 3
  AND jsonb_array_length(public.books_year_state('11111111-1111-4111-8111-111111111111', 2025)->'open_items') = 1);
SELECT pg_temp.ok('the summary: 5 years, 4 with a complete run, 3 passed fresh, 2 trusted (2021 and 2023), 1 failing, 0 only not-assessed, 0 stale, 4 open items',
  (SELECT (j->'summary'->>'years')::int = 5 AND (j->'summary'->>'with_run')::int = 4 AND (j->'summary'->>'passed')::int = 3 AND (j->'summary'->>'trusted')::int = 2
          AND (j->'summary'->>'failing')::int = 1 AND (j->'summary'->>'not_assessed')::int = 0 AND (j->'summary'->>'stale')::int = 0 AND (j->'summary'->>'open_items')::int = 4 FROM s1));
COMMIT;

-- Stale when a document changes; stale when the gate definition changes -------------------------------------------------------------
-- A landing (a new source document admitted through the writer) changes the book's signature.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT ingest_financial_evidence('11111111-1111-4111-8111-111111111111', jsonb_build_object('sha256', repeat('9', 64), 'storage_path', '11111111-1111-4111-8111-111111111111/late.pdf', 'byte_size', 100, 'source_filename', 'late.pdf'),
  jsonb_build_object('idempotency_key', 'late-landing', 'method', 'synthetic', 'version', '1',
    'fields', jsonb_build_array(jsonb_build_object('field_key', 'batch', 'value_raw', 'a later landing', 'evidence', jsonb_build_object('stage', 'retained')))));
COMMIT;
BEGIN;
SELECT set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE s2 AS SELECT public.books_gate_status('11111111-1111-4111-8111-111111111111') AS j;
GRANT SELECT ON s2 TO PUBLIC;
SELECT pg_temp.ok('a touched document marks every stored run stale because the books changed; a stale pass is not trusted',
  (SELECT bool_and((y->'run'->>'stale')::boolean AND (y->'run'->>'stale_books')::boolean AND NOT (y->'run'->>'stale_gate')::boolean)
   FROM s2, jsonb_array_elements(j->'years') y WHERE jsonb_typeof(y->'run') = 'object')
  AND NOT (SELECT (y->'run'->>'trusted')::boolean FROM s2, jsonb_array_elements(j->'years') y WHERE y->>'year' = '2021')
  AND (SELECT (j->'summary'->>'stale')::int = 4 AND (j->'summary'->>'passed')::int = 0 AND (j->'summary'->>'trusted')::int = 0 FROM s2));
COMMIT;
RESET ROLE;
CREATE OR REPLACE FUNCTION public.books_year_gate(p_owner_id uuid, p_year integer) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"stand_in": 2}'::jsonb $$;
BEGIN;
SELECT set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE s3 AS SELECT public.books_gate_status('11111111-1111-4111-8111-111111111111') AS j;
GRANT SELECT ON s3 TO PUBLIC;
SELECT pg_temp.ok('a changed gate definition marks the runs stale because the gate changed',
  (SELECT bool_and((y->'run'->>'stale_gate')::boolean) FROM s3, jsonb_array_elements(j->'years') y WHERE jsonb_typeof(y->'run') = 'object')
  AND (SELECT j->>'gate_md5' <> (SELECT run_md5 FROM (SELECT gate_md5 AS run_md5 FROM public.books_gate_runs LIMIT 1) q) FROM s3));
COMMIT;

-- Who may read ------------------------------------------------------------------------------------------------------------------------
BEGIN;
SELECT set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.fails('a signed-in stranger is refused the owner''s status (42501), not handed an empty list', $q$SELECT public.books_gate_status('11111111-1111-4111-8111-111111111111')$q$, '42501');
SELECT pg_temp.ok('a signed-in stranger reads no row of the store', (SELECT count(*) FROM public.books_gate_runs) = 0);
SELECT pg_temp.fails('a signed-in stranger cannot write the store', $q$INSERT INTO public.books_gate_runs (owner_id, tax_year, status, started_at, finished_at, duration_ms, book_signature, gate_md5, error, registered_by)
  VALUES ('22222222-2222-4222-8222-222222222222', 2024, 'error', now(), now(), 0, 's', 'm', 'x', 'attack')$q$, '42501');
SELECT pg_temp.fails('a signed-in stranger cannot call the writer', $q$SELECT public.record_books_gate_run('22222222-2222-4222-8222-222222222222', 2024, 'error', now(), now(), 's', 'm', NULL, 'x', 'attack')$q$, '42501');
COMMIT;
BEGIN;
SELECT set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
SET LOCAL ROLE authenticated;
-- The reviewer grant reads every older accounting reader by design; this store and its reader exclude him.
SELECT pg_temp.ok('the reviewer''s grant admits him to the book''s documents (the older readers)', (SELECT count(*) FROM public.financial_documents WHERE owner_id = '11111111-1111-4111-8111-111111111111') > 0);
SELECT pg_temp.fails('the accounting reviewer is refused the owner''s gate status (42501)', $q$SELECT public.books_gate_status('11111111-1111-4111-8111-111111111111')$q$, '42501');
SELECT pg_temp.ok('the accounting reviewer reads no row of the store', (SELECT count(*) FROM public.books_gate_runs) = 0);
COMMIT;
BEGIN;
SET LOCAL ROLE anon;
SELECT pg_temp.fails('anon cannot execute the status reader (42501)', $q$SELECT public.books_gate_status('11111111-1111-4111-8111-111111111111')$q$, '42501');
SELECT pg_temp.fails('anon cannot select the store (42501)', $q$SELECT count(*) FROM public.books_gate_runs$q$, '42501');
SELECT pg_temp.fails('anon cannot execute the writer (42501)', $q$SELECT public.record_books_gate_run('11111111-1111-4111-8111-111111111111', 2024, 'error', now(), now(), 's', 'm', NULL, 'x', 'attack')$q$, '42501');
COMMIT;
BEGIN;
SET LOCAL ROLE service_role;
SELECT pg_temp.ok('the service role can read the status of any book (the admin and script path)', jsonb_typeof(public.books_gate_status('11111111-1111-4111-8111-111111111111')->'years') = 'array');
COMMIT;

-- A re-apply changes nothing ---------------------------------------------------------------------------------------------------------
SELECT pg_temp.ok('the migration was applied twice without error and left one policy, one trigger and the same grants',
  (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.books_gate_runs'::regclass) = 1
  AND (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.books_gate_runs'::regclass AND NOT tgisinternal) = 1);
