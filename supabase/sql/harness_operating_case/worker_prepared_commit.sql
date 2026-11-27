-- Candidate preparation durability; no new owner or production migration.
BEGIN;
DO $candidate$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%'
  OR current_setting('server_version_num')::integer/10000<>17 THEN
  RAISE EXCEPTION 'Operating-case candidate requires a disposable PG17 contract database';
 END IF;
END $candidate$;
SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='2s';
DO $patch$
DECLARE b text:=pg_get_functiondef('public.model_fold_tick()'::regprocedure); a text; z text;
BEGIN
 a:=$a$    begin
      if v_dc_phase then
        v_dc_started:=clock_timestamp();r:=NULL;
        v_dc_prepared:=public.harness_operating_case_worker_prepare(v_tick,v_dc_case);
        if v_dc_prepared->>'status' IN('dependency_pending','backoff','budget_exhausted') then
          v_dc_finish:=v_dc_prepared;
        elsif v_dc_prepared->>'status'='changed' then
          v_dc_finish:=public.harness_operating_case_worker_finish(v_tick,v_dc_case,'{"changed":true}');
        else
        if EXISTS(select from public.harness_operating_cases c where c.id=v_dc_case$a$;
 z:=$z$    if v_dc_phase then
      v_dc_started:=clock_timestamp();r:=NULL;v_dc_error:=NULL;
      begin
        v_dc_prepared:=public.harness_operating_case_worker_prepare(v_tick,v_dc_case);
        if v_dc_prepared->>'status' IS DISTINCT FROM 'ready' then
          if v_dc_prepared->>'status'='changed' then
            v_dc_finish:=public.harness_operating_case_worker_finish(v_tick,v_dc_case,'{"changed":true}');
          else v_dc_finish:=v_dc_prepared;end if;
          insert into public.model_fold_tick_runs(tick_id,vehicle_id,fold_phase,dc_status,dc_output_retained,ms)
           values(v_tick,v_veh,'dc',v_dc_finish->>'status',false,
            round(extract(epoch from clock_timestamp()-v_dc_started)*1000)::integer);
          update public.model_fold_work set state='pending',fold_stage='vehicle_followup',attempts=greatest(0,attempts-1),
           leased_until=NULL,lease_tick=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() where vehicle_id=v_veh;
        end if;
      exception when others then
        get stacked diagnostics v_dc_error=returned_sqlstate;
        v_dc_finish:=public.harness_operating_case_worker_finish(v_tick,v_dc_case,jsonb_build_object('sqlstate',v_dc_error));
        v_dc_prepared:=jsonb_build_object('status','failed','sqlstate',v_dc_error);
        insert into public.model_fold_tick_runs(tick_id,vehicle_id,fold_phase,dc_status,dc_error_code,dc_output_retained,ms)
         values(v_tick,v_veh,'dc','failed',v_dc_error,false,
          round(extract(epoch from clock_timestamp()-v_dc_started)*1000)::integer);
        update public.model_fold_work set state='pending',fold_stage='vehicle_followup',attempts=greatest(0,attempts-1),
         leased_until=NULL,lease_tick=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() where vehicle_id=v_veh;
        n_fail:=n_fail+1;
      end;
      -- Ready retains its active case token and original work lease; every
      -- other outcome commits its cursor, telemetry and lease release together.
      commit;
    end if;
    begin
      if v_dc_phase then
        if v_dc_prepared->>'status'='ready' then
        if EXISTS(select from public.harness_operating_cases c where c.id=v_dc_case$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Durable preparation phase anchor drift'; END IF;b:=replace(b,a,z);
 a:=$a$        end if;
        insert into public.model_fold_tick_runs(tick_id,vehicle_id,fold_phase,dc_status,dc_output_retained,ms)$a$;
 z:=$z$        insert into public.model_fold_tick_runs(tick_id,vehicle_id,fold_phase,dc_status,dc_output_retained,ms)$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Ready-only output phase anchor drift'; END IF;b:=replace(b,a,z);
 a:=$a$         leased_until=NULL,lease_tick=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() where vehicle_id=v_veh;
      elsif v_harness_phase then$a$;
 z:=$z$         leased_until=NULL,lease_tick=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() where vehicle_id=v_veh;
        end if;
      elsif v_harness_phase then$z$;
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Ready-only followup phase anchor drift'; END IF;
 EXECUTE replace(b,a,z);
END $patch$;
COMMIT;
