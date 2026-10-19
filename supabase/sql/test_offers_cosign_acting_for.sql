-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations (chained on the job-loop replay).
-- work_order_offers_read cosign_provider action lists the capacities the viewer can sign in (acting_for).
\ir test_job_loop_replay.sql

CREATE FUNCTION public.as_user(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.auth_uid',COALESCE(p::text,''),false) $$;
GRANT EXECUTE ON FUNCTION public.as_user(uuid) TO anon, authenticated, service_role;
UPDATE vehicles SET is_public = true WHERE id = '40000000-0000-0000-0000-000000000001';
INSERT INTO organizations(id,name) VALUES ('20000000-0000-0000-0000-000000000002','Second Garage');
UPDATE organizations SET name='Fixture Shop' WHERE id='20000000-0000-0000-0000-000000000001';
INSERT INTO organization_contributors(organization_id,user_id,role,status) VALUES
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000d','technician','active'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000d','technician','active');
ALTER TABLE work_order_line_items DROP CONSTRAINT work_order_line_items_task_type_check;
INSERT INTO work_order_line_items(id,work_order_id,line_number,task_type,task_description,status) VALUES
 ('51000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'fabricate','Headers','pending');
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,structured_data) VALUES
 ('55000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001','2026-03-02','requirement_interpretation_v1',
  jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','requirement','work_order_id','30000000-0000-0000-0000-000000000001',
   'line_item_id','51000000-0000-0000-0000-000000000001','requirement_kind','skill','description','TIG welding','quantity',NULL,'unit',NULL)));
SET ROLE service_role;
SELECT project_work_order_resource_observation('55000000-0000-0000-0000-000000000001');
RESET ROLE;
INSERT INTO account_link_claims(user_id,platform,handle,actor_id,status,verification_method) VALUES
 ('10000000-0000-0000-0000-00000000000f','nuke_actor','60000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','pending','self_claim');
CREATE FUNCTION public.cs() RETURNS jsonb LANGUAGE sql AS $$
  SELECT COALESCE(jsonb_agg(a), '[]') FROM jsonb_array_elements(work_order_offers_read('30000000-0000-0000-0000-000000000001')#>'{viewer,actions}') a WHERE a->>'action'='cosign_provider' $$;
GRANT EXECUTE ON FUNCTION public.cs() TO anon, authenticated;

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT offer_on_requirement('55000000-0000-0000-0000-000000000001',NULL,NULL,NULL,NULL) AS o1 \gset
SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT cs() AS vm \gset
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(cs() = '[]'::jsonb,'stranger without organization or tools: no cosign action');
SELECT as_user('10000000-0000-0000-0000-00000000000d');
RESET ROLE;
SELECT t_assert(jsonb_array_length(:'vm'::jsonb) = 1 AND (:'vm'::jsonb)->0 @> jsonb_build_object('args',jsonb_build_object('p_offer_id',(:'o1'::jsonb)->>'offer_id'),
   'acting_for',jsonb_build_array(
     jsonb_build_object('kind','organization','organization_id','20000000-0000-0000-0000-000000000001','name','Fixture Shop','p_cut',jsonb_build_object('organization_id','20000000-0000-0000-0000-000000000001')),
     jsonb_build_object('kind','organization','organization_id','20000000-0000-0000-0000-000000000002','name','Second Garage')))
 AND jsonb_array_length((:'vm'::jsonb)->0->'acting_for') = 2,
 'a member of two organizations now gets the cosign action with both organizations to choose from');
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT cosign_provider('30000000-0000-0000-0000-000000000001',((:'o1'::jsonb)->>'offer_id')::uuid,ARRAY['availability'],'Lift bay at Second Garage',
  (:'vm'::jsonb)->0->'acting_for'->1->'p_cut') AS c1 \gset
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM jsonb_array_elements(public.work_order_offer_cosigns(((:'o1'::jsonb)->>'offer_id')::uuid)) c
   WHERE c->>'attestor_organization_id' = '20000000-0000-0000-0000-000000000002') = 1,'signing with an acting_for p_cut records the chosen organization''s co-sign');
SELECT t_assert(NOT has_function_privilege('authenticated','cosign_acting_for(uuid,uuid)','EXECUTE')
 AND (SELECT count(*) FROM regexp_matches(pg_get_functiondef('work_order_offers_read(uuid)'::regprocedure),'cosign_acting_for','g'))=1,'helper internal; one call');
