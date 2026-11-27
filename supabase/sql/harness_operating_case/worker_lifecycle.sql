-- Candidate implementation for schema proposal f8215459-ec38-4e2e-a855-509257740313.
-- Not an automatically deployed migration. Disposable PG17 contracts only.

BEGIN;
DO $candidate$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%'
  OR current_setting('server_version_num')::integer/10000<>17 THEN
  RAISE EXCEPTION 'Operating-case candidate requires a disposable PG17 contract database';
 END IF;
END $candidate$;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';

CREATE FUNCTION public.harness_operating_case_worker_context(p_vehicle uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE c text; frame text; tick uuid;
BEGIN
 GET DIAGNOSTICS c=PG_CONTEXT;
 frame:=regexp_replace(regexp_replace(c,E'[\n\r]+$',''),E'^.*\n','','s');
 IF frame !~ '^PL/pgSQL function (public\.)?model_fold_tick\(\) line [0-9]+ at [^\n]+$'
  OR NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=to_regprocedure('public.model_fold_tick()')
   AND p.prokind='p' AND p.proowner=current_user::regrole) THEN RETURN NULL; END IF;
 SELECT w.lease_tick INTO tick FROM public.model_fold_work w JOIN public.model_fold_ticks t ON t.tick_id=w.lease_tick
  WHERE w.vehicle_id=p_vehicle AND w.state='leased' AND w.leased_until>clock_timestamp()
   AND t.status='running' AND t.pid=pg_backend_pid();
 RETURN tick;
END $$;

CREATE FUNCTION public.harness_operating_case_worker_key()
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT md5(jsonb_build_object('calculation',public.harness_operating_case_logic(),
  'existing_tick',md5(pg_get_functiondef(to_regprocedure('public.model_fold_tick()'))),
  'worker_contract','private_case_attempt_v1',
  'functions',(SELECT jsonb_object_agg(k,md5(pg_get_functiondef(to_regprocedure(k))) ORDER BY k)
   FROM unnest(ARRAY['public.harness_operating_case_worker_context(uuid)',
    'public.harness_operating_case_worker_due(uuid,uuid)',
    'public.harness_operating_case_worker_claim(uuid,uuid,uuid)',
    'public.harness_operating_case_worker_finish(uuid,uuid,jsonb)',
    'public.harness_operating_case_source_guard()']) k))::text)
$$;

