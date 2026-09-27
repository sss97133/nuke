-- Job release-stale-locks (188) back on. It was paused 2026-09-27 00:04Z with 11 other jobs while prod
-- swap-thrashed on a Nano; prod runs on Medium since, and the other useful jobs came back 15:13–21:36Z.
--
-- Why it matters: claim_import_queue_batch only claims status = 'pending', so a row whose worker died
-- mid-batch (edge wall clock, pg_net timeout) stays 'processing' forever. Measured 22:25Z:
--   import_queue, BaT settlement source (4d3f0c9e…): 68 rows 'processing' since 18:35–20:59Z — 68 ended
--     auctions whose result never lands (the drain, job 504, only takes 'pending');
--   import_queue, "Bring a Trailer" source (db9ff20a…): 90 rows since 16:22–21:02Z;
--   bat_extraction_queue: 353 rows since July (no drainer runs; they only become 'pending').
-- release_stale_locks_fast(5) returns rows locked > 5 min to 'pending' (attempts kept, so claim's
-- max_attempts = 3 still bounds retries). Both scans use idx_*_status: 1.3 ms and 11.9 ms (EXPLAIN ANALYZE).
SET statement_timeout = '60s';
SET lock_timeout = '10s';

SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'release-stale-locks'),
  active := true
);

RESET lock_timeout;
RESET statement_timeout;
