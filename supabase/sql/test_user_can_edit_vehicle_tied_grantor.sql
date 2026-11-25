-- Isolated PostgreSQL 17 contract for 20261126011500_user_can_edit_vehicle_tied_grantor.sql.
-- Builds the live user_can_edit_vehicle(uuid, uuid) and vehicle_user_has_access(uuid, uuid) verbatim (live 2026-11-25,
-- md5-checked) over the columns they read, then applies the migration. Synthetic rows only. Cases:
--   * the live chain (read 2026-11-25): a signed-in user with no ties creates an organization through the client
--     policies, becomes its active owner, links someone else's car, and passes the edit check; after, that link
--     grants none;
--   * before: a member of an organization passes the edit check on a car an untied user linked to that organization;
--     a contributor-role row with no grantor passes;
--   * after: the untied link grants no edit; a link made by the car's owner, or by a service path (no linker), still does;
--   * after: a role row with no grantor, or approved by the grantee, no longer passes; a role approved by the car's owner
--     or an active admin passes;
--   * a new role row without a grantor, or approved by its own grantee, is refused by the CHECK; legacy rows remain;
--   * the owner, uploader and an active can_edit contributor still pass; a stranger does not;
--   * re-applying the migration changes nothing.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
SET client_min_messages = notice;

CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;

CREATE TABLE public.vehicles(id uuid PRIMARY KEY, uploaded_by uuid, user_id uuid, owner_id uuid, created_by_user_id uuid);
CREATE TABLE public.vehicle_contributors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid,
  role text, status text, can_edit boolean, organization_id uuid);
CREATE TABLE public.vehicle_contributor_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL,
  user_id uuid NOT NULL, role text NOT NULL, is_active boolean DEFAULT true, approved_by uuid, approved_at timestamptz,
  start_date date DEFAULT CURRENT_DATE, end_date date, notes text, UNIQUE (vehicle_id, user_id, role));
CREATE TABLE public.organization_contributors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid,
  user_id uuid, role text, status text);
CREATE TABLE public.organization_vehicles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid,
  vehicle_id uuid, relationship_type text, status text, linked_by_user_id uuid);
CREATE TABLE public.admin_users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, is_active boolean);
CREATE TABLE public.ownership_verifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, vehicle_id uuid, status text);
CREATE TABLE public.vehicle_user_permissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, user_id uuid,
  role text, is_active boolean, granted_by uuid);

-- Live bodies, verbatim.
CREATE OR REPLACE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- vehicle_viewer_tie_plpgsql_v1: the reviewed SQL body, unchanged.
  RETURN (
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
);
END
$function$;

CREATE OR REPLACE FUNCTION public.user_can_edit_vehicle(p_vehicle_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_can_edit BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM vehicles v
    WHERE v.id = p_vehicle_id
      AND (
        v.uploaded_by = p_user_id
        OR v.user_id = p_user_id
        OR v.owner_id = p_user_id
        OR EXISTS (
          SELECT 1 FROM vehicle_contributors vc
          WHERE vc.vehicle_id = v.id
            AND vc.user_id = p_user_id
            AND vc.status = 'active'
            AND vc.can_edit = true
        )
        OR EXISTS (
          SELECT 1 FROM vehicle_contributor_roles vcr
          WHERE vcr.vehicle_id = v.id
            AND vcr.user_id = p_user_id
            AND vcr.role IN ('owner', 'restorer', 'contributor', 'moderator')
            AND (vcr.end_date IS NULL OR vcr.end_date > CURRENT_DATE)
        )
        OR EXISTS (
          SELECT 1 FROM organization_vehicles ov
          WHERE ov.vehicle_id = v.id
            AND EXISTS (
              SELECT 1 FROM organization_contributors oc
              WHERE oc.organization_id = ov.organization_id
                AND oc.user_id = p_user_id
                AND oc.status = 'active'
                AND oc.role IN ('owner', 'manager', 'employee')
            )
        )
      )
  ) INTO v_can_edit;
  
  RETURN COALESCE(v_can_edit, false);
END;
$function$;

