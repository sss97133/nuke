-- Related-party ledger: one evidence-backed running balance between a book owner and one registered related party.
--
-- Builds on what exists instead of minting a parallel ledger:
--   - the party is a financial_operator_entities row with relationship = 'related_party' (set_financial_related_party);
--   - work the owner did for the party is a financial_deals row (deal_direction revenue; the agreed or claimed amount in
--     rate_card_amount);
--   - money and settlements are financial_payments rows: in = the party paid the owner, the owner collected the party's
--     money, or the party kept money owed as an offset; out = the owner advanced a cost for the party or remitted money
--     to it;
--   - ledger rows carry attributes.ledger = 'related_party', attributes.party_id and an owner-unique entry_key, and point
--     at the books by the stable record key (document_id, local_id) of v_financial_accounting_records.
-- Rows are append-only: a correction is a new row that supersedes the old one (superseded_by / superseded_at), a
-- withdrawal stamps the old row with a reason. Only record_related_party_ledger_entry writes them; a trigger refuses
-- every other insert, update or delete of a ledger row.
-- The reader related_party_ledger returns the balance point-in-time (event clock occurred_on, recording clock
-- created_at, supersession clock superseded_at), by evidence level, in two positions: the owner's (offsets the owner did
-- not accept are not payment) and the party's (every stated offset counts).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

-- Supersession on deals, as financial_payments already has.
ALTER TABLE public.financial_deals
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.financial_deals(id),
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
COMMENT ON COLUMN public.financial_deals.superseded_by IS
  'The deal row that replaces this one (a correction appends a row, never overwrites). Null while current, and null on a '
  'withdrawn row. Source: the writer that supersedes (record_related_party_ledger_entry for related-party ledger rows).';
COMMENT ON COLUMN public.financial_deals.superseded_at IS
  'When this row stopped being current (supersession or withdrawal). Recording clock, timestamptz. Null while current.';

CREATE UNIQUE INDEX IF NOT EXISTS financial_deals_related_party_entry_key
  ON public.financial_deals (owner_id, (attributes->>'entry_key')) WHERE attributes->>'ledger' = 'related_party';
CREATE UNIQUE INDEX IF NOT EXISTS financial_payments_related_party_entry_key
  ON public.financial_payments (owner_id, (attributes->>'entry_key')) WHERE attributes->>'ledger' = 'related_party';

-- Ledger rows are testimony: only the writer inserts them, only a single supersession stamp may change them, and they
-- are never deleted.
CREATE OR REPLACE FUNCTION public.guard_related_party_ledger_rows()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_old boolean := false;
  v_new boolean := false;
  v_writer boolean := coalesce(current_setting('app.related_party_ledger_writer', true), '') = 'on'
                      AND current_user NOT IN ('anon', 'authenticated');
  o jsonb;
  n jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old := coalesce(OLD.attributes->>'ledger', '') = 'related_party'; END IF;
  IF TG_OP <> 'DELETE' THEN v_new := coalesce(NEW.attributes->>'ledger', '') = 'related_party'; END IF;
  IF NOT (v_old OR v_new) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'related-party ledger rows are never deleted; supersede them' USING ERRCODE = '42501';
  END IF;
  IF NOT v_writer THEN
    RAISE EXCEPTION 'related-party ledger rows are written only by record_related_party_ledger_entry' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    o := to_jsonb(OLD) - ARRAY['superseded_by', 'superseded_at', 'is_superseded', 'updated_at', 'attributes'];
    n := to_jsonb(NEW) - ARRAY['superseded_by', 'superseded_at', 'is_superseded', 'updated_at', 'attributes'];
    IF NOT v_old OR OLD.superseded_at IS NOT NULL OR NEW.superseded_at IS NULL OR o IS DISTINCT FROM n
       OR OLD.attributes ?| ARRAY['superseded_entry_key', 'superseded_reason']
       OR (NEW.attributes - ARRAY['superseded_entry_key', 'superseded_reason']) IS DISTINCT FROM OLD.attributes THEN
      RAISE EXCEPTION 'a related-party ledger row changes only by one supersession stamp' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_related_party_ledger_rows() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS related_party_ledger_guard ON public.financial_deals;
