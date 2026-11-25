-- bat-live-pull: the pause rule row live_pull.pause_run_p50_ms goes from 15000 to 30000 ms.
--
-- Rule: live_auction_sources (slug 'bat').scraping_config -> 'live_pull' -> 'pause_run_p50_ms', read by
-- bat_live_pull_run step 2b: when the median of the last 10 run_samples (the function's own wall time) is over it, the
-- run skips every page-read dispatch ("paused: run p50 N ms"). The stream handoff and the retire, board-sync and relive
-- steps still run, so a paused run costs the database nearly what an unpaused one does (06:06 PT 11-25: paused,
-- dispatched 0, run 10,798 ms).
--
-- WHY (measured 2026-11-25 06:10-06:30 PT, read-only):
--   * Basis of 15000 (20261013170000): a stall signal. The stall it was set against ran the heartbeat 138-224 s. Since
--     then cron 510 runs under statement_timeout 50s and a failed run writes no sample, so a sample is never over ~50 s:
--     the rule can no longer see that stall, only load.
--   * bat-live-pull, cron.job_run_details, 24 h to 06:13 PT: 1,440 runs, 61 failed (statement timeout), p50 3.7 s,
--     p90 18.9 s. Hourly p50 2.5-3.8 s from 07:00 to 15:00 PT 11-24 (the 11-24 closes, 10:00-15:05 PT, included),
--     8.1-14.6 s from 16:00 to 20:00 PT, 4.2-5.7 s overnight, 11.3 s at 06:00 PT 11-25. In that last stretch the samples
--     ran 0.5-39.5 s with the backend in IO DataFileRead (pg_stat_activity samples at 06:16-06:17), during
--     autovacuum of vehicles and alongside data-set-grades-backfill (every minute since 18:00 PT 11-24),
--     data-set-public-counts and model-fold-tick.
--   * Its own statements are cheap (EXPLAIN ANALYZE, warm): retire 39 ms, dispatch 1.7 s, board sync 213 ms,
--     reconcile 26 ms, relive 31 ms. The run time is shared IO load; a paused run still costs nearly the same (the up-to-6 reads a minute it would dispatch were not measured).
--   * Rolling median of the previous 10 successful cron runs over the 24 h: over 15 s in 19 minutes, over 20 s in 7,
--     over 30 s in 0. At 15000 the rule drops closing reads exactly when load is high. The 11-25 closes (189 lots,
--     10:00-13:30 PT) read at closing_slots 1 per minute and have no slack for paused minutes.
-- WHAT: 30000, still under the 50 s statement timeout, so a pause means most runs are within 20 s of failing. Written
-- only over the reviewed value 15000; any other value is left alone. The basis is kept beside it on the row.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

UPDATE public.live_auction_sources
SET scraping_config = jsonb_set(scraping_config, '{live_pull}',
      (scraping_config -> 'live_pull')
      || jsonb_build_object('pause_run_p50_ms', 30000,
           'pause_basis', jsonb_build_object(
             'migration', '20261126113500',
             'previous_ms', 15000,
             'measured', '2026-11-25 06:10-06:30 PT, cron.job_run_details jobid 510, 24 h',
             'runs', 1440, 'failed', 61, 'p50_s', 3.7, 'p90_s', 18.9,
             'rolling_p50_minutes_over', jsonb_build_object('15s', 19, '20s', 7, '30s', 0),
             'statement_timeout_s', 50)))
WHERE slug = 'bat'
  AND scraping_config #> '{live_pull,pause_run_p50_ms}' = '15000'::jsonb;

COMMIT;
