-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations (chained on the job-loop replay).
-- Requirement capability keys and the skill input (open_requirements_read and work_order_provider_matches_read).
\ir test_job_loop_replay.sql

CREATE FUNCTION public.as_user(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.auth_uid',COALESCE(p::text,''),false) $$;
GRANT EXECUTE ON FUNCTION public.as_user(uuid) TO anon, authenticated, service_role;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS city text, ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_public boolean, ADD COLUMN IF NOT EXISTS city text, ADD COLUMN IF NOT EXISTS state text;
UPDATE vehicles SET is_public = true, city = 'Reno', state = 'NV' WHERE id = '40000000-0000-0000-0000-000000000001';
ALTER TABLE work_order_line_items DROP CONSTRAINT work_order_line_items_task_type_check;
INSERT INTO work_order_line_items(id,work_order_id,line_number,task_type,task_description,status,component_table) VALUES
 ('51000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'fabricate','Headers','pending','engine_exhaust_manifolds');
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,structured_data) VALUES
 ('55000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001','2026-03-02','requirement_interpretation_v1',
  jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','requirement','work_order_id','30000000-0000-0000-0000-000000000001',
   'line_item_id','51000000-0000-0000-0000-000000000001','requirement_kind','skill','description','Exhaust repair and fabrication','quantity',NULL,'unit',NULL)));
SET ROLE service_role;
SELECT project_work_order_resource_observation('55000000-0000-0000-0000-000000000001');
RESET ROLE;
-- 0f: evidenced actor 60..01 with folded exhaust fabrication (corroborating 2, against 1).
-- 0d: evidenced actor 60..02 with only evidence against exhaust_system and a hand-entered fabrication_exhaust row.
-- 09: no link; the profile states exhaust fabrication.
INSERT INTO account_link_claims(id,user_id,platform,handle,actor_id,status,verification_method) VALUES
 ('c1000000-0000-0000-0000-0000000000f1','10000000-0000-0000-0000-00000000000f','nuke_actor','60000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','pending','self_claim'),
 ('c1000000-0000-0000-0000-0000000000d1','10000000-0000-0000-0000-00000000000d','nuke_actor','60000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000002','pending','self_claim');
INSERT INTO work_sessions(id,user_id,vehicle_id,session_date) VALUES
 ('61000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000f','40000000-0000-0000-0000-000000000001','2026-03-01'),
 ('61000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000d','40000000-0000-0000-0000-000000000001','2026-03-01');
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false);
SELECT approve_actor_link_claim('c1000000-0000-0000-0000-0000000000f1', 'work_evidence', '[{"kind":"work_session","id":"61000000-0000-0000-0000-000000000001"}]', '10000000-0000-0000-0000-00000000000a');
SELECT approve_actor_link_claim('c1000000-0000-0000-0000-0000000000d1', 'work_evidence', '[{"kind":"work_session","id":"61000000-0000-0000-0000-000000000002"}]', '10000000-0000-0000-0000-00000000000a');
SELECT set_config('request.jwt.claims', '', false);
RESET ROLE;
DELETE FROM actor_capabilities WHERE actor_id IN ('60000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000002');
INSERT INTO actor_capabilities(actor_id,capability_type,evidence_count,derivation,strength,direct_count,corroborating_count,against_count,folded_at,complexity_tier) VALUES
 ('60000000-0000-0000-0000-000000000001','fabrication_exhaust',3,'evidence_fold','corroborating',0,2,1,now(),NULL),
 ('60000000-0000-0000-0000-000000000002','exhaust_system',2,'evidence_fold','corroborating',0,0,2,now(),NULL),
 ('60000000-0000-0000-0000-000000000002','fabrication_exhaust',1,'legacy_hand_entered',NULL,NULL,NULL,NULL,NULL,'basic');
INSERT INTO profiles(id, username, is_public, expertise_areas) VALUES ('10000000-0000-0000-0000-000000000009','stated_fab',true,ARRAY['Exhaust fabrication'])
 ON CONFLICT (id) DO UPDATE SET expertise_areas = EXCLUDED.expertise_areas;
CREATE FUNCTION public.sk() RETURNS jsonb LANGUAGE sql AS $$
  SELECT m FROM jsonb_array_elements(open_requirements_read(NULL,100,NULL)->'rows') r, jsonb_array_elements(r->'match') m
  WHERE r->>'requirement_id' = '55000000-0000-0000-0000-000000000001' AND m->>'input' = 'skill' $$;
CREATE FUNCTION public.ck() RETURNS jsonb LANGUAGE sql AS $$
  SELECT r->'capability_keys' FROM jsonb_array_elements(open_requirements_read(NULL,100,NULL)->'rows') r
  WHERE r->>'requirement_id' = '55000000-0000-0000-0000-000000000001' $$;
GRANT EXECUTE ON FUNCTION public.sk(), public.ck() TO anon, authenticated;

