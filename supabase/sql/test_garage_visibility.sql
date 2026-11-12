-- Disposable PG17 only. Proves the DRAFT visibility migrations of the garage model (supabase/drafts/garage-model/migrations/
-- 20261112100300 .. 370, NOT in supabase/migrations): for each hole in MODEL.md section 9 it loads the LIVE policy text
-- (helpers/garage_visibility_live_20261112.sql, read from production 2026-11-12), shows the hole exists BEFORE the migration,
-- applies the migration, shows it is closed AFTER, and shows the legitimate paths still work (owner uploads, contributors with a
-- grant, active org members on work cars, the contributor-intake SECURITY DEFINER writer, the service role, public listing photos).
-- Also proves the role x relationship matrix of docs/garage-model/VISIBILITY.md for garage_vehicle_visibility().
-- Fixture: the live tables the policies and helpers touch, reduced to the columns they use; the roles and auth.uid() as
-- Supabase defines them; a storage.objects stand-in. Nothing here is copied from production data.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_%' OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.garages') IS NOT NULL THEN
    RAISE EXCEPTION 'Empty disposable PG17 database required';
  END IF;
END $$;
SET TimeZone = 'UTC';
CREATE SCHEMA auth;
CREATE SCHEMA storage;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT COALESCE(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub', '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'role', '') $$;
GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid(), auth.role() TO anon, authenticated, service_role;

-- storage stand-in (Supabase's foldername / filename as it defines them).
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text,
  owner uuid DEFAULT auth.uid(), owner_id text DEFAULT auth.uid()::text);
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS
$$ DECLARE _parts text[]; BEGIN _parts := string_to_array(name, '/'); RETURN _parts[1:array_length(_parts, 1) - 1]; END $$;
CREATE FUNCTION storage.filename(name text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS
$$ DECLARE _parts text[]; BEGIN _parts := string_to_array(name, '/'); RETURN _parts[array_length(_parts, 1)]; END $$;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT ALL ON storage.objects TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION storage.foldername(text), storage.filename(text) TO anon, authenticated, service_role;

-- Live tables, reduced to the columns the live policies and the drafts use. RLS is ON for all, as live.
CREATE TYPE public.vision_gate_status AS ENUM ('pending', 'accepted', 'rejected_personal', 'rejected_misattributed', 'review_needed');
CREATE TABLE public.organizations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_name text);
CREATE TABLE public.organization_locations(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.user_sites(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.external_identities(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.vehicles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, owner_id uuid, uploaded_by uuid,
  is_public boolean NOT NULL DEFAULT false);
CREATE TABLE public.admin_users(user_id uuid, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.business_ownership(business_id uuid, owner_id uuid, status text NOT NULL DEFAULT 'active');
CREATE TABLE public.organization_vehicles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, vehicle_id uuid,
  relationship_type text, linked_by_user_id uuid);
CREATE TABLE public.organization_contributors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, user_id uuid,
  role text, status text NOT NULL DEFAULT 'active', verification_method text DEFAULT 'self_claimed', verified_by uuid,
  verified_at timestamptz, contribution_count integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.vehicle_user_permissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid,
  granted_by uuid, role text, is_active boolean DEFAULT true, revoked_at timestamptz, expires_at timestamptz);
CREATE TABLE public.vehicle_contributor_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid,
  is_active boolean DEFAULT true);
CREATE TABLE public.vehicle_contributors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid, submitted_by uuid,
  documented_by_user_id uuid, is_sensitive boolean, is_superseded boolean, vision_gate_status public.vision_gate_status,
  caption text, image_url text, source text, exif_data jsonb);
CREATE TABLE public.work_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vehicle_id uuid,
  labor_rate_per_hour numeric);
CREATE TABLE public.technicians(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid);
CREATE TABLE public.work_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, organization_id uuid, customer_id uuid);
CREATE TABLE public.work_order_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), work_order_id uuid, technician_id uuid,
  accepted_by_user_id uuid, cosigner_user_id uuid, declined_at timestamptz, role text, status text, job_op_code text,
  offered_at timestamptz, accepted_at timestamptz, started_at timestamptz, completed_at timestamptz, payout_rate numeric(10,2),
  estimated_payout numeric(10,2));
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
-- work_order_is_accessible: the live body (read 2026-11-12), with vehicle_user_has_access stubbed false above.
CREATE OR REPLACE FUNCTION public.work_order_is_accessible(p_work_order_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM work_orders wo LEFT JOIN vehicles v ON v.id = wo.vehicle_id
    WHERE wo.id = p_work_order_id AND auth.uid() IS NOT NULL AND (
        wo.customer_id = auth.uid()
        OR wo.organization_id IN (SELECT business_ownership.business_id FROM business_ownership
          WHERE business_ownership.owner_id = auth.uid() AND business_ownership.status = 'active')
        OR (v.id IS NOT NULL AND (v.user_id = auth.uid() OR v.owner_id = auth.uid() OR v.uploaded_by = auth.uid()
            OR vehicle_user_has_access(v.id, auth.uid())))
        OR EXISTS (SELECT 1 FROM admin_users au WHERE au.user_id = auth.uid() AND au.is_active)));
$function$;
ALTER TABLE public.vehicle_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_contributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_contributor_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_assignments ENABLE ROW LEVEL SECURITY;   -- and NO policy, exactly as live
ALTER TABLE public.technicians ENABLE ROW LEVEL SECURITY;
CREATE POLICY technicians_own_read ON public.technicians FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY work_orders_stub_read ON public.work_orders FOR SELECT USING (public.work_order_is_accessible(id));
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- The live policies of the touched tables, verbatim (2026-11-12).
\ir helpers/garage_visibility_live_20261112.sql

