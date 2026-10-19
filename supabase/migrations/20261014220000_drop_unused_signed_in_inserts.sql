-- INSERT policies that any signed-in account passes, on 15 tables no client inserts into: dropped, and the API roles'
-- insert grants revoked where no scoped insert policy remains.
--
-- Anyone can be authenticated on production (2026-10-14): sign-up is open with mailer_autoconfirm, and anonymous
-- sign-ins are enabled. Each of these policies admits authenticated (or PUBLIC) with WITH CHECK (true) or
-- auth.uid() IS NOT NULL, so any account could add rows in any name: organization behavior signals (58,449 rows),
-- component identifications (36,378), image analysis records (9,559), organizations (8,382), unverified vehicle
-- owners (136) and contacts (129), parts catalog (105), brands (89), tag vocabulary (47), component definitions (16),
-- part catalog (7), archive imports (4), knowledge gaps (4), vehicle nomenclature (2) and research requests (1).
--
-- Writers (web, iOS, edge functions, scripts, SQL function bodies; 2026-10-14): none of these tables has a client
-- insert. Their writers are edge functions with the secret key (extract-gaa-classics, link-document-entities, ...)
-- and SQL functions the API roles cannot execute (log_knowledge_gap, queue_research_request, update_tag_usage,
-- create_organization_batch) or SECURITY DEFINER ones (generate_signals_from_org_vehicles). The scoped insert
-- policies stay: organizations "Users create orgs" (the discoverer) and vehicle_nomenclature_insert (the vehicle's
-- editors). anon loses every write grant on these tables; authenticated loses INSERT where nothing scoped remains,
-- and TRUNCATE.
-- Contract: supabase/sql/test_drop_unused_signed_in_inserts.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TEMP TABLE owp_open_inserts (tbl text NOT NULL, pol text NOT NULL, roles text NOT NULL, chk text NOT NULL,
  keeps_scoped_insert boolean NOT NULL, PRIMARY KEY (tbl, pol)) ON COMMIT DROP;
INSERT INTO owp_open_inserts VALUES
  ('organization_behavior_signals', 'obs_insert', 'PUBLIC', '(( SELECT auth.uid() AS uid) IS NOT NULL)', false),
  ('component_identifications', 'component_ids_create', 'authenticated', 'true', false),
  ('image_analysis_records', 'analysis_records_create', 'authenticated', 'true', false),
  ('organizations', 'Authenticated users can create businesses', 'PUBLIC', '(( SELECT auth.uid() AS uid) IS NOT NULL)', true),
  ('organizations', 'Users can create businesses', 'PUBLIC', '(( SELECT auth.uid() AS uid) IS NOT NULL)', true),
  ('vehicle_unverified_owners', 'vehicle_unverified_owners_insert', 'PUBLIC', '(( SELECT auth.uid() AS uid) IS NOT NULL)', false),
  ('unverified_contacts', 'unverified_contacts_insert', 'PUBLIC', '(( SELECT auth.uid() AS uid) IS NOT NULL)', false),
  ('parts_catalog', 'Verified users can contribute to parts catalog', 'PUBLIC', '(( SELECT auth.uid() AS uid) IS NOT NULL)', false),
  ('brands', 'Authenticated users can create brands', 'authenticated', 'true', false),
  ('tag_vocabulary', 'Authenticated users can suggest tags', 'PUBLIC', '(( SELECT auth.uid() AS uid) IS NOT NULL)', false),
  ('component_definitions', 'component_defs_auth_create', 'authenticated', 'true', false),
  ('part_catalog', 'Authenticated users can suggest parts', 'authenticated', 'true', false),
  ('archive_imports', 'archive_imports_insert', 'PUBLIC', '(( SELECT auth.uid() AS uid) IS NOT NULL)', false),
  ('knowledge_gaps', 'gaps_auth_create', 'authenticated', 'true', false),
  ('vehicle_nomenclature', 'vehicle_nomenclature_authenticated_write', 'authenticated', 'true', true),
  ('research_requests', 'research_create', 'authenticated', 'true', false);

