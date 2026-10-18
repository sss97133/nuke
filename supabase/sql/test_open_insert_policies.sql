-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_open_insert -f this-file.sql
-- Proves that after 20261014183000_close_open_insert_policies.sql anon can no longer insert into the 15 tables whose
-- insert policy checked nothing, while the service role, SECURITY DEFINER writers and each client path still write:
-- the verification trigger notifies an organization as the requester, a signed-in user files a library, a catalog
-- tool and their own work order, an owner marks their notification read; that nobody can insert a row in someone
-- else's name; that the visitor inserts on app_events and vehicle_views still work; and that the live policies it
-- replaces let anon do each of those inserts. Starts from the live policies and grants as read on 2026-10-14 and the
-- live verification trigger (helpers/notify_org_members_of_verification_live_20261014.sql). The seeds are a
-- disposable database's rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.work_orders') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'owp_table_owner') THEN CREATE ROLE owp_table_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role, owp_table_owner;
GRANT CREATE ON SCHEMA public TO owp_table_owner;

-- The nine service-only tables: the live insert policy verbatim (PUBLIC, WITH CHECK (true)), a read policy, row
-- security on, every privilege granted to the API roles, one row each. Owned like production's by a non-superuser.
CREATE TABLE public.t_service_tables (tbl text PRIMARY KEY, insert_pol text NOT NULL);
INSERT INTO public.t_service_tables VALUES
  ('ai_scan_sessions', 'Service role can create scan sessions'),
  ('api_usage_logs', 'Service role can insert usage logs'),
  ('ds_credit_transactions', 'ds_transactions_service_insert'),
  ('image_descriptions', 'image_descriptions_insert'),
  ('pii_audit_log', 'System can insert audit logs'),
  ('session_narratives', 'session_narratives_insert'),
  ('source_census', 'Service role insert source_census'),
  ('vehicle_price_fixes', 'System can insert price fixes'),
  ('search_analytics', 'Users can insert their own search analytics');
GRANT SELECT ON public.t_service_tables TO anon, authenticated, service_role, owp_table_owner;

SET ROLE owp_table_owner;
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, uploaded_by uuid);
GRANT SELECT ON public.vehicles TO anon, authenticated, service_role;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM public.t_service_tables LOOP
    EXECUTE format('CREATE TABLE public.%I (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vehicle_id uuid, note text)', r.tbl);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (true)', r.insert_pol, r.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (true)', r.tbl || '_read', r.tbl);
    EXECUTE format('GRANT ALL ON public.%I TO anon, authenticated, service_role', r.tbl);
    EXECUTE format($f$INSERT INTO public.%I (note) VALUES ('seed')$f$, r.tbl);
  END LOOP;
END $$;
-- ai_scan_sessions also carries its uploader policy (scoped, not open).
CREATE POLICY ai_sessions_owner_policy ON public.ai_scan_sessions
  USING (EXISTS (SELECT 1 FROM vehicles v WHERE v.id = ai_scan_sessions.vehicle_id AND v.uploaded_by = (SELECT auth.uid())));

-- notifications and user_notifications, their live policies verbatim.
CREATE TABLE public.t_admins (id uuid PRIMARY KEY);
GRANT SELECT ON public.t_admins TO anon, authenticated, service_role;
CREATE FUNCTION public.is_global_admin() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT EXISTS (SELECT 1 FROM public.t_admins WHERE id = auth.uid()) $$;
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "System can create notifications" ON public.notifications FOR INSERT WITH CHECK (true);
CREATE POLICY notifications_insert_self ON public.notifications FOR INSERT
  WITH CHECK (user_id = (SELECT auth.uid()) OR is_global_admin());
CREATE POLICY notifications_select_own ON public.notifications FOR SELECT
  USING (user_id = (SELECT auth.uid()) OR is_global_admin());
CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE
  USING (user_id = (SELECT auth.uid()) OR is_global_admin()) WITH CHECK (user_id = (SELECT auth.uid()) OR is_global_admin());
