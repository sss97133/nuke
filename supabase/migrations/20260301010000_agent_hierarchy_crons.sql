-- ============================================================================
-- AGENT HIERARCHY CRON JOBS
-- Filed: 2026-03-01
--
-- Wires up the three-tier agent hierarchy for continuous extraction processing.
-- This enables 10x cheaper extraction by routing routine work to Haiku ($1/$5 MTok)
-- instead of Sonnet ($3/$15 MTok), with Sonnet only reviewing escalations.
--
-- Architecture:
--   agent-tier-router (every 5 min) — full pipeline: Haiku dispatch + Sonnet review
--   haiku-extraction-worker (every 2 min) — additional Haiku processing capacity
--   sonnet-supervisor (every 10 min) — additional Sonnet review capacity
--
-- Flow:
--   import_queue (status=pending)
--     → haiku-extraction-worker extracts via claude-haiku-4-5
--     → high quality (>0.9) → auto-approve → complete
--     → low/medium quality → pending_review
--     → sonnet-supervisor reviews with claude-sonnet-4-6
--     → approved/corrected → complete
--     → rejected → failed
--     → escalated → pending_strategy (for Opus)
--
-- Queue status at deploy: 460 pending items
-- ============================================================================

-- 1. Agent Tier Router — runs the full pipeline cycle every 5 minutes
SELECT cron.unschedule('agent-tier-router-pipeline')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'agent-tier-router-pipeline'
);

SELECT cron.schedule(
  'agent-tier-router-pipeline',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url := get_service_url() || '/functions/v1/agent-tier-router',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || get_service_role_key_for_cron()
      ),
      body := '{"action": "run_pipeline", "pipeline_config": {"haiku_batch_size": 10, "review_batch_size": 10, "max_cycles": 1}}'::jsonb
    );
  $$
);

-- 2. Haiku Extraction Worker — processes pending items every 2 minutes
SELECT cron.unschedule('haiku-extraction-worker')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'haiku-extraction-worker'
);

SELECT cron.schedule(
  'haiku-extraction-worker',
  '*/2 * * * *',
  $$
    SELECT net.http_post(
      url := get_service_url() || '/functions/v1/haiku-extraction-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || get_service_role_key_for_cron()
      ),
      body := '{"action": "batch_extract", "batch_size": 10}'::jsonb
    );
  $$
);

-- 3. Sonnet Supervisor — reviews escalated items every 10 minutes
SELECT cron.unschedule('sonnet-supervisor-review')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sonnet-supervisor-review'
);

SELECT cron.schedule(
  'sonnet-supervisor-review',
  '*/10 * * * *',
  $$
    SELECT net.http_post(
      url := get_service_url() || '/functions/v1/sonnet-supervisor',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || get_service_role_key_for_cron()
      ),
      body := '{"action": "review_batch", "batch_size": 10}'::jsonb
    );
  $$
);
