-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_vehicle_access -f this-file.sql
-- Proves that after 20261020175000_vehicle_access_requires_provenance.sql a signed-in stranger cannot become a vehicle
-- insider (vehicle_user_has_access, and so vehicle_row_read's owner name, contact and purchase fields) by uploading one
-- photo and granting itself a role, by naming the owner as its grantor, or by linking the vehicle to an organization it
-- runs; while the owner, an owner-granted mechanic, a verified claimant, an admin and staff of the owning dealer keep
-- access. The fixture has no vehicle_completion_recompute_queue trigger, so the photo upload succeeds here as it would
-- once that table's policy is fixed. Starts from the live functions (helpers/vehicle_access_live_20261019.sql).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.auth_role', true), '') $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vehicle_access_owner') THEN CREATE ROLE vehicle_access_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, vehicle_access_owner;
GRANT CREATE ON SCHEMA public TO vehicle_access_owner;

SET ROLE vehicle_access_owner;
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, owner_id uuid, uploaded_by uuid, created_by_user_id uuid,
  is_public boolean DEFAULT true, owner_name text, owner_contact text, purchase_price numeric, purchase_date date, purchase_location text);
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, documented_by_user_id uuid, image_url text NOT NULL);
CREATE TABLE public.ownership_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, status text, title_document_url text);
CREATE TABLE public.vehicle_user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, role text DEFAULT 'contributor',
  is_active boolean DEFAULT true, granted_by uuid, granted_at timestamptz DEFAULT now());
-- As live: both checks are NOT VALID, so they hold for new rows only.
ALTER TABLE public.vehicle_user_permissions ADD CONSTRAINT chk_granted_by_not_null CHECK (granted_by IS NOT NULL) NOT VALID;
ALTER TABLE public.vehicle_user_permissions ADD CONSTRAINT chk_vup_valid_role
  CHECK (role = ANY (ARRAY['owner', 'co_owner', 'contributor', 'consigned', 'previously_owned'])) NOT VALID;
CREATE TABLE public.vehicle_contributors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, role text, status text,
  can_edit boolean, can_delete boolean, can_approve boolean, can_sell boolean);
CREATE TABLE public.organization_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, vehicle_id uuid, relationship_type text,
  status text DEFAULT 'active', linked_by_user_id uuid);
CREATE TABLE public.organization_contributors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, user_id uuid, role text, status text);
CREATE TABLE public.admin_users (user_id uuid PRIMARY KEY, is_active boolean);
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ownership_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_contributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_vehicles ENABLE ROW LEVEL SECURITY;
-- The live write policies on these tables (2026-10-19) and the reads the evidence triggers make.
CREATE POLICY vi_read ON public.vehicle_images FOR SELECT USING (true);
CREATE POLICY "Authenticated users can upload images to any vehicle" ON public.vehicle_images FOR INSERT
  WITH CHECK (((SELECT auth.uid()) IS NOT NULL) AND ((SELECT auth.uid()) = user_id) AND (vehicle_id IS NOT NULL));
CREATE POLICY ov_read_own ON public.ownership_verifications FOR SELECT USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Public read access to vehicle permissions" ON public.vehicle_user_permissions FOR SELECT USING (true);
CREATE POLICY "Vehicle owners can manage permissions" ON public.vehicle_user_permissions
  USING ((EXISTS (SELECT 1 FROM vehicles v WHERE v.id = vehicle_user_permissions.vehicle_id AND v.user_id = (SELECT auth.uid())))
    OR ((SELECT auth.uid()) = user_id));
CREATE POLICY vup_insert_own ON public.vehicle_user_permissions FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY vup_update_own ON public.vehicle_user_permissions FOR UPDATE USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY read_contributors ON public.vehicle_contributors FOR SELECT USING (true);
CREATE POLICY insert_self_contributor ON public.vehicle_contributors FOR INSERT TO authenticated
  WITH CHECK ((user_id = (SELECT auth.uid())) AND ((EXISTS (SELECT 1 FROM vehicles v WHERE v.id = vehicle_contributors.vehicle_id
    AND (((SELECT auth.uid()) = v.owner_id) OR ((SELECT auth.uid()) = v.user_id) OR ((SELECT auth.uid()) = v.uploaded_by) OR ((SELECT auth.uid()) = v.created_by_user_id))))
    OR ((status = 'pending') AND (COALESCE(can_edit, false) = false) AND (COALESCE(can_delete, false) = false) AND (COALESCE(can_approve, false) = false) AND (COALESCE(can_sell, false) = false))));
