-- Disposable synthetic contract; no production data. Every name, account and amount below is invented.
-- Reproduces three revenue-booking failures and the controls that must keep passing:
--   1. an incoming "bank to bank transfer" booked as revenue with no payer, whose original classification was an
--      own-account transfer (and, separately, a credit whose opposite movement sits in another own account);
--   2. a cash deposit booked as revenue that is part of a larger cash receipt already booked in Revenue that day;
--   3. a credit from a registered related party booked as customer revenue against an invoice addressed to a
--      different name.
\set ON_ERROR_STOP on
\ir test_accounting_delegation.sql
\ir ../migrations/20261023200300_financial_accounting_records_view.sql
\ir ../migrations/20261023201000_financial_accounting_records_view_grants.sql
\ir ../migrations/20261023220500_accounting_delegate_read_hoisted.sql
\ir ../migrations/20261025083500_accounting_records_bounded_reads.sql
ALTER TABLE financial_document_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_document_lines_owner_select ON financial_document_lines;
CREATE POLICY financial_document_lines_owner_select ON financial_document_lines FOR SELECT USING (auth.uid() = owner_id);
-- Live table grants are broad and row security does the scoping; mirror the read side.
GRANT SELECT ON financial_documents, financial_document_lines, financial_document_extractions, financial_review_queue TO authenticated;
-- The live counterparty registry, as it stands before this change (RLS on, no policy, broad table grants).
CREATE TABLE public.financial_operator_entities(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL, org_id uuid, entity_name text NOT NULL,
  name_patterns text[] NOT NULL DEFAULT '{}', tax_ids text[] NOT NULL DEFAULT '{}', created_at timestamptz DEFAULT now(),
  UNIQUE (owner_id, entity_name));
ALTER TABLE public.financial_operator_entities ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.financial_operator_entities TO anon, authenticated, service_role;
INSERT INTO public.financial_operator_entities(owner_id, entity_name, name_patterns)
VALUES ('99999999-9999-4999-8999-999999999999', 'SYNTHETIC OPERATOR ORG', '{SYNTHETIC OPERATOR ORG}');

\ir ../migrations/20261028161800_financial_revenue_evidence_gate.sql
-- Re-applying is a no-op (the guard accepts the reviewed post-image).
\ir ../migrations/20261028161800_financial_revenue_evidence_gate.sql

BEGIN;
INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
  ('55555555-5555-4555-8555-555555555555', 'book@example.invalid', now()),
  ('66666666-6666-4666-8666-666666666666', 'stranger@example.invalid', now());
INSERT INTO profiles VALUES ('55555555-5555-4555-8555-555555555555', 'bookowner', 'Synthetic Owner');

CREATE FUNCTION pg_temp.rec(p_kind text, p_local text, p_date text, p_account text, p_amount text, p_section text,
  p_description text, p_decision text, p_status text, p_links jsonb DEFAULT '[]', p_ref text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'record_kind', p_kind, 'source_key', md5(p_local) || md5(p_local || '#'), 'source_sha256', repeat('5', 64),
    'source_row', 1, 'local_id', p_local, 'year', left(p_date, 4), 'date', p_date, 'account', p_account,
    'currency', 'USD', 'currency_basis', 'synthetic USD', 'amount', p_amount, 'section', p_section,
    'category', CASE WHEN p_section = 'Revenue' THEN 'Customer work' ELSE 'Synthetic' END,
    'description', p_description, 'decision', p_decision, 'status', p_status, 'source_reference', p_ref,
    'bank_links', p_links,
    'recognition_status', CASE WHEN p_kind = 'retained_ledger_decision' THEN 'retained_decision' ELSE 'not_applicable' END,
    'payment_status', 'unresolved', 'vehicle_status', 'unresolved', 'reimbursement_status', 'unresolved',
    'entity_status', 'retained_scope_unallocated'))
$$;
CREATE TEMP TABLE fx(k text PRIMARY KEY, v jsonb);
GRANT ALL ON fx TO authenticated;

SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $$ DECLARE
  u uuid := '55555555-5555-4555-8555-555555555555';
  M text := 'retained_bank_movement'; D text := 'retained_ledger_decision';
  stmt jsonb := jsonb_build_object('sha256', repeat('1', 64), 'storage_path', u || '/statements.csv', 'byte_size', 100);
  ledger jsonb := jsonb_build_object('sha256', repeat('2', 64), 'storage_path', u || '/ledger.csv', 'byte_size', 100);
  base jsonb := '{"method":"synthetic-fixture","version":"1","fields":[{"field_key":"batch","value_raw":"synthetic","evidence":{"stage":"fixture"}}]}';
  movements jsonb; decisions jsonb; a jsonb; b jsonb; rp jsonb;
BEGIN
  -- B. Registry: a related party with an ampersand pattern; operator-owned rows are untouched and cannot be converted.
  rp := set_financial_related_party('Example Holdings', ARRAY['example holdings', ' E&H '], 'Synthetic: owned by a relative (fixture)', u);
  IF rp->>'relationship' <> 'related_party' OR NOT (rp->'name_patterns' ? 'E&H') THEN RAISE EXCEPTION 'related party not registered: %', rp; END IF;
  BEGIN
    PERFORM set_financial_related_party('SYNTHETIC OPERATOR ORG', ARRAY['X'], 'conversion attempt', '99999999-9999-4999-8999-999999999999');
    RAISE EXCEPTION 'operator-owned row converted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM IN ('operator-owned row converted') THEN RAISE; END IF; END;
  IF (SELECT relationship FROM financial_operator_entities WHERE entity_name = 'SYNTHETIC OPERATOR ORG') <> 'operator_owned'
  THEN RAISE EXCEPTION 'existing operator row lost its meaning'; END IF;

  movements := jsonb_build_array(
    -- Case 1: original classification was an own-account transfer; no payer anywhere.
    pg_temp.rec(M, 'mv-wire', '2024-04-17', 'Synthetic CU 1111 Checking', '1250.00', 'Revenue', 'BANK TO BANK TRANSFER',
      'Prior supplied workpaper category: Transfer between own accounts (synthetic reviewer).', 'Retained supplied classification', '["dec-wire"]'),
    -- Case 1b: an opposite movement in another own account two days earlier.
    pg_temp.rec(M, 'mv-in-500', '2024-06-03', 'Synthetic CU 1111 Checking', '500.00', 'Revenue', 'ONLINE TRANSFER',
      'Statement line.', 'Statement line'),
    pg_temp.rec(M, 'mv-out-500', '2024-06-01', 'Synthetic Bank 3333', '-500.00', 'Transfer', 'TRANSFER TO CU SHARE',
      'Statement line.', 'Statement line'),
    -- Control: a customer receipt whose only same-amount outflow elsewhere is an ordinary purchase (weak, not a transfer).
    pg_temp.rec(M, 'mv-cust-2000', '2024-07-10', 'Synthetic CU 1111 Checking', '2000.00', 'Revenue', 'ZELLE JANE DOE 555-555-5555;REF;CR',
      'Statement line.', 'Linked', '["dec-cust-2000"]'),
    pg_temp.rec(M, 'mv-store-2000', '2024-07-12', 'Synthetic Card 4444', '-2000.00', 'Expense', 'HARDWARE STORE PURCHASE',
      'Statement line.', 'Statement line'),
    -- Case 2: the deposit line behind the deposit decision.
    pg_temp.rec(M, 'mv-dep-1020', '2024-05-01', 'Synthetic CU 2222 Checking', '1020.00', 'Reference', 'CHECKING DEP FROM CASH RECEIVED',
      'Statement line.', 'Linked', '["dec-dep-1020"]'),
    -- Case 3: the processor line names the related party as payer.
    pg_temp.rec(M, 'mv-eh-5248', '2024-01-14', 'Synthetic Wallet', '5248.20', 'Revenue', 'Example Holdings | Mobile Payment | USD 5,248.20',
      'Statement line.', 'Linked', '["dec-eh-5248"]'),
    -- Control: an old own-transfer label on a wire that an invoice later tied to a named customer.
    pg_temp.rec(M, 'mv-wire-cust', '2024-09-09', 'Synthetic CU 1111 Checking', '3000.00', 'Revenue', 'BANK TO BANK TRANSFER',
      'Prior supplied workpaper category: Transfer between own accounts (synthetic reviewer).', 'Linked', '["dec-wire-cust"]'),
    -- Prior-year style: a Revenue statement line with no decision and no evidence.
    pg_temp.rec(M, 'mv-check-2023', '2023-09-01', 'Synthetic CU 1111 Checking', '700.00', 'Revenue', 'DEPOSITED 0001 CHECK ITEMS',
      'Statement line.', 'Statement line'));
  decisions := jsonb_build_array(
    pg_temp.rec(D, 'dec-wire', '2024-04-17', 'Synthetic CU 1111 Checking', '1250.00', 'Revenue', 'incoming wire, sender unknown',
      'Added by a reviewer; sender not named on the statement.', 'Included'),
    pg_temp.rec(D, 'dec-cust-2000', '2024-07-10', 'Synthetic CU 1111 Checking', '2000.00', 'Revenue', 'Customer payment',
      'Income allocation: payer Jane Doe - synthetic repair, invoice SYN1001 (2024-07-01).', 'Included'),
    pg_temp.rec(D, 'dec-cash-4000', '2024-05-01', 'Cash (not deposited)', '4000.00', 'Revenue', 'Synthetic customer cash payment toward a build',
      'Cash received toward the build; confirmed received by owner.', 'Included: owner-confirmed cash receipt'),
    pg_temp.rec(D, 'dec-dep-1020', '2024-05-01', 'Synthetic CU 2222 Checking', '1020.00', 'Revenue', 'CHECKING DEP FROM CASH RECEIVED',
      'Presumed income until explained.', 'Included'),
    pg_temp.rec(D, 'dec-eh-5248', '2024-01-14', 'Synthetic Wallet', '5248.20', 'Revenue', 'Other E&H funding',
      'Reclassified from a client advance. Income allocation: payer Northwind Studio (association), invoice 202401001 (2024-01-14).',
      'Included: invoice 202401001 to Northwind Studio'),
    pg_temp.rec(D, 'dec-owner-ok', '2024-08-01', 'Synthetic CU 1111 Checking', '300.00', 'Revenue', 'MOBILE DEPOSIT',
      'Owner attestation 2024-08-02: synthetic customer paid for storage.', 'Included'),
    pg_temp.rec(D, 'dec-wire-cust', '2024-09-09', 'Synthetic CU 1111 Checking', '3000.00', 'Revenue', 'Sample Client wire',
      'Income allocation (synthetic): entity Synthetic Co; payer Sample Client; nature customer work; invoice SYN2002 (2024-09-01).', 'Included'),
    pg_temp.rec(D, 'dec-rebate', '2024-08-10', 'Synthetic Wallet', '1.25', 'Revenue', 'Debit Card Cash Back Bonus', 'Synthetic.', 'Included'),
    pg_temp.rec(D, 'dec-expense', '2024-08-01', 'Synthetic CU 1111 Checking', '80.00', 'Expense', 'Parts', 'Synthetic.', 'Included'));
  -- The ledger lands first, then the statements; each write runs the gate on its own document.
  b := ingest_financial_evidence(u, ledger, base || jsonb_build_object('idempotency_key', 'ledger-1', 'accounting_records', decisions));
  a := ingest_financial_evidence(u, stmt, base || jsonb_build_object('idempotency_key', 'stmt-1', 'accounting_records', movements));
  -- Statement lines linked to a decision are judged with it; the two unlinked Revenue lines got their own questions.
  IF (SELECT array_agg(x->>'local_id' ORDER BY x->>'local_id') FROM jsonb_array_elements(a->'revenue_evidence_gate'->'failing') x
      WHERE (x->>'desk_question_filed')::boolean) <> ARRAY['mv-check-2023', 'mv-in-500']
  THEN RAISE EXCEPTION 'statement gate: %', a->'revenue_evidence_gate'; END IF;
  -- An answered question does not count: close the one on the unlinked line.
  UPDATE financial_review_queue SET status = 'resolved' WHERE position('mv-in-500' IN detail) > 0;
  -- New documents: every failing Revenue record is new, so the writer filed one gate question per failure.
  IF (b->'revenue_evidence_gate'->>'checked')::int <> 8 THEN RAISE EXCEPTION 'writer did not check the ledger revenue: %', b->'revenue_evidence_gate'; END IF;
  INSERT INTO fx VALUES ('stmt', a), ('ledger', b), ('movements', movements), ('decisions', decisions);
