-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations (chained on the job-loop replay).
-- work_order_operations_read (open operations with quote refs; an accepted non-owner provider reads and quotes them) and
-- work_order_quotes_read issued_by_viewer.
\ir test_job_loop_replay.sql

CREATE FUNCTION public.as_user(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.auth_uid',COALESCE(p::text,''),false) $$;
GRANT EXECUTE ON FUNCTION public.as_user(uuid) TO anon, authenticated, service_role;
-- post_work_request reads the labor rate in its DECLARE section; the live owner is outside this fixture.
CREATE FUNCTION public.resolve_labor_rate(p_a uuid DEFAULT NULL, p_b uuid DEFAULT NULL, p_c uuid DEFAULT NULL, p_d uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE sql STABLE AS 'SELECT ''{}''::jsonb';
-- Live columns the replay fixture omits.
ALTER TABLE work_order_parts ADD COLUMN IF NOT EXISTS category text, ADD COLUMN IF NOT EXISTS is_comped boolean;
ALTER TABLE work_order_labor ADD COLUMN IF NOT EXISTS status text, ADD COLUMN IF NOT EXISTS is_comped boolean;
ALTER TABLE work_order_line_items DROP CONSTRAINT work_order_line_items_task_type_check;
INSERT INTO work_order_line_items(id,work_order_id,line_number,task_type,task_description,status) VALUES
 ('51000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'fabricate','Headers','pending'),
 ('51000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001',2,'other','Call Fixture Customer before welding','pending');
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,structured_data) VALUES
 ('55000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001','2026-03-02','requirement_interpretation_v1',
  jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','requirement','work_order_id','30000000-0000-0000-0000-000000000001',
   'line_item_id','51000000-0000-0000-0000-000000000001','requirement_kind','skill','description','TIG welding','quantity',NULL,'unit',NULL)));
SET ROLE service_role;
SELECT project_work_order_resource_observation('55000000-0000-0000-0000-000000000001');
RESET ROLE;
INSERT INTO account_link_claims(user_id,platform,handle,actor_id,status,verification_method) VALUES
 ('10000000-0000-0000-0000-00000000000f','nuke_actor','60000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','pending','self_claim');
UPDATE vehicles SET is_public = false WHERE id = '40000000-0000-0000-0000-000000000001';
CREATE FUNCTION public.opr(p_wo uuid DEFAULT '30000000-0000-0000-0000-000000000001') RETURNS jsonb LANGUAGE sql AS $$ SELECT work_order_operations_read(p_wo) $$;
CREATE FUNCTION public.qr() RETURNS jsonb LANGUAGE sql AS $$ SELECT work_order_quotes_read('30000000-0000-0000-0000-000000000001') $$;
GRANT EXECUTE ON FUNCTION public.opr(uuid), public.qr() TO anon, authenticated;

-- Technician 0f (not the shop owner 0e) offers on the skill requirement; the customer 0c accepts.
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT t_assert(t_refused_with('SELECT opr()','Work order unavailable'),'before acceptance: a technician cannot read a private vehicle''s job');
RESET ROLE;
UPDATE vehicles SET is_public = true WHERE id = '40000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT offer_on_requirement('55000000-0000-0000-0000-000000000001',NULL,NULL,NULL,NULL) AS o1 \gset
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT accept_offer(((:'o1'::jsonb)->>'offer_id')::uuid,(:'o1'::jsonb)->>'offer_hash');
RESET ROLE;
UPDATE vehicles SET is_public = false WHERE id = '40000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT opr() AS t1 \gset
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(t_refused_with('SELECT opr()','Work order unavailable') AND t_refused_with('SELECT qr()','Work order unavailable'),
 'stranger: private vehicle job and quotes unavailable');
