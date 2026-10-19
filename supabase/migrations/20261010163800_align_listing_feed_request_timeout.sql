-- The existing poller has a 110-second admission deadline. Its cron HTTP
-- request currently gives up after 60 seconds, losing the final receipt even
-- while source work continues. Change only the transport timeout; retain the
-- schedule, enabled state, request body, URL and existing authentication.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

DO $align_feed_timeout$
DECLARE
  v_job_id bigint;
  v_command text;
  v_schedule text;
  v_old_clause constant text := 'timeout_milliseconds := 60000';
  v_new_clause constant text := 'timeout_milliseconds := 120000';
BEGIN
  SELECT jobid, command, schedule INTO v_job_id, v_command, v_schedule
    FROM cron.job WHERE jobname = 'poll-listing-feeds';

  IF v_job_id IS NULL OR v_command IS NULL OR v_schedule IS DISTINCT FROM '*/15 * * * *'
     OR v_command NOT LIKE '%/functions/v1/poll-listing-feeds%' THEN
    RAISE EXCEPTION 'Listing feed request contract changed; keep existing job untouched';
  END IF;

  IF strpos(v_command, v_new_clause) > 0 THEN
    RETURN; -- already aligned; preserve any existing pause
  END IF;

  IF length(v_command) - length(replace(v_command, v_old_clause, ''))
     <> length(v_old_clause) THEN
    RAISE EXCEPTION 'Expected one listing feed 60-second timeout; keep job untouched';
  END IF;

  PERFORM cron.alter_job(job_id := v_job_id,
    command := replace(v_command, v_old_clause, v_new_clause));
END
$align_feed_timeout$;

COMMIT;
