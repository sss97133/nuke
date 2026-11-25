-- Revert of 20261126063500_retained_projection_verdicts. Readers fall back to the gated live matcher (apply the revert
-- of 20261126064500 first if vehicle_facet_items reads the verdict).
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DO $$ BEGIN
  IF to_regclass('cron.job') IS NOT NULL AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retained-projection-grade') THEN
    PERFORM cron.unschedule('retained-projection-grade');
  END IF;
  IF to_regclass('public.private_row_policy_copies') IS NOT NULL THEN
    DELETE FROM public.private_row_policy_copies WHERE reader = 'retained_projection_verdicts_for(uuid[])';
  END IF;
END $$;
DELETE FROM public.platform_config WHERE config_key = 'retained_projection_verdicts';
DO $$ BEGIN
  IF to_regclass('public.job_assay_readings') IS NOT NULL THEN
    DELETE FROM public.job_assay_readings WHERE jobname = 'retained-projection-grade';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.retained_projection_verdict_gauge();
DROP PROCEDURE IF EXISTS public.retained_projection_grade_tick();
DROP FUNCTION IF EXISTS public.retained_projection_record_assay(timestamptz);
DROP VIEW IF EXISTS public.v_retained_projection_backfill;
DROP FUNCTION IF EXISTS public.retained_projection_grade_ids(uuid[], text);
DROP FUNCTION IF EXISTS public.retained_projection_verdicts_for(uuid[]);
DROP FUNCTION IF EXISTS public.retained_projection_input_fps(uuid[]);
DROP FUNCTION IF EXISTS public.retained_projection_body_key(oid[]);
DROP FUNCTION IF EXISTS public.retained_projection_closure();
DROP TABLE IF EXISTS public.retained_projection_backfill_cars;
DROP TABLE IF EXISTS public.retained_projection_grading_state;
DROP TABLE IF EXISTS public.retained_projection_verdicts;
