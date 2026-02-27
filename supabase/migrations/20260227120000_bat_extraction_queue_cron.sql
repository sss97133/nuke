-- Add cron job to fire process-bat-extraction-queue every 2 minutes
-- This function was deployed but had no cron triggering it, causing 2+ months of stall.
-- bat_extraction_queue had 119,160+ pending items with oldest from Dec 20, 2025.
--
-- APPLIED DIRECTLY VIA execute_sql RPC (2026-02-27) — jobid: 260
-- db push not used due to migration drift; SQL was applied directly.
--
-- Note: job 65 (aggressive-backlog-clear) also fires this function every 10 min.
-- Job 260 provides more frequent triggering (every 2 min) for faster queue drain.
-- Both use atomic claim_bat_extraction_queue_batch to prevent double-processing.

-- Remove existing job if somehow it exists
SELECT cron.unschedule('bat-extraction-queue-worker') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'bat-extraction-queue-worker'
);

-- Schedule bat extraction queue worker every 2 minutes
SELECT cron.schedule(
  'bat-extraction-queue-worker',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-bat-extraction-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || get_service_role_key_for_cron()
    ),
    body := '{}'::jsonb
  );
  $$
);
