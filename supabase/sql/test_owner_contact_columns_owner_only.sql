-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_owner_contact -f this-file.sql
-- Proves that after 20261014160500_owner_contact_columns_owner_only.sql a vehicle's owner_name and owner_contact
-- are owner-only: anon and authenticated can no longer SELECT the two columns (every other column stays readable),
-- and vehicle_row_read nulls them for a non-insider while an insider still reads them. Starts from the live reader
-- bodies (helpers/owner_contact_readers_live_20261014.sql) and the post-#1175 grant state (table SELECT revoked,
-- every column granted), and shows the leak there first. get_vehicle_profile_data references tables this fixture
-- does not create, so its change is checked at the body level (the mask now names the two columns).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_role', true), '') $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT jsonb_build_object('role', nullif(current_setting('test.auth_role', true), '')) $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='veh_owner') THEN CREATE ROLE veh_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role, veh_owner;
GRANT CREATE ON SCHEMA public TO veh_owner;

SET ROLE veh_owner;
-- vehicles with the columns the readers touch, owned by a non-superuser like production.
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY,
  make text,
  is_public boolean,
  owner_id uuid, user_id uuid, uploaded_by uuid, created_by_user_id uuid,
  owner_name text, owner_contact text,
  purchase_price numeric, purchase_date date, purchase_location text
);
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_public_read ON public.vehicles FOR SELECT USING (coalesce(is_public, false));
CREATE POLICY vehicles_service ON public.vehicles FOR ALL TO service_role USING (true) WITH CHECK (true);
-- The live grant state, privilege for privilege (relacl and attacl read 2026-10-14; section 0 checks them): after #1175
-- anon and authenticated hold awdDxt on the table but no table-wide SELECT, SELECT on every column except the three
-- money columns (so owner_name and owner_contact are readable until this migration); the service role holds arwdDxt;
-- nothing is granted to PUBLIC.
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.vehicles TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.vehicles TO service_role;
GRANT SELECT (id, make, is_public, owner_id, user_id, uploaded_by, created_by_user_id, owner_name, owner_contact)
  ON public.vehicles TO anon, authenticated;