SELECT t_assert(md5(pg_get_functiondef('public.user_can_edit_vehicle(uuid,uuid)'::regprocedure)) = 'd7e90f2f6a6f4c3375fb166f67505d5a', -- gitleaks:allow (function-definition fingerprint, not a secret)
  'the fixture reproduces the live user_can_edit_vehicle');

-- O owns car A and car B. M is an active employee of organization G. X is a stranger with no tie to A or B.
-- K is an active admin. R1..R4 hold contributor roles on A.
\set O  '''0a000000-0000-0000-0000-0000000000a0'''
\set M  '''0d000000-0000-0000-0000-0000000000d0'''
\set X  '''0e000000-0000-0000-0000-0000000000e0'''
\set K  '''0f000000-0000-0000-0000-0000000000f0'''
\set U  '''0b000000-0000-0000-0000-0000000000b0'''
\set C  '''0c000000-0000-0000-0000-0000000000c0'''
\set R1 '''01000000-0000-0000-0000-000000000001'''
\set R2 '''01000000-0000-0000-0000-000000000002'''
\set R3 '''01000000-0000-0000-0000-000000000003'''
\set R4 '''01000000-0000-0000-0000-000000000004'''
\set A  '''a0000000-0000-0000-0000-00000000000a'''
\set B  '''b0000000-0000-0000-0000-00000000000b'''
\set D  '''d0000000-0000-0000-0000-00000000000d'''
\set G  '''90000000-0000-0000-0000-000000000009'''
\set H  '''91000000-0000-0000-0000-000000000019'''

INSERT INTO vehicles(id, uploaded_by, user_id, owner_id) VALUES (:A, :U, :O, :O), (:B, NULL, :O, :O), (:D, NULL, NULL, NULL);
INSERT INTO admin_users(user_id, is_active) VALUES (:K, true);
INSERT INTO vehicle_contributors(vehicle_id, user_id, role, status, can_edit) VALUES (:A, :C, 'mechanic', 'active', true);
INSERT INTO organization_contributors(organization_id, user_id, role, status) VALUES (:G, :M, 'employee', 'active'),
  (:H, :M, 'employee', 'active');
-- A: linked into G by the stranger X. B: linked into H by its owner O. D: linked into G by a service path (no linker).
INSERT INTO organization_vehicles(organization_id, vehicle_id, relationship_type, status, linked_by_user_id) VALUES
  (:G, :A, 'work_location', 'active', :X), (:H, :B, 'work_location', 'active', :O), (:G, :D, 'work_location', 'active', NULL);
-- R1: no grantor. R2: approved by itself. R3: approved by the owner. R4: approved by an active admin. R5 (=X): approved by M.
INSERT INTO vehicle_contributor_roles(vehicle_id, user_id, role, approved_by) VALUES
  (:A, :R1, 'contributor', NULL), (:A, :R2, 'restorer', :R2), (:A, :R3, 'contributor', :O), (:A, :R4, 'moderator', :K),
  (:B, :X, 'contributor', :M);


-- The self-made organization chain, from the live policies and trigger (read 2026-11-25), run as a real authenticated
-- session: any signed-in user creates an organization, becomes its active owner, and links someone else's car to it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$a$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $a$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TABLE public.organizations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_name text, discovered_by uuid, uploaded_by uuid);
CREATE TABLE public.business_ownership(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, owner_id uuid,
  ownership_percentage numeric, ownership_type text, ownership_title text, acquisition_date date, status text DEFAULT 'active',
  UNIQUE (business_id, owner_id));
ALTER TABLE public.organization_contributors ALTER COLUMN status SET DEFAULT 'active',
  ADD COLUMN verification_method text NOT NULL DEFAULT 'self_claimed', ADD COLUMN verified_by uuid, ADD COLUMN verified_at timestamptz,
  ADD CONSTRAINT oc_one UNIQUE (organization_id, user_id);
-- trigger_create_initial_business_ownership, live body
CREATE FUNCTION public.create_initial_business_ownership() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $t$
BEGIN
    IF auth.uid() IS NOT NULL THEN
        INSERT INTO public.business_ownership (business_id, owner_id, ownership_percentage, ownership_type, ownership_title, acquisition_date)
        VALUES (NEW.id, auth.uid(), 100.00, 'founder', 'Founder/Owner', CURRENT_DATE)
        ON CONFLICT (business_id, owner_id) DO NOTHING;
    END IF;
    RETURN NEW;
