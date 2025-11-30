-- Set up pg_cron to process images automatically
-- This runs the edge function every hour to process 100 images

-- Enable pg_cron extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule job to process images every hour
-- Processes 100 images per run (adjust max_images as needed)
SELECT cron.schedule(
  'process-images-hourly',
  '0 * * * *', -- Every hour at minute 0
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-all-images-cron',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object(
        'max_images', 100,
        'batch_size', 50
      )
    ) AS request_id;
  $$
);

-- Alternative: Process more aggressively (every 15 minutes, 50 images each)
-- Uncomment if you want faster processing:
/*
SELECT cron.schedule(
  'process-images-aggressive',
  '*/15 * * * *', -- Every 15 minutes
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-all-images-cron',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object(
        'max_images', 50,
        'batch_size', 25
      )
    ) AS request_id;
  $$
);
*/

-- View scheduled jobs
-- SELECT * FROM cron.job;

-- To unschedule:
-- SELECT cron.unschedule('process-images-hourly');

