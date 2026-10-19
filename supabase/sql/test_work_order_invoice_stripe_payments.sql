-- Disposable PG17 only. Builds the whole job loop through the golden path (story 1 ends with invoice v1 paid by
-- witnesses), then applies the Stripe migration: a second invoice version leaves a balance, the customer's checkout
-- terms and pay_invoice action, and the webhook recorder settling it. Synthetic Stripe ids; no network, no money.
\set ON_ERROR_STOP on
\ir test_job_loop_golden_path.sql
ALTER TABLE public.observation_sources ADD COLUMN IF NOT EXISTS display_name text, ADD COLUMN IF NOT EXISTS base_trust_score numeric,
  ADD COLUMN IF NOT EXISTS notes text, ADD COLUMN IF NOT EXISTS supported_observations public.observation_kind[];
\ir ../migrations/20261020012000_work_order_invoice_stripe_payments.sql

SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000a1');
SELECT issue_work_order_invoice('e7400000-0000-0000-0000-000000000001',jsonb_build_array(
  jsonb_build_object('quote_line',0,'description','Stainless exhaust fabrication','pricing_basis','day_rate','amount',380,'currency','USD','unit','day','quantity',2),
  jsonb_build_object('quote_line',1,'description','Brake service','pricing_basis','flat','amount',220,'currency','USD'),
  jsonb_build_object('quote_line',2,'description','Shop supplies','pricing_basis','flat','amount',40,'currency','USD'),
  jsonb_build_object('description','Additional hanger kit','pricing_basis','flat','amount',80.25,'currency','USD')),
  ((:'co'::jsonb)->>'quote_id')::uuid,now()+interval '14 days') AS inv2 \gset
RESET ROLE;

