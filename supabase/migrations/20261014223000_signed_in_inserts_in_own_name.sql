-- INSERT policies that any signed-in account passes, on 11 tables clients insert into: each insert must now be in the
-- caller's own name, or on a row the caller may edit; business roles are granted by the business's managers.
--
-- Anyone can be authenticated on production (2026-10-14): sign-up is open with mailer_autoconfirm, and anonymous
-- sign-ins are enabled. These policies checked WITH CHECK (true) or auth.uid() IS NOT NULL, so any account could insert
-- in any name: a vehicle attributed to another user (vehicles, 1.01M rows), price history on anyone's vehicle
-- (vehicle_price_history, 412k), a link from any vehicle to any organization (organization_vehicles, 348k), a
-- reference library, image tags, organization timeline events, images and comments, catalog tools, work order edit
-- log entries, and an active owner role on any business (business_user_roles), which the invite-code, dealer
-- inventory, buyer-monitor, shop-fee and timeline policies trust. business_user_roles_update let a member rewrite
-- their own role row the same way (the self-grant 20261014160000 closed for organization_contributors).
--
-- Each client insert site (web, iOS; 2026-10-14) was read for the name it writes:
--   * vehicles: uploaded_by defaults to auth.uid(); the forms set uploaded_by, user_id or owner_id to the caller. The
--     insert must name the caller in one of the three (the columns vehicles_simple_update_policy reads).
--   * vehicle_price_history: the dealer transaction form and price tracking write the vehicle's history; the bulk and
--     CSV editors are admin pages. The insert needs the vehicle's editor (uploaded_by, user_id, owner_id or an active
--     vehicle_user_permissions row) or an active admin. 411,281 of its rows come from the definer trigger
--     log_vehicle_price_history, untouched.
--   * organization_vehicles: most sites set linked_by_user_id to the caller; linked_by_user_id now defaults to
--     auth.uid(), and the open policy is dropped, leaving "Users/owners manage links" (the linker, the vehicle's user,
--     or the organization's managers).
--   * reference_libraries: created_by defaults to auth.uid() and must be the caller.
--   * image_tags: created_by defaults to the caller's id (it is text) and the own-name policies that already exist
--     decide; the open one is dropped.
--   * business_timeline_events: every web insert sets created_by to the caller, and it must be. The trigger
--     create_org_timeline_from_vehicle_event, which copies an organization's vehicle events and names the vehicle's
--     user, becomes SECURITY DEFINER with search_path public (body unchanged).
--   * organization_images, timeline_event_comments: the own-name policies that exist decide; the open ones go.
--   * tool_catalog: no row since 2025-10-13; admins keep inserting through their policy, the open one goes.
--   * work_order_edit_log: edited_by is the caller.
--   * business_user_roles: insert and update need caller_manages_organization(business_id) (an active owner, manager
--     or board member); a member still leaves through the delete policy.
-- anon loses INSERT and TRUNCATE on these tables, authenticated TRUNCATE.
-- Contract: supabase/sql/test_signed_in_inserts_in_own_name.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Every policy this migration changes, as read on 2026-10-14 and as it leaves it, the trigger function, and the
-- defaults; anything else is drift, and nothing changes.
DO $$
DECLARE
  v_drift text;
  v_uid constant text := '(( SELECT auth.uid() AS uid) IS NOT NULL)';
BEGIN
  WITH want(tbl, pol, cmd, roles_before, qual_before, chk_before, roles_after, qual_after, chk_after) AS (VALUES
    ('vehicles', 'vehicles_authenticated_insert', 'a', 'PUBLIC', NULL, v_uid,
      'authenticated', NULL,
      '(((( SELECT auth.uid() AS uid) = uploaded_by) OR (( SELECT auth.uid() AS uid) = user_id)) OR (( SELECT auth.uid() AS uid) = owner_id))'),
    ('vehicle_price_history', 'Authenticated users can log prices', 'a', 'PUBLIC', NULL, v_uid, 'authenticated', NULL, NULL),
    ('organization_vehicles', 'service_role_or_authenticated_org_vehicles_insert', 'a', 'PUBLIC', NULL,
      '((( SELECT auth.uid() AS uid) IS NOT NULL) OR (auth.role() = ''service_role''::text))', NULL, NULL, NULL),
    ('reference_libraries', 'libraries_authenticated_insert', 'a', 'authenticated', NULL, 'true',
      'authenticated', NULL, '(created_by = ( SELECT auth.uid() AS uid))'),
    ('image_tags', 'Users can create image tags', 'a', 'PUBLIC', NULL, v_uid, NULL, NULL, NULL),
    ('business_timeline_events', 'Users can create timeline events', 'a', 'PUBLIC', NULL, v_uid,
      'authenticated', NULL, '(created_by = ( SELECT auth.uid() AS uid))'),
    ('organization_images', 'Users can upload org images', 'a', 'PUBLIC', NULL, v_uid, NULL, NULL, NULL),
    ('tool_catalog', 'Anyone can insert tool catalog', 'a', 'authenticated', NULL, 'true', NULL, NULL, NULL),
    ('business_user_roles', 'business_user_roles_insert', 'a', 'PUBLIC', NULL, v_uid,
      'authenticated', NULL, 'caller_manages_organization(business_id)'),
    ('business_user_roles', 'business_user_roles_update', 'w', 'PUBLIC', '(user_id = ( SELECT auth.uid() AS uid))', NULL,
      'authenticated', 'caller_manages_organization(business_id)', 'caller_manages_organization(business_id)'),
    ('timeline_event_comments', 'Authenticated users can create timeline comments', 'a', 'PUBLIC', NULL, v_uid, NULL, NULL, NULL),
    ('work_order_edit_log', 'Auth users can insert edit log', 'a', 'PUBLIC', NULL, '(auth.uid() IS NOT NULL)',
      'authenticated', NULL, '(edited_by = ( SELECT auth.uid() AS uid))')
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
       AND l.qual IS NOT DISTINCT FROM w.qual_after
       AND (w.chk_after IS NULL AND l.chk IS NOT NULL AND l.chk NOT IN ('true', v_uid) OR l.chk IS NOT DISTINCT FROM w.chk_after)));
  IF EXISTS (SELECT 1 FROM pg_proc p
             WHERE p.oid = 'public.create_org_timeline_from_vehicle_event()'::regprocedure
               AND (encode(sha256(convert_to(p.prosrc, 'UTF8')), 'base64') <> 'EGVubf5c/rtrktwy0j7UJCBx4S2DuXpnXUPoTvtqbpc='
                 OR NOT ((NOT p.prosecdef AND p.proconfig IS NULL) OR (p.prosecdef AND p.proconfig = ARRAY['search_path=public'])))) THEN
    v_drift := concat_ws(', ', v_drift, 'create_org_timeline_from_vehicle_event()');
  END IF;
  IF to_regprocedure('public.caller_manages_organization(uuid)') IS NULL THEN
    v_drift := concat_ws(', ', v_drift, 'caller_manages_organization(uuid) is missing');
  END IF;
  IF NULLIF(v_drift, '') IS NOT NULL THEN
    RAISE EXCEPTION 'signed-in inserts drifted from the 2026-10-14 read (%); not changing them', v_drift;
  END IF;
