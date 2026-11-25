-- Empty disposable PG17 only:
--   createdb dm_refinement_plates; psql -X -v ON_ERROR_STOP=1 -d dm_refinement_plates -f this-file.sql
--   (-v pmig=<path> runs the contract against another body; the mutation runs use it.)
-- Proves 20261125224500_vehicle_plates_read.sql: the plate goes to the service role and to a car's insiders
-- (owner_id, user_id, created_by_user_id, uploaded_by, tied by vehicle_user_has_access) on public, private and deleted
-- cars alike; a signed-in stranger, an untied contributor role and a no-claims caller get no row; anon cannot execute;
-- at most 500 ids are read. Fixture: the live-catalog vehicles table and vehicle_user_has_access body.
\set ON_ERROR_STOP on
\if :{?pmig}
\else
  \set pmig ../migrations/20261125224500_vehicle_plates_read.sql
\endif
\ir helpers/get_vehicle_profile_data_fixture_20261125.sql

-- Fixture rows in an empty disposable PG17 database, never production. Plates are made-up tokens.
INSERT INTO auth.users (id) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), ('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd'), ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'), ('ffffffff-ffff-4fff-8fff-ffffffffffff'),
  ('99999999-9999-4999-8999-999999999999');
INSERT INTO public.profiles (id) SELECT id FROM auth.users;
INSERT INTO public.vehicles (id, is_public, deleted_at, owner_id, user_id, created_by_user_id, uploaded_by, license_plate) VALUES
  ('11111111-1111-4111-8111-111111111111', true,  null,         'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', null, null, null, 'PLATE-PUB'),
  ('22222222-2222-4222-8222-222222222222', false, null,         null, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', null, null, 'PLATE-PRIV'),
  ('33333333-3333-4333-8333-333333333333', true,  '2026-01-01', null, null, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', null, 'PLATE-DEL'),
  ('44444444-4444-4444-8444-444444444444', false, null,         null, null, null, 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'PLATE-UPL'),
  ('55555555-5555-4555-8555-555555555555', true,  null,         'cccccccc-cccc-4ccc-8ccc-cccccccccccc', null, null, null, null);
INSERT INTO public.vehicle_contributors (id, vehicle_id, user_id, status, role) VALUES
  (gen_random_uuid(), '22222222-2222-4222-8222-222222222222', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'active', 'mechanic'),
  (gen_random_uuid(), '11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999', 'active', 'viewer');

-- Prod's default privileges for functions postgres creates in public (pg_default_acl, read 2026-11-25): postgres and
-- service_role only, nothing to PUBLIC, anon or authenticated.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
\ir :pmig
\ir :pmig

-- What a caller reads, as 'vehicle-suffix=plate' sorted, through PostgREST's role.
CREATE FUNCTION pg_temp.plates(p_uid text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  PERFORM public.t_claims(p_uid);
  -- anon cannot execute the reader (case 3), so anon claims are tried under the authenticated role here.
  EXECUTE format('SET LOCAL ROLE %I', CASE WHEN p_uid = 'service' THEN 'service_role' ELSE 'authenticated' END);
  SELECT coalesce(string_agg(left(vehicle_id::text, 1) || '=' || coalesce(license_plate, 'null'), ',' ORDER BY vehicle_id), '')
    INTO r FROM public.vehicle_plates_read(ARRAY['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666']::uuid[]);
  RESET ROLE;
  RETURN r;
END $$;

BEGIN;
DO $$ BEGIN
  -- 1. Insiders read the plate on public, private and deleted cars; a car with no plate reads null.
  ASSERT pg_temp.plates('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') = '1=PLATE-PUB,2=PLATE-PRIV', '1 owner_id and user_id';
  ASSERT pg_temp.plates('dddddddd-dddd-4ddd-8ddd-dddddddddddd') = '2=PLATE-PRIV', '1 tied mechanic on a private car';
  ASSERT pg_temp.plates('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') = '3=PLATE-DEL', '1 created_by_user_id on a deleted car';
  ASSERT pg_temp.plates('ffffffff-ffff-4fff-8fff-ffffffffffff') = '4=PLATE-UPL', '1 uploaded_by';
  ASSERT pg_temp.plates('cccccccc-cccc-4ccc-8ccc-cccccccccccc') = '5=null', '1 owner of a car with no plate';
  ASSERT pg_temp.plates('service') = '1=PLATE-PUB,2=PLATE-PRIV,3=PLATE-DEL,4=PLATE-UPL,5=null', '1 service role reads all';
  -- 2. No one else reads a plate, public car or not.
  ASSERT pg_temp.plates('99999999-9999-4999-8999-999999999999') = '', '2 untied contributor role (viewer) reads none';
  ASSERT pg_temp.plates('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = '', '2 signed-in stranger reads none';
  ASSERT pg_temp.plates('none') = '', '2 no claims reads none';
  ASSERT pg_temp.plates('') = '', '2 anon claims (as authenticated role) read none';
END $$;
COMMIT;

-- 3. anon cannot execute it.
DO $$ BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.vehicle_plates_read(uuid[])', 'EXECUTE'), '3 anon cannot execute';
  ASSERT NOT has_function_privilege('public', 'public.vehicle_plates_read(uuid[])', 'EXECUTE'), '3 PUBLIC cannot execute';
END $$;

-- 4. At most 500 ids are read: the owner's car at position 501 returns nothing.
DO $$ DECLARE n int; BEGIN
  PERFORM public.t_claims('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  SELECT count(*) INTO n FROM public.vehicle_plates_read(
    array_cat(array_fill('66666666-6666-4666-8666-666666666666'::uuid, ARRAY[500]), ARRAY['11111111-1111-4111-8111-111111111111'::uuid]));
  ASSERT n = 0, '4 id 501 is not read';
  SELECT count(*) INTO n FROM public.vehicle_plates_read(
    array_cat(array_fill('66666666-6666-4666-8666-666666666666'::uuid, ARRAY[499]), ARRAY['11111111-1111-4111-8111-111111111111'::uuid]));
  ASSERT n = 1, '4 id 500 is read';
  PERFORM set_config('request.jwt.claims', '', false);
END $$;
SELECT 'PASS: vehicle_plates_read returns plates to insiders only' AS result;
