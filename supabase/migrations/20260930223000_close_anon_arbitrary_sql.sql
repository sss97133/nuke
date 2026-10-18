-- Close the anonymous doors to arbitrary SQL, and to direct writes on three testimony tables.
--
-- MEASURED LIVE 2026-09-30 ~22:00Z (read-only, pg_proc / pg_policies / information_schema):
--   public.exec_batch(text) and public.execute_readonly_query(text) are SECURITY DEFINER, owned by postgres,
--   with EXECUTE granted to anon and authenticated (has_function_privilege = true for both). Their bodies run
--   EXECUTE on their argument. Neither exists in any migration in the repo (drift). Any holder of the public
--   anon key (it ships in the frontend bundle) could run any SQL as postgres, which reaches every
--   service_role-only correction chokepoint and every lock (P0..P3, Locks 1-4).
--   field_evidence, vehicle_events and vehicle_field_provenance each carry an ALL-command RLS policy
--   TO public with USING (true) WITH CHECK (true) ("Service role manages evidence",
--   "vehicle_events_service_write", "Service role manages provenance"), plus table grants of INSERT and UPDATE
--   to anon and authenticated, and DELETE and TRUNCATE on field_evidence and vehicle_field_provenance.
--   So any caller could insert, edit or delete evidence around correct_field_evidence.
--
-- REPO CALLERS (git grep, main at e101513):
--   execute_readonly_query: supabase/functions/analysis-engine-coordinator/index.ts:481 and
--   scripts/backfill-analysis-signals.mjs:69, both with the service key. service_role keeps EXECUTE.
--   exec_batch: no caller in the repo.
--   No frontend, MCP or app code inserts, updates or deletes the three tables directly (32 read references).
--
-- WHAT THIS DOES: revoke the two executors from anon, authenticated and PUBLIC; restrict the three ALL
-- policies to service_role (which bypasses RLS anyway, so its writers are unchanged); take DELETE and
-- TRUNCATE on the two evidence tables away from anon and authenticated (the Lock 3 gap).
-- Metadata-only changes; no table rewrite, no data change.
SET statement_timeout = '30s';
SET lock_timeout = '5s';

REVOKE EXECUTE ON FUNCTION public.exec_batch(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.execute_readonly_query(text) FROM PUBLIC, anon, authenticated;

ALTER POLICY "Service role manages evidence" ON public.field_evidence TO service_role;
ALTER POLICY "vehicle_events_service_write" ON public.vehicle_events TO service_role;
ALTER POLICY "Service role manages provenance" ON public.vehicle_field_provenance TO service_role;

REVOKE DELETE, TRUNCATE ON public.field_evidence, public.vehicle_field_provenance FROM anon, authenticated;

-- VERIFY (read-only, after the deploy):
--   select proname, has_function_privilege('anon', oid, 'EXECUTE') as anon_exec,
--          has_function_privilege('authenticated', oid, 'EXECUTE') as auth_exec
--   from pg_proc where proname in ('exec_batch', 'execute_readonly_query');          -- all false
--   select tablename, policyname, roles from pg_policies
--   where policyname in ('Service role manages evidence', 'vehicle_events_service_write',
--                        'Service role manages provenance');                          -- {service_role}
--   select table_name, grantee, privilege_type from information_schema.role_table_grants
--   where table_name in ('field_evidence', 'vehicle_field_provenance') and grantee in ('anon', 'authenticated')
--     and privilege_type in ('DELETE', 'TRUNCATE');                                   -- no rows
--   curl -sS -o /dev/null -w "%{http_code}\n" -X POST "$SUPA/rest/v1/rpc/exec_batch" \
--     -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
--     -d '{"sql_text":"select 1"}'                                                    -- 401/403/404, not 204