CREATE TRIGGER related_party_ledger_guard BEFORE INSERT OR UPDATE OR DELETE ON public.financial_deals
  FOR EACH ROW EXECUTE FUNCTION public.guard_related_party_ledger_rows();
DROP TRIGGER IF EXISTS related_party_ledger_guard ON public.financial_payments;
CREATE TRIGGER related_party_ledger_guard BEFORE INSERT OR UPDATE OR DELETE ON public.financial_payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_related_party_ledger_rows();

-- Evidence level of one entry, strongest claim item wins (items with role = 'context', such as the invoice of
-- equipment an offset is said to repay, show what the entry is about but do not prove the entry itself):
--   proven     = a bank line, or any item authored by the party or a third party (vendor invoice, the party's own
--                deal sheet or message);
--   supported  = the owner's own contemporaneous record (the owner's messages, schedules, invoices, a deal record);
--   owner_word = the owner's word only.
CREATE OR REPLACE FUNCTION public.related_party_evidence_level(p_evidence jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  WITH e AS (
    SELECT x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_evidence) = 'array' THEN p_evidence ELSE '[]'::jsonb END) x
     WHERE coalesce(x->>'role', 'claim') = 'claim'
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM e WHERE x->>'kind' = 'bank_line'
                   OR (x->>'kind' <> 'owner_word' AND x->>'author' IN ('party', 'third_party'))) THEN 'proven'
    WHEN EXISTS (SELECT 1 FROM e WHERE x->>'kind' <> 'owner_word') THEN 'supported'
    ELSE 'owner_word' END
$$;

