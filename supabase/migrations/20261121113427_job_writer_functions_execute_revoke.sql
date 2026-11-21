-- Job writers: called by jobs and operators, no longer executable by anon or authenticated callers.
--
-- Same class as 20261014031500 (owner-run writers that became API endpoints through a default grant), for the
-- functions created since. On 2026-11-21 (UTC), 24 SECURITY DEFINER functions in public that contain INSERT, UPDATE
-- or DELETE, are not triggers and check no caller were executable by anon (pg_proc, has_function_privilege). Their
-- ACL is {=X/postgres, postgres=X/postgres, service_role=X/postgres}: the built-in EXECUTE to PUBLIC was never taken
-- away. Nineteen of them, and three wrappers that only call them, are the 22 below: the photo landing, requeue and
-- unwind jobs, session-event consolidation, identifier ingest and promotion, and the vehicle activity folds.
--
-- Who calls them (main and the live database, 2026-11-21 UTC):
--   * no web, phone, Vercel, edge-function or workflow code: outside supabase/migrations and supabase/sql the
--     names appear only in docs and in scripts/photo-pipeline/subscription_gate_reader.py, which calls
--     capture_landing_gate_check and capture_landing_apply_chunk with the service key;
--   * inside the database: each other, capture_sets_landing_run and revert_last_activity_at_v1 (owner-run, already
--     closed), three owner-run trigger functions (trg_vehicle_activity_image, _timeline, _work_session call
--     vehicle_activity_bump) and the scheduled job capture-sets-landing-tick. All 129 active scheduled jobs run as
--     postgres. No function that runs as its caller names one, and no policy, view or materialized view does;
--   * at runtime: pg_stat_statements held 2 statements that name them (1,276 calls at 07:57 UTC), both run by
--     postgres.
--   A function that runs as its owner calls these with the owner's privilege, so none of that changes.
--
-- This revokes EXECUTE from PUBLIC, anon and authenticated on exactly these signatures and grants it to
-- service_role explicitly. The owner keeps its own. No body and no row changes.
--
-- Kept open, reviewed: register_make_model_subject, validate_data_room_access_code and
-- analyze_organization_data_signals (kept by 20261014031500; the web or the phone calls them), and
-- get_pipeline_pulse (the system status page calls it; it writes a per-day count cache).
--
-- It refuses to run if a function that runs as its caller, and that anon or authenticated may execute, calls one of
-- the 22: that caller would start failing for its clients. None exists today. A signature that no longer exists is
-- skipped with a notice. CREATE OR REPLACE keeps these privileges; a function dropped and created again gets the
-- default grant back.
-- Contract: supabase/sql/test_job_writer_functions_execute_revoke.sql
-- Revert: supabase/sql/revert_20261121113427_job_writer_functions_execute_revoke.sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $revoke$
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
  v_callers text;
  done int := 0;
BEGIN
  -- A caller that runs as its own caller needs that caller's EXECUTE on what it calls. Refuse rather than break one.
  SELECT string_agg(DISTINCT q.oid::regprocedure::text || ' calls ' || t.proname, '; ') INTO v_callers
    FROM unnest(sigs) x
    JOIN pg_proc t ON t.oid = to_regprocedure(x)
    JOIN pg_proc q ON q.pronamespace = 'public'::regnamespace AND NOT q.prosecdef AND q.oid <> t.oid
                  AND q.prosrc ~* ('(^|[^a-z0-9_])' || t.proname || '\s*\(')
   WHERE has_function_privilege('anon', q.oid, 'EXECUTE') OR has_function_privilege('authenticated', q.oid, 'EXECUTE');
  IF v_callers IS NOT NULL THEN
    RAISE EXCEPTION 'a function that runs as its caller and is open to anon or authenticated calls a job writer; revoking would break it: %',
      v_callers;
  END IF;

  FOREACH s IN ARRAY sigs LOOP
    IF to_regprocedure(s) IS NULL THEN
      RAISE NOTICE 'skipped, no longer exists: %', s;
      CONTINUE;
    END IF;
    IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(s)) THEN
      RAISE EXCEPTION '% no longer runs as its owner; this migration was written for owner-run functions', s;
    END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', to_regprocedure(s));
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', to_regprocedure(s));
    done := done + 1;
  END LOOP;

  -- Verify: none of them is executable by anon or authenticated; the service role keeps every one.
  IF EXISTS (SELECT FROM unnest(sigs) x WHERE to_regprocedure(x) IS NOT NULL
               AND (has_function_privilege('anon', to_regprocedure(x), 'EXECUTE')
                    OR has_function_privilege('authenticated', to_regprocedure(x), 'EXECUTE')
                    OR NOT has_function_privilege('service_role', to_regprocedure(x), 'EXECUTE'))) THEN
    RAISE EXCEPTION 'a job writer is still executable by anon or authenticated, or lost the service role';
  END IF;
  RAISE NOTICE 'revoked anon and authenticated EXECUTE on % job writer functions', done;
END $revoke$;

COMMIT;
