-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations (chained on the job-loop replay).
-- vehicle_work_orders_read viewer.vehicle_access and post_work_request / request_inspection actions, checked against the Signs.
\ir test_job_loop_replay.sql

CREATE FUNCTION public.as_user(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.auth_uid',COALESCE(p::text,''),false) $$;
GRANT EXECUTE ON FUNCTION public.as_user(uuid) TO anon, authenticated, service_role;
-- post_work_request reads the labor rate in its DECLARE section; the live owner is outside this fixture.
CREATE FUNCTION public.resolve_labor_rate(p_a uuid DEFAULT NULL, p_b uuid DEFAULT NULL, p_c uuid DEFAULT NULL, p_d uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE sql STABLE AS 'SELECT ''{}''::jsonb';
CREATE TABLE IF NOT EXISTS public.vehicle_user_permissions(vehicle_id uuid, user_id uuid, role text, is_active boolean);
INSERT INTO vehicle_user_permissions VALUES ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000009','co_owner',true);
INSERT INTO vehicle_access_grants VALUES ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000009'),
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000008');
UPDATE vehicles SET is_public = true, uploaded_by = '10000000-0000-0000-0000-00000000000e' WHERE id = '40000000-0000-0000-0000-000000000001';
UPDATE vehicles SET is_public = false WHERE id = '40000000-0000-0000-0000-000000000003';
CREATE FUNCTION public.va(p_vehicle uuid DEFAULT '40000000-0000-0000-0000-000000000001') RETURNS jsonb LANGUAGE sql AS $$ SELECT vehicle_work_orders_read(p_vehicle)->'viewer' $$;
GRANT EXECUTE ON FUNCTION public.va(uuid) TO anon, authenticated;

SET ROLE anon;
SELECT as_user(NULL);
SELECT va() AS anon \gset
RESET ROLE;
SELECT t_assert((:'anon'::jsonb) @> '{"vehicle_access":{"role":"none","can_post_work_request":false,"can_request_inspection":false,"post_work_request_reason":"sign_in","request_inspection_reason":"sign_in"},"actions":[]}',
 'anon: role none; both false (sign_in)');
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT va() AS owner \gset
SELECT as_user('10000000-0000-0000-0000-000000000009');
SELECT va() AS co \gset
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT va() AS up \gset
SELECT as_user('10000000-0000-0000-0000-000000000008');
SELECT va() AS ah \gset
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT va() AS stranger \gset
SELECT t_assert(va('40000000-0000-0000-0000-000000000003') @> '{"vehicle_access":{"role":"none","can_post_work_request":false,"can_request_inspection":false,"request_inspection_reason":"vehicle_private"},"actions":[]}','stranger on a private vehicle: neither Sign');
RESET ROLE;
SELECT t_assert((:'owner'::jsonb) @> '{"vehicle_access":{"role":"owner","can_post_work_request":true,"can_request_inspection":true},"actions":[{"action":"post_work_request","args":{"p_vehicle_id":"40000000-0000-0000-0000-000000000001","p_visibility":"open"}},{"action":"request_inspection"}]}'
 AND (:'co'::jsonb) @> '{"vehicle_access":{"role":"co_owner","can_post_work_request":true}}'
 AND (:'up'::jsonb) @> '{"vehicle_access":{"role":"uploader","can_post_work_request":true}}'
 AND (:'ah'::jsonb) @> '{"vehicle_access":{"role":"access_holder","can_post_work_request":true}}',
 'owner, co-owner, uploader and access holder may post a job');
SELECT t_assert((:'stranger'::jsonb) @> '{"vehicle_access":{"role":"none","can_post_work_request":false,"can_request_inspection":true,"post_work_request_reason":"not_your_vehicle"}}'
 AND NOT (:'stranger'::jsonb)->'actions' @> '[{"action":"post_work_request"}]' AND (:'stranger'::jsonb)->'actions' @> '[{"action":"request_inspection"}]',
 'stranger on a public vehicle: inspection only');

-- The booleans agree with the Signs themselves.
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT t_assert(t_refused_with($q$SELECT post_work_request('40000000-0000-0000-0000-000000000001','Replace the exhaust manifold gasket')$q$,'Vehicle unavailable')
 AND NOT t_refused($q$SELECT request_inspection('40000000-0000-0000-0000-000000000001',NULL,'{"inspection_type":"pre_purchase"}')$q$),
 'stranger: post_work_request refused, request_inspection accepted, as reported');
SELECT as_user('10000000-0000-0000-0000-000000000008');
SELECT t_assert(NOT t_refused_with($q$SELECT post_work_request('40000000-0000-0000-0000-000000000001','Replace the exhaust manifold gasket')$q$,'Vehicle unavailable'),
 'access holder: post_work_request does not refuse on vehicle access, as reported');
RESET ROLE;
SELECT t_assert(NOT has_function_privilege('authenticated','vehicle_viewer_work_access(uuid,uuid)','EXECUTE')
 AND (SELECT count(*) FROM regexp_matches(pg_get_functiondef('vehicle_work_orders_read(uuid,uuid,integer)'::regprocedure),'vehicle_viewer_work_access','g'))=1,
 'helper internal; one anchored call');
