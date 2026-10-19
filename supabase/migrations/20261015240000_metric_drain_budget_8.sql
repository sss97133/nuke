-- drain-metric-a/b/c: per-run budget 6 s -> 8 s (the procedure's maximum), chunk size stays 5.
--
-- MEASURED (prod, 2026-10-15): the three jobs run once a minute and each CALL lasts 6.2 to 8.3 s on the 6 s budget (12:57 to 13:00Z, all
-- succeeded), about 10 percent of the minute. The metric queue grew from 13,616 (11:44Z) to 18,060 (12:59Z), about 59 a minute, against
-- Mecum events of 2,637 in the last 10 minutes (about 264 a minute); drained is therefore about 200 a minute. The contention that
-- set the 6 s budget and chunks of 5 (Mecum's vehicle writes, the global NOTIFY lock removed in #1518, the visibility map at 51.8 percent
-- before #1508) is gone, and the chunk commits keep the finished work when a CALL is cut by the 10 s statement cap, so a longer budget loses at
-- most the chunk in flight (5 vehicles). No job is added; the cap stays at 10 s.
SELECT cron.alter_job(jobid, command := $job$CALL public.drain_vehicle_metric_queue_chunked(8, 5);$job$)
FROM cron.job WHERE jobname IN ('drain-metric-a', 'drain-metric-b', 'drain-metric-c');
