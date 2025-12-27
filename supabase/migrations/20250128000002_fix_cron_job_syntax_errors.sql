-- ============================================================================
-- FIX CRON JOB SYNTAX ERRORS AND MISSING DEPENDENCIES
-- ============================================================================
-- Fixes:
-- 1. Remove PERFORM statements from cron jobs (PERFORM can't be used in raw SQL)
-- 2. Fix/disable jobs with missing tables/functions
-- ============================================================================

-- ============================================================================
-- FIX 1: Remove PERFORM from jobs that use wait_for_key_sync
-- PERFORM can only be used inside PL/pgSQL blocks, not in cron SQL
-- Solution: Remove the wait call - get_service_role_key_for_cron() will work
-- without it (it checks _app_secrets first, which should already be synced)
-- ============================================================================

-- Fix aggressive-backlog-clear (jobid 50)
SELECT cron.unschedule('aggressive-backlog-clear') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'aggressive-backlog-clear'
);

SELECT cron.schedule(
  'aggressive-backlog-clear',
  '*/2 * * * *', -- Every 2 minutes
  $$
  -- Auto-sync key first (non-blocking)
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/sync-service-key-to-db',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('action', 'sync'),
    timeout_milliseconds := 10000
  ) AS sync_request;

  -- Now use helper function for all requests (no PERFORM needed)
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-bat-extraction-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(get_service_role_key_for_cron(), '')
    ),
    body := jsonb_build_object('batchSize', 50, 'maxAttempts', 3),
    timeout_milliseconds := 150000
  ) AS request_id;

  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-inventory-sync-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(get_service_role_key_for_cron(), '')
    ),
    body := jsonb_build_object('batch_size', 30, 'max_attempts', 10, 'max_results', 1000, 'max_results_sold', 1000),
    timeout_milliseconds := 150000
  ) AS request_id;

  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-import-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(get_service_role_key_for_cron(), '')
    ),
    body := jsonb_build_object('batch_size', 100, 'priority_only', false, 'fast_mode', true, 'skip_image_upload', false),
    timeout_milliseconds := 150000
  ) AS request_id;
  $$
);

-- Fix process-import-queue-manual (jobid 51)
SELECT cron.unschedule('process-import-queue-manual') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-import-queue-manual'
);

SELECT cron.schedule(
  'process-import-queue-manual',
  '*/1 * * * *', -- Every minute
  $$
  -- Auto-sync key first (non-blocking)
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/sync-service-key-to-db',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('action', 'sync'),
    timeout_milliseconds := 10000
  ) AS sync_request;

  -- Now use helper function (no PERFORM needed)
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-import-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(get_service_role_key_for_cron(), '')
    ),
    body := jsonb_build_object('batch_size', 10),
    timeout_milliseconds := 60000
  ) AS request_id;
  $$
);

-- Fix daytime-extraction-pulse (jobid 49)
SELECT cron.unschedule('daytime-extraction-pulse') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'daytime-extraction-pulse'
);

SELECT cron.schedule(
  'daytime-extraction-pulse',
  '*/10 8-19 * * *', -- Every 10 minutes, 8 AM - 7 PM
  $$
  -- Auto-sync key first (non-blocking)
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/sync-service-key-to-db',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('action', 'sync'),
    timeout_milliseconds := 10000
  ) AS sync_request;
  
  -- Now use helper function (no PERFORM needed)
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-import-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(get_service_role_key_for_cron(), '')
    ),
    body := jsonb_build_object('batch_size', 30, 'priority_only', false, 'fast_mode', true, 'skip_image_upload', false),
    timeout_milliseconds := 120000
  ) AS request_id;

  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-bat-extraction-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(get_service_role_key_for_cron(), '')
    ),
    body := jsonb_build_object('batchSize', 15, 'maxAttempts', 3),
    timeout_milliseconds := 120000
  ) AS request_id;

  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/go-grinder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(get_service_role_key_for_cron(), '')
    ),
    body := jsonb_build_object('chain_depth', 4, 'seed_every', 2, 'bat_import_batch', 2, 'max_listings', 250),
    timeout_milliseconds := 60000
  ) AS request_id;
  $$
);

-- Fix overnight-extraction-pulse if it has PERFORM statement
-- Note: This job might already be fixed, but we'll check and fix if needed
-- The overnight job doesn't appear in the failure logs, so we'll leave it as-is
-- If it starts failing, it can be fixed separately

-- ============================================================================
-- FIX 2: Disable jobs with missing dependencies by unscheduling them
-- ============================================================================

-- Disable sync-active-bat-external-listings (references non-existent "targets" table)
SELECT cron.unschedule('sync-active-bat-external-listings') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sync-active-bat-external-listings'
);

-- Disable backfill-bat-external-listings (function signature mismatch)
SELECT cron.unschedule('backfill-bat-external-listings') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'backfill-bat-external-listings'
);

COMMENT ON SCHEMA public IS 'Fixed cron job syntax errors: removed PERFORM statements, disabled jobs with missing dependencies';