CREATE FUNCTION public.terms(p_user uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT work_order_invoice_checkout(p_user,'e7400000-0000-0000-0000-000000000001') $$;
CREATE FUNCTION public.evt(p_patch jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('event_id','evt_1Test','session_id','cs_test_1','payment_intent_id','pi_1Test','payment_status','paid',
    'amount_minor',8025,'currency','usd','livemode',false,'created',extract(epoch FROM now() - interval '1 minute')::bigint,
    'work_order_id','e7400000-0000-0000-0000-000000000001','invoice_id',(SELECT id FROM work_order_current_invoice('e7400000-0000-0000-0000-000000000001')),
    'invoice_hash',(SELECT invoice_hash FROM work_order_current_invoice('e7400000-0000-0000-0000-000000000001')),
    'payer_user_id','e7000000-0000-0000-0000-0000000000c1') || p_patch $$;
CREATE FUNCTION public.acct() RETURNS jsonb LANGUAGE sql AS $$
  SELECT read_work_order_job_path('e7400000-0000-0000-0000-000000000001')#>'{stages,accounting}' $$;

SET ROLE service_role;
SELECT t_assert(terms('e7000000-0000-0000-0000-0000000000c1') @> '{"currency":"USD","balance_due":80.25,"amount_minor":8025,"invoice_version":2}'
 AND terms('e7000000-0000-0000-0000-0000000000c1')->>'invoice_hash'=(:'inv2'::jsonb)->>'invoice_hash','customer may pay exactly the balance due on the current invoice version');
SELECT t_assert(terms('e7000000-0000-0000-0000-0000000000a1')->>'refused'='not_the_customer'
 AND terms(NULL)->>'refused'='not_the_customer'
 AND work_order_invoice_checkout('e7000000-0000-0000-0000-0000000000c1','e7400000-0000-0000-0000-000000000099')->>'refused'='not_the_customer','provider, nobody and unknown orders refused');
SELECT t_assert(work_order_job_actions('e7000000-0000-0000-0000-0000000000c1','e7400000-0000-0000-0000-000000000001') @>
 '[{"action":"pay_invoice","kind":"pay_invoice","function":"create-work-order-invoice-checkout","currency":"USD","amount":80.25}]','customer is offered pay_invoice');
SELECT t_assert(NOT work_order_job_actions('e7000000-0000-0000-0000-0000000000a1','e7400000-0000-0000-0000-000000000001') @> '[{"action":"pay_invoice"}]','provider is not offered pay_invoice');
SELECT t_assert(acct() @> '{"state":"partial","reconciliation":{"state":"partially_paid"}}','second invoice version opens a balance');

SELECT t_assert(t_refused(format('SELECT record_work_order_processor_payment(%L)',evt('{"payment_status":"unpaid"}'))),'unpaid session refused');
SELECT t_assert(t_refused(format('SELECT record_work_order_processor_payment(%L)',evt('{"amount_minor":0}'))),'zero amount refused');
SELECT t_assert(t_refused(format('SELECT record_work_order_processor_payment(%L)',evt('{"amount_minor":"80.25"}'))),'non-integer minor units refused');
SELECT t_assert(t_refused(format('SELECT record_work_order_processor_payment(%L)',evt('{"invoice_hash":"forged"}'))),'invoice hash mismatch refused');
SELECT t_assert(t_refused(format('SELECT record_work_order_processor_payment(%L)',evt('{"currency":"eur"}'))),'currency mismatch refused');
SELECT t_assert(t_refused(format('SELECT record_work_order_processor_payment(%L)',evt('{"work_order_id":"e7400000-0000-0000-0000-000000000099"}'))),'wrong work order refused');
SELECT t_assert(t_refused(format('SELECT record_work_order_processor_payment(%L)',evt('{"event_id":"not-an-event"}'))),'malformed event id refused');

SELECT record_work_order_processor_payment(evt()) AS pp \gset
SELECT t_assert((:'pp'::jsonb) @> '{"duplicate":false,"amount":80.25,"currency":"USD","disbursement":"not_performed","reconciliation":{"state":"paid","balance_due":0}}','Stripe confirmation settles the balance; nothing disbursed');
SELECT t_assert((record_work_order_processor_payment(evt())->>'duplicate')::boolean,'redelivered event records once');
SELECT t_assert((record_work_order_processor_payment(evt('{"event_id":"evt_2Test"}'))->>'duplicate')::boolean,'second event for the same session records once');
SELECT t_assert((SELECT count(*) FROM work_order_processor_payments)=1,'one processor payment row');
SELECT t_assert(acct() @> '{"state":"recorded","reconciliation":{"state":"paid"},"disbursement":"not_performed","money_moved":false}'
 AND NOT acct()->'gaps' @> '["no_payment_record"]','accounting recorded; disbursement still not performed');
SELECT t_assert(work_order_invoice_reconciliation('e7400000-0000-0000-0000-000000000001') @> '{"processor_payments":1,"confirmed_received":1100.25}'
 AND work_order_invoice_reconciliation('e7400000-0000-0000-0000-000000000001')->>'basis' LIKE 'Stripe-confirmed%','reconciliation names processor receipts');
SELECT t_assert(work_order_job_actions('e7000000-0000-0000-0000-0000000000c1','e7400000-0000-0000-0000-000000000001')='[]'::jsonb
 AND terms('e7000000-0000-0000-0000-0000000000c1')->>'refused'='nothing_due','paid invoice offers no further payment');
SELECT t_assert((SELECT o.source_id=(SELECT id FROM observation_sources WHERE slug='stripe') AND o.kind::text='work_record'
  AND o.observed_at=pp.paid_at AND pp.livemode IS FALSE AND pp.payment_intent_id='pi_1Test'
  FROM work_order_processor_payments pp JOIN vehicle_observations o ON o.id=pp.id),'confirmation is a stripe-source observation at the paid clock');
SELECT t_assert(t_refused($q$UPDATE work_order_processor_payments SET amount=1$q$),'processor payments are immutable');
RESET ROLE;
SELECT t_assert(t_refused($q$DELETE FROM work_order_processor_payments$q$),'even owner cannot delete a processor payment');

SELECT evt('{"event_id":"evt_3Test","session_id":"cs_test_3"}') AS e3 \gset
SELECT evt('{"event_id":"evt_4Test","session_id":"cs_test_4"}') AS e4 \gset
SET ROLE anon;
SELECT t_assert(t_refused($q$SELECT * FROM work_order_processor_payments$q$),'anonymous cannot read processor payments');
SELECT t_assert(t_refused(format('SELECT record_work_order_processor_payment(%L)',:'e3')),'anonymous cannot record a payment');
SELECT t_assert(t_refused($q$SELECT work_order_invoice_checkout('e7000000-0000-0000-0000-0000000000c1','e7400000-0000-0000-0000-000000000001')$q$),'anonymous cannot read checkout terms');
RESET ROLE;
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT t_assert(t_refused(format('SELECT record_work_order_processor_payment(%L)',:'e4')),'the customer cannot self-confirm a processor payment');
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM pipeline_registry WHERE table_name='work_order_processor_payments')=1,'processor payment owner registered');