CREATE FUNCTION public.jsonb_mask_keys(j jsonb, p_keys text[]) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO '' AS $fn$
  SELECT CASE jsonb_typeof(j)
    WHEN 'object' THEN coalesce((SELECT jsonb_object_agg(e.k, CASE WHEN e.k = ANY (p_keys) THEN 'null'::jsonb ELSE public.jsonb_mask_keys(e.v, p_keys) END) FROM jsonb_each(j) AS e(k,v)), '{}'::jsonb)
    WHEN 'array' THEN coalesce((SELECT jsonb_agg(public.jsonb_mask_keys(a.e, p_keys) ORDER BY a.o) FROM jsonb_array_elements(j) WITH ORDINALITY AS a(e,o)), '[]'::jsonb)
    ELSE j END; $fn$;
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle uuid, p_user uuid) RETURNS boolean LANGUAGE sql STABLE AS $fn$ SELECT false $fn$;
\ir helpers/owner_contact_readers_live_20261014.sql
-- Live proacl for all four: anon, authenticated and service_role EXECUTE, no PUBLIC.
REVOKE EXECUTE ON FUNCTION public.vehicle_row_read(uuid), public.get_vehicle_profile_data(uuid),
  public.jsonb_mask_keys(jsonb, text[]), public.vehicle_user_has_access(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_row_read(uuid), public.get_vehicle_profile_data(uuid),
  public.jsonb_mask_keys(jsonb, text[]), public.vehicle_user_has_access(uuid, uuid) TO anon, authenticated, service_role;
RESET ROLE;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
CREATE FUNCTION public.t_refused(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean,text), public.t_refused(text) TO anon, authenticated, service_role;

-- A table's or function's ACL as grantee:privileges, owner left out and grantor ignored, so the fixture (owned by
-- veh_owner) and production (owned by postgres) compare. PUBLIC is grantee 0.
CREATE FUNCTION public.t_acl(p_acl aclitem[], p_owner oid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(g || ':' || privs, ';' ORDER BY g) FROM (
    SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS g,
           string_agg(a.privilege_type, ',' ORDER BY a.privilege_type) AS privs
    FROM aclexplode(p_acl) a WHERE a.grantee <> p_owner GROUP BY 1) x $$;

-- 0. The fixture's grants are production's (read 2026-10-14): the table ACL, the column ACLs of the twelve modeled
--    columns, and the four functions' ACLs.
SELECT public.t_assert(public.t_acl(c.relacl, c.relowner) = 'anon:DELETE,INSERT,REFERENCES,TRIGGER,TRUNCATE,UPDATE;authenticated:DELETE,INSERT,REFERENCES,TRIGGER,TRUNCATE,UPDATE;service_role:DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE',
  'fixture: vehicles table ACL as live') FROM pg_class c WHERE c.oid = 'public.vehicles'::regclass;
SELECT public.t_assert((
  SELECT string_agg(col || '=' || coalesce(gr, '-'), ';' ORDER BY col) FROM (
    SELECT a.attname AS col,
           (SELECT string_agg(CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END || ':' || x.privilege_type, ',' ORDER BY 1)
            FROM aclexplode(a.attacl) x WHERE x.grantee <> c.relowner) AS gr
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    WHERE c.oid = 'public.vehicles'::regclass AND a.attnum > 0 AND NOT a.attisdropped) z)
  = 'created_by_user_id=anon:SELECT,authenticated:SELECT;id=anon:SELECT,authenticated:SELECT;is_public=anon:SELECT,authenticated:SELECT;make=anon:SELECT,authenticated:SELECT;owner_contact=anon:SELECT,authenticated:SELECT;owner_id=anon:SELECT,authenticated:SELECT;owner_name=anon:SELECT,authenticated:SELECT;purchase_date=-;purchase_location=-;purchase_price=-;uploaded_by=anon:SELECT,authenticated:SELECT;user_id=anon:SELECT,authenticated:SELECT',
  'fixture: vehicles column ACLs as live');
SELECT public.t_assert(public.t_acl(p.proacl, p.proowner) = 'anon:EXECUTE;authenticated:EXECUTE;service_role:EXECUTE',
  format('fixture: %s ACL as live', p.oid::regprocedure))
FROM pg_proc p WHERE p.oid IN ('public.vehicle_row_read(uuid)'::regprocedure, 'public.get_vehicle_profile_data(uuid)'::regprocedure,
  'public.jsonb_mask_keys(jsonb, text[])'::regprocedure, 'public.vehicle_user_has_access(uuid, uuid)'::regprocedure);

-- Seeds: V1 public, owned by O1, with a third party's name and contact. V2 private.
INSERT INTO public.vehicles (id, make, is_public, owner_id, owner_name, owner_contact, purchase_price) VALUES
 ('10000000-0000-0000-0000-000000000001', 'Porsche', true, '20000000-0000-0000-0000-0000000000a1', 'Jane Seller', 'jane@example.com', 42000),
 ('10000000-0000-0000-0000-000000000002', 'BMW', false, '20000000-0000-0000-0000-0000000000a1', 'Jane Seller', '555-0100', 15000);

-- 1. Before: anon reads the two columns, and vehicle_row_read leaks them to a non-insider.
SET ROLE anon;
SET test.auth_uid = ''; SET test.auth_role = 'anon';
SELECT public.t_assert((SELECT owner_name FROM public.vehicles WHERE id='10000000-0000-0000-0000-000000000001') = 'Jane Seller', 'before: anon reads owner_name');
SELECT public.t_assert((SELECT owner_contact FROM public.vehicles WHERE id='10000000-0000-0000-0000-000000000001') = 'jane@example.com', 'before: anon reads owner_contact');
SELECT public.t_assert((public.vehicle_row_read('10000000-0000-0000-0000-000000000001') ->> 'owner_name') = 'Jane Seller', 'before: vehicle_row_read leaks owner_name to the public');
RESET ROLE;

-- 2. Apply the migration as the table/function owner, twice (the second run is a no-op).
SET test.auth_uid = ''; SET test.auth_role = '';
SET ROLE veh_owner;
\ir ../migrations/20261014160500_owner_contact_columns_owner_only.sql
\ir ../migrations/20261014160500_owner_contact_columns_owner_only.sql
RESET ROLE;

-- 3. After: anon and authenticated cannot select the two columns; make stays readable.
SET ROLE anon;
SET test.auth_role = 'anon';
SELECT public.t_assert(public.t_refused($q$SELECT owner_name FROM public.vehicles$q$), 'anon: owner_name select refused');
SELECT public.t_assert(public.t_refused($q$SELECT owner_contact FROM public.vehicles$q$), 'anon: owner_contact select refused');
SELECT public.t_assert((SELECT make FROM public.vehicles WHERE id='10000000-0000-0000-0000-000000000001') = 'Porsche', 'anon: make still readable');
-- vehicle_row_read now nulls the two columns for the public, while still returning the row.
SELECT public.t_assert((public.vehicle_row_read('10000000-0000-0000-0000-000000000001') ->> 'owner_name') IS NULL, 'after: vehicle_row_read nulls owner_name for the public');
SELECT public.t_assert((public.vehicle_row_read('10000000-0000-0000-0000-000000000001') ->> 'owner_contact') IS NULL, 'after: vehicle_row_read nulls owner_contact for the public');
SELECT public.t_assert((public.vehicle_row_read('10000000-0000-0000-0000-000000000001') ->> 'make') = 'Porsche', 'after: vehicle_row_read still returns make to the public');
SELECT public.t_assert((public.vehicle_row_read('10000000-0000-0000-0000-000000000001') ->> 'purchase_price') IS NULL, 'after: the money stays masked too');
RESET ROLE;
SET ROLE authenticated;
SET test.auth_role = 'authenticated';
SELECT public.t_assert(public.t_refused($q$SELECT owner_name FROM public.vehicles$q$), 'authenticated: owner_name select refused');
SELECT public.t_assert(public.t_refused($q$SELECT owner_contact FROM public.vehicles$q$), 'authenticated: owner_contact select refused');
-- A signed-in stranger reading vehicle_row_read on a public vehicle gets the columns nulled.
SET test.auth_uid = '20000000-0000-0000-0000-0000000000ff';
SELECT public.t_assert((public.vehicle_row_read('10000000-0000-0000-0000-000000000001') ->> 'owner_name') IS NULL, 'after: a signed-in stranger sees owner_name null');
-- The authenticated UPDATE grant is intact (the owner still edits these).
SELECT public.t_assert(has_table_privilege('authenticated', 'public.vehicles', 'UPDATE'), 'after: authenticated keeps UPDATE');
RESET ROLE;

-- 4. The owner (insider) still reads both through vehicle_row_read.
SET ROLE authenticated;
SET test.auth_role = 'authenticated';
SET test.auth_uid = '20000000-0000-0000-0000-0000000000a1';
SELECT public.t_assert((public.vehicle_row_read('10000000-0000-0000-0000-000000000001') ->> 'owner_name') = 'Jane Seller', 'owner: reads owner_name through the reader');
SELECT public.t_assert((public.vehicle_row_read('10000000-0000-0000-0000-000000000001') ->> 'owner_contact') = 'jane@example.com', 'owner: reads owner_contact through the reader');
SELECT public.t_assert((public.vehicle_row_read('10000000-0000-0000-0000-000000000001') ->> 'purchase_price')::numeric = 42000, 'owner: still reads the money');
RESET ROLE;

-- 5. The service role still selects the columns directly.
SET ROLE service_role;
SET test.auth_role = 'service_role';
SELECT public.t_assert((SELECT count(*) FROM public.vehicles WHERE owner_name IS NOT NULL) = 2, 'service role: reads owner_name');
RESET ROLE;
SET test.auth_role = '';

-- 6. get_vehicle_profile_data's mask now names the two columns (checked at the body level; it reads tables this
--    fixture does not create, so it is not called here).
SELECT public.t_assert(
  pg_get_functiondef('public.get_vehicle_profile_data(uuid)'::regprocedure) LIKE '%''purchase_location'', ''owner_name'', ''owner_contact''%',
  'after: get_vehicle_profile_data masks owner_name and owner_contact');

SELECT 'owner contact columns contract: all checks passed' AS result;
