-- Disposable synthetic contract; no production data. Every name, account and amount below is invented.
-- The related-party ledger: work owed, payments, advances and offsets between a book owner and one registered related
-- party, written only through record_related_party_ledger_entry and read point-in-time by related_party_ledger.
-- Checks: sign convention and both positions, evidence levels, links to current book records, idempotent replay,
-- supersession and withdrawal with event/recording clocks, append-only rows, owner-only reads and writes.
\set ON_ERROR_STOP on
\ir test_financial_revenue_evidence_gate.sql

-- Live shapes of the tables this change extends (they predate the migrations folder), minus unrelated foreign keys.
CREATE TABLE IF NOT EXISTS public.organizations(id uuid PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.vehicles(id uuid PRIMARY KEY);
CREATE TABLE public.financial_deals(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL, deal_number text,
  deal_type text NOT NULL DEFAULT 'other' CHECK (deal_type = ANY (ARRAY['ad_insertion','advertorial','cover_placement','licensing',
    'commission','production_service','print_procurement','distribution','event','subscription','other'])),
  deal_direction text NOT NULL DEFAULT 'unknown' CHECK (deal_direction = ANY (ARRAY['revenue','cost','internal','unknown'])),
  title text, season_label text, status text NOT NULL DEFAULT 'observed' CHECK (status = ANY (ARRAY['observed','cancelled','disputed'])),
  counterparty_name_raw text, counterparty_org_id uuid REFERENCES public.organizations(id), counterparty_person_id uuid,
  counterparty_role text, advertiser_name_raw text, advertiser_org_id uuid, agency_name_raw text, agency_org_id uuid,
  publication_id uuid, issue_id uuid, issue_canon text, placement_description text, ad_placement_id uuid,
  currency text CHECK (currency ~ '^[A-Z]{3}$'), rate_card_amount numeric, attributes jsonb NOT NULL DEFAULT '{}',
  privacy_tier text NOT NULL DEFAULT 'private', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX idx_fdeal_owner_number ON public.financial_deals(owner_id, deal_number) WHERE deal_number IS NOT NULL;
CREATE TABLE public.financial_payments(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL,
  direction text NOT NULL DEFAULT 'in' CHECK (direction = ANY (ARRAY['in','out'])), amount numeric NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), paid_at date, value_date date, method text,
  payer_name_raw text, payer_org_id uuid REFERENCES public.organizations(id), payer_person_id uuid,
  payee_name_raw text, payee_org_id uuid REFERENCES public.organizations(id), payee_person_id uuid, bank_reference text,
  deal_id uuid REFERENCES public.financial_deals(id) ON DELETE SET NULL,
  evidence_document_id uuid REFERENCES public.financial_documents(id), evidence_line_id uuid REFERENCES public.financial_document_lines(id),
  evidence_kind text NOT NULL DEFAULT 'remittance_advice' CHECK (evidence_kind = ANY (ARRAY['remittance_advice','bank_statement_line',
    'payment_receipt','email_confirmation','fec_entry','manual','other'])),
  confidence numeric, is_superseded boolean NOT NULL DEFAULT false, superseded_by uuid REFERENCES public.financial_payments(id),
  superseded_at timestamptz, attributes jsonb NOT NULL DEFAULT '{}', privacy_tier text NOT NULL DEFAULT 'private',
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE FUNCTION public.financial_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER trg_fdeal_touch BEFORE UPDATE ON public.financial_deals FOR EACH ROW EXECUTE FUNCTION financial_touch_updated_at();
CREATE TRIGGER trg_fpay_touch BEFORE UPDATE ON public.financial_payments FOR EACH ROW EXECUTE FUNCTION financial_touch_updated_at();
ALTER TABLE public.financial_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY financial_deals_owner_select ON public.financial_deals FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY financial_deals_owner_insert ON public.financial_deals FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY financial_deals_owner_update ON public.financial_deals FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY financial_payments_owner_select ON public.financial_payments FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY financial_payments_owner_insert ON public.financial_payments FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY financial_payments_owner_update ON public.financial_payments FOR UPDATE USING (auth.uid() = owner_id);
GRANT ALL ON public.financial_deals, public.financial_payments TO anon, authenticated, service_role;

\ir ../migrations/20261028213000_related_party_ledger.sql
-- Re-applying is a no-op.
\ir ../migrations/20261028213000_related_party_ledger.sql
\ir ../migrations/20261028223000_related_party_ledger_book_join.sql

-- Fixture, committed so the recording clocks of later steps differ.
CREATE TABLE fx(k text PRIMARY KEY, v text);
GRANT ALL ON fx TO authenticated, service_role;
INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
  ('55555555-5555-4555-8555-555555555555', 'book@example.invalid', now()),
  ('66666666-6666-4666-8666-666666666666', 'stranger@example.invalid', now());
INSERT INTO profiles VALUES ('55555555-5555-4555-8555-555555555555', 'bookowner', 'Synthetic Owner');
INSERT INTO organizations VALUES ('77777777-7777-4777-8777-777777777777');
INSERT INTO vehicles VALUES ('88888888-8888-4888-8888-888888888888');

CREATE FUNCTION pg_temp.rec(p_kind text, p_local text, p_date text, p_amount text, p_section text, p_description text)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'record_kind', p_kind, 'source_key', md5(p_local) || md5(p_local || '#'), 'source_sha256', repeat('5', 64),
    'source_row', 1, 'local_id', p_local, 'year', left(p_date, 4), 'date', p_date, 'account', 'Synthetic CU 1111 Checking',
    'currency', 'USD', 'currency_basis', 'synthetic USD', 'amount', p_amount, 'section', p_section, 'category', 'Synthetic',
    'description', p_description, 'decision', 'Owner attestation (synthetic): related-party receipt.', 'status', 'Included',
    'bank_links', '[]'::jsonb,
    'recognition_status', CASE WHEN p_kind = 'retained_ledger_decision' THEN 'retained_decision' ELSE 'not_applicable' END,
    'payment_status', 'unresolved', 'vehicle_status', 'unresolved', 'reimbursement_status', 'unresolved',
    'entity_status', 'retained_scope_unallocated')
$$;

BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $$ DECLARE
  u uuid := '55555555-5555-4555-8555-555555555555';
  book jsonb := jsonb_build_object('sha256', repeat('3', 64), 'storage_path', u || '/rp-ledger.csv', 'byte_size', 100);
  base jsonb := '{"method":"synthetic-fixture","version":"1","fields":[{"field_key":"batch","value_raw":"synthetic","evidence":{"stage":"fixture"}}]}';
  r jsonb; rp jsonb;
BEGIN
  rp := set_financial_related_party('Synthetic Relative Co', ARRAY['SYNTHETIC RELATIVE CO', 'R. RELATIVE'], 'Synthetic: a relative''s company (fixture)', u);
  r := ingest_financial_evidence(u, book, base || jsonb_build_object('idempotency_key', 'rp-book-1', 'accounting_records', jsonb_build_array(
    pg_temp.rec('retained_ledger_decision', 'rp-dec-pay', '2024-03-01', '1000.00', 'Revenue', 'TRANSFER FROM SYNTHETIC RELATIVE CO'),
    pg_temp.rec('retained_bank_movement', 'rp-bank-pay', '2024-03-01', '1000.00', 'Revenue', 'TRANSFER FROM SYNTHETIC RELATIVE CO'),
    pg_temp.rec('retained_ledger_decision', 'rp-dec-lift', '2024-02-01', '5000.00', 'Reference', 'Synthetic Lift Co | two-post lift'))));
  INSERT INTO fx VALUES ('party', rp->>'id'), ('book', r->>'document_id');
END $$;
COMMIT;

-- 1. Writes as the owner (role authenticated, row policies applied).
BEGIN;
SELECT set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE
  p uuid := (SELECT v FROM fx WHERE k = 'party')::uuid;
  doc text := (SELECT v FROM fx WHERE k = 'book');
  a jsonb; b jsonb; e jsonb;
BEGIN
  a := record_related_party_ledger_entry(p, jsonb_build_object('entry_key', 'syn-work-a', 'kind', 'work_owed', 'occurred_on', '2024-01-10',
    'amount', '3000', 'basis', 'claimed', 'job', 'Synthetic body work', 'deal_type', 'production_service',
    'vehicle_id', '88888888-8888-4888-8888-888888888888', 'counterparty_org_id', '77777777-7777-4777-8777-777777777777',
    'evidence', jsonb_build_array(jsonb_build_object('kind', 'text_quote', 'author', 'owner', 'key', 'text:101', 'quote', 'body work done, 3k'))));
  IF a->>'evidence_level' <> 'supported' OR a->>'table' <> 'deal' THEN RAISE EXCEPTION 'work A: %', a; END IF;
  INSERT INTO fx VALUES ('work_a', a->>'id');
  b := record_related_party_ledger_entry(p, jsonb_build_object('entry_key', 'syn-work-b', 'kind', 'work_owed', 'occurred_on', '2024-02-10',
    'amount', '2000', 'basis', 'settlement_sheet', 'job', 'Synthetic commission', 'deal_type', 'commission',
    'evidence', jsonb_build_array(jsonb_build_object('kind', 'document', 'author', 'party', 'key', 'file:SYN_SHEET_1.jpg'))));
  IF b->>'evidence_level' <> 'proven' THEN RAISE EXCEPTION 'work B: %', b; END IF;
  INSERT INTO fx VALUES ('work_b', b->>'id');
  e := record_related_party_ledger_entry(p, jsonb_build_object('entry_key', 'syn-pay-1', 'kind', 'payment', 'occurred_on', '2024-03-01',
    'amount', '1000', 'basis', 'bank', 'method', 'transfer', 'for_entry', b->>'id',
    'evidence', jsonb_build_array(jsonb_build_object('kind', 'bank_line', 'author', 'third_party', 'key', 'book:rp-bank-pay',
                                                     'document_id', doc, 'local_id', 'rp-bank-pay'),
                                  jsonb_build_object('kind', 'bank_line', 'author', 'third_party', 'key', 'book:rp-dec-pay',
                                                     'document_id', doc, 'local_id', 'rp-dec-pay'))));
  IF e->>'evidence_level' <> 'proven' OR e->>'table' <> 'payment' THEN RAISE EXCEPTION 'payment: %', e; END IF;
  e := record_related_party_ledger_entry(p, jsonb_build_object('entry_key', 'syn-offset-lift', 'kind', 'offset', 'occurred_on', '2024-02-15',
    'amount', '5000', 'basis', 'equipment_invoice', 'offset_status', 'stated_by_party',
    'equipment', jsonb_build_object('item', 'two-post lift', 'vendor', 'Synthetic Lift Co', 'invoice_amount', '5000.00', 'bill_to', 'Synthetic Relative Co'),
    'evidence', jsonb_build_array(
      jsonb_build_object('kind', 'invoice', 'author', 'third_party', 'key', 'book:rp-dec-lift', 'document_id', doc, 'local_id', 'rp-dec-lift'),
      jsonb_build_object('kind', 'text_quote', 'author', 'party', 'key', 'text:202', 'quote', 'keeping it, payback for the lift'))));
  IF e->>'evidence_level' <> 'proven' THEN RAISE EXCEPTION 'offset: %', e; END IF;
  e := record_related_party_ledger_entry(p, jsonb_build_object('entry_key', 'syn-advance-1', 'kind', 'advance', 'occurred_on', '2024-04-01',
    'amount', '200', 'basis', 'claimed', 'job', 'store bill paid for the party',
    'evidence', jsonb_build_array(jsonb_build_object('kind', 'owner_word', 'key', 'owner 2026-10-25'))));
  IF e->>'evidence_level' <> 'owner_word' THEN RAISE EXCEPTION 'advance: %', e; END IF;
  -- Context evidence (the equipment invoice behind a claimed offset) does not raise the entry's level.
  IF related_party_evidence_level('[{"kind":"invoice","author":"third_party","key":"inv","role":"context"},{"kind":"owner_word","key":"w"}]') <> 'owner_word'
  THEN RAISE EXCEPTION 'context evidence raised the level'; END IF;
  BEGIN
    PERFORM record_related_party_ledger_entry(p, jsonb_build_object('entry_key', 'syn-bad-5', 'kind', 'offset', 'occurred_on', '2024-03-02',
      'amount', '10', 'basis', 'claimed', 'offset_status', 'claimed_by_owner',
      'evidence', jsonb_build_array(jsonb_build_object('kind', 'invoice', 'author', 'third_party', 'key', 'x', 'role', 'context'))));
    RAISE EXCEPTION 'entry with only context evidence accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'entry with only context evidence accepted' THEN RAISE; END IF; END;
  INSERT INTO fx VALUES ('advance', e->>'id');
  e := record_related_party_ledger_entry(p, jsonb_build_object('entry_key', 'syn-work-c', 'kind', 'work_owed', 'occurred_on', '2025-01-05',
    'amount', '1500', 'basis', 'claimed', 'job', 'Synthetic later job',
    'evidence', jsonb_build_array(jsonb_build_object('kind', 'owner_word', 'key', 'owner 2026-10-25'))));

  -- Replay is idempotent; the same key with other content is refused.
  IF (record_related_party_ledger_entry(p, jsonb_build_object('entry_key', 'syn-work-c', 'kind', 'work_owed', 'occurred_on', '2025-01-05',
    'amount', '1500', 'basis', 'claimed', 'job', 'Synthetic later job',
    'evidence', jsonb_build_array(jsonb_build_object('kind', 'owner_word', 'key', 'owner 2026-10-25')))))->>'duplicate' <> 'true'
  THEN RAISE EXCEPTION 'replay not idempotent'; END IF;
  BEGIN
    PERFORM record_related_party_ledger_entry(p, jsonb_build_object('entry_key', 'syn-work-c', 'kind', 'work_owed', 'occurred_on', '2025-01-05',
      'amount', '1600', 'basis', 'claimed', 'job', 'Synthetic later job',
      'evidence', jsonb_build_array(jsonb_build_object('kind', 'owner_word', 'key', 'owner 2026-10-25'))));
    RAISE EXCEPTION 'changed content under an existing key accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'changed content under an existing key accepted' THEN RAISE; END IF; END;
  -- Invalid input is refused: unknown book record, bank line without a record, missing evidence, offset without status.
  BEGIN
    PERFORM record_related_party_ledger_entry(p, jsonb_build_object('entry_key', 'syn-bad-1', 'kind', 'payment', 'occurred_on', '2024-03-02',
      'amount', '10', 'basis', 'bank', 'evidence', jsonb_build_array(jsonb_build_object('kind', 'bank_line', 'author', 'third_party',
      'key', 'x', 'document_id', doc, 'local_id', 'no-such-record'))));
    RAISE EXCEPTION 'unknown book record accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'unknown book record accepted' THEN RAISE; END IF; END;
  BEGIN
    PERFORM record_related_party_ledger_entry(p, jsonb_build_object('entry_key', 'syn-bad-2', 'kind', 'payment', 'occurred_on', '2024-03-02',
      'amount', '10', 'basis', 'bank', 'evidence', jsonb_build_array(jsonb_build_object('kind', 'bank_line', 'author', 'third_party', 'key', 'x'))));
    RAISE EXCEPTION 'bank line without a book record accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'bank line without a book record accepted' THEN RAISE; END IF; END;
  BEGIN
    PERFORM record_related_party_ledger_entry(p, jsonb_build_object('entry_key', 'syn-bad-3', 'kind', 'payment', 'occurred_on', '2024-03-02',
      'amount', '10', 'basis', 'bank', 'evidence', '[]'::jsonb));
    RAISE EXCEPTION 'entry without evidence accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'entry without evidence accepted' THEN RAISE; END IF; END;
  BEGIN
    PERFORM record_related_party_ledger_entry(p, jsonb_build_object('entry_key', 'syn-bad-4', 'kind', 'offset', 'occurred_on', '2024-03-02',
      'amount', '10', 'basis', 'stated', 'evidence', jsonb_build_array(jsonb_build_object('kind', 'owner_word', 'key', 'x'))));
    RAISE EXCEPTION 'offset without status accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'offset without status accepted' THEN RAISE; END IF; END;

  -- Ledger rows are append-only even for their owner, and nobody inserts them around the writer.
  BEGIN
    UPDATE financial_deals SET rate_card_amount = 1 WHERE id = (SELECT v FROM fx WHERE k = 'work_a')::uuid;
    RAISE EXCEPTION 'owner overwrote a ledger row';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE financial_payments SET amount = 1 WHERE attributes->>'entry_key' = 'syn-pay-1';
    RAISE EXCEPTION 'owner overwrote a ledger payment';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO financial_payments(owner_id, amount, currency, attributes)
    VALUES ('55555555-5555-4555-8555-555555555555', 1, 'USD', jsonb_build_object('ledger', 'related_party', 'party_id', p, 'entry_key', 'raw'));
    RAISE EXCEPTION 'raw ledger insert accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM related_party_ledger_stamp('deal', (SELECT v FROM fx WHERE k = 'work_a')::uuid, NULL, 'x', 'x');
    RAISE EXCEPTION 'stamp callable directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Rows outside the ledger keep their ordinary owner semantics.
  INSERT INTO financial_deals(owner_id, title) VALUES ('55555555-5555-4555-8555-555555555555', 'ordinary deal');
  UPDATE financial_deals SET title = 'ordinary deal, renamed' WHERE title = 'ordinary deal';
  IF NOT FOUND THEN RAISE EXCEPTION 'ordinary deal update blocked'; END IF;
END $$;
SELECT pg_sleep(0.05);
INSERT INTO fx VALUES ('t1', clock_timestamp()::text);
COMMIT;

-- 2. Balances, levels, books and positions as the owner.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE
  p uuid := (SELECT v FROM fx WHERE k = 'party')::uuid;
  l jsonb; pay jsonb; t jsonb;
BEGIN
  l := related_party_ledger(p);
  -- Owner: +3000 +2000 -1000 +200 +1500 (the stated offset is not payment) = 5700. Party: also -5000 = 700.
  IF (l->'balance'->'owner_position'->>'all')::numeric <> 5700 OR (l->'balance'->'party_position'->>'all')::numeric <> 700
     OR (l->'balance'->>'disputed_offsets')::numeric <> 5000 THEN RAISE EXCEPTION 'positions: %', l->'balance'; END IF;
  -- Proven: work B 2000 - payment 1000 = 1000 (party: also - offset 5000). Supported adds work A 3000.
  IF (l->'balance'->'owner_position'->>'proven')::numeric <> 1000 OR (l->'balance'->'party_position'->>'proven')::numeric <> -4000
     OR (l->'balance'->'owner_position'->>'proven_and_supported')::numeric <> 4000 THEN RAISE EXCEPTION 'levels: %', l->'balance'; END IF;
  IF jsonb_array_length(l->'lines') <> 6 OR (l->'lines'->5->>'running_owner')::numeric <> 5700
     OR l->'lines'->0->>'entry_key' <> 'syn-work-a' THEN RAISE EXCEPTION 'running lines: %', l->'lines'; END IF;
  SELECT x INTO pay FROM jsonb_array_elements(l->'lines') x WHERE x->>'entry_key' = 'syn-pay-1';
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pay->'booked_as') b WHERE b->>'local_id' = 'rp-dec-pay' AND b->>'section' = 'Revenue')
  THEN RAISE EXCEPTION 'payment not tied to the book: %', pay; END IF;
  IF jsonb_array_length(l->'equipment') <> 1 OR l->'equipment'->0->'equipment'->>'item' <> 'two-post lift'
     OR l->'equipment'->0->'booked_as'->0->>'section' <> 'Reference' THEN RAISE EXCEPTION 'equipment: %', l->'equipment'; END IF;
  SELECT x INTO t FROM jsonb_array_elements(l->'tax_by_year') x WHERE x->>'year' = '2024';
  IF (t->>'payments_booked_as_revenue')::numeric <> 1000 OR (t->>'offsets_disputed')::numeric <> 5000
     OR (t->>'offsets_accepted')::numeric <> 0 OR (t->>'work_owed')::numeric <> 5000 OR (t->>'advanced_for_party')::numeric <> 200
  THEN RAISE EXCEPTION 'tax 2024: %', t; END IF;
  -- Event clock: as of 12 Feb 2024 only work A and B had happened.
  IF (related_party_ledger(p, '2024-02-12')->'balance'->'owner_position'->>'all')::numeric <> 5000 THEN RAISE EXCEPTION 'as-of'; END IF;
  -- The payment rows are visible through the existing engagement chain.
  IF (SELECT count(*) FROM financial_payments WHERE deal_id = (SELECT v FROM fx WHERE k = 'work_b')::uuid) <> 1 THEN RAISE EXCEPTION 'deal link'; END IF;
