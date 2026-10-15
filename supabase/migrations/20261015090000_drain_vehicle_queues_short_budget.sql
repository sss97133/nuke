-- drain-vehicle-derived-queues (cron job 500): a 10 s budget, so its queue-row locks are released within about 10 s.
--
-- MEASURED (prod, 2026-10-15 after the 03:00Z restart): ingest_bat_live_events, called by the BaT live pull, 2,561 calls,
-- mean 289 ms, max 21.6 s. Polling pg_locks while job 500 ran, the waiting ingest calls were in ShareLock transactionid
-- waits on the job's own transaction (pg_cron backend), chained through monitored_auctions tuple locks. Each observation
-- insert upserts a vehicle_metric_recompute_queue row (update_vehicle_live_metrics, update_vehicle_observation_count);
-- the drain deletes those rows FOR UPDATE SKIP LOCKED and holds them until its transaction commits, 45 to 55 s.
--
-- WHAT: the job passes p_budget_seconds := 10 (the function clamps 5..60) with statement_timeout 20 s. The function, its
-- slice logic, retry circuit and 2 s lock timeout are unchanged. A per-chunk COMMIT follows in a separate migration.
-- Cost: fewer rows per run while the budget is short (metric starts chunks only in the first half of the budget).
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobid = 500 AND jobname = 'drain-vehicle-derived-queues' AND active
                 AND schedule = '*/2 * * * *') THEN
    RAISE EXCEPTION 'cron job 500 is not the active every-2-minutes drain-vehicle-derived-queues; re-read it first';
  END IF;
END
$check$;

SELECT cron.alter_job(
  500,
  command := $job$SET statement_timeout = '20s'; SELECT public.drain_vehicle_derived_queues(p_include_value := false, p_budget_seconds := 10);$job$
);