END $$;

-- 1. vehicles: the inserted vehicle names the caller.
ALTER POLICY vehicles_authenticated_insert ON public.vehicles TO authenticated
  WITH CHECK ((SELECT auth.uid()) IN (uploaded_by, user_id, owner_id));

-- 2. vehicle_price_history: the vehicle's editors and active admins.
ALTER POLICY "Authenticated users can log prices" ON public.vehicle_price_history TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_price_history.vehicle_id
              AND (SELECT auth.uid()) IN (v.uploaded_by, v.user_id, v.owner_id))
    OR EXISTS (SELECT 1 FROM public.vehicle_user_permissions vup WHERE vup.vehicle_id = vehicle_price_history.vehicle_id
              AND vup.user_id = (SELECT auth.uid()) AND vup.is_active = true)
    OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = (SELECT auth.uid()) AND au.is_active));

-- 3. Own-name inserts: a default names the caller where a client leaves the column out.
ALTER TABLE public.organization_vehicles ALTER COLUMN linked_by_user_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS service_role_or_authenticated_org_vehicles_insert ON public.organization_vehicles;
ALTER TABLE public.reference_libraries ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER POLICY libraries_authenticated_insert ON public.reference_libraries WITH CHECK (created_by = (SELECT auth.uid()));
ALTER TABLE public.image_tags ALTER COLUMN created_by SET DEFAULT (auth.uid())::text;
DROP POLICY IF EXISTS "Users can create image tags" ON public.image_tags;
ALTER FUNCTION public.create_org_timeline_from_vehicle_event() SECURITY DEFINER SET search_path = public;
ALTER POLICY "Users can create timeline events" ON public.business_timeline_events TO authenticated
  WITH CHECK (created_by = (SELECT auth.uid()));
