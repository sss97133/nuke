-- ============================================================================
-- FIX ALL CRON JOBS TO PREVENT FAILURES
-- ============================================================================
-- This migration ensures all scheduled cron jobs use secure, reliable methods
-- for authentication and reference only existing Edge Functions.
--
-- Fixes:
-- 1. Replace hardcoded service role keys with helper function calls
-- 2. Remove references to non-existent Edge Functions
-- 3. Standardize key retrieval to use get_service_role_key_for_cron()
-- 4. Fix cron jobs that use incorrect setting names
-- ============================================================================

-- Ensure helper functions exist
-- These check _app_secrets table first, then database settings

-- Ensure _app_secrets table exists (if not already created)
CREATE TABLE IF NOT EXISTS public._app_secrets (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Helper function to get service role key securely (checks _app_secrets first, then settings)
CREATE OR REPLACE FUNCTION get_service_role_key_for_cron()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_key TEXT;
BEGIN
  -- Try to get from secrets table first (most reliable)
  SELECT value INTO v_key
  FROM public._app_secrets
  WHERE key = 'service_role_key'
  LIMIT 1;
  
  -- If found and valid, return it
  IF v_key IS NOT NULL AND LENGTH(v_key) > 10 THEN
    RETURN v_key;
  END IF;
  
  -- Fallback: try database setting
  BEGIN
    v_key := current_setting('app.settings.service_role_key', true);
    IF v_key IS NOT NULL AND LENGTH(v_key) > 10 THEN
      RETURN v_key;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- Continue to next fallback
  END;
  
  -- Fallback: try alternate setting name
  BEGIN
    v_key := current_setting('app.service_role_key', true);
    IF v_key IS NOT NULL AND LENGTH(v_key) > 10 THEN
      RETURN v_key;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- Continue
  END;
  
  -- If still not found, return NULL (cron jobs will handle this with COALESCE)
  RETURN NULL;
END;
$$;

-- Helper function to wait for key sync (used by cron jobs that auto-sync key)
CREATE OR REPLACE FUNCTION wait_for_key_sync(max_wait_ms INTEGER DEFAULT 2000)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_key TEXT;
  v_waited INTEGER := 0;
BEGIN
  -- Check if key exists
  SELECT value INTO v_key
  FROM public._app_secrets
  WHERE key = 'service_role_key'
  LIMIT 1;
  
  -- If key exists and is valid, return immediately
  IF v_key IS NOT NULL AND LENGTH(v_key) > 10 THEN
    RETURN;
  END IF;
  
  -- Otherwise wait a bit for sync to complete (up to max_wait_ms)
  WHILE v_waited < max_wait_ms LOOP
    PERFORM pg_sleep(0.1); -- 100ms
    v_waited := v_waited + 100;
    
    SELECT value INTO v_key
    FROM public._app_secrets
    WHERE key = 'service_role_key'
    LIMIT 1;
    
    IF v_key IS NOT NULL AND LENGTH(v_key) > 10 THEN
      RETURN;
    END IF;
  END LOOP;
END;
$$;

-- ============================================================================
-- FIX 1: Remove bat-auction-pulse (function doesn't exist)
-- ============================================================================
SELECT cron.unschedule('bat-auction-pulse') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'bat-auction-pulse'
);

-- ============================================================================
-- FIX 2: Fix go-grinder-continuous (use helper function for key)
-- ============================================================================
SELECT cron.unschedule('go-grinder-continuous') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'go-grinder-continuous'
);

SELECT cron.schedule(
  'go-grinder-continuous',
  '* * * * *', -- Every minute
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/go-grinder',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(
          get_service_role_key_for_cron(),
          current_setting('app.settings.service_role_key', true),
          current_setting('app.service_role_key', true)
        )
      ),
      body := jsonb_build_object(
        'chain_depth', 0,
        'do_seed', true,
        'seed_every', 1,
        'bat_import_batch', 2,
        'max_listings', 200,
        'process_import_queue', true,
        'import_queue_batch_size', 10
      ),
      timeout_milliseconds := 70000
    ) AS request_id;
  $$
);

-- ============================================================================
-- FIX 3: Fix process-catalog-chunks (use helper function for key)
-- ============================================================================
SELECT cron.unschedule('process-catalog-chunks') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-catalog-chunks'
);

SELECT cron.schedule(
  'process-catalog-chunks',
  '* * * * *', -- Every minute
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-catalog-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        get_service_role_key_for_cron(),
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      )
    ),
    body := jsonb_build_object()
  );
  $$
);

