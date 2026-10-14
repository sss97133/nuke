-- API keys are minted only by edge functions on the service key, so signed-in callers stop inserting and
-- updating them.
--
-- Measured 2026-10-14 ~10:55Z. api_keys holds hashed keys and the scopes each one carries; mcp-connector and
-- _shared/apiKeyAuth.ts honor those scopes ('admin' matches everything; 'write:canonical' reaches the canonical
-- writers). anon and authenticated hold INSERT and UPDATE on every column, and the policies "Users can create own
-- API keys" and "Users can update own API keys" only require user_id = auth.uid(). So a signed-in caller could
-- insert a key whose hash it chose with scopes {admin}, or widen its own key's scopes, then call the API with it.
-- Anyone can be signed in: /auth/v1/settings reports disable_signup false, mailer_autoconfirm true and anonymous
-- sign-ins enabled.
--
-- Who writes api_keys (git grep and pg_proc, 2026-10-14): api-keys-manage, api-v1-agent-register,
-- review-agent-submissions and api-v1-business-data, all on the service key; the SQL writers
-- (check_api_key_rate_limit, mcp_create_api_key, evaluate_agent_tier, record_agent_submission,
-- reset_api_key_rate_limits) are security definer and not executable by anon or authenticated. The web only reads
-- its own keys (UsageDashboardPage). Reading one's own keys and deleting one's own key stay as they are.
-- Contract: supabase/sql/test_api_keys_writes_service_only.sql (CI job api-keys-writes-contract).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

REVOKE INSERT, UPDATE, TRUNCATE ON public.api_keys FROM anon, authenticated;
DROP POLICY IF EXISTS "Users can create own API keys" ON public.api_keys;
DROP POLICY IF EXISTS "Users can update own API keys" ON public.api_keys;

DO $check$
BEGIN
  IF has_any_column_privilege('anon', 'public.api_keys', 'INSERT')
     OR has_any_column_privilege('anon', 'public.api_keys', 'UPDATE')
     OR has_any_column_privilege('authenticated', 'public.api_keys', 'INSERT')
     OR has_any_column_privilege('authenticated', 'public.api_keys', 'UPDATE')
     OR has_table_privilege('anon', 'public.api_keys', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.api_keys', 'TRUNCATE')
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'api_keys'
                AND cmd IN ('INSERT', 'UPDATE', 'ALL')) THEN
    RAISE EXCEPTION 'api_keys still accepts inserts or updates from anon or authenticated';
  END IF;
END $check$;

COMMIT;
