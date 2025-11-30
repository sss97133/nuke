-- ============================================================================
-- Move BAT Scraping to Supabase pg_cron (Remote Server)
-- This removes the need for local cron jobs on your computer
-- ============================================================================

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove any existing cron job with the same name
SELECT cron.unschedule('bat-scrape-automated') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'bat-scrape-automated'
);

-- Schedule BAT scraping to run every 6 hours
-- This calls the monitor-bat-seller edge function directly
-- NOTE: You'll need to replace YOUR_SERVICE_ROLE_KEY with your actual key
-- Or set it as a database setting: ALTER DATABASE postgres SET app.settings.service_role_key = 'your-key';
SELECT cron.schedule(
  'bat-scrape-automated',
  '0 */6 * * *', -- Every 6 hours at :00 (12:00 AM, 6:00 AM, 12:00 PM, 6:00 PM)
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/monitor-bat-seller',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || COALESCE(
        current_setting('app.settings.service_role_key', true),
        'YOUR_SERVICE_ROLE_KEY_HERE' -- Replace this with your actual key
      ),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'sellerUsername', 'VivaLasVegasAutos',
      'organizationId', 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf'
    )
  );
  $$
);

-- Alternative: If service_role_key setting doesn't work, use a direct key
-- (You'll need to set this via Supabase Dashboard → Settings → Database → Custom Config)
-- Or use a function that retrieves it from a secure table

-- Create a function to get service role key securely
-- This allows the cron job to use the service role key without hardcoding it
CREATE OR REPLACE FUNCTION get_service_role_key()
RETURNS TEXT AS $$
BEGIN
  -- Try to get from app settings first
  BEGIN
    RETURN current_setting('app.settings.service_role_key', true);
  EXCEPTION WHEN OTHERS THEN
    -- Fallback: You can store this in a secure table or use environment variable
    -- For now, return NULL and handle in the cron job
    RETURN NULL;
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- View scheduled jobs
-- SELECT * FROM cron.job WHERE jobname = 'bat-scrape-automated';

-- To manually trigger the scrape:
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

COMMENT ON FUNCTION get_service_role_key IS 'Securely retrieves service role key for cron jobs';

