-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_signed_in_own_name -f this-file.sql
-- Proves that after 20261014223000_signed_in_inserts_in_own_name.sql a signed-in stranger (any account: sign-up is
-- open and anonymous sign-in is on) can no longer insert in someone else's name on the 11 tables, or grant themselves
-- a business role, while every client path still inserts in its own name (the defaults name the caller where a client
-- leaves the column out), the vehicle's editors and admins log prices, a business's manager grants roles, the
-- organization timeline trigger (now a definer) still copies a vehicle event named for the vehicle's user, and the
-- service role inserts everywhere; and that the live policies let the stranger do each of those. Starts from the live
-- policies and grants as read on 2026-10-14 and the live functions (helpers/org_timeline_and_manager_live_20261014.sql).
-- The seeds are a disposable database's rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'owp_table_owner') THEN CREATE ROLE owp_table_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role, owp_table_owner;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role, owp_table_owner;
GRANT CREATE ON SCHEMA public TO owp_table_owner;
CREATE FUNCTION public.t_as(p_uid text) RETURNS void LANGUAGE sql AS
$$ SELECT set_config('request.jwt.claims', CASE WHEN p_uid = '' THEN '' ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END, false) $$;
GRANT EXECUTE ON FUNCTION public.t_as(text) TO anon, authenticated, service_role;

SET ROLE owp_table_owner;
CREATE TABLE public.admin_users (user_id uuid, is_active boolean);
CREATE TABLE public.vehicle_user_permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL, user_id uuid NOT NULL, is_active boolean);
CREATE TABLE public.organization_contributors (organization_id uuid, user_id uuid, role text, status text);
GRANT SELECT ON public.admin_users, public.vehicle_user_permissions, public.organization_contributors TO anon, authenticated, service_role;

-- The 11 tables with the columns their policies and clients use, and their live insert policies verbatim.
CREATE TABLE public.vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), uploaded_by uuid DEFAULT auth.uid(), user_id uuid,
  owner_id uuid, year integer, make text, model text);
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_authenticated_insert ON public.vehicles FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY vehicles_read ON public.vehicles FOR SELECT USING (true);
CREATE TABLE public.vehicle_price_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, value numeric, source text);
ALTER TABLE public.vehicle_price_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can log prices" ON public.vehicle_price_history FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY vph_read ON public.vehicle_price_history FOR SELECT USING (true);
CREATE TABLE public.organization_vehicles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, vehicle_id uuid, linked_by_user_id uuid);
ALTER TABLE public.organization_vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users/owners manage links" ON public.organization_vehicles
  USING (linked_by_user_id = (SELECT auth.uid())
    OR EXISTS (SELECT 1 FROM vehicles v WHERE v.id = organization_vehicles.vehicle_id AND v.user_id = (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM organization_contributors oc WHERE oc.organization_id = organization_vehicles.organization_id
      AND oc.user_id = (SELECT auth.uid()) AND oc.role = ANY (ARRAY['owner', 'manager', 'board_member']) AND oc.status = 'active'));
CREATE POLICY service_role_or_authenticated_org_vehicles_insert ON public.organization_vehicles FOR INSERT
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL OR auth.role() = 'service_role');
CREATE TABLE public.reference_libraries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), year integer NOT NULL, make text NOT NULL, created_by uuid);
ALTER TABLE public.reference_libraries ENABLE ROW LEVEL SECURITY;
CREATE POLICY libraries_authenticated_insert ON public.reference_libraries FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY lib_read ON public.reference_libraries FOR SELECT USING (true);
CREATE TABLE public.image_tags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), image_id uuid, tag_name text, created_by character varying);
ALTER TABLE public.image_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can create image tags" ON public.image_tags FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY image_tags_insert_authenticated ON public.image_tags FOR INSERT TO authenticated WITH CHECK ((created_by)::text = ((SELECT auth.uid()))::text);
CREATE POLICY image_tags_insert_own ON public.image_tags FOR INSERT WITH CHECK (((SELECT auth.uid()))::text = (created_by)::text);
CREATE POLICY image_tags_read ON public.image_tags FOR SELECT USING (true);
CREATE TABLE public.business_timeline_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, created_by uuid, event_type text,
  event_category text, title text, description text, event_date date, cost_amount numeric, metadata jsonb, image_urls text[], labor_hours numeric);
ALTER TABLE public.business_timeline_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can create timeline events" ON public.business_timeline_events FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY bte_read ON public.business_timeline_events FOR SELECT USING (true);
CREATE TABLE public.timeline_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, event_type text, title text,
  description text, event_date date, image_urls text[], cost_amount numeric, duration_hours numeric, labor_hours numeric, organization_id uuid);
