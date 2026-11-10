-- Inverse of 20261115130000: restore has_evidence visual conjunct to > 0.
-- Refuses if the 20261115130000 marker is not present.

SET lock_timeout = '5s';
SET statement_timeout = '120s';

DO $do$
DECLARE
  v_plan text;
  v_n int;
  v_new text := $ev$coalesce((t.signals->>'visual')::numeric, 0) >= 1.0  -- (20261115130000) trace visual is not evidence
              or coalesce((t.signals->>'vin')::numeric, 0) > 0$ev$;
  v_old text := $ev$coalesce((t.signals->>'visual')::numeric, 0) > 0 or coalesce((t.signals->>'vin')::numeric, 0) > 0$ev$;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_plan
    FROM pg_proc
   WHERE proname = 'capture_landing_plan_step' AND pronargs = 2 AND pronamespace = 'public'::regnamespace;
  IF position('(20261115130000)' in coalesce(v_plan,'')) = 0 THEN
    RAISE EXCEPTION 'refusing revert: live plan_step does not carry the 20261115130000 marker';
  END IF;
  v_n := (length(v_plan) - length(replace(v_plan, v_new, ''))) / length(v_new);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'capture_landing_plan_step visual-floor marker drifted (n=%); refusing revert', v_n;
  END IF;
  v_plan := replace(v_plan, v_new, v_old);
  IF position('(20261115130000)' in v_plan) > 0 THEN
    RAISE EXCEPTION 'revert did not remove the 20261115130000 marker';
  END IF;
  EXECUTE v_plan;
END
$do$;

REVOKE ALL ON FUNCTION public.capture_landing_plan_step(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_landing_plan_step(uuid, integer) TO service_role;