GRANT ALL ON public.notifications TO anon, authenticated, service_role;
CREATE TABLE public.user_notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, title text, is_read boolean NOT NULL DEFAULT false);
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "System can insert notifications" ON public.user_notifications FOR INSERT WITH CHECK (true);
CREATE POLICY un_insert_any ON public.user_notifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Users can view their own notifications" ON public.user_notifications FOR SELECT USING ((SELECT auth.uid()) = user_id);
CREATE POLICY un_select_own ON public.user_notifications FOR SELECT USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Users can update their own notifications" ON public.user_notifications FOR UPDATE USING ((SELECT auth.uid()) = user_id);
CREATE POLICY un_update_own ON public.user_notifications FOR UPDATE
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
GRANT ALL ON public.user_notifications TO anon, authenticated, service_role;
-- Stands in for create_user_notification: SECURITY DEFINER, owned by the table owner, executable by a signed-in caller.
CREATE FUNCTION public.t_create_user_notification(p_user uuid, p_title text) RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ INSERT INTO public.user_notifications (user_id, title) VALUES (p_user, p_title) $$;
GRANT EXECUTE ON FUNCTION public.t_create_user_notification(uuid, text) TO authenticated;

-- organization_vehicle_notifications, the tables the live verification trigger reads, and the verification table
-- with its live insert policy and trigger.
CREATE TABLE public.organization_vehicles (id uuid PRIMARY KEY, organization_id uuid, vehicle_id uuid, relationship_type text);
CREATE TABLE public.organization_contributors (organization_id uuid, user_id uuid, role text, status text);
GRANT SELECT ON public.organization_vehicles, public.organization_contributors TO anon, authenticated, service_role;
CREATE TABLE public.organization_vehicle_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid, organization_vehicle_id uuid, verification_id uuid, notification_type text, message text,
  priority text, assigned_to_user_id uuid, created_by_user_id uuid, status text DEFAULT 'pending'
);
ALTER TABLE public.organization_vehicle_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role can create notifications" ON public.organization_vehicle_notifications FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can view their notifications" ON public.organization_vehicle_notifications FOR SELECT
  USING (assigned_to_user_id = (SELECT auth.uid()) OR EXISTS (SELECT 1 FROM organization_contributors oc
    WHERE oc.organization_id = organization_vehicle_notifications.organization_id AND oc.user_id = (SELECT auth.uid()) AND oc.status = 'active'));
GRANT ALL ON public.organization_vehicle_notifications TO anon, authenticated, service_role;
CREATE TABLE public.vehicle_relationship_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_vehicle_id uuid, verification_type text, current_relationship_type text, proposed_relationship_type text,
  proof_type text, requested_by_user_id uuid, status text DEFAULT 'pending'
);
ALTER TABLE public.vehicle_relationship_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members can create verifications" ON public.vehicle_relationship_verifications FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM organization_vehicles ov JOIN organization_contributors oc ON oc.organization_id = ov.organization_id
    WHERE ov.id = vehicle_relationship_verifications.organization_vehicle_id AND oc.user_id = (SELECT auth.uid()) AND oc.status = 'active')
    AND requested_by_user_id = (SELECT auth.uid()));
CREATE POLICY "Org members can view verifications" ON public.vehicle_relationship_verifications FOR SELECT
  USING (EXISTS (SELECT 1 FROM organization_vehicles ov JOIN organization_contributors oc ON oc.organization_id = ov.organization_id
    WHERE ov.id = vehicle_relationship_verifications.organization_vehicle_id AND oc.user_id = (SELECT auth.uid()) AND oc.status = 'active'));
GRANT ALL ON public.vehicle_relationship_verifications TO anon, authenticated, service_role;
\ir helpers/notify_org_members_of_verification_live_20261014.sql
CREATE TRIGGER trigger_notify_verification AFTER INSERT ON public.vehicle_relationship_verifications
  FOR EACH ROW EXECUTE FUNCTION notify_org_members_of_verification();

