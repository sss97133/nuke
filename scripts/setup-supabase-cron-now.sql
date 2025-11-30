-- Quick setup script for Supabase pg_cron
-- Run this in Supabase Dashboard → SQL Editor
-- Replace YOUR_SERVICE_ROLE_KEY with your actual key from Settings → API

-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove existing job if it exists
SELECT cron.unschedule('bat-scrape-automated') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'bat-scrape-automated'
);

-- Schedule the job (replace YOUR_SERVICE_ROLE_KEY)
SELECT cron.schedule(
  'bat-scrape-automated',
  '0 */6 * * *', -- Every 6 hours
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/monitor-bat-seller',
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'sellerUsername', 'VivaLasVegasAutos',
      'organizationId', 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf'
    )
  );
  $$
);

-- Verify it was created
SELECT jobid, jobname, schedule, command 
FROM cron.job 
WHERE jobname = 'bat-scrape-automated';

-- Test it immediately (optional)
-- SELECT net.http_post(
--   url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/monitor-bat-seller',
--   headers := jsonb_build_object(
--     'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY',
--     'Content-Type', 'application/json'
--   ),
--   body := jsonb_build_object(
--     'sellerUsername', 'VivaLasVegasAutos',
--     'organizationId', 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf'
--   )
-- );

