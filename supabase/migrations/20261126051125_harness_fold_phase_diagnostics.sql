-- Sparse private database diagnostics; retain all current enforcement and worker controls.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
DO $patch$
DECLARE body text:=pg_get_functiondef('public.harness_model_fold(uuid)'::regprocedure);
 old text; phase_name text; statement_anchor text; prefix text;
BEGIN
 IF position('harness_fold_phase_v1' IN body)>0 THEN RAISE EXCEPTION 'fold phase diagnostics already installed'; END IF;
 old:='changed integer; reused boolean; cfg jsonb; max_attempts integer; failures integer; err text;';
 IF (length(body)-length(replace(body,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'fold declaration anchor drifted'; END IF;
 body:=replace(body,old,old||E'\n  -- harness_fold_phase_v1\n'
  ||E'  harness_started_at timestamptz:=clock_timestamp(); harness_phase text:=''entry''; harness_context text;');
 FOR phase_name,statement_anchor IN SELECT * FROM (VALUES
  ('inputs','inp:=public.harness_model_inputs(p_vehicle_id);'),
  ('compute','result:=public.harness_model_compute(inp);'),
  ('manual','result:=result||jsonb_build_object(''manual'',public.harness_manual_compute(inp,result));'),
  ('evaluation','INSERT INTO public.harness_model_evaluations(vehicle_id'),
  ('nodes','INSERT INTO public.harness_model_nodes(evaluation_id'),
  ('ends','INSERT INTO public.harness_model_segment_ends(evaluation_id'),
  ('checks','INSERT INTO public.harness_model_checks(evaluation_id'),
  ('wire_requirements','INSERT INTO public.harness_model_wire_requirements(evaluation_id'),
  ('sheets','INSERT INTO public.harness_model_sheets(evaluation_id'),
  ('sheet_members','INSERT INTO public.harness_model_sheet_members(evaluation_id'),
  ('sheet_ends','INSERT INTO public.harness_model_sheet_ends(evaluation_id'),
  ('publish','UPDATE public.harness_model_state s SET latest_evaluation_id=evaluation')
 ) phases(name,anchor) LOOP
  IF (length(body)-length(replace(body,statement_anchor,'')))/length(statement_anchor)<>1
  THEN RAISE EXCEPTION 'fold phase anchor drifted: %',phase_name; END IF;
  prefix:='harness_phase:='||quote_literal(phase_name)||E';\n'
   ||E'  RAISE LOG ''harness_fold_phase vehicle %, phase %, fold_ms %, statement_ms %'',p_vehicle_id,harness_phase,\n'
   ||E'    round(extract(epoch from clock_timestamp()-harness_started_at)*1000),\n'
   ||E'    round(extract(epoch from clock_timestamp()-statement_timestamp())*1000);\n  ';
  body:=replace(body,statement_anchor,prefix||statement_anchor);
 END LOOP;
 old:='err:=SQLSTATE;';
 IF (length(body)-length(replace(body,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'fold failure anchor drifted'; END IF;
 body:=replace(body,old,old||E'\n  GET STACKED DIAGNOSTICS harness_context=PG_EXCEPTION_CONTEXT;\n'
  ||E'  RAISE LOG ''harness_fold_failure vehicle %, SQLSTATE %, phase %, fold_ms %, statement_ms %, context %'',\n'
  ||E'    p_vehicle_id,err,harness_phase,round(extract(epoch from clock_timestamp()-harness_started_at)*1000),\n'
  ||E'    round(extract(epoch from clock_timestamp()-statement_timestamp())*1000),left(harness_context,1600);');
 old:='RETURN jsonb_build_object(''status'',CASE WHEN changed=1 THEN ''current'' ELSE ''source_changed'' END,';
 IF (length(body)-length(replace(body,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'fold completion anchor drifted'; END IF;
 body:=replace(body,old,E'RAISE LOG ''harness_fold_result vehicle %, published %, reused %, fold_ms %, statement_ms %'',\n'
  ||E'    p_vehicle_id,changed=1,reused,round(extract(epoch from clock_timestamp()-harness_started_at)*1000),\n'
  ||E'    round(extract(epoch from clock_timestamp()-statement_timestamp())*1000);\n  '||old);
 EXECUTE body;
END $patch$;
COMMENT ON FUNCTION public.harness_model_fold(uuid) IS 'Atomic structural evaluation writer with sparse private PostgreSQL phase/failure diagnostics. Existing source scope, input/code/epoch qualification, rollback, backoff and scheduled producer controls remain unchanged. No input receipt is logged or exposed through a public cursor.';
-- Function ACLs, source guards and all schedulers are unchanged. No producer call.
COMMIT;