-- Test helpers. t_run executes ONE statement as a role and a user and returns the row count (a SELECT is counted) or -1 when
-- row-level security or a grant refuses it; any other error is a test bug and is raised.
CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION public.t_run(p_role text, p_sub uuid, p_q text, p_dml boolean DEFAULT false) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v bigint; r record;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', p_role, 'sub', p_sub)::text, true);
  PERFORM set_config('role', p_role, true);
  IF p_dml THEN EXECUTE p_q; GET DIAGNOSTICS v = ROW_COUNT;
  ELSE
    v := 0;
    -- Fetch the rows (never wrap in count(*): the planner drops an unused function call from a subquery's output).
    FOR r IN EXECUTE p_q LOOP v := v + 1; END LOOP;
  END IF;
  PERFORM set_config('role', 'none', true);
  RETURN v;
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM set_config('role', 'none', true);
  RETURN -1;
END $$;
CREATE FUNCTION public.t_vis(p_vehicle uuid, p_user uuid) RETURNS text LANGUAGE plpgsql AS $$ BEGIN RETURN public.garage_vehicle_visibility(p_vehicle, p_user); END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean,text), public.t_run(text,uuid,text,boolean), public.t_vis(uuid,uuid) TO anon, authenticated, service_role;

-- Cast: a1 shop owner, a2 technician, a3 outsider, a5 manager, a6 photographer, a7 customer (member), a8 vehicle owner who is
-- not a member, a9 org technician (not a garage member), aa org manager, ab viewer, ac staff.
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-0000000000a1'),('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000a3'),('00000000-0000-0000-0000-0000000000a5'),('00000000-0000-0000-0000-0000000000a6'),
  ('00000000-0000-0000-0000-0000000000a7'),('00000000-0000-0000-0000-0000000000a8'),('00000000-0000-0000-0000-0000000000a9'),
  ('00000000-0000-0000-0000-0000000000aa'),('00000000-0000-0000-0000-0000000000ab'),('00000000-0000-0000-0000-0000000000ac');
INSERT INTO public.organizations(id, business_name) VALUES ('00000000-0000-0000-0000-0000000000c1', 'fixture shop org'),
  ('00000000-0000-0000-0000-0000000000c2', 'fixture other org');
INSERT INTO public.business_ownership VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'active');
-- Vehicles: b1 owned, b2 consignment (org-linked 'consigner'), b3 customer work (owner a7), b4 dealer inventory, b5 stale storage,
-- b6 unknown relationship (a2 assigned), b7 customer car worked on by the org (owner a8, linked service_provider, no stay),
-- b8 a8's car with no link and no stay, b9 departed, b10 public listing.
INSERT INTO public.vehicles(id, user_id, owner_id, is_public) VALUES
  ('00000000-0000-0000-0000-00000000b001','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1',false),
  ('00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1',false),
  ('00000000-0000-0000-0000-00000000b003','00000000-0000-0000-0000-0000000000a7','00000000-0000-0000-0000-0000000000a7',false),
  -- b4 is public so a permission holder can SEE its images: UPDATE needs the SELECT policies too, and no live SELECT policy
  -- lets a vehicle_user_permissions holder read a private car's images.
  ('00000000-0000-0000-0000-00000000b004','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1',true),
  ('00000000-0000-0000-0000-00000000b005','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1',false),
  ('00000000-0000-0000-0000-00000000b006',NULL,NULL,false),
  ('00000000-0000-0000-0000-00000000b007','00000000-0000-0000-0000-0000000000a8','00000000-0000-0000-0000-0000000000a8',false),
  ('00000000-0000-0000-0000-00000000b008','00000000-0000-0000-0000-0000000000a8','00000000-0000-0000-0000-0000000000a8',false),
  ('00000000-0000-0000-0000-00000000b009','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1',false),
  ('00000000-0000-0000-0000-00000000b010',NULL,NULL,true);
INSERT INTO public.organization_vehicles(organization_id, vehicle_id, relationship_type) VALUES
  ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000b002','consigner'),
  ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000b007','service_provider');
