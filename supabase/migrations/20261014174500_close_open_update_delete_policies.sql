-- Open UPDATE and DELETE policies on 29 tables that hold rows: the service-only policies go TO service_role, the
-- rest are dropped or scoped, and anon and authenticated lose the write grants no client uses.
--
-- Read on production 2026-10-14, plan-only EXPLAIN as anon and as authenticated: on 28 of these tables an UPDATE
-- planned as a bare Seq Scan with no row filter (every row), and on 26 so did a DELETE. INSERT, UPDATE, DELETE and
-- TRUNCATE were granted to both roles on all 29. On most of them the cause is one policy written for the service
-- role ("Service role manages ...", allow_all, ..._service) with no TO clause, so it applies to PUBLIC with
-- USING (true). The service role bypasses row security and never needed it. Rows: vehicle_status_metadata about
-- 1.11M, user_presence 26,467, extraction_runs 1,945, publications 1,080, document_ocr_queue 916,
-- vehicle_validation_issues 221, backfill_queue 165, canonical_makes 152, 21 smaller tables.
--
-- Writers, from the web app, the iOS app, edge functions, scripts and SQL functions (2026-10-14), and seven days of
-- API logs (REST writes to these tables with a non-secret key: user_presence inserts only):
--   * 26 service-only tables: edge functions and scripts with the secret key, and SECURITY DEFINER functions. The
--     policy goes TO service_role; anon and authenticated lose INSERT, UPDATE, DELETE and TRUNCATE. On
--     extraction_runs, document_ocr_queue, ds_cost_tracking and photo_inbox that policy was also the only read path,
--     so anon and signed-in callers stop reading them (document_ocr_queue holds deal-document OCR). publications is
--     written by scripts with the secret key; its open insert and update policies are dropped.
--   * user_presence: the vehicle page's heartbeat upserts on (vehicle_id, user_id). A visitor's row has user_id null,
--     which never conflicts, so a visitor only inserts; a signed-in viewer updates their own row through
--     user_presence_update_self. Dropped: the ALL policy for anon and authenticated with USING (true), and the update
--     and delete policies that matched every visitor's row (OR user_id IS NULL). DELETE and TRUNCATE are revoked.
--     The insert and read policies stay: the visitor insert is a deliberate path.
--   * deck_slides: the deck editor saves as a signed-in user and sets updated_by. The update policy that let anyone
--     rewrite any slide becomes deck_slides_update_signed_in: signed in, and the new row's updated_by is the caller.
--   * vehicle_ownerships: the uploader's update policy checked nothing on the new row (WITH CHECK true), so an
--     uploader could move an ownership row onto someone else's vehicle. The new row must now pass the same rule.
-- Left as they are: vehicle_custom_circuits "Build state workflow write" (the BUILD skin's one-column write, receipt
-- 2026-06-11), and every insert-only path.
-- Contract: supabase/sql/test_open_update_delete_policies.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Every policy this migration changes, as read on 2026-10-14 and as it leaves it. Each must be in one of the two
-- states (a re-run finds the second); anything else is drift, and nothing changes.
DO $$
DECLARE
  v_drift text;
