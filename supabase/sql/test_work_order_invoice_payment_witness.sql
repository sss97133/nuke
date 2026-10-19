-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations.
-- Invoice Sign, payment witnesses (no money movement), the invoice reader and the job path's accounting stage.
\ir test_work_order_completion_sign.sql
\ir ../migrations/20261019201500_work_order_invoice_payment_witness.sql

CREATE FUNCTION public.inv_lines(p_fee numeric DEFAULT 120,p_extra numeric DEFAULT 30) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_array(
  jsonb_build_object('quote_line',0,'description','Fabrication labor','pricing_basis','day_rate','amount',175,'currency','USD','unit','day','quantity',2),
  jsonb_build_object('quote_line',1,'description','Inspection fee','pricing_basis','flat','amount',p_fee,'currency','USD'),
  jsonb_build_object('description','Gasket','pricing_basis','flat','amount',p_extra,'currency','USD')) $$;
CREATE FUNCTION public.invr(p_wo uuid DEFAULT '30000000-0000-0000-0000-000000000001') RETURNS jsonb LANGUAGE sql AS $$ SELECT work_order_invoices_read(p_wo) $$;
CREATE FUNCTION public.pay(p_inv uuid,p_amount numeric,p_currency text DEFAULT 'USD',p_method text DEFAULT 'card',
  p_paid timestamptz DEFAULT now() - interval '1 hour',p_ref text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT record_work_order_payment(p_inv,p_amount,p_currency,p_method,p_paid,p_ref) $$;
GRANT EXECUTE ON FUNCTION public.inv_lines(numeric,numeric),public.invr(uuid),public.pay(uuid,numeric,text,text,timestamptz,text) TO anon,authenticated;

SELECT t_assert(jp('accounting') @> '{"state":"absent","state_basis":"no_invoice","invoice":null,"reconciliation":null,"payment_authorized":false,"disbursement":"not_performed","money_moved":false}'
 AND jp('accounting')->'gaps' @> '["no_invoice"]' AND jp('accounting') @> '{"release":{"met":false,"payment_authorized":false}}','baseline: no invoice, release not met');

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(t_refused_with($q$SELECT issue_work_order_invoice('30000000-0000-0000-0000-000000000001',inv_lines())$q$,'unavailable for invoicing'),'customer cannot invoice');
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(t_refused_with($q$SELECT issue_work_order_invoice('30000000-0000-0000-0000-000000000001',inv_lines())$q$,'unavailable for invoicing'),'stranger cannot invoice');
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT t_assert(t_refused_with(format('SELECT issue_work_order_invoice(%L,inv_lines(),%L)','30000000-0000-0000-0000-000000000001',:'q1id'),'current accepted quote'),
 'invoice cannot name a superseded quote');
SELECT t_assert(t_refused_with($q$SELECT issue_work_order_invoice('30000000-0000-0000-0000-000000000001','[{"quote_line":9,"description":"x","pricing_basis":"flat","amount":1,"currency":"USD"}]')$q$,'quote line'),
 'unknown quote line refused');
SELECT t_assert(t_refused_with($q$SELECT issue_work_order_invoice('30000000-0000-0000-0000-000000000001','[{"quote_line":1,"description":"x","pricing_basis":"flat","amount":1,"currency":"USD"},{"quote_line":1,"description":"y","pricing_basis":"flat","amount":1,"currency":"USD"}]')$q$,'invoiced twice'),
 'a quote line invoiced twice refused');
SELECT t_assert(t_refused_with($q$SELECT issue_work_order_invoice('30000000-0000-0000-0000-000000000001','[{"description":"x","pricing_basis":"flat","amount":1,"currency":"USD"},{"description":"y","pricing_basis":"flat","amount":1,"currency":"EUR"}]')$q$,'one currency'),
 'mixed currencies refused');
SELECT t_assert(t_refused_with($q$SELECT issue_work_order_invoice('30000000-0000-0000-0000-000000000001','[{"description":"x","pricing_basis":"hourly","amount":90,"currency":"USD","unit":"hour"}]')$q$,'Invalid invoice line'),
 'a rate line without quantity is not definite');
SELECT n_obs() AS nobs1 \gset
SELECT issue_work_order_invoice('30000000-0000-0000-0000-000000000001',inv_lines()) AS i1 \gset
SELECT issue_work_order_invoice('30000000-0000-0000-0000-000000000001',inv_lines()) AS i1dup \gset
RESET ROLE;
SELECT (:'i1'::jsonb)->>'invoice_id' AS inv1 \gset
SELECT t_assert((:'i1'::jsonb) @> jsonb_build_object('version',1,'quote_id',:'q2id','currency','USD','total',500,'issuer_role','organization_owner',
   'duplicate',false,'customer_notified',false,'payment_requested',false,'payment_authorized',false,'money_moved',false)
 AND (:'i1'::jsonb)->'changes_from_quote' @> '{"basis":"accepted_quote","unchanged":1,"changed":1,"added":1,"omitted_quote_lines":[],"quote_total":440,"delta_from_quote":60,"quote_total_complete":true}'
 AND (:'i1dup'::jsonb)->>'invoice_id'=:'inv1' AND ((:'i1dup'::jsonb)->>'duplicate')::boolean AND n_obs()=(:'nobs1')::bigint+1,
 'invoice Sign: definite total, explicit changes from the accepted quote, idempotent');

SET ROLE anon;
SELECT as_user(NULL);
SELECT invr() AS ra \gset
RESET ROLE;
SELECT t_assert((:'ra'::jsonb) @> jsonb_build_object('current_invoice_id',:'inv1','payments',null,'reconciliation',null,'release',null,
   'payments_visibility','withheld_not_party','money_moved',false,'payment_authorized',false)
 AND (:'ra'::jsonb)->'viewer' @> '{"party":false,"actions":[]}'
 AND (:'ra'::jsonb)#>'{invoices,0}' @> '{"version":1,"current":true,"status":"current","total":500,"currency":"USD"}'
 AND (:'ra'::jsonb)#>'{invoices,0,lines}' @> '[{"line":1,"quote_line":1,"amount":120,"change":"changed","changed_fields":["amount"],"quote_line_total":90},{"line":2,"quote_line":null,"change":"added"},{"line":0,"change":"unchanged","ref_kind":"labor"}]'
 AND NOT (:'ra'::jsonb)#>'{invoices,0,issuer}' ? 'user_id','anon: invoice lines and prices open; payments, balance, release and raw ids withheld');
SELECT t_assert(jp('accounting') @> jsonb_build_object('state','partial','state_basis','current_invoice_open',
   'invoice',jsonb_build_object('invoice_id',:'inv1','version',1,'line_count',3,'quote_basis','accepted_quote','lines_changed_from_quote',1,'lines_added',1,'quote_lines_omitted',0))
 AND jp('accounting')->'gaps' @> '["invoice_balance_open"]' AND NOT jp('accounting')->'gaps' @> '["no_invoice"]'
 AND jp('accounting')#>'{release,conditions}' @> '[{"key":"quote_accepted_by_customer","met":true},{"key":"completion_attested_by_provider","met":true},{"key":"completion_accepted_by_customer","met":false},{"key":"invoice_current","met":true},{"key":"invoice_settled_by_payee_witness","met":false}]'
 AND jp('accounting') @> '{"release":{"met":false}}','job path: invoice open is partial; release conditions evaluated');
SELECT t_assert(NOT read_work_order_job_path('30000000-0000-0000-0000-000000000001')::text ~ '("amount"|"total"|"balance_due"|10000000-0000-0000-0000-00000000000[cdef9])',
 'job path: no amounts, balances or raw user ids');

-- Payment witnesses: payer reports; payees confirm. Nothing moves.
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(t_refused_with(format('SELECT pay(%L,500)',:'inv1'),'Invoice unavailable'),'stranger cannot witness a payment');
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT t_assert(t_refused_with(format('SELECT pay(%L,500,%L)',:'inv1','EUR'),'currency'),'payment currency must match the invoice');
SELECT t_assert(t_refused_with(format('SELECT pay(%L,500,%L,%L)',:'inv1','USD','crypto'),'Unknown payment method'),'unknown method refused');
SELECT t_assert(t_refused_with(format('SELECT pay(%L,0)',:'inv1'),'positive'),'zero amount refused');
SELECT t_assert(t_refused_with(format('SELECT pay(%L,500,%L,%L,%L)',:'inv1','USD','card',now()+interval '3 days'),'not in the future'),'future payment refused');
SELECT pay(:'inv1',500,'USD','card',now()-interval '1 hour','fixture-ref-001') AS w1 \gset
SELECT t_assert((:'w1'::jsonb) @> '{"witness_side":"payer","witness_role":"customer","money_moved":false,"payment_authorized":false,"disbursement":"not_performed","duplicate":false}'
 AND (:'w1'::jsonb) @> '{"reconciliation":{"state":"payer_reported_unconfirmed","confirmed_received":0,"payer_reported":500,"balance_due":500}}',
 'payer witness alone does not settle');
RESET ROLE;
SELECT t_assert(jp('accounting')->>'state'='partial' AND jp('accounting')->'gaps' @> '["payment_reported_by_payer_unconfirmed"]','job path: payer report is unconfirmed');
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT pay(:'inv1',300,'USD','bank_transfer') AS w2 \gset
SELECT t_assert((:'w2'::jsonb) @> '{"witness_side":"payee","witness_role":"organization_owner","reconciliation":{"state":"partially_paid","confirmed_received":300,"balance_due":200}}',
 'payee confirmation counts toward the balance');
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT pay(:'inv1',200,'USD','cash') AS w3 \gset
SELECT t_assert((:'w3'::jsonb) @> '{"witness_role":"accepted_provider","reconciliation":{"state":"paid","confirmed_received":500,"balance_due":0,"overpaid_by":0}}',
 'payee witnesses settle the invoice');
RESET ROLE;
SELECT t_assert(jp('accounting') @> '{"state":"recorded","state_basis":"current_invoice_settled_by_payee_witness","reconciliation":{"state":"paid","payee_witnesses":2,"payer_witnesses":1},"release":{"met":false},"payment_authorized":false}'
 AND NOT jp('accounting')->'gaps' @> '["invoice_balance_open"]','job path: accounting recorded; release still waits for the customer completion Sign');

-- The customer accepts the current completion: release conditions are met, and still nothing is authorized or disbursed.
SELECT jp('completion')#>>'{provider_attestation,completion_id}' AS cc \gset
SELECT jp('completion')#>>'{provider_attestation,completion_hash}' AS cch \gset
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT accept_work_completion('30000000-0000-0000-0000-000000000001',:'cc',:'cch');
SELECT invr() AS rc \gset
RESET ROLE;
SELECT t_assert(jp('accounting') @> '{"release":{"met":true,"payment_authorized":false,"disbursement":"not_performed"},"payment_authorized":false,"disbursement":"not_performed"}',
 'release met as a computed conclusion; payment_authorized false, disbursement not performed');
SELECT t_assert((:'rc'::jsonb) @> '{"payments_visibility":"shown_to_party","reconciliation":{"state":"paid","balance_due":0},"release":{"met":true},"viewer":{"party":true}}'
 AND jsonb_array_length((:'rc'::jsonb)->'payments')=3 AND (:'rc'::jsonb)->'payments' @> '[{"reference":"fixture-ref-001","witness_side":"payer","amount":500}]'
 AND (:'rc'::jsonb)#>'{viewer,actions}' @> jsonb_build_array(jsonb_build_object('action','record_payment','args',jsonb_build_object('p_invoice_id',:'inv1'),'as','payer'))
 AND NOT (:'rc'::jsonb)#>'{viewer,actions}' @> '[{"action":"issue_invoice"}]','customer: payments, references, balance and release; payer action only');
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT invr() AS ro \gset
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT invr() AS rs \gset
RESET ROLE;
SELECT t_assert((:'ro'::jsonb) @> '{"viewer":{"party":true}}' AND jsonb_array_length((:'ro'::jsonb)->'payments')=3
 AND (:'ro'::jsonb)#>'{viewer,actions}' @> '[{"action":"issue_invoice"},{"action":"record_payment","as":"payee"}]','org owner: party with payee actions');
SELECT t_assert((:'rs'::jsonb) @> '{"payments":null,"reconciliation":null,"release":null,"payments_visibility":"withheld_not_party","viewer":{"party":false,"actions":[]}}'
 AND NOT :'rs' ~ 'fixture-ref-001','signed-in stranger: no payments or references');

-- A new invoice version carries earlier payee receipts; the old version takes no new witnesses.
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT issue_work_order_invoice('30000000-0000-0000-0000-000000000001',inv_lines(120,50)) AS i2 \gset
SELECT t_assert(t_refused_with(format('SELECT pay(%L,20)',:'inv1'),'current invoice'),'superseded invoice version takes no witness');
RESET ROLE;
SELECT (:'i2'::jsonb)->>'invoice_id' AS inv2 \gset
SELECT t_assert((:'i2'::jsonb) @> '{"version":2,"total":520}' AND jp('accounting') @> jsonb_build_object('state','partial','invoice',jsonb_build_object('invoice_id',:'inv2','version',2))
 AND (invr()#>>'{invoices,1,status}')='superseded_by_later_version','version 2 is current; 500 received leaves it open');
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT t_assert(pay(:'inv2',100)#>'{reconciliation}' @> '{"state":"paid","balance_due":0,"overpaid_by":80}','overpayment is reported, not hidden');
RESET ROLE;
SELECT t_assert(jp('accounting')->'inconsistencies' @> '["payment_witnesses_exceed_invoice"]','job path: overpayment is an inconsistency');

-- Legacy payment rows without an invoice are partial; nothing is repaired.
INSERT INTO work_order_payments(work_order_id,status) VALUES ('30000000-0000-0000-0000-000000000002','completed');
SELECT t_assert(jp('accounting','30000000-0000-0000-0000-000000000002') @> '{"state":"partial","state_basis":"legacy_payment_records_without_invoice"}'
 AND jp('accounting','30000000-0000-0000-0000-000000000002')->'gaps' @> '["no_invoice"]','legacy payment rows without an invoice are partial');

SELECT t_assert(t_refused_with(format('UPDATE work_order_payment_witnesses SET amount=1 WHERE invoice_id=%L',:'inv1'),'immutable')
 AND t_refused_with(format('DELETE FROM work_order_invoices WHERE id=%L',:'inv2'),'immutable'),'invoices and witnesses are immutable');
SELECT t_assert(EXISTS (SELECT 1 FROM pg_policies WHERE tablename='vehicle_observations' AND policyname='work_order_payment_witness_private_read'
   AND permissive='RESTRICTIVE' AND roles @> '{anon,authenticated}'),'payment witness sources are readable only by their submitter');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM vehicle_observations WHERE extraction_method='work_order_payment_witness_sign_v1'
   AND (content_text ~ '[0-9]{3}' AND content_text !~ '30000000') ),'payment source text carries no amounts');
SET ROLE service_role;
SELECT t_assert((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(work_order_job_path_scoreboard()) k)::text=:'board_keys'
 AND work_order_job_path_scoreboard()#>'{stages,accounting}' @> '{"recorded":1,"partial":1}','scoreboard shape unchanged; settled invoice recorded, legacy rows partial');
RESET ROLE;
SELECT t_assert(has_function_privilege('authenticated','issue_work_order_invoice(uuid,jsonb,uuid,timestamptz)','EXECUTE')
 AND has_function_privilege('authenticated','record_work_order_payment(uuid,numeric,text,text,timestamptz,text)','EXECUTE')
 AND NOT has_function_privilege('anon','record_work_order_payment(uuid,numeric,text,text,timestamptz,text)','EXECUTE')
 AND NOT has_function_privilege('service_role','issue_work_order_invoice(uuid,jsonb,uuid,timestamptz)','EXECUTE')
 AND has_function_privilege('anon','work_order_invoices_read(uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','work_order_invoice_reconciliation(uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','work_order_release_evaluation(uuid)','EXECUTE'),'grants: Signs for signed-in users; reader open; helpers service-only');
SELECT t_assert((SELECT count(*) FROM regexp_matches(pg_get_functiondef('read_work_order_job_path(uuid)'::regprocedure),'work_order_(completion|accounting)_overlay','g'))=2,
 'job path carries the completion and accounting overlay lines once each');
