-- Disposable PG17 only. Proves 20261019233000_post_work_request.sql: a client posts a job on their own vehicle; client-stated
-- operations quote their words, template requirements (or one skill requirement in their words), own photos attached as
-- intake evidence, existing analyses cited, a labelled reference suggested cost; open lists the requirements, invite_only
-- and private vehicles do not; never for a vehicle the client does not own. Fixture and prior state: the golden-path chain.
\set ON_ERROR_STOP on
\ir test_job_loop_golden_path.sql
SELECT to_regprocedure('public.post_work_request(uuid,text,uuid[],jsonb,timestamptz,text)') IS NULL AS need_post \gset
\if :need_post
\ir ../migrations/20261019233000_post_work_request.sql
\endif

-- The client's own vehicles: a public truck (V3) and a private car (V4); own photos (one sensitive), one existing analysis.
INSERT INTO vehicles(id,owner_id,year,make,model,is_public,city,state) VALUES
 ('e7300000-0000-0000-0000-000000000003','e7000000-0000-0000-0000-0000000000c1',1985,'Chevrolet','K10',true,'Reno','NV'),
 ('e7300000-0000-0000-0000-000000000004','e7000000-0000-0000-0000-0000000000c1',1990,'Mazda','Miata',false,'Reno','NV');
INSERT INTO labor_operations VALUES ('INT-DASH-RR','Dash pad',3,'interior',NULL,NULL) ON CONFLICT DO NOTHING;
INSERT INTO vehicle_images(id,vehicle_id,taken_at,is_external,user_id,vision_gate_status,image_url,is_sensitive,is_superseded) VALUES
 ('e7b00000-0000-0000-0000-000000000001','e7300000-0000-0000-0000-000000000003',now()-interval '1 day',false,'e7000000-0000-0000-0000-0000000000c1','approved','https://img.example.invalid/k10a.jpg',false,false),
 ('e7b00000-0000-0000-0000-000000000002','e7300000-0000-0000-0000-000000000003',now()-interval '1 day',false,'e7000000-0000-0000-0000-0000000000c1','approved','https://img.example.invalid/k10b.jpg',true,false),
 ('e7b00000-0000-0000-0000-000000000003','e7300000-0000-0000-0000-000000000003',now()-interval '1 day',false,'e7000000-0000-0000-0000-0000000000a1','approved','https://img.example.invalid/k10c.jpg',false,false);
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,confidence_score,structured_data) VALUES
 ('e7c00000-0000-0000-0000-000000000001','e7300000-0000-0000-0000-000000000003','condition','90000000-0000-0000-0000-000000000001',now()-interval '20 hours',
  'image_deep',0.6,'{"analysis_kind":"image_deep_byok","image_id":"e7b00000-0000-0000-0000-000000000001","state_observations":{"damage_callouts":["Exhaust soot at the manifold"]}}');
CREATE FUNCTION public.p_post(p_vehicle uuid,p_descr text,p_images uuid[] DEFAULT NULL,p_ops jsonb DEFAULT NULL,p_needed timestamptz DEFAULT NULL,p_vis text DEFAULT 'open')
RETURNS jsonb LANGUAGE sql AS $$ SELECT post_work_request(p_vehicle,p_descr,p_images,p_ops,p_needed,p_vis) $$;
CREATE FUNCTION public.p_wo_count() RETURNS bigint LANGUAGE sql SECURITY DEFINER AS $$ SELECT count(*) FROM work_orders $$;
GRANT EXECUTE ON FUNCTION public.p_post(uuid,text,uuid[],jsonb,timestamptz,text), public.p_wo_count() TO anon, authenticated;
SELECT p_wo_count() AS wo0 \gset

SET ROLE anon;
SELECT g_anon();
SELECT t_assert(t_refused($q$SELECT p_post('e7300000-0000-0000-0000-000000000003','Fix the brakes.')$q$),'anon cannot post a job');
RESET ROLE;
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-000000000099');
SELECT t_assert(t_refused_with($q$SELECT p_post('e7300000-0000-0000-0000-000000000003','Fix the brakes.')$q$,'request_inspection'),
  'a stranger cannot post a job on someone else''s vehicle');
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT t_assert(t_refused_with($q$SELECT p_post('e7300000-0000-0000-0000-000000000001','Fix the brakes.')$q$,'request_inspection'),
  'not for a vehicle the client does not own (the listing): that is request_inspection');
SELECT t_assert(t_refused_with($q$SELECT p_post('e7300000-0000-0000-0000-000000000003','Call me at 775-555-0199 about the brakes.')$q$,'contact')
  AND t_refused_with($q$SELECT p_post('e7300000-0000-0000-0000-000000000003','Brakes. Goldie will drop it off.')$q$,'names')
  AND t_refused_with($q$SELECT p_post('e7300000-0000-0000-0000-000000000003','Fix the brakes.',NULL,NULL,NULL,'public')$q$,'Visibility')
  AND t_refused_with($q$SELECT p_post('e7300000-0000-0000-0000-000000000003','Fix the brakes.',NULL,NULL,'2020-01-01')$q$,'future')
  AND t_refused_with($q$SELECT p_post('e7300000-0000-0000-0000-000000000003','Fix the brakes.',NULL,'["Fix the clutch"]')$q$,'quote the description')
  AND t_refused_with($q$SELECT p_post('e7300000-0000-0000-0000-000000000003','  ')$q$,'Describe'),
  'refused: contact details, the client''s own name, unknown visibility, past needed_by, operations not quoting the text, empty text');
