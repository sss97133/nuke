-- 20261008067000_extraction_metadata_write_policy_service_role.sql
--
-- Close the anonymous write door on extraction_metadata, found by the describe-batch11 lane (PR #849). The policy
-- "Service role can manage extraction metadata" is FOR ALL with no role list, so it applies to every role, anon included,
-- with USING (true) and WITH CHECK (true); anon and authenticated hold INSERT, UPDATE and DELETE on the table. So anyone
-- with the public anon key could insert, change or delete any of its rows (about 1.67M) through /rest/v1.
--
-- EVIDENCE (read-only, prod, 2026-10-07 18:15Z): pg_policies lists two policies on the table: "Anyone can view extraction
-- metadata" (SELECT, roles {public}, USING true) and "Service role can manage extraction metadata" (ALL, roles {public},
-- USING true, WITH CHECK true). has_table_privilege('anon', 'public.extraction_metadata', 'INSERT') and 'DELETE' are true.
-- Writers on origin/main: extract-bat-core and the shared write layer, through service-role clients. The web app reads it
-- (hooks/useDealRead.ts, lib/dealRead/batComps.ts, lib/dealRead/writeUps.ts, pages/DealRead.tsx) and never writes it.
--
-- WHAT: ALTER POLICY ... TO service_role, the treatment of 20261008010000 (vin_decoded_data) and 20261008014000
-- (publication_pages). The SELECT policy is unchanged, so every reader keeps reading. The clause of the 20261008064000
-- describe (PR #849) that records the open door is rewritten in place when it is present, so the comment stays true.
-- Idempotent.
-- Reversal: ALTER POLICY "Service role can manage extraction metadata" ON public.extraction_metadata TO public;
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

ALTER POLICY "Service role can manage extraction metadata" ON public.extraction_metadata TO service_role;

DO $$
DECLARE
  t text := obj_description('public.extraction_metadata'::regclass, 'pg_class');
  old_t text := 'the policy named Service role can manage extraction metadata is FOR ALL to every role with USING (true) and WITH CHECK (true), and anon and authenticated hold SELECT, INSERT, UPDATE, DELETE and TRUNCATE, so any caller with the public API key can insert, change or delete any row;';
  new_t text := 'the policy named Service role can manage extraction metadata was FOR ALL to every role with USING (true) and WITH CHECK (true) until 2026-10-07, so any caller with the public API key could insert, change or delete any row; since 20261008067000 it applies to service_role only, and anon and authenticated keep their table grants (SELECT, INSERT, UPDATE, DELETE and TRUNCATE) while only the SELECT policy admits them;';
BEGIN
  IF t IS NOT NULL AND position(old_t IN t) > 0 THEN
    EXECUTE format('COMMENT ON TABLE public.extraction_metadata IS %L', replace(t, old_t, new_t));
    RAISE NOTICE 'extraction_metadata table comment: the open-door clause rewritten';
  ELSE
    RAISE NOTICE 'extraction_metadata table comment: nothing to rewrite (the 20261008064000 text is absent or already rewritten)';
  END IF;
END $$;

DO $$
DECLARE
  r text;
BEGIN
  SELECT roles::text INTO r FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'extraction_metadata' AND policyname = 'Service role can manage extraction metadata';
  IF r IS DISTINCT FROM '{service_role}' THEN
    RAISE EXCEPTION 'extraction_metadata write policy applies to %, expected {service_role}', r;
  END IF;
  RAISE NOTICE 'extraction_metadata: write policy scoped to service_role; the SELECT policy is unchanged';
END $$;

COMMIT;
