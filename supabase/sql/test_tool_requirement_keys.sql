-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations (chained on the job-loop replay).
-- Tool <-> requirement join key: reviewed key map, requirement keys, claimed tool keys, and open_requirements_read's tools input.
\ir test_job_loop_replay.sql

CREATE FUNCTION public.as_user(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.auth_uid',COALESCE(p::text,''),false) $$;
GRANT EXECUTE ON FUNCTION public.as_user(uuid) TO anon, authenticated, service_role;
-- Live columns open_requirements_read reads that the replay fixture omits.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS city text, ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_public boolean, ADD COLUMN IF NOT EXISTS city text, ADD COLUMN IF NOT EXISTS state text;
UPDATE vehicles SET is_public = true WHERE id = '40000000-0000-0000-0000-000000000001';
ALTER TABLE work_order_line_items DROP CONSTRAINT work_order_line_items_task_type_check;
INSERT INTO work_order_line_items(id,work_order_id,line_number,task_type,task_description,status) VALUES
 ('51000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'fabricate','Patch rocker','pending');
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,extraction_method,structured_data) VALUES
 ('55000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001','2026-03-02','requirement_interpretation_v1',
  jsonb_build_object('work_order_resource',jsonb_build_object('version',1,'event_type','requirement','work_order_id','30000000-0000-0000-0000-000000000001',
   'line_item_id','51000000-0000-0000-0000-000000000001','requirement_kind','tool','description','MIG welder','quantity',1,'unit','unit')));
SET ROLE service_role;
SELECT project_work_order_resource_observation('55000000-0000-0000-0000-000000000001');
RESET ROLE;
-- 0f claims a MIG welder; 0b a socket set; 09 a back-purge kit (inventory); 0e owns the shop where a MIG welder is seen in photos.
INSERT INTO tool_categories VALUES ('a1000000-0000-0000-0000-000000000001','Power Tools');
INSERT INTO tool_catalog VALUES ('a2000000-0000-0000-0000-000000000001','Multimatic 220','Multi-process MIG welder','a1000000-0000-0000-0000-000000000001');
INSERT INTO user_tools(id,user_id,category,description,catalog_id) VALUES
 ('a3000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000f','Professional Tools','Miller unit','a2000000-0000-0000-0000-000000000001'),
 ('a3000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000b','Sockets & Ratchets','3/8 socket set',NULL);
INSERT INTO tool_inventory(id,owner_id,name,category,status) VALUES
 ('a4000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000009','Back purge kit','specialty','active'),
 ('a4000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000009','Floor jack','lift','active');
INSERT INTO equipment(id,shop_id,name,category,source) VALUES
 ('a5000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','MIG welder','power_tool','photo_evidence_inferred');
INSERT INTO equipment_usage_evidence(equipment_id,derived_from_image_id) VALUES
 ('a5000000-0000-0000-0000-000000000001',gen_random_uuid()),('a5000000-0000-0000-0000-000000000001',gen_random_uuid());
CREATE FUNCTION public.ti() RETURNS jsonb LANGUAGE sql AS $$
  SELECT m FROM jsonb_array_elements(open_requirements_read(NULL,100,'tool')->'rows') r, jsonb_array_elements(r->'match') m
  WHERE r->>'requirement_id' = '55000000-0000-0000-0000-000000000001' AND m->>'input' = 'tools' $$;
CREATE FUNCTION public.tk() RETURNS jsonb LANGUAGE sql AS $$
  SELECT r->'tool_keys' FROM jsonb_array_elements(open_requirements_read(NULL,100,'tool')->'rows') r
  WHERE r->>'requirement_id' = '55000000-0000-0000-0000-000000000001' $$;
GRANT EXECUTE ON FUNCTION public.ti(), public.tk() TO anon, authenticated;

SELECT t_assert(tool_key_satisfies('welding.tig','welding') AND tool_key_satisfies('welding.tig','welding.tig')
 AND NOT tool_key_satisfies('welding','welding.tig') AND NOT tool_key_satisfies('equipment.lift','equipment.lift.vehicle')
 AND NOT tool_key_satisfies('welding.tigx','welding.tig'),'a finer key satisfies a coarser one, never the reverse or a sibling prefix');
SELECT t_assert(requirement_tool_keys('{"description":"MIG welder","line_item_id":"51000000-0000-0000-0000-000000000001"}',
   '[{"specification_stage":"requested","line_item_id":"51000000-0000-0000-0000-000000000001","material_key":"stainless_steel.304","process_key":"welding.tig"},
     {"specification_stage":"reported_performed","line_item_id":"51000000-0000-0000-0000-000000000001","process_key":"welding.stick"},
     {"specification_stage":"requested","line_item_id":"51000000-0000-0000-0000-000000000099","process_key":"welding.gas"}]')
 = '[{"key":"stainless_steel.304","from":"requested_specification"},{"key":"welding.mig","from":"reviewed_template"},{"key":"welding.tig","from":"requested_specification"}]'::jsonb,
 'requirement keys: reviewed template plus the requested specs of its own operation only');
SELECT t_assert((SELECT array_agg(DISTINCT requirement_key ORDER BY requirement_key) FROM user_tool_keys('10000000-0000-0000-0000-000000000009'))
   = ARRAY['equipment.lift','equipment.lift.floor_jack','stainless_steel.304','welding.tig']
 AND (SELECT array_agg(DISTINCT requirement_key ORDER BY requirement_key) FROM user_tool_keys('10000000-0000-0000-0000-00000000000f'))
   = ARRAY['tool.power','welding.mig'],
 'claimed tool keys: back-purge kit -> welding.tig + stainless_steel.304; floor jack -> lift keys; catalog MIG welder -> welding.mig + its category');

SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT ti() AS f \gset
SELECT tk() AS keys \gset
SELECT as_user('10000000-0000-0000-0000-00000000000b');
SELECT ti() AS b \gset
SELECT as_user('10000000-0000-0000-0000-00000000000e');
SELECT ti() AS e \gset
SELECT as_user('10000000-0000-0000-0000-00000000000d');
SELECT ti() AS d \gset
RESET ROLE;
SELECT t_assert((:'keys'::jsonb) = '[{"key":"welding.mig","from":"reviewed_template"}]','open row carries the normalized tool keys');
SELECT t_assert((:'f'::jsonb) @> '{"input":"tools","result":"pass","basis":"reviewed_tool_key_map","matched_keys":["welding.mig"],"requirement_keys":["welding.mig"]}'
 AND (:'f'::jsonb)->>'reason' LIKE '%claimed ownership, not physical verification%','claimed MIG welder (via its catalog entry) passes the MIG welder requirement');
SELECT t_assert((:'b'::jsonb) @> '{"result":"fail","next":"plan_b_supplier_needed","reason":"no claimed tool maps to welding.mig"}','socket set: plan B');
SELECT t_assert((:'e'::jsonb) @> '{"result":"unknown","next":"claim_tool_record","basis":"photo_corroboration_only",
   "corroboration":[{"key":"welding.mig","equipment":"MIG welder","photo_occurrences":2}]}','shop owner: MIG welder seen in shop photos only -> unknown, claim it');
SELECT t_assert((:'d'::jsonb) @> '{"result":"fail","next":"plan_b_supplier_needed","reason":"no claimed tool records"}','no tools: plan B');
SELECT t_assert(NOT has_function_privilege('authenticated','user_tool_keys(uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','open_requirement_tools_input(uuid,text,jsonb,text)','EXECUTE')
 AND has_table_privilege('anon','tool_requirement_key_map','SELECT') AND NOT has_table_privilege('authenticated','tool_requirement_key_map','INSERT')
 AND position('open_requirement_tools_input' IN pg_get_functiondef('open_requirements_read(uuid,integer,text)'::regprocedure)) > 0
 AND position('no claimed tool record names this requirement'' END) END' IN pg_get_functiondef('open_requirements_read(uuid,integer,text)'::regprocedure)) = 0,
 'helpers internal; key map readable, not writable; the tools input is the helper');
