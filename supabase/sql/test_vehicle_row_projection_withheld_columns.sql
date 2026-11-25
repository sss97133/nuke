-- Empty disposable PG17 only:
--   createdb dm_refinement_row_projection; psql -X -v ON_ERROR_STOP=1 -d dm_refinement_row_projection -f this-file.sql
--   (-v mig=<path> runs the contract against another body; the mutation runs use it.)
-- Proves 20261125202000_vehicle_row_projection_withheld_columns.sql: vehicle_row_read (and get_vehicle_profile_data,
-- which calls the same projection) hands a caller who is not an insider no vehicles column that caller's role cannot
-- SELECT; the five fixed masks, the contact redaction and the insider's whole row are unchanged; a REVOKE closes a
-- column with no function change.
-- Live bodies (read 2026-11-25): vehicle_row_read, vehicle_row_public_projection, jsonb_mask_keys,
-- text_redact_contact, vehicle_user_has_access and its tables. vehicles carries the live types, column grants and
-- user-id foreign keys of the columns read here (profiles FKs omitted: no profiles table in this fixture).
\set ON_ERROR_STOP on
\if :{?mig}
\else
  \set mig ../migrations/20261125202000_vehicle_row_projection_withheld_columns.sql
\endif
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
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
  user_id uuid, owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE CASCADE, created_by_user_id uuid,
  make text, model text, year integer, description text, origin_metadata jsonb,
  license_plate text, odometer_reading integer, numbers_quote text, source_listing_key text,
  owner_name text, owner_contact text, purchase_price numeric(10,2), purchase_date date, purchase_location text);
-- Column grants as live (has_column_privilege, 2026-11-25) for these columns.
GRANT SELECT (id, is_public, deleted_at, user_id, owner_id, uploaded_by, created_by_user_id, make, model, year,
  description, origin_metadata) ON public.vehicles TO anon, authenticated;
GRANT SELECT (license_plate) ON public.vehicles TO authenticated;
GRANT SELECT ON public.vehicles TO service_role;
CREATE TABLE public.admin_users (user_id uuid REFERENCES auth.users(id), is_active boolean);
CREATE TABLE public.ownership_verifications (vehicle_id uuid REFERENCES public.vehicles(id), user_id uuid REFERENCES auth.users(id), status text);
CREATE TABLE public.vehicle_user_permissions (vehicle_id uuid REFERENCES public.vehicles(id), user_id uuid REFERENCES auth.users(id), is_active boolean, role text, granted_by uuid);
CREATE TABLE public.vehicle_contributors (vehicle_id uuid REFERENCES public.vehicles(id), user_id uuid REFERENCES auth.users(id), status text, role text);
CREATE TABLE public.organization_vehicles (organization_id uuid, vehicle_id uuid REFERENCES public.vehicles(id), relationship_type text, status text, linked_by_user_id uuid);
CREATE TABLE public.organization_contributors (organization_id uuid, user_id uuid REFERENCES auth.users(id), status text, role text);

CREATE OR REPLACE FUNCTION public.text_redact_contact(p_text text)
 RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO ''
AS $function$
  SELECT regexp_replace(regexp_replace(p_text,
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}', '[contact through Nuke]', 'g'),
    '(\(\d{3}\)|\m\d{3})[-. )]*\d{3}[-. ]*\d{4}(?![0-9])', '[contact through Nuke]', 'g')
$function$;
CREATE OR REPLACE FUNCTION public.jsonb_mask_keys(j jsonb, p_keys text[])
 RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO ''
AS $function$
  SELECT CASE jsonb_typeof(j)
    WHEN 'object' THEN coalesce((
      SELECT jsonb_object_agg(e.k, CASE WHEN e.k = ANY (p_keys) THEN 'null'::jsonb ELSE public.jsonb_mask_keys(e.v, p_keys) END)
      FROM jsonb_each(j) AS e(k, v)), '{}'::jsonb)
    WHEN 'array' THEN coalesce((
      SELECT jsonb_agg(public.jsonb_mask_keys(a.e, p_keys) ORDER BY a.o)
      FROM jsonb_array_elements(j) WITH ORDINALITY AS a(e, o)), '[]'::jsonb)
    ELSE j END;
$function$;
CREATE OR REPLACE FUNCTION public.vehicle_row_public_projection(p_row jsonb)
 RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO ''
AS $function$
  SELECT CASE WHEN jsonb_typeof(m.j -> 'description') = 'string'
              THEN jsonb_set(m.j, '{description}', to_jsonb(public.text_redact_contact(m.j ->> 'description')))
              ELSE m.j END
  FROM (SELECT CASE WHEN jsonb_typeof(r.j -> 'origin_metadata') IN ('object', 'array')
                    THEN jsonb_set(r.j, '{origin_metadata}', regexp_replace((r.j -> 'origin_metadata')::text,
                           '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}', '[contact through Nuke]', 'g')::jsonb)
                    ELSE r.j END AS j
        FROM (SELECT public.jsonb_mask_keys(p_row, ARRAY['purchase_price', 'purchase_date', 'purchase_location', 'owner_name', 'owner_contact']) AS j) r) m
