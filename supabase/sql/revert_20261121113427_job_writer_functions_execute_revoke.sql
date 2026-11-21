-- Revert of 20261121113427_job_writer_functions_execute_revoke.sql. Not a migration; run by hand only if a caller
-- that needs one of these as anon or authenticated turns up, and prefer granting that one function to that one role.
-- It puts back the built-in EXECUTE to PUBLIC that the 22 job writers held before, which makes each of them an API
-- endpoint for anyone again. The service role's explicit grant stays. A signature that no longer exists is skipped.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $revert$
DECLARE
  sigs constant text[] := ARRAY[
    'public.backfill_vehicle_activity(integer,integer)',
    'public.capture_landing_advance(uuid)',
    'public.capture_landing_apply_chunk(uuid,integer)',
    'public.capture_landing_gate_check(uuid)',
    'public.capture_landing_new_chunk(uuid,text,timestamp with time zone,timestamp with time zone,boolean,uuid)',
    'public.capture_landing_tick()',
    'public.compute_vehicle_activity(uuid)',
    'public.identifier_observations_ingest(uuid,timestamp with time zone,timestamp with time zone)',
    'public.identifier_observations_promote(uuid,uuid,boolean,numeric,numeric)',
    'public.photo_evidence_unwind(text,text[],boolean)',
    'public.photo_evidence_unwind_revert(text)',
    'public.photo_gate_unfile_older_drain()',
    'public.photo_land_backfill_drain(integer)',
    'public.photo_pipeline_skip_duplicate_pending(uuid,uuid,boolean,integer)',
    'public.photo_requeue_apply(text,integer)',
    'public.photo_requeue_drain()',
    'public.photo_requeue_revert(text,integer)',
    'public.photo_yield_resnap_drain(integer)',
    'public.timeline_consolidate_pending_sessions(uuid,uuid,timestamp with time zone,timestamp with time zone,boolean)',
    'public.timeline_consolidate_revert(uuid)',
    'public.timeline_resolve_pending_for_images(uuid[],uuid)',
    'public.vehicle_activity_bump(uuid,text,timestamp with time zone)'
  ];
  s text;
  done int := 0;
BEGIN
  FOREACH s IN ARRAY sigs LOOP
    IF to_regprocedure(s) IS NULL THEN
      RAISE NOTICE 'skipped, no longer exists: %', s;
      CONTINUE;
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', to_regprocedure(s));
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', to_regprocedure(s));
    done := done + 1;
  END LOOP;
  RAISE NOTICE 'granted EXECUTE to PUBLIC again on % job writer functions', done;
END $revert$;

COMMIT;
