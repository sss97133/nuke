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

CREATE FUNCTION public.harness_operating_case_worker_recover(p_tick uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ctx text; frame_ text; w record; c public.harness_operating_cases; n integer:=0; at_ timestamptz:=clock_timestamp();
BEGIN
 GET DIAGNOSTICS ctx=PG_CONTEXT;
 frame_:=regexp_replace(regexp_replace(ctx,E'[\n\r]+$',''),E'^.*\n','','s');
 IF p_tick IS NULL OR frame_ !~ '^PL/pgSQL function (public\.)?model_fold_tick\(\) line [0-9]+ at [^\n]+$'
  OR NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=to_regprocedure('public.model_fold_tick()') AND p.prokind='p'
   AND p.proowner=current_user::regrole)
  OR NOT EXISTS(SELECT FROM public.model_fold_ticks t WHERE t.tick_id=p_tick AND t.status='running' AND t.pid=pg_backend_pid()) THEN
  RAISE EXCEPTION 'private recovery requires the actual new existing tick' USING ERRCODE='42501'; END IF;
 FOR w IN SELECT q.* FROM public.model_fold_work q LEFT JOIN public.model_fold_ticks old ON old.tick_id=q.lease_tick
  WHERE q.state='leased' AND (old.status='stale' OR q.leased_until<clock_timestamp()) AND EXISTS(SELECT FROM public.harness_operating_cases x
   WHERE x.vehicle_id=q.vehicle_id AND x.attempt_tick_id=q.lease_tick)
  ORDER BY q.vehicle_id FOR UPDATE OF q SKIP LOCKED LOOP
  FOR c IN SELECT * FROM public.harness_operating_cases x WHERE x.vehicle_id=w.vehicle_id AND x.attempt_tick_id=w.lease_tick
   ORDER BY x.id FOR UPDATE LOOP
   UPDATE public.harness_operating_cases SET attempt_tick_id=NULL,failure_count=failure_count+1,
    retry_after=at_+make_interval(secs=>least(3600,60*power(2,least(failure_count+1,6))::integer)) WHERE id=c.id;
   INSERT INTO public.model_fold_tick_runs(tick_id,vehicle_id,fold_phase,dc_status,dc_output_retained)
    VALUES(p_tick,c.vehicle_id,'dc','abandoned',false);
   n:=n+1;
  END LOOP;
  -- This vehicle lease counted one generic attempt, even if inconsistent
  -- historical controller rows named it more than once. Undo it only once.
  UPDATE public.model_fold_work SET state='pending',fold_stage='vehicle_followup',attempts=greatest(0,attempts-1),
   leased_until=NULL,lease_tick=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp()
   WHERE vehicle_id=w.vehicle_id AND state='leased' AND lease_tick=w.lease_tick;
  IF NOT FOUND THEN RAISE EXCEPTION 'private abandoned lease changed during recovery' USING ERRCODE='40001'; END IF;
 END LOOP;
 RETURN n;
END $$;

ALTER TABLE public.model_fold_tick_runs DROP CONSTRAINT model_fold_tick_runs_dc_status_check,
 ADD CONSTRAINT model_fold_tick_runs_dc_status_check CHECK(dc_status IN('solved','held','indeterminate','inconsistent','numerical_failure',
  'reused','changed','failed','dependency_pending','backoff','budget_exhausted','abandoned'));

DO $patch$
DECLARE b text:=pg_get_functiondef('public.harness_operating_case_source_guard()'::regprocedure); a text; z text;
BEGIN
 a:='DECLARE c text; writer_frame text;';z:=a||' recovery_lines_ text[]; recovery_frame_ text;';
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Recovery guard declaration anchor drift'; END IF;b:=replace(b,a,z);
 a:=$a$ IF TG_TABLE_NAME='harness_operating_cases' AND TG_OP='UPDATE'
  AND public.harness_operating_case_worker_context(NEW.vehicle_id) IS NOT NULL THEN$a$;
 z:=$z$ IF TG_TABLE_NAME='harness_operating_cases' AND TG_OP='UPDATE' THEN
  GET DIAGNOSTICS c=PG_CONTEXT;
  recovery_lines_:=string_to_array(rtrim(c,chr(10)||chr(13)),chr(10));
  writer_frame:=recovery_lines_[cardinality(recovery_lines_)];recovery_frame_:=recovery_lines_[cardinality(recovery_lines_)-1];
  IF coalesce(writer_frame ~ '^PL/pgSQL function (public\.)?model_fold_tick\(\) line [0-9]+ at [^\n]+$'
   AND recovery_frame_ ~ '^PL/pgSQL function (public\.)?harness_operating_case_worker_recover\(uuid\) line [0-9]+ at SQL statement$'
   AND EXISTS(SELECT FROM pg_proc p WHERE p.oid=to_regprocedure('public.harness_operating_case_worker_recover(uuid)')
    AND p.prosecdef AND p.proowner=current_user::regrole)
   AND EXISTS(SELECT FROM pg_proc p WHERE p.oid=to_regprocedure('public.model_fold_tick()')
    AND p.prokind='p' AND p.proowner=current_user::regrole)
   AND EXISTS(SELECT FROM public.model_fold_ticks t WHERE t.status='running' AND t.pid=pg_backend_pid()),false) THEN
   IF OLD.attempt_tick_id IS NULL OR NEW.attempt_tick_id IS NOT NULL OR NEW.failure_count<>OLD.failure_count+1
    OR NEW.retry_after IS NULL OR NOT isfinite(NEW.retry_after) OR NEW.retry_after<=clock_timestamp()
    OR (to_jsonb(NEW)-ARRAY['attempt_tick_id','failure_count','retry_after'])
     IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['attempt_tick_id','failure_count','retry_after'])
    OR NOT EXISTS(SELECT FROM public.model_fold_work w LEFT JOIN public.model_fold_ticks t ON t.tick_id=w.lease_tick
     WHERE w.vehicle_id=OLD.vehicle_id AND w.state='leased' AND w.lease_tick=OLD.attempt_tick_id
      AND (t.status='stale' OR w.leased_until<clock_timestamp())) THEN
    RAISE EXCEPTION 'recovery can only charge its exact abandoned attempt once' USING ERRCODE='23514'; END IF;
   RETURN NEW;
  END IF;
 END IF;
 IF TG_TABLE_NAME='harness_operating_cases' AND TG_OP='UPDATE'
  AND public.harness_operating_case_worker_context(NEW.vehicle_id) IS NOT NULL THEN$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Recovery source guard anchor drift'; END IF;
 EXECUTE replace(b,a,z);
