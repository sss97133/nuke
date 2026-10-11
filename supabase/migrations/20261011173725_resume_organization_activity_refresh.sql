-- Activation proposal for the existing organization listing cache owner only.
-- No native intake, source records, other job, HTTP body or credential changes.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '3s';
DO $resume$
DECLARE j record;
BEGIN
  IF to_regprocedure('public.organization_listing_activity_candidates(integer)') IS NULL
    OR to_regprocedure('public.compute_organization_listing_activity(uuid)') IS NULL THEN
    RAISE EXCEPTION 'organization_listing_fold_not_installed';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.organization_listing_activity_candidates(integer)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.organization_listing_activity_candidates(integer)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.organization_listing_activity_candidates(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'organization_listing_selector_access_changed';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.compute_organization_listing_activity(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.compute_organization_listing_activity(uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.compute_organization_listing_activity(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'organization_listing_fold_access_changed';
  END IF;
  SELECT jobid, schedule, active, command INTO j FROM cron.job
    WHERE jobid = 263 AND jobname = 'compute-org-seller-stats-daily' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'organization_refresh_job_changed'; END IF;
  IF encode(sha256(convert_to(j.command, 'UTF8')), 'base64') IS DISTINCT FROM
    'eidSpC4R4IQE1jlKoDOW1agaJoNZ4fHTXWot4k12bvQ=' THEN
    RAISE EXCEPTION 'organization_refresh_command_changed';
  END IF;
  IF j.active AND j.schedule = '*/10 * * * *' THEN RETURN; END IF;
  -- A later owner pause on the new cadence must not be undone by reapplication.
  IF j.active OR j.schedule IS DISTINCT FROM '0 4 * * *' THEN
    RAISE EXCEPTION 'organization_refresh_pause_or_cadence_changed';
  END IF;
  PERFORM cron.alter_job(job_id := j.jobid, schedule := '*/10 * * * *', active := true);
END $resume$;
COMMIT;
