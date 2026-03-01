-- ============================================================================
-- INTEGRATE AGENT HIERARCHY: Fix CHECK constraint + disable CQP overlap
-- Filed: 2026-03-01
--
-- Context:
--   The agent hierarchy (haiku-extraction-worker, sonnet-supervisor, agent-tier-router)
--   is now wired to crons and should be the primary import_queue processor.
--   The old continuous-queue-processor (CQP) races for the same pending items.
--
-- Changes:
--   1. Add pending_review and pending_strategy to import_queue.status CHECK constraint
--      (required by the agent hierarchy — haiku worker escalates to these statuses)
--   2. Disable the auto_process_import_queue trigger that fires CQP on every INSERT
--      (the agent hierarchy crons handle continuous processing every 2/5/10 min)
--   3. Disable the dead go-grinder-continuous cron (function was deleted long ago)
--   4. Remove the two CQP crons (continuous-queue-processor-1, -2)
--   5. Update pipeline_registry ownership from CQP to agent hierarchy
--
-- The CQP edge function is NOT deleted — it can still be called manually for
-- domain-specific extraction when needed. We just stop it from racing with
-- the agent hierarchy for pending items.
-- ============================================================================

-- 1. Fix import_queue status CHECK constraint to include agent hierarchy statuses
DO $$
BEGIN
  -- Drop the old constraint
  BEGIN
    ALTER TABLE public.import_queue DROP CONSTRAINT IF EXISTS import_queue_status_check;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Add the new constraint with agent hierarchy statuses
  ALTER TABLE public.import_queue
    ADD CONSTRAINT import_queue_status_check
    CHECK (status IN (
      'pending',           -- Waiting for processing
      'processing',        -- Claimed by a worker
      'pending_review',    -- Haiku extracted, needs Sonnet review
      'pending_strategy',  -- Sonnet escalated, needs Opus strategy
      'complete',          -- Successfully processed
      'failed',            -- Gave up after max attempts
      'skipped',           -- Intentionally bypassed
      'duplicate'          -- URL already exists
    )) NOT VALID;  -- NOT VALID: don't scan existing rows, applies to new writes only
END $$;

-- 2. Disable the auto_process_import_queue trigger (fires CQP on every INSERT)
--    The agent hierarchy crons now handle continuous processing.
--    We disable rather than drop so it can be re-enabled if needed.
ALTER TABLE public.import_queue DISABLE TRIGGER auto_process_import_queue;

-- 3. Disable the dead go-grinder-continuous cron
--    The go-grinder edge function was deleted; this cron fails silently every minute.
SELECT cron.unschedule('go-grinder-continuous')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'go-grinder-continuous'
);

-- 4. Remove the two CQP crons that were running every 5 minutes
--    These were created outside of migration files and race with the agent hierarchy.
SELECT cron.unschedule('continuous-queue-processor-1')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'continuous-queue-processor-1'
);

SELECT cron.unschedule('continuous-queue-processor-2')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'continuous-queue-processor-2'
);

-- 5. Update pipeline_registry ownership
UPDATE pipeline_registry
SET owned_by = 'haiku-extraction-worker / agent-tier-router',
    description = CASE column_name
      WHEN 'status' THEN 'Processing state. Agent hierarchy: pending -> processing -> pending_review -> pending_strategy -> complete/failed'
      ELSE description
    END,
    valid_values = CASE column_name
      WHEN 'status' THEN ARRAY['pending','processing','pending_review','pending_strategy','complete','failed','skipped','duplicate']
      ELSE valid_values
    END,
    updated_at = now()
WHERE table_name = 'import_queue'
  AND owned_by = 'continuous-queue-processor';