END $$;
COMMIT;

-- 3. Corrections: supersede work A (3000 -> 3500), withdraw the advance, accept the offset by superseding it.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $$ DECLARE
  p uuid := (SELECT v FROM fx WHERE k = 'party')::uuid;
  u uuid := '55555555-5555-4555-8555-555555555555';
  doc text := (SELECT v FROM fx WHERE k = 'book');
  r jsonb; off uuid;
BEGIN
  r := record_related_party_ledger_entry(p, jsonb_build_object('entry_key', 'syn-work-a#2', 'supersedes', (SELECT v FROM fx WHERE k = 'work_a'),
    'kind', 'work_owed', 'occurred_on', '2024-01-10', 'amount', '3500', 'basis', 'agreed', 'job', 'Synthetic body work',
    'evidence', jsonb_build_array(jsonb_build_object('kind', 'text_quote', 'author', 'party', 'key', 'text:303', 'quote', 'ok 3500'))), u);
  IF r->>'evidence_level' <> 'proven' THEN RAISE EXCEPTION 'supersede: %', r; END IF;
  -- The old row is stamped, kept, and cannot be superseded again.
  IF NOT EXISTS (SELECT 1 FROM financial_deals WHERE id = (SELECT v FROM fx WHERE k = 'work_a')::uuid AND superseded_by = (r->>'id')::uuid
                   AND superseded_at IS NOT NULL AND rate_card_amount = 3000) THEN RAISE EXCEPTION 'old row not kept and stamped'; END IF;
  BEGIN
    PERFORM record_related_party_ledger_entry(p, jsonb_build_object('entry_key', 'syn-work-a#3', 'supersedes', (SELECT v FROM fx WHERE k = 'work_a'),
      'kind', 'work_owed', 'occurred_on', '2024-01-10', 'amount', '1', 'basis', 'agreed', 'job', 'x',
      'evidence', jsonb_build_array(jsonb_build_object('kind', 'owner_word', 'key', 'x'))), u);
    RAISE EXCEPTION 'superseded twice';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'superseded twice' THEN RAISE; END IF; END;
  r := record_related_party_ledger_entry(p, jsonb_build_object('entry_key', 'syn-advance-1-withdrawn', 'supersedes', (SELECT v FROM fx WHERE k = 'advance'),
    'retract', true, 'reason', 'synthetic: the bill was the owner''s own'), u);
  IF r->>'withdrawn' <> 'true' THEN RAISE EXCEPTION 'withdraw: %', r; END IF;
  IF (record_related_party_ledger_entry(p, jsonb_build_object('entry_key', 'syn-advance-1-withdrawn', 'supersedes', (SELECT v FROM fx WHERE k = 'advance'),
      'retract', true, 'reason', 'synthetic: the bill was the owner''s own'), u))->>'duplicate' <> 'true' THEN RAISE EXCEPTION 'withdraw replay'; END IF;
  SELECT id INTO off FROM financial_payments WHERE attributes->>'entry_key' = 'syn-offset-lift';
  PERFORM record_related_party_ledger_entry(p, jsonb_build_object('entry_key', 'syn-offset-lift#accepted', 'supersedes', off,
    'kind', 'offset', 'occurred_on', '2024-02-15', 'amount', '5000', 'basis', 'equipment_invoice', 'offset_status', 'accepted',
    'equipment', jsonb_build_object('item', 'two-post lift', 'vendor', 'Synthetic Lift Co'),
    'evidence', jsonb_build_array(jsonb_build_object('kind', 'invoice', 'author', 'third_party', 'key', 'book:rp-dec-lift',
      'document_id', doc, 'local_id', 'rp-dec-lift'))), u);
  IF NOT (SELECT is_superseded FROM financial_payments WHERE id = off) THEN RAISE EXCEPTION 'offset not superseded'; END IF;
  -- Even the service role cannot delete or edit ledger rows directly.
  BEGIN
    DELETE FROM financial_payments WHERE id = off;
    RAISE EXCEPTION 'ledger row deleted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
