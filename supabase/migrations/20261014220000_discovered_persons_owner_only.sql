-- discovered_persons (people's names, emails and phones) and the two contact-search resolvers stop being reachable
-- by anon and authenticated.
--
-- Live on 2026-10-14: discovered_persons had "Public read discovered persons" (SELECT TO public USING true) and the
-- table-wide SELECT granted to anon and authenticated, so a logged-out visitor read every row (full_name, email,
-- phone) — 2,388 rows, 605 with an email, 2,193 with a phone. Two SECURITY INVOKER functions, resolve_contact_vehicle(text)
-- and resolve_vehicle_from_input(text, uuid), hold EXECUTE for PUBLIC (and anon, authenticated): they fuzzy-match an
-- arbitrary query string across deal_contacts, work_orders and discovered_persons and return the matching person's
-- name, email and phone, so they are an anonymous contact-search endpoint over the same PII.
--
-- No web, iOS or edge function reads discovered_persons or calls either resolver (grep of nuke_frontend, apps,
-- supabase/functions and TOOLS.md, 2026-10-14), and no other function calls them. After this:
--   * EXECUTE on both resolvers is revoked from PUBLIC, anon and authenticated; service_role and postgres keep it.
--   * The "Public read discovered persons" policy is dropped and SELECT on discovered_persons is revoked from anon
--     and authenticated. The service role keeps its ALL policy and its grants, and still reads and writes the table.
-- INSERT/UPDATE/DELETE and the service policy are otherwise unchanged.
-- Live state: supabase/sql/helpers/discovered_persons_live_20261014.sql.
-- Contract: supabase/sql/test_discovered_persons_owner_only.sql (CI job discovered-persons-contract).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = public;

DO $guard$
DECLARE v_hash text;
BEGIN
  IF to_regprocedure('public.resolve_contact_vehicle(text)') IS NULL
     OR to_regprocedure('public.resolve_vehicle_from_input(text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'a discovered_persons resolver is missing';
  END IF;
  SELECT encode(sha256(convert_to(string_agg(
           p.polname || E'\t' || p.polcmd::text || E'\t' || p.polpermissive::text || E'\t'
           || coalesce((SELECT string_agg(r.rolname, ',' ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY (p.polroles)), 'public')
           || E'\t' || coalesce(pg_get_expr(p.polqual, p.polrelid), '')
           || E'\t' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
           E'\n' ORDER BY p.polname), 'UTF8')), 'base64')
    INTO v_hash
  FROM pg_policy p WHERE p.polrelid = 'public.discovered_persons'::regclass;
  IF v_hash NOT IN ('h5hm2+phM+2AbpNR5TkyYmc+sFV8023Pw834EO2Zqiw=', 'wYzgOhuykpnf+gJO48DElAXqxosACnzpWNsAx3pYG7I=') THEN
    RAISE EXCEPTION 'discovered_persons policies drifted from the 2026-10-14 read (hash %); not changing them', v_hash;
  END IF;
END $guard$;

REVOKE EXECUTE ON FUNCTION public.resolve_contact_vehicle(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_vehicle_from_input(text, uuid) FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Public read discovered persons" ON public.discovered_persons;
REVOKE SELECT ON public.discovered_persons FROM anon, authenticated;

DO $check$
BEGIN
  IF has_function_privilege('anon', 'public.resolve_contact_vehicle(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.resolve_vehicle_from_input(text, uuid)', 'EXECUTE')
     OR has_table_privilege('anon', 'public.discovered_persons', 'SELECT')
     OR has_table_privilege('authenticated', 'public.discovered_persons', 'SELECT')
     OR NOT has_function_privilege('service_role', 'public.resolve_contact_vehicle(text)', 'EXECUTE')
     OR NOT has_table_privilege('service_role', 'public.discovered_persons', 'SELECT') THEN
    RAISE EXCEPTION 'discovered_persons grants did not land as written';
  END IF;
END $check$;

COMMIT;