END $$;

-- A. The matcher, as the owner (SECURITY INVOKER through RLS).
SELECT set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE
  u uuid := '55555555-5555-4555-8555-555555555555'; m jsonb; r jsonb;
BEGIN
  m := financial_counterpart_matches(u, '2024-01-01', '2024-12-31');
  IF (m->>'credits')::int <> 9 THEN RAISE EXCEPTION 'expected 9 credits (8 Revenue decisions + 1 unlinked Revenue line), got %: %', m->>'credits', m; END IF;
  SELECT x INTO r FROM jsonb_array_elements(m->'rows') x WHERE x->>'local_id' = 'dec-wire';
  IF r->>'class' <> 'own_transfer' OR r->>'prior_own_transfer_classification' <> 'mv-wire' THEN RAISE EXCEPTION 'case 1 not an own transfer: %', r; END IF;
  SELECT x INTO r FROM jsonb_array_elements(m->'rows') x WHERE x->>'local_id' = 'mv-in-500';
  IF r->>'class' <> 'own_transfer' OR r->'counterparts'->0->>'local_id' <> 'mv-out-500' OR r->'counterparts'->0->>'strength' <> 'strong'
  THEN RAISE EXCEPTION 'case 1b counterpart missed: %', r; END IF;
  SELECT x INTO r FROM jsonb_array_elements(m->'rows') x WHERE x->>'local_id' = 'dec-cust-2000';
  IF r->>'class' <> 'unmatched' OR r->'counterparts'->0->>'strength' <> 'weak' OR r->>'memo_payer' <> 'JANE DOE'
  THEN RAISE EXCEPTION 'control: a purchase elsewhere made a customer receipt a transfer: %', r; END IF;
  SELECT x INTO r FROM jsonb_array_elements(m->'rows') x WHERE x->>'local_id' = 'dec-dep-1020';
  IF r->>'class' <> 'possible_split_of_booked_receipt' OR r->'booked_cash_receipts'->0->>'local_id' <> 'dec-cash-4000'
  THEN RAISE EXCEPTION 'case 2 split missed: %', r; END IF;
  SELECT x INTO r FROM jsonb_array_elements(m->'rows') x WHERE x->>'local_id' = 'dec-cash-4000';
  IF r->>'class' <> 'unmatched' THEN RAISE EXCEPTION 'the cash receipt matched itself: %', r; END IF;
  SELECT x INTO r FROM jsonb_array_elements(m->'rows') x WHERE x->>'local_id' = 'dec-eh-5248';
  IF r->>'class' <> 'related_party' OR r->'related_parties'->0->>'entity_name' <> 'Example Holdings' OR r->>'memo_payer' <> 'Example Holdings'
  THEN RAISE EXCEPTION 'case 3 related party missed: %', r; END IF;
  SELECT x INTO r FROM jsonb_array_elements(m->'rows') x WHERE x->>'local_id' = 'dec-wire-cust';
  IF r->>'class' <> 'own_transfer' OR r->>'transfer_basis' <> 'original_classification' THEN RAISE EXCEPTION 'old label not reported: %', r; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(m->'rows') x WHERE x ? 'record') THEN RAISE EXCEPTION 'matcher returned whole records'; END IF;

  -- C. Readiness test 7.
  m := financial_revenue_evidence_gate(u, '2024-01-01', '2024-12-31');
  SELECT x INTO r FROM jsonb_array_elements(m->'rows') x WHERE x->>'local_id' = 'dec-wire';
  IF NOT (r->'reasons' ? 'own_transfer') OR NOT (r->'reasons' ? 'no_evidence_reference') OR r->>'proposed_section' <> 'Transfer'
     OR r->'desk_question'->>'default' <> 'not revenue' OR position('dec-wire' IN r->'desk_question'->>'detail') = 0
  THEN RAISE EXCEPTION 'case 1 gate: %', r; END IF;
  SELECT x INTO r FROM jsonb_array_elements(m->'rows') x WHERE x->>'local_id' = 'dec-dep-1020';
  IF NOT (r->'reasons' ? 'part_of_booked_cash_receipt') OR r->>'proposed_section' <> 'Reference' OR r->'desk_question'->>'concern_type' <> 'doublon_suspect'
  THEN RAISE EXCEPTION 'case 2 gate: %', r; END IF;
  SELECT x INTO r FROM jsonb_array_elements(m->'rows') x WHERE x->>'local_id' = 'dec-eh-5248';
  IF NOT (r->'reasons' ? 'related_party_without_owner_attestation') OR NOT (r->'reasons' ? 'invoice_addressee_differs_from_payer')
     OR r->'reasons' ? 'no_evidence_reference' OR r->'evidence'->>'invoice' <> '202401001' OR r->'evidence'->>'addressee' <> 'Northwind Studio'
     OR r->>'proposed_section' <> 'Clearing'
  THEN RAISE EXCEPTION 'case 3 gate: %', r; END IF;
  SELECT x INTO r FROM jsonb_array_elements(m->'rows') x WHERE x->>'local_id' = 'dec-rebate';
  IF NOT (r->'reasons' ? 'card_rebate_not_customer_revenue') OR r->>'proposed_section' <> 'Reference' THEN RAISE EXCEPTION 'rebate: %', r; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(m->'rows') x WHERE x->>'local_id' IN ('dec-cust-2000', 'dec-cash-4000', 'dec-owner-ok', 'dec-wire-cust'))
  THEN RAISE EXCEPTION 'a record with evidence failed the gate: %', m; END IF;
  SELECT x INTO r FROM jsonb_array_elements(m->'rows') x WHERE x->>'local_id' = 'mv-in-500';
  IF (r->>'pnl_effect')::boolean OR r->>'proposed_section' <> 'Transfer' THEN RAISE EXCEPTION 'unlinked statement line: %', r; END IF;
  IF (m->>'population_pnl')::int <> 8 OR (m->>'failing_pnl')::int <> 4 OR (m->>'failing_amount')::numeric <> 7519.45
  THEN RAISE EXCEPTION 'gate totals: %', m - 'rows'; END IF;
  -- The writer filed a question for each new failing record; only the line whose question was answered lacks one.
  IF (m->>'failing_without_desk_question')::int <> 1 OR (m->>'passes')::boolean THEN RAISE EXCEPTION 'desk coverage: %', m - 'rows'; END IF;
  m := financial_revenue_evidence_gate(u, '2023-01-01', '2023-12-31');
  IF (m->>'failing')::int <> 1 OR NOT (m->'rows'->0->'reasons' ? 'no_evidence_reference') THEN RAISE EXCEPTION 'prior-year line: %', m; END IF;

  BEGIN PERFORM financial_revenue_evidence_gate(u, '2022-01-01', '2025-12-31'); RAISE EXCEPTION 'unbounded window accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'unbounded window accepted' THEN RAISE; END IF; END;
  IF EXISTS (SELECT 1 FROM financial_operator_entities) THEN RAISE EXCEPTION 'registry table readable directly'; END IF;
