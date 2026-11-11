-- Drop the 20261115170000 extend/expire RPCs. Refuses if unreverted log rows remain
-- or if the (20261115170000) marker is absent.

SET statement_timeout = '30s';
SET lock_timeout = '5s';

DO $do$
DECLARE v_def text; n_ext int; n_exp int;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc
   WHERE proname='capture_landing_gate_extend_v1' AND pronamespace='public'::regnamespace
     AND pg_get_function_identity_arguments(oid)='p_user uuid, p_run uuid, p_dry boolean, p_cap integer';
  IF position('(20261115170000)' in coalesce(v_def,'')) = 0 THEN
    RAISE EXCEPTION 'refusing revert: capture_landing_gate_extend_v1 does not carry the 20261115170000 marker';
  END IF;
  SELECT count(*) INTO n_ext FROM capture_landing_gate_extend_log WHERE reverted_at IS NULL;
  SELECT count(*) INTO n_exp FROM capture_landing_gate_expire_log WHERE reverted_at IS NULL;
  IF n_ext > 0 OR n_exp > 0 THEN
    RAISE EXCEPTION 'refusing revert: % unreverted extend log rows, % unreverted expire log rows; revert those runs first', n_ext, n_exp;
  END IF;
END
$do$;

DROP FUNCTION IF EXISTS public.capture_landing_gate_extend_v1(uuid, uuid, boolean, integer);
DROP FUNCTION IF EXISTS public.capture_landing_gate_extend_revert_v1(uuid);
DROP FUNCTION IF EXISTS public.capture_landing_gate_expire_all_unclear_v1(uuid, uuid, boolean, integer);
DROP FUNCTION IF EXISTS public.capture_landing_gate_expire_all_unclear_revert_v1(uuid);
DROP TABLE IF EXISTS public.capture_landing_gate_extend_log;
DROP TABLE IF EXISTS public.capture_landing_gate_expire_log;