END $patch$;

DO $patch$
DECLARE b text:=pg_get_functiondef('public.model_fold_tick()'::regprocedure); a text; z text;
BEGIN
 a:=$a$  v_dc_started timestamptz; v_dc_error text; v_dc_prepared jsonb;$a$;
 z:=a||' v_dc_staled uuid[]; v_dc_recovered integer;';
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Recovery tick declaration anchor drift'; END IF;b:=replace(b,a,z);
 a:=$a$  with st as (update public.model_fold_ticks set status = 'stale', finished_at = clock_timestamp(),
                     error = coalesce(error, 'tick ended without finishing (timeout or cancel)')
               where status = 'running' returning tick_id)
  update public.model_fold_work w set state = case when w.attempts >= v_maxatt then 'dead' else 'pending' end,
         next_attempt_at = now() + make_interval(secs => least(3600, 60 * power(2, w.attempts)::int)),
         leased_until = null, lease_tick = null, last_error = 'tick ended while folding this vehicle (timeout or cancel)', updated_at = now()
    from st where w.state = 'leased' and w.lease_tick = st.tick_id;
  insert into public.model_fold_ticks (tick_id, status, pid) values (v_tick, 'running', pg_backend_pid());$a$;
 z:=$z$  with st as (update public.model_fold_ticks set status='stale',finished_at=clock_timestamp(),
      error=coalesce(error,'tick ended without finishing (timeout or cancel)') where status='running' returning tick_id)
  select coalesce(array_agg(tick_id),'{}'::uuid[]) into v_dc_staled from st;
  insert into public.model_fold_ticks(tick_id,status,pid) values(v_tick,'running',pg_backend_pid());
  v_dc_recovered:=public.harness_operating_case_worker_recover(v_tick);
  update public.model_fold_work w set state=case when w.attempts>=v_maxatt then 'dead' else 'pending' end,
   next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,w.attempts)::int)),leased_until=NULL,lease_tick=NULL,
   last_error='tick ended while folding this vehicle (timeout or cancel)',updated_at=now()
   from unnest(v_dc_staled) st(tick_id) where w.state='leased' AND w.lease_tick=st.tick_id;$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Recovery stale work anchor drift'; END IF;
 b:=replace(b,a,z);
 a:=$a$       where w.state = 'leased' and w.lease_tick = v_stuck.tick_id;$a$;
 z:=$z$       where w.state = 'leased' and w.lease_tick = v_stuck.tick_id
        AND NOT EXISTS(select from public.harness_operating_cases c where c.vehicle_id=w.vehicle_id AND c.attempt_tick_id=w.lease_tick);$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Private stuck lease preservation anchor drift'; END IF;b:=replace(b,a,z);
 a:=$a$  -- Leases left by a tick that died: back to pending (their attempt already counted).$a$;
 z:=$z$  v_dc_recovered:=public.harness_operating_case_worker_recover(v_tick);
  -- Leases left by a tick that died: back to pending (their attempt already counted).$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Private expired lease recovery anchor drift'; END IF;b:=replace(b,a,z);
 a:=$a$   where state = 'leased' and leased_until < now();$a$;
 z:=$z$   where state = 'leased' and leased_until < now()
    AND NOT EXISTS(select from public.harness_operating_cases c where c.vehicle_id=model_fold_work.vehicle_id
     AND c.attempt_tick_id=model_fold_work.lease_tick);$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Private expired lease preservation anchor drift'; END IF;
 EXECUTE replace(b,a,z);

END $patch$;

DO $patch$
DECLARE b text:=pg_get_functiondef('public.harness_operating_case_worker_key()'::regprocedure);
 a text:=$a$    'public.harness_operating_case_worker_enqueue_changed()'$a$;
 z text:=$z$    'public.harness_operating_case_worker_enqueue_changed()',
    'public.harness_operating_case_worker_recover(uuid)'$z$;
BEGIN
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Recovery worker identity anchor drift'; END IF;
 EXECUTE replace(b,a,z);
END $patch$;

REVOKE ALL ON FUNCTION public.harness_operating_case_worker_recover(uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
