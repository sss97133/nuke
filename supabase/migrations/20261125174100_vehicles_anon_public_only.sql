-- vehicles_anon_public_only_v1: a logged-out read that asks for non-public vehicles is answered empty at plan time.
--
-- WHY. Measured live 2026-11-25 (TransAm war board): GET /rest/v1/vehicles?select=id&is_public=eq.false&limit=1 as anon
-- answers HTTP 500 after 15.1 s (anon statement_timeout), twice. EXPLAIN as anon: Seq Scan on vehicles (cost 736k, 261k
-- non-public rows estimated) with the filter (NOT is_public) AND (vehicles_public_select OR vehicles_private_select).
-- No row can pass: for anon auth.uid() is null, so vehicles_private_select never admits and vehicles_public_select needs
-- is_public. The planner cannot see that, so it reads the whole heap (2.4 GB) looking for a row. Anyone can send the
-- request and hold a connection for 15 s. Disposable PG17, 1.6M rows / 2,500 MB, live policies: the tie function is
-- called 0 times for anon (with either its SQL or plpgsql body), so the cost is the scan alone.
--
-- WHAT CHANGES.
--   1. A RESTRICTIVE policy TO anon only: USING (is_public = true). For anon it admits exactly what the two permissive
--      policies already admit (above), so no logged-out answer changes. authenticated and service_role are untouched.
--   2. constraint_exclusion = on for the anon role. With it the planner checks the restriction clauses for
--      self-contradiction, finds is_public AND NOT is_public, and plans One-Time Filter: false. PostgREST applies the
--      impersonated role's settings on each request, as it does anon's statement_timeout; the NOTIFY reloads them.
--   PG17 with both: 0.7 ms (was a full scan); public reads unchanged. Either change alone still scans.
--   Cost, measured on prod read-only (EXPLAIN GENERIC_PLAN as anon, one warm session, 25 runs each, median planning ms
--   partition -> on): vehicles by id 0.54 -> 0.98; gallery ids by vehicle 6.51 -> 7.43; vehicles page 0.40 -> 0.64;
--   vehicle_images_public 7.36 -> 9.75. get_field_provenance call (top anon RPC) 2.37 -> 2.32 ms.
--
-- LIMIT. This closes the is_public=false shape only. Any anon filter on an unindexed vehicles column that matches no
-- row still scans until the 15 s timeout; that general case is filed separately.
--
-- REVERT. supabase/sql/revert_20261125174100_vehicles_anon_public_only.sql
-- TEST. supabase/sql/test_vehicles_anon_public_only.sql
SET lock_timeout = '3s';
SET statement_timeout = '30s';

-- Policy copies (private_row_policy_copies, 20261125204500): a definer reader that restates vehicles' read policies has
-- its policy hash recorded; adding this policy changes that hash. A copy row whose recorded hash was current just
-- before is re-recorded just after (this policy restricts anon only and no copy restates an anon branch); any other
-- row is left for the watch to report.
CREATE TEMP TABLE _vehicles_copy_before AS SELECT NULL::text AS reader, NULL::text AS policy_filter, NULL::text AS h LIMIT 0;
DO $b$ BEGIN
  IF to_regclass('public.private_row_policy_copies') IS NOT NULL THEN
    INSERT INTO _vehicles_copy_before
    SELECT c.reader, c.policy_filter, (SELECT policy_hash FROM public.private_row_policy_hash('vehicles', c.policy_filter))
      FROM public.private_row_policy_copies c WHERE c.relation = 'vehicles';
  END IF;
END $b$;

DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vehicles'
                    AND policyname = 'vehicles_anon_public_only') THEN
    CREATE POLICY vehicles_anon_public_only ON public.vehicles AS RESTRICTIVE FOR SELECT TO anon USING (is_public = true);
  END IF;
END $p$;

DO $a$ BEGIN
  IF to_regclass('public.private_row_policy_copies') IS NOT NULL THEN
    UPDATE public.private_row_policy_copies c
       SET recorded_hash = (SELECT policy_hash FROM public.private_row_policy_hash('vehicles', c.policy_filter)),
           recorded_at = now(),
           note = c.note || ' [re-recorded by 20261125174100: vehicles_anon_public_only added, anon only]'
      FROM _vehicles_copy_before b
     WHERE c.relation = 'vehicles' AND c.reader = b.reader AND c.policy_filter = b.policy_filter
       AND c.recorded_hash = b.h
       AND b.h IS DISTINCT FROM (SELECT policy_hash FROM public.private_row_policy_hash('vehicles', c.policy_filter));
  END IF;
END $a$;
DROP TABLE _vehicles_copy_before;
COMMENT ON POLICY vehicles_anon_public_only ON public.vehicles IS
'Logged-out readers see public vehicles only (what the permissive policies already admit for anon); with the anon role''s constraint_exclusion = on it lets the planner answer a request for non-public rows empty without a scan. Migration 20261125174100.';

ALTER ROLE anon SET constraint_exclusion = on;
NOTIFY pgrst, 'reload config';
