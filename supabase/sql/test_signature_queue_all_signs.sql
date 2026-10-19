-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations.
-- One signature queue: my_signature_queue lists every Sign the viewer can act on now.
\ir test_inspection_access.sql
\ir ../migrations/20261019200000_work_order_completion_sign.sql
\ir ../migrations/20261019201500_work_order_invoice_payment_witness.sql
\ir helpers/contact_broker_tables_live_20261019.sql
\ir ../migrations/20261019214500_signature_queue_all_signs.sql

CREATE FUNCTION public.sq() RETURNS jsonb LANGUAGE sql AS $$ SELECT my_signature_queue() $$;
CREATE FUNCTION public.sqk(p_kind text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT COALESCE(jsonb_agg(i),'[]'::jsonb) FROM jsonb_array_elements(my_signature_queue()->'items') i WHERE i->>'kind'=p_kind $$;
GRANT EXECUTE ON FUNCTION public.sq(),public.sqk(text) TO authenticated;

-- C (customer of WO1 and of the inspection job) sees the revised inspector offer to accept.
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT sq() AS c0 \gset
SELECT sqk('offer_to_accept') AS co0 \gset
RESET ROLE;
SELECT t_assert((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys((:'c0'::jsonb)#>'{coverage,by_kind}') k)
   = ARRAY['change_order_to_accept','completion_to_accept','contact_request','cosign_request','inspection_access_request','invoice_payment_to_confirm',
     'offer_to_accept','quote_to_accept','work_session']
 AND (:'c0'::jsonb)#>'{coverage,kinds_not_yet_available}' = '["change_order_to_accept","cosign_request"]'
 AND (:'c0'::jsonb)#>'{coverage,kinds}' = '["offer_to_accept"]' AND (:'c0'::jsonb)->'viewer' @> '{"context":"self"}','coverage per kind; unavailable kinds named');
SELECT t_assert(jsonb_array_length(:'co0'::jsonb)=1 AND (:'co0'::jsonb)->0 @> jsonb_build_object('work_order_id',:'insp','summary',
   jsonb_build_object('requirement_kind','inspection','provider',jsonb_build_object('label','unnamed party'),'terms',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('amount',275)))),
   'sign',jsonb_build_object('rpc','accept_offer'))
 AND (:'co0'::jsonb)#>>'{0,sign,args_hint,p_offer_hash}' IS NOT NULL AND jsonb_typeof((:'co0'::jsonb)#>'{0,sign,binds}')='array'
 AND NOT :'co0' ~ '10000000-0000-0000-0000-000000000009','offer_to_accept: open terms, provider by label, exact args, no raw provider id');

-- Accepting it puts the seller's permission into the verified owner's queue.
SET ROLE authenticated;
SELECT accept_offer(((:'co0'::jsonb)#>>'{0,sign,args_hint,p_offer_id}')::uuid,(:'co0'::jsonb)#>>'{0,sign,args_hint,p_offer_hash}');
SELECT t_assert(sqk('offer_to_accept')='[]'::jsonb,'accepted offer leaves the queue');
SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT sqk('inspection_access_request') AS vi \gset
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(sqk('inspection_access_request')='[]'::jsonb,'stranger has no inspection permission to give');
SELECT as_user('10000000-0000-0000-0000-00000000000d');
RESET ROLE;
SELECT t_assert(jsonb_array_length(:'vi'::jsonb)=1 AND (:'vi'::jsonb)->0 @> jsonb_build_object('ref_id',:'insp','summary',
   jsonb_build_object('permission_state','not_established','requested_by',jsonb_build_object('label','unnamed party')),
   'sign',jsonb_build_object('rpc','grant_inspection_access','args_hint',jsonb_build_object('p_inspection_work_order_id',:'insp'))),
 'verified owner: inspection permission to give');
SET ROLE authenticated;
SELECT ga(:'insp');
SELECT t_assert(sqk('inspection_access_request')='[]'::jsonb,'granted permission leaves the queue');

-- Quote, offer and completion acceptances on WO1.
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT issue() AS q1 \gset
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT sqk('quote_to_accept') AS cq \gset
SELECT t_assert(jsonb_array_length(:'cq'::jsonb)=1 AND (:'cq'::jsonb)->0 @> jsonb_build_object('ref_id',(:'q1'::jsonb)->>'quote_id',
   'work_order_id','30000000-0000-0000-0000-000000000001','summary',jsonb_build_object('version',1,'line_count',2,
     'totals_by_currency',jsonb_build_array(jsonb_build_object('currency','USD','total',390,'complete',true))),
   'sign',jsonb_build_object('rpc','accept_work_order_quote','args_hint',jsonb_build_object('p_quote_id',(:'q1'::jsonb)->>'quote_id','p_quote_hash',(:'q1'::jsonb)->>'quote_hash'))),
 'quote_to_accept: open totals and exact args');
SELECT accept_work_order_quote(((:'cq'::jsonb)#>>'{0,sign,args_hint,p_quote_id}')::uuid,(:'cq'::jsonb)#>>'{0,sign,args_hint,p_quote_hash}');
SELECT t_assert(sqk('quote_to_accept')='[]'::jsonb,'accepted quote leaves the queue');
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT offer(:'rskill');
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT sqk('offer_to_accept') AS co1 \gset
SELECT t_assert(jsonb_array_length(:'co1'::jsonb)=1 AND (:'co1'::jsonb)->0 @> '{"work_order_id":"30000000-0000-0000-0000-000000000001","summary":{"requirement_kind":"skill","provider":{"label":"unnamed party"}}}',
 'offer on an open requirement of the customer''s job');
SELECT accept_offer(((:'co1'::jsonb)#>>'{0,sign,args_hint,p_offer_id}')::uuid,(:'co1'::jsonb)#>>'{0,sign,args_hint,p_offer_hash}');
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT attest_work_completion('30000000-0000-0000-0000-000000000001',(:'q1'::jsonb)->>'quote_hash') AS a1 \gset
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT sqk('completion_to_accept') AS cc \gset
SELECT t_assert(jsonb_array_length(:'cc'::jsonb)=1 AND (:'cc'::jsonb)->0 @> jsonb_build_object('ref_id',(:'a1'::jsonb)->>'completion_id',
   'summary',jsonb_build_object('signer_role','organization_owner','scope_basis','accepted_quote'),
   'sign',jsonb_build_object('rpc','accept_work_completion','args_hint',jsonb_build_object('p_completion_hash',(:'a1'::jsonb)->>'completion_hash'))),
 'completion_to_accept: exact attestation hash');
SELECT accept_work_completion('30000000-0000-0000-0000-000000000001',((:'cc'::jsonb)#>>'{0,sign,args_hint,p_completion_id}')::uuid,
 (:'cc'::jsonb)#>>'{0,sign,args_hint,p_completion_hash}');
SELECT t_assert(sqk('completion_to_accept')='[]'::jsonb,'accepted completion leaves the queue');

-- Payment witnesses: the payees confirm what the customer reported.
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT issue_work_order_invoice('30000000-0000-0000-0000-000000000001',
 '[{"quote_line":0,"description":"Fabrication labor","pricing_basis":"day_rate","amount":150,"currency":"USD","unit":"day","quantity":2},{"quote_line":1,"description":"Inspection fee","pricing_basis":"flat","amount":90,"currency":"USD"}]') AS i1 \gset
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT record_work_order_payment(((:'i1'::jsonb)->>'invoice_id')::uuid,390,'USD','card',now()-interval '1 hour','fixture-ref-9') AS w1 \gset
SELECT t_assert(sqk('invoice_payment_to_confirm')='[]'::jsonb,'the payer has nothing to confirm');
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT jsonb_array_length(sqk('invoice_payment_to_confirm')) AS np \gset
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(sqk('invoice_payment_to_confirm')='[]'::jsonb AND NOT sq()::text ~ '(fixture-ref-9|"amount")','stranger: no payment items or amounts');
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT sqk('invoice_payment_to_confirm') AS op \gset
SELECT t_assert(jsonb_array_length(:'op'::jsonb)=1 AND (:'np')::int=1 AND (:'op'::jsonb)->0 @> jsonb_build_object('ref_id',(:'w1'::jsonb)->>'payment_witness_id',
   'summary',jsonb_build_object('reported_by_role','customer','amount',390,'currency','USD','reference','fixture-ref-9','visibility','parties_only'),
   'sign',jsonb_build_object('rpc','record_work_order_payment','args_hint',jsonb_build_object('p_invoice_id',(:'i1'::jsonb)->>'invoice_id','p_amount',390))),
 'payees (org owner and accepted provider): customer-reported payment to confirm');
SELECT record_work_order_payment(((:'op'::jsonb)#>>'{0,sign,args_hint,p_invoice_id}')::uuid,((:'op'::jsonb)#>>'{0,sign,args_hint,p_amount}')::numeric,
 (:'op'::jsonb)#>>'{0,sign,args_hint,p_currency}',(:'op'::jsonb)#>>'{0,sign,args_hint,p_method}',((:'op'::jsonb)#>>'{0,sign,args_hint,p_paid_at}')::timestamptz,
 (:'op'::jsonb)#>>'{0,sign,args_hint,p_reference}');
SELECT t_assert(sqk('invoice_payment_to_confirm')='[]'::jsonb,'confirmed payment leaves the payee queues');
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT t_assert(sqk('invoice_payment_to_confirm')='[]'::jsonb,'and the other payee''s');
RESET ROLE;

-- Incoming contact requests, to a user and to an organization.
INSERT INTO contact_requests(requester_user_id,recipient_user_id,context_kind,context_id,message) VALUES
 ('10000000-0000-0000-0000-00000000000b','10000000-0000-0000-0000-00000000000c','work_order','30000000-0000-0000-0000-000000000001','Is the exhaust done?');
INSERT INTO contact_requests(requester_user_id,recipient_organization_id,context_kind,context_id,message) VALUES
 ('10000000-0000-0000-0000-00000000000b','20000000-0000-0000-0000-000000000001','vehicle','40000000-0000-0000-0000-000000000001','Hello shop');
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT sqk('contact_request') AS cr \gset
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT sqk('contact_request') AS orr \gset
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(sqk('contact_request')='[]'::jsonb,'requester sees no incoming request');
RESET ROLE;
SELECT t_assert(jsonb_array_length(:'cr'::jsonb)=1 AND (:'cr'::jsonb)->0 @> '{"work_order_id":"30000000-0000-0000-0000-000000000001","summary":{"message":"Is the exhaust done?","recipient_kind":"user"},"sign":{"rpc":"respond_contact_request"}}'
 AND jsonb_array_length(:'orr'::jsonb)=1 AND (:'orr'::jsonb)->0 @> '{"summary":{"message":"Hello shop","recipient_kind":"organization"}}'
 AND NOT (:'cr'::jsonb)::text ~ '(10000000-0000-0000-0000-00000000000b|example\.invalid|5550100)','contact requests to the user and to the shop; requester by label; no contact fields');

-- Own work session: unchanged rows, normalized sign; queue with only a work session keeps its old coverage.
UPDATE vehicles SET make='Ford',model='F-100',year=1972 WHERE id='40000000-0000-0000-0000-000000000001';
INSERT INTO work_sessions(id,user_id,vehicle_id,session_date,start_time,end_time,duration_minutes,image_count) VALUES
 ('70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000d','40000000-0000-0000-0000-000000000001','2026-01-05',
  '2026-01-05 09:00+00','2026-01-05 10:00+00',60,3);
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT sq() AS vq \gset
SELECT t_refused('SELECT signature_queue_extend(''10000000-0000-0000-0000-00000000000d'',''{}'')') AS ext_refused \gset
RESET ROLE;
SELECT t_assert((:'vq'::jsonb)->'coverage' @> '{"returned":1,"total":1,"kinds":["work_session"]}'
 AND (:'vq'::jsonb)#>'{items,0}' @> '{"kind":"work_session","ref_id":"70000000-0000-0000-0000-000000000001","vehicle_label":{"text":"1972 Ford F-100"},"capture_span_minutes":60,
   "summary":{"capture_span_minutes":60},"sign":{"rpc":"confirm_work_session","args_hint":{"p_session_id":"70000000-0000-0000-0000-000000000001","p_confirm":true},
   "binds":["self-confirmation of a photo-derived work day"],"does_not_bind":["counterparty acceptance","labor value","payment"]}}','work session item kept and normalized');
SET ROLE anon;
SELECT as_user(NULL);
SELECT t_assert(t_refused('SELECT my_signature_queue()'),'anon refused');
RESET ROLE;
SELECT t_assert((:'ext_refused')::boolean AND NOT has_function_privilege('authenticated','signature_queue_extend(uuid,jsonb)','EXECUTE')
 AND NOT has_function_privilege('anon','my_signature_queue()','EXECUTE') AND has_function_privilege('authenticated','my_signature_queue()','EXECUTE'),
 'grants: queue authenticated only; extension internal');
SELECT t_assert((SELECT count(*) FROM regexp_matches(pg_get_functiondef('my_signature_queue()'::regprocedure),'signature_queue_extend','g'))=1,
 'live queue carries the extension once');
