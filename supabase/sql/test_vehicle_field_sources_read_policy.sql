-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_vehicle_field_sources_read -f this-file.sql
-- Proves 20261125132000_vehicle_field_sources_read_policy.sql: a car's field sources are readable by anon and by a
-- stranger only when the car is public and not deleted; the car's owner and a permission holder (vehicle_viewer_tied)
-- read the private and deleted car's rows; service_role reads every row; the insert and update policies still admit the
-- owner and refuse a stranger; and anon's PostgREST shapes (select=*, a vehicle_id filter, count) run without 42501.
-- The fixture mirrors production as read on 2026-11-24: the six live policies of vehicle_field_sources, its grants
-- (anon SELECT; authenticated INSERT, SELECT, UPDATE), the live SELECT policies of vehicles with column grants, and the
-- live bodies of vehicle_viewer_tied and vehicle_user_has_access (pg_get_functiondef).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_field_sources') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

-- auth.uid() and auth.role() read the request's claims, as production's do.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
CREATE FUNCTION public.t_claims(p_uid text) RETURNS void LANGUAGE sql AS
$$ SELECT set_config('request.jwt.claims', CASE WHEN p_uid = '' THEN '{"role":"anon"}'
     WHEN p_uid = 'service' THEN '{"role":"service_role"}'
     ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END, false) $$;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean DEFAULT true, deleted_at timestamptz,
  user_id uuid, owner_id uuid, uploaded_by uuid, created_by_user_id uuid);
