-- UPDATE, DELETE and ALL policies that any signed-in account passes, on 11 tables: dropped where no client writes,
-- scoped to the row's editors or to admins where one does. Three library triggers become SECURITY DEFINER so the
-- reference tables they maintain need no client write policy.
--
-- Anyone can be authenticated on production (2026-10-14): sign-up is open with mailer_autoconfirm, and anonymous
-- sign-ins are enabled. A policy that admits authenticated with USING (true), auth.uid() IS NOT NULL or
-- auth.role() = 'authenticated' is as open as one for anon. Plan-only EXPLAIN as a signed-in stranger: UPDATE planned
-- over every row of oem_vehicle_specs (57,877), reference_libraries (48,328), paint_codes (3,812),
-- vehicle_field_sources (1,919), acquisition_pipeline (864), vehicle_production_data (340), contact_inbox (240),
-- gm_paint_codes (18), deck_slides (15), vehicle_sale_settings (11) and reference_coverage (8); DELETE over every row
-- of four of them. The same stranger read every acquisition_pipeline row (seller contacts, offers, purchase prices,
-- buyer info) and every contact_inbox message (senders, bodies).
--
-- Writers (web, iOS, edge functions, scripts, SQL function bodies; 2026-10-14):
--   * oem_vehicle_specs, reference_libraries (updates), reference_coverage: only the triggers on library_documents
--     (link_document_to_specs, trigger_update_library_stats, update_coverage_on_upload), which ran as the uploader.
--     They become SECURITY DEFINER with search_path public, bodies unchanged; the open policies are dropped.
--     reference_libraries keeps its signed-in insert (the library pages) for the insert batch.
--   * paint_codes, gm_paint_codes, vehicle_production_data: no writer but the service role. Policies dropped.
--   * acquisition_pipeline: written by acquire-vehicle and process-cl-queue with the secret key; read by the
--     acquisitions page, an admin's page. The open update is dropped; the read is limited to active admins
--     (admin_users, the rule useAdminAccess applies).
--   * contact_inbox: read and updated from the admin inbox pages. Both "Admins can ..." policies now check that the
--     caller is an active admin; the reply-email function checks the same before it sends.
--   * vehicle_sale_settings: the owner's policy stays; the open ALL policy is dropped.
--   * deck_slides: edits and inserts now need an active admin; the deck page shows the editor to admins only.
--   * vehicle_field_sources: the vehicle editors write field sources (field editors, the title check, price
--     sources). The four open policies are replaced by an insert and an update for whoever may update the vehicle
--     (uploaded_by, user_id or owner_id, as vehicles_simple_update_policy) or holds an active
--     vehicle_user_permissions row; the existing contributor policies stay.
-- Contract: supabase/sql/test_close_signed_in_open_updates.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Every policy this migration changes or creates, as read on 2026-10-14 and as it leaves it, and the three trigger
-- functions; anything else is drift, and nothing changes.
DO $$
DECLARE
  v_drift text;
  v_admin constant text := '(EXISTS ( SELECT 1 FROM admin_users au WHERE ((au.user_id = ( SELECT auth.uid() AS uid)) AND au.is_active)))';
