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
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODM2OTAyMSwiZXhwIjoyMDUzOTQ1MDIxfQ.NEbqSnSamR5f7Fqon25ierv5yJgdDy_o2nrixOej_Xg'
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