-- Disposable PG17 only. Proves 20261019234500_start_work.sql: the accepted provider starts the work, pinned to the accepted
-- quote hash (or the accepted offer terms when no quote is accepted); the job path execution stage is recorded with a start
-- Sign and partial with evidence only; start_work is a job-view action for that provider only, not a queue item.
-- Fixture and prior state: the golden-path chain (inspection job IW with an accepted inspector and no quote); a fresh job
-- posted here on the client's own truck, offered, accepted, quoted and accepted, with evidence attached and no start Sign.
\set ON_ERROR_STOP on
\ir test_job_loop_golden_path.sql
SELECT to_regprocedure('public.start_work(uuid,text)') IS NULL AS need_start \gset
\if :need_start
\ir ../migrations/20261019234500_start_work.sql
\endif

CREATE FUNCTION public.s_jp(p_wo uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT work_order_job_path_read(p_wo) $$;
GRANT EXECUTE ON FUNCTION public.s_jp(uuid) TO anon, authenticated;
INSERT INTO vehicles(id,owner_id,year,make,model,is_public,city,state) VALUES
 ('e7300000-0000-0000-0000-000000000003','e7000000-0000-0000-0000-0000000000c1',1985,'Chevrolet','K10',true,'Reno','NV') ON CONFLICT (id) DO NOTHING;
INSERT INTO vehicle_images(id,vehicle_id,taken_at,is_external,user_id,vision_gate_status,image_url,is_sensitive,is_superseded) VALUES
 ('e7d00000-0000-0000-0000-000000000001','e7300000-0000-0000-0000-000000000003',clock_timestamp()+interval '1 minute',false,'e7000000-0000-0000-0000-0000000000a1','approved','https://img.example.invalid/w1.jpg',false,false),
 ('e7d00000-0000-0000-0000-000000000002','e7300000-0000-0000-0000-000000000003',clock_timestamp()+interval '1 minute',false,'e7000000-0000-0000-0000-0000000000a1','approved','https://img.example.invalid/w2.jpg',false,false);
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT post_work_request('e7300000-0000-0000-0000-000000000003','The radiator leaks coolant.',NULL,NULL,NULL,'invite_only') AS pj \gset
RESET ROLE;
SELECT (:'pj'::jsonb)->>'work_order_id' AS pw \gset
SELECT (:'pj'::jsonb)#>>'{requirements,0,requirement_id}' AS pwreq \gset
SELECT (:'pj'::jsonb)#>>'{operations,0,line_item_id}' AS pwop \gset
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000a1');
SELECT offer_on_requirement(:'pwreq',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('description','Radiator replacement',
  'pricing_basis','flat','amount',300,'currency','USD','unit',NULL,'quantity',NULL))),NULL,NULL,NULL) AS so \gset
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT accept_offer(((:'so'::jsonb)->>'offer_id')::uuid,(:'so'::jsonb)->>'offer_hash');
SELECT t_as('e7000000-0000-0000-0000-0000000000a1');
SELECT issue_work_order_quote(:'pw',jsonb_build_array(jsonb_build_object('ref_kind','operation','ref_id',:'pwop','description','Radiator replacement',
  'pricing_basis','flat','amount',300,'currency','USD','unit',NULL,'quantity',NULL)),NULL,NULL,NULL) AS q1 \gset
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT accept_work_order_quote(((:'q1'::jsonb)->>'quote_id')::uuid,(:'q1'::jsonb)->>'quote_hash');
SELECT t_as('e7000000-0000-0000-0000-0000000000a1');
SELECT issue_change_order(:'pw',((:'q1'::jsonb)->>'quote_id')::uuid,jsonb_build_array(jsonb_build_object('action','add','line',jsonb_build_object('ref_kind','fee',
  'ref_id',NULL,'description','Coolant','pricing_basis','flat','amount',30,'currency','USD','unit',NULL,'quantity',NULL))),'Coolant added') AS co \gset
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT accept_work_order_quote(((:'co'::jsonb)->>'quote_id')::uuid,(:'co'::jsonb)->>'quote_hash');
SELECT t_as('e7000000-0000-0000-0000-0000000000a1');
SELECT attach_job_evidence(:'pw',ARRAY['e7d00000-0000-0000-0000-000000000001','e7d00000-0000-0000-0000-000000000002']::uuid[],NULL,NULL);
RESET ROLE;