CREATE TABLE public.vehicle_field_sources (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE CASCADE, field_name text NOT NULL, field_value text,
  source_type text, user_id uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.admin_users (user_id uuid, is_active boolean);
CREATE TABLE public.ownership_verifications (vehicle_id uuid REFERENCES public.vehicles(id), user_id uuid, status text);
CREATE TABLE public.vehicle_user_permissions (vehicle_id uuid REFERENCES public.vehicles(id), user_id uuid, is_active boolean, role text, granted_by uuid);
CREATE TABLE public.vehicle_contributors (vehicle_id uuid REFERENCES public.vehicles(id), user_id uuid, status text, role text);
CREATE TABLE public.organization_vehicles (organization_id uuid, vehicle_id uuid REFERENCES public.vehicles(id), relationship_type text, status text, linked_by_user_id uuid);
CREATE TABLE public.organization_contributors (organization_id uuid, user_id uuid, status text, role text);

-- Live bodies, 2026-11-24.
CREATE OR REPLACE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p_user_id IS NOT NULL AND p_vehicle_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.vehicles v
      WHERE v.id = p_vehicle_id AND p_user_id IN (v.user_id, v.owner_id, v.uploaded_by))
    OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = p_user_id AND au.is_active)
    OR EXISTS (SELECT 1 FROM public.ownership_verifications ov
      WHERE ov.vehicle_id = p_vehicle_id AND ov.user_id = p_user_id AND ov.status = 'approved')
    OR EXISTS (SELECT 1 FROM public.vehicle_user_permissions vup JOIN public.vehicles v ON v.id = vup.vehicle_id
      WHERE vup.vehicle_id = p_vehicle_id AND vup.user_id = p_user_id AND coalesce(vup.is_active, true)
        AND vup.role = ANY (ARRAY['owner', 'co_owner', 'mechanic', 'appraiser', 'moderator', 'contributor', 'photographer',
          'dealer_rep', 'sales_agent', 'restorer', 'consigner', 'board_member'])
        AND vup.granted_by <> vup.user_id AND vup.granted_by IN (v.user_id, v.owner_id, v.uploaded_by))
    OR EXISTS (SELECT 1 FROM public.vehicle_contributors vc
      WHERE vc.vehicle_id = p_vehicle_id AND vc.user_id = p_user_id AND coalesce(vc.status, 'active') = 'active'
        AND vc.role = ANY (ARRAY['owner', 'co_owner', 'restorer', 'moderator', 'consigner', 'mechanic', 'appraiser',
          'photographer', 'sales_agent']))
    OR EXISTS (SELECT 1 FROM public.organization_vehicles ov JOIN public.vehicles v ON v.id = ov.vehicle_id
      JOIN public.organization_contributors oc ON oc.organization_id = ov.organization_id
      WHERE ov.vehicle_id = p_vehicle_id AND ov.relationship_type IN ('owner', 'consigner') AND ov.status = 'active'
        AND (ov.linked_by_user_id IS NULL OR ov.linked_by_user_id IN (v.user_id, v.owner_id))
        AND oc.user_id = p_user_id AND oc.status = 'active'
        AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager', 'employee')))
$function$;

CREATE OR REPLACE FUNCTION public.vehicle_viewer_tied(p_vehicle_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE
           WHEN (SELECT auth.role()) = 'service_role' THEN true
           WHEN (SELECT auth.uid()) IS NULL THEN false
           ELSE coalesce((SELECT (SELECT auth.uid()) IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by)
                            FROM public.vehicles v WHERE v.id = p_vehicle_id), false)
                OR coalesce(public.vehicle_user_has_access(p_vehicle_id, (SELECT auth.uid())), false)
         END
$function$;

-- Live policies, 2026-11-24.
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_public_select ON public.vehicles FOR SELECT USING ((is_public = true) OR (auth.role() = 'service_role'::text));
CREATE POLICY vehicles_private_select ON public.vehicles FOR SELECT USING ((is_public = false) AND ((SELECT auth.uid()) IS NOT NULL)
  AND (((SELECT auth.uid()) = user_id) OR ((SELECT auth.uid()) = owner_id) OR ((SELECT auth.uid()) = uploaded_by)
    OR vehicle_user_has_access(id, (SELECT auth.uid()))));
ALTER TABLE public.vehicle_field_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access to field sources" ON public.vehicle_field_sources FOR SELECT USING (true);
CREATE POLICY vfs_select_all ON public.vehicle_field_sources FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "select readable" ON public.vehicle_field_sources FOR SELECT USING ((EXISTS (SELECT 1 FROM vehicles v
  WHERE ((v.id = vehicle_field_sources.vehicle_id) AND (v.is_public = true)))) OR (auth.role() = 'authenticated'::text));
CREATE POLICY "Vehicle contributors can add field sources" ON public.vehicle_field_sources FOR INSERT WITH CHECK ((EXISTS (SELECT 1
  FROM vehicles v WHERE ((v.id = vehicle_field_sources.vehicle_id) AND (v.user_id = (SELECT auth.uid() AS uid))))) OR (EXISTS (SELECT 1
  FROM vehicle_user_permissions vup WHERE ((vup.vehicle_id = vehicle_field_sources.vehicle_id) AND (vup.user_id = (SELECT auth.uid() AS uid))
  AND (vup.is_active = true)))));
CREATE POLICY "Vehicle contributors can update field sources" ON public.vehicle_field_sources FOR UPDATE USING ((EXISTS (SELECT 1
  FROM vehicles v WHERE ((v.id = vehicle_field_sources.vehicle_id) AND (v.user_id = (SELECT auth.uid() AS uid))))) OR (EXISTS (SELECT 1
  FROM vehicle_user_permissions vup WHERE ((vup.vehicle_id = vehicle_field_sources.vehicle_id) AND (vup.user_id = (SELECT auth.uid() AS uid))
  AND (vup.is_active = true)))));
CREATE POLICY vehicle_field_sources_editor_insert ON public.vehicle_field_sources FOR INSERT TO authenticated WITH CHECK ((EXISTS (SELECT 1
  FROM vehicles v WHERE ((v.id = vehicle_field_sources.vehicle_id) AND ((((SELECT auth.uid() AS uid) = v.uploaded_by)
  OR ((SELECT auth.uid() AS uid) = v.user_id)) OR ((SELECT auth.uid() AS uid) = v.owner_id))))) OR (EXISTS (SELECT 1
  FROM vehicle_user_permissions vup WHERE ((vup.vehicle_id = vehicle_field_sources.vehicle_id) AND (vup.user_id = (SELECT auth.uid() AS uid))
  AND (vup.is_active = true)))));
CREATE POLICY vehicle_field_sources_editor_update ON public.vehicle_field_sources FOR UPDATE TO authenticated USING ((EXISTS (SELECT 1
  FROM vehicles v WHERE ((v.id = vehicle_field_sources.vehicle_id) AND ((((SELECT auth.uid() AS uid) = v.uploaded_by)
  OR ((SELECT auth.uid() AS uid) = v.user_id)) OR ((SELECT auth.uid() AS uid) = v.owner_id))))) OR (EXISTS (SELECT 1
  FROM vehicle_user_permissions vup WHERE ((vup.vehicle_id = vehicle_field_sources.vehicle_id) AND (vup.user_id = (SELECT auth.uid() AS uid))
  AND (vup.is_active = true)))));

-- Live grants: column grants on vehicles; table grants on vehicle_field_sources.
GRANT SELECT (id, is_public, deleted_at, user_id, owner_id, uploaded_by, created_by_user_id) ON public.vehicles TO anon, authenticated;
GRANT SELECT ON public.vehicle_field_sources TO anon;
GRANT INSERT, SELECT, UPDATE ON public.vehicle_field_sources TO authenticated;
-- vehicle_user_permissions: the write policies read it as the caller; live grants and its owner/own-row SELECT policies.
GRANT SELECT ON public.vehicle_user_permissions TO anon, authenticated;
ALTER TABLE public.vehicle_user_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vehicle owners can manage permissions" ON public.vehicle_user_permissions USING ((EXISTS (SELECT 1 FROM vehicles v
  WHERE ((v.id = vehicle_user_permissions.vehicle_id) AND (v.user_id = (SELECT auth.uid() AS uid))))) OR ((SELECT auth.uid() AS uid) = user_id));
