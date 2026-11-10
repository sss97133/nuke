-- A trace visual score must not count as evidence that launders session priors into clear.
-- Stacked after 20261111200000 (and live typ-patched plan_step 20261115123000): the
-- has_evidence visual conjunct is the same in both. Revert is the inverse replace.
-- Does not bump any epoch, does not call capture_landing_gate_check, does not clear the halt.

-- Why: 2026-02-27 scored a 10-photo set of a beige 1988 Chevrolet dually clear onto the
-- 1983 GMC K2500 at score 3.924 (visual 0.347, visual_margin 0.011, session 2.5).

SET lock_timeout = '5s';
SET statement_timeout = '120s';

DO $do$
DECLARE
  v_plan text;
  v_n int;
  v_old text := $ev$coalesce((t.signals->>'visual')::numeric, 0) > 0 or coalesce((t.signals->>'vin')::numeric, 0) > 0$ev$;
  v_new text := $ev$coalesce((t.signals->>'visual')::numeric, 0) >= 1.0  -- (20261115130000) trace visual is not evidence
              or coalesce((t.signals->>'vin')::numeric, 0) > 0$ev$;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_plan
    FROM pg_proc
   WHERE proname = 'capture_landing_plan_step' AND pronargs = 2 AND pronamespace = 'public'::regnamespace;
  IF v_plan IS NULL THEN RAISE EXCEPTION 'capture_landing_plan_step is not live'; END IF;
  IF position('(20261115130000)' in v_plan) > 0 THEN
    RAISE NOTICE 'capture_landing_plan_step already carries 20261115130000 visual evidence floor';
    RETURN;
  END IF;
  v_n := (length(v_plan) - length(replace(v_plan, v_old, ''))) / length(v_old);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'capture_landing_plan_step has_evidence visual conjunct drifted (n=%); refusing patch', v_n;
  END IF;
  v_plan := replace(v_plan, v_old, v_new);
  IF position('(20261115130000)' in v_plan) = 0 THEN
    RAISE EXCEPTION 'capture_landing_plan_step visual-floor patch did not land';
  END IF;
  EXECUTE v_plan;
END
$do$;

REVOKE ALL ON FUNCTION public.capture_landing_plan_step(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_landing_plan_step(uuid, integer) TO service_role;