-- reference_libraries, tool_catalog and work_orders, their live policies verbatim.
CREATE TABLE public.reference_libraries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), year integer, make text, created_by uuid);
ALTER TABLE public.reference_libraries ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_reference_libraries_insert ON public.reference_libraries FOR INSERT WITH CHECK (true);
CREATE POLICY libraries_authenticated_insert ON public.reference_libraries FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY lib_read ON public.reference_libraries FOR SELECT USING (true);
CREATE POLICY libraries_public_read ON public.reference_libraries FOR SELECT USING (true);
CREATE POLICY libraries_authenticated_update ON public.reference_libraries FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.reference_libraries TO anon, authenticated, service_role;
CREATE TABLE public.admin_users (user_id uuid, is_active boolean, admin_level text, permissions text[]);
GRANT SELECT ON public.admin_users TO anon, authenticated, service_role;
CREATE TABLE public.tool_catalog (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), part_number text, description text, is_active boolean);
ALTER TABLE public.tool_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Only admins can modify tool catalog" ON public.tool_catalog
  USING (EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = (SELECT auth.uid()) AND au.is_active = true
    AND (au.admin_level = ANY (ARRAY['admin', 'super_admin']) OR 'approve_ownership' = ANY (au.permissions))))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = (SELECT auth.uid()) AND au.is_active = true
    AND (au.admin_level = ANY (ARRAY['admin', 'super_admin']) OR 'approve_ownership' = ANY (au.permissions))));
CREATE POLICY "Anyone can insert tool catalog" ON public.tool_catalog FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can view tool catalog" ON public.tool_catalog FOR SELECT USING (true);
CREATE POLICY "Tool catalog is publicly readable" ON public.tool_catalog FOR SELECT USING (true);
CREATE POLICY tool_catalog_public_select ON public.tool_catalog FOR SELECT TO anon USING (COALESCE(is_active, true));
GRANT ALL ON public.tool_catalog TO anon, authenticated, service_role;
CREATE TABLE public.business_ownership (business_id uuid, owner_id uuid, status text);
GRANT SELECT ON public.business_ownership TO anon, authenticated, service_role;
CREATE TABLE public.work_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, customer_id uuid, vehicle_id uuid, title text, status text DEFAULT 'pending');
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org owners can manage work orders" ON public.work_orders
  USING (organization_id IN (SELECT business_ownership.business_id FROM business_ownership
    WHERE business_ownership.owner_id = (SELECT auth.uid()) AND business_ownership.status = 'active'));
CREATE POLICY "Users can create work orders" ON public.work_orders FOR INSERT WITH CHECK (true);
CREATE POLICY work_orders_select_scoped ON public.work_orders FOR SELECT
  USING (auth.uid() IS NOT NULL AND (customer_id = auth.uid() OR organization_id IN (SELECT business_ownership.business_id
    FROM business_ownership WHERE business_ownership.owner_id = auth.uid() AND business_ownership.status = 'active')));
CREATE POLICY "Customers can update their own work orders" ON public.work_orders FOR UPDATE
  USING ((SELECT auth.uid()) = customer_id AND status = ANY (ARRAY['pending', 'quoted']));
GRANT ALL ON public.work_orders TO anon, authenticated, service_role;

-- The deliberate visitor inserts.
CREATE TABLE public.app_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_name text, user_id uuid);
ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_events_insert_anon ON public.app_events FOR INSERT TO anon, authenticated WITH CHECK (true);
GRANT ALL ON public.app_events TO anon, authenticated, service_role;
CREATE TABLE public.vehicle_views (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid);
ALTER TABLE public.vehicle_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY view_insert ON public.vehicle_views FOR INSERT WITH CHECK (true);
CREATE POLICY view_select ON public.vehicle_views FOR SELECT USING (true);
GRANT ALL ON public.vehicle_views TO anon, authenticated, service_role;
RESET ROLE;

-- Seeds. Users U1, U2, admin A1; shop S1 owned by owner O1; organization G1 with contributors C1 (requester) and C2,
-- its vehicle link GV1; one notification each for U1 and U2.
INSERT INTO public.admin_users VALUES ('20000000-0000-0000-0000-0000000000d1', true, 'admin', '{}');
INSERT INTO public.business_ownership VALUES ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000b1', 'active');
INSERT INTO public.organization_vehicles VALUES ('50000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', NULL, 'dealer');
INSERT INTO public.organization_contributors VALUES
 ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000c1', 'member', 'active'),
 ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000c2', 'owner', 'active');
