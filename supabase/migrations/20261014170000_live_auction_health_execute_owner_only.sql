-- get_live_auction_health() is operator telemetry; a logged-out visitor can no longer run it.
--
-- Live on 2026-10-14 the no-argument public.get_live_auction_health() (SECURITY DEFINER) granted EXECUTE to
-- anon and authenticated, while the public.get_live_auction_health(date) it wraps was already service_role and
-- postgres only. A logged-out caller (publishable key, /rest/v1/rpc/get_live_auction_health) got the auction
-- operator's internal state: cron job ids and each job's last run and status, per-platform monitoring health,
-- live-lot sync internals, average live bid dollars, and the closing-stream reading. The body also runs a LATERAL
-- `ORDER BY start_time DESC LIMIT 1` over cron.job_run_details (688,786 rows on 2026-10-14, indexed only on runid),
-- once per cron job, so an anonymous caller is a denial-of-service lever (measured 5-6 s when cold).
--
-- No web, iOS or edge caller invokes it; the only consumer is the view public.v_job_health, which is owned by
-- postgres and is not security_invoker, so it runs the function as its owner and does not rely on anon's or
-- authenticated's grant (and v_job_health is not granted to anon). After this, EXECUTE is postgres and service_role
-- only, matching the (date) overload. The function body is unchanged.
-- Live definition and grants: supabase/sql/helpers/get_live_auction_health_live_20261014.sql.
-- Contract: supabase/sql/test_live_auction_health_execute_owner_only.sql (CI job live-auction-health-execute-contract).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
BEGIN
  IF to_regprocedure('public.get_live_auction_health()') IS NULL THEN
    RAISE EXCEPTION 'public.get_live_auction_health() is missing';
  END IF;
END $guard$;

REVOKE EXECUTE ON FUNCTION public.get_live_auction_health() FROM anon, authenticated;

DO $check$
BEGIN
  IF has_function_privilege('anon', 'public.get_live_auction_health()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_live_auction_health()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.get_live_auction_health()', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_live_auction_health() execute grants did not land as written';
  END IF;
END $check$;

COMMIT;
