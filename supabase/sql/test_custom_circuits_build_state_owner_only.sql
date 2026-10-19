-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_build_state -f supabase/sql/test_custom_circuits_build_state_owner_only.sql
-- Proves 20261014193000_custom_circuits_build_state_owner_only.sql: the owner advances build_state; the public key, an
-- anonymous sign-in, another user and a superseded row cannot; nobody but the service role inserts or deletes; anon reads.
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
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_user::text $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

-- The live shape, as it stood: open update policy, column update grant, leftover table grants.
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, user_id uuid, owner_id uuid, is_public boolean);
CREATE TABLE public.vehicle_wiring_overlays (id uuid PRIMARY KEY, vehicle_id uuid);
CREATE TABLE public.vehicle_custom_circuits (id uuid PRIMARY KEY, overlay_id uuid, circuit_code text, build_state text DEFAULT 'uncut',
  is_superseded boolean DEFAULT false);
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_wiring_overlays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_custom_circuits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read" ON public.vehicles FOR SELECT USING (true);
CREATE POLICY "read" ON public.vehicle_wiring_overlays FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.vehicle_custom_circuits FOR SELECT USING (true);
CREATE POLICY "Service write" ON public.vehicle_custom_circuits USING (auth.role() = 'service_role');
CREATE POLICY "Build state workflow write" ON public.vehicle_custom_circuits FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
GRANT SELECT ON public.vehicles, public.vehicle_wiring_overlays TO anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.vehicle_custom_circuits TO anon, authenticated;
GRANT UPDATE (build_state) ON public.vehicle_custom_circuits TO anon, authenticated;
GRANT ALL ON public.vehicle_custom_circuits TO service_role;

INSERT INTO public.vehicles VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000f00d', NULL, true);
INSERT INTO public.vehicle_wiring_overlays VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1');
INSERT INTO public.vehicle_custom_circuits (id, overlay_id, circuit_code, is_superseded) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', '110', false),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1', '110-old', true);

\i supabase/migrations/20261014193000_custom_circuits_build_state_owner_only.sql

-- The public key: no write at all; reads work, including select *.
SET ROLE anon;
DO $$
DECLARE n int;
BEGIN
  BEGIN
    UPDATE public.vehicle_custom_circuits SET build_state = 'cut' WHERE id = '00000000-0000-0000-0000-0000000000c1';
    RAISE EXCEPTION 'anon updated build_state';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.vehicle_custom_circuits;
    RAISE EXCEPTION 'anon deleted rows';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SELECT count(*) INTO n FROM (SELECT * FROM public.vehicle_custom_circuits) x;
  IF n <> 2 THEN RAISE EXCEPTION 'anon reads % rows', n; END IF;
END $$;
RESET ROLE;

-- Signed in, but not the owner; or the owner's id with an anonymous sign-in; or a superseded row: no row changes.
SET ROLE authenticated;
SELECT set_config('test.auth_uid', '00000000-0000-0000-0000-00000000beef', false), set_config('test.jwt', '{"is_anonymous": false}', false);
DO $$
DECLARE n int;
BEGIN
  UPDATE public.vehicle_custom_circuits SET build_state = 'cut' WHERE id = '00000000-0000-0000-0000-0000000000c1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'another user changed build_state'; END IF;
  BEGIN
    UPDATE public.vehicle_custom_circuits SET circuit_code = 'x' WHERE id = '00000000-0000-0000-0000-0000000000c1';
    RAISE EXCEPTION 'a signed-in user updated another column';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('test.auth_uid', '00000000-0000-0000-0000-00000000f00d', false), set_config('test.jwt', '{"is_anonymous": true}', false);
DO $$
DECLARE n int;
BEGIN
  UPDATE public.vehicle_custom_circuits SET build_state = 'cut' WHERE id = '00000000-0000-0000-0000-0000000000c1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'an anonymous sign-in changed build_state'; END IF;
END $$;

-- The owner, signed in: the live row advances; the superseded one does not.
SELECT set_config('test.jwt', '{"is_anonymous": false}', false);
DO $$
DECLARE n int;
BEGIN
  UPDATE public.vehicle_custom_circuits SET build_state = 'cut' WHERE id = '00000000-0000-0000-0000-0000000000c1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'the owner could not advance build_state'; END IF;
  UPDATE public.vehicle_custom_circuits SET build_state = 'cut' WHERE id = '00000000-0000-0000-0000-0000000000c2';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'a superseded row changed'; END IF;
END $$;
RESET ROLE;

SELECT 'test_custom_circuits_build_state_owner_only: PASS' AS result;
