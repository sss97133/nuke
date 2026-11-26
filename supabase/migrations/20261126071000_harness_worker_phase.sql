-- Separate the measured5.1s general prelude from the3.6s harness domain.
-- Same queue, priority, leases, source predicates, controls and10s ceiling.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';

ALTER TABLE public.model_fold_work ADD COLUMN fold_stage text NOT NULL DEFAULT 'normal'
 CHECK(fold_stage IN('normal','vehicle_followup'));
COMMENT ON COLUMN public.model_fold_work.fold_stage IS 'Durable execution stage of this same work item. A due harness runs in one tick, then vehicle_followup retains the original generic work, dirty clock, reasons, edited origins and failure budget. No second queue or completed generic fold is inferred from the domain phase.';
ALTER TABLE public.model_fold_tick_runs
 ADD COLUMN fold_phase text NOT NULL DEFAULT 'vehicle' CHECK(fold_phase IN('vehicle','harness')),
 ADD COLUMN harness_status text CHECK(harness_status IN('current','source_changed','error','busy','backoff','not_in_scope')),
 ADD COLUMN harness_error_code text CHECK(harness_error_code IS NULL OR length(harness_error_code)=5),
 ADD COLUMN harness_evaluation_id uuid,
 ADD CONSTRAINT model_fold_run_harness_evaluation FOREIGN KEY(harness_evaluation_id,vehicle_id)
  REFERENCES public.harness_model_evaluations(id,vehicle_id),
 ADD CONSTRAINT model_fold_run_phase_status CHECK((fold_phase='harness')=(harness_status IS NOT NULL));
COMMENT ON COLUMN public.model_fold_tick_runs.fold_phase IS 'Actual execution phase: a general vehicle fold or an isolated harness domain. Historical rows remain vehicle folds.';
COMMENT ON COLUMN public.model_fold_tick_runs.harness_status IS 'Exact domain producer outcome; current means its structural receipt published, never that the general vehicle followup, engineering or construction is complete.';
COMMENT ON COLUMN public.model_fold_tick_runs.harness_error_code IS 'Bounded SQLSTATE returned by the domain, including a retained backoff cause. No source payload or private receipt is logged.';
COMMENT ON COLUMN public.model_fold_tick_runs.harness_evaluation_id IS 'Actual produced/reused structural receipt, bound by composite FK to this same vehicle. Null when the producer returned no evaluation.';

CREATE FUNCTION public.harness_model_due(p_vehicle_id uuid,p_logic_key text,p_max_attempts integer) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public AS $fn$
DECLARE st public.harness_model_state; lk text;
BEGIN
 IF NOT public.harness_model_in_scope(p_vehicle_id) THEN RETURN false; END IF;
 SELECT * INTO st FROM public.harness_model_state WHERE vehicle_id=p_vehicle_id;
 IF NOT FOUND THEN RETURN true; END IF;
 SELECT logic_key INTO lk FROM public.harness_model_evaluations WHERE id=st.latest_evaluation_id;
 RETURN (st.latest_evaluation_id IS NULL OR st.source_epoch IS DISTINCT FROM st.folded_epoch
   OR lk IS DISTINCT FROM p_logic_key OR st.last_error_code IS NOT NULL)
  AND(st.last_attempt_logic_key IS DISTINCT FROM p_logic_key
   OR st.source_epoch IS DISTINCT FROM st.folded_epoch AND st.failure_count=0
   OR(st.failure_count<greatest(1,coalesce(p_max_attempts,1)) AND coalesce(st.retry_after,'-infinity')<=clock_timestamp()));
