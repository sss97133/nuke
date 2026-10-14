-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_pending_assignments -f this-file.sql
-- Proves get_pending_vehicle_assignments(uuid) after 20261014040600_pending_assignments_vehicle_sweep.sql: the same rows as the
-- 2026-10-14 production function for every kind of caller (uploader/owner of the vehicle, active organization contributor,
-- inactive contributor, stranger), most confident first, with the same names (a NULL name stays NULL), the same visibility
-- rule, the same grants, owner, security and volatility; the planner setting it flips is restored; a drifted source stops it.
-- The rows below are a disposable test database's rows, never production testimony.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, year integer, make text, model text, uploaded_by uuid, user_id uuid);
CREATE TABLE public.businesses (id uuid PRIMARY KEY, business_name text);
CREATE TABLE public.organization_contributors (organization_id uuid, user_id uuid, status text);
CREATE TABLE public.pending_vehicle_assignments (
  id uuid PRIMARY KEY, vehicle_id uuid, organization_id uuid, status text, suggested_relationship_type text,
  overall_confidence numeric, evidence_sources text[], created_at timestamptz);
CREATE INDEX idx_vehicles_uploaded_by ON public.vehicles (uploaded_by);
CREATE INDEX idx_vehicles_user_id ON public.vehicles (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_pending_assignments_org ON public.pending_vehicle_assignments (organization_id);

CREATE FUNCTION public.t_u(p_c text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT (p_c || '0000000-0000-0000-0000-00000000000' || p_c)::uuid $$;
CREATE FUNCTION public.t_v(p_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('90000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION public.t_o(p_n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('a0000000-0000-0000-0000-' || lpad(p_n::text, 12, '0'))::uuid $$;
-- Users: a uploads V1 and V2; d owns V3 (user_id); b is an active contributor of O2; e an inactive one of O3; c is a stranger.
INSERT INTO public.vehicles (id, year, make, model, uploaded_by, user_id) VALUES
  (public.t_v(1), 1970, 'Ford', 'Bronco', public.t_u('a'), NULL), (public.t_v(2), 1980, 'Jeep', 'CJ7', public.t_u('a'), NULL),
  (public.t_v(3), 1990, 'Toyota', 'Pickup', NULL, public.t_u('d')), (public.t_v(4), 2000, 'Honda', 'S2000', NULL, NULL),
  (public.t_v(5), 1999, 'Mystery', NULL, NULL, NULL), (public.t_v(6), 2005, 'Subaru', 'WRX', NULL, NULL);
INSERT INTO public.businesses VALUES (public.t_o(1), 'Org One'), (public.t_o(2), 'Org Two'), (public.t_o(3), 'Org Three');
INSERT INTO public.organization_contributors VALUES (public.t_o(2), public.t_u('b'), 'active'), (public.t_o(3), public.t_u('e'), 'inactive'),
  (public.t_o(1), public.t_u('b'), 'inactive');
INSERT INTO public.pending_vehicle_assignments (id, vehicle_id, organization_id, status, suggested_relationship_type, overall_confidence, evidence_sources, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000001', public.t_v(1), public.t_o(1), 'pending', 'service_provider', 90, ARRAY['gps', 'receipt'], '2026-10-01 10:00+00'),
  ('b0000000-0000-0000-0000-000000000002', public.t_v(2), public.t_o(2), 'pending', 'owner', 75, ARRAY['photo'], '2026-10-02 10:00+00'),
  ('b0000000-0000-0000-0000-000000000003', public.t_v(3), public.t_o(1), 'pending', 'consigner', 60, NULL, '2026-10-03 10:00+00'),
  ('b0000000-0000-0000-0000-000000000004', public.t_v(4), public.t_o(2), 'pending', 'sold_by', 95, ARRAY['listing'], '2026-10-04 10:00+00'),
  ('b0000000-0000-0000-0000-000000000005', public.t_v(5), public.t_o(2), 'pending', 'owner', 40, ARRAY[]::text[], '2026-10-05 10:00+00'),
  ('b0000000-0000-0000-0000-000000000006', public.t_v(6), public.t_o(3), 'pending', 'owner', 55, ARRAY['x'], '2026-10-06 10:00+00'),
  ('b0000000-0000-0000-0000-000000000007', public.t_v(1), public.t_o(2), 'approved', 'owner', 99, NULL, '2026-10-07 10:00+00'),
  ('b0000000-0000-0000-0000-000000000008', public.t_v(2), public.t_o(1), 'rejected', 'owner', 98, NULL, '2026-10-08 10:00+00'),
  ('b0000000-0000-0000-0000-000000000009', public.t_v(2), public.t_o(1), 'pending', 'service_provider', 90, ARRAY['gps'], '2026-10-09 10:00+00');
-- A bulk of assignments for organization 2 so the sweep has real work: 3,000 vehicles with names.
INSERT INTO public.vehicles (id, year, make, model) SELECT public.t_v(1000 + g), 1960 + g % 60, 'Make' || g % 30, 'Model' || g FROM generate_series(1, 3000) g;
INSERT INTO public.pending_vehicle_assignments (id, vehicle_id, organization_id, status, suggested_relationship_type, overall_confidence, evidence_sources, created_at)
SELECT gen_random_uuid(), public.t_v(1000 + g), public.t_o(2), 'pending', 'service_provider', 1 + g % 50, ARRAY['bulk'], '2026-09-01'::timestamptz + make_interval(mins => g) FROM generate_series(1, 3000) g;
ANALYZE;

\ir helpers/get_pending_vehicle_assignments_live_20261014.sql
REVOKE ALL ON FUNCTION public.get_pending_vehicle_assignments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pending_vehicle_assignments(uuid) TO authenticated, service_role;
CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
SELECT public.t_assert(md5(pg_get_functiondef('public.get_pending_vehicle_assignments(uuid)'::regprocedure)) = '130a2f1e650d66a22a9fa5532de6ed65', 'the fixture is the live source');
SELECT replace(pg_get_functiondef('public.get_pending_vehicle_assignments(uuid)'::regprocedure), 'public.get_pending_vehicle_assignments(', 'public.pva_before(') AS ddl \gexec
CREATE TEMP TABLE original_contract AS
  SELECT proowner, proacl, prosecdef, provolatile, proconfig, pg_get_function_result(oid) AS result FROM pg_proc
  WHERE oid = 'public.get_pending_vehicle_assignments(uuid)'::regprocedure;
CREATE TABLE public.t_before (who text, id uuid, vehicle_name text, organization_name text, relationship_type text, confidence numeric,
  evidence_sources text[], created_at timestamptz, vehicle_id uuid, organization_id uuid, ord bigint);
INSERT INTO public.t_before SELECT 'a', *, row_number() OVER () FROM public.pva_before(public.t_u('a'));
INSERT INTO public.t_before SELECT 'b', *, row_number() OVER () FROM public.pva_before(public.t_u('b'));
INSERT INTO public.t_before SELECT 'c', *, row_number() OVER () FROM public.pva_before(public.t_u('c'));
INSERT INTO public.t_before SELECT 'd', *, row_number() OVER () FROM public.pva_before(public.t_u('d'));
INSERT INTO public.t_before SELECT 'e', *, row_number() OVER () FROM public.pva_before(public.t_u('e'));
SELECT public.t_assert((SELECT count(*) FROM public.t_before WHERE who = 'a') = 3 AND (SELECT count(*) FROM public.t_before WHERE who = 'b') = 3003
  AND (SELECT count(*) FROM public.t_before WHERE who IN ('c', 'e')) = 0 AND (SELECT count(*) FROM public.t_before WHERE who = 'd') = 1,
  'the fixture: uploader 3, active contributor 3,003, stranger and inactive contributor 0, owner 1');

\ir ../migrations/20261014040600_pending_assignments_vehicle_sweep.sql

-- The same rows for every caller, field by field (ties in confidence and time are ordered by the engine, so compare by id).
CREATE TABLE public.t_after (who text, id uuid, vehicle_name text, organization_name text, relationship_type text, confidence numeric,
  evidence_sources text[], created_at timestamptz, vehicle_id uuid, organization_id uuid, ord bigint);
INSERT INTO public.t_after SELECT 'a', *, row_number() OVER () FROM public.get_pending_vehicle_assignments(public.t_u('a'));
INSERT INTO public.t_after SELECT 'b', *, row_number() OVER () FROM public.get_pending_vehicle_assignments(public.t_u('b'));
INSERT INTO public.t_after SELECT 'c', *, row_number() OVER () FROM public.get_pending_vehicle_assignments(public.t_u('c'));
INSERT INTO public.t_after SELECT 'd', *, row_number() OVER () FROM public.get_pending_vehicle_assignments(public.t_u('d'));
INSERT INTO public.t_after SELECT 'e', *, row_number() OVER () FROM public.get_pending_vehicle_assignments(public.t_u('e'));
SELECT public.t_assert(NOT EXISTS (
    SELECT 1 FROM (SELECT who, id, vehicle_name, organization_name, relationship_type, confidence, evidence_sources, created_at, vehicle_id, organization_id FROM public.t_before) o
    FULL JOIN (SELECT who, id, vehicle_name, organization_name, relationship_type, confidence, evidence_sources, created_at, vehicle_id, organization_id FROM public.t_after) n
      ON n.who = o.who AND n.id = o.id
    WHERE (o.vehicle_name, o.organization_name, o.relationship_type, o.confidence, o.evidence_sources, o.created_at, o.vehicle_id, o.organization_id)
          IS DISTINCT FROM (n.vehicle_name, n.organization_name, n.relationship_type, n.confidence, n.evidence_sources, n.created_at, n.vehicle_id, n.organization_id)
       OR o.id IS NULL OR n.id IS NULL), 'every caller gets the same rows with the same fields as the live function');
SELECT public.t_assert((SELECT count(*) FROM public.t_after WHERE who = 'a') = 3 AND (SELECT count(*) FROM public.t_after WHERE who = 'b') = 3003
  AND (SELECT count(*) FROM public.t_after WHERE who IN ('c', 'e')) = 0 AND (SELECT count(*) FROM public.t_after WHERE who = 'd') = 1, 'the counts per caller are unchanged');
SELECT public.t_assert((SELECT vehicle_name IS NULL FROM public.t_after WHERE who = 'b' AND vehicle_id = public.t_v(5))
  AND (SELECT vehicle_name = '1970 Ford Bronco' FROM public.t_after WHERE who = 'a' AND vehicle_id = public.t_v(1) AND organization_id = public.t_o(1)),
  'a vehicle with no model keeps a NULL name; a complete one is "year make model"');
SELECT public.t_assert(NOT EXISTS (SELECT 1 FROM (SELECT who, confidence, created_at, lag(confidence) OVER (PARTITION BY who ORDER BY ord) pc, lag(created_at) OVER (PARTITION BY who ORDER BY ord) pt
    FROM public.t_after) q WHERE pc IS NOT NULL AND (confidence, created_at) > (pc, pt)), 'most confident first, then newest');
SELECT public.t_assert(NOT EXISTS (SELECT FROM public.t_after a JOIN public.pending_vehicle_assignments p ON p.id = a.id WHERE p.status <> 'pending'), 'only pending assignments');
SELECT public.t_assert(NOT EXISTS (SELECT FROM public.t_after WHERE who = 'a' AND organization_id = public.t_o(2) AND vehicle_id NOT IN (public.t_v(1), public.t_v(2))), 'the uploader sees assignments on their vehicles only');

-- Contract, grants, setting restored.
SELECT public.t_assert((SELECT ROW(p.proowner, p.proacl, p.prosecdef, p.provolatile, p.proconfig, pg_get_function_result(p.oid))
    IS NOT DISTINCT FROM ROW(o.proowner, o.proacl, o.prosecdef, o.provolatile, o.proconfig, o.result)
  FROM pg_proc p CROSS JOIN original_contract o WHERE p.oid = 'public.get_pending_vehicle_assignments(uuid)'::regprocedure),
  'owner, grants, security, volatility, settings and return shape are unchanged');
SELECT public.t_assert(NOT has_function_privilege('anon', 'public.get_pending_vehicle_assignments(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.get_pending_vehicle_assignments(uuid)', 'EXECUTE'), 'anon still cannot execute it');
DO $$
DECLARE before_setting text := current_setting('enable_indexscan');
BEGIN
  PERFORM count(*) FROM public.get_pending_vehicle_assignments(public.t_u('b'));
  PERFORM public.t_assert(current_setting('enable_indexscan') = before_setting AND before_setting = 'on', 'enable_indexscan is restored after the call');
END $$;
SELECT public.t_assert((SELECT count(*) FROM public.get_pending_vehicle_assignments(NULL)) = 0, 'a NULL caller gets nothing');

-- A second run is a no-op that passes its guard; a drifted function stops the migration and is left as found.
\ir ../migrations/20261014040600_pending_assignments_vehicle_sweep.sql
CREATE OR REPLACE FUNCTION public.get_pending_vehicle_assignments(p_user_id uuid)
  RETURNS TABLE(id uuid, vehicle_name text, organization_name text, relationship_type text, confidence numeric, evidence_sources text[], created_at timestamp with time zone, vehicle_id uuid, organization_id uuid)
  LANGUAGE sql SECURITY DEFINER
  AS $f$ SELECT NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::numeric, NULL::text[], NULL::timestamptz, NULL::uuid, NULL::uuid WHERE false $f$;
\echo 'Expected: the source guard ERROR below, then the aborted transaction ignoring the rest of the file.'
\set ON_ERROR_STOP off
\ir ../migrations/20261014040600_pending_assignments_vehicle_sweep.sql
\set ON_ERROR_STOP on
SELECT public.t_assert((SELECT prosrc FROM pg_proc WHERE oid = 'public.get_pending_vehicle_assignments(uuid)'::regprocedure) LIKE '%WHERE false%', 'a drifted function is not replaced');
SELECT 'pending assignments sweep contract: PASS' AS result;
