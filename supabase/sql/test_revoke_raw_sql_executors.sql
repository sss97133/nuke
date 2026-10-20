-- Disposable PG17 only. Rebuilds live's two raw-SQL executor functions (bodies whose md5 the migration pins,
-- read 2026-10-20) with their live ACL {postgres, service_role}, applies the migration, and proves:
--   * after it, service_role, authenticated and anon can EXECUTE neither function; postgres (owner) still can;
--   * the function bodies are unchanged (same md5);
--   * re-applying is a no-op;
--   * the drift guard refuses a body it has not reviewed.
-- The 32-hex strings below are md5 fingerprints of function bodies, not secrets (gitleaks:allow annotated).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regprocedure('public.execute_recovery_sql(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Live bodies verbatim (pg_get_functiondef, 2026-10-20), so md5(prosrc) equals the values the migration pins.
CREATE OR REPLACE FUNCTION public.execute_recovery_sql(p_sql text)
 RETURNS TABLE(affected bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.exec_batch(sql_text text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ BEGIN EXECUTE sql_text; END; $function$;

-- Live ACL: EXECUTE revoked from PUBLIC, granted to service_role (exec_batch lost anon/authenticated in 20260930223000).
REVOKE ALL ON FUNCTION public.execute_recovery_sql(text), public.exec_batch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_recovery_sql(text), public.exec_batch(text) TO service_role;

-- Precondition: the md5s match what the migration pins (so the body copies above are faithful), and service_role starts
-- with EXECUTE.
DO $$ BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.execute_recovery_sql(text)'::regprocedure)
       <> '22a7d9555c5ef3b5104f02d5424bff1e' THEN RAISE EXCEPTION 'recovery body md5 drifted'; END IF; -- gitleaks:allow (function-body fingerprint)
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.exec_batch(text)'::regprocedure)
       <> '3c2bd5ed2dd07e7677d4fc453b316fe6' THEN RAISE EXCEPTION 'exec_batch body md5 drifted'; END IF; -- gitleaks:allow (function-body fingerprint)
  IF NOT has_function_privilege('service_role', 'public.execute_recovery_sql(text)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.exec_batch(text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'precondition: service_role should start with EXECUTE'; END IF;
END $$;

\echo '== applying 20261021230000_revoke_raw_sql_executors_from_service_role.sql'
\ir ../migrations/20261021230000_revoke_raw_sql_executors_from_service_role.sql

-- After: no runtime role may execute either; postgres (owner) still may; bodies unchanged.
DO $$ BEGIN
  IF has_function_privilege('service_role', 'public.execute_recovery_sql(text)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.execute_recovery_sql(text)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.execute_recovery_sql(text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'execute_recovery_sql still executable by a runtime role'; END IF;
  IF has_function_privilege('service_role', 'public.exec_batch(text)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.exec_batch(text)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.exec_batch(text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'exec_batch still executable by a runtime role'; END IF;
  IF NOT has_function_privilege('postgres', 'public.execute_recovery_sql(text)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('postgres', 'public.exec_batch(text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'postgres (owner) lost EXECUTE'; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.execute_recovery_sql(text)'::regprocedure)
       <> '22a7d9555c5ef3b5104f02d5424bff1e' THEN RAISE EXCEPTION 'execute_recovery_sql body changed'; END IF; -- gitleaks:allow (function-body fingerprint)
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.exec_batch(text)'::regprocedure)
       <> '3c2bd5ed2dd07e7677d4fc453b316fe6' THEN RAISE EXCEPTION 'exec_batch body changed'; END IF; -- gitleaks:allow (function-body fingerprint)
END $$;
\echo '   ok: both functions executable by postgres only; bodies unchanged'

\echo '== re-applying (expect no error)'
\ir ../migrations/20261021230000_revoke_raw_sql_executors_from_service_role.sql
\echo '   ok: idempotent'

\echo '== drift: mutate exec_batch body, the migration guard must refuse and change nothing'
CREATE OR REPLACE FUNCTION public.exec_batch(sql_text text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ BEGIN EXECUTE sql_text; /* drift */ END; $function$;
-- Restore EXECUTE so the guard, not a missing grant, is what the next apply would hit.
GRANT EXECUTE ON FUNCTION public.exec_batch(text) TO service_role;
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    EXECUTE $m$ DO $g$
      DECLARE v text := (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.exec_batch(text)'::regprocedure);
      BEGIN
        IF v IS DISTINCT FROM '3c2bd5ed2dd07e7677d4fc453b316fe6' THEN  -- gitleaks:allow (function-body fingerprint)
          RAISE EXCEPTION 'exec_batch(text) body differs from the reviewed one';
        END IF;
      END $g$; $m$;
  EXCEPTION WHEN others THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'drift guard did not refuse a changed body'; END IF;
END $$;
\echo '   ok: drift guard refuses an unreviewed body'

\echo 'test_revoke_raw_sql_executors: PASS'