END; $t$;
CREATE TRIGGER trigger_create_initial_business_ownership AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.create_initial_business_ownership();
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_ownership ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_contributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_vehicles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.organizations, public.organization_contributors, public.organization_vehicles TO authenticated;
GRANT SELECT ON public.vehicles, public.business_ownership TO authenticated;
CREATE POLICY read_fx ON public.organizations FOR SELECT USING (true);
CREATE POLICY read_fx ON public.organization_contributors FOR SELECT USING (true);
CREATE POLICY read_fx ON public.business_ownership FOR SELECT USING (true);
-- live write policies, verbatim
CREATE POLICY "Users create orgs" ON public.organizations FOR INSERT WITH CHECK (((( SELECT auth.uid() AS uid) = discovered_by) OR (( SELECT auth.uid() AS uid) = uploaded_by)));
CREATE POLICY organization_contributors_insert ON public.organization_contributors FOR INSERT WITH CHECK (((( SELECT auth.uid() AS uid) IS NOT NULL) AND (((user_id = ( SELECT auth.uid() AS uid)) AND (role = ANY (ARRAY['contributor'::text, 'photographer'::text])) AND (status = 'pending'::text) AND (verification_method = 'self_claimed'::text) AND (verified_by IS NULL) AND (verified_at IS NULL)) OR ((user_id = ( SELECT auth.uid() AS uid)) AND (role = 'owner'::text) AND (verification_method = 'self_claimed'::text) AND (verified_by IS NULL) AND (verified_at IS NULL) AND (EXISTS ( SELECT 1
   FROM business_ownership bo
  WHERE ((bo.business_id = organization_contributors.organization_id) AND (bo.owner_id = ( SELECT auth.uid() AS uid)) AND (bo.status = 'active'::text))))) OR (EXISTS ( SELECT 1
   FROM organization_contributors oc
  WHERE ((oc.organization_id = organization_contributors.organization_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.role = ANY (ARRAY['owner'::text, 'co_founder'::text])) AND (oc.status = 'active'::text)))))));
CREATE POLICY "Users/owners manage links" ON public.organization_vehicles FOR ALL USING (((linked_by_user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM vehicles v
  WHERE ((v.id = organization_vehicles.vehicle_id) AND (v.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
   FROM organization_contributors oc
  WHERE ((oc.organization_id = organization_vehicles.organization_id) AND (oc.user_id = ( SELECT auth.uid() AS uid)) AND (oc.role = ANY (ARRAY['owner'::text, 'manager'::text, 'board_member'::text])) AND (oc.status = 'active'::text))))));

\set Z  '''0c100000-0000-0000-0000-0000000000c1'''
\set E  '''e0000000-0000-0000-0000-00000000000e'''
INSERT INTO vehicles(id, user_id, owner_id) VALUES (:E, :O, :O);
SELECT set_config('request.jwt.claims', json_build_object('sub', :Z, 'role', 'authenticated')::text, false);
SET ROLE authenticated;
INSERT INTO organizations(id, business_name, discovered_by) VALUES ('92000000-0000-0000-0000-000000000029', 'self-made', auth.uid());
INSERT INTO organization_contributors(organization_id, user_id, role, verification_method)
VALUES ('92000000-0000-0000-0000-000000000029', auth.uid(), 'owner', 'self_claimed');
INSERT INTO organization_vehicles(organization_id, vehicle_id, relationship_type, status, linked_by_user_id)
VALUES ('92000000-0000-0000-0000-000000000029', :E, 'service_provider', 'active', auth.uid());
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);
SELECT t_assert((SELECT status FROM organization_contributors WHERE user_id = :Z) = 'active',
  'chain: a signed-in user with no ties creates an organization and is its active owner, through the client policies');
SELECT t_assert(user_can_edit_vehicle(:E, :Z), 'before: that user then passes the edit check on someone else''s car');


-- Before.
SELECT t_assert(user_can_edit_vehicle(:A, :M), 'before: a member passes on a car an untied user linked into the organization');
SELECT t_assert(user_can_edit_vehicle(:A, :R1) AND user_can_edit_vehicle(:A, :R2), 'before: a role with no grantor, or approved by itself, passes');

