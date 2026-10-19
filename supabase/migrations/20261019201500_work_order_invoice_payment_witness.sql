-- Invoice and payment accounting on the work-order spine (standard language: completion -> invoice -> payment -> receipt).
-- No money moves: nothing charges, collects, refunds, releases or disburses. THEORY decisions 7 and 9: payment release is
-- a computed conclusion over evidence; status columns stay derived caches.
--
--   issue_work_order_invoice(p_work_order_id, p_lines, p_quote_id, p_due_at): provider/organization Sign (same eligibility
--     as attest_work_completion). Each call is a new immutable invoice version (latest current version wins). Lines
--     [{quote_line, description, pricing_basis, amount, currency, unit, quantity}] are definite (one currency, quantity
--     required for rates). quote_line indexes a line of the current accepted quote (p_quote_id, when given, must be that
--     quote); every difference from the quote is explicit in changes_from_quote (unchanged, changed fields, added,
--     omitted, quote total, delta). Without an accepted quote every line is 'added'.
--   record_work_order_payment(p_invoice_id, p_amount, p_currency, p_method, p_paid_at, p_reference): a payment WITNESS
--     against the current invoice: the payer (work order customer) reports paying, or the payee (provider/organization)
--     confirms receiving. It records testimony only.
--   Both write one owner-input work_record projected by project_work_order_lifecycle_event (new event types invoice and
--     payment_witness) into work_order_invoices / work_order_payment_witnesses. A restrictive policy keeps payment witness
--     sources readable only by their submitter (amounts and references reach parties through the reader below).
--   work_order_invoices_read(p_work_order_id): open reader. Invoice lines, prices and changes from the quote are open;
--     payment witnesses, references, reconciliation and release evaluation only to parties.
--   Reconciliation: payee-witnessed receipts (invoice currency, all invoice versions of the work order) against the
--     current invoice total; payer reports alone never settle (no double counting of the two sides of one payment).
--   Release: conditions[] evaluated over the Sign records (quote accepted, completion attested, completion accepted,
--     invoice current, invoice settled by payee witness) -> {conditions, met, basis}. The accepted quote declares no
--     release terms, so the platform standard predicates apply and say so. payment_authorized stays false; disbursement
--     'not_performed'.
--   generated_invoices (legacy, mutable payment fields, used by the web invoice tools and send-invoice-email) is not
--     read or changed; work_order_invoices is the observation-backed invoice for the job loop.
-- Job path: one added line after the accounting block (work_order_accounting_overlay): recorded only when a current
-- invoice exists and payee-witnessed payments cover it; no amounts in the job path. Legacy work_order_payments rows are
-- still counted and reported, never repaired.
-- Contract: supabase/sql/test_work_order_invoice_payment_witness.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE TABLE public.work_order_invoices (
  id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  issuer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  issuer_role text NOT NULL CHECK (issuer_role IN ('accepted_provider','organization_owner','organization_member')),
  issuer_organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  quote_id uuid,
  quote_hash text,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) BETWEEN 1 AND 200),
  total numeric NOT NULL CHECK (total >= 0 AND total < 1000000000),
  changes_from_quote jsonb NOT NULL CHECK (jsonb_typeof(changes_from_quote) = 'object'),
  due_at timestamptz CHECK (isfinite(due_at)),
  invoice_hash text NOT NULL CHECK (invoice_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz NOT NULL CHECK (isfinite(issued_at)),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (work_order_id, version),
  UNIQUE (id, work_order_id, invoice_hash),
  CHECK ((quote_id IS NULL) = (quote_hash IS NULL)),
  FOREIGN KEY (quote_id, work_order_id, quote_hash) REFERENCES public.work_order_quotes(id, work_order_id, quote_hash) ON DELETE RESTRICT
);
CREATE TABLE public.work_order_payment_witnesses (
  id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL,
  invoice_hash text NOT NULL,
  witness_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  witness_side text NOT NULL CHECK (witness_side IN ('payer','payee')),
  witness_role text NOT NULL CHECK (witness_role IN ('customer','accepted_provider','organization_owner','organization_member')),
  amount numeric NOT NULL CHECK (amount > 0 AND amount < 1000000000),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  method text NOT NULL CHECK (method IN ('cash','check','card','bank_transfer','ach','wire','zelle','venmo','paypal','other')),
  paid_at timestamptz NOT NULL CHECK (isfinite(paid_at)),
  reference text CHECK (length(reference) BETWEEN 1 AND 200),
  witnessed_at timestamptz NOT NULL CHECK (isfinite(witnessed_at)),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((witness_side = 'payer') = (witness_role = 'customer')),
  FOREIGN KEY (invoice_id, work_order_id, invoice_hash) REFERENCES public.work_order_invoices(id, work_order_id, invoice_hash) ON DELETE RESTRICT
);
CREATE INDEX work_order_payment_witnesses_work_order ON public.work_order_payment_witnesses(work_order_id, paid_at);
COMMENT ON TABLE public.work_order_invoices IS 'Immutable, versioned invoice per owner-input work_record (issue_work_order_invoice): definite lines, total, explicit changes from the accepted quote. Not a payment request or charge. Separate from legacy generated_invoices. Writer: project_work_order_lifecycle_event.';
COMMENT ON TABLE public.work_order_payment_witnesses IS 'Payment witness testimony (record_work_order_payment): payer reports paying or payee confirms receiving an amount against an invoice. Records testimony only; never moves money. Parties only. Writer: project_work_order_lifecycle_event.';
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['work_order_invoices','work_order_payment_witnesses'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY lifecycle_service_read ON public.%I FOR SELECT TO service_role USING (true)', t);
    EXECUTE format('CREATE TRIGGER lifecycle_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.work_order_lifecycle_immutable()', t);
    EXECUTE format('CREATE TRIGGER lifecycle_no_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.work_order_lifecycle_immutable()', t);
  END LOOP;
END $$;

CREATE POLICY work_order_payment_witness_private_read ON public.vehicle_observations AS RESTRICTIVE
FOR SELECT TO anon, authenticated USING (
  extraction_method IS DISTINCT FROM 'work_order_payment_witness_sign_v1' OR submitted_by_user_id = auth.uid());

-- Validates and normalizes invoice lines against the accepted quote lines (NULL when there is none).
CREATE FUNCTION public.work_order_invoice_lines(p_lines jsonb, p_quote_lines jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE
  ln jsonb; q jsonb; idx integer; qi integer; cur text; total numeric := 0; line_total numeric; changed text[];
  out_lines jsonb := '[]'::jsonb; used integer[] := '{}'; n_unchanged integer := 0; n_changed integer := 0; n_added integer := 0;
  quote_total numeric; quote_complete boolean;
BEGIN
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invoice lines must be an array of 1 to 200 lines' USING ERRCODE = '22023';
  END IF;
  FOR ln, idx IN SELECT value, (ordinality - 1)::integer FROM jsonb_array_elements(p_lines) WITH ORDINALITY LOOP
    IF jsonb_typeof(ln) IS DISTINCT FROM 'object'
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(ln) k WHERE k NOT IN ('quote_line','description','pricing_basis','amount','currency','unit','quantity'))
      OR jsonb_typeof(ln->'description') IS DISTINCT FROM 'string' OR length(btrim(ln->>'description')) NOT BETWEEN 1 AND 500
      OR COALESCE(ln->>'pricing_basis','') NOT IN ('flat','hourly','day_rate','per_operation')
      OR ln->>'unit' IS DISTINCT FROM (CASE ln->>'pricing_basis' WHEN 'hourly' THEN 'hour' WHEN 'day_rate' THEN 'day' WHEN 'per_operation' THEN 'operation' END)
      OR jsonb_typeof(ln->'amount') IS DISTINCT FROM 'number' OR (ln->>'amount')::numeric < 0
      OR jsonb_typeof(ln->'currency') IS DISTINCT FROM 'string' OR ln->>'currency' !~ '^[A-Z]{3}$'
      OR (ln->>'pricing_basis' = 'flat') <> (ln->'quantity' IS NULL OR ln->'quantity' = 'null'::jsonb)
      OR (ln->>'pricing_basis' <> 'flat' AND (jsonb_typeof(ln->'quantity') IS DISTINCT FROM 'number' OR (ln->>'quantity')::numeric <= 0))
      OR (ln->'quote_line' IS NOT NULL AND ln->'quote_line' <> 'null'::jsonb AND (jsonb_typeof(ln->'quote_line') <> 'number'
        OR (ln->>'quote_line') !~ '^[0-9]+$')) THEN
      RAISE EXCEPTION 'Invalid invoice line %', idx USING ERRCODE = '22023';
    END IF;
    IF cur IS NOT NULL AND cur <> ln->>'currency' THEN RAISE EXCEPTION 'An invoice uses one currency' USING ERRCODE = '22023'; END IF;
    cur := ln->>'currency';
    line_total := (ln->>'amount')::numeric * COALESCE((ln->>'quantity')::numeric, 1);
    total := total + line_total;
    qi := NULLIF(ln->>'quote_line', '')::integer;
    q := NULL; changed := '{}';
    IF qi IS NOT NULL THEN
      IF p_quote_lines IS NULL OR qi >= jsonb_array_length(p_quote_lines) THEN
        RAISE EXCEPTION 'Invoice line % names a quote line the accepted quote does not have', idx USING ERRCODE = '22023';
      END IF;
      IF qi = ANY(used) THEN RAISE EXCEPTION 'Quote line % is invoiced twice', qi USING ERRCODE = '22023'; END IF;
      used := used || qi;
      q := p_quote_lines->qi;
      SELECT COALESCE(array_agg(k ORDER BY k), '{}') INTO changed FROM unnest(ARRAY['description','pricing_basis','amount','currency','unit','quantity']) k
        WHERE COALESCE(ln->k, 'null'::jsonb) IS DISTINCT FROM COALESCE(q->k, 'null'::jsonb);
      IF cardinality(changed) = 0 THEN n_unchanged := n_unchanged + 1; ELSE n_changed := n_changed + 1; END IF;
    ELSE
      n_added := n_added + 1;
    END IF;
    out_lines := out_lines || jsonb_build_array(jsonb_build_object('line', idx, 'quote_line', qi, 'ref_kind', q->'ref_kind', 'ref_id', q->'ref_id',
      'description', btrim(ln->>'description'), 'pricing_basis', ln->>'pricing_basis', 'amount', (ln->>'amount')::numeric, 'currency', cur,
      'unit', ln->>'unit', 'quantity', (ln->>'quantity')::numeric, 'line_total', line_total,
      'change', CASE WHEN qi IS NULL THEN 'added' WHEN cardinality(changed) = 0 THEN 'unchanged' ELSE 'changed' END,
      'changed_fields', to_jsonb(changed),
      'quote_line_total', CASE WHEN q->>'amount' IS NULL THEN NULL WHEN q->>'pricing_basis' = 'flat' THEN (q->>'amount')::numeric
        WHEN q->>'quantity' IS NOT NULL THEN (q->>'amount')::numeric * (q->>'quantity')::numeric END));
  END LOOP;
  IF p_quote_lines IS NOT NULL THEN
    SELECT sum(CASE WHEN l->>'pricing_basis' = 'flat' THEN (l->>'amount')::numeric ELSE (l->>'amount')::numeric * (l->>'quantity')::numeric END),
      bool_and(l->>'amount' IS NOT NULL AND l->>'currency' = cur AND (l->>'pricing_basis' = 'flat' OR l->>'quantity' IS NOT NULL))
    INTO quote_total, quote_complete FROM jsonb_array_elements(p_quote_lines) l;
  END IF;
  RETURN jsonb_build_object('currency', cur, 'total', total, 'lines', out_lines, 'changes_from_quote', jsonb_build_object(
    'basis', CASE WHEN p_quote_lines IS NULL THEN 'no_accepted_quote' ELSE 'accepted_quote' END,
    'unchanged', n_unchanged, 'changed', n_changed, 'added', n_added,
    'omitted_quote_lines', CASE WHEN p_quote_lines IS NULL THEN '[]'::jsonb ELSE (SELECT COALESCE(jsonb_agg(i ORDER BY i), '[]'::jsonb)
      FROM generate_series(0, jsonb_array_length(p_quote_lines) - 1) i WHERE i <> ALL(used)) END,
    'quote_total', CASE WHEN quote_complete THEN quote_total END,
    'quote_total_complete', COALESCE(quote_complete, false),
    'delta_from_quote', CASE WHEN quote_complete THEN total - quote_total END,
    'totals_basis', 'flat amounts plus rate times quantity; the quote total only when every quote line is priced in the invoice currency'));
END $$;

CREATE FUNCTION public.work_order_current_invoice(p_work_order_id uuid) RETURNS SETOF public.work_order_invoices
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT i.* FROM public.work_order_invoices i JOIN public.vehicle_observations s ON s.id = i.id
  WHERE i.work_order_id = p_work_order_id AND s.is_superseded IS FALSE ORDER BY i.version DESC LIMIT 1
$$;

CREATE FUNCTION public.work_order_invoice_reconciliation(p_work_order_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
  WITH inv AS (SELECT * FROM public.work_order_current_invoice(p_work_order_id)),
  pays AS (SELECT p.* FROM public.work_order_payment_witnesses p JOIN public.vehicle_observations s ON s.id = p.id
    WHERE p.work_order_id = p_work_order_id AND s.is_superseded IS FALSE),
  sums AS (SELECT
      COALESCE(sum(p.amount) FILTER (WHERE p.witness_side = 'payee' AND p.currency = inv.currency), 0) AS received,
      COALESCE(sum(p.amount) FILTER (WHERE p.witness_side = 'payer' AND p.currency = inv.currency), 0) AS reported,
      count(p.id) FILTER (WHERE p.witness_side = 'payee') AS n_payee, count(p.id) FILTER (WHERE p.witness_side = 'payer') AS n_payer,
      count(p.id) FILTER (WHERE p.currency <> inv.currency) AS n_other
    FROM inv LEFT JOIN pays p ON true)
  SELECT CASE WHEN inv.id IS NULL THEN NULL ELSE jsonb_build_object('invoice_id', inv.id, 'invoice_version', inv.version,
    'currency', inv.currency, 'invoice_total', inv.total, 'confirmed_received', s.received, 'payer_reported', s.reported,
    'balance_due', GREATEST(inv.total - s.received, 0), 'overpaid_by', GREATEST(s.received - inv.total, 0),
    'payee_witnesses', s.n_payee, 'payer_witnesses', s.n_payer, 'other_currency_witnesses', s.n_other,
    'state', CASE WHEN s.received >= inv.total THEN 'paid' WHEN s.received > 0 THEN 'partially_paid'
      WHEN s.reported >= inv.total THEN 'payer_reported_unconfirmed' ELSE 'unpaid' END,
    'basis', 'payee-witnessed receipts in the invoice currency across this work order''s invoice versions, against the current invoice total; payer reports alone do not settle; no money moved') END
  FROM inv CROSS JOIN sums s
$$;

-- Release is a computed conclusion over the Sign records; it authorizes nothing.
CREATE FUNCTION public.work_order_release_evaluation(p_work_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  qs jsonb := public.work_order_quote_state(p_work_order_id);
  comp jsonb := public.work_order_completion_overlay(p_work_order_id, '{}'::jsonb);
  inv public.work_order_invoices%ROWTYPE;
  rec jsonb := public.work_order_invoice_reconciliation(p_work_order_id);
  conditions jsonb;
BEGIN
  SELECT * INTO inv FROM public.work_order_current_invoice(p_work_order_id);
  conditions := jsonb_build_array(
    jsonb_build_object('key', 'quote_accepted_by_customer', 'met', qs#>>'{acceptance,state}' = 'accepted',
      'basis', CASE WHEN qs#>>'{acceptance,state}' = 'accepted' THEN 'quote_acceptance:' || (qs#>>'{acceptance,acceptance_id}')
        ELSE 'no current customer quote acceptance' END),
    jsonb_build_object('key', 'completion_attested_by_provider', 'met', comp->'provider_attestation' <> 'null'::jsonb,
      'basis', COALESCE('completion_attestation:' || (comp#>>'{provider_attestation,completion_id}'), 'no current provider completion attestation')),
    jsonb_build_object('key', 'completion_accepted_by_customer', 'met', comp->>'customer_acceptance' = 'established',
      'basis', COALESCE('completion_acceptance:' || (comp#>>'{customer_acceptance_sign,acceptance_id}'), 'no customer completion acceptance')),
    jsonb_build_object('key', 'invoice_current', 'met', inv.id IS NOT NULL,
      'basis', COALESCE('invoice:' || inv.id::text || ':v' || inv.version::text, 'no invoice')),
    jsonb_build_object('key', 'invoice_settled_by_payee_witness', 'met', rec->>'state' = 'paid',
      'basis', COALESCE('reconciliation:' || (rec->>'state'), 'no invoice')));
  RETURN jsonb_build_object('conditions', conditions,
    'met', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(conditions) c WHERE (c->>'met')::boolean IS NOT TRUE),
    'basis', jsonb_build_array('predicates: platform standard; the accepted quote declares no release terms',
      'declared_at_acceptance: ' || COALESCE(qs#>>'{acceptance,acceptance_id}', 'none'),
      'evaluated_over: quote, completion, invoice and payment witness Sign records at as_of'),
    'payment_authorized', false, 'disbursement', 'not_performed');
END $$;

CREATE OR REPLACE FUNCTION public.project_work_order_lifecycle_event(p_observation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  o public.vehicle_observations%ROWTYPE;
  e jsonb;
  w public.work_orders%ROWTYPE;
  ev text;
  role text;
  basis jsonb;
  att public.work_order_completion_attestations%ROWTYPE;
  inv public.work_order_invoices%ROWTYPE;
  qs jsonb;
  qline jsonb;
  norm jsonb;
  next_version integer;
  inserted integer;
BEGIN
  SELECT * INTO o FROM public.vehicle_observations WHERE id = p_observation_id FOR SHARE;
  IF NOT FOUND OR o.kind::text <> 'work_record' OR o.is_superseded IS DISTINCT FROM false OR o.submitted_by_user_id IS NULL
     OR o.source_id IS DISTINCT FROM (SELECT id FROM public.observation_sources WHERE slug = 'owner-input') THEN
    RAISE EXCEPTION 'Current signed owner-input work_record required';
  END IF;
  e := o.structured_data->'work_order_lifecycle';
  IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR e->>'version' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'work_order_lifecycle version 1 envelope required'; END IF;
  ev := e->>'event_type';
  SELECT * INTO w FROM public.work_orders WHERE id = (e->>'work_order_id')::uuid FOR SHARE;
  IF NOT FOUND OR w.vehicle_id IS NULL OR w.vehicle_id IS DISTINCT FROM o.vehicle_id THEN RAISE EXCEPTION 'Source and work order must identify the same vehicle'; END IF;
  IF ev = 'completion_attestation' THEN
    role := public.work_order_completion_signer_role(w.id, o.submitted_by_user_id);
    IF role IS NULL OR role IS DISTINCT FROM e->>'signer_role' THEN RAISE EXCEPTION 'Signer is not an eligible provider for this work order'; END IF;
    basis := public.work_order_completion_basis(w.id);
    IF e->>'scope_hash' IS DISTINCT FROM basis->>'scope_hash' THEN RAISE EXCEPTION 'Scope hash does not match the current accepted quote or scope'; END IF;
    IF NOT public.work_order_lifecycle_evidence_valid(e->'evidence', w.vehicle_id) THEN RAISE EXCEPTION 'Evidence must name existing rows on this vehicle'; END IF;
    INSERT INTO public.work_order_completion_attestations(id, work_order_id, signer_user_id, signer_role, scope_basis, quote_id, quote_hash,
      scope_hash, evidence, completion_hash, signed_at)
    VALUES (o.id, w.id, o.submitted_by_user_id, role, basis->>'basis', (basis->>'quote_id')::uuid,
      CASE WHEN basis->>'basis' = 'accepted_quote' THEN basis->>'scope_hash' END, basis->>'scope_hash', COALESCE(e->'evidence', '[]'::jsonb),
      encode(sha256(convert_to(jsonb_build_array('work_order_completion', w.id, o.submitted_by_user_id, role, basis->>'scope_hash',
        COALESCE(e->'evidence', '[]'::jsonb), o.observed_at)::text, 'UTF8')), 'hex'), o.observed_at)
    ON CONFLICT (id) DO NOTHING;
  ELSIF ev = 'completion_acceptance' THEN
    IF w.customer_id IS DISTINCT FROM o.submitted_by_user_id THEN RAISE EXCEPTION 'Only the work order customer accepts completion'; END IF;
    SELECT a.* INTO att FROM public.work_order_completion_attestations a JOIN public.vehicle_observations s ON s.id = a.id
      WHERE a.id = (e->>'completion_id')::uuid AND a.work_order_id = w.id AND s.is_superseded IS FALSE;
    IF att.id IS NULL OR att.completion_hash IS DISTINCT FROM e->>'completion_hash' THEN RAISE EXCEPTION 'Completion attestation and hash must match'; END IF;
    IF att.scope_hash IS DISTINCT FROM public.work_order_completion_basis(w.id)->>'scope_hash' THEN
      RAISE EXCEPTION 'Completion attestation is withheld: its quote or scope is no longer current';
    END IF;
    INSERT INTO public.work_order_completion_acceptances(id, work_order_id, completion_id, completion_hash, signer_user_id, signer_role, signed_at)
    VALUES (o.id, w.id, att.id, att.completion_hash, o.submitted_by_user_id, 'customer', o.observed_at) ON CONFLICT (id) DO NOTHING;
  ELSIF ev = 'invoice' THEN
    IF EXISTS (SELECT 1 FROM public.work_order_invoices WHERE id = o.id) THEN RETURN jsonb_build_object('id', o.id, 'event_type', ev, 'duplicate', true); END IF;
    role := public.work_order_completion_signer_role(w.id, o.submitted_by_user_id);
    IF role IS NULL OR role IS DISTINCT FROM e->>'issuer_role' THEN RAISE EXCEPTION 'Issuer is not an eligible provider for this work order'; END IF;
    qs := public.work_order_quote_state(w.id);
    IF qs#>>'{acceptance,state}' = 'accepted' THEN
      SELECT q.lines INTO qline FROM public.work_order_quotes q WHERE q.id = (qs#>>'{acceptance,quote_id}')::uuid;
    END IF;
    IF e->>'quote_id' IS DISTINCT FROM (CASE WHEN qline IS NOT NULL THEN qs#>>'{acceptance,quote_id}' END) THEN
      RAISE EXCEPTION 'Invoice must reference the current accepted quote';
    END IF;
    norm := public.work_order_invoice_lines(e->'lines', qline);
    SELECT COALESCE(max(version), 0) + 1 INTO next_version FROM public.work_order_invoices WHERE work_order_id = w.id;
    INSERT INTO public.work_order_invoices(id, work_order_id, version, issuer_user_id, issuer_role, issuer_organization_id, quote_id, quote_hash,
      currency, lines, total, changes_from_quote, due_at, invoice_hash, issued_at)
    VALUES (o.id, w.id, next_version, o.submitted_by_user_id, role, CASE WHEN role LIKE 'organization_%' THEN w.organization_id END,
      CASE WHEN qline IS NOT NULL THEN (qs#>>'{acceptance,quote_id}')::uuid END, CASE WHEN qline IS NOT NULL THEN qs#>>'{acceptance,quote_hash}' END,
      norm->>'currency', norm->'lines', (norm->>'total')::numeric, norm->'changes_from_quote', (e->>'due_at')::timestamptz,
      encode(sha256(convert_to(jsonb_build_array('work_order_invoice', w.id, next_version, qs#>>'{acceptance,quote_hash}', norm->'lines',
        norm->>'currency', norm->'total', e->'due_at', o.observed_at)::text, 'UTF8')), 'hex'), o.observed_at);
  ELSIF ev = 'payment_witness' THEN
    SELECT * INTO inv FROM public.work_order_current_invoice(w.id);
    IF inv.id IS NULL OR inv.id IS DISTINCT FROM (e->>'invoice_id')::uuid THEN RAISE EXCEPTION 'Payment witness must name the current invoice'; END IF;
    role := CASE WHEN w.customer_id IS NOT DISTINCT FROM o.submitted_by_user_id THEN 'customer'
      ELSE public.work_order_completion_signer_role(w.id, o.submitted_by_user_id) END;
    IF role IS NULL OR role IS DISTINCT FROM e->>'witness_role' THEN RAISE EXCEPTION 'Witness is not a party to this invoice'; END IF;
    IF e->>'currency' IS DISTINCT FROM inv.currency THEN RAISE EXCEPTION 'Payment currency must match the invoice currency'; END IF;
    INSERT INTO public.work_order_payment_witnesses(id, work_order_id, invoice_id, invoice_hash, witness_user_id, witness_side, witness_role,
      amount, currency, method, paid_at, reference, witnessed_at)
    VALUES (o.id, w.id, inv.id, inv.invoice_hash, o.submitted_by_user_id, CASE WHEN role = 'customer' THEN 'payer' ELSE 'payee' END, role,
      (e->>'amount')::numeric, e->>'currency', e->>'method', (e->>'paid_at')::timestamptz, e->>'reference', o.observed_at)
    ON CONFLICT (id) DO NOTHING;
  ELSE
    RAISE EXCEPTION 'Unknown work_order_lifecycle event type';
  END IF;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN jsonb_build_object('id', o.id, 'event_type', ev, 'duplicate', inserted = 0);
END $$;

CREATE FUNCTION public.issue_work_order_invoice(p_work_order_id uuid, p_lines jsonb, p_quote_id uuid DEFAULT NULL, p_due_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid();
  issued timestamptz := now();
  w public.work_orders%ROWTYPE;
  role text;
  qs jsonb;
  quote_id uuid;
  owner_source uuid;
  request_key text;
  obs_id uuid;
  dup boolean := false;
  i public.work_order_invoices%ROWTYPE;
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  role := public.work_order_completion_signer_role(p_work_order_id, signer);
  IF w.id IS NULL OR role IS NULL THEN RAISE EXCEPTION 'Work order unavailable for invoicing' USING ERRCODE = '42501'; END IF;
  IF w.vehicle_id IS NULL THEN RAISE EXCEPTION 'An invoice needs a vehicle-bound work order' USING ERRCODE = '23514'; END IF;
  IF p_due_at IS NOT NULL AND NOT isfinite(p_due_at) THEN RAISE EXCEPTION 'Due date must be finite' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('work_order_lifecycle:' || w.id::text, 0));
  qs := public.work_order_quote_state(w.id);
  IF qs#>>'{acceptance,state}' = 'accepted' THEN quote_id := (qs#>>'{acceptance,quote_id}')::uuid; END IF;
  IF p_quote_id IS NOT NULL AND p_quote_id IS DISTINCT FROM quote_id THEN
    RAISE EXCEPTION 'Invoice must reference the current accepted quote' USING ERRCODE = '23514';
  END IF;
  PERFORM public.work_order_invoice_lines(p_lines, (SELECT q.lines FROM public.work_order_quotes q WHERE q.id = quote_id));
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;
  request_key := md5(jsonb_build_array('work-order-invoice', signer, w.id, quote_id, p_lines, p_due_at)::text);
  SELECT x.* INTO i FROM public.work_order_current_invoice(w.id) x JOIN public.vehicle_observations o ON o.id = x.id
    WHERE o.source_id = owner_source AND o.source_identifier = 'work_order_invoice:' || w.id::text AND o.content_hash = request_key;
  IF i.id IS NOT NULL THEN
    dup := true;
  ELSE
    INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, observed_at_basis, source_event_at,
      source_event_time_precision, kind, content_text, content_hash, structured_data, submitted_by_user_id, observer_raw, extraction_method,
      confidence, confidence_score)
    VALUES (w.vehicle_id, owner_source, 'work_order_invoice:' || w.id::text, issued, 'event_time', issued, 'exact', 'work_record',
      format('Provider issued an invoice for work order %s.', w.id), request_key,
      jsonb_build_object('work_order_lifecycle', jsonb_build_object('version', 1, 'event_type', 'invoice', 'work_order_id', w.id,
        'quote_id', quote_id, 'lines', p_lines, 'due_at', p_due_at, 'issuer_role', role, 'signer_user_id', signer)),
      signer, jsonb_build_object('user_id', signer, 'intake_actor', 'account', 'issuer_role', role), 'work_order_invoice_sign_v1', 'high', 0.95)
    RETURNING id INTO obs_id;
    PERFORM public.project_work_order_lifecycle_event(obs_id);
    SELECT * INTO i FROM public.work_order_invoices WHERE id = obs_id;
  END IF;
  RETURN jsonb_build_object('invoice_id', i.id, 'version', i.version, 'invoice_hash', i.invoice_hash, 'work_order_id', w.id,
    'quote_id', i.quote_id, 'currency', i.currency, 'total', i.total, 'changes_from_quote', i.changes_from_quote, 'due_at', i.due_at,
    'issued_at', i.issued_at, 'issuer_role', i.issuer_role, 'duplicate', dup, 'customer_notified', false, 'payment_requested', false,
    'payment_authorized', false, 'money_moved', false);
END $$;

CREATE FUNCTION public.record_work_order_payment(p_invoice_id uuid, p_amount numeric, p_currency text, p_method text, p_paid_at timestamptz,
  p_reference text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  signer uuid := auth.uid();
  witnessed timestamptz := now();
  i public.work_order_invoices%ROWTYPE;
  w public.work_orders%ROWTYPE;
  role text;
  owner_source uuid;
  request_key text;
  obs_id uuid;
  dup boolean := false;
  p public.work_order_payment_witnesses%ROWTYPE;
BEGIN
  IF signer IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO i FROM public.work_order_invoices WHERE id = p_invoice_id;
  SELECT * INTO w FROM public.work_orders WHERE id = i.work_order_id;
  role := CASE WHEN w.id IS NULL THEN NULL WHEN w.customer_id IS NOT DISTINCT FROM signer THEN 'customer'
    ELSE public.work_order_completion_signer_role(w.id, signer) END;
  IF role IS NULL THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE = '42501'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount >= 1000000000 THEN RAISE EXCEPTION 'Amount must be positive' USING ERRCODE = '22023'; END IF;
  IF p_currency IS DISTINCT FROM i.currency THEN RAISE EXCEPTION 'Payment currency must match the invoice currency' USING ERRCODE = '22023'; END IF;
  IF p_method IS NULL OR p_method NOT IN ('cash','check','card','bank_transfer','ach','wire','zelle','venmo','paypal','other') THEN
    RAISE EXCEPTION 'Unknown payment method' USING ERRCODE = '22023';
  END IF;
  IF p_paid_at IS NULL OR NOT isfinite(p_paid_at) OR p_paid_at > witnessed + interval '1 day' THEN
    RAISE EXCEPTION 'Paid time must be a finite time, not in the future' USING ERRCODE = '22023';
  END IF;
  IF p_reference IS NOT NULL AND length(p_reference) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Reference must be 1 to 200 characters' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('work_order_lifecycle:' || w.id::text, 0));
  IF (SELECT x.id FROM public.work_order_current_invoice(w.id) x) IS DISTINCT FROM i.id THEN
    RAISE EXCEPTION 'Only the current invoice version takes payment witnesses' USING ERRCODE = '23514';
  END IF;
  SELECT id INTO owner_source FROM public.observation_sources WHERE slug = 'owner-input';
  IF owner_source IS NULL THEN RAISE EXCEPTION 'owner-input source unavailable'; END IF;
  request_key := md5(jsonb_build_array('work-order-payment-witness', signer, i.id, p_amount, p_currency, p_method, p_paid_at, p_reference)::text);
  SELECT x.* INTO p FROM public.work_order_payment_witnesses x JOIN public.vehicle_observations o ON o.id = x.id
    WHERE o.source_id = owner_source AND o.source_identifier = 'work_order_payment_witness:' || i.id::text
      AND o.content_hash = request_key AND o.is_superseded IS FALSE;
  IF p.id IS NOT NULL THEN
    dup := true;
  ELSE
    INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, observed_at_basis, source_event_at,
      source_event_time_precision, kind, content_text, content_hash, structured_data, submitted_by_user_id, observer_raw, extraction_method,
      confidence, confidence_score)
    VALUES (w.vehicle_id, owner_source, 'work_order_payment_witness:' || i.id::text, witnessed, 'event_time', p_paid_at, 'exact', 'work_record',
      format('Payment witness on an invoice for work order %s.', w.id), request_key,
      jsonb_build_object('work_order_lifecycle', jsonb_build_object('version', 1, 'event_type', 'payment_witness', 'work_order_id', w.id,
        'invoice_id', i.id, 'amount', p_amount, 'currency', p_currency, 'method', p_method, 'paid_at', p_paid_at, 'reference', p_reference,
        'witness_role', role, 'signer_user_id', signer)),
      signer, jsonb_build_object('user_id', signer, 'intake_actor', 'account', 'witness_role', role), 'work_order_payment_witness_sign_v1', 'high', 0.95)
    RETURNING id INTO obs_id;
    PERFORM public.project_work_order_lifecycle_event(obs_id);
    SELECT * INTO p FROM public.work_order_payment_witnesses WHERE id = obs_id;
  END IF;
  RETURN jsonb_build_object('payment_witness_id', p.id, 'invoice_id', i.id, 'work_order_id', w.id, 'witness_side', p.witness_side,
    'witness_role', p.witness_role, 'amount', p.amount, 'currency', p.currency, 'method', p.method, 'paid_at', p.paid_at,
    'witnessed_at', p.witnessed_at, 'reconciliation', public.work_order_invoice_reconciliation(w.id), 'duplicate', dup,
    'money_moved', false, 'payment_authorized', false, 'disbursement', 'not_performed');
END $$;

CREATE FUNCTION public.work_order_invoices_read(p_work_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  viewer uuid := auth.uid();
  w public.work_orders%ROWTYPE;
  my_slots text[];
  party boolean;
  cur_id uuid;
  invoices jsonb;
  payments jsonb;
  actions jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501'; END IF;
  SELECT s.slots INTO my_slots FROM public.work_order_viewer_slots(viewer, w.id) s;
  my_slots := COALESCE(my_slots, '{}'::text[]);
  IF viewer IS NOT NULL AND NOT 'customer' = ANY(my_slots) AND public.work_order_completion_signer_role(w.id, viewer) IS NOT NULL THEN
    my_slots := array_append(my_slots, 'payee');
  END IF;
  IF cardinality(my_slots) = 0 AND NOT public.work_order_vehicle_open(w.vehicle_id) THEN
    RAISE EXCEPTION 'Work order unavailable' USING ERRCODE = '42501';
  END IF;
  party := public.job_reader_is_party(my_slots) OR 'payee' = ANY(my_slots);
  SELECT x.id INTO cur_id FROM public.work_order_current_invoice(w.id) x;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('invoice_id', i.id, 'version', i.version, 'current', i.id = cur_id,
      'status', CASE WHEN i.id = cur_id THEN 'current' WHEN s.is_superseded IS NOT FALSE THEN 'withdrawn' ELSE 'superseded_by_later_version' END,
      'issued_at', i.issued_at, 'due_at', i.due_at, 'invoice_hash', i.invoice_hash,
      'issuer', CASE WHEN i.issuer_organization_id IS NOT NULL THEN public.platform_organization_label(i.issuer_organization_id)
          ELSE public.platform_person_label(i.issuer_user_id) END
        || jsonb_build_object('role', i.issuer_role) || CASE WHEN party THEN jsonb_build_object('user_id', i.issuer_user_id) ELSE '{}'::jsonb END,
      'quote', CASE WHEN i.quote_id IS NULL THEN NULL ELSE jsonb_build_object('quote_id', i.quote_id, 'quote_hash', i.quote_hash,
        'quote_version', (SELECT q.version FROM public.work_order_quotes q WHERE q.id = i.quote_id)) END,
      'currency', i.currency, 'lines', i.lines, 'total', i.total, 'changes_from_quote', i.changes_from_quote,
      'attribution', 'authenticated_sign') ORDER BY i.version DESC), '[]'::jsonb)
  INTO invoices FROM public.work_order_invoices i JOIN public.vehicle_observations s ON s.id = i.id WHERE i.work_order_id = w.id;
  IF party THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('payment_witness_id', p.id, 'invoice_id', p.invoice_id, 'witness_side', p.witness_side,
        'witness_role', p.witness_role, 'amount', p.amount, 'currency', p.currency, 'method', p.method, 'paid_at', p.paid_at,
        'reference', p.reference, 'witnessed_at', p.witnessed_at, 'witness', public.platform_person_label(p.witness_user_id)
          || jsonb_build_object('user_id', p.witness_user_id), 'attribution', 'authenticated_sign') ORDER BY p.paid_at, p.id), '[]'::jsonb)
    INTO payments FROM public.work_order_payment_witnesses p JOIN public.vehicle_observations s ON s.id = p.id
    WHERE p.work_order_id = w.id AND s.is_superseded IS FALSE;
    IF viewer IS NOT NULL AND public.work_order_completion_signer_role(w.id, viewer) IS NOT NULL AND w.vehicle_id IS NOT NULL THEN
      actions := actions || jsonb_build_array(jsonb_build_object('action', 'issue_invoice', 'rpc', 'issue_work_order_invoice',
        'args', jsonb_build_object('p_work_order_id', w.id)));
    END IF;
    IF cur_id IS NOT NULL THEN
      actions := actions || jsonb_build_array(jsonb_build_object('action', 'record_payment', 'rpc', 'record_work_order_payment',
        'args', jsonb_build_object('p_invoice_id', cur_id),
        'as', CASE WHEN 'customer' = ANY(my_slots) AND w.customer_id = viewer THEN 'payer' ELSE 'payee' END));
    END IF;
  END IF;
  RETURN public.work_order_open_header(w.id, party) || jsonb_build_object('work_order_id', w.id, 'as_of', statement_timestamp(),
    'invoices', invoices, 'current_invoice_id', cur_id,
    'payments', payments, 'reconciliation', CASE WHEN party THEN public.work_order_invoice_reconciliation(w.id) END,
    'release', CASE WHEN party THEN public.work_order_release_evaluation(w.id) END,
    'payments_visibility', CASE WHEN party THEN 'shown_to_party' ELSE 'withheld_not_party' END,
    'viewer', public.job_reader_viewer(CASE WHEN 'payee' = ANY(my_slots) AND public.job_reader_context(my_slots) = 'visitor' THEN 'provider'
        ELSE public.job_reader_context(my_slots) END, my_slots, public.viewer_identity_bridge(viewer), party)
      || jsonb_build_object('party', party, 'actions', CASE WHEN viewer IS NULL OR NOT party THEN '[]'::jsonb ELSE actions END),
    'coverage', jsonb_build_object('invoice_versions', jsonb_array_length(invoices), 'source_scope', 'issue_work_order_invoice and record_work_order_payment Sign records',
      'legacy_generated_invoices', 'not_read', 'customer_contact', 'never_returned'),
    'people_basis', 'people appear by public profile handle, otherwise as unnamed party; organizations by name; raw ids to parties only',
    'money_moved', false, 'payment_authorized', false, 'disbursement', 'not_performed');
END $$;

-- The job path's accounting stage: recorded only when a current invoice is settled by payee witnesses. No amounts.
CREATE FUNCTION public.work_order_accounting_overlay(p_work_order_id uuid, p_stage jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  inv public.work_order_invoices%ROWTYPE;
  rec jsonb := public.work_order_invoice_reconciliation(p_work_order_id);
  n_witness integer;
  state text;
  gaps jsonb := COALESCE(p_stage->'gaps', '[]'::jsonb);
  bad jsonb := COALESCE(p_stage->'inconsistencies', '[]'::jsonb);
BEGIN
  SELECT * INTO inv FROM public.work_order_current_invoice(p_work_order_id);
  SELECT count(*) INTO n_witness FROM public.work_order_payment_witnesses p JOIN public.vehicle_observations s ON s.id = p.id
    WHERE p.work_order_id = p_work_order_id AND s.is_superseded IS FALSE;
  state := CASE WHEN inv.id IS NOT NULL AND rec->>'state' = 'paid' THEN 'recorded' WHEN inv.id IS NOT NULL THEN 'partial'
    WHEN p_stage->>'state' = 'recorded' THEN 'partial' ELSE p_stage->>'state' END;
  IF n_witness > 0 THEN
    gaps := gaps - 'no_payment_record';
    bad := bad - 'paid_status_without_payment_record';
  END IF;
  IF inv.id IS NULL THEN gaps := gaps || '["no_invoice"]'::jsonb;
  ELSIF rec->>'state' = 'payer_reported_unconfirmed' THEN gaps := gaps || '["payment_reported_by_payer_unconfirmed"]'::jsonb;
  ELSIF rec->>'state' <> 'paid' THEN gaps := gaps || '["invoice_balance_open"]'::jsonb; END IF;
  IF (rec->>'overpaid_by')::numeric > 0 THEN bad := bad || '["payment_witnesses_exceed_invoice"]'::jsonb; END IF;
  RETURN p_stage || jsonb_build_object('state', state,
    'state_basis', CASE WHEN state = 'recorded' THEN 'current_invoice_settled_by_payee_witness'
      WHEN inv.id IS NOT NULL THEN 'current_invoice_open' WHEN p_stage->>'state' = 'recorded' THEN 'legacy_payment_records_without_invoice'
      ELSE 'no_invoice' END,
    'invoice', CASE WHEN inv.id IS NULL THEN NULL ELSE jsonb_build_object('invoice_id', inv.id, 'version', inv.version, 'issued_at', inv.issued_at,
      'due_at', inv.due_at, 'line_count', jsonb_array_length(inv.lines), 'quote_basis', inv.changes_from_quote->>'basis',
      'lines_changed_from_quote', (inv.changes_from_quote->>'changed')::int, 'lines_added', (inv.changes_from_quote->>'added')::int,
      'quote_lines_omitted', jsonb_array_length(inv.changes_from_quote->'omitted_quote_lines'), 'basis', 'authenticated_sign') END,
    'reconciliation', CASE WHEN inv.id IS NULL THEN NULL ELSE jsonb_build_object('state', rec->>'state', 'payee_witnesses', rec->'payee_witnesses',
      'payer_witnesses', rec->'payer_witnesses', 'basis', rec->>'basis') END,
    'release', public.work_order_release_evaluation(p_work_order_id),
    'payment_authorized', false, 'disbursement', 'not_performed', 'money_moved', false,
    'gaps', gaps, 'inconsistencies', bad);
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['work_order_invoice_lines(jsonb,jsonb)','work_order_current_invoice(uuid)','work_order_invoice_reconciliation(uuid)',
      'work_order_release_evaluation(uuid)','work_order_accounting_overlay(uuid,jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['issue_work_order_invoice(uuid,jsonb,uuid,timestamptz)',
      'record_work_order_payment(uuid,numeric,text,text,timestamptz,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.work_order_invoices_read(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.work_order_invoices_read(uuid) TO anon, authenticated;
COMMENT ON FUNCTION public.issue_work_order_invoice(uuid,jsonb,uuid,timestamptz) IS 'Sign: an eligible provider (accepted provider, organization owner or member) issues a new immutable invoice version with definite lines and explicit changes from the current accepted quote. Not a payment request; no messaging.';
COMMENT ON FUNCTION public.record_work_order_payment(uuid,numeric,text,text,timestamptz,text) IS 'Sign: payer (customer) or payee (provider/organization) witnesses a payment against the current invoice. Testimony only: never charges, collects, refunds or disburses.';
COMMENT ON FUNCTION public.work_order_invoices_read(uuid) IS 'Open (anon and authenticated) invoice reader: invoice versions, lines, totals and changes from the quote open; payment witnesses, references, reconciliation and release evaluation only to parties (customer, organization owner, provider). Non-public vehicles only for slot holders. Read-only; payment_authorized false.';

DO $apply$
DECLARE
  def text := pg_get_functiondef('public.read_work_order_job_path(uuid)'::regprocedure);
  anchor constant text := $a$CASE WHEN n_pay>0 AND w.vehicle_id IS NULL THEN 'payments_without_vehicle' END],NULL)));$a$;
BEGIN
  IF position('work_order_accounting_overlay' IN def) > 0 THEN RAISE EXCEPTION 'job path already carries the accounting overlay'; END IF;
  IF (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 THEN RAISE EXCEPTION 'job path accounting block not found once'; END IF;
  EXECUTE replace(def, anchor, anchor || E'\n  accounting := public.work_order_accounting_overlay(w.id, accounting);');
END $apply$;

INSERT INTO public.pipeline_registry(table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT t, 'id', 'project_work_order_lifecycle_event', d, true, v
FROM (VALUES ('work_order_invoices', 'Observation-keyed invoice versions; written only by the Sign RPC in its transaction.', 'issue_work_order_invoice(uuid,jsonb,uuid,timestamptz)'),
  ('work_order_payment_witnesses', 'Observation-keyed payment witness testimony; never moves money.', 'record_work_order_payment(uuid,numeric,text,text,timestamptz,text)')) x(t, d, v)
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry r WHERE r.table_name = x.t AND r.column_name = 'id');
NOTIFY pgrst, 'reload schema';
COMMIT;