RESET ROLE;
SET ROLE anon;
SELECT as_user(NULL);
SELECT t_assert(t_refused_with('SELECT opr()','Work order unavailable'),'anon: private vehicle job unavailable');
RESET ROLE;
SELECT t_assert((:'t1'::jsonb)->'viewer' @> '{"party":true,"quote_issuer_role":"accepted_provider","context":"provider","slots":["accepted_provider"]}'
 AND (:'t1'::jsonb)#>'{viewer,actions}' @> '[{"action":"issue_quote","rpc":"issue_work_order_quote"}]'
 AND (:'t1'::jsonb)->'operations' @> jsonb_build_array(
   jsonb_build_object('id','51000000-0000-0000-0000-000000000001','task_type','fabricate','status','pending','description','Headers',
     'requested_by_role','unknown','quote_ref',jsonb_build_object('ref_kind','operation','ref_id','51000000-0000-0000-0000-000000000001'),
     'requirements',jsonb_build_array(jsonb_build_object('id','55000000-0000-0000-0000-000000000001','requirement_kind','skill','description','TIG welding',
       'quote_ref',jsonb_build_object('ref_kind','requirement','ref_id','55000000-0000-0000-0000-000000000001')))),
   jsonb_build_object('id','51000000-0000-0000-0000-000000000002','description','Call Fixture Customer before welding'))
 AND (:'t1'::jsonb)->'parts' @> '[{"id":"d0000000-0000-0000-0000-000000000001","unit_price":31.25,"total_price":125,"quote_ref":{"ref_kind":"part"}}]'
 AND (:'t1'::jsonb)->'labor' @> '[{"id":"e0000000-0000-0000-0000-000000000001","hours":6,"hourly_rate":150,"quote_ref":{"ref_kind":"labor"}}]',
 'accepted non-owner technician on a private vehicle: operations, requirements, parts and labor with quote refs and prices; issue_quote action');
SELECT t_assert(NOT EXISTS (
   SELECT 1 FROM jsonb_path_query(:'t1'::jsonb, 'strict $.**.quote_ref') r
   WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(work_order_quote_scope_snapshot('30000000-0000-0000-0000-000000000001')->(CASE r->>'ref_kind'
       WHEN 'operation' THEN 'operations' WHEN 'requirement' THEN 'requirements' WHEN 'part' THEN 'parts' ELSE 'labor' END)) s
     WHERE s->>'id' = r->>'ref_id'))
 AND (SELECT count(*) FROM jsonb_path_query(:'t1'::jsonb, 'strict $.**.quote_ref')) = 5,
 'every quote_ref (2 operations, 1 requirement, 1 part, 1 labor) is in the quote scope snapshot');

-- The accepted technician quotes per operation from what the reader returned.
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT issue_work_order_quote('30000000-0000-0000-0000-000000000001', jsonb_build_array(
   jsonb_build_object('ref_kind',(:'t1'::jsonb)#>>'{operations,0,quote_ref,ref_kind}','ref_id',(:'t1'::jsonb)#>>'{operations,0,quote_ref,ref_id}',
     'description','Headers','pricing_basis','per_operation','amount',400,'currency','USD','unit','operation','quantity',1),
   jsonb_build_object('ref_kind','labor','ref_id',(:'t1'::jsonb)#>>'{labor,0,id}','description','Fabrication','pricing_basis','hourly',
     'amount',150,'currency','USD','unit','hour','quantity',6)),NULL,NULL,NULL) AS q1 \gset
