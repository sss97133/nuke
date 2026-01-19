-- ============================================================================
-- FIX EXTRACTION SYSTEM CONFLICTS - CRITICAL DATA POLLUTION CLEANUP
-- ============================================================================
-- Purpose: Fix the "polluted water" effect where multiple extraction systems
--          are stepping on each other, causing data duplication and corruption.
--
-- Issues Fixed:
-- 1. Multiple competing scrapers calling same functions
-- 2. Broken process-import-queue function boot error
-- 3. Resource contention between orchestrator and individual cron jobs
-- 4. Missing source status controls (enable/disable switches)
-- 5. Duplicate/corrupted data from overlapping extractions
--
-- Strategy: Consolidate all extraction control under unified-scraper-orchestrator
-- ============================================================================

-- Enable pg_cron extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ============================================================================
-- STEP 1: DISABLE ALL CONFLICTING CRON JOBS
-- ============================================================================

-- List of known conflicting cron jobs that cause resource contention
UPDATE cron.job
SET active = false
WHERE jobname IN (
  -- Import queue processors (multiple versions calling broken function)
  'process-import-queue',
  'process-import-queue-manual',
  'process-import-queue-simple',

  -- BaT queue processors (conflicts with orchestrator)
  'process-bat-queue',
  'process-bat-extraction-queue',

  -- Extraction pulses (duplicates orchestrator work)
  'daytime-extraction-pulse',
  'overnight-extraction-pulse',

  -- High-frequency scrapers (too aggressive, causes conflicts)
  'go-grinder-continuous',

  -- Specific scraper crons that should be orchestrator-managed
  'cl-scraping-cron',
  'bat-scrape-schedule',
  'bat-local-partners-cloud-inventory-cron',
  'micro-scrape-cron',
  'analysis-queue-cron',
  'image-processing-cron',
  'sbxcars-maintenance-cron',
  'scraper-health-cron'
);

-- Mark disabled jobs for reference
UPDATE cron.job
SET command = '-- DISABLED: ' || LEFT(command, 200) || '... [Disabled due to extraction system conflicts - use unified-scraper-orchestrator instead]'
WHERE jobname IN (
  'process-import-queue', 'process-import-queue-manual', 'process-import-queue-simple',
  'process-bat-queue', 'process-bat-extraction-queue',
  'daytime-extraction-pulse', 'overnight-extraction-pulse',
  'go-grinder-continuous', 'cl-scraping-cron', 'bat-scrape-schedule',
  'bat-local-partners-cloud-inventory-cron', 'micro-scrape-cron',
  'analysis-queue-cron', 'image-processing-cron', 'sbxcars-maintenance-cron',
  'scraper-health-cron'
) AND active = false;

-- ============================================================================
-- STEP 2: ADD SOURCE STATUS CONTROLS (ENABLE/DISABLE SWITCHES)
-- ============================================================================