INSERT INTO public.organization_contributors(organization_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a9','technician'),
  ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000aa','manager'),
  ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000a8','owner');
-- Images. b2: a normal and a sensitive one by the owner. b7: a normal and a sensitive one by a8. b8: a technician's (a2) photo on a8's
-- car, a8's own, and one nobody authored (a scraper row). b10: a public-listing photo.
INSERT INTO public.vehicle_images(id, vehicle_id, user_id, is_sensitive, caption) VALUES
  ('00000000-0000-0000-0000-0000000f0201','00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-0000000000a1',false,'b2 normal'),
  ('00000000-0000-0000-0000-0000000f0202','00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-0000000000a1',true,'b2 sensitive'),
  ('00000000-0000-0000-0000-0000000f0701','00000000-0000-0000-0000-00000000b007','00000000-0000-0000-0000-0000000000a8',false,'b7 normal'),
  ('00000000-0000-0000-0000-0000000f0702','00000000-0000-0000-0000-00000000b007','00000000-0000-0000-0000-0000000000a8',true,'b7 sensitive'),
  ('00000000-0000-0000-0000-0000000f0801','00000000-0000-0000-0000-00000000b008','00000000-0000-0000-0000-0000000000a2',false,'b8 by tech'),
  ('00000000-0000-0000-0000-0000000f0802','00000000-0000-0000-0000-00000000b008','00000000-0000-0000-0000-0000000000a8',false,'b8 by owner'),
  ('00000000-0000-0000-0000-0000000f0803','00000000-0000-0000-0000-00000000b008',NULL,false,'b8 nobody'),
  ('00000000-0000-0000-0000-0000000f1001','00000000-0000-0000-0000-00000000b010',NULL,false,'b10 public');
INSERT INTO public.technicians(id, user_id) VALUES ('00000000-0000-0000-0000-0000000e0001','00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000e0002','00000000-0000-0000-0000-0000000000a9');
INSERT INTO public.work_orders(id, vehicle_id, organization_id, customer_id) VALUES
  ('00000000-0000-0000-0000-0000000d0001','00000000-0000-0000-0000-00000000b006','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a8');
INSERT INTO public.work_order_assignments(work_order_id, technician_id, role, status, payout_rate, estimated_payout) VALUES
  ('00000000-0000-0000-0000-0000000d0001','00000000-0000-0000-0000-0000000e0001','lead','accepted',55.00,500.00),
  ('00000000-0000-0000-0000-0000000d0001','00000000-0000-0000-0000-0000000e0002','assist','offered',40.00,200.00);
INSERT INTO public.work_sessions(id, user_id, vehicle_id, labor_rate_per_hour) VALUES
  ('00000000-0000-0000-0000-0000000a5001','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-00000000b003',80);

-- The core draft, then migration 300 (helpers). The garage and its people.
\ir ../drafts/garage-model/migrations/20261112100000_garage_core.sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1"}', false);
SELECT create_garage('Fixture shop', '00000000-0000-0000-0000-0000000000c1') AS g \gset
RESET ROLE;
INSERT INTO garage_members(garage_id, user_id, role, status, approved_by, approved_at, started_at)
SELECT :'g', u, r, 'active', '00000000-0000-0000-0000-0000000000a1', now(), now()
FROM (VALUES ('00000000-0000-0000-0000-0000000000a2'::uuid, 'technician'), ('00000000-0000-0000-0000-0000000000a5', 'manager'),
  ('00000000-0000-0000-0000-0000000000a6', 'photographer'), ('00000000-0000-0000-0000-0000000000a7', 'customer'),
  ('00000000-0000-0000-0000-0000000000ab', 'viewer'), ('00000000-0000-0000-0000-0000000000ac', 'staff')) m(u, r);
INSERT INTO garage_vehicle_stays(garage_id, vehicle_id, relationship, arrived_at, last_seen_at, departed_at, departure_basis, confidence,
  evidence_count, derivation_version) VALUES
  (:'g','00000000-0000-0000-0000-00000000b001','owned', now()-interval '30 days', now()-interval '2 days', NULL, NULL, 0.9, 3, 'fx'),
  (:'g','00000000-0000-0000-0000-00000000b002','consignment', now()-interval '30 days', now()-interval '2 days', NULL, NULL, 0.9, 3, 'fx'),
  (:'g','00000000-0000-0000-0000-00000000b003','customer_work', now()-interval '30 days', now()-interval '2 days', NULL, NULL, 0.9, 3, 'fx'),
  (:'g','00000000-0000-0000-0000-00000000b004','dealer_inventory', now()-interval '30 days', now()-interval '2 days', NULL, NULL, 0.9, 3, 'fx'),
  (:'g','00000000-0000-0000-0000-00000000b005','storage', now()-interval '800 days', now()-interval '400 days', NULL, NULL, 0.9, 3, 'fx'),
  (:'g','00000000-0000-0000-0000-00000000b006','unknown', now()-interval '30 days', now()-interval '2 days', NULL, NULL, 0.9, 3, 'fx'),
  (:'g','00000000-0000-0000-0000-00000000b009','owned', now()-interval '300 days', now()-interval '200 days', now()-interval '100 days', 'sale', 0.9, 3, 'fx');

-- Before migration 300 the core's stub fails closed: nobody sees a car through a garage.
SELECT t_assert(NOT can_see_vehicle_via_garage('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000000a1'),
  'core stub: can_see_vehicle_via_garage fails closed before migration 300');
\ir ../drafts/garage-model/migrations/20261112100300_garage_visibility_helpers.sql

-- ===== MIGRATION 300: helpers ==================================================================================================
SELECT t_assert((SELECT bool_and(p.prosecdef AND p.provolatile = 's' AND coalesce(p.proconfig::text, '') LIKE '%search_path=public, pg_temp%')
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('garage_member_rank', 'garage_vehicle_visibility', 'can_see_vehicle_via_garage')),
  'helpers are SECURITY DEFINER, STABLE, search_path pinned');
SELECT t_assert((SELECT count(*) FROM pg_indexes WHERE indexname IN ('garage_members_active_user_idx', 'garage_vehicle_stays_vehicle_idx',
  'garage_stay_assertions_current_idx', 'vehicle_user_permissions_vehicle_user_idx', 'work_orders_vehicle_idx',
  'work_order_assignments_technician_idx', 'technicians_user_idx')) = 7, 'every index the helper reads by exists');
SELECT t_assert(t_run('anon', NULL, $q$SELECT garage_vehicle_visibility('00000000-0000-0000-0000-00000000b001', NULL)$q$) = -1,
  'anon cannot execute the helpers');
SELECT t_assert(garage_member_rank(:'g', '00000000-0000-0000-0000-0000000000a1') = 100 AND garage_member_rank(:'g', '00000000-0000-0000-0000-0000000000a3') = 0
  AND garage_member_rank(:'g', NULL) = 0, 'garage_member_rank: owner 100, outsider and null 0');

-- Grants and assignments used by the matrix: a1 granted a2 'mechanic' on the dealer car b4; a2 granted ITSELF on b2 (does not count);
-- an expired grant for a2 on b5 (does not count); a1 granted a6 'photographer' on the consignment car b2; a2 is assigned (b6 work order).
INSERT INTO public.vehicle_user_permissions(vehicle_id, user_id, granted_by, role, expires_at) VALUES
  ('00000000-0000-0000-0000-00000000b004','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a1','mechanic',NULL),
  ('00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a2','contributor',NULL),
  ('00000000-0000-0000-0000-00000000b005','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a1','mechanic', now() - interval '1 day'),
  ('00000000-0000-0000-0000-00000000b002','00000000-0000-0000-0000-0000000000a6','00000000-0000-0000-0000-0000000000a1','photographer',NULL);

-- The role x relationship matrix (VISIBILITY.md section 2). Cars: b1 owned, b2 consignment, b3 customer_work (owner a7), b4 dealer_inventory,
-- b5 stale storage, b6 unknown (a2 assigned), b9 departed, b7/b8 no stay.
CREATE TEMP TABLE matrix(who text, u uuid, exp text[]) ON COMMIT PRESERVE ROWS;
-- order of the expected array: b1 b2 b3 b4 b5 b6 b7 b9
INSERT INTO matrix VALUES
  ('owner a1',        '00000000-0000-0000-0000-0000000000a1', ARRAY['full','full','full','full','full','full','none','full']),
  ('manager a5',      '00000000-0000-0000-0000-0000000000a5', ARRAY['full','full','full','full','full','full','none','full']),
  ('technician a2',   '00000000-0000-0000-0000-0000000000a2', ARRAY['full','summary','full','full','summary','full','none','summary']),
  ('staff ac',        '00000000-0000-0000-0000-0000000000ac', ARRAY['full','summary','full','summary','summary','summary','none','summary']),
  ('photographer a6', '00000000-0000-0000-0000-0000000000a6', ARRAY['none','full','none','none','none','none','none','none']),
  ('customer a7',     '00000000-0000-0000-0000-0000000000a7', ARRAY['none','none','full','none','none','none','none','none']),
  ('viewer ab',       '00000000-0000-0000-0000-0000000000ab', ARRAY['none','none','none','none','none','none','none','none']),
  ('outsider a3',     '00000000-0000-0000-0000-0000000000a3', ARRAY['none','none','none','none','none','none','none','none']),
  ('vehicle owner a8 (not a member)', '00000000-0000-0000-0000-0000000000a8', ARRAY['none','none','none','none','none','none','none','none']);
-- a2's assignment on b6: the assignment hangs on the work order whose vehicle is b6.
SELECT t_assert((SELECT bool_and(got = m.exp) FROM matrix m, LATERAL (SELECT ARRAY[
    t_vis('00000000-0000-0000-0000-00000000b001', m.u), t_vis('00000000-0000-0000-0000-00000000b002', m.u),
    t_vis('00000000-0000-0000-0000-00000000b003', m.u), t_vis('00000000-0000-0000-0000-00000000b004', m.u),
    t_vis('00000000-0000-0000-0000-00000000b005', m.u), t_vis('00000000-0000-0000-0000-00000000b006', m.u),
    t_vis('00000000-0000-0000-0000-00000000b007', m.u), t_vis('00000000-0000-0000-0000-00000000b009', m.u)] AS got) l),
  'matrix: every role x relationship cell of VISIBILITY.md section 2 (9 viewers x 8 cars)');
SELECT t_assert(can_see_vehicle_via_garage('00000000-0000-0000-0000-00000000b004', '00000000-0000-0000-0000-0000000000a2')
  AND NOT can_see_vehicle_via_garage('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-0000000000a2'),
  'technician: a grant someone else gave opens the dealer car; a self-granted row does not open the consignment car');
-- A human assertion that the car is not here closes the technician's here-only view, not the manager's.
SELECT t_assert(t_run('authenticated', '00000000-0000-0000-0000-0000000000a1',
  format($q$SELECT garage_record_assertion(%L, '00000000-0000-0000-0000-00000000b001', 'not_here', '{}')$q$, :'g')) = 1,
  'the owner records a not_here assertion for b1');
SELECT t_assert(t_vis('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000000a2') = 'summary'
  AND t_vis('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000000a5') = 'full',
  'a newer not_here assertion takes a car out of the technician view but not the manager view');

-- ===== Fixture shorthands used inside the statements the roles run ===========================================================
CREATE FUNCTION public.tu(t text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-0000000000' || t)::uuid $$;
CREATE FUNCTION public.tb(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-00000000b' || lpad(n::text, 3, '0'))::uuid $$;
CREATE FUNCTION public.ti(t text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-0000000f' || t)::uuid $$;
-- Stand-in for the SECURITY DEFINER contributor_intake_file writer: inserts as its owner with no user_id, as the live one does.
CREATE FUNCTION public.contributor_intake_file_stub(p_vehicle uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ INSERT INTO public.vehicle_images(vehicle_id, user_id, submitted_by, caption) VALUES (p_vehicle, NULL, NULL, 'intake') RETURNING id $$;
GRANT EXECUTE ON FUNCTION public.tu(text), public.tb(int), public.ti(text), public.contributor_intake_file_stub(uuid) TO anon, authenticated, service_role;
CREATE FUNCTION public.t_reset_images() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.vehicle_images WHERE caption IS NULL AND id <> public.ti('1001') OR caption = 'intake';
  DELETE FROM public.vehicle_images WHERE id IN (public.ti('0801'), public.ti('0802'), public.ti('0803'), public.ti('0401'));
  INSERT INTO public.vehicle_images(id, vehicle_id, user_id, is_sensitive, caption) VALUES
    (public.ti('0801'), public.tb(8), public.tu('a2'), false, 'b8 by tech'), (public.ti('0802'), public.tb(8), public.tu('a8'), false, 'b8 by owner'),
    (public.ti('0803'), public.tb(8), NULL, false, 'b8 nobody'), (public.ti('0401'), public.tb(4), public.tu('a1'), false, 'b4 by owner');
END $$;
INSERT INTO public.vehicle_images(id, vehicle_id, user_id, is_sensitive, caption) VALUES (ti('0401'), tb(4), tu('a1'), false, 'b4 by owner');

-- ===== BEFORE: the holes exist on the live policies ==================================================================================
SELECT t_assert(t_run('authenticated', tu('a3'), $q$INSERT INTO vehicle_images(vehicle_id, user_id) VALUES (tb(8), tu('a3'))$q$, true) = 1,
  'H1 before: an unrelated signed-in user attaches a photo to any vehicle');
SELECT t_assert(t_run('authenticated', tu('a3'), $q$INSERT INTO vehicle_images(vehicle_id, user_id) VALUES (tb(8), tu('a1'))$q$, true) = 1,
  'H1 before: ... and names someone else as the photographer (submitted_by null passes)');
SELECT t_assert(t_run('authenticated', tu('a3'), $q$INSERT INTO storage.objects(bucket_id, name) VALUES ('vehicle-images', 'vehicles/' || tb(8) || '/images/x.jpg')$q$, true) = 1,
  'storage before: any signed-in user writes an object under another vehicle''s path');
SELECT t_reset_images();
SELECT t_assert(t_run('anon', NULL, $q$SELECT 1 FROM organization_contributors$q$) = 3, 'H2 before: anon reads every organization roster (3 fixture rows)');
SELECT t_assert(t_run('authenticated', tu('a3'), $q$INSERT INTO organization_contributors(organization_id, user_id, role, status, verification_method) VALUES (tu('c1'), tu('a3'), 'contributor', 'pending', 'self_claimed')$q$, true) = 1,
  'before: a user files a pending self-claim on the live INSERT policy');
DELETE FROM public.organization_contributors WHERE user_id = '00000000-0000-0000-0000-0000000000a3';
SELECT t_assert(t_run('authenticated', tu('a9'), $q$SELECT 1 FROM vehicle_images WHERE vehicle_id = tb(2)$q$) = 2,
  'H3 before: an org technician sees the sensitive and normal images of a consignment car');
SELECT t_assert(t_run('authenticated', tu('a2'), $q$SELECT 1 FROM work_order_assignments$q$) = 0
  AND t_run('authenticated', tu('a8'), $q$SELECT 1 FROM work_order_assignments$q$) = 0,
  'H4 before: the assigned technician and the client both read 0 assignment rows (no policy)');
SELECT t_assert(t_run('authenticated', tu('a1'), $q$SELECT 1 FROM work_sessions$q$) = 0,
  'H5 before: the garage owner reads none of the technician''s sessions on a customer car in his shop');
SELECT t_assert(t_run('authenticated', tu('a8'), $q$DELETE FROM vehicle_images WHERE id = ti('0801')$q$, true) = 1,
  'owner rights before: the car owner deletes a photo a technician uploaded');
SELECT t_reset_images();
SELECT t_assert(t_run('authenticated', tu('a8'), $q$UPDATE vehicle_images SET vehicle_id = tb(2) WHERE id = ti('0801')$q$, true) = -1,
  'owner rights before (not a hole): live UPDATE policies already refuse moving a photo onto a car the mover does not own');
SELECT t_assert(t_run('authenticated', tu('a8'), $q$UPDATE vehicle_images SET caption = 'owner edit' WHERE id = ti('0801')$q$, true) = 1,
  'owner rights before: the car owner edits a photo a technician uploaded');
SELECT t_assert(t_run('authenticated', tu('a2'), $q$UPDATE vehicle_images SET vehicle_id = tb(2) WHERE id = ti('0801')$q$, true) = 1,
  'H11 before: an originator re-files their own photo onto ANY vehicle (users_can_update_own_images)');
SELECT t_reset_images();
SELECT t_assert(t_run('anon', NULL, $q$SELECT 1 FROM vehicle_images WHERE id = ti('1001')$q$) = 1, 'before: a public listing photo is public');

-- ===== MIGRATION 310: vehicle_images INSERT ==========================================================================================
\ir ../drafts/garage-model/migrations/20261112100310_fix_vehicle_images_insert.sql
SELECT t_assert((SELECT count(*) FROM pg_policies WHERE tablename = 'vehicle_images' AND cmd = 'INSERT') = 4,
  '310: four INSERT policies remain (own-vehicle x2, service role, standing)');
SELECT t_assert(t_run('authenticated', tu('a3'), $q$INSERT INTO vehicle_images(vehicle_id, user_id) VALUES (tb(8), tu('a3'))$q$, true) = -1,
  'H1 after: an unrelated user cannot attach a photo to someone else''s vehicle');
SELECT t_assert(t_run('authenticated', tu('a3'), $q$INSERT INTO vehicle_images(vehicle_id, user_id) VALUES (tb(8), tu('a1'))$q$, true) = -1,
  'H1 after: nor name another user as the photographer');
SELECT t_assert(t_run('authenticated', tu('a3'), $q$INSERT INTO vehicle_images(vehicle_id, user_id) VALUES (NULL, tu('a3'))$q$, true) = 1,
  'kept: a user adds to their own library (no vehicle) for the pipeline to file');
SELECT t_assert(t_run('authenticated', tu('a8'), $q$INSERT INTO vehicle_images(vehicle_id, user_id) VALUES (tb(8), tu('a8'))$q$, true) = 1,
  'kept: the vehicle owner uploads to their own vehicle');
SELECT t_assert(t_run('authenticated', tu('a9'), $q$INSERT INTO vehicle_images(vehicle_id, user_id) VALUES (tb(7), tu('a9'))$q$, true) = 1,
  'kept: an active org member uploads to an org-linked vehicle (iOS contributor flow)');
SELECT t_assert(t_run('authenticated', tu('a9'), $q$INSERT INTO vehicle_images(vehicle_id, user_id) VALUES (tb(8), tu('a9'))$q$, true) = -1,
  'the same org member cannot upload to a vehicle the org is not linked to');
SELECT t_assert(t_run('authenticated', tu('a2'), $q$INSERT INTO vehicle_images(vehicle_id, user_id) VALUES (tb(3), tu('a2'))$q$, true) = 1,
  'kept (new path): a garage technician uploads to a car that is here');
SELECT t_assert(t_run('authenticated', tu('a2'), $q$INSERT INTO vehicle_images(vehicle_id, user_id) VALUES (tb(4), tu('a2'))$q$, true) = 1,
  'kept: a technician with a grant uploads to the dealer-inventory car');
SELECT t_assert(t_run('authenticated', tu('ac'), $q$INSERT INTO vehicle_images(vehicle_id, user_id) VALUES (tb(2), tu('ac'))$q$, true) = -1,
  'staff (here-only rank) cannot add photos to a consignment car without a grant');
-- Residual, reported as H8 (VISIBILITY.md): vehicle_user_permissions lets a user insert a permission row for themselves, and the live
-- UPDATE policies, and so vehicle_image_steward, trust such a row. a2 self-granted 'contributor' on b2 in the fixture, so the insert
-- passes. Only garage_vehicle_visibility ignores self-grants. Closing H8 closes this.
SELECT t_assert(t_run('authenticated', tu('a2'), $q$INSERT INTO vehicle_images(vehicle_id, user_id) VALUES (tb(2), tu('a2'))$q$, true) = 1,
  'H8 residual: a self-granted permission row still gives insert standing (the draft preserves today''s steward trust)');
SELECT t_assert(t_run('authenticated', tu('a6'), $q$INSERT INTO vehicle_images(vehicle_id, user_id) VALUES (tb(2), tu('a6'))$q$, true) = 1,
  'kept: a photographer with a grant uploads to the car she was granted');
SELECT t_assert(t_run('authenticated', tu('a2'), $q$INSERT INTO vehicle_images(vehicle_id, user_id, submitted_by) VALUES (tb(3), 'aaaaaaaa-0000-0000-0000-000000000001', tu('a2'))$q$, true) = 1,
  'kept: a ghost-photographer import by a signed-in uploader (submitted_by = uploader)');
SELECT t_assert(t_run('authenticated', tu('a2'), $q$INSERT INTO vehicle_images(vehicle_id, user_id) VALUES (tb(3), 'aaaaaaaa-0000-0000-0000-000000000001')$q$, true) = -1,
  'a row naming another photographer without submitted_by is refused');
SELECT t_assert(t_run('service_role', NULL, $q$INSERT INTO vehicle_images(vehicle_id, user_id) VALUES (tb(8), NULL)$q$, true) = 1,
  'kept: the service role (capture pipeline, extractors) inserts anywhere');
SELECT t_assert(t_run('anon', NULL, $q$SELECT contributor_intake_file_stub(tb(8))$q$) = 1,
  'kept: the contributor-intake SECURITY DEFINER writer still inserts for an anonymous link holder');
SELECT t_assert(t_run('anon', NULL, $q$INSERT INTO vehicle_images(vehicle_id, user_id) VALUES (tb(8), NULL)$q$, true) = -1,
  'anon cannot insert directly');
SELECT t_assert(t_run('authenticated', tu('a3'), $q$SELECT can_attach_vehicle_image(tb(8))$q$) = 1, 'the predicate is callable by signed-in users');
SELECT t_assert(t_run('anon', NULL, $q$SELECT can_attach_vehicle_image(tb(8), NULL)$q$) = -1, 'and not by anon');
SELECT t_reset_images();

-- ===== MIGRATION 320: organization roster ============================================================================================
\ir ../drafts/garage-model/migrations/20261112100320_org_roster_select.sql
SELECT t_assert(t_run('anon', NULL, $q$SELECT 1 FROM organization_contributors$q$) = 0, 'H2 after: anon reads no roster');
SELECT t_assert(t_run('authenticated', tu('a3'), $q$SELECT 1 FROM organization_contributors$q$) = 0, 'H2 after: an outsider reads no roster');
SELECT t_assert(t_run('authenticated', tu('a9'), $q$SELECT 1 FROM organization_contributors WHERE organization_id = tu('c1')$q$) = 2
  AND t_run('authenticated', tu('a9'), $q$SELECT 1 FROM organization_contributors WHERE organization_id = tu('c2')$q$) = 0,
  'kept: a member reads their own organization''s roster and not another''s');
SELECT t_assert(t_run('authenticated', tu('a1'), $q$SELECT 1 FROM organization_contributors WHERE organization_id = tu('c1')$q$) = 2,
  'kept: the active owner of the organization reads its roster');
SELECT t_assert(t_run('authenticated', tu('a8'), $q$SELECT 1 FROM organization_contributors$q$) = 1, 'kept: a user reads their own row in another organization');
SELECT t_assert(t_run('authenticated', tu('a3'), $q$INSERT INTO organization_contributors(organization_id, user_id, role, status, verification_method) VALUES (tu('c1'), tu('a3'), 'contributor', 'pending', 'self_claimed')$q$, true) = 1,
  'kept: a user files a pending self-claim');
DELETE FROM public.organization_contributors WHERE user_id = '00000000-0000-0000-0000-0000000000a3';
SELECT t_assert(t_run('anon', NULL, $q$SELECT 1 FROM org_public_contributors(tu('c1'))$q$) = 2
  AND t_run('anon', NULL, $q$SELECT 1 FROM org_public_contributors(tu('c1')) WHERE user_id IS NOT NULL$q$) = 0,
  'public roster: anon sees 2 active contributors by role and count and no user id');
SELECT t_assert(t_run('authenticated', tu('a9'), $q$SELECT 1 FROM org_public_contributors(tu('c1')) WHERE user_id IS NOT NULL$q$) = 2,
  'public roster: a member of the organization also gets the user ids');

-- ===== MIGRATION 330: org member image scope =========================================================================================
\ir ../drafts/garage-model/migrations/20261112100330_org_member_image_scope.sql
SELECT t_assert(t_run('authenticated', tu('a9'), $q$SELECT 1 FROM vehicle_images WHERE vehicle_id = tb(2)$q$) = 0,
  'H3 after: an org technician no longer sees the consignment car''s images');
SELECT t_assert(t_run('authenticated', tu('a9'), $q$SELECT 1 FROM vehicle_images WHERE vehicle_id = tb(7)$q$) = 1
  AND t_run('authenticated', tu('a9'), $q$SELECT 1 FROM vehicle_images WHERE vehicle_id = tb(7) AND is_sensitive$q$) = 0,
  'kept: the org technician still sees the non-sensitive images of a car the org is working on, not its sensitive ones');
SELECT t_assert(t_run('authenticated', tu('aa'), $q$SELECT 1 FROM vehicle_images WHERE vehicle_id = tb(2)$q$) = 2
  AND t_run('authenticated', tu('aa'), $q$SELECT 1 FROM vehicle_images WHERE vehicle_id = tb(7)$q$) = 2,
  'kept: the org manager sees every image of every linked car');
SELECT t_assert(t_run('authenticated', tu('a3'), $q$SELECT 1 FROM vehicle_images WHERE vehicle_id IN (tb(2), tb(7))$q$) = 0, 'an outsider sees none of them');
SELECT t_assert(t_run('authenticated', tu('a8'), $q$SELECT 1 FROM vehicle_images WHERE vehicle_id = tb(7)$q$) = 2, 'kept: the car owner sees all images of their own car');
SELECT t_assert(t_run('anon', NULL, $q$SELECT 1 FROM vehicle_images WHERE id = ti('1001')$q$) = 1, 'kept: a public listing photo stays public');

-- ===== MIGRATION 340: work_order_assignments =========================================================================================
\ir ../drafts/garage-model/migrations/20261112100340_work_order_assignments_select.sql
SELECT t_assert(t_run('authenticated', tu('a2'), $q$SELECT 1 FROM work_order_assignments$q$) = 1
  AND t_run('authenticated', tu('a9'), $q$SELECT 1 FROM work_order_assignments$q$) = 1,
  'H4 after: each assigned technician reads their own assignment and only that');
SELECT t_assert(t_run('authenticated', tu('a1'), $q$SELECT 1 FROM work_order_assignments$q$) = 2,
  'H4 after: the active owner of the organization reads both assignments (payout terms are his)');
SELECT t_assert(t_run('authenticated', tu('a8'), $q$SELECT 1 FROM work_order_assignments$q$) = 0
  AND t_run('authenticated', tu('a5'), $q$SELECT 1 FROM work_order_assignments$q$) = 0
  AND t_run('authenticated', tu('a3'), $q$SELECT 1 FROM work_order_assignments$q$) = 0,
  'the client, a garage manager and an outsider do not read the payout-bearing table');
SELECT t_assert(t_run('authenticated', tu('a8'), $q$SELECT 1 FROM work_order_assignment_parties$q$) = 2
  AND t_run('authenticated', tu('a3'), $q$SELECT 1 FROM work_order_assignment_parties$q$) = 0,
  'the client (customer of the order) reads who is assigned through the money-free view; an outsider reads none');
SELECT t_assert((SELECT count(*) FROM information_schema.columns WHERE table_name = 'work_order_assignment_parties'
  AND (column_name LIKE '%payout%' OR column_name LIKE '%hash%' OR column_name = 'notes')) = 0, 'the view carries no payout, hash or notes column');
SELECT t_assert(t_run('anon', NULL, $q$SELECT 1 FROM work_order_assignment_parties$q$) = -1, 'anon cannot read the view');
SELECT t_assert(work_assignment_money_reader('00000000-0000-0000-0000-0000000d0001', tu('a1')) AND NOT work_assignment_money_reader('00000000-0000-0000-0000-0000000d0001', tu('a5')),
  'money reader: the owner yes, the garage manager no');
SELECT t_assert(t_run('authenticated', tu('a2'), $q$INSERT INTO work_order_assignments(work_order_id, technician_id) VALUES (gen_random_uuid(), tu('a2'))$q$, true) = -1
  AND t_run('authenticated', tu('a2'), $q$UPDATE work_order_assignments SET payout_rate = 999$q$, true) = 0,
  'writes stay closed: no client INSERT or UPDATE policy was added');

-- ===== MIGRATION 350: work_sessions ==================================================================================================
\ir ../drafts/garage-model/migrations/20261112100350_work_sessions_garage_read.sql
SELECT t_assert(t_run('authenticated', tu('a1'), $q$SELECT 1 FROM work_sessions$q$) = 1,
  'H5 after: the garage owner reads the technician''s session on a car that is in his garage');
SELECT t_assert(t_run('authenticated', tu('a5'), $q$SELECT 1 FROM work_sessions$q$) = 0
  AND t_run('authenticated', tu('a3'), $q$SELECT 1 FROM work_sessions$q$) = 0
  AND t_run('authenticated', tu('a6'), $q$SELECT 1 FROM work_sessions$q$) = 0,
  'a manager (money columns), an outsider and a photographer do not');
SELECT t_assert(t_run('authenticated', tu('a2'), $q$SELECT 1 FROM work_sessions$q$) = 1
  AND t_run('authenticated', tu('a7'), $q$SELECT 1 FROM work_sessions$q$) = 1,
  'kept: the technician reads their own session and the car''s owner reads sessions on their car');

-- ===== MIGRATION 360: originator rights ==============================================================================================
\ir ../drafts/garage-model/migrations/20261112100360_vehicle_images_originator_rights.sql
SELECT t_assert((SELECT count(*) FROM pg_policies WHERE tablename = 'vehicle_images' AND cmd IN ('UPDATE', 'DELETE')) = 4, '360: eleven UPDATE/DELETE policies became four');
SELECT t_assert(t_run('authenticated', tu('a8'), $q$DELETE FROM vehicle_images WHERE id = ti('0801')$q$, true) = 0,
  'H4 after: the car owner cannot delete a photo a technician uploaded');
SELECT t_assert(t_run('authenticated', tu('a8'), $q$UPDATE vehicle_images SET vehicle_id = tb(2) WHERE id = ti('0801')$q$, true) = -1,
  'H4 after: nor move it onto a car he does not steward');
SELECT t_assert(t_run('authenticated', tu('a8'), $q$UPDATE vehicle_images SET caption = 'seen' WHERE id = ti('0801')$q$, true) = 1,
  'kept: the car owner can still update (file, supersede, flag) the car''s media');
SELECT t_assert(t_run('authenticated', tu('a8'), $q$DELETE FROM vehicle_images WHERE id = ti('0802')$q$, true) = 1,
  'kept: the owner deletes their own photo');
SELECT t_assert(t_run('authenticated', tu('a8'), $q$DELETE FROM vehicle_images WHERE id = ti('0803')$q$, true) = 1,
  'kept: the owner deletes a row nobody authored (scraper or listing row)');
SELECT t_assert(t_run('authenticated', tu('a2'), $q$DELETE FROM vehicle_images WHERE id = ti('0801')$q$, true) = 1,
  'kept: the technician deletes their own photo on someone else''s car');
SELECT t_reset_images();
SELECT t_assert(t_run('authenticated', tu('a2'), $q$UPDATE vehicle_images SET caption = 'granted' WHERE id = ti('0401')$q$, true) = 1
  AND t_run('authenticated', tu('a2'), $q$DELETE FROM vehicle_images WHERE id = ti('0401')$q$, true) = 0,
  'a granted contributor updates the car''s media but cannot delete the owner''s photo');
SELECT t_assert(t_run('authenticated', tu('a3'), $q$UPDATE vehicle_images SET caption = 'x' WHERE id = ti('0801')$q$, true) = 0
  AND t_run('authenticated', tu('a3'), $q$DELETE FROM vehicle_images WHERE id = ti('0801')$q$, true) = 0,
  'an outsider updates and deletes nothing');
-- Reported, not closed (VISIBILITY.md H11): an originator may still re-file their OWN photo onto another car.
SELECT t_assert(t_run('authenticated', tu('a2'), $q$UPDATE vehicle_images SET vehicle_id = tb(2) WHERE id = ti('0801')$q$, true) = 1,
  'H11 still open (documented): an originator can move their own photo to any vehicle');
SELECT t_reset_images();
SELECT t_assert(t_run('anon', NULL, $q$SELECT 1 FROM vehicle_images WHERE id = ti('1001')$q$) = 1, 'kept: public listing photo still public after all vehicle_images changes');

-- ===== MIGRATION 370: storage ========================================================================================================
\ir ../drafts/garage-model/migrations/20261112100370_storage_vehicle_images_upload.sql
SELECT t_assert(t_run('authenticated', tu('a3'), $q$INSERT INTO storage.objects(bucket_id, name) VALUES ('vehicle-images', 'vehicles/' || tb(8) || '/images/x.jpg')$q$, true) = -1,
  'storage after: an unrelated user cannot write under another vehicle''s path');
SELECT t_assert(t_run('authenticated', tu('a8'), $q$INSERT INTO storage.objects(bucket_id, name) VALUES ('vehicle-images', 'vehicles/' || tb(8) || '/images/exterior/x.jpg')$q$, true) = 1
  AND t_run('authenticated', tu('a9'), $q$INSERT INTO storage.objects(bucket_id, name) VALUES ('vehicle-images', 'vehicles/' || tb(7) || '/images/x.jpg')$q$, true) = 1,
  'kept: the owner and an active org member write under their vehicle''s path');
SELECT t_assert(t_run('authenticated', tu('a3'), $q$INSERT INTO storage.objects(bucket_id, name) VALUES ('vehicle-images', 'users/' || tu('a3') || '/unorganized/x.jpg')$q$, true) = 1
  AND t_run('authenticated', tu('a3'), $q$INSERT INTO storage.objects(bucket_id, name) VALUES ('vehicle-images', 'users/' || tu('a8') || '/unorganized/x.jpg')$q$, true) = -1,
  'personal-library path: your own folder yes, someone else''s no');
SELECT t_assert(t_run('authenticated', tu('a3'), $q$INSERT INTO storage.objects(bucket_id, name) VALUES ('vehicle-images', 'temp/title-scan/' || tu('a3') || '/x.jpg')$q$, true) = 1
  AND t_run('authenticated', tu('a3'), $q$INSERT INTO storage.objects(bucket_id, name) VALUES ('vehicle-images', 'temp/title-scan/' || tu('a8') || '/x.jpg')$q$, true) = -1,
  'title-scan temp path: your own yes, someone else''s no');
SELECT t_assert(t_run('authenticated', tu('a3'), $q$INSERT INTO storage.objects(bucket_id, name) VALUES ('vehicle-images', 'receipt-123.pdf')$q$, true) = 1,
  'kept: legacy flat object names are unchanged');
SELECT t_assert(t_run('authenticated', tu('a3'), $q$INSERT INTO storage.objects(bucket_id, name) VALUES ('vehicle-images', 'vehicles/not-a-uuid/x.jpg')$q$, true) = -1,
  'a vehicles/ path whose folder is not a uuid is refused, not an error');
SELECT t_assert(t_run('service_role', NULL, $q$INSERT INTO storage.objects(bucket_id, name) VALUES ('vehicle-images', 'vehicles/' || tb(8) || '/images/svc.jpg')$q$, true) = 1,
  'kept: the service role writes anywhere');
SELECT t_assert(t_run('authenticated', tu('a3'), $q$INSERT INTO storage.objects(bucket_id, name) VALUES ('vehicle-photos', 'users/' || tu('a3') || '/x.jpg')$q$, true) = 1,
  'untouched: the vehicle-photos bucket policy still works for the writer''s own folder');
DO $$ BEGIN RAISE NOTICE 'ALL VISIBILITY CONTRACTS PASSED'; END $$;