-- Sign of an entry in the balance "what the party owes the owner". p_position: 'owner' counts an offset only when the
-- owner accepted it; 'party' counts every stated offset.
CREATE OR REPLACE FUNCTION public.related_party_entry_sign(p_kind text, p_offset_status text, p_position text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_kind IN ('work_owed', 'advance', 'remittance') THEN 1
    WHEN p_kind IN ('payment', 'collected') THEN -1
    WHEN p_kind = 'offset' THEN CASE WHEN p_position = 'party' OR p_offset_status = 'accepted' THEN -1 ELSE 0 END
    ELSE 0 END
$$;

-- Supersession stamp shared by supersede and withdraw.
CREATE OR REPLACE FUNCTION public.related_party_ledger_stamp(
  p_table text, p_id uuid, p_by uuid, p_entry_key text, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n integer;
BEGIN
  IF current_setting('app.related_party_ledger_writer', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'internal to record_related_party_ledger_entry' USING ERRCODE = '42501';
  END IF;
  IF p_table = 'deal' THEN
    UPDATE public.financial_deals
       SET superseded_by = p_by, superseded_at = now(),
           attributes = attributes || jsonb_strip_nulls(jsonb_build_object('superseded_entry_key', p_entry_key, 'superseded_reason', p_reason))
     WHERE id = p_id AND superseded_at IS NULL;
  ELSE
    UPDATE public.financial_payments
       SET superseded_by = p_by, superseded_at = now(), is_superseded = true,
           attributes = attributes || jsonb_strip_nulls(jsonb_build_object('superseded_entry_key', p_entry_key, 'superseded_reason', p_reason))
     WHERE id = p_id AND superseded_at IS NULL;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'entry % is no longer current', p_id; END IF;
END $$;
REVOKE ALL ON FUNCTION public.related_party_ledger_stamp(text, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_related_party_ledger_entry(
  p_party_id uuid, p_entry jsonb, p_owner_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_owner uuid := coalesce(p_owner_id, auth.uid());
  v_party public.financial_operator_entities%ROWTYPE;
  v_kind text;
  v_key text := btrim(coalesce(p_entry->>'entry_key', ''));
  v_digest text;
  v_ex record;
  v_prior_id uuid;
  v_prior record;
  v_retract boolean := false;
  v_reason text;
  v_date date;
  v_amount numeric;
  v_currency text;
  v_vehicle uuid;
  v_org uuid;
  v_for uuid;
  v_evidence jsonb := '[]'::jsonb;
  v_item jsonb;
  x jsonb;
  v_line uuid;
  v_first_doc uuid;
  v_first_line uuid;
  v_has_bank boolean := false;
  v_all_word boolean := true;
  v_attrs jsonb;
  v_id uuid;
  v_table text;
BEGIN
  IF v_owner IS NULL OR NOT (v_owner = auth.uid() OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'only the book owner writes the related-party ledger' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_party FROM public.financial_operator_entities
   WHERE id = p_party_id AND owner_id = v_owner AND relationship = 'related_party';
  IF v_party.id IS NULL THEN RAISE EXCEPTION 'unknown related party'; END IF;
  IF jsonb_typeof(p_entry) IS DISTINCT FROM 'object' OR octet_length(p_entry::text) > 20000
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_entry) k WHERE k NOT IN (
          'entry_key', 'kind', 'occurred_on', 'amount', 'currency', 'basis', 'job', 'vehicle_id', 'deal_type',
          'counterparty_org_id', 'method', 'offset_status', 'equipment', 'evidence', 'note', 'supersedes', 'retract',
          'reason', 'for_entry'))
     OR v_key !~ '^[A-Za-z0-9][A-Za-z0-9:._#/-]{2,120}$'
  THEN RAISE EXCEPTION 'invalid ledger entry'; END IF;
  v_digest := md5(p_entry::text);
  v_retract := coalesce(p_entry->>'retract', 'false') = 'true';

  IF p_entry ? 'supersedes' THEN
    IF coalesce(p_entry->>'supersedes', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'invalid ledger entry'; END IF;
    v_prior_id := (p_entry->>'supersedes')::uuid;
    SELECT * INTO v_prior FROM (
      SELECT 'deal'::text tbl, d.attributes, d.superseded_at FROM public.financial_deals d
       WHERE d.id = v_prior_id AND d.owner_id = v_owner AND d.attributes->>'ledger' = 'related_party'
      UNION ALL
      SELECT 'payment', p.attributes, p.superseded_at FROM public.financial_payments p
       WHERE p.id = v_prior_id AND p.owner_id = v_owner AND p.attributes->>'ledger' = 'related_party') s;
    IF v_prior.tbl IS NULL OR v_prior.attributes->>'party_id' IS DISTINCT FROM p_party_id::text THEN
      RAISE EXCEPTION 'superseded entry not found for this party'; END IF;
  END IF;

  -- Withdrawal: no new row; the old row is stamped with the reason. A replay of the same withdrawal is a no-op.
  IF v_retract THEN
    v_reason := btrim(coalesce(p_entry->>'reason', ''));
    IF v_prior_id IS NULL OR length(v_reason) NOT BETWEEN 3 AND 500
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_entry) k WHERE k NOT IN ('entry_key', 'supersedes', 'retract', 'reason')) THEN
      RAISE EXCEPTION 'a withdrawal names only the entry and a reason'; END IF;
    IF v_prior.superseded_at IS NOT NULL THEN
      IF v_prior.attributes->>'superseded_entry_key' = v_key THEN
        RETURN jsonb_build_object('id', v_prior_id, 'table', v_prior.tbl, 'withdrawn', true, 'duplicate', true); END IF;
      RAISE EXCEPTION 'entry % is no longer current', v_prior_id;
    END IF;
    PERFORM set_config('app.related_party_ledger_writer', 'on', true);
    PERFORM public.related_party_ledger_stamp(v_prior.tbl, v_prior_id, NULL, v_key, v_reason);
    PERFORM set_config('app.related_party_ledger_writer', '', true);
    RETURN jsonb_build_object('id', v_prior_id, 'table', v_prior.tbl, 'withdrawn', true, 'duplicate', false);
  END IF;

  -- Idempotency: the same key with the same content returns the stored row; a different content is refused.
  SELECT * INTO v_ex FROM (
    SELECT 'deal'::text tbl, id, attributes->>'entry_digest' digest FROM public.financial_deals
     WHERE owner_id = v_owner AND attributes->>'ledger' = 'related_party' AND attributes->>'entry_key' = v_key
    UNION ALL
    SELECT 'payment', id, attributes->>'entry_digest' FROM public.financial_payments
     WHERE owner_id = v_owner AND attributes->>'ledger' = 'related_party' AND attributes->>'entry_key' = v_key) s
  LIMIT 1;
  IF v_ex.id IS NOT NULL THEN
    IF v_ex.digest = v_digest THEN
      RETURN jsonb_build_object('id', v_ex.id, 'table', v_ex.tbl, 'duplicate', true); END IF;
    RAISE EXCEPTION 'entry_key % already holds a different entry; supersede it under a new key', v_key;
  END IF;
  IF v_prior_id IS NOT NULL THEN
    IF v_prior.superseded_at IS NOT NULL THEN RAISE EXCEPTION 'entry % is no longer current', v_prior_id; END IF;
  END IF;

  v_kind := p_entry->>'kind';
  IF v_kind IS NULL OR v_kind NOT IN ('work_owed', 'advance', 'remittance', 'payment', 'collected', 'offset')
     OR coalesce(p_entry->>'occurred_on', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     OR coalesce(p_entry->>'amount', '') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$'
     OR coalesce(p_entry->>'basis', '') NOT IN ('agreed', 'invoiced', 'settlement_sheet', 'stated', 'claimed', 'bank',
                                                 'equipment_invoice', 'estimate')
     OR coalesce(length(p_entry->>'job'), 0) > 300
     OR (v_kind = 'work_owed' AND coalesce(length(btrim(p_entry->>'job')), 0) < 3)
     OR coalesce(length(p_entry->>'method'), 0) > 60
     OR coalesce(length(p_entry->>'note'), 0) > 1000
     OR (p_entry ? 'deal_type' AND (v_kind <> 'work_owed' OR p_entry->>'deal_type' NOT IN ('commission', 'production_service', 'other')))
     OR ((v_kind = 'offset') <> (p_entry ? 'offset_status'))
     OR (v_kind = 'offset' AND p_entry->>'offset_status' NOT IN ('stated_by_party', 'claimed_by_owner', 'accepted'))
     OR (p_entry ? 'equipment' AND (v_kind <> 'offset' OR jsonb_typeof(p_entry->'equipment') <> 'object'
          OR EXISTS (SELECT 1 FROM jsonb_each(p_entry->'equipment') q
                     WHERE q.key NOT IN ('item', 'vendor', 'invoice_date', 'invoice_amount', 'bill_to', 'payer', 'location', 'note')
                        OR jsonb_typeof(q.value) <> 'string' OR length(q.value #>> '{}') > 300)))
     OR (p_entry ? 'for_entry' AND v_kind NOT IN ('payment', 'offset', 'collected'))
     OR jsonb_typeof(p_entry->'evidence') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_entry->'evidence') NOT BETWEEN 1 AND 20
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_entry->'evidence') q WHERE coalesce(q->>'role', 'claim') = 'claim')
  THEN RAISE EXCEPTION 'invalid ledger entry'; END IF;
  v_date := (p_entry->>'occurred_on')::date;
  v_amount := (p_entry->>'amount')::numeric;
  v_currency := coalesce(p_entry->>'currency', 'USD');
  IF v_date NOT BETWEEN DATE '2000-01-01' AND current_date + 1 OR v_amount <= 0 OR v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'invalid ledger entry'; END IF;
  IF p_entry ? 'vehicle_id' THEN
    v_vehicle := (p_entry->>'vehicle_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.vehicles WHERE id = v_vehicle) THEN RAISE EXCEPTION 'unknown vehicle'; END IF;
  END IF;
  IF p_entry ? 'counterparty_org_id' THEN
    v_org := (p_entry->>'counterparty_org_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org) THEN RAISE EXCEPTION 'unknown organization'; END IF;
  END IF;
  IF p_entry ? 'for_entry' THEN
    v_for := (p_entry->>'for_entry')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.financial_deals WHERE id = v_for AND owner_id = v_owner
                     AND attributes->>'ledger' = 'related_party' AND attributes->>'party_id' = p_party_id::text) THEN
      RAISE EXCEPTION 'for_entry is not work owed by this party'; END IF;
  END IF;

  -- Evidence: each item keyed; a book reference must name a current record of the owner's books.
  FOR x IN SELECT value FROM jsonb_array_elements(p_entry->'evidence') LOOP
    IF jsonb_typeof(x) <> 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN ('kind', 'author', 'key', 'document_id', 'local_id', 'quote', 'at', 'note', 'role'))
       OR coalesce(x->>'role', 'claim') NOT IN ('claim', 'context')
       OR coalesce(x->>'kind', '') NOT IN ('invoice', 'bank_line', 'text_quote', 'deal_record', 'document', 'owner_word')
       OR (x->>'kind' <> 'owner_word' AND coalesce(x->>'author', '') NOT IN ('party', 'owner', 'third_party'))
       OR (x->>'kind' = 'owner_word' AND coalesce(x->>'author', 'owner') <> 'owner')
       OR coalesce(length(btrim(x->>'key')), 0) NOT BETWEEN 1 AND 300
       OR coalesce(length(x->>'quote'), 0) > 1500 OR coalesce(length(x->>'at'), 0) > 40 OR coalesce(length(x->>'note'), 0) > 500
       OR ((x ? 'document_id') <> (x ? 'local_id'))
       OR (x->>'kind' = 'bank_line' AND NOT x ? 'document_id')
    THEN RAISE EXCEPTION 'invalid evidence item: %', left(x::text, 200); END IF;
    v_item := x;
    IF x->>'kind' = 'owner_word' THEN v_item := x || '{"author":"owner"}'; ELSE v_all_word := false; END IF;
    IF x->>'kind' = 'bank_line' AND coalesce(x->>'role', 'claim') = 'claim' THEN v_has_bank := true; END IF;
    IF x ? 'document_id' THEN
      SELECT v.id INTO v_line FROM public.v_financial_accounting_records v
       WHERE v.owner_id = v_owner AND v.document_id = (x->>'document_id')::uuid AND v.local_id = x->>'local_id' LIMIT 1;
      IF v_line IS NULL THEN RAISE EXCEPTION 'book record % not found', x->>'local_id'; END IF;
      IF v_first_line IS NULL THEN v_first_line := v_line; v_first_doc := (x->>'document_id')::uuid; END IF;
    END IF;
    v_evidence := v_evidence || jsonb_build_array(v_item);
  END LOOP;

  v_attrs := jsonb_strip_nulls(jsonb_build_object(
    'ledger', 'related_party', 'party_id', p_party_id, 'entry_key', v_key, 'entry_kind', v_kind, 'occurred_on', v_date,
    'basis', p_entry->>'basis', 'job', btrim(p_entry->>'job'), 'vehicle_id', v_vehicle, 'method', p_entry->>'method',
    'offset_status', p_entry->>'offset_status', 'equipment', p_entry->'equipment', 'evidence', v_evidence,
    'evidence_level', public.related_party_evidence_level(v_evidence), 'note', p_entry->>'note',
    'supersedes', v_prior_id, 'for_entry', v_for, 'entry_digest', v_digest,
    'recorded_by', coalesce(auth.uid()::text, 'service_role')));

  PERFORM set_config('app.related_party_ledger_writer', 'on', true);
  IF v_kind = 'work_owed' THEN
    IF v_prior_id IS NOT NULL THEN
      IF v_prior.tbl <> 'deal' THEN
        RAISE EXCEPTION 'supersede within the same entry family; withdraw and re-enter to change it'; END IF;
    END IF;
    INSERT INTO public.financial_deals(owner_id, deal_type, deal_direction, title, status, counterparty_name_raw,
                                       counterparty_org_id, currency, rate_card_amount, attributes, privacy_tier)
    VALUES (v_owner, coalesce(p_entry->>'deal_type', 'other'), 'revenue', btrim(p_entry->>'job'), 'observed',
            v_party.entity_name, v_org, v_currency, v_amount, v_attrs, 'private')
    RETURNING id INTO v_id;
    v_table := 'deal';
  ELSE
    IF v_prior_id IS NOT NULL THEN
      IF v_prior.tbl <> 'payment' THEN
        RAISE EXCEPTION 'supersede within the same entry family; withdraw and re-enter to change it'; END IF;
    END IF;
    INSERT INTO public.financial_payments(owner_id, direction, amount, currency, paid_at, method, payer_name_raw,
                                          payee_name_raw, payer_org_id, payee_org_id, deal_id, evidence_document_id,
                                          evidence_line_id, evidence_kind, attributes, privacy_tier)
    VALUES (v_owner,
            CASE WHEN v_kind IN ('advance', 'remittance') THEN 'out' ELSE 'in' END,
            v_amount, v_currency, v_date,
            coalesce(p_entry->>'method', CASE WHEN v_kind = 'offset' THEN 'offset' END),
            CASE WHEN v_kind IN ('advance', 'remittance') THEN 'book owner' ELSE v_party.entity_name END,
            CASE WHEN v_kind IN ('advance', 'remittance') THEN v_party.entity_name ELSE 'book owner' END,
            CASE WHEN v_kind IN ('advance', 'remittance') THEN NULL ELSE v_org END,
            CASE WHEN v_kind IN ('advance', 'remittance') THEN v_org END,
            v_for, v_first_doc, v_first_line,
            CASE WHEN v_has_bank THEN 'bank_statement_line' WHEN v_all_word THEN 'manual' ELSE 'other' END,
            v_attrs, 'private')
    RETURNING id INTO v_id;
    v_table := 'payment';
  END IF;
  IF v_prior_id IS NOT NULL THEN
    PERFORM public.related_party_ledger_stamp(v_table, v_prior_id, v_id, v_key, NULL);
  END IF;
  PERFORM set_config('app.related_party_ledger_writer', '', true);
  RETURN jsonb_build_object('id', v_id, 'table', v_table, 'entry_kind', v_kind, 'evidence_level', v_attrs->>'evidence_level',
                            'supersedes', v_prior_id, 'duplicate', false);
END $$;

-- The balance and its lines, point in time. Runs as the caller; owner (or service role) only.
CREATE OR REPLACE FUNCTION public.related_party_ledger(
  p_party_id uuid, p_as_of date DEFAULT NULL, p_known_at timestamptz DEFAULT NULL, p_owner_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_owner uuid := coalesce(p_owner_id, auth.uid());
  v_as_of date := coalesce(p_as_of, current_date);
  v_known timestamptz := coalesce(p_known_at, now());
  v_name text;
  v_out jsonb;
BEGIN
  IF v_owner IS NULL OR NOT (v_owner = auth.uid() OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'the related-party ledger is readable by its owner only' USING ERRCODE = '42501';
  END IF;
  SELECT r.entity_name INTO v_name FROM public.financial_related_parties(v_owner) r WHERE r.entity_id = p_party_id;
  IF v_name IS NULL THEN RAISE EXCEPTION 'unknown related party'; END IF;

  WITH e AS (
    SELECT 'deal'::text tbl, d.id, d.created_at recorded_at, d.superseded_at, d.superseded_by, 'work_owed'::text kind,
           d.rate_card_amount amount, d.currency, d.attributes a
      FROM public.financial_deals d
     WHERE d.owner_id = v_owner AND d.attributes->>'ledger' = 'related_party' AND d.attributes->>'party_id' = p_party_id::text
    UNION ALL
    SELECT 'payment', p.id, p.created_at, p.superseded_at, p.superseded_by, p.attributes->>'entry_kind', p.amount,
           p.currency, p.attributes
      FROM public.financial_payments p
     WHERE p.owner_id = v_owner AND p.attributes->>'ledger' = 'related_party' AND p.attributes->>'party_id' = p_party_id::text
  ), v AS (
    SELECT e.*, (e.a->>'occurred_on')::date occurred_on, public.related_party_evidence_level(e.a->'evidence') lvl,
           public.related_party_entry_sign(e.kind, e.a->>'offset_status', 'owner') * e.amount owner_signed,
           public.related_party_entry_sign(e.kind, e.a->>'offset_status', 'party') * e.amount party_signed
      FROM e
     WHERE (e.a->>'occurred_on')::date <= v_as_of AND e.recorded_at <= v_known
       AND (e.superseded_at IS NULL OR e.superseded_at > v_known)
     ORDER BY (e.a->>'occurred_on'), e.recorded_at, e.id LIMIT 5000
  ), r AS (
    SELECT v.*,
           sum(v.owner_signed) OVER w running_owner,
           sum(v.party_signed) OVER w running_party,
           row_number() OVER w seq,
           (SELECT coalesce(jsonb_agg(jsonb_build_object('document_id', b.document_id, 'local_id', b.local_id,
                      'record_kind', b.record_kind, 'year', b.year, 'date', b.record_date, 'section', b.section,
                      'category', b.category, 'amount', b.amount_value) ORDER BY b.local_id), '[]'::jsonb)
              FROM jsonb_array_elements(v.a->'evidence') x
              JOIN public.v_financial_accounting_records b
                ON b.owner_id = v_owner AND b.document_id = (x->>'document_id')::uuid AND b.local_id = x->>'local_id'
             WHERE x ? 'document_id') booked_as
      FROM v
    WINDOW w AS (ORDER BY v.occurred_on, v.recorded_at, v.id ROWS UNBOUNDED PRECEDING)
  )
  SELECT jsonb_build_object(
    'party', jsonb_build_object('id', p_party_id, 'name', v_name),
    'as_of', v_as_of, 'known_at', v_known,
    'balance', jsonb_build_object(
      'owner_position', jsonb_build_object(
        'proven', coalesce(sum(owner_signed) FILTER (WHERE lvl = 'proven'), 0),
        'proven_and_supported', coalesce(sum(owner_signed) FILTER (WHERE lvl IN ('proven', 'supported')), 0),
        'all', coalesce(sum(owner_signed), 0)),
      'party_position', jsonb_build_object(
        'proven', coalesce(sum(party_signed) FILTER (WHERE lvl = 'proven'), 0),
        'proven_and_supported', coalesce(sum(party_signed) FILTER (WHERE lvl IN ('proven', 'supported')), 0),
        'all', coalesce(sum(party_signed), 0)),
      'disputed_offsets', coalesce(sum(amount) FILTER (WHERE kind = 'offset' AND a->>'offset_status' <> 'accepted'), 0)),
    'by_kind', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', k.kind, 'level', k.lvl, 'n', k.n, 'amount', k.amt)
                                          ORDER BY k.kind, k.lvl)
                          FROM (SELECT kind, lvl, count(*) n, sum(amount) amt FROM r GROUP BY kind, lvl) k), '[]'::jsonb),
    'lines', coalesce(jsonb_agg(jsonb_build_object(
        'seq', seq, 'id', id, 'table', tbl, 'kind', kind, 'occurred_on', occurred_on, 'amount', amount, 'currency', currency,
        'owner_signed', owner_signed, 'party_signed', party_signed, 'running_owner', running_owner,
        'running_party', running_party, 'level', lvl, 'basis', a->>'basis', 'job', a->>'job', 'vehicle_id', a->>'vehicle_id',
        'method', a->>'method', 'offset_status', a->>'offset_status', 'equipment', a->'equipment',
        'entry_key', a->>'entry_key', 'evidence', a->'evidence', 'note', a->>'note', 'booked_as', booked_as,
        'for_entry', a->>'for_entry', 'supersedes', a->>'supersedes', 'recorded_at', recorded_at) ORDER BY seq), '[]'::jsonb),
    'equipment', coalesce(jsonb_agg(jsonb_build_object('id', id, 'occurred_on', occurred_on, 'amount_offset', amount,
        'offset_status', a->>'offset_status', 'level', lvl, 'equipment', a->'equipment', 'booked_as', booked_as)
        ORDER BY seq) FILTER (WHERE kind = 'offset'), '[]'::jsonb),
    'tax_by_year', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'year', t.y,
        'work_owed', t.work_owed,
        'payments_booked_as_revenue', t.paid_rev,
        'payments_not_booked_as_revenue', t.paid_other,
        'collected_for_party', t.collected, 'remitted_to_party', t.remitted, 'advanced_for_party', t.advanced,
        'offsets_accepted', t.off_acc, 'offsets_disputed', t.off_disp) ORDER BY t.y)
      FROM (SELECT extract(year FROM occurred_on)::int y,
                   coalesce(sum(amount) FILTER (WHERE kind = 'work_owed'), 0) work_owed,
                   coalesce(sum(amount) FILTER (WHERE kind = 'payment'
                     AND EXISTS (SELECT 1 FROM jsonb_array_elements(booked_as) b WHERE b->>'section' = 'Revenue')), 0) paid_rev,
                   coalesce(sum(amount) FILTER (WHERE kind = 'payment'
                     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(booked_as) b WHERE b->>'section' = 'Revenue')), 0) paid_other,
                   coalesce(sum(amount) FILTER (WHERE kind = 'collected'), 0) collected,
                   coalesce(sum(amount) FILTER (WHERE kind = 'remittance'), 0) remitted,
                   coalesce(sum(amount) FILTER (WHERE kind = 'advance'), 0) advanced,
                   coalesce(sum(amount) FILTER (WHERE kind = 'offset' AND a->>'offset_status' = 'accepted'), 0) off_acc,
                   coalesce(sum(amount) FILTER (WHERE kind = 'offset' AND a->>'offset_status' <> 'accepted'), 0) off_disp
              FROM r GROUP BY 1) t), '[]'::jsonb))
  INTO v_out
  FROM r;
  RETURN v_out;