END $fn$;
COMMENT ON FUNCTION public.harness_model_due(uuid,text,integer) IS 'Internal execution-due predicate shared by the existing harness seeder and worker. Current source epoch/code, error backoff/max-attempts and public execution scope only; this is not a public source hash/completeness proof. The producer still validates actual current input and code before publication.';
REVOKE ALL ON FUNCTION public.harness_model_due(uuid,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.harness_model_due(uuid,text,integer) TO service_role;

-- Preserve the source owner's exact retry/admission predicate in one function.
DO $seed$
DECLARE b text:=pg_get_functiondef('public.harness_model_enqueue_changed()'::regprocedure);
 a text:=$old$  AND (s.latest_evaluation_id IS NULL OR s.source_epoch IS DISTINCT FROM s.folded_epoch OR r.logic_key IS DISTINCT FROM lk OR s.last_error_code IS NOT NULL)
  AND (s.last_attempt_logic_key IS DISTINCT FROM lk OR s.source_epoch IS DISTINCT FROM s.folded_epoch AND s.failure_count=0
    OR (s.failure_count<greatest(1,coalesce((cfg->>'max_attempts')::int,1)) AND coalesce(s.retry_after,'-infinity')<=clock_timestamp()))$old$;
BEGIN
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'harness due predicate anchor drift'; END IF;
 EXECUTE replace(b,a,$new$  AND public.harness_model_due(s.vehicle_id,lk,(cfg->>'max_attempts')::int)$new$);
END $seed$;

-- Other direct callers retain the original behavior. The managed tick explicitly
-- delegates this one domain so generic work never re-couples the expensive fold.
DO $vehicle$
DECLARE b text:=pg_get_functiondef('public.model_fold_one(uuid,uuid,jsonb,uuid[])'::regprocedure);
 a text:=$old$  if public.harness_model_in_scope(p_vehicle) then$old$;
BEGIN
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'harness vehicle hook anchor drift'; END IF;
 EXECUTE replace(b,a,$new$  if public.harness_model_in_scope(p_vehicle)
     and not coalesce((p_cfg->>'harness_phase_isolated')::boolean,false) then$new$);
END $vehicle$;

DO $tick$
DECLARE b text:=pg_get_functiondef('public.model_fold_tick()'::regprocedure); a text; z text;
BEGIN
 FOR a,z IN SELECT * FROM(VALUES
 ($old$  v_stuck record; v_edited uuid[];$old$,$new$  v_stuck record; v_edited uuid[];
  v_stage text; v_harness_phase boolean; v_harness_key text; v_harness_started timestamptz;
  v_statement_limit interval:=current_setting('statement_timeout')::interval;$new$),
 ($old$  v_key := public.model_fold_logic_key();$old$,$new$  v_key := public.model_fold_logic_key();
  v_harness_key:=public.harness_model_logic_key();$new$),
 ($old$select w.vehicle_id, w.dirty_at, w.edited_origins into v_veh, v_dirty, v_edited$old$,
  $new$select w.vehicle_id, w.dirty_at, w.edited_origins,w.fold_stage into v_veh, v_dirty, v_edited,v_stage$new$),
 ($old$    exit when not found;
    update public.model_fold_work set state = 'leased'$old$,$new$    exit when not found;
    v_harness_phase:=v_stage='normal' AND public.harness_model_due(v_veh,v_harness_key,v_maxatt);
    if v_harness_phase and v_statement_limit>interval '0'
      and v_statement_limit-(clock_timestamp()-statement_timestamp())<v_budget then
      update public.model_fold_ticks set skip_reason='harness phase reserved for a fresh tick' where tick_id=v_tick;
      exit;
    end if;
    update public.model_fold_work set state = 'leased'$new$),
 ($old$      r := public.model_fold_one(v_tick, v_veh, cfg, v_edited);$old$,$new$      if v_harness_phase then
        v_harness_started:=clock_timestamp();
        r:=public.harness_model_fold(v_veh);
        insert into public.model_fold_tick_runs(tick_id,vehicle_id,fold_phase,harness_status,harness_error_code,harness_evaluation_id,ms)
         values(v_tick,v_veh,'harness',r->>'status',r->>'error_code',(r->>'evaluation_id')::uuid,
          round(extract(epoch from clock_timestamp()-v_harness_started)*1000)::int);
        -- Undo only this domain lease's attempt. Preserve any generic failures,
        -- dirty event, reason and edited origin until the vehicle followup runs.
        update public.model_fold_work set state='pending',fold_stage='vehicle_followup',attempts=greatest(0,attempts-1),
         leased_until=NULL,lease_tick=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp()
         where vehicle_id=v_veh;
        if r->>'status'='error' then n_fail:=n_fail+1; end if;
      else
      r := public.model_fold_one(v_tick, v_veh, cfg||jsonb_build_object('harness_phase_isolated',true), v_edited);$new$),
 ($old$state = case when dirty_at > v_dirty then 'pending' else 'done' end,$old$,
  $new$state = case when dirty_at > v_dirty OR public.harness_model_due(v_veh,v_harness_key,v_maxatt) then 'pending' else 'done' end,
             fold_stage='normal',$new$),
 ($old$priority = case when dirty_at > v_dirty then priority else 5 end,$old$,
  $new$priority = case when dirty_at > v_dirty OR public.harness_model_due(v_veh,v_harness_key,v_maxatt) then priority else 5 end,$new$),
 ($old$      n_sup := n_sup + coalesce((r ->> 'superseded')::int, 0);$old$,
  $new$      n_sup := n_sup + coalesce((r ->> 'superseded')::int, 0);
      end if;$new$),
 ($old$             leased_until = null, lease_tick = null, last_error = left(v_err, 500), updated_at = now()$old$,
  $new$             leased_until = null, lease_tick = null,fold_stage='normal', last_error = left(v_err, 500), updated_at = now()$new$),
 ($old$    commit;
  end loop;$old$,$new$    commit;
    -- A following command owns the generic work, not the remainder of this
    -- statement's clock. Its durable work row still contains every input event.
    exit when v_harness_phase OR v_stage='vehicle_followup';
  end loop;$new$)
 ) changes(old,new) LOOP
  IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'harness worker anchor drift: %',left(a,100); END IF;
  b:=replace(b,a,z);
 END LOOP;
 EXECUTE b;
END $tick$;

-- Existing vehicle metrics and reversals must not treat an immutable domain
-- receipt as a generic decode/membership run or claim to have reverted it.
DO $consumers$
DECLARE b text; a text; z text;
BEGIN
 b:=pg_get_functiondef('public.model_fold_queue_gauge()'::regprocedure);
 a:=$old$WHERE t.started_at > now() - interval '24 hours'),$old$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'worker gauge phase anchor drift'; END IF;
 b:=replace(b,a,$new$WHERE t.started_at > now() - interval '24 hours' AND r.fold_phase='vehicle'),
    'harness_phases_24h', (SELECT jsonb_build_object('runs',count(*),
      'current',count(*) FILTER(WHERE r.harness_status='current'),
      'errors',count(*) FILTER(WHERE r.harness_status='error'),
      'ms_avg',round(avg(r.ms)),'newest_at',max(r.at))
      FROM public.model_fold_tick_runs r WHERE r.fold_phase='harness' AND r.at>now()-interval '24 hours'),$new$);
 EXECUTE b;
 b:=pg_get_functiondef('public.model_fold_revert_v1(uuid)'::regprocedure);
 FOR a,z IN SELECT * FROM(VALUES
 ($old$n_runs int := 0;$old$,$new$n_runs int := 0; n_harness_retained int := 0;$new$),
 ($old$  perform set_config('model_fold.in_tick', 'on', true);$old$,
  $new$  perform set_config('model_fold.in_tick', 'on', true);
  select count(*) into n_harness_retained from public.model_fold_tick_runs where tick_id=p_tick AND fold_phase='harness';$new$),
 ($old$where tick_id = p_tick and reverted_at is null order by id desc loop$old$,
  $new$where tick_id = p_tick and reverted_at is null AND fold_phase='vehicle' order by id desc loop$new$),
 ($old$set status = 'reverted', reverted_at = now(),$old$,
  $new$set status = CASE WHEN n_runs>0 OR n_harness_retained=0 THEN 'reverted' ELSE status END,
         reverted_at = CASE WHEN n_runs>0 OR n_harness_retained=0 THEN now() ELSE reverted_at END,$new$)
 ) changes(old,new) LOOP
  IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'worker revert phase anchor drift: %',left(a,100); END IF;
  b:=replace(b,a,z);
 END LOOP;
 a:=$old$'readings_restored', n_restored)$old$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>2 THEN RAISE EXCEPTION 'worker revert receipt anchor drift'; END IF;
 b:=replace(b,a,$new$'readings_restored', n_restored,'harness_receipts_retained',n_harness_retained)$new$);
 EXECUTE b;
END $consumers$;
-- Existing function privileges, scheduling/admission controls and source
-- grants stay intact. No work item, signal or producer is invoked here.
COMMIT;