CREATE POLICY "Anyone views org-vehicle links" ON public.organization_vehicles FOR SELECT USING (true);
CREATE POLICY "Users/owners manage links" ON public.organization_vehicles
  USING ((linked_by_user_id = (SELECT auth.uid()))
    OR (EXISTS (SELECT 1 FROM vehicles v WHERE v.id = organization_vehicles.vehicle_id AND v.user_id = (SELECT auth.uid())))
    OR (EXISTS (SELECT 1 FROM organization_contributors oc WHERE oc.organization_id = organization_vehicles.organization_id
      AND oc.user_id = (SELECT auth.uid()) AND oc.role = ANY (ARRAY['owner', 'manager', 'board_member']) AND oc.status = 'active')));
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
\ir helpers/vehicle_access_live_20261019.sql
CREATE TRIGGER trg_enforce_user_vehicle_evidence BEFORE INSERT OR UPDATE ON public.vehicle_user_permissions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_user_vehicle_evidence();
CREATE TRIGGER trg_enforce_contributor_evidence BEFORE INSERT OR UPDATE ON public.vehicle_contributors
  FOR EACH ROW EXECUTE FUNCTION public.enforce_contributor_evidence();
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;
RESET ROLE;

CREATE FUNCTION public.t_is(p_got text, p_want text, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_got IS DISTINCT FROM p_want THEN RAISE EXCEPTION 'FAIL: % (got %, want %)', p_what, p_got, p_want; END IF; END $$;
-- Insider? and how many of the owner's private fields vehicle_row_read returns to the caller.
CREATE FUNCTION public.t_view(p_vehicle uuid) RETURNS text LANGUAGE sql AS $$
  SELECT format('insider=%s private=%s', public.vehicle_user_has_access(p_vehicle, auth.uid())::text,
    (SELECT count(*) FROM jsonb_each(public.vehicle_row_read(p_vehicle)) e
      WHERE e.key IN ('owner_name', 'owner_contact', 'purchase_price', 'purchase_date', 'purchase_location') AND e.value <> 'null'::jsonb)) $$;
GRANT EXECUTE ON FUNCTION public.t_is(text, text, text), public.t_view(uuid) TO anon, authenticated;
SELECT public.t_is(encode(sha256(convert_to(prosrc, 'UTF8')), 'base64'), 'wKtebkwWlkgg+H0gXZxGVZAQFlilu5O2FTZeaGazL7Y=',
  'fixture: vehicle_user_has_access as live') FROM pg_proc WHERE oid = 'public.vehicle_user_has_access(uuid,uuid)'::regprocedure;

-- Seeds. V1 belongs to owner O1 with all five private fields. Dealer D1 (staff S1, photographer P1) holds V2 on a system
-- link; V1 is linked to D1 only as a service provider. Stranger X9 runs organization G9. Admin A1. Verified claimant C1.
INSERT INTO public.vehicles (id, user_id, owner_name, owner_contact, purchase_price, purchase_date, purchase_location) VALUES
 ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a0', 'Owner', 'owner@example.invalid', 1000, '2020-01-01', 'Town'),
 ('10000000-0000-0000-0000-000000000002', NULL, 'Prior owner', 'prior@example.invalid', 2000, '2021-01-01', 'City');
INSERT INTO public.organization_contributors (organization_id, user_id, role, status) VALUES
 ('40000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000b1', 'manager', 'active'),
 ('40000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000b2', 'photographer', 'active'),
 ('40000000-0000-0000-0000-0000000000a9', '20000000-0000-0000-0000-0000000000e9', 'owner', 'active');
INSERT INTO public.organization_vehicles (organization_id, vehicle_id, relationship_type) VALUES
 ('40000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-000000000002', 'owner'),
 ('40000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-000000000001', 'service_provider');
INSERT INTO public.admin_users VALUES ('20000000-0000-0000-0000-0000000000a1', true);
INSERT INTO public.ownership_verifications (vehicle_id, user_id, status, title_document_url) VALUES
 ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000c1', 'approved', 'https://example.invalid/title');

\set v1 '''10000000-0000-0000-0000-000000000001'''
\set v2 '''10000000-0000-0000-0000-000000000002'''
\set outsider 'insider=false private=0'
\set insider 'insider=true private=5'

-- 1. Before: three self-made routes make the stranger an insider of V1.
SET ROLE authenticated;
SET test.auth_role = 'authenticated';
SET test.auth_uid = '20000000-0000-0000-0000-0000000000e9';
SELECT public.t_is(public.t_view(:v1), :'outsider', 'before: the stranger is an outsider');
BEGIN;
INSERT INTO public.vehicle_images (vehicle_id, user_id, image_url) VALUES (:v1, '20000000-0000-0000-0000-0000000000e9', 'https://example.invalid/1.jpg');
INSERT INTO public.vehicle_user_permissions (vehicle_id, user_id, role, granted_by)
  VALUES (:v1, '20000000-0000-0000-0000-0000000000e9', 'contributor', '20000000-0000-0000-0000-0000000000a0');
SELECT public.t_is(public.t_view(:v1), :'insider', 'before: one photo and a self-written contributor row naming the owner as grantor read the owner''s contact and purchase');
ROLLBACK;
BEGIN;
INSERT INTO public.organization_vehicles (organization_id, vehicle_id, relationship_type, linked_by_user_id)
  VALUES ('40000000-0000-0000-0000-0000000000a9', :v1, 'auction_platform', NULL);
SELECT public.t_is(public.t_view(:v1), :'insider', 'before: linking the vehicle to its own organization reads them too');
ROLLBACK;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000b2';
SELECT public.t_is(public.t_view(:v1), :'insider', 'before: a photographer of a service provider reads them');
RESET ROLE;

-- 2. The migration, twice.
SET test.auth_role = '';
SET test.auth_uid = '';
\ir ../migrations/20261020175000_vehicle_access_requires_provenance.sql
\ir ../migrations/20261020175000_vehicle_access_requires_provenance.sql

-- 3. After.
SET ROLE authenticated;
SET test.auth_role = 'authenticated';
SET test.auth_uid = '20000000-0000-0000-0000-0000000000e9';
BEGIN;
INSERT INTO public.vehicle_images (vehicle_id, user_id, image_url) VALUES (:v1, '20000000-0000-0000-0000-0000000000e9', 'https://example.invalid/1.jpg');
INSERT INTO public.vehicle_user_permissions (vehicle_id, user_id, role) VALUES (:v1, '20000000-0000-0000-0000-0000000000e9', 'contributor');
SELECT public.t_is(public.t_view(:v1), :'outsider', 'after: a photo and a self-granted role read nothing private');
INSERT INTO public.vehicle_user_permissions (vehicle_id, user_id, role, granted_by)
  VALUES (:v1, '20000000-0000-0000-0000-0000000000e9', 'co_owner', '20000000-0000-0000-0000-0000000000a0');
SELECT public.t_is((SELECT string_agg(DISTINCT granted_by::text, ',') FROM public.vehicle_user_permissions
  WHERE user_id = '20000000-0000-0000-0000-0000000000e9'), '20000000-0000-0000-0000-0000000000e9', 'after: a row records its writer as grantor');
SELECT public.t_is(public.t_view(:v1), :'outsider', 'after: naming the owner as grantor reads nothing private');
INSERT INTO public.vehicle_contributors (vehicle_id, user_id, role, status) VALUES (:v1, '20000000-0000-0000-0000-0000000000e9', 'photographer', 'pending');
SELECT public.t_is(public.t_view(:v1), :'outsider', 'after: a pending contributor request reads nothing private');
INSERT INTO public.organization_vehicles (organization_id, vehicle_id, relationship_type, linked_by_user_id)
  VALUES ('40000000-0000-0000-0000-0000000000a9', :v1, 'owner', NULL);
SELECT public.t_is(public.t_view(:v1), :'outsider', 'after: linking the vehicle to its own organization as owner reads nothing private');
ROLLBACK;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000b2';
SELECT public.t_is(public.t_view(:v1), :'outsider', 'after: a service provider''s photographer reads nothing private');
SELECT public.t_is(public.t_view(:v2), :'outsider', 'after: the owning dealer''s photographer reads nothing private');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000b1';
SELECT public.t_is(public.t_view(:v2), :'insider', 'after: the owning dealer''s manager reads its vehicle');
SELECT public.t_is(public.t_view(:v1), :'outsider', 'after: but not a vehicle it only serviced');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000a0';
SELECT public.t_is(public.t_view(:v1), :'insider', 'after: the owner reads their vehicle');
BEGIN;
RESET ROLE;
INSERT INTO public.vehicle_images (vehicle_id, user_id, image_url) VALUES (:v1, '20000000-0000-0000-0000-0000000000f1', 'https://example.invalid/2.jpg');
SET ROLE authenticated;
INSERT INTO public.vehicle_user_permissions (vehicle_id, user_id, role) VALUES (:v1, '20000000-0000-0000-0000-0000000000f1', 'contributor');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000f1';
SELECT public.t_is(public.t_view(:v1), :'insider', 'after: a contributor the owner granted reads the vehicle');
ROLLBACK;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000c1';
SELECT public.t_is(public.t_view(:v1), :'insider', 'after: a verified claimant reads the vehicle');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000a1';
SELECT public.t_is(public.t_view(:v1), :'insider', 'after: an active admin reads the vehicle');
RESET ROLE;
-- The service role and migrations keep the grantor they write.
SET test.auth_role = 'service_role';
INSERT INTO public.vehicle_user_permissions (vehicle_id, user_id, role, granted_by)
  VALUES (:v2, '20000000-0000-0000-0000-0000000000f2', 'previously_owned', '20000000-0000-0000-0000-0000000000a1');
SELECT public.t_is((SELECT granted_by::text FROM public.vehicle_user_permissions WHERE user_id = '20000000-0000-0000-0000-0000000000f2'),
  '20000000-0000-0000-0000-0000000000a1', 'after: a service-role write keeps its grantor');

SELECT 'vehicle access requires provenance: ok' AS result;
