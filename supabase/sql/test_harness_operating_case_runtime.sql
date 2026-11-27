-- Native PG17 contract over explicit synthetic source/qualification adapters.
-- The actual candidate recipe/compiler/results/worker and numerical kernel run.
-- This does not establish source admission, installed applicability or release.
\set ON_ERROR_STOP on
\i supabase/sql/fixtures/harness_operating_case_setup.sql
\i supabase/migrations/20261126181729_harness_model_dc_compute.sql
CREATE TEMP TABLE operating_relations_before AS SELECT relname FROM pg_class
 WHERE relnamespace='public'::regnamespace AND relkind IN('r','p');
\i supabase/sql/harness_operating_case_runtime.sql
SELECT public.t_assert((SELECT array_agg(relname::text ORDER BY relname) FROM(
 SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN('r','p')
 EXCEPT SELECT relname FROM operating_relations_before) new_tables)=ARRAY[
 'harness_model_dc_branch_results','harness_model_dc_issues','harness_model_dc_node_results','harness_model_dc_runs',
 'harness_model_dc_wire_inputs','harness_operating_case_boundaries','harness_operating_case_elements',
 'harness_operating_case_revisions','harness_operating_case_wires','harness_operating_cases'],
 'the exact new relation set equals the ten proposed grains, with no extra owner');
SELECT public.t_assert((SELECT count(*)=137 AND bool_and(col_description(a.attrelid,a.attnum) IS NOT NULL)
 FROM pg_attribute a JOIN pg_class t ON t.oid=a.attrelid WHERE t.relnamespace='public'::regnamespace
 AND a.attnum>0 AND NOT a.attisdropped AND t.relname IN('harness_operating_cases','harness_operating_case_revisions',
 'harness_operating_case_wires','harness_operating_case_elements','harness_operating_case_boundaries',
 'harness_model_dc_runs','harness_model_dc_wire_inputs','harness_model_dc_node_results',
 'harness_model_dc_branch_results','harness_model_dc_issues')),'all proposed columns have PostgreSQL definitions including units and clock roles');
CREATE TEMP TABLE operating_public_baseline AS SELECT source_epoch,folded_epoch,
 md5(public.harness_model_inputs(vehicle_id)::text) input_hash FROM public.harness_model_state WHERE vehicle_id=:fb1;
SET ROLE service_role;
SELECT public.harness_operating_case_record(public.fixture_operating_recipe('c0000000-0000-4000-8000-000000000001','closed'));
RESET ROLE;
SELECT public.t_assert((SELECT private_generation=1 AND answered_generation IS NULL AND latest_run_id IS NULL
 FROM public.harness_operating_cases WHERE id='c0000000-0000-4000-8000-000000000001'),
 'authoring advances only the private generation');
SELECT public.t_assert((SELECT (s.source_epoch,s.folded_epoch,md5(public.harness_model_inputs(s.vehicle_id)::text))=
 (b.source_epoch,b.folded_epoch,b.input_hash) FROM public.harness_model_state s CROSS JOIN operating_public_baseline b WHERE s.vehicle_id=:fb1),
 'private authoring leaves the public structural epoch and input unchanged');
CREATE TEMP TABLE operating_compiled AS SELECT public.harness_operating_case_compile(current_revision_id,
 'b0000000-0000-4000-8000-000000000041') p FROM public.harness_operating_cases
 WHERE id='c0000000-0000-4000-8000-000000000001';