END $$;

-- Another account sees nothing of this book; anon cannot call the readers.
SELECT set_config('request.jwt.claim.sub', '66666666-6666-4666-8666-666666666666', true);
DO $$ BEGIN
  IF (financial_counterpart_matches('55555555-5555-4555-8555-555555555555', '2024-01-01', '2024-12-31')->>'credits')::int <> 0
    OR (financial_revenue_evidence_gate('55555555-5555-4555-8555-555555555555', '2024-01-01', '2024-12-31')->>'population')::int <> 0
    OR EXISTS (SELECT 1 FROM financial_related_parties('55555555-5555-4555-8555-555555555555'))
  THEN RAISE EXCEPTION 'readers crossed books'; END IF;
  BEGIN PERFORM set_financial_related_party('Intruder', ARRAY['X Y'], 'x', '55555555-5555-4555-8555-555555555555'); RAISE EXCEPTION 'stranger wrote the registry';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM financial_revenue_evidence_gate('55555555-5555-4555-8555-555555555555', '2024-01-01', '2024-12-31'); RAISE EXCEPTION 'anon ran the gate';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- The writer path: a correction that changes one failing record files a question for it alone; carried questions are
-- not duplicated; unchanged failures are reported only; a gate error never blocks the write.
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $$ DECLARE
  u uuid := '55555555-5555-4555-8555-555555555555';
  ledger jsonb := jsonb_build_object('sha256', repeat('2', 64), 'storage_path', u || '/ledger.csv', 'byte_size', 100);
  base jsonb := '{"method":"synthetic-fixture","version":"1","fields":[{"field_key":"batch","value_raw":"synthetic","evidence":{"stage":"fixture"}}]}';
  prior jsonb := (SELECT v FROM fx WHERE k = 'ledger'); decisions jsonb := (SELECT v FROM fx WHERE k = 'decisions');
  changed jsonb; carried jsonb; c jsonb; f jsonb; n int;