SELECT t_assert(requirement_capability_keys('{"description":"TIG weld the exhaust","line_item_id":"51000000-0000-0000-0000-000000000001"}',
   '[{"specification_stage":"requested","line_item_id":"51000000-0000-0000-0000-000000000001","material_key":"stainless_steel.304","process_key":"welding.tig"},
     {"specification_stage":"reported_performed","line_item_id":"51000000-0000-0000-0000-000000000001","process_key":"welding.mig"},
     {"specification_stage":"requested","line_item_id":"51000000-0000-0000-0000-000000000099","process_key":"welding.gas"}]')
 = '[{"key":"fabrication_exhaust","from":"operation"},{"key":"welding_tig","from":"requested_specification"}]'::jsonb
 AND requirement_capability_keys('{"description":"Rust repair and panel welding"}', NULL)
   = '[{"key":"rust_repair","from":"reviewed_template"},{"key":"welding_mig","from":"reviewed_template"}]'::jsonb,
 'capability keys: requested process of its own operation, operation task x system, reviewed template (one row per capability)');
SELECT t_assert(open_requirement_skill_input('10000000-0000-0000-0000-00000000000d', viewer_identity_bridge('10000000-0000-0000-0000-00000000000d'), 'skill',
   '[{"key":"fabrication_exhaust"}]', 'x') @> '{"result":"unknown","basis":"hand_entered_without_basis"}'
 AND open_requirement_skill_input('10000000-0000-0000-0000-00000000000f', viewer_identity_bridge('10000000-0000-0000-0000-00000000000f'), 'skill',
   '[]', 'needs fabrication_exhaust work') @> '{"result":"pass","basis":"requirement_text_names_capability"}'
 AND open_requirement_skill_input('10000000-0000-0000-0000-00000000000f', '{}', 'tool', '[]', 'x') @> '{"result":"pass","reason":"not required for a tool requirement"}',
 'hand-entered-only is unknown; a requirement without keys keeps the text rule; non-skill kinds unchanged');

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT sk() AS f \gset
SELECT ck() AS keys \gset
SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT sk() AS d \gset
SELECT as_user('10000000-0000-0000-0000-000000000009');
SELECT sk() AS n \gset
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT sk() AS b \gset
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT work_order_provider_matches_read('30000000-0000-0000-0000-000000000001') AS pm \gset
RESET ROLE;
SELECT t_assert((:'keys'::jsonb) @> '[{"key":"fabrication_exhaust","from":"reviewed_template"},{"key":"fabrication_exhaust","from":"operation"},{"key":"exhaust_system","from":"reviewed_template"}]'
 AND jsonb_array_length(:'keys'::jsonb) BETWEEN 3 AND 4,
 'open row carries capability_keys from the template and the operation');
SELECT t_assert((:'f'::jsonb) @> '{"input":"skill","result":"pass","basis":"evidence_fold","matched_capabilities":[{"capability":"fabrication_exhaust","strength":"corroborating","corroborating":2,"against":1}],
   "cautions":[{"kind":"against_evidence","capability":"fabrication_exhaust","against":1}]}'
 AND (:'f'::jsonb)->>'reason' LIKE '%with evidence against fabrication_exhaust%','folded capability passes, and its against evidence is shown as a caution');
SELECT t_assert((:'d'::jsonb) @> '{"result":"unknown","basis":"evidence_fold_against_only","cautions":[{"capability":"exhaust_system","against":2}]}',
 'only evidence against: unknown with the caution, never a pass');
SELECT t_assert((:'n'::jsonb) @> '{"result":"unknown","basis":"stated_not_evidenced","stated_capabilities":["fabrication_exhaust"],"next":"claim_provider_link"}'
 AND (:'n'::jsonb)->>'reason' = 'stated, not evidenced: fabrication_exhaust','a self-described trade is stated, not evidenced');
SELECT t_assert((:'b'::jsonb) @> '{"result":"unknown","basis":"no_evidenced_identity_bridge","next":"claim_provider_link"}','no link, nothing stated: unknown');
SELECT t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements((:'pm'::jsonb)->'providers') p, jsonb_array_elements(p->'requirements') r, jsonb_array_elements(r->'inputs') i
   WHERE p->'listed_because' @> '["evidenced_link"]' AND r->'capability_keys' @> '[{"key":"fabrication_exhaust"}]'
     AND i @> '{"input":"skill","result":"pass","basis":"evidence_fold","cautions":[{"capability":"fabrication_exhaust"}]}')
 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements((:'pm'::jsonb)->'providers') p, jsonb_array_elements(p->'requirements') r, jsonb_array_elements(r->'inputs') i
   WHERE i->>'input' = 'skill' AND i->>'result' = 'pass' AND i->>'basis' IS DISTINCT FROM 'evidence_fold'),
 'job owner''s matches: the same skill answer with capability keys and cautions');
SELECT t_assert(NOT has_function_privilege('authenticated','open_requirement_skill_input(uuid,jsonb,text,jsonb,text)','EXECUTE')
 AND NOT has_function_privilege('anon','requirement_capability_keys(jsonb,jsonb)','EXECUTE')
 AND (SELECT count(*) FROM capability_evidence_map WHERE kind = 'requirement_template') = 14
 AND position('open_requirement_skill_input' IN pg_get_functiondef('open_requirements_read(uuid,integer,text)'::regprocedure)) > 0
 AND position('open_requirement_skill_input' IN pg_get_functiondef('provider_requirement_match(uuid,jsonb,jsonb,uuid,jsonb,uuid,jsonb,jsonb,jsonb)'::regprocedure)) > 0,
 'helpers internal; reviewed template rows in the fold map; both skill inputs use the helper');
