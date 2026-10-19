-- Disposable PG17 only. Proves 20261020083000_work_order_publication_read.sql: a job's visibility is stated to anyone who may
-- read the job; publish / unpublish are offered as viewer actions only to the publication party on an open, non-inspection
-- job, with the refusal reason publish_work_order would give; no people ids; private vehicles stay closed to strangers.
-- Fixture and prior state: the publish_work_order chain (client c1 owns public truck V3 and private car V4; WO1 unpublished
-- after opening, WO2 invite_only with contact text, WO3 open, WO4 completed).
\set ON_ERROR_STOP on
\ir test_publish_work_order.sql
\ir ../migrations/20261020083000_work_order_publication_read.sql

INSERT INTO work_orders(id,vehicle_id,customer_id,status,title,description) VALUES
 ('e7d00000-0000-0000-0000-000000000005','e7300000-0000-0000-0000-000000000003','e7000000-0000-0000-0000-0000000000c1','pending','Brakes','Front brakes squeal.'),
 ('e7d00000-0000-0000-0000-000000000006','e7300000-0000-0000-0000-000000000004','e7000000-0000-0000-0000-0000000000c1','pending','Top','Replace the soft top.');

SELECT t_assert(has_function_privilege('anon','work_order_publication_read(uuid)','EXECUTE')
  AND has_function_privilege('anon','vehicle_work_publication_read(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','work_order_publication_state(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','work_order_publication_state(uuid,uuid)','EXECUTE'), 'grants: open readers, internal state closed');

SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT work_order_publication_read('e7d00000-0000-0000-0000-000000000005') AS r5 \gset
SELECT t_assert((:'r5'::jsonb) @> '{"visibility":"not_published","listed_in_open_requirements":false,"viewer":{"party":true}}'
  AND (:'r5'::jsonb)->'last_sign' = 'null'::jsonb
  AND (:'r5'::jsonb)#>'{viewer,actions}' @> '[{"action":"publish_work_order","rpc":"publish_work_order","args":{"p_visibility":"open"},"refused_reason":null},
    {"action":"publish_work_order","args":{"p_visibility":"invite_only"}}]'
  AND jsonb_array_length((:'r5'::jsonb)#>'{viewer,actions}') = 2
  AND (:'r5'::jsonb)#>>'{viewer,actions,0,args,p_work_order_id}' = 'e7d00000-0000-0000-0000-000000000005', 'not published: open and invite-only offered to the customer');

SELECT work_order_publication_read('e7d00000-0000-0000-0000-000000000002') AS r2 \gset
SELECT t_assert((:'r2'::jsonb) @> '{"visibility":"invite_only","last_sign":{"action":"publish"}}'
  AND jsonb_array_length((:'r2'::jsonb)#>'{viewer,actions}') = 1
  AND (:'r2'::jsonb)#>>'{viewer,actions,0,args,p_visibility}' = 'open'
  AND (:'r2'::jsonb)#>>'{viewer,actions,0,refused_reason}' LIKE '%contact details%', 'contact text: open offered with the refusal reason');

SELECT work_order_publication_read('e7d00000-0000-0000-0000-000000000003') AS r3 \gset
SELECT t_assert((:'r3'::jsonb) @> '{"visibility":"open","listed_in_open_requirements":true,"viewer":{"actions":[{"action":"unpublish_work_order","rpc":"unpublish_work_order"}]}}'
  AND jsonb_array_length((:'r3'::jsonb)#>'{viewer,actions}') = 1 AND ((:'r3'::jsonb)->>'requirements')::int > 0, 'open: unpublish offered; listed');

SELECT work_order_publication_read('e7d00000-0000-0000-0000-000000000001') AS r1 \gset
SELECT t_assert((:'r1'::jsonb) @> '{"visibility":"invite_only","last_sign":{"action":"unpublish"}}', 'unpublished job states its last Sign');

SELECT work_order_publication_read('e7d00000-0000-0000-0000-000000000004') AS r4 \gset
SELECT t_assert((:'r4'::jsonb)#>'{viewer,actions}' = '[]'::jsonb, 'a completed job offers nothing');

-- A signed-in stranger and a visitor see the state on the public truck, without actions or people ids.
SELECT t_as('e7000000-0000-0000-0000-000000000099');
SELECT work_order_publication_read('e7d00000-0000-0000-0000-000000000003') AS s3 \gset
SELECT t_assert((:'s3'::jsonb) @> '{"visibility":"open","viewer":{"party":false,"actions":[]}}', 'stranger: state, no actions');
SELECT t_assert(t_refused_with($q$SELECT work_order_publication_read('e7d00000-0000-0000-0000-000000000006')$q$, 'unavailable'), 'stranger: a private vehicle job stays closed');
CREATE OR REPLACE FUNCTION pg_temp.no_rows_or_refused(p uuid) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN RETURN jsonb_array_length(vehicle_work_publication_read(p)->'rows') = 0; EXCEPTION WHEN OTHERS THEN RETURN strpos(SQLERRM, 'unavailable') > 0; END $$;
SELECT t_assert(pg_temp.no_rows_or_refused('e7300000-0000-0000-0000-000000000004'), 'stranger: no job on a private vehicle');
RESET ROLE;
SET ROLE anon;
SELECT g_anon();
SELECT vehicle_work_publication_read('e7300000-0000-0000-0000-000000000003') AS v3 \gset
SELECT t_assert(jsonb_array_length((:'v3'::jsonb)->'rows') >= 5
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements((:'v3'::jsonb)->'rows') r WHERE jsonb_array_length(r#>'{viewer,actions}') > 0)
  AND (SELECT r->>'visibility' FROM jsonb_array_elements((:'v3'::jsonb)->'rows') r WHERE r->>'work_order_id' = 'e7d00000-0000-0000-0000-000000000003') = 'open'
  AND NOT (:'v3'::jsonb)::text LIKE '%e7000000-0000-0000-0000-0000000000c1%', 'visitor: every job state on the public truck, no actions, no people ids');
RESET ROLE;

-- The owner reads the private car's jobs with their actions.
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT vehicle_work_publication_read('e7300000-0000-0000-0000-000000000004') AS v4 \gset
SELECT t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements((:'v4'::jsonb)->'rows') r
  WHERE r->>'work_order_id' = 'e7d00000-0000-0000-0000-000000000006' AND r->>'visibility' = 'not_published' AND jsonb_array_length(r#>'{viewer,actions}') = 2
    AND r->>'listed_in_open_requirements' = 'false'), 'owner: private car job with publish actions, never listed');
RESET ROLE;