\ir ../migrations/20261126011500_user_can_edit_vehicle_tied_grantor.sql

-- Organization links.
SELECT t_assert(NOT user_can_edit_vehicle(:A, :M), 'a link made by an untied user grants a member no edit');
SELECT t_assert(user_can_edit_vehicle(:B, :M), 'a link made by the car''s owner still grants a member edit');
SELECT t_assert(user_can_edit_vehicle(:D, :M), 'a link made by a service path (no linker) still grants a member edit');
SELECT t_assert((SELECT count(*) FROM organization_vehicles) = 4, 'no link was removed');


-- Severity case after the change.
SELECT t_assert(NOT user_can_edit_vehicle(:E, :Z), 'the self-made organization link to someone else''s car grants no edit');
SELECT t_assert((SELECT count(*) FROM organization_vehicles WHERE vehicle_id = :E) = 1, 'the link itself remains, as a claim');

-- Contributor roles.
SELECT t_assert(NOT user_can_edit_vehicle(:A, :R1), 'a role with no grantor no longer passes');
SELECT t_assert(NOT user_can_edit_vehicle(:A, :R2), 'a role approved by its own grantee no longer passes');
SELECT t_assert(user_can_edit_vehicle(:A, :R3), 'a role approved by the car''s owner passes');
SELECT t_assert(user_can_edit_vehicle(:A, :R4), 'a role approved by an active admin passes');
SELECT t_assert(NOT user_can_edit_vehicle(:B, :X), 'a role approved by someone not tied to the car does not pass');
SELECT t_assert((SELECT count(*) FROM vehicle_contributor_roles) = 5, 'legacy role rows remain; none deleted');

-- New rows must name a grantor who is not the grantee.
DO $$ BEGIN
  BEGIN
    INSERT INTO public.vehicle_contributor_roles(vehicle_id, user_id, role)
    VALUES ('a0000000-0000-0000-0000-00000000000a', '02000000-0000-0000-0000-000000000002', 'contributor');
    RAISE EXCEPTION 'FAIL: a role row without a grantor was accepted';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS: a new role row without a grantor is refused';
  END;
  BEGIN
    INSERT INTO public.vehicle_contributor_roles(vehicle_id, user_id, role, approved_by)
    VALUES ('a0000000-0000-0000-0000-00000000000a', '02000000-0000-0000-0000-000000000003', 'contributor', '02000000-0000-0000-0000-000000000003');
    RAISE EXCEPTION 'FAIL: a self-approved role row was accepted';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'PASS: a new self-approved role row is refused';
  END;
END $$;
INSERT INTO vehicle_contributor_roles(vehicle_id, user_id, role, approved_by)
VALUES (:A, '02000000-0000-0000-0000-000000000004', 'contributor', :O);
SELECT t_assert(user_can_edit_vehicle(:A, '02000000-0000-0000-0000-000000000004'), 'an owner-approved new role row lands and passes');

-- Unchanged branches.
SELECT t_assert(user_can_edit_vehicle(:A, :O) AND user_can_edit_vehicle(:A, :U) AND user_can_edit_vehicle(:A, :C),
  'the owner, the uploader and an active can_edit contributor still pass');
SELECT t_assert(NOT user_can_edit_vehicle(:A, :X), 'a stranger does not pass');

-- Re-apply.
SELECT md5(pg_get_functiondef('public.user_can_edit_vehicle(uuid,uuid)'::regprocedure)) AS after_md5 \gset
\ir ../migrations/20261126011500_user_can_edit_vehicle_tied_grantor.sql
SELECT t_assert(md5(pg_get_functiondef('public.user_can_edit_vehicle(uuid,uuid)'::regprocedure)) = :'after_md5'
  AND (SELECT count(*) FROM pg_constraint WHERE conname = 'vehicle_contributor_roles_grantor_not_grantee') = 1,
  're-applying the migration changes nothing');
SELECT t_assert(:'after_md5' = '1aa3a755163404d6cb5850c9d736600b', 'the after-fingerprint in the guard is this body''s'); -- gitleaks:allow (function-definition fingerprint, not a secret)
