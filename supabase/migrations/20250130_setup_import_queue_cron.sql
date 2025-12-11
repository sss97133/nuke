-- Set up cron job to process import queue every 5 minutes
-- This automatically imports new vehicles from the import_queue table

-- Enable pg_cron extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove existing job if it exists
SELECT cron.unschedule('process-import-queue') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-import-queue'
);

-- Schedule import queue processor to run every 5 minutes
SELECT cron.schedule(
  'process-import-queue',
  '*/5 * * * *',  -- Every 5 minutes
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-import-queue',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
      ),
      body := jsonb_build_object(
        'batch_size', 10,
        'priority_only', false
      )
    ) as request_id;
  $$
);

-- Verify job was created
SELECT 
  jobid, 
  jobname, 
  schedule, 
  active,
  LEFT(command, 100) as command_preview
FROM cron.job 
WHERE jobname = 'process-import-queue';

SELECT 'Import queue cron job created' as status;

