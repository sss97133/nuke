-- Schedule autonomous extraction agent to run every 6 hours
-- This creates the self-healing feedback loop for extraction

-- Remove existing job if it exists
SELECT cron.unschedule('autonomous-extraction-agent')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'autonomous-extraction-agent');

-- Schedule the autonomous extraction agent to run every 6 hours
-- It will:
-- 1. Check health of all premium sites
-- 2. Extract from healthy sites
-- 3. Update patterns for degraded sites
-- 4. Discover new sites if below targets
SELECT cron.schedule(
  'autonomous-extraction-agent',
  '0 */6 * * *', -- Every 6 hours
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/autonomous-extraction-agent',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object('action', 'run_autonomous_cycle'),
      timeout_milliseconds := 300000  -- 5 minute timeout
    ) AS request_id;
  $$
);

-- Also schedule health checks to run every 2 hours
-- This populates scraping_health data for monitoring
SELECT cron.unschedule('premium-extraction-health-check')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'premium-extraction-health-check');

SELECT cron.schedule(
  'premium-extraction-health-check',
  '30 */2 * * *', -- Every 2 hours at :30
  $$
  SELECT
    net.http_post(
      url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/autonomous-extraction-agent',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object('action', 'health_check_and_repair'),
      timeout_milliseconds := 120000  -- 2 minute timeout
    ) AS request_id;
  $$
);

-- Verify jobs were created
SELECT
  jobid,
  jobname,
  schedule,
  active,
  LEFT(command, 80) as command_preview
FROM cron.job
WHERE jobname IN ('autonomous-extraction-agent', 'premium-extraction-health-check', 'hourly-scraper-health-check')
ORDER BY jobname;

COMMENT ON FUNCTION cron.schedule(text, text, text) IS 'Schedule periodic jobs for autonomous data extraction';
