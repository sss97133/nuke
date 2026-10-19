-- Card payment of a work order invoice through Stripe Checkout (owner, 2026-10-19: "build it out we have stripe").
-- Collection only: the customer pays the current invoice's balance into the platform's Stripe account. Nothing here
-- transfers, pays out or releases funds to a provider; the job path keeps disbursement 'not_performed'.
-- A completed Checkout session reaches stripe-webhook, which calls record_work_order_processor_payment. Each
-- confirmation is one observation under the 'stripe' source and one immutable work_order_processor_payments row,
-- keyed by the Stripe event and session ids, so retries and duplicate deliveries record once. Reconciliation counts
-- processor-confirmed receipts as received, beside payee witnesses. The customer's job actions offer pay_invoice
-- while a balance is due. Edits to work_order_invoice_reconciliation and work_order_job_actions are anchored.
-- Contract: supabase/sql/test_work_order_invoice_stripe_payments.sql (PG17); composition: test_job_loop_replay.sql.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

INSERT INTO public.observation_sources(id,slug,display_name,category,base_trust_score,supported_observations,notes)
SELECT gen_random_uuid(),'stripe','Stripe','documentation',0.95,ARRAY['work_record']::public.observation_kind[],
  'Payment processor confirmation of a completed Stripe Checkout payment (webhook, signature-verified). States that the processor received the amount; not a payout, release or acceptance of work.'
WHERE NOT EXISTS (SELECT 1 FROM public.observation_sources WHERE slug = 'stripe');