CREATE POLICY vup_select_own ON public.vehicle_user_permissions FOR SELECT USING (user_id = (SELECT auth.uid() AS uid));
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
-- The field_value labels the current role and claims can read, sorted.
CREATE FUNCTION public.t_seen() RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(string_agg(field_value, ',' ORDER BY field_value), '') FROM public.vehicle_field_sources $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text), public.t_seen(), public.t_claims(text) TO anon, authenticated, service_role;

-- Users: u1 owns A (public), B (private) and C (public, deleted); u2 is a stranger; u3 holds an active mechanic
-- permission on B granted by u1; u4 is created_by_user_id on B.
INSERT INTO public.vehicles (id, is_public, deleted_at, user_id, created_by_user_id) VALUES
  ('a0000000-0000-0000-0000-00000000000a', true,  NULL,         '00000000-0000-0000-0000-000000000001', NULL),
  ('b0000000-0000-0000-0000-00000000000b', false, NULL,         '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004'),
  ('c0000000-0000-0000-0000-00000000000c', true,  '2026-11-01', '00000000-0000-0000-0000-000000000001', NULL);
INSERT INTO public.vehicle_user_permissions VALUES
  ('b0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000003', true, 'mechanic', '00000000-0000-0000-0000-000000000001');
INSERT INTO public.vehicle_field_sources (id, vehicle_id, field_name, field_value, source_type) VALUES
  ('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'vin',   'public_a',  'test'),
  ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000b', 'vin',   'private_b', 'test'),
  ('f0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-00000000000b', 'color', 'private_b2','test'),
  ('f0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-00000000000c', 'vin',   'deleted_c', 'test');

-- Before: the defect. Anon and a stranger read every row.
SET ROLE anon; SELECT t_claims('');
SELECT t_assert(t_seen() = 'deleted_c,private_b,private_b2,public_a', 'before: anon reads all 4 rows, private and deleted cars included');
RESET ROLE;
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000002');
SELECT t_assert(t_seen() = 'deleted_c,private_b,private_b2,public_a', 'before: a stranger reads all 4 rows');
RESET ROLE;

\ir ../migrations/20261125132000_vehicle_field_sources_read_policy.sql
\ir ../migrations/20261125132000_vehicle_field_sources_read_policy.sql
RESET statement_timeout; RESET lock_timeout;

SELECT t_assert((SELECT count(*) FROM pg_policies WHERE tablename = 'vehicle_field_sources' AND cmd = 'SELECT') = 1
  AND (SELECT roles::text FROM pg_policies WHERE tablename = 'vehicle_field_sources' AND cmd = 'SELECT') = '{anon,authenticated}'
  AND (SELECT count(*) FROM pg_policies WHERE tablename = 'vehicle_field_sources' AND cmd IN ('INSERT', 'UPDATE')) = 4,
  'policies: one SELECT policy for anon and authenticated (applied twice); 4 insert/update policies unchanged');

-- Anon.
SET ROLE anon; SELECT t_claims('');
SELECT t_assert(t_seen() = 'public_a', 'anon: reads the public car''s row only (not the private or the deleted car''s)');
SELECT t_assert((SELECT count(*) FROM (SELECT * FROM public.vehicle_field_sources WHERE vehicle_id = 'a0000000-0000-0000-0000-00000000000a') s) = 1
  AND (SELECT count(*) FROM public.vehicle_field_sources WHERE vehicle_id = 'b0000000-0000-0000-0000-00000000000b') = 0
  AND (SELECT count(*) FROM public.vehicle_field_sources WHERE vehicle_id = 'c0000000-0000-0000-0000-00000000000c') = 0,
  'anon: select=* by vehicle_id runs without 42501; the private and deleted car filters return 0');
RESET ROLE;

-- u2: a stranger reads only what anon reads, and cannot write.
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000002');
SELECT t_assert(t_seen() = 'public_a', 'u2 (stranger): reads what anon reads');
DO $$ BEGIN
  INSERT INTO public.vehicle_field_sources (vehicle_id, field_name, field_value) VALUES ('a0000000-0000-0000-0000-00000000000a', 'vin', 'u2_write');
  RAISE EXCEPTION 'FAIL: u2 (stranger) inserted a field source';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'PASS: u2 (stranger): insert refused by the unchanged insert policies';
END $$;
RESET ROLE;

-- u1: the owner reads all three cars' rows and still writes.
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000001');
SELECT t_assert(t_seen() = 'deleted_c,private_b,private_b2,public_a', 'u1 (owner): reads every row of its cars, private and deleted included');
INSERT INTO public.vehicle_field_sources (id, vehicle_id, field_name, field_value)
  VALUES ('f0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-00000000000b', 'trim', 'owner_b');
UPDATE public.vehicle_field_sources SET source_type = 'owner' WHERE id = 'f0000000-0000-0000-0000-000000000005';
SELECT t_assert((SELECT source_type FROM public.vehicle_field_sources WHERE id = 'f0000000-0000-0000-0000-000000000005') = 'owner',
  'u1 (owner): inserts and updates a row on its private car (insert/update policies unchanged; the row reads back)');
RESET ROLE;

-- u3: permission holder on B reads B through vehicle_viewer_tied.
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000003');
SELECT t_assert(t_seen() = 'owner_b,private_b,private_b2,public_a', 'u3 (mechanic permission on B): reads B''s rows and the public car''s, not the deleted car''s');
RESET ROLE;

-- u4: created_by_user_id on B (vehicle_viewer_tied's own column test).
SET ROLE authenticated; SELECT t_claims('00000000-0000-0000-0000-000000000004');
SELECT t_assert(t_seen() = 'owner_b,private_b,private_b2,public_a', 'u4 (creator of B): reads B''s rows');
RESET ROLE;

-- service_role keeps every row.
SET ROLE service_role; SELECT t_claims('service');
SELECT t_assert((SELECT count(*) FROM public.vehicle_field_sources) = 5, 'service_role: reads all 5 rows');
RESET ROLE;