INSERT INTO public.user_notifications (id, user_id, title) VALUES
 ('70000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a1', 'For U1'),
 ('70000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-0000000000a2', 'For U2');

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
-- Runs one statement as the current role; true when it raised insufficient_privilege (a revoked grant or a
-- refused row), false when it ran.
CREATE FUNCTION public.t_refused(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN false;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END $$;
CREATE FUNCTION public.t_rows(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_refused(text), public.t_rows(text)
  TO anon, authenticated, service_role;

-- 1. Before: anon inserts into every one of the 15 tables, in anyone's name; a signed-in account notifies anyone.
SET ROLE anon;
SET test.auth_uid = '';
BEGIN;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tbl FROM public.t_service_tables LOOP
    PERFORM public.t_assert(public.t_rows(format($f$INSERT INTO public.%I (user_id, note) VALUES ('20000000-0000-0000-0000-0000000000a1', 'planted')$f$, r.tbl)) = 1,
      format('before: anon inserts into %s', r.tbl));
  END LOOP;
END $$;
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.notifications (user_id, title) VALUES ('20000000-0000-0000-0000-0000000000a1', 'Verify your account')$q$) = 1, 'before: anon notifies U1');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.user_notifications (user_id, title) VALUES ('20000000-0000-0000-0000-0000000000a1', 'Verify your account')$q$) = 1, 'before: anon notifies U1 (user_notifications)');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.organization_vehicle_notifications (organization_id, message, created_by_user_id) VALUES ('60000000-0000-0000-0000-000000000001', 'planted', '20000000-0000-0000-0000-0000000000c2')$q$) = 1, 'before: anon notifies an organization');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.reference_libraries (year, make) VALUES (1979, 'Planted')$q$) = 1, 'before: anon files a library');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.tool_catalog (part_number) VALUES ('PLANTED-1')$q$) = 1, 'before: anon adds a catalog tool');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.work_orders (organization_id, customer_id, title) VALUES ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a1', 'Planted')$q$) = 1, 'before: anon files a work order in U1''s name');
ROLLBACK;
RESET ROLE;
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000a2';
BEGIN;
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.user_notifications (user_id, title) VALUES ('20000000-0000-0000-0000-0000000000a1', 'From U2')$q$) = 1, 'before: a signed-in account notifies another user');
ROLLBACK;
RESET ROLE;

-- 2. Apply the migration as the table owner, twice (the second run is a no-op).
SET ROLE owp_table_owner;
\ir ../migrations/20261014183000_close_open_insert_policies.sql
\ir ../migrations/20261014183000_close_open_insert_policies.sql
RESET ROLE;

-- 3. anon inserts nowhere but the two visitor tables, and cannot rewrite or delete there.
SET ROLE anon;
SET test.auth_uid = '';
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tbl FROM public.t_service_tables UNION ALL VALUES ('notifications'), ('user_notifications'),
    ('organization_vehicle_notifications'), ('reference_libraries'), ('tool_catalog'), ('work_orders') LOOP
    PERFORM public.t_assert(public.t_refused(format('INSERT INTO public.%I DEFAULT VALUES', r.tbl)), format('anon insert refused on %s', r.tbl));
    PERFORM public.t_assert(public.t_refused(format('DELETE FROM public.%I', r.tbl)), format('anon delete refused on %s', r.tbl));
  END LOOP;
END $$;
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.app_events (event_name) VALUES ('page_view')$q$) = 1, 'a visitor still records an app event');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.vehicle_views (vehicle_id) VALUES ('10000000-0000-0000-0000-000000000001')$q$) = 1, 'a visitor still records a vehicle view');
SELECT public.t_assert(public.t_refused($q$UPDATE public.vehicle_views SET vehicle_id = NULL$q$), 'a visitor cannot rewrite vehicle views');
SELECT public.t_assert(public.t_refused($q$DELETE FROM public.app_events$q$), 'a visitor cannot delete app events');
SELECT public.t_assert((SELECT count(*) FROM public.tool_catalog) = 0 AND (SELECT count(*) FROM public.reference_libraries) = 0, 'anon reads still run');
RESET ROLE;

-- 4. A signed-in stranger: no write on the service-only tables; no notification in someone else's name, in either
--    table; a SECURITY DEFINER writer still notifies; the owner marks their own notification read, nobody else's.
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000a2';
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tbl FROM public.t_service_tables LOOP
    PERFORM public.t_assert(public.t_refused(format($f$INSERT INTO public.%I (note) VALUES ('planted')$f$, r.tbl)), format('signed-in insert refused on %s', r.tbl));
    PERFORM public.t_assert(public.t_refused(format($f$UPDATE public.%I SET note = 'tampered'$f$, r.tbl)), format('signed-in update refused on %s', r.tbl));
  END LOOP;