SELECT t_assert(t_refused($q$SELECT p_post('e7300000-0000-0000-0000-000000000003','Fix the brakes.','{e7b00000-0000-0000-0000-000000000002}')$q$)
  AND t_refused($q$SELECT p_post('e7300000-0000-0000-0000-000000000003','Fix the brakes.','{e7b00000-0000-0000-0000-000000000003}')$q$),
  'a sensitive photo or someone else''s photo is refused (attach_job_evidence rules)');
SELECT t_assert(p_wo_count()=(:'wo0')::int,'refusals created nothing');

-- An open request with a photo.
SELECT p_post('e7300000-0000-0000-0000-000000000003',E'The exhaust leaks at the manifold. The brakes squeal when stopping.\nReplace the cracked dash pad.',
  '{e7b00000-0000-0000-0000-000000000001}',NULL,now()+interval '30 days','open') AS pr \gset
SELECT t_assert((p_post('e7300000-0000-0000-0000-000000000003',E'The exhaust leaks at the manifold. The brakes squeal when stopping.\nReplace the cracked dash pad.',
  '{e7b00000-0000-0000-0000-000000000001}',NULL,(SELECT ((:'pr'::jsonb)->>'needed_by')::timestamptz),'open')->>'duplicate')::boolean,'repeat is a duplicate');
RESET ROLE;
SELECT (:'pr'::jsonb)->>'work_order_id' AS pwo \gset
SELECT t_assert((:'pr'::jsonb) @> '{"request_source":"web","visibility":"open","listed_in_open_requirements":true,"listing_basis":"open_public_vehicle",
   "duplicate":false,"payment_authorized":false,"providers_notified":false,"intake_evidence":{"image_count":1}}'
 AND jsonb_array_length((:'pr'::jsonb)->'operations')=3
 AND (:'pr'::jsonb)->'operations' @> '[{"line_number":1,"text":"The exhaust leaks at the manifold.","basis":"client_stated","keyword_entry_ids":["exhaust"]},
   {"line_number":2,"text":"The brakes squeal when stopping.","keyword_entry_ids":["brakes"]},{"line_number":3,"text":"Replace the cracked dash pad.","keyword_entry_ids":["dash"]}]'
 AND jsonb_array_length((:'pr'::jsonb)->'requirements')=5
 AND (:'pr'::jsonb)->'requirements' @> '[{"kind":"skill","description":"Exhaust repair and fabrication","basis":"reviewed_template"},{"kind":"facility","description":"Vehicle lift"},
   {"kind":"skill","description":"Brake service"},{"kind":"skill","description":"Automotive interior trim"}]',
 'post_work_request: work order, three client-stated operations, template requirements, intake photo attached');
SELECT t_assert((SELECT customer_id='e7000000-0000-0000-0000-0000000000c1' AND scope_description=E'The exhaust leaks at the manifold. The brakes squeal when stopping.\nReplace the cracked dash pad.'
   AND request_source='web' AND request_visibility='open' AND request_observation_id::text=(:'pr'::jsonb)->>'request_observation_id' AND status='pending'
   AND description IS NULL AND organization_id IS NULL FROM work_orders WHERE id=:'pwo')
 AND (SELECT count(*) FROM work_order_line_items WHERE work_order_id=:'pwo' AND notes='Client-stated in the work request' AND basis_field='scope_description')=3,
 'work order: customer = signer, scope_description verbatim, operations sourced from the client''s text');
SELECT t_assert((:'pr'::jsonb)->'image_analyses_cited' @> '[{"observation_id":"e7c00000-0000-0000-0000-000000000001","analysis_kind":"image_deep_byok","extraction_method":"image_deep","confidence_score":0.6}]'
 AND (:'pr'::jsonb)#>'{suggested_cost}' @> '{"rate_label":"placeholder","hours_label":"seed_uncalibrated","currency":null,"rate":{"source":"spitball"}}'
 AND (:'pr'::jsonb)#>'{suggested_cost,lines}' @> '[{"line_number":1,"state":"estimated","hours":{"low":1.5,"high":1.5},"cost":{"low":240.0,"high":240.0}},
   {"line_number":2,"state":"estimated","hours":{"low":4,"high":4}},{"line_number":3,"state":"estimated","hours":{"low":3,"high":3}}]'
 AND (:'pr'::jsonb)#>'{suggested_cost,total}' @> '{"low":1360.0,"high":1360.0,"lines_estimated":3}',
 'existing analysis cited with method and confidence; suggested cost = reference hours x rate as returned, labelled');

