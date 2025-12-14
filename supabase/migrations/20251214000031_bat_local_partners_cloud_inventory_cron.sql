-- BaT Local Partners: cloud-only inventory + org media automation
--
-- Schedules:
-- 1) Enqueue BaT Local Partner orgs into organization_inventory_sync_queue (current inventory)
-- 2) Backfill org primary images + favicon_url
-- Also patches the existing cron jobs to tolerate either setting name:
-- - app.service_role_key
-- - app.settings.service_role_key
--
-- Requirements: pg_cron + pg_net enabled in Supabase project.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Helper: fetch service key from either config name (projects differ)
-- NOTE: current_setting(..., true) returns NULL when missing.
DO $$
BEGIN
  -- no-op block; exists to keep migration structure consistent
END $$;

-- ============================================================================
-- Patch: process-import-queue cron to use COALESCE(service key settings)
-- ============================================================================

SELECT cron.unschedule('process-import-queue') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-import-queue'
);

SELECT cron.schedule(
  'process-import-queue',
  '*/5 * * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-import-queue',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(
          current_setting('app.settings.service_role_key', true),
          current_setting('app.service_role_key', true)
        )
      ),
      body := jsonb_build_object(
        'batch_size', 10,
        'priority_only', false,
        'fast_mode', true,
        'skip_image_upload', true
      )
    ) as request_id;
  $$
);

-- ============================================================================
-- Patch: process-inventory-sync-queue cron to use COALESCE(service key settings)
-- ============================================================================

SELECT cron.unschedule('process-inventory-sync-queue') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-inventory-sync-queue'
);

SELECT cron.schedule(
  'process-inventory-sync-queue',
  '*/30 * * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-inventory-sync-queue',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(
          current_setting('app.settings.service_role_key', true),
          current_setting('app.service_role_key', true)
        )
      ),
      body := jsonb_build_object(
        'batch_size', 5,
        'max_results', 200,
        'max_results_sold', 200
      )
    ) AS request_id;
  $$
);

-- ============================================================================
-- Enqueue BaT local partners for inventory sync (CURRENT inventory)
-- ============================================================================

SELECT cron.unschedule('enqueue-bat-local-partner-inventory-current') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'enqueue-bat-local-partner-inventory-current'
);

-- Every 6 hours (lightweight; just queue rows)
SELECT cron.schedule(
  'enqueue-bat-local-partner-inventory-current',
  '0 */6 * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/enqueue-bat-local-partner-inventory',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(
          current_setting('app.settings.service_role_key', true),
          current_setting('app.service_role_key', true)
        )
      ),
      body := jsonb_build_object(
        'run_mode', 'current',
        'limit', 5000,
        'only_with_website', true,
        'requeue_failed', true
      )
    ) AS request_id;
  $$
);

-- ============================================================================
-- Backfill org primary images + favicon_url (global; safe re-run)
-- ============================================================================

SELECT cron.unschedule('backfill-org-primary-images') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'backfill-org-primary-images'
);

-- Hourly, small batch (keeps UI fresh without hammering sites)
SELECT cron.schedule(
  'backfill-org-primary-images',
  '15 * * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/backfill-org-primary-images',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(
          current_setting('app.settings.service_role_key', true),
          current_setting('app.service_role_key', true)
        )
      ),
      body := jsonb_build_object(
        'batch_size', 50,
        'max_sites', 25,
        'dry_run', false
      )
    ) AS request_id;
  $$
);