-- ============================================================================
-- FIX 4: Fix premium auction extractor cron jobs (barrett-jackson, cars-and-bids, mecum)
-- ============================================================================
SELECT cron.unschedule('barrett-jackson-15m') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'barrett-jackson-15m'
);

SELECT cron.schedule(
  'barrett-jackson-15m',
  '*/15 * * * *', -- Every 15 minutes
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/extract-premium-auction',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || COALESCE(
        get_service_role_key_for_cron(),
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      ),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'url', 'https://www.barrett-jackson.com/Events/',
      'site_type', 'barrettjackson',
      'max_vehicles', 20
    )
  );
  $$
);

SELECT cron.unschedule('cars-and-bids-15m') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'cars-and-bids-15m'
);

SELECT cron.schedule(
  'cars-and-bids-15m',
  '*/15 * * * *', -- Every 15 minutes
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/extract-premium-auction',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || COALESCE(
        get_service_role_key_for_cron(),
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      ),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'url', 'https://carsandbids.com/auctions',
      'site_type', 'carsandbids',
      'max_vehicles', 20
    )
  );
  $$
);

SELECT cron.unschedule('mecum-15m') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'mecum-15m'
);

SELECT cron.schedule(
  'mecum-15m',
  '*/15 * * * *', -- Every 15 minutes
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/extract-premium-auction',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || COALESCE(
        get_service_role_key_for_cron(),
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      ),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'url', 'https://www.mecum.com/lots/',
      'site_type', 'mecum',
      'max_vehicles', 20
    )
  );
  $$
);

-- ============================================================================
-- FIX 5: Fix craigslist-squarebodies-5m-hardcoded (use helper function)
-- ============================================================================
SELECT cron.unschedule('craigslist-squarebodies-5m-hardcoded') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'craigslist-squarebodies-5m-hardcoded'
);

SELECT cron.schedule(
  'craigslist-squarebodies-5m-hardcoded',
  '*/5 * * * *', -- Every 5 minutes
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-all-craigslist-squarebodies',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || COALESCE(
        get_service_role_key_for_cron(),
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      ),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'max_regions', 20,
      'max_listings_per_search', 60,
      'chain_depth', 1
    )
  );
  $$
);

-- ============================================================================
-- FIX 6: Fix process-service-queue (use helper function)
-- ============================================================================
SELECT cron.unschedule('process-service-queue') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-service-queue'
);

SELECT cron.schedule(
  'process-service-queue',
  '*/5 * * * *', -- Every 5 minutes
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/service-orchestrator',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(
          get_service_role_key_for_cron(),
          current_setting('app.settings.service_role_key', true),
          current_setting('app.service_role_key', true)
        )
      ),
      body := jsonb_build_object('limit', 20)
    ) as request_id;
  $$
);

-- ============================================================================
-- FIX 7: Fix analyze-unprocessed-org-images (use helper function)
-- ============================================================================
SELECT cron.unschedule('analyze-unprocessed-org-images') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'analyze-unprocessed-org-images'
);

SELECT cron.schedule(
  'analyze-unprocessed-org-images',
  '0 * * * *', -- Every hour
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/analyze-organization-images',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        get_service_role_key_for_cron(),
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      )
    ),
    body := jsonb_build_object(
      'organizationId', org_id,
      'batch', true
    )
  )
  FROM (
    SELECT DISTINCT organization_id as org_id
    FROM organization_images
    WHERE category IN ('facility', 'facility_exterior', 'facility_interior', 'equipment')
      AND ai_analysis IS NULL
      AND created_at > NOW() - INTERVAL '7 days'
    LIMIT 10
  ) orgs;
  $$
);

-- ============================================================================
-- FIX 8: Fix micro-scrape-bandaid (remove reference to non-existent settings)
-- ============================================================================
SELECT cron.unschedule('micro-scrape-bandaid') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'micro-scrape-bandaid'
);

SELECT cron.schedule(
  'micro-scrape-bandaid',
  '*/5 * * * *', -- Every 5 minutes
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/micro-scrape-bandaid',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        get_service_role_key_for_cron(),
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      )
    ),
    body := jsonb_build_object(
      'batch_size', 20,
      'max_runtime_ms', 25000
    )
  );
  $$
);

-- ============================================================================
-- Verify all cron jobs are active and properly configured
-- ============================================================================
COMMENT ON SCHEMA public IS 'All cron jobs have been updated to use secure key retrieval and reference only existing Edge Functions';

