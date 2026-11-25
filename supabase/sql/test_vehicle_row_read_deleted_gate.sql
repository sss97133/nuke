-- Empty disposable PG17 only:
--   createdb dm_refinement_row_read_deleted; psql -X -v ON_ERROR_STOP=1 -d dm_refinement_row_read_deleted -f this-file.sql
--   (-v mig=<path> runs the contract against another body; the mutation runs use it.)
-- Proves 20261125214500_vehicle_row_read_deleted_gate.sql: a deleted car that is still flagged public answers NULL to
-- anon, a signed-in stranger and a caller with no claims; its owner, a tied contributor and the service role still read
-- it; every other answer is byte-identical. Fixture: the live bodies of vehicle_row_read and its helpers (sha-asserted),
-- vehicles with live column grants and user-id foreign keys, as in test_vehicle_row_projection_withheld_columns.sql.
\set ON_ERROR_STOP on
\if :{?mig}
\else
  \set mig ../migrations/20261125214500_vehicle_row_read_deleted_gate.sql
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
-- 1111 public; 3333 public and deleted (owner bbbb); 2222 private; 5555 private and deleted; 4444 missing.
INSERT INTO public.vehicles (id, is_public, deleted_at, owner_id, uploaded_by, make, model, year) VALUES
  ('11111111-1111-4111-8111-111111111111', true, null, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Fixture', 'Live', 1973),
  ('33333333-3333-4333-8333-333333333333', true, now(), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Fixture', 'Deleted', 1970),
  ('22222222-2222-4222-8222-222222222222', false, null, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Fixture', 'Private', 1971),
  ('55555555-5555-4555-8555-555555555555', false, now(), 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Fixture', 'PrivDel', 1972);
INSERT INTO public.vehicle_contributors (vehicle_id, user_id, status, role) VALUES
  ('33333333-3333-4333-8333-333333333333', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'active', 'mechanic');

CREATE TABLE public.rd_answers (phase text, caller text, vehicle uuid, r jsonb, PRIMARY KEY (phase, caller, vehicle));
GRANT INSERT, SELECT ON public.rd_answers TO anon, authenticated, service_role;
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
    INSERT INTO public.rd_answers SELECT p_phase, c.caller, v.id, public.vehicle_row_read(v.id)
      FROM (VALUES ('11111111-1111-4111-8111-111111111111'::uuid), ('33333333-3333-4333-8333-333333333333'::uuid),
                   ('22222222-2222-4222-8222-222222222222'::uuid), ('55555555-5555-4555-8555-555555555555'::uuid),
                   ('44444444-4444-4444-8444-444444444444'::uuid)) v(id);
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '', false);
END $$;
CREATE FUNCTION pg_temp.ans(p_phase text, p_caller text, p_vehicle uuid) RETURNS jsonb LANGUAGE sql AS
$$ SELECT r FROM public.rd_answers WHERE phase = p_phase AND caller = p_caller AND vehicle = p_vehicle $$;

BEGIN; SELECT pg_temp.capture('before'); COMMIT;
DO $$ BEGIN
  ASSERT pg_temp.ans('before', 'anon', '33333333-3333-4333-8333-333333333333') IS NOT NULL,
    'the defect reproduces on the prior body: anon reads a deleted public car';
END $$;

\ir :mig
\ir :mig
BEGIN; SELECT pg_temp.capture('after'); COMMIT;

DO $$
DECLARE del uuid := '33333333-3333-4333-8333-333333333333'; k text; n int;
BEGIN
  -- 1. Outsiders get NULL for the deleted public car.
  FOREACH k IN ARRAY ARRAY['anon','stranger','noclaims'] LOOP
    ASSERT pg_temp.ans('after', k, del) IS NULL, format('1 %s gets NULL for a deleted public car', k);
  END LOOP;
  -- 2. Insiders still read it, unchanged.
  FOREACH k IN ARRAY ARRAY['owner','contributor','service'] LOOP
    ASSERT pg_temp.ans('after', k, del) IS NOT NULL AND pg_temp.ans('after', k, del) = pg_temp.ans('before', k, del),
      format('2 %s still reads the deleted car', k);
  END LOOP;
  -- 3. The live public car reads as before for everyone; private, private-deleted and missing stay NULL for outsiders.
  ASSERT pg_temp.ans('after', 'anon', '11111111-1111-4111-8111-111111111111')->>'model' = 'Live', '3 anon reads the live public car';
  FOREACH k IN ARRAY ARRAY['anon','stranger','noclaims'] LOOP
    ASSERT pg_temp.ans('after', k, '22222222-2222-4222-8222-222222222222') IS NULL, format('3 %s private NULL', k);
    ASSERT pg_temp.ans('after', k, '55555555-5555-4555-8555-555555555555') IS NULL, format('3 %s private deleted NULL', k);
    ASSERT pg_temp.ans('after', k, '44444444-4444-4444-8444-444444444444') IS NULL, format('3 %s missing NULL', k);
  END LOOP;
  -- 4. Nothing else changed: every answer except an outsider's on the deleted public car is byte-identical.
  SELECT count(*) INTO n FROM public.rd_answers a JOIN public.rd_answers b USING (caller, vehicle)
   WHERE a.phase = 'after' AND b.phase = 'before' AND a.r IS DISTINCT FROM b.r
     AND NOT (a.vehicle = del AND a.caller IN ('anon','stranger','noclaims'));
  ASSERT n = 0, format('4 %s other answers changed', n);
END $$;
SELECT 'PASS: vehicle_row_read answers NULL to outsiders for a deleted car' AS result;