END $$;
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.notifications (user_id, title) VALUES ('20000000-0000-0000-0000-0000000000a1', 'Verify your account')$q$), 'U2 cannot notify U1');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.notifications (user_id, title) VALUES ('20000000-0000-0000-0000-0000000000a2', 'Note to self')$q$) = 1, 'U2 still notifies themselves');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.user_notifications (user_id, title) VALUES ('20000000-0000-0000-0000-0000000000a1', 'From U2')$q$), 'U2 cannot write user_notifications directly');
SELECT public.t_create_user_notification('20000000-0000-0000-0000-0000000000a1', 'Your listing sold');
SELECT public.t_assert(public.t_rows($q$UPDATE public.user_notifications SET is_read = true$q$) = 1, 'U2 marks only their own notification read');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000a1';
SELECT public.t_assert((SELECT count(*) FROM public.user_notifications) = 2, 'U1 reads their two notifications, one from the definer writer');
RESET ROLE;
SELECT public.t_assert((SELECT is_read FROM public.user_notifications WHERE id = '70000000-0000-0000-0000-000000000001') = false, 'U1''s notification is untouched');

-- 5. A contributor files a verification: the live trigger notifies the other active contributor, as the requester.
--    A direct insert in another creator's name is refused.
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000c1';
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.vehicle_relationship_verifications (organization_vehicle_id, verification_type, current_relationship_type, proposed_relationship_type, requested_by_user_id) VALUES ('50000000-0000-0000-0000-000000000001', 'relationship', 'dealer', 'owner', '20000000-0000-0000-0000-0000000000c1')$q$) = 1,
  'a contributor files a verification');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.organization_vehicle_notifications (organization_id, message, created_by_user_id) VALUES ('60000000-0000-0000-0000-000000000001', 'planted', '20000000-0000-0000-0000-0000000000c2')$q$),
  'a notification in another creator''s name is refused');
RESET ROLE;
SELECT public.t_assert((SELECT count(*) FROM public.organization_vehicle_notifications) = 1
  AND (SELECT assigned_to_user_id FROM public.organization_vehicle_notifications) = '20000000-0000-0000-0000-0000000000c2'
  AND (SELECT created_by_user_id FROM public.organization_vehicle_notifications) = '20000000-0000-0000-0000-0000000000c1',
  'the trigger notified C2, created by C1');

-- 6. Signed-in client inserts: a library, a catalog tool, their own work order; not a work order in someone
--    else's name or in no one's; a shop owner files one for their shop; a non-admin rewrites no catalog row.
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000a1';
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.reference_libraries (year, make, created_by) VALUES (1979, 'Chevrolet', '20000000-0000-0000-0000-0000000000a1')$q$) = 1, 'a signed-in user files a library');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.tool_catalog (part_number, description) VALUES ('FR80', 'Ratchet')$q$) = 1, 'a signed-in user adds a catalog tool');
SELECT public.t_assert(public.t_rows($q$UPDATE public.tool_catalog SET description = 'tampered'$q$) = 0, 'a non-admin rewrites no catalog row');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.work_orders (organization_id, customer_id, title) VALUES ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a1', 'Brakes')$q$) = 1, 'a customer files their own work order');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.work_orders (organization_id, customer_id, title) VALUES ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a2', 'Planted')$q$), 'not in another customer''s name');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.work_orders (organization_id, title) VALUES ('40000000-0000-0000-0000-000000000001', 'Planted')$q$), 'not in no one''s name');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000b1';
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.work_orders (organization_id, title) VALUES ('40000000-0000-0000-0000-000000000001', 'Shop job')$q$) = 1, 'the shop owner files one for their shop');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000d1';
SELECT public.t_assert(public.t_rows($q$UPDATE public.tool_catalog SET description = 'Ratchet, 3/8 drive'$q$) = 1, 'an admin still edits the catalog');
RESET ROLE;

-- 7. The service role still inserts into every service-only table.
SET ROLE service_role;
SET test.auth_uid = '';
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tbl FROM public.t_service_tables LOOP
    PERFORM public.t_assert(public.t_rows(format($f$INSERT INTO public.%I (note) VALUES ('service')$f$, r.tbl)) = 1, format('service role inserts into %s', r.tbl));
  END LOOP;