CREATE TABLE public.organization_images (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, user_id uuid NOT NULL);
ALTER TABLE public.organization_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can upload org images" ON public.organization_images FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "Users upload org images" ON public.organization_images FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));
CREATE TABLE public.tool_catalog (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), part_number text);
ALTER TABLE public.tool_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Only admins can modify tool catalog" ON public.tool_catalog
  USING (EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = (SELECT auth.uid()) AND au.is_active = true))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = (SELECT auth.uid()) AND au.is_active = true));
CREATE POLICY "Anyone can insert tool catalog" ON public.tool_catalog FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY tool_catalog_read ON public.tool_catalog FOR SELECT USING (true);
CREATE TABLE public.business_user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, user_id uuid NOT NULL,
  role_type text, status text DEFAULT 'active');
ALTER TABLE public.business_user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_user_roles_insert ON public.business_user_roles FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY business_user_roles_update ON public.business_user_roles FOR UPDATE USING (user_id = (SELECT auth.uid()));
CREATE POLICY business_user_roles_delete ON public.business_user_roles FOR DELETE USING (user_id = (SELECT auth.uid()));
CREATE POLICY business_user_roles_select ON public.business_user_roles FOR SELECT USING (true);
CREATE TABLE public.timeline_event_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid, user_id uuid NOT NULL, body text);
ALTER TABLE public.timeline_event_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can create timeline comments" ON public.timeline_event_comments FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "Users can create timeline event comments" ON public.timeline_event_comments FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE TABLE public.work_order_edit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), row_id uuid, field_name text, edited_by uuid);
ALTER TABLE public.work_order_edit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth users can insert edit log" ON public.work_order_edit_log FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
GRANT ALL ON public.vehicles, public.vehicle_price_history, public.organization_vehicles, public.reference_libraries, public.image_tags,
  public.business_timeline_events, public.timeline_events, public.organization_images, public.tool_catalog, public.business_user_roles,
  public.timeline_event_comments, public.work_order_edit_log
  TO anon, authenticated, service_role;
-- As live: anon's writes on reference_libraries and tool_catalog were revoked by 20261014183000; authenticated holds
-- no TRUNCATE there.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.reference_libraries, public.tool_catalog FROM anon;
REVOKE TRUNCATE ON public.reference_libraries, public.tool_catalog FROM authenticated;
\ir helpers/org_timeline_and_manager_live_20261014.sql
RESET ROLE;

-- Seeds. S owns vehicle VS (uploaded and user); X is a stranger; A is an active admin; M manages organization G (an
-- active owner contributor); K holds a vehicle permission on VS.
INSERT INTO public.admin_users VALUES ('20000000-0000-0000-0000-0000000000a1', true);
INSERT INTO public.vehicles (id, uploaded_by, user_id, year, make, model) VALUES
 ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a5', '20000000-0000-0000-0000-0000000000a5', 1979, 'Chevrolet', 'K5');
-- ALLOW_RAW_TESTIMONY_WRITE: a seed row in this disposable PG17 test database, never production.
INSERT INTO public.vehicle_user_permissions (vehicle_id, user_id, is_active) VALUES
 ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000c1', true);
INSERT INTO public.organization_contributors VALUES
 ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000b1', 'owner', 'active');
