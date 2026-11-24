-- Spec landing drain (20261124021000)
-- A queue of landing steps (read text -> plan memberships -> apply memberships) worked in short slices by a cron loop, so a
-- cohort lands without one long statement. Each queued step names its run; every run stays revertable with
-- text_code_decode_revert_v1 / data_set_membership_revert_v1. A step that fails 5 times stops as 'failed' (no retry storm);
-- each failure halves its slice.
-- Cron: spec-landing-drain-1..3, every minute, 40 s of work each (SKIP LOCKED: each worker takes a different step).
-- Revert: supabase/sql/revert_20261124021000_spec_landing_drain.sql

begin;
set local lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.spec_landing_jobs (
  job_id text PRIMARY KEY,
  step_kind text NOT NULL CHECK (step_kind IN ('decode','plan','apply')),
  run_id uuid NOT NULL,
  scope text NOT NULL,
  kinds text[],
  next_from integer NOT NULL DEFAULT 1,
  step integer NOT NULL DEFAULT 100 CHECK (step BETWEEN 1 AND 2000),
  batch integer NOT NULL DEFAULT 50 CHECK (batch BETWEEN 1 AND 500),
  depends_on text REFERENCES public.spec_landing_jobs (job_id),
  priority integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','paused')),
  errors integer NOT NULL DEFAULT 0,
  last_error text,
  last_result jsonb,
  ticks integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz
);
ALTER TABLE public.spec_landing_jobs ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.spec_landing_jobs IS
  'Landing steps worked by spec_landing_drain_v1 (20261124021000): decode = text_code_decode_v2 slices, plan = '
  'data_set_membership_plan_v2 slices, apply = data_set_membership_apply_v1 batches. Pause a step with status = ''paused''.';

CREATE OR REPLACE FUNCTION public.spec_landing_drain_v1(p_budget_ms integer DEFAULT 40000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE j public.spec_landing_jobs%ROWTYPE; r jsonb; t0 timestamptz := clock_timestamp(); n int := 0; v_done boolean;
        v_log jsonb := '[]'::jsonb;
BEGIN
  LOOP
    EXIT WHEN clock_timestamp() - t0 > make_interval(secs => p_budget_ms / 1000.0);
    SELECT s.* INTO j FROM public.spec_landing_jobs s
     WHERE s.status IN ('queued','running')
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
    EXCEPTION WHEN OTHERS THEN
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

REVOKE ALL ON FUNCTION public.spec_landing_drain_v1(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spec_landing_drain_v1(integer) TO service_role;

SELECT cron.schedule('spec-landing-drain-1', '* * * * *',
  $$SET statement_timeout = '170s'; SET lock_timeout = '5s'; SELECT public.spec_landing_drain_v1(40000);$$);
SELECT cron.schedule('spec-landing-drain-2', '* * * * *',
  $$SET statement_timeout = '170s'; SET lock_timeout = '5s'; SELECT public.spec_landing_drain_v1(40000);$$);
SELECT cron.schedule('spec-landing-drain-3', '* * * * *',
  $$SET statement_timeout = '170s'; SET lock_timeout = '5s'; SELECT public.spec_landing_drain_v1(40000);$$);

commit;