SELECT public.t_assert(p->>'status'='ready' AND p->>'qualification'='conditional_simulation_only'
 AND (SELECT count(*)=2 FROM jsonb_array_elements(p#>'{input_receipt,wire_inputs,0,required_structural_checks}') c
 WHERE c->>'requires_pass'='false' AND c#>>'{results,0,result}'='hold'),
 'explicit analytical parameters compile while both independent stock holds remain in the receipt') FROM operating_compiled;
SET ROLE service_role;
CALL public.model_fold_tick();
RESET ROLE;
SELECT public.t_assert((SELECT answered_generation=1 AND latest_run_id IS NOT NULL AND attempt_tick_id IS NULL
 FROM public.harness_operating_cases WHERE id='c0000000-0000-4000-8000-000000000001'),
 'existing service-role tick answers the exact committed private attempt');
SELECT public.t_assert((SELECT state='pending' AND fold_stage='vehicle_followup' AND attempts=0
 AND folded_at IS NULL FROM public.model_fold_work WHERE vehicle_id=:fb1),
 'electrical phase preserves the separate generic followup and its budget');
SET ROLE service_role;
CALL public.model_fold_tick();
RESET ROLE;
SELECT public.t_assert((SELECT state='done' AND fold_stage='normal' AND attempts=0 FROM public.model_fold_work WHERE vehicle_id=:fb1),
 'the next existing service tick finishes generic work');
SELECT public.t_assert((SELECT count(*)=1 AND bool_and(sealed_at IS NOT NULL AND status='solved'
 AND max_kcl_residual_a=0 AND power_residual_w=0 AND max_source_residual_v=0) FROM public.harness_model_dc_runs),
 'only a closed conserved numerical result is retained');
SELECT public.t_assert((SELECT count(*)=2 FROM public.harness_model_dc_node_results)
 AND (SELECT count(*)=2 FROM public.harness_model_dc_branch_results)
 AND (SELECT abs(current_a)=6 AND absorbed_power_w=72 FROM public.harness_model_dc_branch_results
 WHERE segment_id='b0000000-0000-4000-8000-000000000021'),
 'the explicit 12 V and 2 ohm fixture produces 6 A and 72 W with typed wire and node edges');
SELECT public.t_assert((SELECT (public.harness_operating_case_result(id,'b0000000-0000-4000-8000-000000000041')->>'current')::boolean
 FROM public.harness_operating_cases WHERE id='c0000000-0000-4000-8000-000000000001'),
 'the result reader exposes numbers only with matching source recipe and logic');
-- Same evaluation ID is insufficient when its required keyed check changes.
UPDATE public.harness_model_checks SET result='hold' WHERE rule_key='segment_plan_agreement';
SELECT public.t_assert((SELECT public.harness_operating_case_compile(current_revision_id,
 'b0000000-0000-4000-8000-000000000041')->>'status'='held'
 AND public.harness_operating_case_result(id,'b0000000-0000-4000-8000-000000000041')->'run'='null'::jsonb
 FROM public.harness_operating_cases WHERE id='c0000000-0000-4000-8000-000000000001'),
 'a same-evaluation required check hold suppresses prior numbers');
UPDATE public.harness_model_checks SET result='fail' WHERE rule_key='segment_plan_agreement';
SELECT public.t_assert((SELECT public.harness_operating_case_compile(current_revision_id,
 'b0000000-0000-4000-8000-000000000041')->'network'='null'::jsonb
 FROM public.harness_operating_cases WHERE id='c0000000-0000-4000-8000-000000000001'),
 'a known plan failure never yields a numerical network');
UPDATE public.harness_model_checks SET result='pass',rule_version='obsolete' WHERE rule_key='segment_plan_agreement';
SELECT public.t_assert((SELECT public.harness_operating_case_compile(current_revision_id,
 'b0000000-0000-4000-8000-000000000041')->>'status'='held'
 FROM public.harness_operating_cases WHERE id='c0000000-0000-4000-8000-000000000001'),
 'an obsolete check version cannot qualify a recipe');
UPDATE public.harness_model_checks SET rule_version='1' WHERE rule_key='segment_plan_agreement';
UPDATE public.harness_model_checks SET result='fail' WHERE rule_key='wire_stock_key';
SELECT public.t_assert((SELECT public.harness_operating_case_compile(current_revision_id,
 'b0000000-0000-4000-8000-000000000041')->>'status'='held'
 FROM public.harness_operating_cases WHERE id='c0000000-0000-4000-8000-000000000001'),
 'conditional unkeyed planning never bypasses a known stock failure');
UPDATE public.harness_model_checks SET result='hold' WHERE rule_key='wire_stock_key';
CREATE TEMP TABLE operating_source_baseline AS SELECT * FROM public.fixture_operating_source;
UPDATE public.fixture_operating_source SET p=jsonb_set(p,'{model,segments,0,colour}','"red"');
SELECT public.t_assert(public.harness_operating_case_result('c0000000-0000-4000-8000-000000000001',
 'b0000000-0000-4000-8000-000000000041')->'run'='null'::jsonb,
 'a changed source payload suppresses numbers even while the evaluation ID is unchanged');
UPDATE public.fixture_operating_source f SET p=b.p FROM operating_source_baseline b WHERE b.vehicle_id=f.vehicle_id;
SELECT public.t_assert((SELECT (public.harness_operating_case_result(id,'b0000000-0000-4000-8000-000000000041')->>'current')::boolean
 AND (SELECT count(*)=1 FROM public.harness_model_dc_runs)
 FROM public.harness_operating_cases WHERE id='c0000000-0000-4000-8000-000000000001'),
 'restoring exact dependencies reuses the same closed result without inventing a new run');
CREATE TEMP TABLE operating_first AS SELECT current_revision_id revision,latest_run_id run FROM public.harness_operating_cases
 WHERE id='c0000000-0000-4000-8000-000000000001';
SELECT public.harness_operating_case_record(public.fixture_operating_recipe('c0000000-0000-4000-8000-000000000001','open',revision)) FROM operating_first;
SELECT public.t_assert((SELECT private_generation=2 AND answered_generation=1
 AND public.harness_operating_case_result(id,'b0000000-0000-4000-8000-000000000041')->'run'='null'::jsonb
 FROM public.harness_operating_cases WHERE id='c0000000-0000-4000-8000-000000000001'),
 'changing a contact hides prior numbers before the worker recomputes');
SET ROLE service_role;
CALL public.model_fold_tick();
CALL public.model_fold_tick();
RESET ROLE;
SELECT public.t_assert((SELECT c.answered_generation=2 AND r.status='solved' AND b.current_a=0 AND b.absorbed_power_w=0
 FROM public.harness_operating_cases c JOIN public.harness_model_dc_runs r ON r.id=c.latest_run_id
 JOIN public.harness_model_dc_branch_results b ON b.run_id=r.id
 WHERE c.id='c0000000-0000-4000-8000-000000000001' AND b.segment_id='b0000000-0000-4000-8000-000000000021'),
 'an explicitly open wire recomputes to zero current without erasing the closed-state history');
SELECT public.t_assert((SELECT count(*)=2 AND bool_and(sealed_at IS NOT NULL) FROM public.harness_model_dc_runs),
 'old and new exact recipe results remain immutable history');
-- A stale authoring head must fail through the actual top-level writer.
\set ON_ERROR_STOP off
SELECT public.harness_operating_case_record(public.fixture_operating_recipe('c0000000-0000-4000-8000-000000000001','closed',revision)) FROM operating_first;
\set stale_sqlstate :SQLSTATE
\set ON_ERROR_STOP on
SELECT public.t_assert(:'stale_sqlstate'='40001' AND (SELECT private_generation=2 FROM public.harness_operating_cases
 WHERE id='c0000000-0000-4000-8000-000000000001'),'stale recipe comparison cannot overwrite a newer head');
SELECT public.harness_operating_case_record(public.fixture_operating_recipe('c0000000-0000-4000-8000-000000000002','unknown'));
SET ROLE service_role;
CALL public.model_fold_tick();
CALL public.model_fold_tick();
RESET ROLE;
SELECT public.t_assert((SELECT c.answered_generation=1 AND r.status='held' AND r.expected_node_count=0
 AND r.expected_branch_count=0 AND r.expected_issue_count>0 FROM public.harness_operating_cases c
 JOIN public.harness_model_dc_runs r ON r.id=c.latest_run_id WHERE c.id='c0000000-0000-4000-8000-000000000002'),
 'an unknown contact is a durable held result without numerical children');
UPDATE public.fixture_operating_source SET qualified=false;
SELECT public.t_assert(NOT (public.harness_operating_case_result('c0000000-0000-4000-8000-000000000001',
 'b0000000-0000-4000-8000-000000000041')->>'current')::boolean
 AND public.harness_operating_case_result('c0000000-0000-4000-8000-000000000001',
 'b0000000-0000-4000-8000-000000000041')->'run'='null'::jsonb,
 'withdrawn source qualification suppresses previously solved numbers');
UPDATE public.fixture_operating_source SET qualified=true;
SELECT public.t_assert(NOT has_table_privilege('service_role','public.harness_operating_cases','INSERT,UPDATE,DELETE')
 AND NOT has_function_privilege('anon','public.harness_operating_case_worker_claim(uuid,uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.harness_operating_case_worker_claim(uuid,uuid,uuid)','EXECUTE'),
 'service compatibility grants no private case DML or end-user worker mutators');
SET ROLE service_role;
DO $$ BEGIN
 BEGIN
  PERFORM public.harness_operating_case_worker_claim(gen_random_uuid(),'c0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000041');
  RAISE EXCEPTION 'direct claim bypassed genuine tick';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.harness_operating_cases SET answered_generation=private_generation;
  RAISE EXCEPTION 'direct case update bypassed writer';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT public.t_assert((public.model_fold_queue_gauge()#>>'{private_dc_phases_24h,runs}')::integer=3,
 'the existing gauge reports private numerical phases separately');
CREATE TEMP TABLE operating_revert AS SELECT public.model_fold_revert_v1(tick_id) r
 FROM public.model_fold_tick_runs WHERE fold_phase='dc' ORDER BY id LIMIT 1;
SELECT public.t_assert(r->>'revert_complete'='false' AND (r->>'private_dc_phases_retained')::integer=1,
 'the existing revert never claims to remove immutable private calculation history') FROM operating_revert;
SELECT public.t_assert((SELECT count(*)=3 FROM public.harness_model_dc_runs)
 AND (SELECT count(*)=4 FROM public.harness_model_dc_node_results),
 'monitoring and reverting do not erase numerical history');
