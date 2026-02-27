-- VP Orgs Cron Gap Fixes — 2026-02-27
--
-- Adds three missing cron jobs identified during VP Orgs domain audit:
--
-- 1. classic-seller-queue-worker   — drains the 109-item classic_seller_queue
--    (queue existed since Dec 2025 with no processor; now runs every 5 min)
--
-- 2. ecr-collection-inventory-refresh — refreshes ECR (exclusivecarregistry.com)
--    collection inventory; was 45 days stale (daily at 03:00 UTC)
--
-- 3. compute-org-seller-stats-daily — rebuilds organization_seller_stats for
--    all orgs with external listings; only had 1 stale entry (daily at 04:00 UTC)
--
-- All jobs use get_service_role_key_for_cron() per project law.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================================================
-- 1. CLASSIC SELLER QUEUE WORKER
-- Process classic.com seller profiles: discover-classic-sellers populates the
-- queue, but no cron was draining it. This fix drains 10 at a time, every 5min.
-- ============================================================================

SELECT cron.unschedule('classic-seller-queue-worker')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'classic-seller-queue-worker');

SELECT cron.schedule(
  'classic-seller-queue-worker',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-classic-seller-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(get_service_role_key_for_cron(), '')
    ),
    body := '{"batch_size":10}'::jsonb,
    timeout_milliseconds := 60000
  ) AS request_id;
  $$
);

-- ============================================================================
-- 2. ECR COLLECTION INVENTORY REFRESH
-- Scrapes exclusivecarregistry.com collections for vehicle inventory.
-- Was 45 days stale. Runs daily at 03:00 UTC, batch of 5 collections at a time.
-- ============================================================================

SELECT cron.unschedule('ecr-collection-inventory-refresh')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ecr-collection-inventory-refresh');

SELECT cron.schedule(
  'ecr-collection-inventory-refresh',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-ecr-collection-inventory',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(get_service_role_key_for_cron(), '')
    ),
    body := '{"batch":true,"limit":5}'::jsonb,
    timeout_milliseconds := 120000
  ) AS request_id;
  $$
);

-- ============================================================================
-- 3. COMPUTE ORG SELLER STATS — DAILY ROLLUP
-- organization_seller_stats had only 1 stale entry (as of Feb 2026 audit).
-- Runs daily at 04:00 UTC for all orgs with external listings.
-- Uses force:false so recently-computed orgs are skipped automatically.
-- ============================================================================

SELECT cron.unschedule('compute-org-seller-stats-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'compute-org-seller-stats-daily');

SELECT cron.schedule(
  'compute-org-seller-stats-daily',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/compute-org-seller-stats',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(get_service_role_key_for_cron(), '')
    ),
    body := '{"all":true,"force":false}'::jsonb,
    timeout_milliseconds := 120000
  ) AS request_id;
  $$
);

-- ============================================================================
-- Verify all 3 jobs are registered
-- ============================================================================
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname IN (
  'classic-seller-queue-worker',
  'ecr-collection-inventory-refresh',
  'compute-org-seller-stats-daily'
)
ORDER BY jobname;