BEGIN
  WITH want(tbl, pol, cmd, roles_before, qual_before, chk_before, roles_after, qual_after, chk_after) AS (VALUES
    ('oem_vehicle_specs', 'oem_specs_write', '*', 'authenticated', 'true', 'true', NULL, NULL, NULL),
    ('reference_libraries', 'libraries_authenticated_update', 'w', 'authenticated', 'true', 'true', NULL, NULL, NULL),
    ('reference_coverage', 'coverage_auth_update', '*', 'authenticated', 'true', 'true', NULL, NULL, NULL),
    ('paint_codes', 'paint_codes_insert', 'a', 'authenticated', NULL, 'true', NULL, NULL, NULL),
    ('paint_codes', 'paint_codes_update', 'w', 'authenticated', 'true', 'true', NULL, NULL, NULL),
    ('gm_paint_codes', 'gm_paint_codes_insert', 'a', 'authenticated', NULL, 'true', NULL, NULL, NULL),
    ('gm_paint_codes', 'gm_paint_codes_update', 'w', 'authenticated', 'true', 'true', NULL, NULL, NULL),
    ('vehicle_production_data', 'vehicle_production_data_write', '*', 'PUBLIC', '(auth.role() = ''authenticated''::text)', NULL, NULL, NULL, NULL),
    ('vehicle_sale_settings', 'authenticated_full_access', '*', 'authenticated', 'true', 'true', NULL, NULL, NULL),
    ('acquisition_pipeline', 'authenticated_update', 'w', 'authenticated', 'true', 'true', NULL, NULL, NULL),
    ('acquisition_pipeline', 'authenticated_read', 'r', 'authenticated', 'true', NULL, 'authenticated', v_admin, NULL),
    ('contact_inbox', 'Admins can read contact inbox', 'r', 'authenticated', 'true', NULL, 'authenticated', v_admin, NULL),
    ('contact_inbox', 'Admins can update contact inbox', 'w', 'authenticated', 'true', NULL, 'authenticated', v_admin, v_admin),
    ('deck_slides', 'deck_slides_insert', 'a', 'PUBLIC', NULL, '(auth.uid() IS NOT NULL)', NULL, NULL, NULL),
    ('deck_slides', 'deck_slides_update_signed_in', 'w', 'authenticated', '(( SELECT auth.uid() AS uid) IS NOT NULL)',
      '(updated_by = ( SELECT auth.uid() AS uid))', NULL, NULL, NULL),
    ('vehicle_field_sources', 'insert/update by authenticated', 'a', 'authenticated', NULL, '(auth.role() = ''authenticated''::text)', NULL, NULL, NULL),
    ('vehicle_field_sources', 'vfs_insert_auth', 'a', 'authenticated', NULL, 'true', NULL, NULL, NULL),
    ('vehicle_field_sources', 'update by authenticated', 'w', 'authenticated', '(auth.role() = ''authenticated''::text)',
      '(auth.role() = ''authenticated''::text)', NULL, NULL, NULL),
    ('vehicle_field_sources', 'vfs_update_auth', 'w', 'authenticated', 'true', 'true', NULL, NULL, NULL)
  ), live AS (
    SELECT c.relname AS tbl, p.polname AS pol, p.polcmd::text AS cmd, p.polpermissive AS perm,
      CASE WHEN p.polroles = '{0}'::oid[] THEN 'PUBLIC'
        ELSE (SELECT string_agg(r.rolname, ',' ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY (p.polroles)) END AS roles,
      regexp_replace(regexp_replace(pg_get_expr(p.polqual, p.polrelid), '\s+', ' ', 'g'), 'public\.', '', 'g') AS qual,
      regexp_replace(regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), '\s+', ' ', 'g'), 'public\.', '', 'g') AS chk
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
  )
  SELECT string_agg(format('%s.%s', w.tbl, w.pol), ', ') INTO v_drift
  FROM want w LEFT JOIN live l ON l.tbl = w.tbl AND l.pol = w.pol
  WHERE NOT (
    (l.perm AND l.cmd = w.cmd AND l.roles = w.roles_before
       AND l.qual IS NOT DISTINCT FROM w.qual_before AND l.chk IS NOT DISTINCT FROM w.chk_before)
    OR (w.roles_after IS NULL AND l.pol IS NULL)
    OR (w.roles_after IS NOT NULL AND l.perm AND l.cmd = w.cmd AND l.roles = w.roles_after
       AND l.qual IS NOT DISTINCT FROM w.qual_after AND l.chk IS NOT DISTINCT FROM w.chk_after));
  -- The policies this migration creates: absent, or as it creates them.
  SELECT concat_ws(', ', v_drift, string_agg(format('%s.%s', n.tbl, n.pol), ', ')) INTO v_drift
  FROM (VALUES ('deck_slides', 'deck_slides_insert_admin', 'a'), ('deck_slides', 'deck_slides_update_admin', 'w'),
               ('vehicle_field_sources', 'vehicle_field_sources_editor_insert', 'a'),
               ('vehicle_field_sources', 'vehicle_field_sources_editor_update', 'w')) n(tbl, pol, cmd)
  JOIN pg_policy p ON p.polrelid = ('public.' || n.tbl)::regclass AND p.polname = n.pol
  WHERE p.polcmd::text <> n.cmd OR p.polroles <> ARRAY['authenticated'::regrole::oid] OR NOT p.polpermissive;
  -- The three trigger functions: the bodies as read, invoker (before) or definer with search_path public (after).
  SELECT concat_ws(', ', NULLIF(v_drift, ''), string_agg(f.sig, ', ')) INTO v_drift
  FROM (VALUES ('public.link_document_to_specs()', 'GxERBnQlifpgSPsKYEfU2GS1kiGsmoCpmuqt4C9b8J4='),
               ('public.trigger_update_library_stats()', 'SGfX8CJgHA8e7Ec/PYhK1SSkM3OrJPpFCBzLlOycsAE='),
               ('public.update_coverage_on_upload()', 'LIVoDelptMGykX4DU5bN7O65LreLKTB0N0CZCCBxY5U=')) f(sig, h)
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure(f.sig)
  WHERE p.oid IS NULL
     OR encode(sha256(convert_to(p.prosrc, 'UTF8')), 'base64') <> f.h
     OR NOT ((NOT p.prosecdef AND p.proconfig IS NULL) OR (p.prosecdef AND p.proconfig = ARRAY['search_path=public']));
  IF NULLIF(v_drift, '') IS NOT NULL THEN
    RAISE EXCEPTION 'signed-in open updates drifted from the 2026-10-14 read (%); not changing them', v_drift;
  END IF;