$function$;
CREATE OR REPLACE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
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
CREATE OR REPLACE FUNCTION public.vehicle_row_read(p_vehicle_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row jsonb;
  v_public boolean;
  v_insider boolean;
BEGIN
  SELECT to_jsonb(v.*),
         coalesce(v.is_public, false),
         coalesce(auth.role() = 'service_role', false)
           OR (v_uid IS NOT NULL AND (coalesce(v_uid IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by), false)
                                     OR public.vehicle_user_has_access(v.id, v_uid)))
    INTO v_row, v_public, v_insider
  FROM public.vehicles v
  WHERE v.id = p_vehicle_id;
  IF v_row IS NULL OR NOT (v_public OR v_insider) THEN
    RETURN NULL;
  END IF;
  IF v_insider THEN
    RETURN v_row;
  END IF;
  RETURN public.vehicle_row_public_projection(v_row);
END;
$function$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
DO $$ BEGIN
  ASSERT (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
          WHERE oid = 'public.vehicle_row_public_projection(jsonb)'::regprocedure)
    = 'a7a24cb218d880a3879505453e90114a58d52eaeeb09bbddf9c08bf6be7de1ca', 'fixture projection is the live one';
  ASSERT (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
          WHERE oid = 'public.vehicle_row_read(uuid)'::regprocedure)
    = '39f79cb8301139eedafa9d0ec9b2e73bc920484dc1149c116df4401d58b4c795', 'fixture vehicle_row_read is the live one';
END $$;

INSERT INTO auth.users (id) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), ('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
INSERT INTO public.vehicles (id, is_public, owner_id, uploaded_by, make, model, year, description, origin_metadata,
  license_plate, odometer_reading, numbers_quote, source_listing_key, owner_name, owner_contact, purchase_price,
  purchase_date, purchase_location) VALUES
  ('11111111-1111-4111-8111-111111111111', true, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'Fixture', 'Car', 1973, 'call 702-555-0123 or a@example.invalid', '{"seller":"b@example.invalid","n":1}',
   'FIXTURE1', 12345, 'fixture quote', 'fixture-key', 'fixture owner', 'fixture contact', 1, '2020-01-01', 'fixture place'),
  ('22222222-2222-4222-8222-222222222222', false, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'Fixture', 'Private', 1970, null, null, 'FIXTURE2', 1, null, null, null, null, null, null, null);
INSERT INTO public.vehicle_contributors (vehicle_id, user_id, status, role) VALUES
  ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'active', 'mechanic');

-- What each caller reads, before and after: anon, a signed-in stranger (cccc), the owner (bbbb), a contributor with
-- access (dddd), the service role, and a caller with no claims at all (counts as anon).
CREATE TABLE public.rp_answers (phase text, caller text, vehicle uuid, r jsonb, PRIMARY KEY (phase, caller, vehicle));
GRANT INSERT, SELECT ON public.rp_answers TO anon, authenticated, service_role;
CREATE FUNCTION pg_temp.capture(p_phase text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES ('anon', '', 'anon'), ('stranger', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'authenticated'),
      ('owner', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'authenticated'),
      ('contributor', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'authenticated'), ('service', 'service', 'service_role'),
      ('noclaims', 'none', 'postgres')) x(caller, uid, role_name)
  LOOP
    IF c.uid = 'none' THEN PERFORM set_config('request.jwt.claims', '', false); ELSE PERFORM public.t_claims(c.uid); END IF;
    EXECUTE format('SET LOCAL ROLE %I', c.role_name);
    INSERT INTO public.rp_answers SELECT p_phase, c.caller, v.id, public.vehicle_row_read(v.id)
      FROM (VALUES ('11111111-1111-4111-8111-111111111111'::uuid), ('22222222-2222-4222-8222-222222222222'::uuid),
                   ('44444444-4444-4444-8444-444444444444'::uuid)) v(id);
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', false);
END $$;
CREATE FUNCTION pg_temp.ans(p_phase text, p_caller text, p_vehicle uuid) RETURNS jsonb LANGUAGE sql AS
$$ SELECT r FROM public.rp_answers WHERE phase = p_phase AND caller = p_caller AND vehicle = p_vehicle $$;

BEGIN; SELECT pg_temp.capture('before'); COMMIT;
DO $$ BEGIN
  ASSERT pg_temp.ans('before', 'anon', '11111111-1111-4111-8111-111111111111')->>'license_plate' = 'FIXTURE1',
    'the defect reproduces on the prior body: anon reads license_plate through vehicle_row_read';
END $$;

\ir :mig
\ir :mig
BEGIN; SELECT pg_temp.capture('after'); COMMIT;

