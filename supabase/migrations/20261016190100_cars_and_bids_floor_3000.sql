-- cars-and-bids-targets-landing: lower the Firecrawl balance floor from 5,200 to 3,000.
--
-- The shared pool was re-balanced 2026-10-15 14:55Z (FIRECRAWL-BUDGET.md): the other daily lines need about 2,500 credits
-- through 2026-11-04, so batches may spend down to 3,000. Same job, same body, only min_balance changes.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

SELECT cron.alter_job(
  jobid,
  command := $job$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/extract-cars-and-bids-core',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        get_service_role_key_for_cron(),
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      )
    ),
    body := '{"action": "batch_from_targets", "limit": 7, "delay_ms": 2000, "max_total": 1500, "min_balance": 3000, "year_min": 1964, "year_max": 1991}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
) FROM cron.job WHERE jobname = 'cars-and-bids-targets-landing';

COMMIT;
