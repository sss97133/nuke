-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations (chained on the job-loop replay).
-- 20261020100000 job-loop read speedups are output-identical: the previous user_tool_keys and requirement_capability_keys
-- bodies (recreated here under old_ names from 20261020030000 / 20261020060000) give the same rows as the new ones on varied
-- fixtures, and work_order_provider_matches_read enriches each requirement once.
\ir test_job_loop_replay.sql

CREATE FUNCTION public.old_user_tool_keys(p_user uuid)
RETURNS TABLE(requirement_key text, tool_source text, tool_id uuid, via text, matched text)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT k.requirement_key, 'user_tools', t.id, k.via, k.matched
  FROM public.user_tools t
  LEFT JOIN public.tool_catalog c ON c.id = t.catalog_id
  LEFT JOIN public.tool_categories tc ON tc.id = c.category_id,
  LATERAL (SELECT * FROM public.tool_text_keys(t.category, concat_ws(' ', t.description, c.name, c.description))
    UNION SELECT * FROM public.tool_text_keys(tc.name, NULL)) k
  WHERE t.user_id = p_user
  UNION
  SELECT k.requirement_key, 'tool_inventory', i.id, k.via, k.matched
  FROM public.tool_inventory i, LATERAL public.tool_text_keys(i.category, concat_ws(' ', i.name, i.brand, i.model)) k
  WHERE i.owner_id = p_user AND COALESCE(i.status, 'active') NOT IN ('sold','lost','retired','disposed')
$$;
CREATE FUNCTION public.old_requirement_capability_keys(p_requirement jsonb, p_specifications jsonb) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', k, 'from', f) ORDER BY k, f), '[]'::jsonb)
  FROM (
    SELECT DISTINCT m.capability_type AS k, 'reviewed_template' AS f FROM public.capability_evidence_map m
      WHERE m.kind = 'requirement_template' AND split_part(m.source_key, ':', 1) = public.capability_template_slug(p_requirement->>'description')
    UNION
    SELECT DISTINCT cp.capability_type, 'requested_specification' FROM jsonb_array_elements(COALESCE(p_specifications, '[]'::jsonb)) sp,
      LATERAL public.capability_map_process(sp->>'process_key') cp
      WHERE sp->>'specification_stage' = 'requested' AND sp->>'process_key' IS NOT NULL
        AND (sp->>'line_item_id' IS NULL OR sp->>'line_item_id' = p_requirement->>'line_item_id')
    UNION
    SELECT DISTINCT co.capability_type, 'operation' FROM public.work_order_line_items li,
      LATERAL public.capability_map_operation(li.task_type, li.component_table) co
      WHERE li.id = (p_requirement->>'line_item_id')::uuid AND co.capability_type IS NOT NULL
  ) t
$$;

INSERT INTO tool_categories VALUES ('a1000000-0000-0000-0000-000000000001','Power Tools'),('a1000000-0000-0000-0000-000000000002','Diagnostic Equipment');
INSERT INTO tool_catalog VALUES ('a2000000-0000-0000-0000-000000000001','Multimatic 220','Multi-process MIG welder and TIG torch','a1000000-0000-0000-0000-000000000001'),
 ('a2000000-0000-0000-0000-000000000002','Scanner X','OBD2 scanner','a1000000-0000-0000-0000-000000000002');
INSERT INTO user_tools(id,user_id,category,description,catalog_id) VALUES
 ('a3000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000f','Professional Tools','Miller unit','a2000000-0000-0000-0000-000000000001'),
 ('a3000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-00000000000f','Air Tools','1/2 impact wrench (cordless)',NULL),
 ('a3000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-00000000000f',' Power Tools ','Angle grinder; plasma cutter.',NULL),
 ('a3000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-00000000000b','Sockets & Ratchets','3/8 socket set','a2000000-0000-0000-0000-000000000002'),
 ('a3000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-00000000000b',NULL,NULL,NULL),
 ('a3000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-00000000000d','lift','2-post lift and a floor jack',NULL);
INSERT INTO tool_inventory(id,owner_id,name,brand,model,category,status) VALUES
 ('a4000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000009','Back-purge kit',NULL,NULL,'specialty','active'),
 ('a4000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000009','Floor jack','Pittsburgh',NULL,'lift',NULL),
 ('a4000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000009','TIG welder','Lincoln','Square Wave','power_tool','sold'),
 ('a4000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-00000000000f','Oxy-acetylene torch set',NULL,NULL,'Hand Tools','active');
CREATE TEMP TABLE utk_cmp AS
SELECT u.id AS uid,
  (SELECT count(*) FROM ((SELECT * FROM old_user_tool_keys(u.id) EXCEPT ALL SELECT * FROM user_tool_keys(u.id))
     UNION ALL (SELECT * FROM user_tool_keys(u.id) EXCEPT ALL SELECT * FROM old_user_tool_keys(u.id))) d) AS diff,
  (SELECT count(*) FROM user_tool_keys(u.id)) AS n
FROM auth.users u;
SELECT t_assert((SELECT sum(diff) FROM utk_cmp) = 0 AND (SELECT sum(n) FROM utk_cmp) >= 12
 AND (SELECT count(*) FROM utk_cmp WHERE n > 0) = 4,
 'user_tool_keys: same rows as the previous body for every fixture user (categories, catalog, terms with hyphens, sold inventory)');

INSERT INTO work_order_line_items(id,work_order_id,line_number,task_type,task_description,status,component_table) VALUES
 ('51000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'replace','Headers','pending','engine_exhaust_manifolds'),
 ('51000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001',2,'inspect','Look','pending',NULL);
SELECT t_assert(NOT EXISTS (
   SELECT 1 FROM (VALUES
     ('{"description":"Exhaust repair and fabrication","line_item_id":"51000000-0000-0000-0000-000000000001"}'::jsonb,
      '[{"specification_stage":"requested","line_item_id":"51000000-0000-0000-0000-000000000001","process_key":"welding.tig"}]'::jsonb),
     ('{"description":"Rust repair and panel welding"}', NULL),
     ('{"description":"Diagnose the engine condition before repair","line_item_id":"51000000-0000-0000-0000-000000000002"}', '[]'),
     ('{"description":"  automotive   PAINT refinishing!"}', '[{"specification_stage":"requested","process_key":"paint.refinish"}]'),
     ('{"description":null}', NULL)) v(q, s)
   WHERE old_requirement_capability_keys(v.q, v.s) IS DISTINCT FROM requirement_capability_keys(v.q, v.s)),
 'requirement_capability_keys: same keys as the previous body (template slug, requested process, operation)');
SELECT t_assert(position('reqs AS MATERIALIZED' IN pg_get_functiondef('work_order_provider_matches_read(uuid,integer)'::regprocedure)) > 0
 AND position('LATERAL (SELECT q0 ||' IN pg_get_functiondef('work_order_provider_matches_read(uuid,integer)'::regprocedure)) = 0
 AND position('(SELECT public.capability_template_slug(' IN pg_get_functiondef('requirement_capability_keys(jsonb,jsonb)'::regprocedure)) > 0,
 'matches reader enriches requirements once; capability keys compute the slug once');
