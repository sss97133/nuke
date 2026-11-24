-- Spec landing: self-feeding platform buckets (20261124029000), follow-up to 20261124026000 .. 028000.
-- spec_landing_autoqueue_v1() queues the next platform_hex buckets (decode -> plan -> apply, new run ids, priority 100 + bucket)
-- when fewer than autoqueue_low_water platform jobs are queued or running, until platform_hex_ff has jobs. A bucket that already
-- has any job is skipped. It queues nothing while the loop is paused, autoqueue is off, the layer is at its size cap, the model
-- fold loop reports backpressure, lock waiters or long queries are over their limits, or autoqueue_max_failed platform jobs
-- have failed. Cron spec-landing-autoqueue calls it every 5 minutes; one caller at a time (advisory lock).
-- Off switch: UPDATE public.spec_landing_control SET autoqueue_enabled = false WHERE id = 1;
-- Revert: supabase/sql/revert_20261124029000_spec_landing_autoqueue.sql

begin;
set local lock_timeout = '5s';

ALTER TABLE public.spec_landing_control
  ADD COLUMN IF NOT EXISTS autoqueue_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS autoqueue_batch integer NOT NULL DEFAULT 16,
  ADD COLUMN IF NOT EXISTS autoqueue_low_water integer NOT NULL DEFAULT 16,
  ADD COLUMN IF NOT EXISTS autoqueue_max_failed integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS last_autoqueue_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_autoqueue jsonb;

CREATE OR REPLACE FUNCTION public.spec_landing_autoqueue_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE ctl public.spec_landing_control%ROWTYPE; v_bytes bigint; v_fold text; v_waiters int; v_long int;
        v_open int; v_failed int; v_buckets text[]; v_out jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('spec_landing_autoqueue_v1')) THEN
    RETURN jsonb_build_object('skip', 'another caller');
  END IF;
  SELECT c.* INTO ctl FROM public.spec_landing_control c WHERE c.id = 1;
  IF NOT FOUND OR ctl.paused OR NOT ctl.autoqueue_enabled THEN
    v_out := jsonb_build_object('skip', CASE WHEN NOT FOUND THEN 'no control row' WHEN ctl.paused THEN 'paused' ELSE 'autoqueue off' END);
  ELSE
    v_bytes := pg_total_relation_size('public.vehicle_code_readings') + pg_total_relation_size('public.data_set_members')
             + pg_total_relation_size('public.data_set_member_plan');
    IF to_regprocedure('public.model_fold_backpressure(jsonb)') IS NOT NULL THEN
      BEGIN
        EXECUTE 'SELECT public.model_fold_backpressure($1)' INTO v_fold USING '{}'::jsonb;
      EXCEPTION WHEN OTHERS THEN v_fold := NULL;
      END;
    END IF;
    SELECT count(*) FILTER (WHERE a.wait_event_type = 'Lock'),
           count(*) FILTER (WHERE a.state = 'active' AND a.query_start < now() - interval '60 seconds'
                              AND a.query NOT ILIKE '%spec_landing_drain_v1%' AND a.backend_type = 'client backend')
      INTO v_waiters, v_long FROM pg_stat_activity a WHERE a.pid <> pg_backend_pid() AND a.datname = current_database();
    SELECT count(*) FILTER (WHERE s.status IN ('queued','running')), count(*) FILTER (WHERE s.status = 'failed')
      INTO v_open, v_failed FROM public.spec_landing_jobs s WHERE s.scope LIKE 'platform_hex_%';
    IF v_bytes >= ctl.max_layer_bytes THEN v_out := jsonb_build_object('skip', 'size cap', 'bytes', v_bytes);
    ELSIF v_fold IS NOT NULL THEN v_out := jsonb_build_object('skip', 'model fold backpressure', 'reason', v_fold);
    ELSIF v_waiters > ctl.max_lock_waiters OR v_long > ctl.max_long_queries THEN
      v_out := jsonb_build_object('skip', 'backpressure', 'lock_waiters', v_waiters, 'long_queries', v_long);
    ELSIF v_failed >= ctl.autoqueue_max_failed THEN v_out := jsonb_build_object('skip', 'failed jobs', 'failed', v_failed);
    ELSIF v_open >= ctl.autoqueue_low_water THEN v_out := jsonb_build_object('skip', 'enough queued', 'open', v_open);
    ELSE
      SELECT array_agg(h ORDER BY h) INTO v_buckets FROM (
        SELECT lpad(to_hex(i), 2, '0') AS h FROM generate_series(0, 255) i
         WHERE NOT EXISTS (SELECT 1 FROM public.spec_landing_jobs e WHERE e.scope = 'platform_hex_' || lpad(to_hex(i), 2, '0'))
         ORDER BY i LIMIT greatest(ctl.autoqueue_batch, 0)) z;
      IF v_buckets IS NULL THEN
        v_out := jsonb_build_object('skip', 'all buckets queued');
      ELSE
        INSERT INTO public.spec_landing_jobs (job_id, step_kind, run_id, scope, step, batch, priority, depends_on)
        SELECT 'plat_' || b.h || '_' || k.k, k.k, CASE WHEN k.k = 'decode' THEN b.dr ELSE b.mr END, 'platform_hex_' || b.h,
               CASE k.k WHEN 'decode' THEN 200 WHEN 'plan' THEN 1500 ELSE 8 END,
               CASE k.k WHEN 'decode' THEN 50 WHEN 'plan' THEN 1 ELSE 500 END,
               100 + ('x' || b.h)::bit(8)::int,
               CASE k.k WHEN 'decode' THEN NULL WHEN 'plan' THEN 'plat_' || b.h || '_decode' ELSE 'plat_' || b.h || '_plan' END
          FROM (SELECT h, gen_random_uuid() AS dr, gen_random_uuid() AS mr FROM unnest(v_buckets) h) b
         CROSS JOIN (VALUES ('decode'), ('plan'), ('apply')) k(k)
        ON CONFLICT (job_id) DO NOTHING;
        v_out := jsonb_build_object('queued', cardinality(v_buckets), 'from', v_buckets[1], 'to', v_buckets[cardinality(v_buckets)],
                                    'open_before', v_open);
      END IF;
    END IF;
  END IF;
  UPDATE public.spec_landing_control SET last_autoqueue_at = now(), last_autoqueue = v_out WHERE id = 1;
  RETURN v_out;
END
$function$;

REVOKE ALL ON FUNCTION public.spec_landing_autoqueue_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spec_landing_autoqueue_v1() TO service_role;

SELECT cron.unschedule('spec-landing-autoqueue') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'spec-landing-autoqueue');
SELECT cron.schedule('spec-landing-autoqueue', '*/5 * * * *',
  $$SET statement_timeout = '30s'; SET lock_timeout = '5s'; SELECT public.spec_landing_autoqueue_v1();$$);

commit;