CREATE FUNCTION public.harness_operating_case_worker_due(p_case uuid,p_evaluation uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT coalesce((SELECT r.requested_state='enabled' AND r.sealed_at IS NOT NULL
  AND public.harness_model_in_scope(c.vehicle_id)
  AND (c.attempt_generation IS DISTINCT FROM c.private_generation
   OR c.attempt_revision_id IS DISTINCT FROM c.current_revision_id
   OR c.attempt_structural_evaluation_id IS DISTINCT FROM p_evaluation
   OR c.attempt_logic_key IS DISTINCT FROM public.harness_operating_case_worker_key()
   OR c.attempted_at IS NULL OR c.attempted_at<=statement_timestamp()-interval '15 minutes'
   OR ((c.retry_after IS NULL OR c.retry_after<=statement_timestamp())
    AND (c.answered_generation IS DISTINCT FROM c.private_generation OR c.failure_count>0)
    AND c.failure_count<coalesce((public.model_fold_config()->>'max_attempts')::integer,5)))
  FROM public.harness_operating_cases c JOIN public.harness_operating_case_revisions r ON r.id=c.current_revision_id
  WHERE c.id=p_case),false)
$$;

CREATE FUNCTION public.harness_operating_case_worker_claim(p_tick uuid,p_case uuid,p_evaluation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.harness_operating_cases; r public.harness_operating_case_revisions;
 compiled jsonb; key_ text; same_ boolean; budget integer;
BEGIN
 SELECT * INTO c FROM public.harness_operating_cases WHERE id=p_case FOR UPDATE;
 IF NOT FOUND OR public.harness_operating_case_worker_context(c.vehicle_id) IS DISTINCT FROM p_tick OR p_tick IS NULL THEN
  RAISE EXCEPTION 'private case claim requires its active existing worker lease' USING ERRCODE='42501'; END IF;
 IF NOT coalesce((public.model_fold_config()->>'enabled')::boolean,false)
  OR NOT public.harness_operating_case_worker_due(c.id,p_evaluation) THEN RETURN jsonb_build_object('status','not_due'); END IF;
 SELECT * INTO r FROM public.harness_operating_case_revisions WHERE id=c.current_revision_id;
 key_:=public.harness_operating_case_worker_key();
 compiled:=public.harness_operating_case_compile(r.id,p_evaluation);
 IF compiled->'input_receipt' IS NULL OR compiled->>'private_input_hash' IS NULL THEN
  RETURN jsonb_build_object('status','dependency_pending'); END IF;
 same_:=c.attempt_revision_id IS NOT DISTINCT FROM r.id
  AND c.attempt_generation IS NOT DISTINCT FROM c.private_generation
  AND c.attempt_structural_evaluation_id IS NOT DISTINCT FROM p_evaluation
  AND c.attempt_dependency_key IS NOT DISTINCT FROM compiled->>'private_input_hash'
  AND c.attempt_logic_key IS NOT DISTINCT FROM key_;
 budget:=coalesce((public.model_fold_config()->>'max_attempts')::integer,5);
 IF same_ AND c.failure_count>=budget THEN
  -- Recheck eligibility without reviving the unchanged computation budget.
  UPDATE public.harness_operating_cases SET attempted_at=clock_timestamp() WHERE id=c.id;
  RETURN jsonb_build_object('status','budget_exhausted');
 END IF;
 IF same_ AND c.retry_after>clock_timestamp() THEN
  UPDATE public.harness_operating_cases SET attempted_at=clock_timestamp() WHERE id=c.id;
  RETURN jsonb_build_object('status','backoff');
 END IF;
 UPDATE public.harness_operating_cases SET attempt_revision_id=r.id,
  attempt_structural_evaluation_id=p_evaluation,attempt_scope_key=r.scope_key,
  attempt_generation=c.private_generation,attempt_dependency_key=compiled->>'private_input_hash',attempt_logic_key=key_,
  attempt_tick_id=p_tick,attempted_at=clock_timestamp(),failure_count=CASE WHEN same_ THEN failure_count ELSE 0 END,
  retry_after=NULL WHERE id=c.id;
 RETURN jsonb_build_object('status','claimed','case_id',c.id,'revision_id',r.id,
  'generation',c.private_generation,'structural_evaluation_id',p_evaluation,
  'dependency_key',compiled->>'private_input_hash','worker_logic_key',key_);
END $$;

CREATE FUNCTION public.harness_operating_case_worker_finish(p_tick uuid,p_case uuid,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.harness_operating_cases; shown jsonb; run_ public.harness_model_dc_runs; good boolean; failed boolean;
 at_ timestamptz:=clock_timestamp(); failures integer;
BEGIN
 SELECT * INTO c FROM public.harness_operating_cases WHERE id=p_case FOR UPDATE;
 IF NOT FOUND OR p_tick IS NULL OR c.attempt_tick_id IS DISTINCT FROM p_tick
  OR public.harness_operating_case_worker_context(c.vehicle_id) IS DISTINCT FROM p_tick THEN
  RAISE EXCEPTION 'private case completion requires its active existing worker attempt' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR (p_result ? 'sqlstate'
  AND (p_result-'sqlstate'='{}'::jsonb AND jsonb_typeof(p_result->'sqlstate')='string'
   AND p_result->>'sqlstate' ~ '^[0-9A-Z]{5}$' AND left(p_result->>'sqlstate',2) NOT IN('00','01','02')) IS NOT TRUE) THEN
  RAISE EXCEPTION 'private case completion requires a typed outcome' USING ERRCODE='22023'; END IF;
 IF p_result ? 'changed' AND p_result<>'{"changed":true}'::jsonb THEN
  RAISE EXCEPTION 'changed completion must be an exclusive typed outcome' USING ERRCODE='22023'; END IF;
 IF p_result='{"changed":true}'::jsonb THEN
  shown:=public.harness_operating_case_compile(c.current_revision_id,c.attempt_structural_evaluation_id);
  IF c.current_revision_id=c.attempt_revision_id AND c.private_generation=c.attempt_generation
   AND c.attempt_logic_key=public.harness_operating_case_worker_key()
   AND shown->>'private_input_hash'=c.attempt_dependency_key THEN
   RAISE EXCEPTION 'unchanged attempt cannot be discarded as changed' USING ERRCODE='23514'; END IF;
  UPDATE public.harness_operating_cases SET attempt_tick_id=NULL,failure_count=0,retry_after=NULL WHERE id=c.id;
  RETURN jsonb_build_object('status','changed');
 END IF;
 failed:=p_result ? 'sqlstate';
 IF NOT failed THEN
  IF p_result-ARRAY['run_id','status','qualification','dependencies_still_match']<>'{}'::jsonb
   OR jsonb_typeof(p_result->'run_id') IS DISTINCT FROM 'string'
   OR (p_result->>'run_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') IS NOT TRUE
   OR (p_result->>'status' IN('solved','held','indeterminate','inconsistent','numerical_failure','reused')) IS NOT TRUE
   OR (p_result ? 'qualification' AND p_result->>'qualification' IS DISTINCT FROM 'conditional_simulation_only')
   OR (p_result ? 'dependencies_still_match' AND jsonb_typeof(p_result->'dependencies_still_match')<>'boolean') THEN
   RAISE EXCEPTION 'completed run requires an exclusive typed success outcome' USING ERRCODE='22023'; END IF;
  SELECT * INTO run_ FROM public.harness_model_dc_runs WHERE id=(p_result->>'run_id')::uuid
   AND case_id=c.id AND revision_id=c.attempt_revision_id AND private_generation=c.attempt_generation
   AND structural_evaluation_id=c.attempt_structural_evaluation_id AND scope_key=c.attempt_scope_key
   AND private_input_hash=c.attempt_dependency_key AND sealed_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'private completion has no exact closed run' USING ERRCODE='23514'; END IF;
  IF p_result->>'status'<>'reused' AND p_result->>'status' IS DISTINCT FROM run_.status THEN
   RAISE EXCEPTION 'completion status differs from the exact closed run' USING ERRCODE='22023'; END IF;
  shown:=public.harness_operating_case_result(c.id,c.attempt_structural_evaluation_id);
  good:=c.current_revision_id=c.attempt_revision_id AND c.private_generation=c.attempt_generation
   AND c.attempt_logic_key=public.harness_operating_case_worker_key()
   AND coalesce((shown->>'current')::boolean,false) AND shown#>>'{run,id}'=run_.id::text;
  UPDATE public.harness_operating_cases SET attempt_tick_id=NULL,failure_count=0,retry_after=NULL,
   answered_generation=CASE WHEN good THEN c.attempt_generation ELSE answered_generation END,
   latest_run_id=CASE WHEN good THEN run_.id ELSE latest_run_id END WHERE id=c.id;
  RETURN jsonb_build_object('status',CASE WHEN good THEN 'answered' ELSE 'changed' END);
 END IF;
 failures:=c.failure_count+1;
 UPDATE public.harness_operating_cases SET attempt_tick_id=NULL,failure_count=failures,
  retry_after=at_+make_interval(secs=>least(3600,60*power(2,least(failures,6))::integer)) WHERE id=c.id;
 RETURN jsonb_build_object('status','failed','sqlstate',p_result->>'sqlstate');
END $$;

-- Extend the existing append-only source guard only for controller fields
-- under a real model_fold_tick frame AND its live vehicle work lease.
DO $patch$
DECLARE b text:=pg_get_functiondef('public.harness_operating_case_source_guard()'::regprocedure);
 a text:=$a$ GET DIAGNOSTICS c=PG_CONTEXT;$a$;
 z text:=$z$ IF TG_TABLE_NAME='harness_operating_cases' AND TG_OP='UPDATE'
  AND public.harness_operating_case_worker_context(NEW.vehicle_id) IS NOT NULL THEN
  IF (to_jsonb(NEW)-ARRAY['answered_generation','latest_run_id','attempt_revision_id','attempt_structural_evaluation_id',
    'attempt_scope_key','attempt_generation','attempt_dependency_key','attempt_logic_key','attempt_tick_id','attempted_at','failure_count','retry_after'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['answered_generation','latest_run_id','attempt_revision_id','attempt_structural_evaluation_id',
    'attempt_scope_key','attempt_generation','attempt_dependency_key','attempt_logic_key','attempt_tick_id','attempted_at','failure_count','retry_after']) THEN
   RAISE EXCEPTION 'worker cannot change authored recipe identity or generation' USING ERRCODE='23514'; END IF;
  IF NEW.attempt_revision_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.harness_operating_case_revisions x
   WHERE x.id=NEW.attempt_revision_id AND x.case_id=NEW.id AND x.vehicle_id=NEW.vehicle_id AND x.sealed_at IS NOT NULL
    AND x.scope_key=NEW.attempt_scope_key AND x.revision_number=NEW.attempt_generation) THEN
   RAISE EXCEPTION 'worker attempt must bind an exact sealed same-case scope/generation' USING ERRCODE='23514'; END IF;
  IF NEW.attempt_tick_id IS NOT NULL AND (NEW.attempt_tick_id IS DISTINCT FROM public.harness_operating_case_worker_context(NEW.vehicle_id)
   OR NEW.attempt_revision_id IS NULL OR NEW.attempt_structural_evaluation_id IS NULL
   OR NEW.attempt_scope_key IS NULL OR NEW.attempt_generation IS NULL
   OR NEW.attempt_dependency_key IS NULL OR NEW.attempt_dependency_key !~ '^[0-9a-f]{32}$'
   OR NEW.attempt_logic_key IS NULL OR NEW.attempt_logic_key !~ '^[0-9a-f]{32}$' OR NEW.attempted_at IS NULL) THEN
   RAISE EXCEPTION 'worker attempt lacks its real lease and complete durable context' USING ERRCODE='23514'; END IF;
  IF (NEW.answered_generation IS DISTINCT FROM OLD.answered_generation OR NEW.latest_run_id IS DISTINCT FROM OLD.latest_run_id)
   AND (NEW.answered_generation IS DISTINCT FROM NEW.private_generation
    OR NEW.current_revision_id IS DISTINCT FROM NEW.attempt_revision_id
    OR NOT EXISTS(SELECT FROM public.harness_model_dc_runs x WHERE x.id=NEW.latest_run_id AND x.case_id=NEW.id
     AND x.vehicle_id=NEW.vehicle_id AND x.revision_id=NEW.current_revision_id AND x.private_generation=NEW.answered_generation
     AND x.structural_evaluation_id=NEW.attempt_structural_evaluation_id AND x.scope_key=NEW.attempt_scope_key
     AND x.private_input_hash=NEW.attempt_dependency_key AND x.sealed_at IS NOT NULL)) THEN
   RAISE EXCEPTION 'worker answer must be the exact closed current-generation run' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 GET DIAGNOSTICS c=PG_CONTEXT;$z$;
BEGIN
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Worker source guard anchor drift'; END IF;
 EXECUTE replace(b,a,z);
END $patch$;

-- The existing evaluator remains the only run writer; permit its genuine
-- nested invocation by the existing leased tick, not a top-level wrapper.
DO $patch$
DECLARE b text:=pg_get_functiondef('public.harness_operating_case_result_guard()'::regprocedure); a text; z text;
BEGIN
 a:='DECLARE context_ text; frame_ text;';
 z:='DECLARE context_ text; frame_ text; context_lines_ text[]; previous_frame_ text;';
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Worker result declaration anchor drift'; END IF;
 b:=replace(b,a,z);
 a:=$a$ IF frame_ !~ '^PL/pgSQL function (public\.)?harness_operating_case_evaluate\(uuid,uuid\) line [0-9]+ at [^\n]+$'$a$;
 z:=$z$ context_lines_:=string_to_array(rtrim(context_,chr(10)||chr(13)),chr(10));
 previous_frame_:=context_lines_[cardinality(context_lines_)-1];
 IF (frame_ !~ '^PL/pgSQL function (public\.)?harness_operating_case_evaluate\(uuid,uuid\) line [0-9]+ at [^\n]+$'
  AND NOT coalesce(frame_ ~ '^PL/pgSQL function (public\.)?model_fold_tick\(\) line [0-9]+ at [^\n]+$'
   AND previous_frame_ ~ '^PL/pgSQL function (public\.)?harness_operating_case_evaluate\(uuid,uuid\) line [0-9]+ at SQL statement$'
   AND EXISTS(SELECT FROM public.harness_operating_cases x WHERE x.attempt_tick_id IS NOT NULL
    AND x.attempt_tick_id=public.harness_operating_case_worker_context(x.vehicle_id)),false))$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Worker result guard anchor drift'; END IF;
 b:=replace(b,a,z);
 a:=$a$ IF TG_OP='DELETE' THEN RAISE EXCEPTION 'DC history is append-only' USING ERRCODE='23514'; END IF;$a$;
 z:=$z$ IF frame_ ~ '^PL/pgSQL function (public\.)?model_fold_tick\(\) line [0-9]+ at [^\n]+$' AND TG_OP<>'DELETE' THEN
  IF TG_TABLE_NAME='harness_model_dc_runs' THEN r:=NEW;
  ELSE SELECT * INTO r FROM public.harness_model_dc_runs WHERE id=NEW.run_id; END IF;
  IF NOT EXISTS(SELECT FROM public.harness_operating_cases x WHERE x.id=r.case_id AND x.vehicle_id=r.vehicle_id
   AND x.attempt_tick_id=public.harness_operating_case_worker_context(x.vehicle_id)
   AND x.attempt_revision_id=r.revision_id AND x.attempt_generation=r.private_generation
   AND x.attempt_structural_evaluation_id=r.structural_evaluation_id AND x.attempt_scope_key=r.scope_key
   AND x.attempt_dependency_key=r.private_input_hash) THEN
   RAISE EXCEPTION 'worker result must belong to its durable exact attempt' USING ERRCODE='42501'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'DC history is append-only' USING ERRCODE='23514'; END IF;$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Worker result subject anchor drift'; END IF;
 EXECUTE replace(b,a,z);

END $patch$;

REVOKE ALL ON FUNCTION public.harness_operating_case_worker_context(uuid),public.harness_operating_case_worker_key(),
 public.harness_operating_case_worker_due(uuid,uuid),public.harness_operating_case_worker_claim(uuid,uuid,uuid),
 public.harness_operating_case_worker_finish(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