BEGIN
  WITH want(tbl, pol, cmd, roles_before, qual_before, chk_before, roles_after, qual_after, chk_after) AS (VALUES
    ('actor_capabilities', 'Service role manages actor_capabilities', '*', 'PUBLIC', 'true', 'true', 'service_role', 'true', 'true'),
    ('actors', 'Service role manages actors', '*', 'PUBLIC', 'true', 'true', 'service_role', 'true', 'true'),
    ('backfill_queue', 'Service role can manage backfill queue', '*', 'PUBLIC', 'true', 'true', 'service_role', 'true', 'true'),
    ('canonical_makes', 'Service role manages canonical makes', '*', 'PUBLIC', 'true', 'true', 'service_role', 'true', 'true'),
    ('component_events', 'Service role manages component_events', '*', 'PUBLIC', 'true', 'true', 'service_role', 'true', 'true'),
    ('coverage_targets', 'Service role manage coverage_targets', '*', 'PUBLIC', 'true', NULL, 'service_role', 'true', NULL),
    ('data_validation_rules', 'Service role manages validation rules', '*', 'PUBLIC', 'true', 'true', 'service_role', 'true', 'true'),
    ('document_ocr_queue', 'allow_all', '*', 'PUBLIC', 'true', 'true', 'service_role', 'true', 'true'),
    ('ds_cost_tracking', 'ds_cost_tracking_service', '*', 'PUBLIC', 'true', NULL, 'service_role', 'true', NULL),
    ('engine_blocks', 'Service role manages engine_blocks', '*', 'PUBLIC', 'true', 'true', 'service_role', 'true', 'true'),
    ('engine_camshafts', 'Service role manages engine_camshafts', '*', 'PUBLIC', 'true', 'true', 'service_role', 'true', 'true'),
    ('engine_carburetors', 'Service role manages engine_carburetors', '*', 'PUBLIC', 'true', 'true', 'service_role', 'true', 'true'),
    ('engine_crankshafts', 'Service role manages engine_crankshafts', '*', 'PUBLIC', 'true', 'true', 'service_role', 'true', 'true'),
    ('engine_distributors', 'Service role manages engine_distributors', '*', 'PUBLIC', 'true', 'true', 'service_role', 'true', 'true'),
    ('engine_exhaust_manifolds', 'Service role manages engine_exhaust_manifolds', '*', 'PUBLIC', 'true', 'true', 'service_role', 'true', 'true'),
    ('engine_heads', 'Service role manages engine_heads', '*', 'PUBLIC', 'true', 'true', 'service_role', 'true', 'true'),
    ('engine_intake_manifolds', 'Service role manages engine_intake_manifolds', '*', 'PUBLIC', 'true', 'true', 'service_role', 'true', 'true'),
    ('engine_oil_systems', 'Service role manages engine_oil_systems', '*', 'PUBLIC', 'true', 'true', 'service_role', 'true', 'true'),
    ('extraction_runs', 'Service role full access to extraction_runs', '*', 'PUBLIC', 'true', 'true', 'service_role', 'true', 'true'),
    ('image_vehicle_mismatches', 'Service role can manage mismatches', '*', 'PUBLIC', 'true', NULL, 'service_role', 'true', NULL),
    ('normalization_rules', 'Service role manages normalization rules', '*', 'PUBLIC', 'true', 'true', 'service_role', 'true', 'true'),
    ('photo_inbox', 'Service role full access', '*', 'PUBLIC', 'true', 'true', 'service_role', 'true', 'true'),
    ('scraper_versions', 'Service role can manage scraper versions', '*', 'PUBLIC', 'true', 'true', 'service_role', 'true', 'true'),
    ('vehicle_status_metadata', 'allow_status_metadata_all_ops', '*', 'PUBLIC', 'true', 'true', 'service_role', 'true', 'true'),
    ('vehicle_validation_issues', 'Service role manages validation issues', '*', 'PUBLIC', 'true', 'true', 'service_role', 'true', 'true'),
    ('vehicle_status_metadata', 'allow_status_metadata_insert', 'a', 'PUBLIC', NULL, 'true', NULL, NULL, NULL),
    ('publications', 'publications_insert', 'a', 'PUBLIC', NULL, 'true', NULL, NULL, NULL),
    ('publications', 'publications_update', 'w', 'PUBLIC', 'true', NULL, NULL, NULL, NULL),
    ('user_presence', 'Allow presence updates', '*', 'anon,authenticated', 'true', NULL, NULL, NULL, NULL),
    ('user_presence', 'Users can update their own presence', 'w', 'PUBLIC',
      '((user_id = ( SELECT auth.uid() AS uid)) OR (user_id IS NULL))', NULL, NULL, NULL, NULL),
    ('user_presence', 'Users can delete their own presence', 'd', 'PUBLIC',
      '((user_id = ( SELECT auth.uid() AS uid)) OR (user_id IS NULL))', NULL, NULL, NULL, NULL),
    ('deck_slides', 'deck_slides_write', 'w', 'PUBLIC', 'true', NULL, NULL, NULL, NULL),
    ('deck_slides', 'deck_slides_update_signed_in', 'w', NULL, NULL, NULL, 'authenticated',
      '(( SELECT auth.uid() AS uid) IS NOT NULL)', '(updated_by = ( SELECT auth.uid() AS uid))'),
    ('vehicle_ownerships', 'vehicle_ownerships_owner_update', 'w', 'PUBLIC',
      '(EXISTS ( SELECT 1 FROM vehicles v WHERE ((v.id = vehicle_ownerships.vehicle_id) AND (v.uploaded_by = ( SELECT auth.uid() AS uid)))))',
      'true', 'authenticated',
      '(EXISTS ( SELECT 1 FROM vehicles v WHERE ((v.id = vehicle_ownerships.vehicle_id) AND (v.uploaded_by = ( SELECT auth.uid() AS uid)))))',
      '(EXISTS ( SELECT 1 FROM vehicles v WHERE ((v.id = vehicle_ownerships.vehicle_id) AND (v.uploaded_by = ( SELECT auth.uid() AS uid)))))')
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
    (w.roles_before IS NULL AND l.pol IS NULL)
    OR (w.roles_before IS NOT NULL AND l.perm AND l.cmd = w.cmd AND l.roles = w.roles_before
        AND l.qual IS NOT DISTINCT FROM w.qual_before AND l.chk IS NOT DISTINCT FROM w.chk_before)
    OR (w.roles_after IS NULL AND l.pol IS NULL)
    OR (w.roles_after IS NOT NULL AND l.perm AND l.cmd = w.cmd AND l.roles = w.roles_after
        AND l.qual IS NOT DISTINCT FROM w.qual_after AND l.chk IS NOT DISTINCT FROM w.chk_after));
  IF v_drift IS NOT NULL THEN
    RAISE EXCEPTION 'open write policies drifted from the 2026-10-14 read (%); not changing them', v_drift;
  END IF;