END $$;

-- 1. The library triggers maintain the reference tables as their owner; the reference tables take no client write.
ALTER FUNCTION public.link_document_to_specs() SECURITY DEFINER SET search_path = public;
ALTER FUNCTION public.trigger_update_library_stats() SECURITY DEFINER SET search_path = public;
ALTER FUNCTION public.update_coverage_on_upload() SECURITY DEFINER SET search_path = public;
DROP POLICY IF EXISTS oem_specs_write ON public.oem_vehicle_specs;
DROP POLICY IF EXISTS libraries_authenticated_update ON public.reference_libraries;
DROP POLICY IF EXISTS coverage_auth_update ON public.reference_coverage;

-- 2. Reference tables only the service role writes.
DROP POLICY IF EXISTS paint_codes_insert ON public.paint_codes;
DROP POLICY IF EXISTS paint_codes_update ON public.paint_codes;
DROP POLICY IF EXISTS gm_paint_codes_insert ON public.gm_paint_codes;
DROP POLICY IF EXISTS gm_paint_codes_update ON public.gm_paint_codes;
DROP POLICY IF EXISTS vehicle_production_data_write ON public.vehicle_production_data;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
  public.oem_vehicle_specs, public.reference_coverage, public.paint_codes, public.gm_paint_codes,
  public.vehicle_production_data
  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.reference_libraries FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.reference_libraries FROM authenticated;

-- 3. vehicle_sale_settings: the owner's policy only.
DROP POLICY IF EXISTS authenticated_full_access ON public.vehicle_sale_settings;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.vehicle_sale_settings FROM anon;
REVOKE TRUNCATE ON public.vehicle_sale_settings FROM authenticated;

-- 4. acquisition_pipeline and contact_inbox: active admins read and update; the service role writes.
DROP POLICY IF EXISTS authenticated_update ON public.acquisition_pipeline;
ALTER POLICY authenticated_read ON public.acquisition_pipeline
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = (SELECT auth.uid()) AND au.is_active));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.acquisition_pipeline FROM anon, authenticated;
ALTER POLICY "Admins can read contact inbox" ON public.contact_inbox
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = (SELECT auth.uid()) AND au.is_active));
ALTER POLICY "Admins can update contact inbox" ON public.contact_inbox
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = (SELECT auth.uid()) AND au.is_active))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = (SELECT auth.uid()) AND au.is_active));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.contact_inbox FROM anon;
REVOKE INSERT, DELETE, TRUNCATE ON public.contact_inbox FROM authenticated;

-- 5. deck_slides: active admins insert and edit, attributed.
DROP POLICY IF EXISTS deck_slides_insert ON public.deck_slides;
DROP POLICY IF EXISTS deck_slides_update_signed_in ON public.deck_slides;
DROP POLICY IF EXISTS deck_slides_insert_admin ON public.deck_slides;
DROP POLICY IF EXISTS deck_slides_update_admin ON public.deck_slides;
CREATE POLICY deck_slides_insert_admin ON public.deck_slides
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = (SELECT auth.uid()) AND au.is_active));
CREATE POLICY deck_slides_update_admin ON public.deck_slides
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = (SELECT auth.uid()) AND au.is_active))
  WITH CHECK (updated_by = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = (SELECT auth.uid()) AND au.is_active));

-- 6. vehicle_field_sources: whoever may update the vehicle, or an active vehicle permission.
DROP POLICY IF EXISTS "insert/update by authenticated" ON public.vehicle_field_sources;
DROP POLICY IF EXISTS vfs_insert_auth ON public.vehicle_field_sources;
DROP POLICY IF EXISTS "update by authenticated" ON public.vehicle_field_sources;
DROP POLICY IF EXISTS vfs_update_auth ON public.vehicle_field_sources;
DROP POLICY IF EXISTS vehicle_field_sources_editor_insert ON public.vehicle_field_sources;
DROP POLICY IF EXISTS vehicle_field_sources_editor_update ON public.vehicle_field_sources;
CREATE POLICY vehicle_field_sources_editor_insert ON public.vehicle_field_sources
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_field_sources.vehicle_id
              AND (SELECT auth.uid()) IN (v.uploaded_by, v.user_id, v.owner_id))
    OR EXISTS (SELECT 1 FROM public.vehicle_user_permissions vup WHERE vup.vehicle_id = vehicle_field_sources.vehicle_id
              AND vup.user_id = (SELECT auth.uid()) AND vup.is_active = true));
