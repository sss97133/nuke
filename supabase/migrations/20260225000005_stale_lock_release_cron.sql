-- =============================================================================
-- AGENT SAFETY: Hourly cron to auto-release stale locks
-- =============================================================================
-- Ensures stale queue locks never accumulate.
-- Released records go back to 'pending' and get reprocessed on next run.
-- =============================================================================

SELECT cron.schedule(
  'release-stale-locks',
  '0 * * * *',    -- every hour on the hour
  $$SELECT release_stale_locks(stale_threshold_minutes := 30)$$
);