DO $$
DECLARE pub uuid := '11111111-1111-4111-8111-111111111111'; r jsonb; k text; n int;
BEGIN
  -- 1. anon: every column anon cannot select is null; granted columns are kept.
  r := pg_temp.ans('after', 'anon', pub);
  FOREACH k IN ARRAY ARRAY['license_plate','odometer_reading','numbers_quote','source_listing_key','owner_name',
                           'owner_contact','purchase_price','purchase_date','purchase_location'] LOOP
    ASSERT r ? k AND r->k = 'null'::jsonb, format('1 anon %s is null', k);
  END LOOP;
  ASSERT r->>'make' = 'Fixture' AND r->>'year' = '1973' AND r->>'id' = pub::text, '1 anon granted columns kept';
  ASSERT r::text NOT LIKE '%FIXTURE1%' AND r::text NOT LIKE '%fixture quote%' AND r::text NOT LIKE '%fixture-key%',
    '1 anon carries no withheld value text';

  r := pg_temp.ans('after', 'noclaims', pub);
  ASSERT r->'license_plate' = 'null'::jsonb AND r->'odometer_reading' = 'null'::jsonb, '1 a caller with no claims reads as anon';

  -- 2. A signed-in stranger reads what the authenticated grants allow (license_plate today) and no more.
  r := pg_temp.ans('after', 'stranger', pub);
  ASSERT r->>'license_plate' = 'FIXTURE1', '2 stranger license_plate (granted to authenticated)';
  ASSERT r->'odometer_reading' = 'null'::jsonb AND r->'numbers_quote' = 'null'::jsonb
     AND r->'source_listing_key' = 'null'::jsonb AND r->'owner_name' = 'null'::jsonb, '2 stranger denied columns null';

  -- 3. Insiders and the service role read the whole row, unchanged.
  FOREACH k IN ARRAY ARRAY['owner','contributor','service'] LOOP
    ASSERT pg_temp.ans('after', k, pub) = pg_temp.ans('before', k, pub), format('3 %s whole row unchanged', k);
    ASSERT pg_temp.ans('after', k, pub)->>'license_plate' = 'FIXTURE1', format('3 %s reads the plate', k);
  END LOOP;

  -- 4. The existing masks and redaction still hold, and the private / missing car is still NULL for outsiders.
  r := pg_temp.ans('after', 'anon', pub);
  ASSERT r->>'description' NOT LIKE '%555-0123%' AND r->>'description' NOT LIKE '%@example.invalid%', '4 description redacted';
  ASSERT (r->'origin_metadata')::text NOT LIKE '%@example.invalid%' AND r->'origin_metadata'->>'n' = '1', '4 origin_metadata redacted, kept';
  ASSERT pg_temp.ans('after', 'anon', '22222222-2222-4222-8222-222222222222') IS NULL, '4 anon private car NULL';
  ASSERT pg_temp.ans('after', 'stranger', '22222222-2222-4222-8222-222222222222') IS NULL, '4 stranger private car NULL';
  ASSERT pg_temp.ans('after', 'anon', '44444444-4444-4444-8444-444444444444') IS NULL, '4 missing car NULL';

  -- 5. The only change: a non-insider's denied keys turned null; the key set is identical.
  SELECT count(*) INTO n FROM public.rp_answers a JOIN public.rp_answers b USING (caller, vehicle)
   WHERE a.phase = 'after' AND b.phase = 'before' AND a.r IS DISTINCT FROM b.r
     AND NOT (a.caller IN ('anon','stranger','noclaims')
       AND (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(a.r) x) = (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(b.r) x)
       AND NOT EXISTS (SELECT 1 FROM jsonb_each(a.r) e WHERE e.value IS DISTINCT FROM b.r->e.key
         AND NOT (e.value = 'null'::jsonb AND NOT has_column_privilege(CASE a.caller WHEN 'stranger' THEN 'authenticated' ELSE 'anon' END,
               'public.vehicles', e.key, 'SELECT'))));
  ASSERT n = 0, format('5 %s answers changed beyond nulling a denied column', n);
  RAISE NOTICE 'PASS 1-5';
END $$;

-- 6. The grants are read at call time: REVOKE license_plate from authenticated closes it for the stranger with no
-- function change; the owner still reads it; GRANT restores it.
CREATE TEMP TABLE rp_body AS SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') AS sha FROM pg_proc
 WHERE oid = 'public.vehicle_row_public_projection(jsonb)'::regprocedure;
REVOKE SELECT (license_plate) ON public.vehicles FROM authenticated;
BEGIN;
SELECT public.t_claims('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT public.vehicle_row_read('11111111-1111-4111-8111-111111111111')->'license_plate' = 'null'::jsonb,
    '6 revoked license_plate is null for a stranger';
END $$;
RESET ROLE;
SELECT public.t_claims('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT public.vehicle_row_read('11111111-1111-4111-8111-111111111111')->>'license_plate' = 'FIXTURE1',
    '6 the owner still reads the plate after the revoke';
END $$;
COMMIT;
GRANT SELECT (license_plate) ON public.vehicles TO authenticated;
DO $$ BEGIN
  ASSERT (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
          WHERE oid = 'public.vehicle_row_public_projection(jsonb)'::regprocedure) = (SELECT sha FROM rp_body), '6 function unchanged';
END $$;
SELECT 'PASS: vehicle_row_public_projection nulls every column the caller cannot select' AS result;
