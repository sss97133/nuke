-- Candidate implementation for schema proposal f8215459-ec38-4e2e-a855-509257740313.
-- Not an automatically deployed migration. Disposable PG17 contracts only.

BEGIN;
DO $candidate$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%'
  OR current_setting('server_version_num')::integer/10000<>17 THEN
  RAISE EXCEPTION 'Operating-case candidate requires a disposable PG17 contract database';
 END IF;
END $candidate$;
SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='2s';

CREATE OR REPLACE FUNCTION public.harness_operating_case_worker_claim(p_tick uuid,p_case uuid,p_evaluation uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.harness_operating_cases; r public.harness_operating_case_revisions; key_ text; same_ boolean;
BEGIN
 SELECT * INTO c FROM public.harness_operating_cases WHERE id=p_case FOR UPDATE;
 IF NOT FOUND OR p_tick IS NULL OR public.harness_operating_case_worker_context(c.vehicle_id) IS DISTINCT FROM p_tick THEN
  RAISE EXCEPTION 'private case claim requires its active existing worker lease' USING ERRCODE='42501'; END IF;
 IF NOT coalesce((public.model_fold_config()->>'enabled')::boolean,false)
  OR NOT public.harness_operating_case_worker_due(c.id,p_evaluation) THEN RETURN jsonb_build_object('status','not_due'); END IF;
 SELECT * INTO r FROM public.harness_operating_case_revisions WHERE id=c.current_revision_id;
 key_:=public.harness_operating_case_worker_key();
 same_:=c.attempt_revision_id IS NOT DISTINCT FROM r.id
  AND c.attempt_generation IS NOT DISTINCT FROM c.private_generation
  AND c.attempt_structural_evaluation_id IS NOT DISTINCT FROM p_evaluation AND c.attempt_logic_key IS NOT DISTINCT FROM key_;
 UPDATE public.harness_operating_cases SET attempt_revision_id=r.id,attempt_scope_key=r.scope_key,
  attempt_generation=c.private_generation,attempt_structural_evaluation_id=p_evaluation,attempt_logic_key=key_,
  attempt_dependency_key=CASE WHEN same_ THEN attempt_dependency_key END,attempt_tick_id=p_tick,attempted_at=clock_timestamp(),
  failure_count=CASE WHEN same_ THEN failure_count ELSE 0 END,retry_after=CASE WHEN same_ THEN retry_after END WHERE id=c.id;
 RETURN jsonb_build_object('status','claimed','case_id',c.id,'revision_id',r.id,'generation',c.private_generation,
  'structural_evaluation_id',p_evaluation,'worker_logic_key',key_,'preparation','pending');
END $$;

CREATE FUNCTION public.harness_operating_case_worker_prepare(p_tick uuid,p_case uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.harness_operating_cases; compiled jsonb; changed_ boolean; n integer; budget integer; state_ text;
BEGIN
 SELECT * INTO c FROM public.harness_operating_cases WHERE id=p_case;
 IF NOT FOUND OR p_tick IS NULL OR c.attempt_tick_id IS DISTINCT FROM p_tick
  OR public.harness_operating_case_worker_context(c.vehicle_id) IS DISTINCT FROM p_tick THEN
  RAISE EXCEPTION 'private preparation requires its committed existing worker attempt' USING ERRCODE='42501'; END IF;
 IF c.current_revision_id IS DISTINCT FROM c.attempt_revision_id OR c.private_generation IS DISTINCT FROM c.attempt_generation
  OR c.attempt_logic_key IS DISTINCT FROM public.harness_operating_case_worker_key() THEN
  RETURN jsonb_build_object('status','changed'); END IF;
 compiled:=public.harness_operating_case_compile(c.attempt_revision_id,c.attempt_structural_evaluation_id);
 IF compiled->'input_receipt' IS NULL OR compiled->>'private_input_hash' IS NULL THEN
  UPDATE public.harness_operating_cases SET attempt_tick_id=NULL,attempt_dependency_key=NULL,
   failure_count=0,retry_after=NULL WHERE id=c.id AND attempt_tick_id=p_tick
   AND current_revision_id=c.attempt_revision_id AND private_generation=c.attempt_generation;
  GET DIAGNOSTICS n=ROW_COUNT;
  RETURN jsonb_build_object('status',CASE WHEN n=1 THEN 'dependency_pending' ELSE 'changed' END);
 END IF;
 changed_:=c.attempt_dependency_key IS DISTINCT FROM compiled->>'private_input_hash';
 budget:=coalesce((public.model_fold_config()->>'max_attempts')::integer,5);
 state_:=CASE WHEN changed_ THEN 'ready' WHEN c.failure_count>=budget THEN 'budget_exhausted'
  WHEN c.retry_after>clock_timestamp() THEN 'backoff' ELSE 'ready' END;
 UPDATE public.harness_operating_cases SET attempt_dependency_key=compiled->>'private_input_hash',
  failure_count=CASE WHEN changed_ THEN 0 ELSE failure_count END,retry_after=CASE WHEN changed_ THEN NULL ELSE retry_after END,
  attempt_tick_id=CASE WHEN state_='ready' THEN attempt_tick_id END
  WHERE id=c.id AND attempt_tick_id=p_tick AND current_revision_id=c.attempt_revision_id AND private_generation=c.attempt_generation;
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN jsonb_build_object('status',CASE WHEN n=1 THEN state_ ELSE 'changed' END);
END $$;

DO $patch$
DECLARE b text; a text; z text;
BEGIN
 b:=pg_get_functiondef('public.harness_operating_case_worker_due(uuid,uuid)'::regprocedure);
 a:=$a$    AND (c.answered_generation IS DISTINCT FROM c.private_generation OR c.failure_count>0)$a$;
 z:=$z$    AND ((c.answered_generation IS DISTINCT FROM c.private_generation AND c.attempt_dependency_key IS NOT NULL)
     OR c.failure_count>0 OR (c.retry_after IS NOT NULL AND c.failure_count=0))$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Unprepared wait eligibility anchor drift'; END IF;
 EXECUTE replace(b,a,z);
 b:=pg_get_functiondef('public.harness_operating_case_worker_finish(uuid,uuid,jsonb)'::regprocedure);
 a:=$a$UPDATE public.harness_operating_cases SET attempt_tick_id=NULL,failure_count=0,retry_after=NULL WHERE id=c.id;$a$;
 z:=$z$UPDATE public.harness_operating_cases SET attempt_tick_id=NULL,failure_count=0,retry_after=at_ WHERE id=c.id;$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Changed-attempt fresh eligibility anchor drift'; END IF;b:=replace(b,a,z);
 a:=$a$UPDATE public.harness_operating_cases SET attempt_tick_id=NULL,failure_count=0,retry_after=NULL,
   answered_generation=$a$;
 z:=$z$UPDATE public.harness_operating_cases SET attempt_tick_id=NULL,failure_count=0,retry_after=CASE WHEN good THEN NULL ELSE at_ END,
   answered_generation=$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Historical-result fresh eligibility anchor drift'; END IF;
 EXECUTE replace(b,a,z);
 b:=pg_get_functiondef('public.harness_operating_case_source_guard()'::regprocedure);
 a:=$a$   OR NEW.attempt_dependency_key IS NULL OR NEW.attempt_dependency_key !~ '^[0-9a-f]{32}$'$a$;
 z:=$z$   OR (NEW.attempt_dependency_key IS NOT NULL AND NEW.attempt_dependency_key !~ '^[0-9a-f]{32}$')$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Unprepared durable context anchor drift'; END IF;
 EXECUTE replace(b,a,z);
 b:=pg_get_functiondef('public.harness_operating_case_worker_key()'::regprocedure);
 a:=$a$    'public.harness_operating_case_source_guard()'$a$;
 z:=$z$    'public.harness_operating_case_source_guard()',
    'public.harness_operating_case_worker_prepare(uuid,uuid)',
    'public.harness_operating_case_worker_parent(uuid)',
    'public.harness_operating_case_worker_vehicle_due(uuid)',
    'public.harness_operating_case_worker_enqueue_changed()'$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Preparation worker identity anchor drift'; END IF;
 EXECUTE replace(b,a,z);
END $patch$;

CREATE OR REPLACE FUNCTION public.harness_operating_case_worker_enqueue_changed()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE n integer; cfg jsonb:=public.model_fold_config();
BEGIN
 IF NOT coalesce((cfg->>'enabled')::boolean,false) OR NOT coalesce((cfg->>'signals_enabled')::boolean,false) THEN RETURN 0; END IF;
 INSERT INTO public.model_fold_signal(vehicle_id,reason,priority,at)
 SELECT c.vehicle_id,'harness_operating_case_changed',3,
  clock_timestamp()-make_interval(secs=>greatest(0,coalesce((cfg->>'settle_seconds')::integer,0)))
 FROM public.harness_operating_cases c
 WHERE public.harness_model_in_scope(c.vehicle_id) AND public.harness_operating_case_worker_vehicle_due(c.vehicle_id)
  AND NOT EXISTS(SELECT FROM public.model_fold_signal s WHERE s.vehicle_id=c.vehicle_id)
  AND NOT EXISTS(SELECT FROM public.model_fold_work w WHERE w.vehicle_id=c.vehicle_id AND w.state IN('pending','leased','dead'))
 GROUP BY c.vehicle_id ORDER BY min(coalesce(c.attempted_at,c.generation_changed_at)),c.vehicle_id
 LIMIT greatest(1,coalesce((cfg->>'max_vehicles')::integer,1));
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END $$;

ALTER TABLE public.model_fold_tick_runs DROP CONSTRAINT model_fold_tick_runs_dc_status_check,
 ADD CONSTRAINT model_fold_tick_runs_dc_status_check CHECK(dc_status IN('solved','held','indeterminate','inconsistent','numerical_failure',
  'reused','changed','failed','dependency_pending','backoff','budget_exhausted'));

DO $patch$
DECLARE b text:=pg_get_functiondef('public.model_fold_tick()'::regprocedure); a text; z text;
BEGIN
 a:=$a$  v_dc_started timestamptz; v_dc_error text;$a$;z:=a||' v_dc_prepared jsonb;';
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Preparation variable anchor drift'; END IF;b:=replace(b,a,z);
 a:=$a$        if EXISTS(select from public.harness_operating_cases c where c.id=v_dc_case$a$;
 z:=$z$        v_dc_prepared:=public.harness_operating_case_worker_prepare(v_tick,v_dc_case);
        if v_dc_prepared->>'status' IN('dependency_pending','backoff','budget_exhausted') then
          v_dc_finish:=v_dc_prepared;
        elsif v_dc_prepared->>'status'='changed' then
          v_dc_finish:=public.harness_operating_case_worker_finish(v_tick,v_dc_case,'{"changed":true}');
        else
        if EXISTS(select from public.harness_operating_cases c where c.id=v_dc_case$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Preparation dispatch anchor drift'; END IF;b:=replace(b,a,z);
 a:=$a$        insert into public.model_fold_tick_runs(tick_id,vehicle_id,fold_phase,dc_status,dc_output_retained,ms)$a$;
 z:=$z$        end if;
        insert into public.model_fold_tick_runs(tick_id,vehicle_id,fold_phase,dc_status,dc_output_retained,ms)$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Preparation closure anchor drift'; END IF;b:=replace(b,a,z);
 a:=$a$case when v_dc_finish->>'status'='changed' then 'changed' else r->>'status' end$a$;
 z:=$z$case when v_dc_finish->>'status' IN('changed','dependency_pending','backoff','budget_exhausted') then v_dc_finish->>'status' else r->>'status' end$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Preparation telemetry anchor drift'; END IF;b:=replace(b,a,z);
 EXECUTE b;
END $patch$;

DO $patch$
DECLARE b text:=pg_get_functiondef('public.harness_operating_case_evaluate(uuid,uuid)'::regprocedure); a text; z text;
BEGIN
 a:=$a$ SELECT id INTO existing_ FROM public.harness_model_dc_runs WHERE revision_id=c.current_revision_id$a$;
 z:=$z$ IF public.harness_operating_case_worker_context(c.vehicle_id) IS NOT NULL AND
  (c.attempt_tick_id IS DISTINCT FROM public.harness_operating_case_worker_context(c.vehicle_id)
   OR c.attempt_revision_id IS DISTINCT FROM c.current_revision_id OR c.attempt_generation IS DISTINCT FROM c.private_generation
   OR c.attempt_structural_evaluation_id IS DISTINCT FROM p_evaluation OR c.attempt_scope_key IS DISTINCT FROM compiled#>>'{input_receipt,scope_key}'
   OR c.attempt_dependency_key IS DISTINCT FROM compiled->>'private_input_hash'
   OR c.attempt_logic_key IS DISTINCT FROM public.harness_operating_case_worker_key()) THEN
  RETURN jsonb_build_object('status','dependency_changed','run_id',NULL,'qualification','conditional_simulation_only'); END IF;
 SELECT id INTO existing_ FROM public.harness_model_dc_runs WHERE revision_id=c.current_revision_id$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Prepared evaluator context anchor drift'; END IF;
 EXECUTE replace(b,a,z);
END $patch$;

COMMENT ON COLUMN public.harness_operating_cases.attempt_dependency_key IS
 'Last successfully prepared full private input hash for this exact attempt identity. NULL means source compilation has not produced a bounded receipt. It is never an answered-generation or source-qualification claim.';
REVOKE ALL ON FUNCTION public.harness_operating_case_worker_prepare(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