CREATE POLICY vehicle_field_sources_editor_update ON public.vehicle_field_sources
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_field_sources.vehicle_id
              AND (SELECT auth.uid()) IN (v.uploaded_by, v.user_id, v.owner_id))
    OR EXISTS (SELECT 1 FROM public.vehicle_user_permissions vup WHERE vup.vehicle_id = vehicle_field_sources.vehicle_id
              AND vup.user_id = (SELECT auth.uid()) AND vup.is_active = true))
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_field_sources.vehicle_id
              AND (SELECT auth.uid()) IN (v.uploaded_by, v.user_id, v.owner_id))
    OR EXISTS (SELECT 1 FROM public.vehicle_user_permissions vup WHERE vup.vehicle_id = vehicle_field_sources.vehicle_id
              AND vup.user_id = (SELECT auth.uid()) AND vup.is_active = true));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.vehicle_field_sources FROM anon;
REVOKE DELETE, TRUNCATE ON public.vehicle_field_sources FROM authenticated;

-- After: row security is on; no INSERT, UPDATE, DELETE or ALL policy on these tables admits PUBLIC, anon or
-- authenticated with a check that any signed-in account passes; anon holds no write grant; the triggers are definers.
DO $$
DECLARE
  v_open text;
BEGIN
  WITH t(tbl) AS (VALUES ('oem_vehicle_specs'), ('reference_libraries'), ('reference_coverage'), ('paint_codes'),
    ('gm_paint_codes'), ('vehicle_production_data'), ('vehicle_sale_settings'), ('acquisition_pipeline'),
    ('contact_inbox'), ('deck_slides'), ('vehicle_field_sources')
  ), api(role_oid) AS (VALUES (0::oid), ('anon'::regrole::oid), ('authenticated'::regrole::oid)
  ), open_expr(e) AS (VALUES ('true'), ('(( SELECT auth.uid() AS uid) IS NOT NULL)'), ('(auth.uid() IS NOT NULL)'),
    ('(auth.role() = ''authenticated''::text)'))
  SELECT string_agg(problem, '; ') INTO v_open FROM (
    SELECT t.tbl || ': row security off' AS problem
    FROM t JOIN pg_class c ON c.oid = ('public.' || t.tbl)::regclass
    WHERE NOT c.relrowsecurity
    UNION ALL
    SELECT t.tbl || '.' || p.polname || ' admits any signed-in account'
    FROM t JOIN pg_policy p ON p.polrelid = ('public.' || t.tbl)::regclass
    WHERE p.polpermissive AND p.polroles && ARRAY(SELECT role_oid FROM api)
      AND ((p.polcmd IN ('w', 'd', '*') AND regexp_replace(pg_get_expr(p.polqual, p.polrelid), '\s+', ' ', 'g') IN (SELECT e FROM open_expr))
        OR (p.polcmd IN ('a', 'w', '*') AND regexp_replace(pg_get_expr(p.polwithcheck, p.polrelid), '\s+', ' ', 'g') IN (SELECT e FROM open_expr))
        OR (p.polcmd = 'a' AND p.polwithcheck IS NULL))
      AND NOT (t.tbl = 'reference_libraries' AND p.polname = 'libraries_authenticated_insert')  -- the insert batch
    UNION ALL
    SELECT t.tbl || ': anon holds ' || g.priv
    FROM t CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) g(priv)
    WHERE has_table_privilege('anon', ('public.' || t.tbl)::regclass, g.priv)
    UNION ALL
    SELECT p.oid::regprocedure::text || ' is not a definer with search_path public'
    FROM pg_proc p
    WHERE p.oid IN ('public.link_document_to_specs()'::regprocedure, 'public.trigger_update_library_stats()'::regprocedure,
                    'public.update_coverage_on_upload()'::regprocedure)
      AND NOT (p.prosecdef AND p.proconfig = ARRAY['search_path=public'])
  ) found;
  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'signed-in open updates: still open after the change: %', v_open;
  END IF;
END $$;

COMMIT;
