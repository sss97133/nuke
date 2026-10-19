-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations (chained on the job-loop replay).
-- Reviewed requirement keywords (20261020120000): capability keys for real requirement texts, whole words only, additive.
\ir test_job_loop_replay.sql

ALTER TABLE work_order_line_items DROP CONSTRAINT work_order_line_items_task_type_check;
INSERT INTO work_order_line_items(id,work_order_id,line_number,task_type,task_description,status,component_table) VALUES
 ('51000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'other','recover seats','pending',NULL),
 ('51000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001',2,'replace','Install Fuelab electric fuel pump (customer supplied)','pending',NULL),
 ('51000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001',3,'fabricate','Headers','pending','engine_exhaust_manifolds');
CREATE FUNCTION pg_temp.keys(p_desc text, p_line text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS
  $$ SELECT public.requirement_capability_keys(jsonb_build_object('description', p_desc, 'line_item_id', p_line), NULL) $$;

SELECT t_assert(pg_temp.keys('Oil change (Shell Rotella T6 5W-40)') = '[{"key":"general_maintenance","from":"reviewed_keyword"}]'
 AND pg_temp.keys('Spark plug replacement (AC Delco R45TS x8)') = '[{"key":"general_maintenance","from":"reviewed_keyword"}]'
 AND pg_temp.keys('AC V belt replacement') = '[{"key":"general_maintenance","from":"reviewed_keyword"}]'
 AND pg_temp.keys('Wire wheel/clean collector flanges') = '[{"key":"exhaust_system","from":"reviewed_keyword"}]'
 AND pg_temp.keys('Intake manifold gasket (Fel-Pro 1205)') = '[{"key":"intake_system","from":"reviewed_keyword"}]'
 AND pg_temp.keys('Chrome window locking strip (front/rear)') = '[{"key":"glass_installation","from":"reviewed_keyword"}]'
 AND pg_temp.keys('i need the back seat finished and installed') = '[{"key":"upholstery_repair","from":"reviewed_keyword"}]',
 'real texts get the reviewed capability (whole words, punctuation as spaces, plural last word)');
SELECT t_assert(pg_temp.keys('x', '51000000-0000-0000-0000-000000000001') = '[{"key":"upholstery_full","from":"reviewed_keyword"}]'
 AND pg_temp.keys('Fuel', '51000000-0000-0000-0000-000000000002') = '[{"key":"fuel_system","from":"reviewed_keyword"}]',
 'the operation text is read as well as the requirement description');
SELECT t_assert(pg_temp.keys('recovered seats') = '[]' AND pg_temp.keys('boil filter') = '[]' AND pg_temp.keys('oil filtration') = '[]'
 AND pg_temp.keys('Idler arm replacement') = '[]' AND pg_temp.keys('Tailgate fancy trim piece + GMC emblem') = '[]'
 AND pg_temp.keys('Front end alignment') = '[]' AND pg_temp.keys(NULL) = '[]',
 'no partial-word matches; steering, alignment and trim stay without keys');
SELECT t_assert(pg_temp.keys('Exhaust repair and fabrication', '51000000-0000-0000-0000-000000000003')
   = '[{"key":"exhaust_system","from":"reviewed_template"},{"key":"fabrication_exhaust","from":"operation"},{"key":"fabrication_exhaust","from":"reviewed_template"}]'
 AND pg_temp.keys('Rust repair and panel welding') = '[{"key":"rust_repair","from":"reviewed_template"},{"key":"welding_mig","from":"reviewed_template"}]',
 'template and operation keys are unchanged (additive)');
SELECT t_assert((SELECT count(*) FROM capability_evidence_map WHERE kind = 'requirement_keyword') = 21
 AND NOT EXISTS (SELECT 1 FROM capability_evidence_map WHERE kind = 'requirement_keyword' AND (note IS NULL OR source_key !~ '^[a-z]+(_[a-z]+)*:[a-z_]+$'
   OR split_part(source_key, ':', 2) <> capability_type)),
 'every keyword row is <phrase>:<capability> and names the text it was added for');
