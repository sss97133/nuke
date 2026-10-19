-- Disposable PG17 only. Synthetic fixtures; exercises the actual migrations (chained on the job-loop replay).
-- Capability fold: derived actor_capabilities rows with basis ids from attributed evidence; direct vs corroborating;
-- requested-vs-performed conflict as evidence against; self-claims never count; legacy rows untouched; event-driven.
\ir test_job_loop_replay.sql

CREATE FUNCTION public.as_user(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.auth_uid',COALESCE(p::text,''),false) $$;
GRANT EXECUTE ON FUNCTION public.as_user(uuid) TO anon, authenticated, service_role;
CREATE FUNCTION public.caps(p_actor uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT COALESCE(jsonb_object_agg(capability_type, jsonb_build_object('n', evidence_count, 'strength', strength, 'direct', direct_count,
    'corroborating', corroborating_count, 'against', against_count, 'first', first_demonstrated, 'last', last_demonstrated, 'tier', complexity_tier)), '{}')
  FROM actor_capabilities WHERE actor_id = p_actor AND derivation = 'evidence_fold' $$;
ALTER TABLE work_order_line_items DROP CONSTRAINT work_order_line_items_task_type_check;
UPDATE vehicles SET is_public = true WHERE id IN ('40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002');
INSERT INTO account_link_claims(user_id,platform,handle,actor_id,status,verification_method) VALUES
 ('10000000-0000-0000-0000-00000000000f','nuke_actor','60000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','pending','self_claim'),
 ('10000000-0000-0000-0000-000000000009','nuke_actor','60000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','pending','self_claim');
INSERT INTO work_sessions(id,user_id,vehicle_id,session_date,duration_minutes,image_count) VALUES
 ('54000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000f','40000000-0000-0000-0000-000000000001','2026-03-15',240,6);
UPDATE account_link_claims SET status='approved', verification_method='work_evidence', reviewed_by_user_id='10000000-0000-0000-0000-00000000000a',
  reviewed_at='2026-03-18', rung_evidence = rung_evidence || jsonb_build_array(jsonb_build_object('rung','work_evidence',
    'evidence',jsonb_build_array(jsonb_build_object('kind','work_session','id','54000000-0000-0000-0000-000000000001')),
    'reviewer_user_id','10000000-0000-0000-0000-00000000000a','reviewed_at','2026-03-18T00:00:00+00:00'))
 WHERE user_id='10000000-0000-0000-0000-00000000000f';
INSERT INTO actor_capabilities(actor_id, capability_type, complexity_tier, evidence_count, first_demonstrated, last_demonstrated)
 VALUES ('60000000-0000-0000-0000-000000000001','welding_mig','basic',1,'2026-03-16','2026-03-16');
UPDATE profiles SET expertise_areas = ARRAY['welding','paint'] WHERE id = '10000000-0000-0000-0000-00000000000f';
INSERT INTO profiles(id,username,expertise_areas) VALUES ('10000000-0000-0000-0000-00000000000f','fab_pro',ARRAY['welding','paint'])
 ON CONFLICT (id) DO UPDATE SET expertise_areas = EXCLUDED.expertise_areas;

-- Operations performed by actor A (60..01) on WO1, attributed by component events; actor B (60..02) installs brake pads.
INSERT INTO work_order_line_items(id,work_order_id,line_number,task_type,task_description,actor_id,component_event_id,status) VALUES
 ('51000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'fabricate','Left header','60000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','complete'),
 ('51000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001',2,'fabricate','Right header','60000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000002','complete');
INSERT INTO component_events(id,vehicle_id,work_order_id,component_table,event_type,actor_id,event_date) VALUES
 ('52000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','engine_exhaust_manifolds','installed','60000000-0000-0000-0000-000000000001','2026-03-15'),
 ('52000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','engine_exhaust_manifolds','installed','60000000-0000-0000-0000-000000000001','2026-03-16'),
 ('52000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','brake_pads','installed','60000000-0000-0000-0000-000000000002','2026-03-17');
SELECT t_assert(caps('60000000-0000-0000-0000-000000000001') @> '{"fabrication_exhaust":{"n":2,"strength":"corroborating","corroborating":2,"direct":0,"against":0,"first":"2026-03-15","last":"2026-03-16","tier":null}}'
 AND caps('60000000-0000-0000-0000-000000000002') = '{}'::jsonb,
 'component events fold on insert: operation x system -> fabrication_exhaust (corroborating); installing brake parts names no capability');

-- Specifications: performed TIG and MIG (interpretations), a requested stainless TIG on the MIG operation (conflict).
INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,observed_at,content_text,submitted_by_user_id) VALUES
 ('53000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001','2026-03-20','interp',NULL),
 ('53000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001','2026-03-20','interp',NULL),
 ('53000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001','2026-03-01','interp',NULL),
 ('53000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000001','2026-03-01','Use 304 stainless, TIG',NULL),
 ('53000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000001','work_record','90000000-0000-0000-0000-000000000002','2026-03-21','I TIG pulsed the left header','10000000-0000-0000-0000-00000000000f');
INSERT INTO work_order_resource_specifications(id,work_order_id,line_item_id,specification_stage,material_role,material_label,material_key,process_label,process_key,
  basis_observation_id,basis_excerpt,basis_component_event_id) VALUES
 ('53000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001','reported_performed','workpiece','mild steel','mild_steel','TIG','welding.tig',NULL,NULL,'52000000-0000-0000-0000-000000000001'),
 ('53000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000002','reported_performed','workpiece','mild steel','mild_steel','MIG','welding.mig',NULL,NULL,'52000000-0000-0000-0000-000000000002'),
 ('53000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000002','requested','workpiece','304 stainless','stainless_steel.304','TIG','welding.tig','53000000-0000-0000-0000-000000000005','Use 304 stainless, TIG',NULL);
SELECT t_assert(caps('60000000-0000-0000-0000-000000000001') @> '{"welding_tig":{"n":1,"strength":"corroborating","against":1},"welding_mig":{"n":1,"strength":"corroborating","against":0}}',
 'specs fold on insert: performed processes corroborate; the requested-vs-performed conflict is one row against TIG, not a verdict');
SELECT t_assert((SELECT reason FROM actor_capability_basis WHERE basis_kind='requested_spec_conflict' AND basis_id='53000000-0000-0000-0000-000000000003')
   = 'requested stainless_steel.304 welding.tig; reported performed mild_steel welding.mig',
 'the conflict basis names both specifications');
SELECT t_assert((SELECT count(*) FROM actor_capabilities WHERE actor_id='60000000-0000-0000-0000-000000000001' AND capability_type='welding_mig')=2
 AND (SELECT evidence_count=1 AND complexity_tier='basic' AND derivation='legacy_hand_entered' AND strength IS NULL FROM actor_capabilities
   WHERE actor_id='60000000-0000-0000-0000-000000000001' AND capability_type='welding_mig' AND derivation='legacy_hand_entered'),
 'the legacy hand row stays as it was, beside the derived row');

-- A report signed by the performer's evidenced account is direct; a finer process key maps to its family.
INSERT INTO work_order_resource_specifications(id,work_order_id,line_item_id,specification_stage,material_role,material_label,material_key,process_label,process_key,
  basis_observation_id,basis_excerpt,basis_component_event_id) VALUES
 ('53000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000001','51000000-0000-0000-0000-000000000001','reported_performed','workpiece','mild steel','mild_steel','TIG pulse','welding.tig.pulse',NULL,NULL,'52000000-0000-0000-0000-000000000001');
SELECT t_assert(caps('60000000-0000-0000-0000-000000000001') @> '{"welding_tig":{"n":2,"strength":"direct","direct":1,"corroborating":1,"against":1}}',
 'performer-signed report is direct');

-- Customer-accepted provider completion is direct for the job's operations and performed processes.
INSERT INTO organization_contributors(organization_id,user_id,role,status) VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-00000000000f','fabricator','active');
SELECT work_order_completion_basis('30000000-0000-0000-0000-000000000001')->>'scope_hash' AS sh \gset
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT attest_work_completion('30000000-0000-0000-0000-000000000001',:'sh') AS att \gset
SELECT t_assert(caps('60000000-0000-0000-0000-000000000001') @> '{"fabrication_exhaust":{"strength":"corroborating"}}','an attestation alone is not direct evidence');
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT accept_work_completion('30000000-0000-0000-0000-000000000001',((:'att'::jsonb)->>'completion_id')::uuid,(:'att'::jsonb)->>'completion_hash') AS acc \gset
RESET ROLE;
SELECT t_assert(caps('60000000-0000-0000-0000-000000000001') @> '{"fabrication_exhaust":{"n":3,"strength":"direct","direct":1},"welding_mig":{"n":2,"strength":"direct"},"welding_tig":{"n":3,"direct":2}}'
 AND EXISTS (SELECT 1 FROM actor_capability_basis WHERE basis_kind='completion_acceptance' AND basis_id=((:'acc'::jsonb)->>'acceptance_id')::uuid AND strength='direct'),
 'customer acceptance of the provider completion folds as direct evidence for the job''s operations and performed processes');

-- Findings by the accepted inspector are direct evidence of inspection.
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT request_inspection('40000000-0000-0000-0000-000000000002',NULL,'{"inspection_type":"pre_purchase"}')->>'work_order_id' AS insp \gset
RESET ROLE;
SELECT r.id AS ireq FROM work_order_resource_requirements r WHERE r.work_order_id=:'insp' \gset
SET ROLE authenticated;
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT offer_on_requirement(:'ireq',NULL,NULL,NULL,NULL) AS oi \gset
SELECT t_assert(NOT caps('60000000-0000-0000-0000-000000000001') ? 'inspection','an offer is not evidence');
SELECT as_user('10000000-0000-0000-0000-00000000000c');
SELECT accept_offer(((:'oi'::jsonb)->>'offer_id')::uuid,(:'oi'::jsonb)->>'offer_hash');
SELECT as_user('10000000-0000-0000-0000-00000000000f');
SELECT record_inspection_findings(:'insp','{"summary":"Frame solid","inspection_type":"pre_purchase","findings":[{"system":"brakes","finding":"Front pads near minimum","severity":"monitor"}]}');
RESET ROLE;
SELECT t_assert(caps('60000000-0000-0000-0000-000000000001') @> '{"inspection":{"n":1,"strength":"direct"}}','accepted inspector findings fold as direct inspection evidence');
SELECT t_assert(caps('60000000-0000-0000-0000-000000000001') ?& ARRAY['fabrication_exhaust','welding_tig','welding_mig','inspection']
 AND NOT caps('60000000-0000-0000-0000-000000000001') ?| ARRAY['paint_refinish','welding_stick']
 AND (SELECT bool_and(basis_kind IN ('completion_acceptance','inspection_findings','reported_performed_spec','component_event','requested_spec_conflict')) FROM actor_capability_basis),
 'self-reported expertise and offers never count; only attributed evidence kinds appear');

-- Deterministic and idempotent.
SELECT jsonb_agg(to_jsonb(b) - 'folded_at' ORDER BY capability_type, basis_kind, basis_id) AS b0 FROM actor_capability_basis b \gset
SET ROLE service_role;
SELECT capability_fold_all() AS all1 \gset
SELECT capability_fold_all() AS all2 \gset
RESET ROLE;
SELECT t_assert((SELECT jsonb_agg(to_jsonb(b) - 'folded_at' ORDER BY capability_type, basis_kind, basis_id) FROM actor_capability_basis b) = (:'b0'::jsonb)
 AND (:'all1'::jsonb) - 'actors_folded' = (:'all2'::jsonb) - 'actors_folded','refolding everything yields the same basis rows and counts');

-- Capabilities follow only evidenced links: withdrawing the link drops the direct evidence that came through it.
UPDATE account_link_claims SET status='rejected' WHERE user_id='10000000-0000-0000-0000-00000000000f' AND actor_id='60000000-0000-0000-0000-000000000001';
SELECT t_assert(NOT caps('60000000-0000-0000-0000-000000000001') ? 'inspection'
 AND caps('60000000-0000-0000-0000-000000000001') @> '{"fabrication_exhaust":{"n":2,"strength":"corroborating"},"welding_tig":{"strength":"corroborating","direct":0}}',
 'a rejected identity link removes the direct evidence that flowed through it');

SELECT t_assert(NOT has_function_privilege('authenticated','capability_fold_actor(uuid)','EXECUTE') AND NOT has_function_privilege('anon','capability_fold_all()','EXECUTE')
 AND has_function_privilege('service_role','capability_fold_actor(uuid)','EXECUTE')
 AND NOT has_table_privilege('anon','public.actor_capability_basis','SELECT') AND NOT has_table_privilege('authenticated','public.actor_capability_basis','SELECT')
 AND has_table_privilege('anon','public.actor_capabilities','SELECT'),'fold service-only; basis rows service-only; capability rows public as before');
