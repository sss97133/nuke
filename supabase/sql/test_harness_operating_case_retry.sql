-- Regression: a failed evaluator must not roll back its prepared dependency
-- hash and revive an unchanged exhausted numerical budget on a freshness probe.
\set ON_ERROR_STOP on
\i supabase/sql/fixtures/harness_operating_case_setup.sql
\i supabase/migrations/20261126181729_harness_model_dc_compute.sql
\i supabase/sql/harness_operating_case_runtime.sql
UPDATE public.platform_config SET config_value=config_value||'{"max_attempts":1}' WHERE config_key='model_fold';
CREATE SEQUENCE public.fixture_operating_evaluations;
CREATE FUNCTION public.fixture_operating_evaluate_error() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM nextval('public.fixture_operating_evaluations');
 RAISE EXCEPTION 'synthetic numerical constructor failure' USING ERRCODE='22023';
END $$;
CREATE TRIGGER fixture_operating_evaluate_error BEFORE INSERT ON public.harness_model_dc_runs
 FOR EACH ROW EXECUTE FUNCTION public.fixture_operating_evaluate_error();
-- Advance only this fixture's completed failure clocks before the real case
-- source guard. All guards remain enabled and still validate the UPDATE.
-- No source, generation, failure count or interpreter is changed by this hook.
CREATE FUNCTION public.fixture_operating_advance_failure_clock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.attempt_tick_id IS NOT NULL AND NEW.attempt_tick_id IS NULL
  AND NEW.failure_count>OLD.failure_count
  AND NEW.answered_generation IS NOT DISTINCT FROM OLD.answered_generation
  AND NEW.latest_run_id IS NOT DISTINCT FROM OLD.latest_run_id THEN
  NEW.attempted_at:=clock_timestamp()-interval '16 minutes';
  NEW.retry_after:=clock_timestamp()-interval '1 second';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aaa_fixture_operating_advance_failure_clock BEFORE UPDATE ON public.harness_operating_cases
 FOR EACH ROW EXECUTE FUNCTION public.fixture_operating_advance_failure_clock();
CREATE TEMP TABLE operating_retry_source AS SELECT md5(public.harness_model_inputs(:fb1)::text) hash;
SET ROLE service_role;
SELECT public.harness_operating_case_record(public.fixture_operating_recipe('c0000000-0000-4000-8000-000000000009','closed'));
CALL public.model_fold_tick();
RESET ROLE;
SELECT public.t_assert((SELECT failure_count=1 AND answered_generation IS NULL AND latest_run_id IS NULL
 AND attempt_tick_id IS NULL AND attempt_dependency_key IS NOT NULL
 AND attempt_dependency_key=public.harness_operating_case_compile(current_revision_id,
 'b0000000-0000-4000-8000-000000000041')->>'private_input_hash'
 FROM public.harness_operating_cases WHERE id='c0000000-0000-4000-8000-000000000009'),
 'failed numerical evaluation retains its exact previously committed preparation hash');
SELECT public.t_assert((SELECT last_value=1 AND is_called FROM public.fixture_operating_evaluations)
 AND (SELECT count(*)=0 FROM public.harness_model_dc_runs)
 AND (SELECT count(*)=0 FROM public.harness_model_dc_wire_inputs)
 AND (SELECT count(*)=0 FROM public.harness_model_dc_node_results),
 'one genuine failed evaluation leaves no partial numerical run or children');
SET ROLE service_role;
CALL public.model_fold_tick();
CALL public.model_fold_tick();
CALL public.model_fold_tick();
CALL public.model_fold_tick();
RESET ROLE;
SELECT public.t_assert((SELECT last_value=1 FROM public.fixture_operating_evaluations)
 AND (SELECT failure_count=1 AND answered_generation IS NULL AND attempt_tick_id IS NULL
 FROM public.harness_operating_cases WHERE id='c0000000-0000-4000-8000-000000000009'),
 'a freshness probe cannot invoke the evaluator again for an unchanged exhausted input');
SELECT public.t_assert((SELECT count(*)=2 AND count(*) FILTER(WHERE dc_status='failed' AND dc_error_code='22023')=1
 AND count(*) FILTER(WHERE dc_status='budget_exhausted' AND dc_error_code IS NULL)=1
 AND bool_and(NOT dc_output_retained) FROM public.model_fold_tick_runs WHERE fold_phase='dc'),
 'failed evaluation and budget-only freshness probe retain separate truthful typed outcomes');
SELECT public.t_assert((SELECT state='done' AND fold_stage='normal' AND attempts=0 AND lease_tick IS NULL
 FROM public.model_fold_work WHERE vehicle_id=:fb1)
 AND (SELECT hash=md5(public.harness_model_inputs(:fb1)::text) FROM operating_retry_source),
 'private retry accounting preserves generic followup and canonical source inputs');