-- Evidence alone is partial now; nothing started.
SET ROLE anon;
SELECT g_anon();
SELECT t_assert(s_jp(:'pw')#>'{stages,execution}' @> '{"state":"partial","state_basis":"attached_evidence_without_start_sign","start_sign":null,"attached_evidence":{"images":2}}'
  AND s_jp(:'pw')#>'{viewer,actions}'='[]'::jsonb,'execution: attached evidence without a start Sign is partial; visitor has no actions');
RESET ROLE;

-- Only the accepted provider gets the action, with the accepted change order's hash.
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT t_assert(s_jp(:'pw')#>'{viewer,actions}'='[]'::jsonb,'customer: no start_work action');
SELECT jsonb_array_length(my_signature_queue()->'items') AS cl_q0 \gset
SELECT t_assert(t_refused_with(format('SELECT start_work(%L,%L)',:'pw',(:'co'::jsonb)->>'quote_hash'),'customer does not start'),'customer cannot start the work');
SELECT t_as('e7000000-0000-0000-0000-0000000000b0');
SELECT t_assert(s_jp(:'pw')#>'{viewer,actions}'='[]'::jsonb AND t_refused_with(format('SELECT start_work(%L,%L)',:'pw',(:'co'::jsonb)->>'quote_hash'),'accepted provider'),
  'the shop co-signer is not the provider: no action, refused');
SELECT t_as('e7000000-0000-0000-0000-000000000099');
SELECT t_assert(t_refused_with(format('SELECT start_work(%L,%L)',:'pw',(:'co'::jsonb)->>'quote_hash'),'accepted provider'),'stranger refused');
SELECT t_as('e7000000-0000-0000-0000-0000000000a1');
SELECT s_jp(:'pw')#>'{viewer,actions}' AS mx_actions \gset
SELECT t_assert((:'mx_actions'::jsonb) @> jsonb_build_array(jsonb_build_object('action','start_work','rpc','start_work','terms_basis','accepted_quote',
   'args',jsonb_build_object('p_work_order_id',:'pw','p_terms_hash',(:'co'::jsonb)->>'quote_hash'))),
  'accepted provider: start_work action carries the accepted change order hash');
SELECT t_assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(my_signature_queue()->'items') i WHERE i->>'kind' ~ 'start'),'provider queue: no start item (job-view action only)');
SELECT t_assert(t_refused_with(format('SELECT start_work(%L,%L)',:'pw',(:'q1'::jsonb)->>'quote_hash'),'Terms hash does not match'),'the superseded base quote hash is refused');
SELECT start_work(:'pw',(:'co'::jsonb)->>'quote_hash') AS st \gset
SELECT t_assert((start_work(:'pw',(:'co'::jsonb)->>'quote_hash')->>'duplicate')::boolean AND s_jp(:'pw')#>'{viewer,actions}'='[]'::jsonb,
  'repeat is a duplicate; the action is gone once started');
RESET ROLE;
SELECT t_assert((:'st'::jsonb) @> jsonb_build_object('signer_role','technician','terms_basis','accepted_quote','quote_id',(:'co'::jsonb)->>'quote_id',
   'duplicate',false,'work_order_status_changed',false,'payment_authorized',false,'customer_notified',false)
 AND (SELECT signer_user_id='e7000000-0000-0000-0000-0000000000a1' AND started_at IS NOT NULL FROM work_order_work_starts WHERE id=((:'st'::jsonb)->>'start_id')::uuid)
 AND (SELECT started_at IS NULL FROM work_orders WHERE id=:'pw'),'start_work: start clock attributed to the signer; no status or start column written');

SET ROLE anon;
SELECT g_anon();
SELECT s_jp(:'pw') AS jp1 \gset
RESET ROLE;
SELECT t_assert((:'jp1'::jsonb)#>'{stages,execution}' @> '{"state":"recorded","state_basis":"provider_start_sign",
   "start_sign":{"signer_role":"technician","terms_basis":"accepted_quote","terms_current":true,"start_signs":1},"attached_evidence":{"images":2}}'
 AND NOT (:'jp1'::jsonb)#>'{stages,execution,gaps}' @> '["no_start_clock"]' AND NOT g_pii(:'jp1'::jsonb)
 AND NOT (:'jp1'::jsonb)#>'{stages,execution,start_sign}' ? 'signer_user_id','visitor: execution recorded by the start Sign with evidence counts; no ids or PII');
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT t_assert(jsonb_array_length(my_signature_queue()->'items')=(:'cl_q0')::int,'customer queue: nothing new');
RESET ROLE;

-- An inspection job without a quote: the inspector starts under the accepted offer terms.
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000f1');
SELECT a->'args'->>'p_terms_hash' AS ih FROM jsonb_array_elements(s_jp(:'iw')#>'{viewer,actions}') a WHERE a->>'action'='start_work' \gset
SELECT start_work(:'iw',:'ih') AS st2 \gset
RESET ROLE;
SELECT t_assert((:'st2'::jsonb) @> '{"signer_role":"inspector","terms_basis":"accepted_offer","quote_id":null}'
  AND :'ih'=(SELECT COALESCE(accepted_terms_hash,offer_hash) FROM work_order_assignments WHERE role='inspector' AND work_order_id=:'iw' LIMIT 1),
  'inspection job: the inspector starts under the accepted offer terms hash');

SELECT t_assert(t_refused_with($q$UPDATE work_order_work_starts SET started_at=now()$q$,'immutable')
  AND t_refused_with($q$DELETE FROM work_order_work_starts$q$,'immutable')
  AND t_refused_with(format($q$INSERT INTO work_order_work_starts(id,work_order_id,assignment_id,signer_user_id,signer_role,terms_basis,terms_hash,started_at)
    SELECT gen_random_uuid(),%L,assignment_id,signer_user_id,signer_role,terms_basis,terms_hash,now() FROM work_order_work_starts LIMIT 1$q$,:'pw'),'only by start_work'),
  'start Signs: immutable, recorded only by start_work');
SELECT t_assert(has_function_privilege('authenticated','start_work(uuid,text)','EXECUTE') AND NOT has_function_privilege('anon','start_work(uuid,text)','EXECUTE')
  AND NOT has_function_privilege('service_role','start_work(uuid,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','work_order_start_terms(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','work_order_job_actions(uuid,uuid)','EXECUTE')
  AND NOT has_table_privilege('authenticated','public.work_order_work_starts','SELECT') AND NOT has_table_privilege('service_role','public.work_order_work_starts','INSERT')
  AND has_function_privilege('anon','work_order_job_path_read(uuid)','EXECUTE'),'grants: Sign authenticated only; helpers and table closed; job reader open');
SELECT jsonb_agg(jsonb_build_object('proname',proname,'hash',md5(pg_get_functiondef(oid))) ORDER BY proname) AS implementation_hashes
 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('start_work','work_order_start_terms','work_order_execution_start_overlay',
 'work_order_job_actions','work_order_work_start_guard','read_work_order_job_path','work_order_job_path_read');