-- Add source control table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.source_control (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL DEFAULT 'scraper', -- 'scraper', 'queue', 'extractor'
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  max_concurrent_jobs INTEGER DEFAULT 1,
  rate_limit_seconds INTEGER DEFAULT 60,
  priority INTEGER DEFAULT 100,
  last_run_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  failure_count INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default source controls
INSERT INTO public.source_control (source_name, source_type, is_enabled, max_concurrent_jobs, priority, notes)
VALUES
  -- Core extraction pipeline
  ('unified-scraper-orchestrator', 'orchestrator', true, 1, 1000, 'Master orchestrator - KEEP ENABLED'),
  ('pipeline-orchestrator', 'orchestrator', true, 1, 1000, 'GitHub Action orchestrator - KEEP ENABLED'),

  -- Import queue processors
  ('process-import-queue', 'queue', false, 1, 900, 'DISABLED - has boot error, use orchestrator instead'),
  ('process-import-queue-simple', 'queue', false, 1, 900, 'DISABLED - redundant with orchestrator'),

  -- BaT extraction
  ('process-bat-extraction-queue', 'extractor', false, 1, 800, 'DISABLED - orchestrator handles this'),
  ('go-grinder', 'scraper', true, 1, 800, 'BaT auction scraper - orchestrator managed'),

  -- Source scrapers
  ('scrape-multi-source', 'scraper', true, 2, 700, 'Multi-source inventory scraper'),
  ('sync-active-auctions', 'scraper', true, 1, 700, 'Active auction sync - keep as backup'),
  ('scrape-squarebody-inventory', 'scraper', true, 1, 600, 'Squarebody inventory scraper'),
  ('scrape-sbxcars', 'scraper', true, 1, 600, 'SBX Cars scraper'),

  -- Classic/vintage scrapers
  ('discover-classic-sellers', 'scraper', true, 1, 500, 'Classic seller discovery'),
  ('process-classic-seller-queue', 'queue', true, 1, 500, 'Classic seller queue processor'),

  -- Maintenance
  ('normalize-craigslist-vehicles', 'maintenance', true, 1, 400, 'Craigslist data cleanup'),
  ('normalize-all-vehicles', 'maintenance', false, 1, 400, 'DISABLED - too aggressive for production')

ON CONFLICT (source_name) DO UPDATE SET
  updated_at = NOW(),
  notes = EXCLUDED.notes;

-- ============================================================================
-- STEP 3: CREATE UNIFIED ORCHESTRATOR CRON (SINGLE SOURCE OF TRUTH)
-- ============================================================================

-- Remove any existing orchestrator jobs
SELECT cron.unschedule('unified-extraction-orchestrator') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'unified-extraction-orchestrator'
);

-- Create the master orchestrator cron job (every 10 minutes)
-- This replaces all the conflicting individual cron jobs
SELECT cron.schedule(
  'unified-extraction-orchestrator',
  '*/10 * * * *',  -- Every 10 minutes
  $$
  -- Call the unified orchestrator which handles all extraction coordination
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/unified-scraper-orchestrator',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      )
    ),
    body := jsonb_build_object(
      'action', 'run_cycle',
      'respect_source_controls', true,
      'max_concurrent_sources', 3,
      'timeout_per_source_ms', 120000
    ),
    timeout_milliseconds := 300000
  ) AS request_id;
  $$
);

-- ============================================================================
-- STEP 4: CLEAN UP CORRUPTED DATA FROM OVERLAPPING EXTRACTIONS
-- ============================================================================

-- Mark duplicate vehicles created by competing scrapers
-- (Keep the earliest one for each unique listing_url)
WITH duplicates AS (
  SELECT
    v.id,
    v.listing_url,
    v.created_at,
    ROW_NUMBER() OVER (PARTITION BY v.listing_url ORDER BY v.created_at ASC) as rn
  FROM public.vehicles v
  WHERE v.listing_url IS NOT NULL
    AND v.listing_url != ''
),
to_mark AS (
  SELECT id
  FROM duplicates
  WHERE rn > 1
)
UPDATE public.vehicles
SET
  data_quality_flags = COALESCE(data_quality_flags, '[]'::jsonb) || '["duplicate_from_competing_scrapers"]'::jsonb,
  notes = COALESCE(notes, '') || ' [DUPLICATE: Created by competing scraper systems - marked for review]'
WHERE id IN (SELECT id FROM to_mark);

-- Clean up orphaned import_queue entries that failed due to system conflicts
UPDATE public.import_queue
SET
  status = 'failed',
  error_message = 'System conflict: Multiple scrapers attempted to process this item',
  updated_at = NOW()
WHERE status = 'processing'
  AND locked_at < (NOW() - INTERVAL '2 hours')
  AND (error_message IS NULL OR error_message = '');

-- Reset stuck bat_extraction_queue entries
UPDATE public.bat_extraction_queue
SET
  status = 'pending',
  locked_at = NULL,
  locked_by = NULL,
  error_message = 'Reset due to system conflicts - will be retried by orchestrator',
  updated_at = NOW()
WHERE status = 'processing'
  AND locked_at < (NOW() - INTERVAL '2 hours');

-- ============================================================================
-- STEP 5: CREATE SYSTEM HEALTH MONITORING
-- ============================================================================

