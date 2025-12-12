-- ============================================================================
-- TRIGGER DATA EXTRACTION PROCESSES
-- Run this in Supabase SQL Editor to trigger scraping and extraction
-- Dashboard: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql
-- ============================================================================

-- STEP 1: View current data completeness
SELECT 
  'DATA COMPLETENESS REPORT' as report_section,
  COUNT(*) as total_vehicles,
  COUNT(CASE WHEN vin IS NOT NULL THEN 1 END) as with_vin,
  ROUND(100.0 * COUNT(CASE WHEN vin IS NOT NULL THEN 1 END) / COUNT(*), 1) as vin_pct,
  COUNT(CASE WHEN mileage IS NOT NULL THEN 1 END) as with_mileage,
  ROUND(100.0 * COUNT(CASE WHEN mileage IS NOT NULL THEN 1 END) / COUNT(*), 1) as mileage_pct,
  COUNT(CASE WHEN color IS NOT NULL THEN 1 END) as with_color,
  ROUND(100.0 * COUNT(CASE WHEN color IS NOT NULL THEN 1 END) / COUNT(*), 1) as color_pct,
  COUNT(CASE WHEN engine_size IS NOT NULL THEN 1 END) as with_engine,
  ROUND(100.0 * COUNT(CASE WHEN engine_size IS NOT NULL THEN 1 END) / COUNT(*), 1) as engine_pct,
  COUNT(CASE WHEN sale_price IS NOT NULL OR asking_price IS NOT NULL THEN 1 END) as with_price
FROM vehicles;

-- STEP 2: View vehicles needing re-scraping (have URL but missing key data)
SELECT 
  'VEHICLES NEEDING RE-SCRAPE' as report_section,
  COUNT(*) as total,
  COUNT(CASE WHEN discovery_url ILIKE '%bringatrailer%' THEN 1 END) as bat_count,
  COUNT(CASE WHEN discovery_url ILIKE '%craigslist%' THEN 1 END) as craigslist_count,
  COUNT(CASE WHEN discovery_url ILIKE '%ksl.com%' THEN 1 END) as ksl_count
FROM vehicles
WHERE discovery_url IS NOT NULL
  AND (vin IS NULL OR mileage IS NULL OR color IS NULL);

-- STEP 3: Enable pg_cron extension if needed
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- STEP 4: Enable pg_net extension for HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net;

-- STEP 5: Check existing cron jobs
SELECT jobid, jobname, schedule, active, command 
FROM cron.job 
ORDER BY jobname;

-- STEP 6: Trigger BAT scraping immediately (manual trigger)
-- Replace YOUR_SERVICE_ROLE_KEY with actual key from Supabase Dashboard > Settings > API
/*
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
*/

-- STEP 7: Trigger Craigslist squarebody scraping
/*
SELECT net.http_post(
  url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-all-craigslist-squarebodies',
  headers := jsonb_build_object(
    'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY',
    'Content-Type', 'application/json'
  ),
  body := jsonb_build_object(
    'limit', 50
  )
);
*/

-- STEP 8: Schedule automated BAT scraping every 6 hours
-- First, unschedule if exists
SELECT cron.unschedule('bat-scrape-automated') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'bat-scrape-automated'
);

-- Then schedule (uncomment after setting service_role_key in app.settings)
/*
-- First set the service role key in database settings:
-- ALTER DATABASE postgres SET app.settings.service_role_key = 'your-actual-service-role-key';

SELECT cron.schedule(
  'bat-scrape-automated',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/monitor-bat-seller',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'sellerUsername', 'VivaLasVegasAutos',
      'organizationId', 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf'
    )
  );
  $$
);
*/

-- STEP 9: Schedule Craigslist scraping every 12 hours
/*
SELECT cron.schedule(
  'craigslist-squarebody-scrape',
  '0 */12 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-all-craigslist-squarebodies',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('limit', 100)
  );
  $$
);
*/

-- STEP 10: List vehicles that need data extraction (for manual review)
SELECT 
  id,
  year,
  make,
  model,
  CASE 
    WHEN discovery_url ILIKE '%bringatrailer%' THEN 'BAT'
    WHEN discovery_url ILIKE '%craigslist%' THEN 'Craigslist'
    WHEN discovery_url ILIKE '%ksl.com%' THEN 'KSL'
    ELSE 'Other'
  END as source,
  LEFT(discovery_url, 60) as discovery_url_preview,
  CASE WHEN vin IS NULL THEN '❌' ELSE '✅' END as vin_status,
  CASE WHEN mileage IS NULL THEN '❌' ELSE '✅' END as mileage_status,
  CASE WHEN color IS NULL THEN '❌' ELSE '✅' END as color_status
FROM vehicles
WHERE discovery_url IS NOT NULL
  AND (vin IS NULL OR mileage IS NULL OR color IS NULL)
ORDER BY 
  CASE 
    WHEN discovery_url ILIKE '%bringatrailer%' THEN 1
    WHEN discovery_url ILIKE '%craigslist%' THEN 2
    ELSE 3
  END,
  created_at DESC
LIMIT 50;
