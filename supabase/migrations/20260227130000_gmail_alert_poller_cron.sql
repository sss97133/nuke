-- Gmail Alert Poller — pg_cron job
--
-- Calls the gmail-alert-poller edge function every 5 minutes.
-- Polls toymachine91@gmail.com for vehicle listing alert emails,
-- extracts listing URLs, and queues them into import_queue.
--
-- PREREQUISITES (must be done before this cron will actually work):
--   1. Get OAuth refresh token (one-time, ~2 minutes):
--      dotenvx run -- node scripts/gmail-poller.mjs --setup
--
--   2. Set Supabase secret:
--      supabase secrets set GOOGLE_REFRESH_TOKEN=<token from step 1>
--      supabase secrets set GOOGLE_CLIENT_ID=930832753018-5s69stakgquu6nktmp60d05dfq0ljjpe.apps.googleusercontent.com
--      supabase secrets set GOOGLE_CLIENT_SECRET=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
--
--   3. Deploy the edge function:
--      supabase functions deploy gmail-alert-poller --no-verify-jwt
--
-- MONITORING:
--   SELECT * FROM cron.job WHERE jobname = 'gmail-alert-poller';
--   SELECT * FROM cron.job_run_details
--     WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'gmail-alert-poller')
--     ORDER BY start_time DESC LIMIT 10;
--   SELECT * FROM alert_email_log ORDER BY created_at DESC LIMIT 20;
--
-- PAUSE:   SELECT cron.unschedule('gmail-alert-poller');
-- RESUME:  Re-run this file (or INSERT below)

-- Unschedule if exists (idempotent)
SELECT cron.unschedule('gmail-alert-poller')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gmail-alert-poller');

-- Schedule: poll every 5 minutes
SELECT cron.schedule(
  'gmail-alert-poller',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/gmail-alert-poller',
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'Authorization',  'Bearer ' || COALESCE(
        get_service_role_key_for_cron(),
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      )
    ),
    body    := jsonb_build_object()
  ) AS request_id
  $$
);
