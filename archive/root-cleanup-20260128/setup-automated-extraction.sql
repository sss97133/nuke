-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove any existing queue processing jobs
SELECT cron.unschedule('process-import-queue');

-- Create automated queue processing job that runs every minute
SELECT cron.schedule(
  'process-import-queue',
  '* * * * *', -- Every minute
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-import-queue-simple',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer REDACTED-ROTATE-THIS-KEY'
      ),
      body := jsonb_build_object(
        'batch_size', 10,
        'priority_only', true
      )
    ) as request_id;
  $$
);

-- Check that the cron job was created
SELECT * FROM cron.job WHERE jobname = 'process-import-queue';