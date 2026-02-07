-- Analytics Cron Jobs
-- Schedules daily/weekly/monthly jobs for the quantitative analytics pipeline

-- Daily: Refresh clean_vehicle_prices materialized view (4 AM UTC)
SELECT cron.unschedule('analytics-refresh-clean-prices') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'analytics-refresh-clean-prices'
);
SELECT cron.schedule(
  'analytics-refresh-clean-prices',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/data-flag-price-outliers',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{"iqr_multiplier": 3.0}'::jsonb
  );
  $$
);

-- Daily: Calculate market indexes (5 AM UTC, after prices refresh)
SELECT cron.unschedule('analytics-market-indexes') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'analytics-market-indexes'
);
SELECT cron.schedule(
  'analytics-market-indexes',
  '0 5 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/calculate-market-indexes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Weekly (Sunday 6 AM): Market trends from comment discoveries
SELECT cron.unschedule('analytics-market-trends') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'analytics-market-trends'
);
SELECT cron.schedule(
  'analytics-market-trends',
  '0 6 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/calculate-market-trends',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Weekly (Sunday 7 AM): Sentiment batch aggregation
SELECT cron.unschedule('analytics-sentiment-batch') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'analytics-sentiment-batch'
);
SELECT cron.schedule(
  'analytics-sentiment-batch',
  '0 7 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/aggregate-sentiment',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{"mode": "batch", "batch_size": 200}'::jsonb
  );
  $$
);

-- Weekly (Sunday 8 AM): Sentiment -> market trends aggregation
SELECT cron.unschedule('analytics-sentiment-trends') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'analytics-sentiment-trends'
);
SELECT cron.schedule(
  'analytics-sentiment-trends',
  '0 8 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/aggregate-sentiment',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{"mode": "market_trends"}'::jsonb
  );
  $$
);

-- Weekly (Saturday 3 AM): Quality score backfill
SELECT cron.unschedule('analytics-quality-scores') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'analytics-quality-scores'
);
SELECT cron.schedule(
  'analytics-quality-scores',
  '0 3 * * 6',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/backfill-quality-scores',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{"batch_size": 1000}'::jsonb
  );
  $$
);

-- Monthly (1st of month, 2 AM): Re-flag outliers with fresh IQR
SELECT cron.unschedule('analytics-monthly-outliers') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'analytics-monthly-outliers'
);
SELECT cron.schedule(
  'analytics-monthly-outliers',
  '0 2 1 * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/data-flag-price-outliers',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{"iqr_multiplier": 3.0}'::jsonb
  );
  $$
);

-- Monthly (1st of month, 1 AM): Re-run make normalization
SELECT cron.unschedule('analytics-monthly-normalize') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'analytics-monthly-normalize'
);
SELECT cron.schedule(
  'analytics-monthly-normalize',
  '0 1 1 * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/data-normalize-makes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);