INSERT INTO public.business_user_roles (id, business_id, user_id, role_type) VALUES
 ('70000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000f9', 'consultant');

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
CREATE FUNCTION public.t_refused(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN false;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END $$;
CREATE FUNCTION public.t_rows(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_refused(text), public.t_rows(text) TO anon, authenticated, service_role;
-- The inserts in someone else's name (S's, or for S's vehicle), one per table, and the stranger's self-grant.
CREATE TABLE public.t_impersonations (tbl text PRIMARY KEY, stmt text NOT NULL);
INSERT INTO public.t_impersonations VALUES
  ('vehicles', $q$INSERT INTO public.vehicles (uploaded_by, year, make) VALUES ('20000000-0000-0000-0000-0000000000a5', 1980, 'Planted')$q$),
  ('vehicle_price_history', $q$INSERT INTO public.vehicle_price_history (vehicle_id, value) VALUES ('10000000-0000-0000-0000-000000000001', 1)$q$),
  ('organization_vehicles', $q$INSERT INTO public.organization_vehicles (organization_id, vehicle_id, linked_by_user_id) VALUES ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a5')$q$),
  ('reference_libraries', $q$INSERT INTO public.reference_libraries (year, make, created_by) VALUES (1979, 'Planted', '20000000-0000-0000-0000-0000000000a5')$q$),
  ('image_tags', $q$INSERT INTO public.image_tags (tag_name, created_by) VALUES ('planted', '20000000-0000-0000-0000-0000000000a5')$q$),
  ('business_timeline_events', $q$INSERT INTO public.business_timeline_events (business_id, title, created_by) VALUES ('60000000-0000-0000-0000-000000000001', 'Planted', '20000000-0000-0000-0000-0000000000a5')$q$),
  ('organization_images', $q$INSERT INTO public.organization_images (organization_id, user_id) VALUES ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a5')$q$),
  ('tool_catalog', $q$INSERT INTO public.tool_catalog (part_number) VALUES ('PLANTED-1')$q$),
  ('business_user_roles', $q$INSERT INTO public.business_user_roles (business_id, user_id, role_type) VALUES ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000f9', 'owner')$q$),
  ('timeline_event_comments', $q$INSERT INTO public.timeline_event_comments (user_id, body) VALUES ('20000000-0000-0000-0000-0000000000a5', 'planted')$q$),
  ('work_order_edit_log', $q$INSERT INTO public.work_order_edit_log (field_name, edited_by) VALUES ('total', '20000000-0000-0000-0000-0000000000a5')$q$);
GRANT SELECT ON public.t_impersonations TO anon, authenticated, service_role;

-- 1. Before: the stranger inserts in someone else's name on all 11, and promotes their own consultant row to owner.
SET ROLE authenticated;
SELECT public.t_as('20000000-0000-0000-0000-0000000000f9');
BEGIN;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM public.t_impersonations LOOP
    PERFORM public.t_assert(public.t_rows(r.stmt) = 1, format('before: a stranger inserts on %s in another name', r.tbl));
  END LOOP;
END $$;
SELECT public.t_assert(public.t_rows($q$UPDATE public.business_user_roles SET role_type = 'owner' WHERE id = '70000000-0000-0000-0000-000000000001'$q$) = 1,
  'before: a member promotes their own role to owner');
ROLLBACK;
RESET ROLE;

-- 2. Apply the migration as the table owner, twice (the second run is a no-op).
SET ROLE owp_table_owner;
\ir ../migrations/20261014223000_signed_in_inserts_in_own_name.sql
\ir ../migrations/20261014223000_signed_in_inserts_in_own_name.sql
RESET ROLE;

-- 3. The stranger: every insert in another name refused, no self-promotion; anon inserts nowhere.
SET ROLE authenticated;
SELECT public.t_as('20000000-0000-0000-0000-0000000000f9');
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM public.t_impersonations LOOP
    PERFORM public.t_assert(public.t_refused(r.stmt), format('a stranger insert on %s in another name is refused', r.tbl));
  END LOOP;
END $$;
SELECT public.t_assert(public.t_rows($q$UPDATE public.business_user_roles SET role_type = 'owner' WHERE id = '70000000-0000-0000-0000-000000000001'$q$) = 0,
  'a member no longer promotes their own role');
RESET ROLE;
SET ROLE anon;
SELECT public.t_as('');
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM public.t_impersonations LOOP
    PERFORM public.t_assert(public.t_refused(r.stmt), format('anon insert on %s refused', r.tbl));
  END LOOP;
END $$;
RESET ROLE;

-- 4. Own-name inserts still work, including the client sites that leave the name to the default.
SET ROLE authenticated;
SELECT public.t_as('20000000-0000-0000-0000-0000000000f9');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.vehicles (id, year, make) VALUES ('10000000-0000-0000-0000-0000000000f9', 1985, 'Chevrolet')$q$) = 1,
  'a vehicle with uploaded_by left to the default');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.vehicles (user_id, uploaded_by, year, make) VALUES ('20000000-0000-0000-0000-0000000000f9', NULL, 1986, 'Ford')$q$) = 1,
  'a vehicle naming the caller as user_id');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.vehicle_price_history (vehicle_id, value) VALUES ('10000000-0000-0000-0000-0000000000f9', 9000)$q$) = 1,
  'price history on the caller''s own vehicle');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.organization_vehicles (organization_id, vehicle_id) VALUES ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000f9')$q$) = 1,
  'a link with linked_by_user_id left to the default');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.reference_libraries (year, make) VALUES (1985, 'Chevrolet')$q$) = 1,
  'a library with created_by left to the default');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.image_tags (tag_name) VALUES ('bumper')$q$) = 1, 'an image tag with created_by left to the default');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.business_timeline_events (business_id, title, created_by) VALUES ('60000000-0000-0000-0000-000000000001', 'Visited', '20000000-0000-0000-0000-0000000000f9')$q$) = 1,
  'a business timeline event in the caller''s name');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.organization_images (organization_id, user_id) VALUES ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000f9')$q$) = 1,
  'an organization image in the caller''s name');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.timeline_event_comments (user_id, body) VALUES ('20000000-0000-0000-0000-0000000000f9', 'nice')$q$) = 1,
  'a comment in the caller''s name');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.work_order_edit_log (field_name, edited_by) VALUES ('total', '20000000-0000-0000-0000-0000000000f9')$q$) = 1,
  'an edit log entry in the caller''s name');
