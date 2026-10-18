-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_gps_org_tag_proposes_pending -f this-file.sql
-- Proves that after 20261016203000_gps_org_tag_proposes_pending.sql a located photo of a vehicle is evidence, never
-- a link: it proposes work_location (a pending_vehicle_assignments row) only for the one organization of the
-- photographer within 150 m; a site several of his organizations share proposes nothing; an organization he does not
-- belong to is never proposed; a triple the owner rejected or approved is not proposed again; a photo outside his
-- recorded holding of the vehicle, or after his membership ended, proposes nothing; and the trigger writes no
-- organization_vehicles row. approve_pending_assignment (live source, unchanged) is the step that makes the link.
-- Also proves 20261016203100_user_sites_organization_location.sql: a nullable pointer, null on existing rows, cleared
-- when its location is deleted. Starts from the live sources in helpers/org_gps_tagging_live_20261015.sql; the live
-- trigger needs PostGIS, which this server lacks, so only its source (sha256) is checked, not its behavior.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_role', true), '') $$;
CREATE FUNCTION public.is_admin_or_moderator() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;

-- The live columns the functions read and write, with the live keys and checks.
CREATE TYPE public.vision_gate_status AS ENUM ('pending', 'approved', 'rejected_personal', 'rejected_misattributed', 'review_needed');
CREATE TABLE public.organizations (id uuid PRIMARY KEY, business_name text, latitude numeric, longitude numeric);
CREATE TABLE public.organization_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  label text, latitude numeric, longitude numeric, is_primary boolean DEFAULT false
);
CREATE TABLE public.organization_contributors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL, start_date date DEFAULT CURRENT_DATE, end_date date,
  status text DEFAULT 'active' CHECK (status = ANY (ARRAY['active', 'inactive', 'pending'])),
  UNIQUE (organization_id, user_id)
);
CREATE TABLE public.vehicles (id uuid PRIMARY KEY);
CREATE TABLE public.vehicle_ownerships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, owner_profile_id uuid, role text,
  is_current boolean DEFAULT true, start_date date, end_date date
);
CREATE TABLE public.vehicle_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES public.vehicles (id), user_id uuid, latitude numeric, longitude numeric,
  taken_at timestamptz, is_superseded boolean DEFAULT false, vision_gate_status public.vision_gate_status
);
CREATE TABLE public.organization_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, user_id uuid, latitude numeric, longitude numeric
);
CREATE TABLE public.organization_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles (id) ON DELETE CASCADE,
  relationship_type text NOT NULL,
  status text DEFAULT 'active' CHECK (status = ANY (ARRAY['active', 'past', 'pending', 'sold', 'archived'])),
  start_date date, end_date date, linked_by_user_id uuid, auto_tagged boolean DEFAULT false,
  gps_match_confidence numeric, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  user_confirmed boolean DEFAULT false, user_rejected boolean DEFAULT false, user_rejected_by uuid,
  user_rejected_at timestamptz,
  location_id uuid REFERENCES public.organization_locations (id) ON DELETE SET NULL,
  CONSTRAINT organization_vehicles_organization_id_vehicle_id_relations_key UNIQUE (organization_id, vehicle_id, relationship_type)
);
CREATE TABLE public.pending_vehicle_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  suggested_relationship_type text NOT NULL CHECK (suggested_relationship_type = ANY (ARRAY['owner', 'consigner',
    'service_provider', 'work_location', 'seller', 'buyer', 'parts_supplier', 'fabricator', 'painter', 'upholstery',
    'transport', 'storage', 'inspector', 'collaborator'])),
  overall_confidence numeric NOT NULL CHECK (overall_confidence >= 0 AND overall_confidence <= 100),
  confidence_breakdown jsonb DEFAULT '{}'::jsonb, evidence_sources text[] DEFAULT '{}'::text[],
  evidence_count integer DEFAULT 0,
  status text DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending', 'approved', 'rejected', 'auto_approved', 'expired'])),
  auto_approve_threshold numeric DEFAULT 80.0, suggested_by_system boolean DEFAULT true,
  suggested_by_user_id uuid REFERENCES auth.users (id), reviewed_by_user_id uuid REFERENCES auth.users (id),
  reviewed_at timestamptz, review_notes text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + '30 days'::interval),
  CONSTRAINT pending_vehicle_assignments_vehicle_id_organization_id_sugg_key
    UNIQUE (vehicle_id, organization_id, suggested_relationship_type, status)
);
CREATE TABLE public.user_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text, lat double precision NOT NULL, lon double precision NOT NULL, radius_m integer NOT NULL DEFAULT 150,
  source text NOT NULL DEFAULT 'ignition_cluster', confirmed_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now()
);

