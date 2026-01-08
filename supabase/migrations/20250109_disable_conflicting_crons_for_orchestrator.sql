-- ============================================================================
-- DISABLE CONFLICTING CRON JOBS FOR PIPELINE ORCHESTRATOR
-- ============================================================================
-- Purpose: Disable Supabase cron jobs that conflict with the new pipeline-orchestrator
--          GitHub Action (runs every 10 minutes)
--
-- The orchestrator handles:
-- - Unlocking orphaned queue items
-- - Triggering scrapers (sync-active-auctions, extract-all-orgs-inventory)
-- - Processing queues (process-import-queue-fast, process-bat-extraction-queue)
--
-- These Supabase cron jobs conflict:
-- - process-import-queue-manual (every 1 min) - calls BROKEN process-import-queue
-- - process-bat-queue (every 1 min) - orchestrator already processes this
-- - daytime-extraction-pulse (every 10 min) - duplicates orchestrator
-- - overnight-extraction-pulse (every 3 min) - duplicates orchestrator
-- - go-grinder-continuous (every 1 min) - too frequent, orchestrator triggers go-grinder via sync-active-auctions
--
-- We KEEP:
-- - sync-active-auctions (every 15 min) - Can coexist with orchestrator (orchestrator triggers it too, but this is fine as backup)
-- - mecum-extraction-cron, premium-auction-extractor - Different sources, OK to keep
-- ============================================================================

-- Disable process-import-queue-manual (broken function + conflict)
UPDATE cron.job 
SET active = false 
WHERE jobname = 'process-import-queue-manual';

-- Disable process-bat-queue (orchestrator handles this)
UPDATE cron.job 
SET active = false 
WHERE jobname = 'process-bat-queue';

-- Disable daytime-extraction-pulse (duplicates orchestrator)
UPDATE cron.job 
SET active = false 
WHERE jobname = 'daytime-extraction-pulse';

-- Disable overnight-extraction-pulse (duplicates orchestrator)
UPDATE cron.job 
SET active = false 
WHERE jobname = 'overnight-extraction-pulse';

-- Disable go-grinder-continuous (too frequent, orchestrator triggers go-grinder via scrapers)
UPDATE cron.job 
SET active = false 
WHERE jobname = 'go-grinder-continuous';

-- Verify disabled jobs
SELECT 
  jobid, 
  jobname, 
  schedule, 
  active,
  'DISABLED (conflicts with pipeline-orchestrator)' as reason
FROM cron.job 
WHERE jobname IN (
  'process-import-queue-manual',
  'process-bat-queue',
  'daytime-extraction-pulse',
  'overnight-extraction-pulse',
  'go-grinder-continuous'
)
ORDER BY jobname;

-- Show jobs that remain ACTIVE (should be fine)
SELECT 
  jobid, 
  jobname, 
  schedule, 
  active,
  'ACTIVE (no conflict with orchestrator)' as status
FROM cron.job 
WHERE active = true
  AND jobname NOT IN (
    'process-import-queue-manual',
    'process-bat-queue',
    'daytime-extraction-pulse',
    'overnight-extraction-pulse',
    'go-grinder-continuous'
  )
ORDER BY jobname;

COMMENT ON SCHEMA public IS 'Disabled conflicting Supabase cron jobs - pipeline-orchestrator GitHub Action (every 10 min) now handles queue processing and scraper triggering';