RESET ROLE;
SELECT public.t_assert((SELECT uploaded_by FROM public.vehicles WHERE id = '10000000-0000-0000-0000-0000000000f9') = '20000000-0000-0000-0000-0000000000f9'
  AND (SELECT linked_by_user_id FROM public.organization_vehicles WHERE vehicle_id = '10000000-0000-0000-0000-0000000000f9') = '20000000-0000-0000-0000-0000000000f9'
  AND (SELECT created_by FROM public.reference_libraries WHERE make = 'Chevrolet') = '20000000-0000-0000-0000-0000000000f9'
  AND (SELECT created_by FROM public.image_tags WHERE tag_name = 'bumper') = '20000000-0000-0000-0000-0000000000f9',
  'the defaults named the caller');

-- 5. Prices on another's vehicle: its permitted contributor and an admin; the catalog: an admin; roles: the manager.
SET ROLE authenticated;
SELECT public.t_as('20000000-0000-0000-0000-0000000000c1');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.vehicle_price_history (vehicle_id, value) VALUES ('10000000-0000-0000-0000-000000000001', 30000)$q$) = 1, 'the permitted contributor logs a price');
SELECT public.t_as('20000000-0000-0000-0000-0000000000a1');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.vehicle_price_history (vehicle_id, value) VALUES ('10000000-0000-0000-0000-000000000001', 31000)$q$) = 1, 'an admin logs a price');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.tool_catalog (part_number) VALUES ('FR80')$q$) = 1, 'an admin adds a catalog tool');
SELECT public.t_as('20000000-0000-0000-0000-0000000000b1');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.business_user_roles (business_id, user_id, role_type) VALUES ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000e1', 'employee')$q$) = 1,
  'the business''s manager grants a role');
SELECT public.t_assert(public.t_rows($q$UPDATE public.business_user_roles SET role_type = 'manager' WHERE id = '70000000-0000-0000-0000-000000000001'$q$) = 1,
  'the manager changes a role');
SELECT public.t_as('20000000-0000-0000-0000-0000000000f9');
SELECT public.t_assert(public.t_rows($q$DELETE FROM public.business_user_roles WHERE id = '70000000-0000-0000-0000-000000000001'$q$) = 1, 'a member still leaves');
RESET ROLE;

-- 6. The organization timeline trigger (a definer now) still copies a vehicle event, named for the vehicle's user,
--    when someone else records it.
SET ROLE authenticated;
SELECT public.t_as('20000000-0000-0000-0000-0000000000c1');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.timeline_events (vehicle_id, event_type, title, organization_id) VALUES ('10000000-0000-0000-0000-000000000001', 'repair', 'Brake job', '60000000-0000-0000-0000-000000000001')$q$) = 1,
  'a contributor records a shop event on the vehicle');
RESET ROLE;
SELECT public.t_assert((SELECT created_by FROM public.business_timeline_events WHERE title = 'Brake job') = '20000000-0000-0000-0000-0000000000a5',
  'the trigger copied it into the business timeline, named for the vehicle''s user');

-- 7. The service role inserts everywhere; grants as left.
SET ROLE service_role;
SELECT public.t_as('');
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM public.t_impersonations LOOP
    PERFORM public.t_assert(public.t_rows(r.stmt) = 1, format('the service role inserts on %s', r.tbl));
  END LOOP;
END $$;
RESET ROLE;
SELECT public.t_assert(NOT has_table_privilege('anon', 'public.' || tbl, 'INSERT,TRUNCATE') AND NOT has_table_privilege('authenticated', 'public.' || tbl, 'TRUNCATE'),
  'no anon insert or API truncate on ' || tbl) FROM public.t_impersonations;

-- 8. Drift stops the migration, and it changes nothing: a policy that is neither the 2026-10-14 read nor this one's.
SET ROLE owp_table_owner;
ALTER POLICY "Auth users can insert edit log" ON public.work_order_edit_log WITH CHECK (true);
GRANT INSERT ON public.tool_catalog TO anon;
\set ON_ERROR_STOP off
\ir ../migrations/20261014223000_signed_in_inserts_in_own_name.sql
\set ON_ERROR_STOP on
SELECT public.t_assert(has_table_privilege('anon', 'public.tool_catalog', 'INSERT'), 'drift: the migration changed nothing');
RESET ROLE;

SELECT 'signed-in inserts in own name contract: all checks passed' AS result;