END $$;

COMMENT ON FUNCTION public.record_related_party_ledger_entry(uuid, jsonb, uuid) IS
  'Sanctioned writer of the related-party ledger (owner or service role). One entry per call: work_owed -> financial_deals '
  '(amount in rate_card_amount); advance, remittance (out) and payment, collected, offset (in) -> financial_payments. '
  'Idempotent on entry_key; supersedes = <id> appends a correction and stamps the old row; retract = true with a reason '
  'withdraws an entry. Evidence items {kind, author, key, document_id/local_id of a current book record, quote, at, role claim|context}.';
COMMENT ON FUNCTION public.related_party_ledger(uuid, date, timestamptz, uuid) IS
  'Owner-private related-party balance as of p_as_of (event clock) with what was recorded by p_known_at: the owner''s and '
  'the party''s positions by evidence level (proven, proven_and_supported, all), running lines with evidence keys and how '
  'the books currently carry each referenced record, offsets with their equipment, and per-year amounts for the tax side.';
COMMENT ON FUNCTION public.related_party_evidence_level(jsonb) IS
  'Evidence level of a ledger entry: proven (bank line, or an item authored by the party or a third party), supported (the '
  'owner''s own contemporaneous record), owner_word.';
COMMENT ON FUNCTION public.related_party_entry_sign(text, text, text) IS
  'Sign of a ledger entry in "what the party owes the owner"; offsets count in the owner position only when accepted.';

REVOKE ALL ON FUNCTION public.record_related_party_ledger_entry(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_related_party_ledger_entry(uuid, jsonb, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.related_party_ledger(uuid, date, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.related_party_ledger(uuid, date, timestamptz, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.related_party_evidence_level(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.related_party_evidence_level(jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.related_party_entry_sign(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.related_party_entry_sign(text, text, text) TO authenticated, service_role;

COMMIT;
