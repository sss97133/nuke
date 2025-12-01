-- Setup Analysis Queue Cron Job
-- Run this in Supabase Dashboard → SQL Editor
-- Replace YOUR_SERVICE_ROLE_KEY with your actual key from Settings → API

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove existing job if it exists
SELECT cron.unschedule('process-analysis-queue') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-analysis-queue'
);

-- Schedule the analysis queue processor
-- Runs every 5 minutes, processes up to 10 analyses per run
SELECT cron.schedule(
  'process-analysis-queue',
  '*/5 * * * *', -- Every 5 minutes
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-analysis-queue',
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('batchSize', 10)
  );
  $$
);

-- Schedule cleanup job (removes old completed/failed analyses after 30 days)
SELECT cron.schedule(
  'cleanup-analysis-queue',
  '0 3 * * *', -- Daily at 3 AM
  $$
  DELETE FROM analysis_queue
  WHERE status IN ('completed', 'failed')
    AND completed_at < NOW() - INTERVAL '30 days';
  $$
);

-- Verify jobs were created
SELECT jobid, jobname, schedule, command 
FROM cron.job 
WHERE jobname IN ('process-analysis-queue', 'cleanup-analysis-queue');

-- Test queue processing immediately (optional - uncomment to test)
/*
SELECT net.http_post(
  url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-analysis-queue',
  headers := jsonb_build_object(
    'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY',
    'Content-Type', 'application/json'
  ),
  body := jsonb_build_object('batchSize', 5)
);
*/