\ir helpers/org_gps_tagging_live_20261015.sql
CREATE TRIGGER trg_auto_tag_org_from_gps AFTER INSERT OR UPDATE OF latitude, longitude ON public.vehicle_images
  FOR EACH ROW WHEN (((new.latitude IS NOT NULL) AND (new.longitude IS NOT NULL))) EXECUTE FUNCTION auto_tag_organization_from_gps();
CREATE TRIGGER trg_auto_tag_org_from_org_image AFTER INSERT OR UPDATE OF latitude, longitude ON public.organization_images
  FOR EACH ROW WHEN (((new.latitude IS NOT NULL) AND (new.longitude IS NOT NULL))) EXECUTE FUNCTION auto_tag_organization_from_gps();

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
-- One photo; returns its id.
CREATE FUNCTION public.t_photo(p_vehicle uuid, p_user uuid, p_lat numeric, p_lon numeric,
  p_taken timestamptz DEFAULT '2026-06-01 17:00Z', p_gate public.vision_gate_status DEFAULT 'pending',
  p_superseded boolean DEFAULT false) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.vehicle_images (vehicle_id, user_id, latitude, longitude, taken_at, vision_gate_status, is_superseded)
  VALUES (p_vehicle, p_user, p_lat, p_lon, p_taken, p_gate, p_superseded) RETURNING id $$;
CREATE FUNCTION public.t_pending(p_vehicle uuid) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.pending_vehicle_assignments WHERE vehicle_id = p_vehicle AND status = 'pending' $$;

-- 0. The fixture is the live source.
SELECT public.t_assert(encode(sha256(convert_to(pg_get_functiondef('public.auto_tag_organization_from_gps()'::regprocedure), 'UTF8')), 'base64')
  = 'RUfXPvoaxxbeLWgqmOhEwCtGYy2N0d29o6OO2qLWiOQ=', 'fixture: trigger source as live');
SELECT public.t_assert(encode(sha256(convert_to(pg_get_functiondef('public.approve_pending_assignment(uuid,uuid,text)'::regprocedure), 'UTF8')), 'base64')
  = '/JEu8T7lFdOxpDyRhF4HiLGZuSbGZy2KvJ0DJBlsM0E=', 'fixture: approve source as live');

-- Seeds. Photographer U and second photographer U2; stranger S (no membership).
-- Site Y: organizations A, B, C within 60 m of each other (U belongs to all three, U2 to A only).
-- Site W: organization D alone (U). Site Z: E, which U does not belong to.
-- Site V: F (U) with a non-member organization G 35 m away. Site H: U's membership ended 2025-12-31.
-- Site I: an organization with coordinates on its own row and no located point (U).
-- J and K: two of U's organizations 250 m apart.
INSERT INTO auth.users VALUES ('10000000-0000-0000-0000-0000000000a1'), ('10000000-0000-0000-0000-0000000000a2'), ('10000000-0000-0000-0000-0000000000e9');
INSERT INTO public.organizations (id, business_name, latitude, longitude) VALUES
 ('20000000-0000-0000-0000-00000000000a', 'A dealer', 35.972666, -114.85595),
 ('20000000-0000-0000-0000-00000000000b', 'B customs', 35.972836, -114.855666),
 ('20000000-0000-0000-0000-00000000000c', 'C upholstery', 35.972719, -114.855269),
 ('20000000-0000-0000-0000-00000000000d', 'D shop', 35.9772094, -114.853624),
 ('20000000-0000-0000-0000-00000000000e', 'E stranger', 35.9900, -114.8400),
 ('20000000-0000-0000-0000-00000000000f', 'F garage', 36.1000, -115.1000),
 ('20000000-0000-0000-0000-000000000010', 'G neighbor', 36.1003, -115.1002),
 ('20000000-0000-0000-0000-000000000011', 'H former', 36.2000, -115.0700),
 ('20000000-0000-0000-0000-000000000012', 'I unlocated', 36.3000, -115.2000),
 ('20000000-0000-0000-0000-000000000013', 'J yard', 36.4000, -115.3000),
 ('20000000-0000-0000-0000-000000000014', 'K yard', 36.4000, -115.29721);
