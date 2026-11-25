-- Disposable PG17 contract for 20261124211500_vehicle_total_invested_mask (vehicle_spend_viewer_v1). Synthetic rows only.
-- The spend computation is stubbed with the live return shape; the migration is applied twice. Asserts:
--   * an untied caller on a public vehicle gets documented_spend present/none and counts, never an amount;
--   * an untied caller on a private or deleted vehicle gets null;
--   * the vehicle's owner, a granted user and the service role get the amounts, with amounts_visible true;
--   * the computation is kept as get_vehicle_total_invested_unmasked, executable by service_role only;
--   * a second run changes nothing.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.role', true), '') $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE FUNCTION public.assert(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION 'contract failed: %', what; END IF; END $$;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, owner_id uuid, user_id uuid, created_by_user_id uuid, uploaded_by uuid,
  is_public boolean, deleted_at timestamptz);
CREATE TABLE public.access_grants (vehicle_id uuid, user_id uuid);
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle uuid, p_user uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT EXISTS (SELECT 1 FROM public.access_grants g WHERE g.vehicle_id = p_vehicle AND g.user_id = p_user) $$;
CREATE TABLE public.spend (vehicle_id uuid PRIMARY KEY, amount numeric, n int);

-- The live signature and return shape (2026-11-24): SECURITY DEFINER, anon may execute.
CREATE FUNCTION public.get_vehicle_total_invested(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object('total_invested', coalesce(s.amount, 0),
           'breakdown', jsonb_build_object('parts', 0, 'labor', 0, 'receipts', coalesce(s.amount, 0)),
           'components_count', jsonb_build_object('receipts', coalesce(s.n, 0)))
    FROM (SELECT p_vehicle_id AS id) x LEFT JOIN public.spend s ON s.vehicle_id = x.id
$$;
GRANT EXECUTE ON FUNCTION public.get_vehicle_total_invested(uuid) TO anon, authenticated, service_role;

INSERT INTO public.vehicles VALUES
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', NULL, NULL, NULL, true, NULL),   -- public, spend
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f1', NULL, NULL, NULL, true, NULL),   -- public, none
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000f1', NULL, NULL, NULL, false, NULL),  -- private
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000f1', NULL, NULL, NULL, true, now());  -- deleted
INSERT INTO public.spend VALUES ('00000000-0000-0000-0000-0000000000a1', 4321.09, 3), ('00000000-0000-0000-0000-0000000000a3', 777, 1),
                                ('00000000-0000-0000-0000-0000000000a4', 555, 1);
INSERT INTO public.access_grants VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f2');

\ir ../migrations/20261124211500_vehicle_total_invested_mask.sql

-- Logged out.
SELECT set_config('test.role', 'anon', false), set_config('test.uid', '', false);
SELECT public.assert(public.get_vehicle_total_invested('00000000-0000-0000-0000-0000000000a1')
                     = '{"amounts_visible": false, "documented_spend": "present", "total_invested": null, "breakdown": null, "components_count": {"receipts": 3}}'::jsonb,
                     'anon on a public vehicle: presence and counts only');
SELECT public.assert(public.get_vehicle_total_invested('00000000-0000-0000-0000-0000000000a1')::text !~ '4321',
                     'anon never receives the amount');
SELECT public.assert(public.get_vehicle_total_invested('00000000-0000-0000-0000-0000000000a2') ->> 'documented_spend' = 'none',
                     'anon on a public vehicle without spend: none');
SELECT public.assert(public.get_vehicle_total_invested('00000000-0000-0000-0000-0000000000a3') IS NULL, 'anon on a private vehicle: null');
SELECT public.assert(public.get_vehicle_total_invested('00000000-0000-0000-0000-0000000000a4') IS NULL, 'anon on a deleted vehicle: null');
SELECT public.assert(public.get_vehicle_total_invested('00000000-0000-0000-0000-0000000000ff') IS NULL, 'unknown vehicle: null');

-- A signed-in stranger.
SELECT set_config('test.role', 'authenticated', false), set_config('test.uid', '00000000-0000-0000-0000-0000000000f9', false);
SELECT public.assert(public.get_vehicle_total_invested('00000000-0000-0000-0000-0000000000a1') ->> 'total_invested' IS NULL,
                     'signed-in stranger: no amount');

-- The owner, a granted user, the service role.
SELECT set_config('test.role', 'authenticated', false), set_config('test.uid', '00000000-0000-0000-0000-0000000000f1', false);
SELECT public.assert((public.get_vehicle_total_invested('00000000-0000-0000-0000-0000000000a1') ->> 'total_invested')::numeric = 4321.09
                     AND (public.get_vehicle_total_invested('00000000-0000-0000-0000-0000000000a1') ->> 'amounts_visible')::boolean,
                     'owner keeps the amount');
SELECT public.assert((public.get_vehicle_total_invested('00000000-0000-0000-0000-0000000000a3') ->> 'total_invested')::numeric = 777,
                     'owner keeps the amount on a private vehicle');
SELECT set_config('test.uid', '00000000-0000-0000-0000-0000000000f2', false);
SELECT public.assert((public.get_vehicle_total_invested('00000000-0000-0000-0000-0000000000a1') ->> 'total_invested')::numeric = 4321.09,
                     'granted user keeps the amount');
SELECT set_config('test.role', 'service_role', false), set_config('test.uid', '', false);
SELECT public.assert((public.get_vehicle_total_invested('00000000-0000-0000-0000-0000000000a1') #>> '{breakdown,receipts}')::numeric = 4321.09,
                     'service role keeps the breakdown');

-- Grants.
SELECT set_config('test.role', '', false), set_config('test.uid', '', false);
SELECT public.assert(NOT has_function_privilege('anon', 'public.get_vehicle_total_invested_unmasked(uuid)', 'EXECUTE')
                     AND NOT has_function_privilege('authenticated', 'public.get_vehicle_total_invested_unmasked(uuid)', 'EXECUTE')
                     AND has_function_privilege('service_role', 'public.get_vehicle_total_invested_unmasked(uuid)', 'EXECUTE')
                     AND has_function_privilege('anon', 'public.get_vehicle_total_invested(uuid)', 'EXECUTE'),
                     'unmasked is service_role only; the wrapper is public');

-- A second run changes nothing.
CREATE TEMP TABLE first_run AS SELECT pg_get_functiondef('public.get_vehicle_total_invested(uuid)'::regprocedure) w,
  pg_get_functiondef('public.get_vehicle_total_invested_unmasked(uuid)'::regprocedure) u;
\ir ../migrations/20261124211500_vehicle_total_invested_mask.sql
SELECT public.assert((SELECT w = pg_get_functiondef('public.get_vehicle_total_invested(uuid)'::regprocedure)
                         AND u = pg_get_functiondef('public.get_vehicle_total_invested_unmasked(uuid)'::regprocedure) FROM first_run),
                     'second run changes nothing');

-- The revert restores the original function, unmasked, and the migration applies again after it.
\ir revert_20261124211500_vehicle_total_invested_mask.sql
SELECT public.assert(to_regprocedure('public.get_vehicle_total_invested_unmasked(uuid)') IS NULL
                     AND position('spend' IN pg_get_functiondef('public.get_vehicle_total_invested(uuid)'::regprocedure)) > 0,
                     'revert restores the computation under its name');
\ir ../migrations/20261124211500_vehicle_total_invested_mask.sql

SELECT 'test_vehicle_total_invested_mask: ok';
