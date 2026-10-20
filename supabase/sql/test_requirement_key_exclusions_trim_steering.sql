-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations (chained on the job-loop replay).
-- 20261020130000: fastener-context exclusion for the rust_body templates (keys and keyword table), and the
-- steering_suspension_alignment / trim_installation capability types with their reviewed keyword rows.
\ir test_job_loop_replay.sql

ALTER TABLE work_order_line_items DROP CONSTRAINT work_order_line_items_task_type_check;
INSERT INTO work_order_line_items(id,work_order_id,line_number,task_type,task_description,status) VALUES
 ('51000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'replace','Replace corroded header bolts (stainless kit)','pending'),
 ('51000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001',2,'other','Rust repair','pending'),
 ('51000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001',3,'replace','Idler arm replacement','pending');
CREATE FUNCTION pg_temp.ck(p_desc text, p_line text) RETURNS jsonb LANGUAGE sql AS
  $$ SELECT public.requirement_capability_keys(jsonb_build_object('description', p_desc, 'line_item_id', p_line), NULL) $$;
CREATE FUNCTION pg_temp.tk(p_desc text, p_line text) RETURNS jsonb LANGUAGE sql AS
  $$ SELECT public.requirement_tool_keys(jsonb_build_object('description', p_desc, 'line_item_id', p_line), NULL) $$;

SELECT t_assert(pg_temp.ck('Rust repair and panel welding', '51000000-0000-0000-0000-000000000001') = '[]'
 AND pg_temp.tk('MIG welder', '51000000-0000-0000-0000-000000000001') = '[]'
 AND pg_temp.tk('Body shop bay', '51000000-0000-0000-0000-000000000001') = '[]',
 'corroded header bolts: no rust_body template keys (capability or tool), and since 20261020183000 no keys from the operation either');
SELECT t_assert(pg_temp.ck('Rust repair and panel welding', '51000000-0000-0000-0000-000000000002') = '[{"key":"rust_repair","from":"reviewed_template"},{"key":"welding_mig","from":"reviewed_template"}]'
 AND pg_temp.tk('MIG welder', '51000000-0000-0000-0000-000000000002') = '[{"key":"welding.mig","from":"reviewed_template"}]',
 'real rust repair keeps its template keys');
SELECT t_assert((SELECT bool_and(CASE WHEN x.t = 'Replace corroded header bolts (stainless kit)' OR x.t = 'rusted wheel studs' OR x.t = 'Corroded nuts on the manifold'
      THEN x.t ~* listing_plan_re(e->>'exclude') ELSE NOT x.t ~* listing_plan_re(e->>'exclude') END)
   FROM jsonb_array_elements(listing_plan_keyword_table()->'entries') e,
     (VALUES ('Replace corroded header bolts (stainless kit)'), ('rusted wheel studs'), ('Corroded nuts on the manifold'),
       ('Rust repair'), ('rust on the rockers'), ('corroded floor pan')) x(t)
   WHERE e->>'id' = 'rust_body'),
 'keyword table: rust_body excludes a corroded or rusted fastener, not body rust');
SELECT t_assert(pg_temp.ck('Idler arm replacement', '51000000-0000-0000-0000-000000000003') = '[{"key":"steering_suspension_alignment","from":"reviewed_keyword"}]'
 AND pg_temp.ck('Front end alignment', NULL) = '[{"key":"steering_suspension_alignment","from":"reviewed_keyword"}]'
 AND pg_temp.ck('2WD steering box upgrade', NULL) = '[{"key":"steering_suspension_alignment","from":"reviewed_keyword"}]'
 AND pg_temp.ck('Tailgate fancy trim piece + GMC emblem', NULL) = '[{"key":"trim_installation","from":"reviewed_keyword"}]'
 AND pg_temp.ck('Fresh air vent seal replacement', NULL) = '[{"key":"trim_installation","from":"reviewed_keyword"}]',
 'steering, alignment and trim texts get the new reviewed types');
SELECT t_assert(t_refused($q$INSERT INTO actor_capabilities(actor_id,capability_type,evidence_count,complexity_tier) VALUES ('60000000-0000-0000-0000-000000000001','made_up_type',1,'basic')$q$),
 'the capability vocabulary still refuses unknown types');
INSERT INTO actor_capabilities(actor_id,capability_type,evidence_count,derivation,strength,direct_count,corroborating_count,against_count,folded_at) VALUES
 ('60000000-0000-0000-0000-000000000001','steering_suspension_alignment',2,'evidence_fold','corroborating',0,2,0,now()),
 ('60000000-0000-0000-0000-000000000002','trim_installation',1,'evidence_fold','direct',1,0,0,now());
SELECT t_assert(open_requirement_skill_input(NULL, '{"evidenced_actor_ids":["60000000-0000-0000-0000-000000000001"]}', 'skill',
   pg_temp.ck('Idler arm replacement', '51000000-0000-0000-0000-000000000003'), 'idler arm replacement')
   @> '{"result":"pass","basis":"evidence_fold","matched_capabilities":[{"capability":"steering_suspension_alignment","corroborating":2}]}'
 AND open_requirement_skill_input(NULL, '{"evidenced_actor_ids":["60000000-0000-0000-0000-000000000002"]}', 'skill',
   pg_temp.ck('Rear window molding (GMC)', NULL), 'x') @> '{"result":"pass","matched_capabilities":[{"capability":"trim_installation","strength":"direct"}]}',
 'actor_capabilities accepts the new types and the skill input passes on them');
SELECT t_assert((SELECT count(*) FROM requirement_template_exclusions) = 15
 AND (SELECT count(*) FROM capability_evidence_map WHERE kind = 'requirement_keyword' AND capability_type IN ('steering_suspension_alignment','trim_installation')) = 10
 AND NOT has_function_privilege('anon','requirement_template_excluded(jsonb)','EXECUTE')
 AND has_table_privilege('anon','requirement_template_exclusions','SELECT') AND NOT has_table_privilege('authenticated','requirement_template_exclusions','INSERT'),
 'reviewed rows present; exclusion data readable, not writable; helper internal');
