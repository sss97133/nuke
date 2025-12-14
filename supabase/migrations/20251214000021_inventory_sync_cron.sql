-- Inventory Sync Cron
-- Runs the inventory sync queue processor on a cadence.
-- NOTE: This migration requires pg_cron and pg_net (net.http_post) configuration,
-- similar to other cron migrations in this repo.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove existing job if it exists
SELECT cron.unschedule('process-inventory-sync-queue') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-inventory-sync-queue'
);

-- Schedule inventory sync queue processor to run every 30 minutes
SELECT cron.schedule(
  'process-inventory-sync-queue',
  '*/30 * * * *',
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-inventory-sync-queue',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
      ),
      body := jsonb_build_object(
        'batch_size', 5,
        'max_results', 200,
        'max_results_sold', 200
      )
    ) AS request_id;
  $$
);


