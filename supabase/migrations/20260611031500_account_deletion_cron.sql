-- Account-deletion worker schedule (companion to 20260611030000).
-- "Sign-in disabled within 24h" is only true if the worker runs: every 15
-- minutes, process pending account_deletion_requests via the edge function.
-- Applied live 2026-06-11; idempotent here.
SELECT cron.unschedule('account-deletion-worker')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'account-deletion-worker');

SELECT cron.schedule('account-deletion-worker', '*/15 * * * *', $$
  SELECT net.http_post(
    url := get_service_url() || '/functions/v1/process-account-deletions',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || get_service_role_key_for_cron()),
    body := '{}'::jsonb);
$$);
