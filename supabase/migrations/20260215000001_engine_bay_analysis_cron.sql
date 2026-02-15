-- Engine Bay Analysis + Continuous Enrichment Cron Jobs
-- 1. Every 2 hours: analyze new engine_bay images
-- 2. Every 6 hours: re-analyze low-confidence results with vehicle context
-- 3. Every 4 hours: full enrichment pipeline (HP estimation + cross-validation)

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove existing jobs if re-running migration
SELECT cron.unschedule('analyze-engine-bay-new') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'analyze-engine-bay-new'
);

SELECT cron.unschedule('engine-bay-reanalyze-low-confidence') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'engine-bay-reanalyze-low-confidence'
);

SELECT cron.unschedule('enrich-bulk-continuous') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'enrich-bulk-continuous'
);

-- Every 2 hours at :30 — process unanalyzed engine bay images
SELECT cron.schedule(
  'analyze-engine-bay-new',
  '30 */2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/analyze-engine-bay',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || get_service_role_key_for_cron()
    ),
    body := '{"mode":"process","limit":20}'::jsonb,
    timeout_milliseconds := 150000
  ) AS request_id;
  $$
);

-- Every 6 hours — re-analyze low-confidence results with vehicle context
SELECT cron.schedule(
  'engine-bay-reanalyze-low-confidence',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/analyze-engine-bay',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || get_service_role_key_for_cron()
    ),
    body := '{"mode":"reanalyze_low_confidence","limit":20}'::jsonb,
    timeout_milliseconds := 150000
  ) AS request_id;
  $$
);

-- Every 4 hours at :15 — full enrichment pipeline (HP estimation + cross-validation)
SELECT cron.schedule(
  'enrich-bulk-continuous',
  '15 */4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/enrich-bulk',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || get_service_role_key_for_cron()
    ),
    body := '{"strategy":"all","limit":200,"source":"bat"}'::jsonb,
    timeout_milliseconds := 120000
  ) AS request_id;
  $$
);