SELECT qr() AS tq \gset
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT qr() AS oq \gset
SELECT issue_work_order_quote('30000000-0000-0000-0000-000000000001', jsonb_build_array(jsonb_build_object('ref_kind','fee','ref_id',NULL,
   'description','Shop fee','pricing_basis','flat','amount',50,'currency','USD','unit',NULL,'quantity',NULL)),NULL,NULL,((:'q1'::jsonb)->>'quote_id')::uuid) AS q2 \gset
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT qr() AS tq2 \gset
RESET ROLE;
SELECT t_assert((:'q1'::jsonb) @> '{"issued_by_role":"accepted_provider","version":1}','the accepted technician''s per-operation quote is accepted by the Sign');
SELECT t_assert((:'tq'::jsonb)#>'{current_quote,issued_by_viewer}' = 'true' AND (:'tq'::jsonb)->'history' @> '[{"version":1,"issued_by_viewer":true}]'
 AND (:'oq'::jsonb)#>'{current_quote,issued_by_viewer}' = 'false' AND (:'oq'::jsonb)->'history' @> '[{"version":1,"issued_by_viewer":false}]',
 'issued_by_viewer: true for the issuing technician, false for the shop owner');
SELECT t_assert((:'tq2'::jsonb)#>'{current_quote,issued_by_viewer}' = 'false'
 AND (:'tq2'::jsonb)->'history' @> '[{"version":1,"issued_by_viewer":true,"state":"superseded"},{"version":2,"issued_by_viewer":false,"state":"current"}]',
 'after the owner revises: the technician''s version stays theirs; the current one is not');

-- Public vehicle: open to visitors, personal text withheld from non-parties; a client-posted operation is requested by the customer.
UPDATE vehicles SET is_public = true WHERE id = '40000000-0000-0000-0000-000000000001';
-- As post_work_request records them: an owner-input operation signed by the customer.
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,submitted_by_user_id,structured_data) VALUES
 ('55000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000002',now(),'work_request_sign_v1',
  '10000000-0000-0000-0000-00000000000c',jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','operation',
   'work_order_id','30000000-0000-0000-0000-000000000001','line_number',3,'task_type','other','task_description','TIG weld flanges',
   'basis_field','description','basis_excerpt','TIG weld flanges')));
SET ROLE service_role;
SELECT project_work_order_resource_observation('55000000-0000-0000-0000-000000000003');
RESET ROLE;
SET ROLE anon;
SELECT as_user(NULL);
SELECT opr() AS a1 \gset
SELECT qr() AS aq \gset
RESET ROLE;
SELECT t_assert((:'a1'::jsonb)->'viewer' @> '{"party":false,"quote_issuer_role":null,"actions":[],"context":"visitor"}'
 AND (:'a1'::jsonb)->'operations' @> '[{"id":"51000000-0000-0000-0000-000000000001","description":"Headers"},
   {"id":"51000000-0000-0000-0000-000000000002","description":null,"description_visibility":"withheld_personal_info"}]'
 AND (:'a1'::jsonb)->'parts' @> '[{"unit_price":31.25}]'
 AND (:'aq'::jsonb)#>'{current_quote,issued_by_viewer}' = 'false' AND NOT (:'aq'::jsonb)->'history' @> '[{"issued_by_viewer":true}]',
 'anon on a public vehicle: operations and prices open, personal text withheld, no actions, nothing issued by the viewer');
SELECT t_assert((:'a1'::jsonb)->'operations' @> '[{"id":"55000000-0000-0000-0000-000000000003","requested_by_role":"customer","requested_by_basis":"authenticated_sign"}]',
 'client-posted operation: requested by the customer (authenticated Sign)');
SELECT t_assert(NOT (:'a1'::jsonb)::text ~ '(10000000-0000-0000-0000-00000000000[cdef]|Fixture Customer|fixture@example|15550100)',
 'no user ids, names or contact in the open reader');
SELECT t_assert(has_function_privilege('anon','work_order_operations_read(uuid)','EXECUTE')
 AND (SELECT count(*) FROM regexp_matches(pg_get_functiondef('work_order_quotes_read(uuid)'::regprocedure),'issued_by_viewer','g')) = 2
 AND position('work_order_quote_issuer_role(viewer, w.id) IS NULL' IN pg_get_functiondef('work_order_quotes_read(uuid)'::regprocedure)) > 0,
 'reader granted to anon; three anchored edits in work_order_quotes_read');
