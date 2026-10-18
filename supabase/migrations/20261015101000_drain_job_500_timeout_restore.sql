-- drain-vehicle-derived-queues (job 500): statement_timeout back to 55 s, budget 30 s.
--
-- 20261015090000 set statement_timeout 20 s with p_budget_seconds 10. MEASURED (cron.job_run_details, 2026-10-15
-- 05:02 to 05:12Z): 6 of the 8 runs after it failed, each at exactly 20.0 s with "canceling statement due to statement
-- timeout" inside a metric chunk (UPDATE vehicles ... observation_count, INSERT vehicle_live_metrics, DELETE
-- vehicle_field_consensus). The drain is one transaction, so a timeout rolls back all of the run's work: the completion
-- queue rose 2,024 (04:54Z) to 2,284 (05:08Z) and 2,406 (05:13Z). The budget only stops new chunks from starting; a chunk
-- of 10 vehicles can run longer than the 10 s budget. The shorter budget did cut the ingest waits (ingest_bat_live_events
-- mean 463 ms in 04:15 to 04:54Z, 141 ms in 04:54 to 05:08Z), so the budget stays short of the original 45 s: 30 s here.
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobid = 500 AND jobname = 'drain-vehicle-derived-queues' AND active) THEN
    RAISE EXCEPTION 'cron job 500 is not the active drain-vehicle-derived-queues; re-read it first';
  END IF;
END
$check$;
SELECT cron.alter_job(
  500,
  command := $job$SET statement_timeout = '55s'; SELECT public.drain_vehicle_derived_queues(p_include_value := false, p_budget_seconds := 30);$job$
);