END $$;

-- 1. Service-only tables: the service role's policy names the service role; no API role writes.
ALTER POLICY "Service role manages actor_capabilities" ON public.actor_capabilities TO service_role;
ALTER POLICY "Service role manages actors" ON public.actors TO service_role;
ALTER POLICY "Service role can manage backfill queue" ON public.backfill_queue TO service_role;
ALTER POLICY "Service role manages canonical makes" ON public.canonical_makes TO service_role;
ALTER POLICY "Service role manages component_events" ON public.component_events TO service_role;
ALTER POLICY "Service role manage coverage_targets" ON public.coverage_targets TO service_role;
ALTER POLICY "Service role manages validation rules" ON public.data_validation_rules TO service_role;
ALTER POLICY allow_all ON public.document_ocr_queue TO service_role;
ALTER POLICY ds_cost_tracking_service ON public.ds_cost_tracking TO service_role;
ALTER POLICY "Service role manages engine_blocks" ON public.engine_blocks TO service_role;
ALTER POLICY "Service role manages engine_camshafts" ON public.engine_camshafts TO service_role;
ALTER POLICY "Service role manages engine_carburetors" ON public.engine_carburetors TO service_role;
ALTER POLICY "Service role manages engine_crankshafts" ON public.engine_crankshafts TO service_role;
ALTER POLICY "Service role manages engine_distributors" ON public.engine_distributors TO service_role;
ALTER POLICY "Service role manages engine_exhaust_manifolds" ON public.engine_exhaust_manifolds TO service_role;
ALTER POLICY "Service role manages engine_heads" ON public.engine_heads TO service_role;
ALTER POLICY "Service role manages engine_intake_manifolds" ON public.engine_intake_manifolds TO service_role;
ALTER POLICY "Service role manages engine_oil_systems" ON public.engine_oil_systems TO service_role;
ALTER POLICY "Service role can manage mismatches" ON public.image_vehicle_mismatches TO service_role;
ALTER POLICY "Service role manages normalization rules" ON public.normalization_rules TO service_role;
ALTER POLICY "Service role full access" ON public.photo_inbox TO service_role;
ALTER POLICY "Service role can manage scraper versions" ON public.scraper_versions TO service_role;
ALTER POLICY "Service role manages validation issues" ON public.vehicle_validation_issues TO service_role;
DROP POLICY IF EXISTS publications_insert ON public.publications;
DROP POLICY IF EXISTS publications_update ON public.publications;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
  public.actor_capabilities, public.actors, public.backfill_queue, public.canonical_makes, public.component_events,
  public.coverage_targets, public.data_validation_rules, public.document_ocr_queue, public.ds_cost_tracking,
  public.engine_blocks, public.engine_camshafts, public.engine_carburetors, public.engine_crankshafts,
  public.engine_distributors, public.engine_exhaust_manifolds, public.engine_heads, public.engine_intake_manifolds,
  public.engine_oil_systems, public.image_vehicle_mismatches, public.normalization_rules, public.photo_inbox,
  public.publications, public.scraper_versions, public.vehicle_validation_issues
  FROM anon, authenticated;

-- 2. deck_slides: a signed-in editor, attributed.
DROP POLICY IF EXISTS deck_slides_write ON public.deck_slides;
DROP POLICY IF EXISTS deck_slides_update_signed_in ON public.deck_slides;
CREATE POLICY deck_slides_update_signed_in ON public.deck_slides
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL)
  WITH CHECK (updated_by = (SELECT auth.uid()));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.deck_slides FROM anon;