COMMIT;

-- 4. Point in time and access.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE
  p uuid := (SELECT v FROM fx WHERE k = 'party')::uuid;
  t1 timestamptz := (SELECT v FROM fx WHERE k = 't1')::timestamptz;
  now_l jsonb; then_l jsonb;
BEGIN
  now_l := related_party_ledger(p);
  -- Now: 3500 + 2000 - 1000 - 5000 (accepted) + 1500 = 1000 for both positions; nothing disputed.
  IF (now_l->'balance'->'owner_position'->>'all')::numeric <> 1000 OR (now_l->'balance'->'party_position'->>'all')::numeric <> 1000
     OR (now_l->'balance'->>'disputed_offsets')::numeric <> 0 OR jsonb_array_length(now_l->'lines') <> 5
  THEN RAISE EXCEPTION 'after corrections: %', now_l->'balance'; END IF;
  IF (SELECT (x->>'offsets_accepted')::numeric FROM jsonb_array_elements(now_l->'tax_by_year') x WHERE x->>'year' = '2024') <> 5000
  THEN RAISE EXCEPTION 'accepted offset not in the tax side'; END IF;
  -- Recording clock: what the ledger said before the corrections is replayable.
  then_l := related_party_ledger(p, NULL, t1);
  IF (then_l->'balance'->'owner_position'->>'all')::numeric <> 5700 OR (then_l->'balance'->'party_position'->>'all')::numeric <> 700
  THEN RAISE EXCEPTION 'known-at replay: %', then_l->'balance'; END IF;
END $$;
COMMIT;

-- A stranger can neither read nor write the owner's ledger.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'authenticated', true), set_config('request.jwt.claim.sub', '66666666-6666-4666-8666-666666666666', true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE p uuid := (SELECT v FROM fx WHERE k = 'party')::uuid; BEGIN
  BEGIN
    PERFORM related_party_ledger(p, NULL, NULL, '55555555-5555-4555-8555-555555555555');
    RAISE EXCEPTION 'stranger read the ledger';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM record_related_party_ledger_entry(p, '{"entry_key":"x-1","kind":"payment"}'::jsonb, '55555555-5555-4555-8555-555555555555');
    RAISE EXCEPTION 'stranger wrote the ledger';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS (SELECT 1 FROM financial_payments WHERE attributes->>'ledger' = 'related_party') THEN RAISE EXCEPTION 'stranger sees ledger rows'; END IF;
END $$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM related_party_ledger('00000000-0000-4000-8000-000000000000');
  RAISE EXCEPTION 'anon executed the reader';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
ROLLBACK;

DO $$ BEGIN RAISE NOTICE 'PASS related-party ledger: positions, levels, books, idempotency, supersession, withdrawal, point in time, append-only, owner-only'; END $$;
