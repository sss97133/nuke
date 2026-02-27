-- Fix: bat-snapshot-parser statement timeout
-- Root cause: cursor scans 367K rows to find 291 unparsed BAT snapshots
-- (metadata->>'parsed_at') IS NULL has no index → full sequential filter on 59GB table
-- Fix: partial index covering only unprocessed rows, makes cursor scan O(1) instead of O(367K)

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lps_bat_unparsed_fetched
  ON listing_page_snapshots (fetched_at ASC)
  WHERE platform = 'bat' AND success = true AND (metadata->>'parsed_at') IS NULL;

-- Reduce batch size from 300 → 100 so each run completes well within the 120s pg_cron limit
-- (291 rows remain → done in ~3 runs at batch 100)
SELECT cron.alter_job(
  job_id := 173,
  command := $$ SELECT parse_bat_snapshots_bulk(100); $$
);
SELECT cron.alter_job(
  job_id := 174,
  command := $$ SELECT pg_sleep(30); SELECT parse_bat_snapshots_bulk(100); $$
);