-- Each policy as read on 2026-10-14 (a permissive INSERT with that role and check) or absent (a re-run); anything else
-- is drift, and nothing changes.
DO $$
DECLARE
  v_drift text;
BEGIN
  SELECT string_agg(format('%s.%s', o.tbl, o.pol), ', ') INTO v_drift
  FROM owp_open_inserts o
  LEFT JOIN pg_policy p ON p.polrelid = to_regclass('public.' || quote_ident(o.tbl)) AND p.polname = o.pol
  WHERE to_regclass('public.' || quote_ident(o.tbl)) IS NULL
     OR (p.oid IS NOT NULL AND NOT (
          p.polpermissive AND p.polcmd = 'a' AND p.polqual IS NULL
          AND (CASE WHEN p.polroles = '{0}'::oid[] THEN 'PUBLIC'
                    ELSE (SELECT string_agg(r.rolname, ',' ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY (p.polroles)) END) = o.roles
          AND regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), '\s+', ' ', 'g') = o.chk));
  IF v_drift IS NOT NULL THEN
    RAISE EXCEPTION 'unused signed-in inserts drifted from the 2026-10-14 read (%); not changing them', v_drift;
  END IF;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM owp_open_inserts ORDER BY tbl, pol LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.pol, r.tbl);
  END LOOP;
  FOR r IN SELECT tbl, bool_or(keeps_scoped_insert) AS keeps FROM owp_open_inserts GROUP BY tbl ORDER BY tbl LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM anon', r.tbl);
    EXECUTE format('REVOKE %s TRUNCATE ON public.%I FROM authenticated', CASE WHEN r.keeps THEN '' ELSE 'INSERT,' END, r.tbl);
  END LOOP;
END $$;

-- After: row security is on; no INSERT or ALL policy on these tables admits PUBLIC, anon or authenticated with a check
-- any signed-in account passes; anon holds no write grant; authenticated inserts only where a scoped policy remains.
DO $$
DECLARE
  v_open text;
BEGIN
  SELECT string_agg(problem, '; ') INTO v_open FROM (
    SELECT DISTINCT o.tbl || ': row security off' AS problem
    FROM owp_open_inserts o JOIN pg_class c ON c.oid = to_regclass('public.' || quote_ident(o.tbl))
    WHERE NOT c.relrowsecurity
    UNION ALL
    SELECT DISTINCT o.tbl || '.' || p.polname || ' admits any signed-in insert'
    FROM owp_open_inserts o JOIN pg_policy p ON p.polrelid = to_regclass('public.' || quote_ident(o.tbl))
    WHERE p.polpermissive AND p.polcmd IN ('a', '*')
      AND p.polroles && ARRAY[0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid]
      AND (p.polwithcheck IS NULL AND p.polcmd = 'a'
        OR regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), '\s+', ' ', 'g') IN
           ('true', '(( SELECT auth.uid() AS uid) IS NOT NULL)', '(auth.uid() IS NOT NULL)', '(auth.role() = ''authenticated''::text)'))
    UNION ALL
    SELECT DISTINCT o.tbl || ': anon holds ' || g.priv
    FROM owp_open_inserts o CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) g(priv)
    WHERE has_table_privilege('anon', to_regclass('public.' || quote_ident(o.tbl)), g.priv)
    UNION ALL
    SELECT DISTINCT o.tbl || ': authenticated still inserts with no scoped policy'
    FROM owp_open_inserts o
    WHERE NOT o.keeps_scoped_insert AND has_table_privilege('authenticated', to_regclass('public.' || quote_ident(o.tbl)), 'INSERT')
      AND NOT EXISTS (SELECT 1 FROM owp_open_inserts k WHERE k.tbl = o.tbl AND k.keeps_scoped_insert)
  ) found;
  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'unused signed-in inserts: still open after the change: %', v_open;
  END IF;
END $$;

COMMIT;