DROP POLICY IF EXISTS "Users can upload org images" ON public.organization_images;
DROP POLICY IF EXISTS "Anyone can insert tool catalog" ON public.tool_catalog;
DROP POLICY IF EXISTS "Authenticated users can create timeline comments" ON public.timeline_event_comments;
ALTER POLICY "Auth users can insert edit log" ON public.work_order_edit_log TO authenticated
  WITH CHECK (edited_by = (SELECT auth.uid()));

-- 4. business_user_roles: granted by the business's managers.
ALTER POLICY business_user_roles_insert ON public.business_user_roles TO authenticated
  WITH CHECK (public.caller_manages_organization(business_id));
ALTER POLICY business_user_roles_update ON public.business_user_roles TO authenticated
  USING (public.caller_manages_organization(business_id))
  WITH CHECK (public.caller_manages_organization(business_id));

REVOKE INSERT, TRUNCATE ON
  public.vehicles, public.vehicle_price_history, public.organization_vehicles, public.reference_libraries,
  public.image_tags, public.business_timeline_events, public.organization_images, public.tool_catalog,
  public.business_user_roles, public.timeline_event_comments, public.work_order_edit_log
  FROM anon;
REVOKE TRUNCATE ON
  public.vehicles, public.vehicle_price_history, public.organization_vehicles, public.reference_libraries,
  public.image_tags, public.business_timeline_events, public.organization_images, public.tool_catalog,
  public.business_user_roles, public.timeline_event_comments, public.work_order_edit_log
  FROM authenticated;

-- After: row security is on; no INSERT or ALL policy on these tables admits PUBLIC, anon or authenticated with a check
-- any signed-in account passes; anon holds no INSERT or TRUNCATE; the trigger is a definer.
DO $$
DECLARE
  v_open text;
BEGIN
  WITH t(tbl) AS (VALUES ('vehicles'), ('vehicle_price_history'), ('organization_vehicles'), ('reference_libraries'),
    ('image_tags'), ('business_timeline_events'), ('organization_images'), ('tool_catalog'), ('business_user_roles'),
    ('timeline_event_comments'), ('work_order_edit_log'))
  SELECT string_agg(problem, '; ') INTO v_open FROM (
    SELECT t.tbl || ': row security off' AS problem
    FROM t JOIN pg_class c ON c.oid = ('public.' || t.tbl)::regclass
    WHERE NOT c.relrowsecurity
    UNION ALL
    SELECT t.tbl || '.' || p.polname || ' admits any signed-in insert'
    FROM t JOIN pg_policy p ON p.polrelid = ('public.' || t.tbl)::regclass
    WHERE p.polpermissive AND p.polcmd IN ('a', '*')
      AND p.polroles && ARRAY[0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid]
      AND ((p.polcmd = 'a' AND p.polwithcheck IS NULL)
        OR regexp_replace(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), pg_get_expr(p.polqual, p.polrelid)), '\s+', ' ', 'g') IN
           ('true', '(( SELECT auth.uid() AS uid) IS NOT NULL)', '(auth.uid() IS NOT NULL)', '(auth.role() = ''authenticated''::text)',
            '((( SELECT auth.uid() AS uid) IS NOT NULL) OR (auth.role() = ''service_role''::text))'))
    UNION ALL
    SELECT t.tbl || ': anon holds ' || g.priv
    FROM t CROSS JOIN (VALUES ('INSERT'), ('TRUNCATE')) g(priv)
    WHERE has_table_privilege('anon', ('public.' || t.tbl)::regclass, g.priv)
    UNION ALL
    SELECT 'create_org_timeline_from_vehicle_event() is not a definer with search_path public'
    FROM pg_proc p WHERE p.oid = 'public.create_org_timeline_from_vehicle_event()'::regprocedure
      AND NOT (p.prosecdef AND p.proconfig = ARRAY['search_path=public'])
  ) found;
  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION 'signed-in inserts: still open after the change: %', v_open;
  END IF;
END $$;

COMMIT;
