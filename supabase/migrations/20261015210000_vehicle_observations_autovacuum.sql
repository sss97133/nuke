-- vehicle_observations: autovacuum on a schedule that keeps index-only scans index-only.
--
-- MEASURED (prod, 2026-10-15 09:30Z): the metric drains time out on the vehicles at the head of vehicle_metric_recompute_queue.
-- The oldest 5 entries (queued 08:56Z, attempts 0, still unprocessed at 09:30Z) are vehicles with thousands of observations; for the
-- first, EXPLAIN (ANALYZE, BUFFERS) of a count capped at 400 rows ran 261 ms with "Heap Fetches: 400" and 343 disk reads
-- (about 0.76 ms each), so the uncapped count of its estimated 6,846 rows is several seconds, and the drain also counts comments
-- and runs detect_field_conflicts over the same rows. One such vehicle in a chunk outlasts the 10 s CALL, the whole CALL is
-- cancelled, its rows return to the queue, and the next run starts with the same vehicles: each a/b/c run and job 500 fails on
-- the same head. Cause of the heap fetches: the visibility map. pg_class says relallvisible 709,090 of relpages 1,369,217
-- (51.8 percent) for an 11 GB heap, and pg_stat_user_tables shows no autovacuum or autoanalyze since the 03:00Z restart. The table
-- has 12.5 million rows and the defaults (vacuum scale factor 0.2, insert scale factor 0.2) mean a run after about 2.5 million
-- changes, which a table written at this rate takes days to reach.
--
-- WHAT. Storage parameters on public.vehicle_observations only: autovacuum_vacuum_insert_scale_factor 0.005 and
-- autovacuum_vacuum_scale_factor 0.01 (a run after about 60,000 to 125,000 changes) and autovacuum_analyze_scale_factor 0.01.
-- Autovacuum then keeps the visibility map current, so counts by vehicle_id are answered from the index. No data, index,
-- compute, plan or disk setting changes; the parameters are metadata and the statement needs only a short lock.
SET lock_timeout = '5s';
ALTER TABLE public.vehicle_observations SET (
  autovacuum_vacuum_insert_scale_factor = 0.005,
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.01
);
RESET lock_timeout;