REVOKE DELETE, TRUNCATE ON public.deck_slides FROM authenticated;

-- 3. vehicle_ownerships: the updated row passes the uploader rule too.
ALTER POLICY vehicle_ownerships_owner_update ON public.vehicle_ownerships TO authenticated
  USING (EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_ownerships.vehicle_id AND v.uploaded_by = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_ownerships.vehicle_id AND v.uploaded_by = (SELECT auth.uid())));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.vehicle_ownerships FROM anon;
REVOKE DELETE, TRUNCATE ON public.vehicle_ownerships FROM authenticated;

-- 4. user_presence: visitors insert, signed-in viewers update their own row, nobody deletes through the API.
DROP POLICY IF EXISTS "Allow presence updates" ON public.user_presence;
DROP POLICY IF EXISTS "Users can update their own presence" ON public.user_presence;
DROP POLICY IF EXISTS "Users can delete their own presence" ON public.user_presence;
REVOKE DELETE, TRUNCATE ON public.user_presence FROM anon, authenticated;

-- 5. The two busiest tables last, so their locks are held for the shortest time.
ALTER POLICY "Service role full access to extraction_runs" ON public.extraction_runs TO service_role;
ALTER POLICY allow_status_metadata_all_ops ON public.vehicle_status_metadata TO service_role;
DROP POLICY IF EXISTS allow_status_metadata_insert ON public.vehicle_status_metadata;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.extraction_runs, public.vehicle_status_metadata FROM anon, authenticated;

-- After: row security is on, no UPDATE, DELETE or ALL policy for PUBLIC, anon or authenticated passes every row or
-- checks nothing, and on the service-only tables no API role holds a write grant or a write policy.
DO $$
DECLARE
  v_open text;
BEGIN
  WITH t(tbl, client_writes) AS (VALUES
    ('actor_capabilities', false), ('actors', false), ('backfill_queue', false), ('canonical_makes', false),
    ('component_events', false), ('coverage_targets', false), ('data_validation_rules', false),
    ('document_ocr_queue', false), ('ds_cost_tracking', false), ('engine_blocks', false), ('engine_camshafts', false),
    ('engine_carburetors', false), ('engine_crankshafts', false), ('engine_distributors', false),
    ('engine_exhaust_manifolds', false), ('engine_heads', false), ('engine_intake_manifolds', false),
    ('engine_oil_systems', false), ('extraction_runs', false), ('image_vehicle_mismatches', false),
    ('normalization_rules', false), ('photo_inbox', false), ('publications', false), ('scraper_versions', false),
    ('vehicle_status_metadata', false), ('vehicle_validation_issues', false),
    ('deck_slides', true), ('user_presence', true), ('vehicle_ownerships', true)
  ), api(role_oid) AS (VALUES (0::oid), ('anon'::regrole::oid), ('authenticated'::regrole::oid))
  SELECT string_agg(problem, '; ') INTO v_open FROM (
    SELECT t.tbl || ': row security off' AS problem
    FROM t JOIN pg_class c ON c.oid = ('public.' || t.tbl)::regclass
    WHERE NOT c.relrowsecurity
    UNION ALL
    SELECT t.tbl || '.' || p.polname || ' passes every row'
    FROM t JOIN pg_policy p ON p.polrelid = ('public.' || t.tbl)::regclass
    WHERE p.polpermissive AND p.polcmd IN ('w', 'd', '*') AND p.polroles && ARRAY(SELECT role_oid FROM api)
      AND (pg_get_expr(p.polqual, p.polrelid) = 'true' OR pg_get_expr(p.polwithcheck, p.polrelid) = 'true')
    UNION ALL
    SELECT t.tbl || '.' || p.polname || ' lets an API role write'
    FROM t JOIN pg_policy p ON p.polrelid = ('public.' || t.tbl)::regclass
    WHERE NOT t.client_writes AND p.polcmd IN ('a', 'w', 'd', '*') AND p.polroles && ARRAY(SELECT role_oid FROM api)
    UNION ALL
    SELECT t.tbl || ': ' || r.rolname || ' holds ' || g.priv
    FROM t CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
      CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) g(priv)
    WHERE NOT t.client_writes AND has_table_privilege(r.rolname, ('public.' || t.tbl)::regclass, g.priv)
  ) found;
  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'open write policies: still open after the change: %', v_open;
  END IF;
END $$;

COMMIT;
