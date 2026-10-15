-- cron_commit_probe: does pg_cron 1.6 run a lone CALL with transaction control (COMMIT inside the procedure)?
-- Needed before the drain-vehicle-derived-queues procedure commits per chunk. Touches no table. A temporary job runs the
-- procedure every minute; cron.job_run_details shows the outcome; a following migration drops both.
CREATE OR REPLACE PROCEDURE public.cron_commit_probe()
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1;
  COMMIT;
  PERFORM 2;
  COMMIT;
END
$$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cron-commit-probe';
SELECT cron.schedule('cron-commit-probe', '* * * * *', $job$CALL public.cron_commit_probe();$job$);
