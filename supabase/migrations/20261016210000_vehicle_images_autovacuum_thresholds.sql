-- vehicle_images: vacuum and analyze by row counts instead of table size.
--
-- MEASURED 2026-10-15 (pg_class, pg_stat_user_tables through scripts/data/q.sh):
--   - reltuples 52,517,576; relpages 6,369,519; relallvisible 6,132,645 (96.3%). 30 indexes, 14 GB.
--   - Since the 2026-09-29 restart: 206,004 inserts, 60,989 updates (0 HOT), 0 deletes; n_dead_tup 61,713,
--     n_mod_since_analyze 262,489 (15:10Z); no vacuum or analyze of the table in that time.
--   - The table already had autovacuum_vacuum_threshold = 10000 and scale_factor = 0.01 (analyze the same), so a run
--     waits for 10,000 + 1% x 52.5M = 535,000 dead tuples (about 140 days at the measured 3,800 updates a day). Inserts
--     use the global 1,000 + 20% = 10.5M. Cron 141 weekly-analyze-vehicle-images is paused.
--   - Rows rewritten since then sit on pages that are not all-visible, so index-only scans of them fetch the heap: the
--     owner status reads took 17.8 s cold and about 1 s warm (the iOS audit of 2026-10-15, section 3), and the planner
--     estimated 9 rows where there are about 17K.
--
-- Storage parameters, mirroring #1525 (auction_events), with scale factors at 0 because any scale factor on 52.5M rows
-- is already tens of thousands of rows:
--   vacuum after 10,000 dead tuples (about 2.6 days of measured updates),
--   vacuum after 50,000 inserts (about 4 days of measured inserts; it sets the visibility map for new pages),
--   analyze after 50,000 changed rows (about 3 days).
-- autovacuum_vacuum_cost_delay = 10 stays as it is. The first run starts within a minute of this migration (61K dead,
-- 206K inserted) and reads the about 237K pages that are not all-visible (about 1.9 GB) at the throttled rate. While
-- fewer than 2% of pages (127K) hold dead items, PostgreSQL skips the index pass, so the 14 GB of indexes are not read.
-- That first run is why this deploys outside the Mecum walk (the database is disk-saturated during it).
-- SHARE UPDATE EXCLUSIVE lock: does not block reads or writes. No rewrite. fillfactor is not changed (HOT is blocked by
-- the indexed updated_at column, not by page space).
-- Revert: ALTER TABLE public.vehicle_images SET (autovacuum_vacuum_scale_factor = 0.01,
--   autovacuum_analyze_threshold = 10000, autovacuum_analyze_scale_factor = 0.01);
--   ALTER TABLE public.vehicle_images RESET (autovacuum_vacuum_insert_threshold, autovacuum_vacuum_insert_scale_factor);
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE public.vehicle_images SET (
  autovacuum_vacuum_threshold = 10000,
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_vacuum_insert_threshold = 50000,
  autovacuum_vacuum_insert_scale_factor = 0,
  autovacuum_analyze_threshold = 50000,
  autovacuum_analyze_scale_factor = 0
);

DO $$
DECLARE o text[];
BEGIN
  SELECT reloptions INTO o FROM pg_class WHERE oid = 'public.vehicle_images'::regclass;
  IF NOT (o @> ARRAY['autovacuum_vacuum_scale_factor=0', 'autovacuum_vacuum_insert_threshold=50000',
                     'autovacuum_analyze_threshold=50000', 'autovacuum_analyze_scale_factor=0']) THEN
    RAISE EXCEPTION 'vehicle_images autovacuum reloptions not set: %', o;
  END IF;
END $$;
