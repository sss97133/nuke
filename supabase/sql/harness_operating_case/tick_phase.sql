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

CREATE FUNCTION public.harness_operating_case_worker_parent(p_vehicle uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE evaluation_ uuid; hash_ text; receipt_ jsonb;
BEGIN
 SELECT e.id,e.input_hash INTO evaluation_,hash_ FROM public.harness_model_state s
  JOIN public.harness_model_evaluations e ON e.id=s.latest_evaluation_id AND e.vehicle_id=s.vehicle_id
  WHERE s.vehicle_id=p_vehicle;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- Reuse the canonical completeness/epoch/code predicate as a cheap dispatch
 -- filter. The compiler still verifies the actual current input hash.
 receipt_:=public.harness_model_receipt_for_hash(p_vehicle,hash_);
 RETURN CASE WHEN receipt_->>'id'=evaluation_::text THEN evaluation_ END;
END $$;

CREATE FUNCTION public.harness_operating_case_worker_vehicle_due(p_vehicle uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE evaluation_ uuid;
BEGIN
 evaluation_:=public.harness_operating_case_worker_parent(p_vehicle);
 IF evaluation_ IS NULL THEN RETURN false; END IF;
 RETURN EXISTS(SELECT FROM public.harness_operating_cases c WHERE c.vehicle_id=p_vehicle
  AND public.harness_operating_case_worker_due(c.id,evaluation_));
END $$;

CREATE FUNCTION public.harness_operating_case_worker_enqueue_changed()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE n integer; cfg jsonb:=public.model_fold_config();
BEGIN
 IF NOT coalesce((cfg->>'enabled')::boolean,false) OR NOT coalesce((cfg->>'signals_enabled')::boolean,false) THEN RETURN 0; END IF;
 INSERT INTO public.model_fold_signal(vehicle_id,reason,priority)
 SELECT v.vehicle_id,'harness_operating_case_changed',3 FROM(
  SELECT DISTINCT c.vehicle_id FROM public.harness_operating_cases c
   WHERE public.harness_model_in_scope(c.vehicle_id)
    AND public.harness_operating_case_worker_vehicle_due(c.vehicle_id)
   ORDER BY c.vehicle_id LIMIT 500) v;
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END $$;

ALTER TABLE public.model_fold_tick_runs
 DROP CONSTRAINT model_fold_tick_runs_fold_phase_check,
 ADD CONSTRAINT model_fold_tick_runs_fold_phase_check CHECK(fold_phase IN('vehicle','harness','dc')),
 ADD COLUMN dc_status text CHECK(dc_status IN('solved','held','indeterminate','inconsistent','numerical_failure','reused','changed','failed')),
 ADD COLUMN dc_error_code text CHECK(dc_error_code IS NULL OR dc_error_code ~ '^[0-9A-Z]{5}$'),
 ADD COLUMN dc_output_retained boolean NOT NULL DEFAULT false,
 ADD CONSTRAINT model_fold_run_dc_phase_status CHECK((fold_phase='dc')=(dc_status IS NOT NULL)),
 ADD CONSTRAINT model_fold_run_dc_retained CHECK(NOT dc_output_retained OR fold_phase='dc');
COMMENT ON COLUMN public.model_fold_tick_runs.dc_status IS
 'Opaque private DC phase outcome only. No case identifier, parameters, run identifier or raw exception is exposed here.';

DO $patch$
DECLARE b text:=pg_get_functiondef('public.model_fold_tick()'::regprocedure); a text; z text;
BEGIN
 FOR a,z IN SELECT * FROM(VALUES
 ($a$  v_statement_limit interval:=current_setting('statement_timeout')::interval;$a$,
  $z$  v_statement_limit interval:=current_setting('statement_timeout')::interval;
  v_dc_case uuid; v_dc_evaluation uuid; v_dc_phase boolean; v_dc_claim jsonb; v_dc_finish jsonb;
  v_dc_started timestamptz; v_dc_error text;$z$),
 ($a$  perform public.harness_model_enqueue_changed();$a$,
  $z$  perform public.harness_model_enqueue_changed();
  perform public.harness_operating_case_worker_enqueue_changed();$z$),
 ($a$    if v_harness_phase and v_statement_limit>interval '0'$a$,
  $z$    v_dc_case:=NULL;v_dc_evaluation:=NULL;v_dc_phase:=false;
    if v_stage='normal' AND NOT v_harness_phase then
      v_dc_evaluation:=public.harness_operating_case_worker_parent(v_veh);
      if v_dc_evaluation IS NOT NULL then
        select c.id into v_dc_case from public.harness_operating_cases c where c.vehicle_id=v_veh
          AND public.harness_operating_case_worker_due(c.id,v_dc_evaluation)
          order by c.attempted_at NULLS FIRST,c.generation_changed_at,c.id limit 1 for update skip locked;
        v_dc_phase:=v_dc_case IS NOT NULL;
      end if;
    end if;
    if (v_harness_phase OR v_dc_phase) and v_statement_limit>interval '0'$z$),
 ($a$    commit;
    n_claim := n_claim + 1;$a$,
  $z$    if v_dc_phase then
      v_dc_claim:=public.harness_operating_case_worker_claim(v_tick,v_dc_case,v_dc_evaluation);
      v_dc_phase:=v_dc_claim->>'status'='claimed';
    end if;
    commit;
    n_claim := n_claim + 1;$z$),
 ($a$      if v_harness_phase then$a$,
  $z$      if v_dc_phase then
        v_dc_started:=clock_timestamp();r:=NULL;
        if EXISTS(select from public.harness_operating_cases c where c.id=v_dc_case
          AND c.current_revision_id=c.attempt_revision_id AND c.private_generation=c.attempt_generation) then
          r:=public.harness_operating_case_evaluate(v_dc_case,v_dc_evaluation);
          if r->>'run_id' IS NULL then
            v_dc_finish:=public.harness_operating_case_worker_finish(v_tick,v_dc_case,'{"changed":true}');
          else v_dc_finish:=public.harness_operating_case_worker_finish(v_tick,v_dc_case,r);end if;
        else v_dc_finish:=public.harness_operating_case_worker_finish(v_tick,v_dc_case,'{"changed":true}');end if;
        insert into public.model_fold_tick_runs(tick_id,vehicle_id,fold_phase,dc_status,dc_output_retained,ms)
         values(v_tick,v_veh,'dc',case when v_dc_finish->>'status'='changed' then 'changed' else r->>'status' end,
          r->>'run_id' IS NOT NULL,round(extract(epoch from clock_timestamp()-v_dc_started)*1000)::integer);
        update public.model_fold_work set state='pending',fold_stage='vehicle_followup',attempts=greatest(0,attempts-1),
         leased_until=NULL,lease_tick=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() where vehicle_id=v_veh;
      elsif v_harness_phase then$z$),
 ($a$dirty_at > v_dirty OR public.harness_model_due(v_veh,v_harness_key,v_maxatt)$a$,
  $z$dirty_at > v_dirty OR public.harness_model_due(v_veh,v_harness_key,v_maxatt)
        OR public.harness_operating_case_worker_vehicle_due(v_veh)$z$),
 ($a$      get stacked diagnostics v_err = message_text;$a$,
  $z$      if v_dc_phase then
        get stacked diagnostics v_dc_error=returned_sqlstate;
        perform public.harness_operating_case_worker_finish(v_tick,v_dc_case,jsonb_build_object('sqlstate',v_dc_error));
        insert into public.model_fold_tick_runs(tick_id,vehicle_id,fold_phase,dc_status,dc_error_code,ms)
         values(v_tick,v_veh,'dc','failed',v_dc_error,round(extract(epoch from clock_timestamp()-v_dc_started)*1000)::integer);
        update public.model_fold_work set state='pending',fold_stage='vehicle_followup',attempts=greatest(0,attempts-1),
         leased_until=NULL,lease_tick=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() where vehicle_id=v_veh;
        n_fail:=n_fail+1;
      else
      get stacked diagnostics v_err = message_text;$z$),
 ($a$      if v_att >= v_maxatt then n_dead := n_dead + 1; end if;$a$,
  $z$      if v_att >= v_maxatt then n_dead := n_dead + 1; end if;
      end if;$z$),
 ($a$    exit when v_harness_phase OR v_stage='vehicle_followup';$a$,
  $z$    exit when v_harness_phase OR v_dc_phase OR v_stage='vehicle_followup';$z$)
 ) p(old,new) LOOP
  IF (length(b)-length(replace(b,a,'')))/length(a)<>(CASE WHEN a LIKE 'dirty_at >%' THEN 2 ELSE 1 END) THEN
   RAISE EXCEPTION 'Private tick phase anchor drift: %',left(a,80); END IF;
  b:=replace(b,a,z);
 END LOOP;
 EXECUTE b;
END $patch$;

REVOKE ALL ON FUNCTION public.harness_operating_case_worker_parent(uuid),
 public.harness_operating_case_worker_vehicle_due(uuid),public.harness_operating_case_worker_enqueue_changed()
 FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