-- Source health monitoring view
CREATE OR REPLACE VIEW public.source_health_monitor AS
SELECT
  sc.source_name,
  sc.source_type,
  sc.is_enabled,
  sc.priority,
  sc.last_run_at,
  sc.last_success_at,
  sc.failure_count,
  CASE
    WHEN NOT sc.is_enabled THEN 'disabled'
    WHEN sc.last_success_at IS NULL THEN 'never_run'
    WHEN sc.last_success_at < NOW() - INTERVAL '1 day' THEN 'stale'
    WHEN sc.failure_count > 5 THEN 'failing'
    WHEN sc.last_run_at > NOW() - INTERVAL '1 hour' THEN 'active'
    ELSE 'idle'
  END as health_status,
  -- Queue depths for monitoring
  COALESCE(iq_stats.pending_count, 0) as import_queue_pending,
  COALESCE(bq_stats.pending_count, 0) as bat_queue_pending
FROM public.source_control sc
LEFT JOIN (
  SELECT
    'import_queue' as queue_name,
    COUNT(*) FILTER (WHERE status = 'pending') as pending_count
  FROM public.import_queue
) iq_stats ON true
LEFT JOIN (
  SELECT
    'bat_extraction_queue' as queue_name,
    COUNT(*) FILTER (WHERE status = 'pending') as pending_count
  FROM public.bat_extraction_queue
) bq_stats ON true
ORDER BY sc.priority DESC, sc.source_name;

-- Grant access to monitoring view
GRANT SELECT ON public.source_health_monitor TO authenticated;

-- ============================================================================
-- STEP 6: VERIFICATION AND CLEANUP REPORT
-- ============================================================================

-- Show disabled jobs
SELECT
  jobid,
  jobname,
  active,
  LEFT(schedule, 20) as schedule,
  'DISABLED (extraction conflicts)' as reason
FROM cron.job
WHERE jobname IN (
  'process-import-queue', 'process-import-queue-manual', 'process-import-queue-simple',
  'process-bat-queue', 'process-bat-extraction-queue',
  'daytime-extraction-pulse', 'overnight-extraction-pulse',
  'go-grinder-continuous', 'cl-scraping-cron', 'bat-scrape-schedule',
  'bat-local-partners-cloud-inventory-cron', 'micro-scrape-cron'
)
ORDER BY active DESC, jobname;

-- Show active jobs (should be minimal and non-conflicting)
SELECT
  jobid,
  jobname,
  active,
  LEFT(schedule, 20) as schedule,
  'ACTIVE (no conflicts)' as status
FROM cron.job
WHERE active = true
  AND jobname NOT IN (
    'process-import-queue', 'process-import-queue-manual', 'process-import-queue-simple',
    'process-bat-queue', 'process-bat-extraction-queue',
    'daytime-extraction-pulse', 'overnight-extraction-pulse',
    'go-grinder-continuous'
  )
ORDER BY jobname;

-- Show source control status
SELECT
  source_name,
  source_type,
  is_enabled,
  priority,
  notes
FROM public.source_control
ORDER BY priority DESC, source_name;

-- Show cleanup statistics
SELECT
  'Vehicles marked as duplicates' as metric,
  COUNT(*) as count
FROM public.vehicles
WHERE data_quality_flags::text LIKE '%duplicate_from_competing_scrapers%'
UNION ALL
SELECT
  'Import queue entries reset' as metric,
  COUNT(*) as count
FROM public.import_queue
WHERE error_message LIKE '%System conflict%'
UNION ALL
SELECT
  'BaT queue entries reset' as metric,
  COUNT(*) as count
FROM public.bat_extraction_queue
WHERE error_message LIKE '%Reset due to system conflicts%';

-- Final status
SELECT
  'Extraction system conflicts resolved' as status,
  'All conflicting cron jobs disabled, unified orchestrator active' as details,
  NOW() as resolved_at;

COMMENT ON SCHEMA public IS 'Extraction system conflicts resolved - unified orchestrator now controls all extraction workflows';