CREATE TABLE public.work_order_processor_payments (
  id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id) ON DELETE RESTRICT,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE RESTRICT,
  invoice_id uuid NOT NULL REFERENCES public.work_order_invoices(id) ON DELETE RESTRICT,
  invoice_hash text NOT NULL CHECK (length(invoice_hash) BETWEEN 1 AND 200),
  processor text NOT NULL CHECK (processor = 'stripe'),
  processor_event_id text NOT NULL UNIQUE CHECK (processor_event_id ~ '^evt_[A-Za-z0-9]+$'),
  checkout_session_id text NOT NULL UNIQUE CHECK (checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'),
  payment_intent_id text CHECK (payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
  payer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0 AND amount < 1000000000),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  paid_at timestamptz NOT NULL CHECK (isfinite(paid_at)),
  livemode boolean NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX work_order_processor_payments_order ON public.work_order_processor_payments(work_order_id, currency);
CREATE INDEX work_order_processor_payments_invoice ON public.work_order_processor_payments(invoice_id);
COMMENT ON TABLE public.work_order_processor_payments IS 'Stripe-confirmed card payments of a work order invoice, one per completed Checkout session (record_work_order_processor_payment from stripe-webhook). Immutable; keyed to the processor observation. Money received by the platform account; no payout, transfer or release.';
COMMENT ON COLUMN public.work_order_processor_payments.id IS 'The stripe-source vehicle_observations row recording the confirmation.';
COMMENT ON COLUMN public.work_order_processor_payments.work_order_id IS 'Work order whose invoice was paid.';
COMMENT ON COLUMN public.work_order_processor_payments.invoice_id IS 'Invoice version the Checkout session was opened for.';
COMMENT ON COLUMN public.work_order_processor_payments.invoice_hash IS 'That invoice version''s hash at checkout; must equal the stored invoice_hash.';
COMMENT ON COLUMN public.work_order_processor_payments.processor IS 'Payment processor; stripe.';
COMMENT ON COLUMN public.work_order_processor_payments.processor_event_id IS 'Stripe event id (evt_...); unique, so redelivery records once.';
COMMENT ON COLUMN public.work_order_processor_payments.checkout_session_id IS 'Stripe Checkout session id (cs_...); unique.';
COMMENT ON COLUMN public.work_order_processor_payments.payment_intent_id IS 'Stripe PaymentIntent id (pi_...) when Stripe reports one.';
COMMENT ON COLUMN public.work_order_processor_payments.payer_user_id IS 'Account that opened the Checkout session; the work order customer at that time.';
COMMENT ON COLUMN public.work_order_processor_payments.amount IS 'Amount Stripe reports received, in major units of currency (amount_total / 100; two-decimal currencies only).';
COMMENT ON COLUMN public.work_order_processor_payments.currency IS 'ISO currency, uppercase, equal to the invoice currency.';
COMMENT ON COLUMN public.work_order_processor_payments.paid_at IS 'Stripe event creation time (when the session completed).';
COMMENT ON COLUMN public.work_order_processor_payments.livemode IS 'Stripe livemode flag of the event: false for test-mode payments.';
COMMENT ON COLUMN public.work_order_processor_payments.recorded_at IS 'Projection insertion clock.';

ALTER TABLE public.work_order_processor_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_order_processor_payments FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.work_order_processor_payments TO service_role;
CREATE POLICY processor_service_read ON public.work_order_processor_payments FOR SELECT TO service_role USING (true);
CREATE TRIGGER processor_immutable BEFORE UPDATE OR DELETE ON public.work_order_processor_payments
  FOR EACH ROW EXECUTE FUNCTION public.work_order_resource_immutable();
CREATE TRIGGER processor_no_truncate BEFORE TRUNCATE ON public.work_order_processor_payments
  FOR EACH STATEMENT EXECUTE FUNCTION public.work_order_resource_immutable();

-- Two-decimal currencies Checkout is opened in; amounts convert by 100.
CREATE FUNCTION public.work_order_checkout_currency_supported(p_currency text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT p_currency IN ('USD','CAD','EUR','GBP','AUD','NZD','CHF','MXN')
$$;

CREATE FUNCTION public.work_order_processor_received(p_work_order_id uuid, p_currency text) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(sum(pp.amount), 0) FROM public.work_order_processor_payments pp
  JOIN public.vehicle_observations s ON s.id = pp.id AND s.is_superseded IS FALSE
  WHERE pp.work_order_id = p_work_order_id AND pp.currency = p_currency
$$;
CREATE FUNCTION public.work_order_processor_payment_count(p_work_order_id uuid) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT count(*)::integer FROM public.work_order_processor_payments pp
  JOIN public.vehicle_observations s ON s.id = pp.id AND s.is_superseded IS FALSE
  WHERE pp.work_order_id = p_work_order_id
$$;

-- What the customer may pay by card now, or why not. Called by create-work-order-invoice-checkout.
CREATE FUNCTION public.work_order_invoice_checkout(p_user uuid, p_work_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE w public.work_orders%ROWTYPE; i public.work_order_invoices%ROWTYPE; rec jsonb; due numeric;
BEGIN
  SELECT * INTO w FROM public.work_orders WHERE id = p_work_order_id;
  IF p_user IS NULL OR w.id IS NULL OR w.customer_id IS DISTINCT FROM p_user THEN
    RETURN jsonb_build_object('refused', 'not_the_customer');
  END IF;
  SELECT * INTO i FROM public.work_order_current_invoice(w.id);
  IF i.id IS NULL THEN RETURN jsonb_build_object('refused', 'no_invoice'); END IF;
  IF NOT public.work_order_checkout_currency_supported(i.currency) THEN RETURN jsonb_build_object('refused', 'currency_not_supported'); END IF;
  rec := public.work_order_invoice_reconciliation(w.id);
  due := (rec->>'balance_due')::numeric;
  IF due IS NULL OR due <= 0 THEN RETURN jsonb_build_object('refused', 'nothing_due'); END IF;
  IF due < 0.50 THEN RETURN jsonb_build_object('refused', 'below_processor_minimum'); END IF;
  RETURN jsonb_build_object('work_order_id', w.id, 'vehicle_id', w.vehicle_id, 'invoice_id', i.id, 'invoice_version', i.version,
    'invoice_hash', i.invoice_hash, 'currency', i.currency, 'balance_due', due, 'amount_minor', round(due * 100)::bigint,
    'title', COALESCE(NULLIF(btrim(w.title), ''), 'Work order'), 'reconciliation_state', rec->>'state');
END $$;

CREATE FUNCTION public.record_work_order_processor_payment(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE
  i public.work_order_invoices%ROWTYPE;
  w public.work_orders%ROWTYPE;
  src uuid;
  obs_id uuid;
  existing public.work_order_processor_payments%ROWTYPE;
  amt numeric;
  cur text := upper(p->>'currency');
  paid timestamptz;
BEGIN
  IF p->>'payment_status' IS DISTINCT FROM 'paid' THEN RAISE EXCEPTION 'Only paid sessions are recorded' USING ERRCODE = '22023'; END IF;
  IF (p->>'amount_minor') IS NULL OR (p->>'amount_minor') !~ '^[0-9]+$' OR (p->>'amount_minor')::bigint <= 0 THEN
    RAISE EXCEPTION 'Positive integer amount_minor required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO i FROM public.work_order_invoices WHERE id = (p->>'invoice_id')::uuid;
  SELECT * INTO w FROM public.work_orders WHERE id = i.work_order_id;
  IF i.id IS NULL OR w.id IS NULL OR w.id IS DISTINCT FROM (p->>'work_order_id')::uuid OR i.invoice_hash IS DISTINCT FROM p->>'invoice_hash' THEN
    RAISE EXCEPTION 'Session does not match a stored invoice version' USING ERRCODE = '23514';
  END IF;
  IF cur IS DISTINCT FROM i.currency OR NOT public.work_order_checkout_currency_supported(cur) THEN
    RAISE EXCEPTION 'Payment currency must match the invoice currency' USING ERRCODE = '22023';
  END IF;
  amt := (p->>'amount_minor')::bigint / 100.0;
  paid := to_timestamp((p->>'created')::bigint);
  PERFORM pg_advisory_xact_lock(hashtextextended('work_order_lifecycle:' || w.id::text, 0));
  SELECT x.* INTO existing FROM public.work_order_processor_payments x
    WHERE x.processor_event_id = p->>'event_id' OR x.checkout_session_id = p->>'session_id' LIMIT 1;
  IF existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('processor_payment_id', existing.id, 'duplicate', true,
      'reconciliation', public.work_order_invoice_reconciliation(w.id), 'disbursement', 'not_performed');
  END IF;
  SELECT id INTO src FROM public.observation_sources WHERE slug = 'stripe';
  IF src IS NULL THEN RAISE EXCEPTION 'stripe source unavailable'; END IF;
  INSERT INTO public.vehicle_observations(vehicle_id, source_id, source_identifier, observed_at, observed_at_basis, source_event_at,
    source_event_time_precision, kind, content_text, content_hash, structured_data, observer_raw, extraction_method,
    confidence, confidence_score)
  VALUES (w.vehicle_id, src, 'stripe_checkout_session:' || (p->>'session_id'), paid, 'event_time', paid, 'exact', 'work_record',
    format('Stripe confirmed a card payment on an invoice for work order %s.', w.id), md5('stripe:' || (p->>'event_id')),
    jsonb_build_object('work_order_processor_payment', jsonb_build_object('version', 1, 'processor', 'stripe',
      'event_id', p->>'event_id', 'session_id', p->>'session_id', 'payment_intent_id', p->>'payment_intent_id',
      'work_order_id', w.id, 'invoice_id', i.id, 'invoice_hash', i.invoice_hash, 'amount', amt, 'currency', cur,
      'livemode', (p->>'livemode')::boolean, 'payer_user_id', p->>'payer_user_id')),
    jsonb_build_object('processor', 'stripe', 'intake_actor', 'stripe-webhook'), 'stripe_checkout_webhook_v1', 'high', 0.95)
  RETURNING id INTO obs_id;
  INSERT INTO public.work_order_processor_payments(id, work_order_id, invoice_id, invoice_hash, processor, processor_event_id,
    checkout_session_id, payment_intent_id, payer_user_id, amount, currency, paid_at, livemode)
  VALUES (obs_id, w.id, i.id, i.invoice_hash, 'stripe', p->>'event_id', p->>'session_id', NULLIF(p->>'payment_intent_id', ''),
    (p->>'payer_user_id')::uuid, amt, cur, paid, (p->>'livemode')::boolean);
  RETURN jsonb_build_object('processor_payment_id', obs_id, 'duplicate', false, 'amount', amt, 'currency', cur,
    'reconciliation', public.work_order_invoice_reconciliation(w.id), 'disbursement', 'not_performed');
END $$;

CREATE FUNCTION public.work_order_customer_payment_actions(p_user uuid, p_work_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
DECLARE c jsonb := public.work_order_invoice_checkout(p_user, p_work_order_id);
BEGIN
  IF c ? 'refused' THEN RETURN '[]'::jsonb; END IF;
  RETURN jsonb_build_array(jsonb_build_object('action', 'pay_invoice', 'kind', 'pay_invoice', 'stage', 'accounting',
    'function', 'create-work-order-invoice-checkout', 'args', jsonb_build_object('work_order_id', p_work_order_id),
    'invoice_version', c->'invoice_version', 'amount', c->'balance_due', 'currency', c->'currency',
    'binds', jsonb_build_array('a card payment through Stripe of the balance due on this invoice version'),
    'does_not_bind', jsonb_build_array('acceptance of the work', 'release of funds to the provider')));
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['work_order_checkout_currency_supported(text)','work_order_processor_received(uuid,text)',
    'work_order_processor_payment_count(uuid)','work_order_invoice_checkout(uuid,uuid)',
    'record_work_order_processor_payment(jsonb)','work_order_customer_payment_actions(uuid,uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;
COMMENT ON FUNCTION public.work_order_invoice_checkout(uuid,uuid) IS 'Service-only: the current invoice balance the work order customer may pay by card, or {refused: not_the_customer|no_invoice|currency_not_supported|nothing_due|below_processor_minimum}.';
COMMENT ON FUNCTION public.record_work_order_processor_payment(jsonb) IS 'Service-only, for stripe-webhook: records one paid Checkout session against its invoice version (stripe observation + work_order_processor_payments), idempotent on event and session id. No payout or release.';
COMMENT ON FUNCTION public.work_order_customer_payment_actions(uuid,uuid) IS 'The customer''s pay_invoice job action while a card-payable balance is due; otherwise empty.';

DO $edit$
DECLARE
  rc text := pg_get_functiondef('public.work_order_invoice_reconciliation(uuid)'::regprocedure);
  ja text := pg_get_functiondef('public.work_order_job_actions(uuid,uuid)'::regprocedure);
  ao text := pg_get_functiondef('public.work_order_accounting_overlay(uuid,jsonb)'::regprocedure);
  a1 text := $a$  IF n_witness > 0 THEN$a$;
  r1 text := $a$COALESCE(sum(p.amount) FILTER (WHERE p.witness_side = 'payee' AND p.currency = inv.currency), 0) AS received,$a$;
  r2 text := $a$'payee_witnesses', s.n_payee,$a$;
  r3 text := $a$'basis', 'payee-witnessed receipts$a$;
  j1 text := $a$  IF p_user IS NULL OR w.id IS NULL OR w.customer_id IS NOT DISTINCT FROM p_user$a$;
BEGIN
  IF (length(rc)-length(replace(rc,r1,'')))/length(r1) <> 1 OR (length(rc)-length(replace(rc,r2,'')))/length(r2) <> 1
    OR (length(rc)-length(replace(rc,r3,'')))/length(r3) <> 1 OR (length(ja)-length(replace(ja,j1,'')))/length(j1) <> 1
    OR (length(ao)-length(replace(ao,a1,'')))/length(a1) <> 1 THEN
    RAISE EXCEPTION 'stripe payment anchors not found exactly once';
  END IF;
  rc := replace(rc, r1, $r$COALESCE(sum(p.amount) FILTER (WHERE p.witness_side = 'payee' AND p.currency = inv.currency), 0)
        + COALESCE(max(public.work_order_processor_received(p_work_order_id, inv.currency)), 0) AS received,$r$);
  rc := replace(rc, r2, $r$'processor_payments', public.work_order_processor_payment_count(p_work_order_id), $r$ || r2);
  rc := replace(rc, r3, $r$'basis', 'Stripe-confirmed and payee-witnessed receipts$r$);
  EXECUTE rc;
  ja := replace(ja, j1, $r$  IF p_user IS NOT NULL AND w.id IS NOT NULL AND w.customer_id IS NOT DISTINCT FROM p_user THEN
    RETURN public.work_order_customer_payment_actions(p_user, p_work_order_id);
  END IF;
$r$ || j1);
  EXECUTE ja;
  EXECUTE replace(ao, a1, $r$  IF n_witness > 0 OR public.work_order_processor_payment_count(p_work_order_id) > 0 THEN$r$);
END $edit$;

INSERT INTO public.pipeline_registry(table_name,column_name,owned_by,description,do_not_write_directly,write_via)
VALUES ('work_order_processor_payments','id','record_work_order_processor_payment',
  'Stripe-confirmed invoice payments from stripe-webhook; event and session ids are idempotency keys. No raw writes.',
  true,'record_work_order_processor_payment(jsonb) via stripe-webhook');
NOTIFY pgrst, 'reload schema';
COMMIT;
