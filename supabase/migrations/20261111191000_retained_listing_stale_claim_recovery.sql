-- Recover items stuck in 'claimed' status past the lease window.
-- Root cause: the claim function's activity guard (>8 active backends) returns
-- early during cron bursts, skipping expired-item marking. These items have been
-- claimed but never completed or expired.
--
-- Pattern: 20261011033344_retained_exhausted_work_recovery.sql
-- Scope: items claimed >15 minutes ago (5 minutes past the 10-minute lease)
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '1s';

DO $$ BEGIN
  -- Guard: job must be active
  IF NOT EXISTS(
    SELECT FROM cron.job
    WHERE jobname = 'project-retained-listing-properties' AND active
  ) THEN
    RAISE EXCEPTION 'Listing owner paused';
  END IF;

  -- Guard: no conflicting active work on these tables
  IF (SELECT count(*) FROM pg_stat_activity
      WHERE pid <> pg_backend_pid() AND state = 'active'
        AND query ~ '(retained_listing_property_work|finish_retained_listing)'
     ) > 0 THEN
    RAISE EXCEPTION 'Relevant work active';
  END IF;
END $$;

-- Find items stuck in claimed state past the lease window
CREATE TEMP TABLE stale_claimed_recovery ON COMMIT DROP AS
SELECT
  q.source_observation_id,
  q.property_id,
  q.locked_at,
  q.locked_by,
  q.attempts
FROM public.retained_listing_property_work q
WHERE q.status = 'claimed'
  AND q.locked_at < now() - interval '15 minutes'
ORDER BY q.locked_at
LIMIT 120
FOR UPDATE SKIP LOCKED;

DO $$
DECLARE
  recovered_count integer;
  recovered_json jsonb;
BEGIN
  SELECT count(*), jsonb_agg(jsonb_build_object(
    'source_observation_id', source_observation_id,
    'property_id', property_id,
    'locked_at', locked_at,
    'locked_by', locked_by,
    'attempts', attempts
  ) ORDER BY locked_at)
  INTO recovered_count, recovered_json
  FROM stale_claimed_recovery;

  IF recovered_count = 0 THEN
    RAISE NOTICE 'No stale claimed items found';
    RETURN;
  END IF;

  RAISE NOTICE 'Recovering % stale claimed items', recovered_count;

  -- Record the recovery in the replay table
  UPDATE public.retained_listing_property_replay
  SET previous_scan_receipt = coalesce(previous_scan_receipt, '{}'::jsonb) ||
    jsonb_build_object('stale_claim_recovery_20261111', jsonb_build_object(
      'recovered_at', clock_timestamp(),
      'incident', 'activity_guard_skip_during_cron_burst',
      'qualification', 'items claimed >15 min with no completion; lease window is 10 min',
      'requeued', recovered_count,
      'previous_work', recovered_json
    ))
  WHERE id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Replay receipt owner unavailable';
  END IF;

  -- Reset items to pending for retry
  UPDATE public.retained_listing_property_work q
  SET
    status = CASE WHEN q.attempts >= 3 THEN 'failed' ELSE 'pending' END,
    locked_by = NULL,
    locked_at = NULL,
    next_attempt_at = now() + interval '1 minute',
    last_error = 'stale_claim_recovery'
  FROM stale_claimed_recovery c
  WHERE q.source_observation_id = c.source_observation_id
    AND q.property_id = c.property_id;

  RAISE NOTICE 'Recovery complete: % items reset', recovered_count;
END $$;

COMMIT;
