-- Close the two raw-SQL executor functions to service_role.
--
-- public.execute_recovery_sql(text) and public.exec_batch(text) are SECURITY DEFINER, owned by postgres, and run
-- their text argument verbatim (EXECUTE p_sql / EXECUTE sql_text) with no SELECT-only guard. A caller with the
-- service key reaches them through PostgREST and runs arbitrary SQL AS postgres — past RLS, past the append-only and
-- session_user insert guards on the testimony tables, which check the caller's role, not postgres. Measured live
-- 2026-10-20 (q.sh, read-only): EXECUTE is granted to postgres and service_role only; anon and authenticated already
-- hold none (exec_batch was closed to them by 20260930223000; execute_recovery_sql never appeared in a migration —
-- drift). Neither has a SELECT-only prefix check, unlike execute_sql / execute_readonly_query.
--
-- CONSUMER GREP (git grep across supabase/functions, scripts, tools, nuke_frontend; cron.job; 2026-10-20):
--   exec_batch(text)             — no caller anywhere in the repo, and no cron.job command references it.
--   execute_recovery_sql(text)   — only supabase/functions/extraction-watchdog (steps 2..5b of runRecoveryActions).
--     That function now reads the rpc { error } and falls back to its supabase-js UPDATEs when the call is refused
--     (the commit before this migration on this branch); step 5b records "did not run" instead of passing silently.
--     Its cron job (jobid 117, every 5 min) is INACTIVE and no watchdog_runs row exists after 2026-04-24, so the
--     path is dormant as well as guarded. No in-database object references either function (pg_proc.prosrc and
--     pg_views.definition scans returned 0; pg_depend shows 0 normal dependents).
-- Not touched here: execute_sql(text) and execute_readonly_query(text) carry a SELECT-only prefix check and are
-- called with the service key by ~12 deployed functions (enrich-bulk, discover-description-data, score-live-auctions,
-- calculate-market-indexes, analyze-comments-fast, batch-comment-discovery, mcp-connector, extract-barrett-jackson,
-- enrich-vehicles-cron, bat-snapshot-parser, pipeline-dashboard, analysis-engine-coordinator). Narrowing those is a
-- larger change (each consumer must move to a parameterized reader) and is left for a follow-up; see the S6/S7 report.
--
-- AFTER: only postgres (the owner, which q.sh and pg_cron run as) can call the two functions. service_role loses the
-- owner-escalation path through them. The function bodies are unchanged. Metadata-only; no table rewrite, no data.
--
-- Undo: GRANT EXECUTE ON FUNCTION public.execute_recovery_sql(text), public.exec_batch(text) TO service_role;
--
-- Drift guard: refuse unless each live body is the exact one reviewed for this change (md5 of pg_proc.prosrc,
-- read 2026-10-20). If either differs, rebase and re-review before revoking.
SET lock_timeout = '5s';
SET statement_timeout = '30s';

BEGIN;

DO $guard$
DECLARE
  v_recovery text := (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.execute_recovery_sql(text)'::regprocedure);
  v_exec_batch text := (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.exec_batch(text)'::regprocedure);
BEGIN
  IF v_recovery IS DISTINCT FROM '22a7d9555c5ef3b5104f02d5424bff1e' THEN -- gitleaks:allow (function-body fingerprint, not a secret)
    RAISE EXCEPTION 'execute_recovery_sql(text) body differs from the reviewed one (got %); rebase and review the drift', v_recovery;
  END IF;
  IF v_exec_batch IS DISTINCT FROM '3c2bd5ed2dd07e7677d4fc453b316fe6' THEN -- gitleaks:allow (function-body fingerprint, not a secret)
    RAISE EXCEPTION 'exec_batch(text) body differs from the reviewed one (got %); rebase and review the drift', v_exec_batch;
  END IF;
END
$guard$;

REVOKE EXECUTE ON FUNCTION public.execute_recovery_sql(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.exec_batch(text) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

-- VERIFY (read-only, after deploy):
--   select p.oid::regprocedure::text,
--          has_function_privilege('service_role', p.oid, 'EXECUTE') as svc,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authd,
--          has_function_privilege('anon', p.oid, 'EXECUTE') as anon
--   from pg_proc p
--   where p.oid in ('public.execute_recovery_sql(text)'::regprocedure, 'public.exec_batch(text)'::regprocedure);
--   -- expect svc/authd/anon all false; postgres (owner) keeps EXECUTE implicitly.
