-- P0 of the approved lock-down plan (2026-09-27): close the public paths to the service key and to
-- owner-privileged SQL.
--
-- Measured before (read-only, 2026-09-27 ~15:30Z, no secret read):
--   * anonymous HEAD /rest/v1/_app_secrets with the public anon key -> HTTP 200, content-range 0-0/1
--     (the one row, which holds the service-role key, was readable by anyone holding the anon key)
--   * policy "Authenticated can read secrets" is FOR SELECT TO public USING (true); anon and authenticated
--     hold table grants
--   * has_function_privilege: anon can EXECUTE get_service_role_key_for_cron() and execute_sql(text);
--     authenticated can EXECUTE execute_sql(text). Both functions are SECURITY DEFINER, owned by postgres.
--
-- After: only postgres (owner, which pg_cron runs as) and service_role can read the table or call the two
-- functions. Cron HTTP jobs keep working. Admin pages that call execute_sql with a user session
-- (ScriptControlCenter, QuestionIntelligence, qi/*) stop working until they get narrow read functions.
--
-- The key that sat in the table must still be treated as exposed; replacing it is step P2 of the plan.
-- Undo: GRANT the same privileges back and recreate the policy (definition quoted above).

BEGIN;
DROP POLICY IF EXISTS "Authenticated can read secrets" ON public._app_secrets;
REVOKE ALL ON TABLE public._app_secrets FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_service_role_key_for_cron() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.execute_sql(text) FROM PUBLIC, anon, authenticated;
COMMIT;
