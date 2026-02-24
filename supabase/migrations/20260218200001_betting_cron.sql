-- ============================================================================
-- Cron schedules for betting market lifecycle
-- ============================================================================
-- betting-market-creator: every 30 minutes, creates markets for new BaT auctions
-- betting-market-settler: every 5 minutes, settles markets for ended auctions
-- ============================================================================

-- Market creator - runs every 30 minutes
SELECT cron.schedule(
  'betting-market-creator',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/betting-market-creator',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Market settler - runs every 5 minutes
SELECT cron.schedule(
  'betting-market-settler',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/betting-market-settler',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
