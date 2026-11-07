-- Revert of 20261111140000 (capture_set_review drain): unschedule the sweep, drop the function and the view.
-- Rows the sweep already resolved stay resolved (their evidence.resolved says who and how); nothing else was written.
DO $$
DECLARE j bigint;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN; END IF;
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'capture-review-sweep' LOOP PERFORM cron.unschedule(j); END LOOP;
END $$;
DROP VIEW IF EXISTS public.v_capture_review_backlog;
DROP FUNCTION IF EXISTS public.capture_set_review_sweep(uuid, integer);