-- Visitors see the open job and its requirements; nothing personal.
SET ROLE anon;
SELECT g_anon();
SELECT open_requirements_read(NULL,100,NULL) AS o1 \gset
SELECT work_order_job_path_read(:'pwo') AS j1 \gset
SELECT work_order_evidence_read(:'pwo') AS e1 \gset
RESET ROLE;
SELECT t_assert((SELECT count(*) FROM jsonb_array_elements((:'o1'::jsonb)->'rows') r WHERE r->>'work_order_id'=:'pwo')=5
 AND (:'j1'::jsonb)#>>'{stages,intake,state}'='recorded' AND ((:'j1'::jsonb)#>>'{stages,plan,requirements}')::int=5
 AND (:'j1'::jsonb)#>'{stages,execution,attached_evidence}' @> '{"images":1}' AND (:'j1'::jsonb)#>>'{stages,execution,state}' IN ('absent','partial')
 AND NOT g_pii(:'o1'::jsonb) AND NOT g_pii(:'j1'::jsonb) AND NOT g_pii(:'e1'::jsonb),
 'visitor: requirements listed in open_requirements_read; job path intake recorded; no PII');

-- Invite-only and private vehicles stay out of the open list; the iOS SDK header records ios.
SET ROLE authenticated;
SELECT t_as('e7000000-0000-0000-0000-0000000000c1');
SELECT set_config('request.headers','{"x-client-info":"supabase-swift/2.5.1"}',false);
SELECT p_post('e7300000-0000-0000-0000-000000000003','Detail the interior and clean the seats.',NULL,'[{"text":"Detail the interior","task_type":"clean"}]',NULL,'invite_only') AS pr2 \gset
SELECT set_config('request.headers','',false);
SELECT p_post('e7300000-0000-0000-0000-000000000004','Replace the soft top.') AS pr3 \gset
SELECT t_as('e7000000-0000-0000-0000-0000000000a1');
SELECT open_requirements_read(NULL,100,NULL) AS o2 \gset
RESET ROLE;
SELECT t_assert((:'pr2'::jsonb) @> '{"request_source":"ios","visibility":"invite_only","listed_in_open_requirements":false,"listing_basis":"invite_only",
   "operations":[{"text":"Detail the interior","task_type":"clean","keyword_entry_ids":[]}],
   "requirements":[{"kind":"skill","description":"Detail the interior","basis":"client_description"}]}'
 AND (:'pr2'::jsonb)#>'{suggested_cost,lines,0}' @> '{"state":"no_reference_match","cost":null}' AND (:'pr2'::jsonb)#>'{suggested_cost,total}'='null'::jsonb,
 'invite_only from iOS: one skill requirement in the client''s words; no reference match, no cost');
SELECT t_assert((:'pr3'::jsonb) @> '{"listed_in_open_requirements":false,"listing_basis":"vehicle_not_public"}'
 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements((:'o2'::jsonb)->'rows') r WHERE r->>'work_order_id' IN ((:'pr2'::jsonb)->>'work_order_id',(:'pr3'::jsonb)->>'work_order_id'))
 AND EXISTS (SELECT 1 FROM jsonb_array_elements((:'o2'::jsonb)->'rows') r WHERE r->>'work_order_id'=:'pwo' AND r->'match' IS NOT NULL),
 'signed-in provider: invite_only and private-vehicle requests are not listed; the open one is, with a match table');
SET ROLE anon;
SELECT g_anon();
SELECT t_assert(t_refused(format('SELECT work_order_job_path_read(%L)',(:'pr3'::jsonb)->>'work_order_id'))
  AND work_order_job_path_read(((:'pr2'::jsonb)->>'work_order_id')::uuid) IS NOT NULL,'a private vehicle''s job stays private; invite_only on a public vehicle is still an open job record');
RESET ROLE;

-- Visibility and the creating Sign are fixed.
SELECT t_assert(t_refused_with(format($q$UPDATE work_orders SET request_visibility='open' WHERE id=%L$q$,(:'pr2'::jsonb)->>'work_order_id'),'immutable')
 AND t_refused_with($q$INSERT INTO work_orders(id,vehicle_id,customer_id,status,request_visibility) VALUES (gen_random_uuid(),'e7300000-0000-0000-0000-000000000003','e7000000-0000-0000-0000-0000000000c1','pending','open')$q$,'work request Sign'),
 'request_visibility only with the work request Sign; immutable');
SELECT t_assert(has_function_privilege('authenticated','post_work_request(uuid,text,uuid[],jsonb,timestamptz,text)','EXECUTE')
 AND NOT has_function_privilege('anon','post_work_request(uuid,text,uuid[],jsonb,timestamptz,text)','EXECUTE')
 AND NOT has_function_privilege('service_role','post_work_request(uuid,text,uuid[],jsonb,timestamptz,text)','EXECUTE')
 AND NOT has_function_privilege('authenticated','work_request_requirement_template()','EXECUTE'),'grants: Sign authenticated only; template internal');
SELECT jsonb_agg(jsonb_build_object('proname',proname,'hash',md5(pg_get_functiondef(oid))) ORDER BY proname) AS implementation_hashes
 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('post_work_request','work_request_requirement_template','work_order_link_guard','open_requirements_read');