BEGIN
  IF (SELECT count(*) FROM financial_review_queue WHERE confidence_factors->>'method' = 'revenue-evidence-gate'
        AND confidence_factors->>'extraction_run_id' = prior->>'extraction_run_id') <> 4
  THEN RAISE EXCEPTION 'first ledger run should hold four gate questions'; END IF;
  -- Carry the existing questions except the one for the deposit, and change the deposit's status.
  SELECT jsonb_agg(jsonb_build_object('concern_type', q.concern_type, 'priority', q.priority, 'detail', q.detail, 'resolver', q.resolver))
    INTO carried FROM financial_review_queue q
   WHERE q.confidence_factors->>'extraction_run_id' = prior->>'extraction_run_id' AND position('dec-dep-1020' IN q.detail) = 0;
  SELECT jsonb_agg(CASE WHEN x->>'local_id' = 'dec-dep-1020' THEN x || '{"status":"Included (re-reviewed)"}' ELSE x END) INTO changed
    FROM jsonb_array_elements(decisions) x;
  c := ingest_financial_evidence(u, ledger, base || jsonb_build_object('idempotency_key', 'ledger-2', 'supersedes_run_id', prior->>'extraction_run_id',
         'accounting_records', changed, 'concerns', carried));
  f := c->'revenue_evidence_gate';
  IF (f->>'changed')::int <> 1 OR jsonb_array_length(f->'failing') <> 4 THEN RAISE EXCEPTION 'writer report: %', f; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(f->'failing') x WHERE (x->>'desk_question_filed')::boolean) <> 1
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(f->'failing') x WHERE x->>'local_id' = 'dec-dep-1020' AND (x->>'desk_question_filed')::boolean)
  THEN RAISE EXCEPTION 'only the changed deposit should get a new question: %', f; END IF;
  SELECT count(*) INTO n FROM financial_review_queue WHERE confidence_factors->>'extraction_run_id' = c->>'extraction_run_id';
  IF n <> 4 OR jsonb_array_length(c->'review_ids') <> 4 THEN RAISE EXCEPTION 'expected 3 carried + 1 gate question on the new run, found %', n; END IF;
  -- A record moved out of Revenue no longer fails, and a revision without Revenue records reports nothing.
  SELECT jsonb_agg(CASE WHEN x->>'section' = 'Revenue' THEN x || '{"section":"Clearing"}' ELSE x END) INTO changed FROM jsonb_array_elements(decisions) x;
  f := ingest_financial_evidence(u, ledger, base || jsonb_build_object('idempotency_key', 'ledger-3', 'supersedes_run_id', c->>'extraction_run_id',
         'accounting_records', changed));
  IF (f->'revenue_evidence_gate'->>'checked')::int <> 0 OR jsonb_array_length(f->'review_ids') <> 0 THEN RAISE EXCEPTION 'non-revenue revision: %', f; END IF;
  -- A broken gate is reported in the receipt; the write still lands.
  ALTER FUNCTION financial_revenue_gate_rows(uuid, date, date, uuid) RENAME TO financial_revenue_gate_rows_off;
  c := ingest_financial_evidence(u, ledger, base || jsonb_build_object('idempotency_key', 'ledger-4', 'supersedes_run_id', f->>'extraction_run_id',
         'accounting_records', decisions));
  ALTER FUNCTION financial_revenue_gate_rows_off(uuid, date, date, uuid) RENAME TO financial_revenue_gate_rows;
  IF c->'revenue_evidence_gate'->>'error' IS NULL OR c->>'extraction_run_id' IS NULL THEN RAISE EXCEPTION 'gate error blocked or vanished: %', c; END IF;
  RAISE NOTICE 'PASS revenue evidence gate: own transfer, split of a booked cash receipt, related party and addressee, desk questions, writer report';
END $$;
ROLLBACK;
