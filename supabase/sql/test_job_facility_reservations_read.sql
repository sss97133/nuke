-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations (chained on the job-loop replay).
-- Job facility reservations reader and the reserve_facility action on the job view.
\ir test_job_loop_replay.sql

CREATE FUNCTION public.as_user(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.auth_uid',COALESCE(p::text,''),false) $$;
GRANT EXECUTE ON FUNCTION public.as_user(uuid) TO anon, authenticated, service_role;
UPDATE vehicles SET is_public = true WHERE id = '40000000-0000-0000-0000-000000000001';
UPDATE organizations SET is_public = true, name = 'Fixture Shop' WHERE id = '20000000-0000-0000-0000-000000000001';
ALTER TABLE work_order_line_items DROP CONSTRAINT work_order_line_items_task_type_check;
INSERT INTO work_order_line_items(id,work_order_id,line_number,task_type,task_description,status) VALUES
 ('51000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'fabricate','Headers','pending');
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,structured_data) VALUES
 ('55000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001','2026-03-02','requirement_interpretation_v1',
  jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','requirement','work_order_id','30000000-0000-0000-0000-000000000001',
   'line_item_id','51000000-0000-0000-0000-000000000001','requirement_kind','facility','description','Lift bay','quantity',1,'unit','bay')));
SET ROLE service_role;
SELECT project_work_order_resource_observation('55000000-0000-0000-0000-000000000001');
RESET ROLE;
CREATE FUNCTION public.jpa() RETURNS jsonb LANGUAGE sql AS $$ SELECT work_order_job_path_read('30000000-0000-0000-0000-000000000001')#>'{viewer,actions}' $$;
CREATE FUNCTION public.fr() RETURNS jsonb LANGUAGE sql AS $$ SELECT work_order_facility_reservations_read('30000000-0000-0000-0000-000000000001') $$;
GRANT EXECUTE ON FUNCTION public.jpa(), public.fr() TO anon, authenticated;

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT declare_facility_asset('20000000-0000-0000-0000-000000000001','lift','Lift A',1)->>'asset_id' AS lift \gset
SELECT t_assert(NOT jpa() @> '[{"action":"reserve_facility"}]','the shop owner (not customer or accepted provider) gets no reserve action');
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(jpa() = '[]'::jsonb,'stranger: no actions');
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT jpa() AS ca \gset
SELECT t_assert((:'ca'::jsonb) @> '[{"action":"reserve_facility","as":"customer","facility_requirement_id":"55000000-0000-0000-0000-000000000001",
   "args":{"p_work_order_id":"30000000-0000-0000-0000-000000000001"},"facilities":[{"organization_id":"20000000-0000-0000-0000-000000000001","name":"Fixture Shop"}]}]',
 'customer: reserve_facility with the facility requirement and the job''s shop');
SELECT reserve_facility('30000000-0000-0000-0000-000000000001',:'lift',now() + interval '2 days',now() + interval '2 days 3 hours','{"basis":"hourly","amount":40,"currency":"USD"}') AS r1 \gset
SELECT fr() AS cr \gset
SELECT t_assert((:'cr'::jsonb)->'reservations' @> jsonb_build_array(jsonb_build_object('reservation_id',(:'r1'::jsonb)->>'reservation_id','state','requested',
   'requester_role','customer','terms',jsonb_build_object('basis','hourly','amount',40),'asset',jsonb_build_object('kind','lift','label','Lift A'),
   'shop',jsonb_build_object('name','Fixture Shop'),'visibility','party'))
 AND (:'cr'::jsonb)#>'{viewer,actions}' @> jsonb_build_array(jsonb_build_object('action','cancel_facility_reservation','args',jsonb_build_object('p_reservation_id',(:'r1'::jsonb)->>'reservation_id'))),
 'customer sees the pending request with terms and a cancel action');
RESET ROLE;
SET ROLE anon;
SELECT as_user(NULL);
SELECT t_assert(fr()->'reservations' = '[]'::jsonb AND jpa() = '[]'::jsonb,'visitor: a pending request is not shown');
RESET ROLE;
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT t_assert(fr()->'reservations'->0 @> '{"state":"requested","visibility":"party"}','facility owner sees the request');
SELECT confirm_facility_reservation(((:'r1'::jsonb)->>'reservation_id')::uuid,(:'r1'::jsonb)->>'reservation_hash');
RESET ROLE;
SET ROLE anon;
SELECT as_user(NULL);
SELECT fr() AS ar \gset
RESET ROLE;
SELECT t_assert((:'ar'::jsonb)->'reservations' @> '[{"state":"confirmed","visibility":"busy_window_only","asset":{"kind":"lift","label":"Lift A"},"shop":{"name":"Fixture Shop"}}]'
 AND NOT (:'ar'::jsonb)::text ~ ('("reservation_id"|"requester_role"|"requested_by"|"terms"|"amount"|' || ((:'r1'::jsonb)->>'reservation_id') || ')'),
 'visitor: confirmed busy window only, no ids, requester or terms');
SELECT t_assert(has_function_privilege('anon','work_order_facility_reservations_read(uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','work_order_facility_actions(uuid,uuid)','EXECUTE')
 AND (SELECT count(*) FROM regexp_matches(pg_get_functiondef('work_order_job_path_read(uuid)'::regprocedure),'work_order_facility_actions','g'))=1,
 'grants; job view carries the facility actions once');
