-- Acquisition Pipeline Automation Crons
-- 1. discover-cl-muscle-cars  3x daily  (finds fresh listings)
-- 2. batch-market-proof       3x daily  (scores discovered, advances STRONG_BUY to target)
-- 3. rescore-stale-targets    daily     (re-runs market-proof on targets >7 days old)
-- 4. expire-stale-discoveries daily     (deletes discovered entries older than 45 days)

-- -----------------------------------------------------------------------
-- 1. Discovery: 8 AM, 1 PM, 7 PM UTC
-- -----------------------------------------------------------------------
SELECT cron.unschedule('pipeline-discover-muscle-cars-morning') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'pipeline-discover-muscle-cars-morning'
);
SELECT cron.schedule(
  'pipeline-discover-muscle-cars-morning',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/discover-cl-muscle-cars',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object(
      'max_regions', 48,
      'auto_proof', false
    ),
    timeout_milliseconds := 900000
  ) AS request_id;
  $$
);

SELECT cron.unschedule('pipeline-discover-muscle-cars-afternoon') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'pipeline-discover-muscle-cars-afternoon'
);
SELECT cron.schedule(
  'pipeline-discover-muscle-cars-afternoon',
  '0 13 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/discover-cl-muscle-cars',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object(
      'max_regions', 48,
      'auto_proof', false
    ),
    timeout_milliseconds := 900000
  ) AS request_id;
  $$
);

SELECT cron.unschedule('pipeline-discover-muscle-cars-evening') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'pipeline-discover-muscle-cars-evening'
);
SELECT cron.schedule(
  'pipeline-discover-muscle-cars-evening',
  '0 19 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/discover-cl-muscle-cars',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object(
      'max_regions', 48,
      'auto_proof', false
    ),
    timeout_milliseconds := 900000
  ) AS request_id;
  $$
);

-- -----------------------------------------------------------------------
-- 2. Market proof: 30 min after each discovery run (8:30, 1:30, 7:30 PM UTC)
-- -----------------------------------------------------------------------
SELECT cron.unschedule('pipeline-market-proof-morning') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'pipeline-market-proof-morning'
);
SELECT cron.schedule(
  'pipeline-market-proof-morning',
  '30 8 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/batch-market-proof',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object(
      'batch_size', 50,
      'auto_advance', true,
      'min_score_to_advance', 80,
      'max_price_to_advance', 50000,
      'stage_filter', 'discovered'
    ),
    timeout_milliseconds := 900000
  ) AS request_id;
  $$
);

SELECT cron.unschedule('pipeline-market-proof-afternoon') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'pipeline-market-proof-afternoon'
);
SELECT cron.schedule(
  'pipeline-market-proof-afternoon',
  '30 13 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/batch-market-proof',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object(
      'batch_size', 50,
      'auto_advance', true,
      'min_score_to_advance', 80,
      'max_price_to_advance', 50000,
      'stage_filter', 'discovered'
    ),
    timeout_milliseconds := 900000
  ) AS request_id;
  $$
);

SELECT cron.unschedule('pipeline-market-proof-evening') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'pipeline-market-proof-evening'
);
SELECT cron.schedule(
  'pipeline-market-proof-evening',
  '30 19 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/batch-market-proof',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object(
      'batch_size', 50,
      'auto_advance', true,
      'min_score_to_advance', 80,
      'max_price_to_advance', 50000,
      'stage_filter', 'discovered'
    ),
    timeout_milliseconds := 900000
  ) AS request_id;
  $$
);

-- -----------------------------------------------------------------------
-- 3. Re-score stale targets daily at 10 AM UTC
--    Refreshes comp data on targets that haven't been updated in 7+ days
-- -----------------------------------------------------------------------
SELECT cron.unschedule('pipeline-rescore-stale-targets') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'pipeline-rescore-stale-targets'
);
SELECT cron.schedule(
  'pipeline-rescore-stale-targets',
  '0 10 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/batch-market-proof',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object(
      'batch_size', 30,
      'auto_advance', false,
      'stage_filter', 'target'
    ),
    timeout_milliseconds := 900000
  ) AS request_id;
  $$
);

-- -----------------------------------------------------------------------
-- 4. Expire stale discoveries daily at 11 PM UTC
--    Removes discovered entries older than 45 days (CL listings are gone)
-- -----------------------------------------------------------------------
SELECT cron.unschedule('pipeline-expire-stale-discoveries') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'pipeline-expire-stale-discoveries'
);
SELECT cron.schedule(
  'pipeline-expire-stale-discoveries',
  '0 23 * * *',
  $$
  DELETE FROM acquisition_pipeline
  WHERE stage = 'discovered'
    AND discovery_date < NOW() - INTERVAL '45 days';
  $$
);

-- Verify all jobs created
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'pipeline-%'
ORDER BY jobname;
