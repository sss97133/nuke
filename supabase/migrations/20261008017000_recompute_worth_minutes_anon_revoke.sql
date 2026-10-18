-- 20261008017000_recompute_worth_minutes_anon_revoke.sql
--
-- Close the anonymous door on public.recompute_worth_minutes(uuid): a SECURITY DEFINER function that rewrites the minutes
-- and labor cost of a vehicle's work sessions (derived from vehicle_images.taken_at gaps), EXECUTE-granted to PUBLIC, anon,
-- authenticated and service_role (proacl read 2026-10-07 16:04Z). Anyone with the public key could recompute any vehicle's
-- labor through /rest/v1/rpc/recompute_worth_minutes. Found by the describe-batch9 lane (PR #836).
--
-- WHAT: REVOKE from PUBLIC and anon; keep authenticated (the owner's capture app mirrors "the web's recompute" while signed
-- in, apps/nuke-capture-ios LocalStore.swift) and service_role. The 2026-09-27 pass (20260927170000) kept authenticated on
-- functions the apps call; this follows that class (b). Scoping it to the vehicle's owner is the day shift's call (the
-- body takes any vehicle id). Idempotent; a guard fails the apply if anon can still execute it.
-- Reversal: GRANT EXECUTE ON FUNCTION public.recompute_worth_minutes(uuid) TO anon;
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

REVOKE ALL ON FUNCTION public.recompute_worth_minutes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recompute_worth_minutes(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.recompute_worth_minutes(uuid) IS
'Recomputes a vehicle''s work-session minutes and labor cost from the gaps between its approved, non-duplicate image capture times (vehicle_images.taken_at) and writes them onto work_sessions. SECURITY DEFINER. EXECUTE for authenticated and service_role since 2026-10-07 (20261008017000; anon could run it before, missed by the 2026-09-27 pass). Caller: the capture app and the web while signed in. It takes any vehicle id: scoping to the vehicle''s owner is still open.';

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.recompute_worth_minutes(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'recompute_worth_minutes is still executable by anon';
  END IF;
  RAISE NOTICE 'recompute_worth_minutes: anon revoked; authenticated and service_role keep EXECUTE';
END $$;

COMMIT;
