-- Restore the 12 Nov live capture_landing_plan_step body (typ + identity).
-- Refuses if the 20261116243000 marker is absent (nothing to revert) or if
-- the current body no longer looks like the patched function.

SET lock_timeout = '5s';
SET statement_timeout = '120s';

DO $do$
DECLARE v_plan text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_plan
    FROM pg_proc
   WHERE proname = 'capture_landing_plan_step' AND pronargs = 2
     AND pronamespace = 'public'::regnamespace;
  IF v_plan IS NULL THEN RAISE EXCEPTION 'capture_landing_plan_step is not live'; END IF;
  IF position('20261116243000' in v_plan) = 0 THEN
    RAISE NOTICE 'capture_landing_plan_step does not carry 20261116243000; nothing to revert';
    RETURN;
  END IF;
END
$do$;

\i supabase/sql/helpers/capture_landing_plan_step_live_parent_20261116243000.sql
