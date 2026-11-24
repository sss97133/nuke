-- Spec landing: yield to the model fold loop (20261124027000), follow-up to 20261124026000.
-- spec_landing_drain_v1 also asks public.model_fold_backpressure('{}') each step (when that function exists) and, while it
-- returns a reason, takes no platform_hex job; the reason is stored in spec_landing_control.last_backpressure.
-- Signature and job contract unchanged.
-- Revert: supabase/sql/revert_20261124027000_spec_fold_backpressure.sql

begin;
set local lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.spec_landing_drain_v1(p_budget_ms integer DEFAULT 40000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE j public.spec_landing_jobs%ROWTYPE; r jsonb; t0 timestamptz := clock_timestamp(); n int := 0; v_done boolean;
        v_log jsonb := '[]'::jsonb; ctl public.spec_landing_control%ROWTYPE; v_waiters int; v_long int; v_bytes bigint; v_fold text;
BEGIN
  LOOP
    EXIT WHEN clock_timestamp() - t0 > make_interval(secs => p_budget_ms / 1000.0);
    -- backpressure: a manual pause, waiting locks, long-running queries, or (for platform buckets) the size cap
    SELECT c.* INTO ctl FROM public.spec_landing_control c WHERE c.id = 1;
    IF coalesce(ctl.paused, false) THEN v_log := v_log || jsonb_build_object('skip', 'paused'); EXIT; END IF;
    SELECT count(*) FILTER (WHERE a.wait_event_type = 'Lock'),
           count(*) FILTER (WHERE a.state = 'active' AND a.query_start < now() - interval '60 seconds'
                              AND a.query NOT ILIKE '%spec_landing_drain_v1%' AND a.backend_type = 'client backend')
      INTO v_waiters, v_long FROM pg_stat_activity a WHERE a.pid <> pg_backend_pid() AND a.datname = current_database();
    IF v_waiters > coalesce(ctl.max_lock_waiters, 10) OR v_long > coalesce(ctl.max_long_queries, 8) THEN
      v_log := v_log || jsonb_build_object('skip', 'backpressure', 'lock_waiters', v_waiters, 'long_queries', v_long);
      UPDATE public.spec_landing_control SET last_backpressure_at = now(), last_backpressure = jsonb_build_object('lock_waiters', v_waiters, 'long_queries', v_long) WHERE id = 1;
      EXIT;
    END IF;
    -- the model fold loop's own backpressure (lock waiters, active backends, open circuit): while it trips, platform
    -- buckets wait; the small cohort jobs still run. Absent or failing function means no signal, not a stop.
    v_fold := NULL;
    IF to_regprocedure('public.model_fold_backpressure(jsonb)') IS NOT NULL THEN
      BEGIN
        EXECUTE 'SELECT public.model_fold_backpressure($1)' INTO v_fold USING '{}'::jsonb;
      EXCEPTION WHEN OTHERS THEN v_fold := NULL;
      END;
    END IF;
    IF v_fold IS NOT NULL THEN
      UPDATE public.spec_landing_control SET last_backpressure_at = now(), last_backpressure = jsonb_build_object('model_fold', v_fold) WHERE id = 1;
    END IF;
    v_bytes := pg_total_relation_size('public.vehicle_code_readings') + pg_total_relation_size('public.data_set_members')
             + pg_total_relation_size('public.data_set_member_plan');
    SELECT s.* INTO j FROM public.spec_landing_jobs s
     WHERE s.status IN ('queued','running')
       AND (s.scope NOT LIKE 'platform_hex_%' OR (v_bytes < coalesce(ctl.max_layer_bytes, 15000000000) AND v_fold IS NULL))
       AND (s.depends_on IS NULL OR EXISTS (SELECT 1 FROM public.spec_landing_jobs d WHERE d.job_id = s.depends_on AND d.status = 'done'))
     ORDER BY s.priority, s.created_at, s.job_id
     FOR UPDATE SKIP LOCKED LIMIT 1;
    EXIT WHEN NOT FOUND;
    BEGIN
      IF j.step_kind = 'decode' THEN
        r := public.text_code_decode_v2(j.run_id, j.scope, NULL, j.batch, j.next_from, j.step);
        v_done := coalesce((r->>'done')::boolean, false);
      ELSIF j.step_kind = 'plan' THEN
        r := public.data_set_membership_plan_v2(j.run_id, j.scope, NULL, j.kinds, j.next_from, j.step);
        v_done := coalesce((r->>'done')::boolean, false);
      ELSE
        r := public.data_set_membership_apply_v1(j.run_id, j.batch, greatest(1, least(200, j.step)), false);
        v_done := coalesce((r->>'still_planned')::int, 1) = 0;
      END IF;
      UPDATE public.spec_landing_jobs s
         SET next_from = coalesce((r->>'next_from')::int, s.next_from), status = CASE WHEN v_done THEN 'done' ELSE 'running' END,
             last_result = r, ticks = s.ticks + 1, updated_at = now(), done_at = CASE WHEN v_done THEN now() END
       WHERE s.job_id = j.job_id;
      v_log := v_log || jsonb_build_object('job', j.job_id, 'from', j.next_from, 'done', v_done);
    -- a statement timeout (query_canceled) is not in OTHERS: trap it too so the failure is counted and the slice halves
    EXCEPTION WHEN OTHERS OR query_canceled THEN
      UPDATE public.spec_landing_jobs s
         SET errors = s.errors + 1, last_error = left(SQLERRM, 500), step = greatest(s.step / 2, 1),
             status = CASE WHEN s.errors + 1 >= 5 THEN 'failed' ELSE s.status END, updated_at = now()
       WHERE s.job_id = j.job_id;
      v_log := v_log || jsonb_build_object('job', j.job_id, 'from', j.next_from, 'error', left(SQLERRM, 200));
      EXIT;
    END;
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('steps', n, 'ms', round(extract(epoch FROM clock_timestamp() - t0) * 1000), 'log', v_log);
END
$function$;

commit;