INSERT INTO public.organization_locations (id, organization_id, latitude, longitude, is_primary)
SELECT ('30000000-0000-0000-0000-0000000000' || right(o.id::text, 2))::uuid, o.id, o.latitude, o.longitude, true
FROM public.organizations o WHERE o.business_name <> 'I unlocated';
INSERT INTO public.organization_contributors (organization_id, user_id, role, end_date) VALUES
 ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000a1', 'board_member', NULL),
 ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-0000000000a1', 'photographer', NULL),
 ('20000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-0000000000a1', 'technician', NULL),
 ('20000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-0000000000a1', 'owner', NULL),
 ('20000000-0000-0000-0000-00000000000f', '10000000-0000-0000-0000-0000000000a1', 'contractor', NULL),
 ('20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-0000000000a1', 'employee', '2025-12-31'),
 ('20000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-0000000000a1', 'employee', NULL),
 ('20000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-0000000000a1', 'employee', NULL),
 ('20000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-0000000000a1', 'employee', NULL),
 ('20000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-0000000000a2', 'employee', NULL);
INSERT INTO public.vehicles SELECT ('40000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid FROM generate_series(1, 15) n;
-- V4: the owner rejected D as its work location. V5: an organization_vehicles row he rejected. V9: he approved D.
INSERT INTO public.pending_vehicle_assignments (vehicle_id, organization_id, suggested_relationship_type, overall_confidence, status, reviewed_by_user_id) VALUES
 ('40000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-00000000000d', 'work_location', 40, 'rejected', '10000000-0000-0000-0000-0000000000a1'),
 ('40000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-00000000000d', 'work_location', 40, 'approved', '10000000-0000-0000-0000-0000000000a1');
INSERT INTO public.organization_vehicles (organization_id, vehicle_id, relationship_type, status, auto_tagged, user_rejected, user_rejected_by) VALUES
 ('20000000-0000-0000-0000-00000000000d', '40000000-0000-0000-0000-000000000005', 'work_location', 'archived', true, true, '10000000-0000-0000-0000-0000000000a1');
-- V6: U's recorded holding ended 2026-02-22.
INSERT INTO public.vehicle_ownerships (vehicle_id, owner_profile_id, role, is_current, end_date) VALUES
 ('40000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-0000000000a1', 'previous_owner', false, '2026-02-22');
INSERT INTO public.user_sites (user_id, name, lat, lon, radius_m, source) VALUES
 ('10000000-0000-0000-0000-0000000000a1', 'SITE 01', 35.975, -114.855, 1771, 'ignition');

\ir ../migrations/20261016203000_gps_org_tag_proposes_pending.sql
\ir ../migrations/20261016203100_user_sites_organization_location.sql
-- Each migration runs twice without error or change.
\ir ../migrations/20261016203000_gps_org_tag_proposes_pending.sql
\ir ../migrations/20261016203100_user_sites_organization_location.sql

-- 1. A photo at a site three of his organizations share proposes nothing.
SELECT public.t_photo('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a1', 35.97275, -114.8557);
SELECT public.t_assert(public.t_pending('40000000-0000-0000-0000-000000000001') = 0, 'shared site: no proposal');
-- At the far edge of that lot only C is within 150 m of the photo, but A and B are within 150 m of C: still shared.
SELECT public.t_photo('40000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-0000000000a1', 35.97272, -114.85388);
SELECT public.t_assert(public.t_pending('40000000-0000-0000-0000-000000000014') = 0, 'far edge of a shared site: no proposal');
-- Halfway between two of his organizations 250 m apart, each 125 m away: shared too.
SELECT public.t_photo('40000000-0000-0000-0000-000000000015', '10000000-0000-0000-0000-0000000000a1', 36.4000, -115.298605);
SELECT public.t_assert(public.t_pending('40000000-0000-0000-0000-000000000015') = 0, 'between two of his organizations: no proposal');

-- 2. A photo at a site where one of his organizations is proposes that one, pending, with its evidence.
SELECT public.t_photo('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000a1', 35.9773, -114.8537);
SELECT public.t_assert(public.t_pending('40000000-0000-0000-0000-000000000002') = 1, 'one-organization site: one proposal');
SELECT public.t_assert(organization_id = '20000000-0000-0000-0000-00000000000d' AND suggested_relationship_type = 'work_location'
  AND suggested_by_user_id = '10000000-0000-0000-0000-0000000000a1' AND suggested_by_system AND auto_approve_threshold IS NULL
  AND evidence_sources = ARRAY['gps', 'user_org_membership']
  AND confidence_breakdown -> 'gps_evidence' ->> 'organization_location_id' = '30000000-0000-0000-0000-00000000000d'
  AND (confidence_breakdown -> 'gps_evidence' ->> 'distance_m')::numeric BETWEEN 5 AND 20
  AND overall_confidence BETWEEN 85 AND 97, 'proposal names D, its location, the photo and a distance score')
FROM public.pending_vehicle_assignments WHERE vehicle_id = '40000000-0000-0000-0000-000000000002';
-- Repeat photos keep one row; a farther one leaves the score, a closer one raises it.
SELECT public.t_photo('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000a1', 35.9780, -114.8536);
SELECT public.t_assert(public.t_pending('40000000-0000-0000-0000-000000000002') = 1
  AND (SELECT overall_confidence FROM public.pending_vehicle_assignments WHERE vehicle_id = '40000000-0000-0000-0000-000000000002') BETWEEN 85 AND 97,
  'farther repeat: one row, score kept');
SELECT public.t_photo('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000a1', 35.97721, -114.85362);
SELECT public.t_assert(public.t_pending('40000000-0000-0000-0000-000000000002') = 1
  AND (SELECT overall_confidence FROM public.pending_vehicle_assignments WHERE vehicle_id = '40000000-0000-0000-0000-000000000002') > 99,
  'closer repeat: one row, score raised');
-- A second photographer who belongs to only one of the three at the shared site proposes that one.
SELECT public.t_photo('40000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-0000000000a2', 35.97275, -114.8557);
SELECT public.t_assert(public.t_pending('40000000-0000-0000-0000-000000000012') = 1
  AND EXISTS (SELECT 1 FROM public.pending_vehicle_assignments WHERE vehicle_id = '40000000-0000-0000-0000-000000000012'
              AND organization_id = '20000000-0000-0000-0000-00000000000a'), 'single member organization at a shared site: proposed');

-- 3. An organization he does not belong to is never proposed, alone or beside one of his.
SELECT public.t_photo('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-0000000000a1', 35.9901, -114.8401);
SELECT public.t_assert(public.t_pending('40000000-0000-0000-0000-000000000003') = 0, 'non-member site: no proposal');
SELECT public.t_photo('40000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-0000000000a1', 36.10015, -115.1001);
SELECT public.t_assert(public.t_pending('40000000-0000-0000-0000-000000000013') = 1
  AND EXISTS (SELECT 1 FROM public.pending_vehicle_assignments WHERE vehicle_id = '40000000-0000-0000-0000-000000000013'
              AND organization_id = '20000000-0000-0000-0000-00000000000f'), 'member beside a non-member: the member only');
SELECT public.t_photo('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-0000000000e9', 35.9773, -114.8537);
SELECT public.t_assert(public.t_pending('40000000-0000-0000-0000-000000000003') = 0, 'photographer with no membership: no proposal');

-- 4. A triple the owner decided is not proposed again: rejected as an assignment, rejected as a link, or approved.
SELECT public.t_photo('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-0000000000a1', 35.9773, -114.8537);
SELECT public.t_assert(public.t_pending('40000000-0000-0000-0000-000000000004') = 0, 'rejected assignment: not proposed again');
SELECT public.t_photo('40000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-0000000000a1', 35.9773, -114.8537);
SELECT public.t_assert(public.t_pending('40000000-0000-0000-0000-000000000005') = 0, 'rejected link: not proposed again');
SELECT public.t_photo('40000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-0000000000a1', 35.9773, -114.8537);
SELECT public.t_assert(public.t_pending('40000000-0000-0000-0000-000000000009') = 0, 'approved assignment: not proposed again');

-- 5. Outside his recorded holding of the vehicle, or with no capture date against that record, nothing; inside, one.
SELECT public.t_photo('40000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-0000000000a1', 35.9773, -114.8537, '2026-03-01 17:00Z');
SELECT public.t_photo('40000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-0000000000a1', 35.9773, -114.8537, NULL);
SELECT public.t_assert(public.t_pending('40000000-0000-0000-0000-000000000006') = 0, 'after the holding ended, or undated: no proposal');
SELECT public.t_photo('40000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-0000000000a1', 35.9773, -114.8537, '2026-01-10 17:00Z');
SELECT public.t_assert(public.t_pending('40000000-0000-0000-0000-000000000006') = 1, 'inside the holding: one proposal');

-- 6. After his membership ended, nothing; before, one.
SELECT public.t_photo('40000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-0000000000a1', 36.2001, -115.0701, '2026-01-05 17:00Z');
SELECT public.t_assert(public.t_pending('40000000-0000-0000-0000-000000000007') = 0, 'after the membership ended: no proposal');
SELECT public.t_photo('40000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-0000000000a1', 36.2001, -115.0701, '2025-12-01 17:00Z');
SELECT public.t_assert(public.t_pending('40000000-0000-0000-0000-000000000007') = 1, 'during the membership: one proposal');

-- 7. An organization with no located point is matched on its own coordinates, with no location id.
SELECT public.t_photo('40000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-0000000000a1', 36.3001, -115.2001);
SELECT public.t_assert(public.t_pending('40000000-0000-0000-0000-000000000008') = 1
  AND (SELECT confidence_breakdown -> 'gps_evidence' -> 'organization_location_id' FROM public.pending_vehicle_assignments
       WHERE vehicle_id = '40000000-0000-0000-0000-000000000008') = 'null'::jsonb, 'unlocated organization: proposed on its coordinates');

-- 8. No vehicle, no photographer, a gate rejection or a superseded row proposes nothing.
SELECT public.t_photo(NULL, '10000000-0000-0000-0000-0000000000a1', 35.9773, -114.8537);
SELECT public.t_photo('40000000-0000-0000-0000-000000000010', NULL, 35.9773, -114.8537);
SELECT public.t_photo('40000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-0000000000a1', 35.9773, -114.8537, p_gate => 'rejected_misattributed');
SELECT public.t_photo('40000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-0000000000a1', 35.9773, -114.8537, p_gate => 'rejected_personal');
SELECT public.t_photo('40000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-0000000000a1', 35.9773, -114.8537, p_superseded => true);
SELECT public.t_assert(public.t_pending('40000000-0000-0000-0000-000000000010') = 0
  AND (SELECT count(*) FROM public.pending_vehicle_assignments WHERE suggested_by_user_id IS NULL AND status = 'pending') = 0,
  'orphan, anonymous, gate-rejected and superseded photos: no proposal');

-- 9. Moving a photo's coordinates fires the rule again.
SELECT public.t_photo('40000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-0000000000a1', 36.5, -115.5);
UPDATE public.vehicle_images SET latitude = 35.97275, longitude = -114.8557 WHERE vehicle_id = '40000000-0000-0000-0000-000000000011';
SELECT public.t_assert(public.t_pending('40000000-0000-0000-0000-000000000011') = 0, 'moved onto the shared site: no proposal');
UPDATE public.vehicle_images SET latitude = 35.9773, longitude = -114.8537 WHERE vehicle_id = '40000000-0000-0000-0000-000000000011';
SELECT public.t_assert(public.t_pending('40000000-0000-0000-0000-000000000011') = 1, 'moved onto a one-organization site: one proposal');

-- 10. An organization photo still does nothing.
INSERT INTO public.organization_images (organization_id, user_id, latitude, longitude)
VALUES ('20000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-0000000000a1', 35.9773, -114.8537);

-- 11. Over all of the above: no organization other than his proposed, none he does not belong to, and no
-- organization_vehicles row written (the one row is the seeded rejection, unchanged).
SELECT public.t_assert(NOT EXISTS (SELECT 1 FROM public.pending_vehicle_assignments
  WHERE organization_id IN ('20000000-0000-0000-0000-00000000000e', '20000000-0000-0000-0000-000000000010')), 'non-member organizations never proposed');
SELECT public.t_assert((SELECT count(*) FROM public.organization_vehicles) = 1
  AND (SELECT status = 'archived' AND user_rejected FROM public.organization_vehicles), 'trigger wrote no organization_vehicles row');
SELECT public.t_assert((SELECT count(*) FROM public.pending_vehicle_assignments WHERE status = 'pending') = 7, 'seven proposals in all');

-- 12. The owner's Sign makes the link, and the signed triple is not proposed again.
SELECT set_config('test.auth_role', 'authenticated', false), set_config('test.auth_uid', '10000000-0000-0000-0000-0000000000a1', false);
SELECT public.t_assert(public.approve_pending_assignment(
  (SELECT id FROM public.pending_vehicle_assignments WHERE vehicle_id = '40000000-0000-0000-0000-000000000002' AND status = 'pending'),
  '10000000-0000-0000-0000-0000000000a1', 'test'), 'owner approves');
SELECT set_config('test.auth_role', '', false), set_config('test.auth_uid', '', false);
SELECT public.t_assert(EXISTS (SELECT 1 FROM public.organization_vehicles WHERE vehicle_id = '40000000-0000-0000-0000-000000000002'
  AND organization_id = '20000000-0000-0000-0000-00000000000d' AND relationship_type = 'work_location' AND status = 'active'), 'approval made the link');
SELECT public.t_photo('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-0000000000a1', 35.9773, -114.8537);
SELECT public.t_assert(public.t_pending('40000000-0000-0000-0000-000000000002') = 0, 'approved triple: not proposed again');

-- 13. user_sites.organization_location_id: nullable, null on the existing row, cleared when its location goes.
SELECT public.t_assert((SELECT is_nullable = 'YES' AND data_type = 'uuid' FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'user_sites' AND column_name = 'organization_location_id'), 'column is a nullable uuid');
SELECT public.t_assert((SELECT organization_location_id IS NULL FROM public.user_sites), 'existing site left null');
SELECT public.t_assert((SELECT confrelid = 'public.organization_locations'::regclass AND confdeltype = 'n' FROM pg_constraint
  WHERE conrelid = 'public.user_sites'::regclass AND contype = 'f' AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
    WHERE attrelid = 'public.user_sites'::regclass AND attname = 'organization_location_id')]), 'references organization_locations, on delete set null');
UPDATE public.user_sites SET organization_location_id = '30000000-0000-0000-0000-00000000000d';
DELETE FROM public.organization_locations WHERE id = '30000000-0000-0000-0000-00000000000d';
SELECT public.t_assert((SELECT organization_location_id IS NULL FROM public.user_sites), 'deleting the location clears the pointer');

SELECT 'test_gps_org_tag_proposes_pending: all assertions passed' AS result;
