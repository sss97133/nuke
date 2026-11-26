-- Disposable PG17 only; reuse the entire canonical model/manual regression chain.
\set ON_ERROR_STOP on
\i supabase/sql/test_harness_functional_manual_sheets.sql
CREATE TEMP TABLE before_phase_eval AS SELECT latest_evaluation_id AS id FROM public.harness_model_state
 WHERE vehicle_id='e08bf694-970f-4cbe-8a74-8715158a0f2e';
CREATE TEMP TABLE before_scope_guards AS SELECT oid,tgname,tgtype,tgenabled,tgfoid FROM pg_trigger
 WHERE tgname IN('harness_model_nodes_scope','harness_model_ends_scope','harness_model_checks_scope','harness_model_requirements_scope');
\i supabase/migrations/20261126051125_harness_fold_phase_diagnostics.sql
DO $contract$
DECLARE v uuid:='e08bf694-970f-4cbe-8a74-8715158a0f2e'; r jsonb; eid uuid; prior uuid; table_ text; changed_ boolean; original_manual text; before_count integer;
BEGIN
 IF EXISTS(SELECT FROM before_scope_guards b FULL JOIN pg_trigger t ON t.oid=b.oid
  WHERE b.oid IS NOT NULL AND (t.oid IS NULL OR (b.tgname,b.tgtype,b.tgenabled,b.tgfoid) IS DISTINCT FROM(t.tgname,t.tgtype,t.tgenabled,t.tgfoid)))
 THEN RAISE EXCEPTION 'Diagnostic change modified source enforcement'; END IF;
 IF has_function_privilege('anon','public.harness_model_fold(uuid)','EXECUTE')
  OR has_function_privilege('authenticated','public.harness_model_fold(uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Diagnostics exposed producer'; END IF;
 IF (public.harness_manual_cursor(v)->>'eligible_cursor')::boolean THEN RAISE EXCEPTION 'Producer code receipt missed change'; END IF;
 SELECT id INTO prior FROM before_phase_eval;
 r:=public.harness_model_fold(v);eid:=(r->>'evaluation_id')::uuid;
 IF r->>'status'<>'current' OR eid=prior THEN RAISE EXCEPTION 'Instrumented fold did not publish a fresh receipt: %',r; END IF;
 IF (SELECT input_hash FROM public.harness_model_evaluations WHERE id=eid) IS DISTINCT FROM
  (SELECT input_hash FROM public.harness_model_evaluations WHERE id=prior)
 THEN RAISE EXCEPTION 'Diagnostics changed source input'; END IF;
 FOREACH table_ IN ARRAY ARRAY['harness_model_nodes','harness_model_segment_ends','harness_model_checks','harness_model_wire_requirements',
  'harness_model_sheets','harness_model_sheet_members','harness_model_sheet_ends'] LOOP
  EXECUTE format('SELECT EXISTS((SELECT to_jsonb(x)-''evaluation_id''%s FROM public.%I x WHERE evaluation_id=$1 EXCEPT ALL SELECT to_jsonb(x)-''evaluation_id''%s FROM public.%I x WHERE evaluation_id=$2) UNION ALL (SELECT to_jsonb(x)-''evaluation_id''%s FROM public.%I x WHERE evaluation_id=$2 EXCEPT ALL SELECT to_jsonb(x)-''evaluation_id''%s FROM public.%I x WHERE evaluation_id=$1))',
   CASE WHEN table_='harness_model_checks' THEN '-''id''' ELSE '' END,table_,CASE WHEN table_='harness_model_checks' THEN '-''id''' ELSE '' END,table_,
   CASE WHEN table_='harness_model_checks' THEN '-''id''' ELSE '' END,table_,CASE WHEN table_='harness_model_checks' THEN '-''id''' ELSE '' END,table_)
   INTO changed_ USING eid,prior;
  IF changed_ THEN RAISE EXCEPTION 'Diagnostics changed derived rows: %',table_; END IF;
 END LOOP;
 original_manual:=pg_get_functiondef('public.harness_manual_compute(jsonb,jsonb)'::regprocedure);
 SELECT count(*) INTO before_count FROM public.harness_model_evaluations WHERE vehicle_id=v;
 EXECUTE $fault$CREATE OR REPLACE FUNCTION public.harness_manual_compute(p_input jsonb,p_result jsonb) RETURNS jsonb
 LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=public AS $body$
 BEGIN RAISE EXCEPTION 'synthetic diagnostic cancellation' USING ERRCODE='57014'; END; $body$$fault$;
 r:=public.harness_model_fold(v);
 IF r->>'status'<>'error' OR r->>'error_code'<>'57014'
  OR (SELECT count(*) FROM public.harness_model_evaluations WHERE vehicle_id=v)<>before_count
  OR NOT EXISTS(SELECT FROM public.harness_model_state WHERE vehicle_id=v AND latest_evaluation_id=eid AND last_error_code='57014' AND retry_after>clock_timestamp())
 THEN RAISE EXCEPTION 'Diagnostic failure changed atomic rollback/backoff: %',r; END IF;
 EXECUTE original_manual;
 r:=public.harness_model_fold(v);
 IF r->>'status'<>'current' OR EXISTS(SELECT FROM public.harness_model_state WHERE vehicle_id=v AND last_error_code IS NOT NULL)
 THEN RAISE EXCEPTION 'Existing code-change recovery failed: %',r; END IF;
END $contract$;
SELECT 'test_harness_fold_phase_diagnostics: PASS' AS result;
