-- Recover items that failed with canonical_request_failed or lease_expired errors.
-- All source observations remain eligible (not superseded, vehicle is public,
-- not deleted). Errors were likely transient (HTTP failures, edge function
-- timeouts). The root cause for lease_expired (activity guard skip) is now fixed.
--
-- Re-land of 20261112141000 which was never deployed (original deploy failed
-- on a different migration in the same commit).
--
-- Pattern: 20261010234847_retained_canonical_reader_recovery.sql
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '1s';

DO $$ BEGIN
  -- Guard: job must be active
  IF NOT EXISTS(
    SELECT FROM cron.job
    WHERE jobname = 'project-retained-listing-properties' AND active
  ) THEN
    RAISE EXCEPTION 'Listing owner paused';
  END IF;

  -- Guard: no conflicting active work
  IF (SELECT count(*) FROM pg_stat_activity
      WHERE pid <> pg_backend_pid() AND state = 'active'
        AND query ~ '(retained_listing_property|vehicle_canonical)'
     ) > 2 THEN
    RAISE EXCEPTION 'Relevant work active';
  END IF;
END $$;

-- Identify eligible failed items (both error types)
CREATE TEMP TABLE historical_failed_recovery ON COMMIT DROP AS
SELECT
  w.source_observation_id,
  w.property_id,
  w.last_error,
  w.attempts,
  w.created_at
FROM retained_listing_property_work w
JOIN vehicle_observations o ON o.id = w.source_observation_id
JOIN vehicles v ON v.id = o.vehicle_id
WHERE w.status = 'failed'
  AND w.last_error IN ('canonical_request_failed', 'lease_expired')
  AND w.attempts = 3
  AND o.is_superseded = false
  AND v.is_public = true
  AND v.deleted_at IS NULL
  AND v.listing_kind IS DISTINCT FROM 'non_vehicle_item'
ORDER BY w.created_at
LIMIT 1500
FOR UPDATE OF w SKIP LOCKED;

DO $$
DECLARE
  canonical_count integer;
  lease_count integer;
  total_count integer;
BEGIN
  SELECT
    count(*) FILTER (WHERE last_error = 'canonical_request_failed'),
    count(*) FILTER (WHERE last_error = 'lease_expired'),
    count(*)
  INTO canonical_count, lease_count, total_count
  FROM historical_failed_recovery;

  IF total_count = 0 THEN
    RAISE NOTICE 'No eligible failed items found';
    RETURN;
  END IF;

  RAISE NOTICE 'Recovering % items (% canonical_request_failed, % lease_expired)',
    total_count, canonical_count, lease_count;

  PERFORM set_config('app.writer', 'ingest-observation:retained-listing', true);

  -- Record the recovery in the replay table
  UPDATE public.retained_listing_property_replay
  SET previous_scan_receipt = coalesce(previous_scan_receipt, '{}'::jsonb) ||
    jsonb_build_object('historical_failed_recovery_20261113', jsonb_build_object(
      'recovered_at', clock_timestamp(),
      'incident', 'historical_transient_failures',
      'qualification', 'all source observations still eligible; root cause (activity guard skip) now fixed',
      'canonical_request_failed', canonical_count,
      'lease_expired', lease_count,
      'total_requeued', total_count
    ))
  WHERE id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Replay receipt owner unavailable';
  END IF;

  -- Reset items to pending for retry
  UPDATE public.retained_listing_property_work w
  SET
    status = 'pending',
    attempts = 0,
    next_attempt_at = now() + interval '1 minute',
    last_error = 'historical_failed_recovery_recheck'
  FROM historical_failed_recovery h
  WHERE w.source_observation_id = h.source_observation_id
    AND w.property_id = h.property_id;

  RAISE NOTICE 'Recovery complete';
END $$;

COMMIT;
