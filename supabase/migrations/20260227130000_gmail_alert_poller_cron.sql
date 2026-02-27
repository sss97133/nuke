-- Gmail Alert Poller — pg_cron job
--
-- Calls the gmail-alert-poller edge function every 5 minutes.
-- Polls toymachine91@gmail.com for vehicle listing alert emails,
-- extracts listing URLs, and queues them into import_queue.
--
-- PREREQUISITES:
--   1. GOOGLE_REFRESH_TOKEN must be set:
--      Run: dotenvx run -- node scripts/gmail-poller.mjs --setup
--      Then: supabase secrets set GOOGLE_REFRESH_TOKEN=<token>
--   2. Edge function must be deployed:
--      supabase functions deploy gmail-alert-poller --no-verify-jwt
--
-- To check if it's working:
--   SELECT * FROM cron.job WHERE jobname = 'gmail-alert-poller';
--   SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'gmail-alert-poller') ORDER BY start_time DESC LIMIT 10;
--
-- To check processed emails:
--   SELECT * FROM alert_email_log ORDER BY created_at DESC LIMIT 20;
--
-- To temporarily pause:
--   SELECT cron.unschedule('gmail-alert-poller');
-- To re-enable:
--   (re-run this migration or use the INSERT below)

SELECT cron.schedule(
  'gmail-alert-poller',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url    := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1)
              || '/functions/v1/gmail-alert-poller',
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'Authorization',  'Bearer ' || get_service_role_key_for_cron()
    ),
    body   := '{}'::jsonb
  ) AS request_id
  $$
);