END $$;
RESET ROLE;

-- 8. Grants and policies as left.
SELECT public.t_assert(NOT has_table_privilege('anon', 'public.' || tbl, 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('authenticated', 'public.' || tbl, 'INSERT,UPDATE,DELETE,TRUNCATE')
  AND has_table_privilege('anon', 'public.' || tbl, 'SELECT'), 'no API write grant on ' || tbl)
FROM public.t_service_tables;
SELECT public.t_assert(NOT has_table_privilege('anon', 'public.' || tbl, 'INSERT,UPDATE,DELETE,TRUNCATE'), 'anon holds no write on ' || tbl)
FROM (VALUES ('notifications'), ('user_notifications'), ('organization_vehicle_notifications'), ('reference_libraries'), ('tool_catalog'), ('work_orders')) v(tbl);
SELECT public.t_assert(has_table_privilege('anon', 'public.' || tbl, 'INSERT') AND NOT has_table_privilege('anon', 'public.' || tbl, 'UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('authenticated', 'public.' || tbl, 'UPDATE,DELETE,TRUNCATE'), 'visitor table keeps INSERT only: ' || tbl)
FROM (VALUES ('app_events'), ('vehicle_views')) v(tbl);
SELECT public.t_assert(NOT has_table_privilege('authenticated', 'public.user_notifications', 'INSERT,DELETE,TRUNCATE')
  AND has_table_privilege('authenticated', 'public.user_notifications', 'UPDATE'), 'user_notifications: signed-in callers only mark read');
SELECT public.t_assert(NOT has_table_privilege('authenticated', 'public.' || tbl, 'DELETE,TRUNCATE')
  AND has_table_privilege('authenticated', 'public.' || tbl, 'INSERT'), 'signed-in insert kept, no delete or truncate: ' || tbl)
FROM (VALUES ('notifications'), ('organization_vehicle_notifications'), ('reference_libraries')) v(tbl);
SELECT public.t_assert(NOT has_table_privilege('authenticated', 'public.' || tbl, 'TRUNCATE')
  AND has_table_privilege('authenticated', 'public.' || tbl, 'INSERT,UPDATE,DELETE'), 'signed-in writes kept, no truncate: ' || tbl)
FROM (VALUES ('tool_catalog'), ('work_orders')) v(tbl);
SELECT public.t_assert((SELECT count(*) FROM pg_policy WHERE polroles = ARRAY['service_role'::regrole::oid]) = 8, 'the 8 service insert policies name the service role');
SELECT public.t_assert(NOT EXISTS (
  SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
  WHERE c.relname NOT IN ('app_events', 'vehicle_views') AND p.polpermissive AND p.polcmd IN ('a', 'w', 'd', '*')
    AND p.polroles && ARRAY[0::oid, 'anon'::regrole::oid]
    AND (pg_get_expr(p.polqual, p.polrelid) = 'true' OR pg_get_expr(p.polwithcheck, p.polrelid) = 'true')),
  'no write policy for PUBLIC or anon checks nothing, but the visitor inserts');

-- 9. Drift stops the migration, and it changes nothing: (a) a policy no longer as read; (b) an open policy added.
SET ROLE owp_table_owner;
ALTER POLICY "System can insert price fixes" ON public.vehicle_price_fixes WITH CHECK (false);
GRANT INSERT ON public.api_usage_logs TO anon;
\set ON_ERROR_STOP off
\ir ../migrations/20261014183000_close_open_insert_policies.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(has_table_privilege('anon', 'public.api_usage_logs', 'INSERT'), 'drift (a): the migration changed nothing');
ALTER POLICY "System can insert price fixes" ON public.vehicle_price_fixes WITH CHECK (true);
CREATE POLICY drifted_open_insert ON public.work_orders FOR INSERT WITH CHECK (true);
\set ON_ERROR_STOP off
\ir ../migrations/20261014183000_close_open_insert_policies.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(has_table_privilege('anon', 'public.api_usage_logs', 'INSERT'), 'drift (b): the migration rolled back');
SELECT public.t_assert(EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'drifted_open_insert'), 'drift (b): the added policy is still there');
RESET ROLE;

SELECT 'open insert policies contract: all checks passed' AS result;
