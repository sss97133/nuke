-- 20261008060000_close_import_queue_claim_doors.sql
--
-- Close two RPC write doors on import_queue, found by the describe-batch10 lane while describing the table (PR #844):
-- public.claim_import_queue_batch(integer, integer, boolean, uuid, text, integer) and
-- public.claim_import_queue_batch_by_domain(text, integer, integer, text, integer) are SECURITY DEFINER (owner postgres,
-- which has BYPASSRLS), have no identity check in their bodies, and on 2026-10-07 their ACLs still granted EXECUTE to
-- PUBLIC, anon and authenticated. import_queue has RLS on with one policy (import_queue_service_role), so anon reads 0 rows
-- of it at /rest/v1; but a call to either function at /rest/v1/rpc with the public anon key claimed up to 200 pending rows
-- (status processing, attempts + 1, locked_at and last_attempt_at now(), locked_by any text the caller sent) and returned
-- them in full (SETOF import_queue).
--
-- EVIDENCE (read-only, prod, 2026-10-07 17:06-17:12Z): prosecdef true for both; routine_privileges lists PUBLIC, anon,
-- authenticated, postgres and service_role with EXECUTE; neither body reads auth.uid(), auth.role() or request.jwt.
-- claim_import_queue_batch_by_source_id is SECURITY INVOKER (RLS applies; anon claims nothing) and is left alone.
-- Callers on origin/main 437a022ae: four edge functions, all through a client built with the service-role key:
-- process-import-queue (the drain of cron jobs 504 and 457), extract-gooding (cron job 371), continuous-queue-processor and
-- bat-queue-worker (both deployed with no active job). bat-queue-worker forwards an incoming Authorization token to its
-- client when one is present, and its requireWriteAuth admits a signed-in user's JWT, so a user calling that worker directly
-- would now get a permission error on the claim; no code or job calls it that way. No caller in nuke_frontend/src,
-- mcp-server, apps or scripts. pg_stat_user_functions is not collected (track_functions off), so call counts are not
-- available; import_queue shows 8,735 updates since the server start (2026-09-29 09:20Z), the drains' own work.
--
-- WHAT: class (c) of the 2026-09-27 RPC write-door pass (20260927170000) and the 20261007230000 treatment: REVOKE EXECUTE
-- from PUBLIC, anon and authenticated; keep service_role. Bodies unchanged. The function comments record the change, and the
-- two sentences of the 20261008053000 describe (PR #844) that record the open door (the table comment and locked_by) are
-- rewritten in place so they stay true; where that text is absent nothing is rewritten. Idempotent.
-- Reversal: GRANT EXECUTE ON FUNCTION public.claim_import_queue_batch(integer, integer, boolean, uuid, text, integer),
--           public.claim_import_queue_batch_by_domain(text, integer, integer, text, integer) TO anon, authenticated;
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

REVOKE ALL ON FUNCTION public.claim_import_queue_batch(integer, integer, boolean, uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_import_queue_batch_by_domain(text, integer, integer, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_import_queue_batch(integer, integer, boolean, uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_import_queue_batch_by_domain(text, integer, integer, text, integer) TO service_role;

COMMENT ON FUNCTION public.claim_import_queue_batch(integer, integer, boolean, uuid, text, integer) IS
'Claim up to p_batch_size (1 to 200, default 20) pending import_queue rows for a worker and return them (SETOF import_queue): rows with status pending, attempts under p_max_attempts (default 3), next_attempt_at NULL or passed, and no lock or a lock older than p_lock_ttl_seconds (30 to 3600, default 900); only rows with priority above 0 when p_priority_only, only one source when p_source_id is given; highest priority first, then newest listing_year, then oldest created_at; FOR UPDATE SKIP LOCKED. Each claimed row gets status processing, attempts + 1, locked_at and last_attempt_at now(), and locked_by p_worker_id (unknown when NULL). SECURITY DEFINER writer (owner postgres, empty search_path): EXECUTE for service_role only since 2026-10-07 (20261008060000; PUBLIC, anon and authenticated could run it before, so anyone with the public anon key could claim and read the queue through /rest/v1/rpc). Callers on origin/main, 2026-10-07: process-import-queue (cron jobs 504 and 457), extract-gooding (cron job 371) and bat-queue-worker (no active job), all with the service-role key.';

COMMENT ON FUNCTION public.claim_import_queue_batch_by_domain(text, integer, integer, text, integer) IS
'Claim up to p_batch_size (1 to 200, default 20) pending import_queue rows whose listing_url matches p_domain_pattern (LIKE) for a worker and return them (SETOF import_queue), with the same eligibility, order, lock takeover and row changes as claim_import_queue_batch. SECURITY DEFINER writer (owner postgres, empty search_path): EXECUTE for service_role only since 2026-10-07 (20261008060000; PUBLIC, anon and authenticated could run it before). Caller on origin/main, 2026-10-07: continuous-queue-processor (deployed, no active job), with the service-role key.';

-- Keep the 20261008053000 describe true: rewrite the two sentences that record the open door, where they are present.
DO $$
DECLARE
  t text := obj_description('public.import_queue'::regclass, 'pg_class');
  old_t text := 'Paths around RLS: claim_import_queue_batch and claim_import_queue_batch_by_domain are SECURITY DEFINER with EXECUTE for anon and authenticated, so an anonymous call claims up to 200 pending rows (status processing, attempts plus 1, a lock under any worker id) and returns them in full; claim_import_queue_batch_by_source_id runs with the rights of the caller and claims nothing for anon.';
  new_t text := 'Paths around RLS: none since 2026-10-07 (20261008060000). Until then claim_import_queue_batch and claim_import_queue_batch_by_domain, SECURITY DEFINER, had EXECUTE for anon and authenticated, so an anonymous call claimed up to 200 pending rows (status processing, attempts plus 1, a lock under any worker id) and read them in full; now EXECUTE for service_role only. claim_import_queue_batch_by_source_id runs with the rights of the caller and claims nothing for anon.';
  a smallint := (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.import_queue'::regclass AND attname = 'locked_by' AND NOT attisdropped);
  c text := CASE WHEN a IS NULL THEN NULL ELSE col_description('public.import_queue'::regclass, a) END;
  old_c text := 'An anonymous caller of claim_import_queue_batch can set any value.';
  new_c text := 'Until 2026-10-07 (20261008060000) an anonymous caller of claim_import_queue_batch could set any value; the claim functions are service_role only now.';
BEGIN
  IF t IS NOT NULL AND position(old_t IN t) > 0 THEN
    EXECUTE format('COMMENT ON TABLE public.import_queue IS %L', replace(t, old_t, new_t));
    RAISE NOTICE 'import_queue table comment: the open-door sentence rewritten';
  ELSE
    RAISE NOTICE 'import_queue table comment: nothing to rewrite (the 20261008053000 text is absent or already rewritten)';
  END IF;
  IF c IS NOT NULL AND position(old_c IN c) > 0 THEN
    EXECUTE format('COMMENT ON COLUMN public.import_queue.locked_by IS %L', replace(c, old_c, new_c));
    RAISE NOTICE 'import_queue.locked_by comment: the open-door sentence rewritten';
  ELSE
    RAISE NOTICE 'import_queue.locked_by comment: nothing to rewrite';
  END IF;
END $$;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.claim_import_queue_batch(integer, integer, boolean, uuid, text, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_import_queue_batch(integer, integer, boolean, uuid, text, integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.claim_import_queue_batch_by_domain(text, integer, integer, text, integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.claim_import_queue_batch_by_domain(text, integer, integer, text, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'an import_queue claim function is still executable by anon or authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.claim_import_queue_batch(integer, integer, boolean, uuid, text, integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.claim_import_queue_batch_by_domain(text, integer, integer, text, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role lost EXECUTE on an import_queue claim function';
  END IF;
  RAISE NOTICE 'import_queue claim functions: EXECUTE for service_role only';
END $$;

COMMIT;
