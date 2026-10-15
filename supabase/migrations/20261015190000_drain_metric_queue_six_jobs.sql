-- drain-metric-d/e/f: three more one-minute jobs for vehicle_metric_recompute_queue, next to drain-metric-a/b/c (20261015180000).
--
-- MEASURED (prod, 2026-10-15 07:53 to 07:57Z, after drain-metric-a/b/c went live at 07:49Z): the queue read 11,004, 11,108, 11,238,
-- 11,250, 11,160 at one-minute steps, level, so three jobs (about 330 vehicles a minute at about 60 ms each) match the intake and
-- do not clear the backlog; lock waits were 0 throughout. Each job takes different rows (the drain deletes FOR UPDATE SKIP LOCKED).
-- Same command as a/b/c: a lone CALL of the chunked procedure, budget 7 s, chunks of 10.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('drain-metric-d', 'drain-metric-e', 'drain-metric-f');
SELECT cron.schedule(n, '* * * * *', $job$CALL public.drain_vehicle_metric_queue_chunked(7, 10);$job$)
FROM unnest(ARRAY['drain-metric-d', 'drain-metric-e', 'drain-metric-f']) AS n;
