-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_transfer_creds -f this-file.sql
-- Proves that after 20261014190000_transfer_party_credentials_owner_only.sql a transfer's party access tokens and the
-- parties' email and phone are owner-only: anon and authenticated can no longer SELECT the 7 sensitive columns (the 20
-- others stay readable), transfer_party_role tells the /t/ page its role without the browser reading a token, and
-- transfer_admin_links returns the sensitive link fields to active admins and the service role only. Starts from the
-- live policies and grant state (helpers/ownership_transfers_live_20261014.sql) and shows the logged-out token read there
-- first.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.ownership_transfers') IS NOT NULL THEN
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
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='ot_owner') THEN CREATE ROLE ot_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role, ot_owner;
GRANT CREATE ON SCHEMA public TO ot_owner;

SET ROLE ot_owner;
-- ownership_transfers with the 27 live columns, owned by a non-superuser, row security on, the three live policies,
-- and the live table ACL (arwdDxt to the three API roles, nothing to PUBLIC).
CREATE TABLE public.ownership_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  from_user_id uuid, to_user_id uuid, from_identity_id uuid, to_identity_id uuid,
  trigger_type text NOT NULL DEFAULT 'private_sale', trigger_id uuid, trigger_table text,
  agreed_price numeric(12,2), currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'pending', sale_date timestamptz, completed_at timestamptz, cancelled_at timestamptz,
  stalled_at timestamptz, last_milestone_at timestamptz, public_visibility text NOT NULL DEFAULT 'vague',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  inbox_email text, buyer_phone text, seller_phone text, buyer_email text, seller_email text,
  buyer_access_token uuid NOT NULL DEFAULT gen_random_uuid(), seller_access_token uuid NOT NULL DEFAULT gen_random_uuid()
);
CREATE TABLE public.admin_users (user_id uuid, is_active boolean);
ALTER TABLE public.ownership_transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Parties can update their transfer" ON public.ownership_transfers FOR UPDATE
  USING ((SELECT auth.uid()) = from_user_id OR (SELECT auth.uid()) = to_user_id);
CREATE POLICY "Parties can view their transfer" ON public.ownership_transfers FOR SELECT
  USING ((SELECT auth.uid()) = from_user_id OR (SELECT auth.uid()) = to_user_id);
CREATE POLICY "Public can view non-hidden transfers" ON public.ownership_transfers FOR SELECT TO anon
  USING (public_visibility <> 'hidden');
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.ownership_transfers TO anon, authenticated, service_role;
RESET ROLE;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
CREATE FUNCTION public.t_refused(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean,text), public.t_refused(text) TO anon, authenticated, service_role;
CREATE FUNCTION public.t_acl(p_acl aclitem[], p_owner oid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(g || ':' || privs, ';' ORDER BY g) FROM (
    SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS g,
           string_agg(a.privilege_type, ',' ORDER BY a.privilege_type) AS privs
    FROM aclexplode(p_acl) a WHERE a.grantee <> p_owner GROUP BY 1) x $$;

-- Seeds. T1 non-hidden, parties S1 (seller) and B1 (buyer), with both tokens and contact. T2 hidden. A1 active admin.
INSERT INTO public.ownership_transfers (id, vehicle_id, from_user_id, to_user_id, public_visibility, inbox_email,
  buyer_email, seller_phone, buyer_access_token, seller_access_token) VALUES
 ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-00000000005a'::uuid,
   '20000000-0000-0000-0000-00000000005b'::uuid, 'vague', 'inbox+t1@nuke.ag', 'buyer@example.com', '555-0100',
   '99999999-0000-0000-0000-0000000000a1', '99999999-0000-0000-0000-0000000000a2'),
 ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', NULL, NULL, 'hidden', 'inbox+t2@nuke.ag',
   NULL, NULL, '99999999-0000-0000-0000-0000000000b1', '99999999-0000-0000-0000-0000000000b2');
INSERT INTO public.admin_users VALUES ('20000000-0000-0000-0000-0000000000d1', true);

-- 0. The fixture's table ACL is production's.
SELECT public.t_assert(public.t_acl(c.relacl, c.relowner) = 'anon:DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE;authenticated:DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE;service_role:DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE',
  'fixture: ownership_transfers table ACL as live') FROM pg_class c WHERE c.oid='public.ownership_transfers'::regclass;

-- 1. Before: a logged-out visitor reads the non-hidden transfer's tokens and contact.
SET ROLE anon;
SET test.auth_uid = ''; SET test.auth_role = 'anon';
SELECT public.t_assert((SELECT buyer_access_token FROM public.ownership_transfers WHERE id='70000000-0000-0000-0000-000000000001') = '99999999-0000-0000-0000-0000000000a1', 'before: anon reads buyer_access_token');
SELECT public.t_assert((SELECT seller_access_token FROM public.ownership_transfers WHERE id='70000000-0000-0000-0000-000000000001') = '99999999-0000-0000-0000-0000000000a2', 'before: anon reads seller_access_token');
SELECT public.t_assert((SELECT inbox_email FROM public.ownership_transfers WHERE id='70000000-0000-0000-0000-000000000001') = 'inbox+t1@nuke.ag', 'before: anon reads inbox_email');
RESET ROLE;

-- 2. Apply the migration as the table owner, twice (the second run is a no-op).
SET test.auth_uid = ''; SET test.auth_role = '';
SET ROLE ot_owner;
\ir ../migrations/20261014190000_transfer_party_credentials_owner_only.sql
\ir ../migrations/20261014190000_transfer_party_credentials_owner_only.sql
RESET ROLE;
GRANT EXECUTE ON FUNCTION public.transfer_party_role(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transfer_admin_links(uuid[]) TO authenticated, service_role;

-- 3. After: anon and authenticated cannot select the 7 sensitive columns; the others stay readable.
SET ROLE anon;
SET test.auth_role = 'anon';
SELECT public.t_assert(public.t_refused($q$SELECT buyer_access_token FROM public.ownership_transfers$q$), 'anon: buyer_access_token select refused');
SELECT public.t_assert(public.t_refused($q$SELECT seller_access_token FROM public.ownership_transfers$q$), 'anon: seller_access_token select refused');
SELECT public.t_assert(public.t_refused($q$SELECT inbox_email FROM public.ownership_transfers$q$), 'anon: inbox_email select refused');
SELECT public.t_assert(public.t_refused($q$SELECT buyer_email FROM public.ownership_transfers$q$), 'anon: buyer_email select refused');
SELECT public.t_assert(public.t_refused($q$SELECT seller_phone FROM public.ownership_transfers$q$), 'anon: seller_phone select refused');
SELECT public.t_assert(public.t_refused($q$SELECT * FROM public.ownership_transfers$q$), 'anon: select * refused (names a revoked column)');
SELECT public.t_assert((SELECT status FROM public.ownership_transfers WHERE id='70000000-0000-0000-0000-000000000001') = 'pending', 'anon: status still readable');
SELECT public.t_assert((SELECT count(vehicle_id) FROM public.ownership_transfers) = 1, 'anon: the 20 public columns still read, non-hidden rows only');
-- transfer_party_role tells the page its role without the browser reading a token.
SELECT public.t_assert(public.transfer_party_role('70000000-0000-0000-0000-000000000001', '99999999-0000-0000-0000-0000000000a1') = 'buyer', 'anon: the buyer token resolves to buyer');
SELECT public.t_assert(public.transfer_party_role('70000000-0000-0000-0000-000000000001', '99999999-0000-0000-0000-0000000000a2') = 'seller', 'anon: the seller token resolves to seller');
SELECT public.t_assert(public.transfer_party_role('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000') = 'observer', 'anon: a wrong token is observer');
SELECT public.t_assert(public.transfer_party_role('70000000-0000-0000-0000-000000000001', NULL) = 'observer', 'anon: no token is observer');
SELECT public.t_assert(public.transfer_party_role('70000000-0000-0000-0000-0000000000ff', '99999999-0000-0000-0000-0000000000a1') = 'observer', 'anon: an unknown transfer is observer');
-- transfer_admin_links is not granted to anon at all.
SELECT public.t_assert(public.t_refused($q$SELECT * FROM public.transfer_admin_links(ARRAY['70000000-0000-0000-0000-000000000001'::uuid])$q$), 'anon: transfer_admin_links execute refused');
RESET ROLE;

-- 4. A signed-in non-party, non-admin: same column refusals, admin reader empty.
SET ROLE authenticated;
SET test.auth_role = 'authenticated';
SET test.auth_uid = '20000000-0000-0000-0000-0000000000f9';
SELECT public.t_assert(public.t_refused($q$SELECT seller_access_token FROM public.ownership_transfers$q$), 'stranger: seller_access_token select refused');
SELECT public.t_assert((SELECT count(*) FROM public.transfer_admin_links(ARRAY['70000000-0000-0000-0000-000000000001'::uuid])) = 0, 'stranger: transfer_admin_links returns nothing');
-- 5. An active admin reads the links for its page of ids.
SET test.auth_uid = '20000000-0000-0000-0000-0000000000d1';
SELECT public.t_assert((SELECT buyer_access_token FROM public.transfer_admin_links(ARRAY['70000000-0000-0000-0000-000000000001'::uuid, '70000000-0000-0000-0000-000000000002'::uuid]) WHERE id='70000000-0000-0000-0000-000000000001') = '99999999-0000-0000-0000-0000000000a1', 'admin: reads the buyer token through the reader');
SELECT public.t_assert((SELECT inbox_email FROM public.transfer_admin_links(ARRAY['70000000-0000-0000-0000-000000000002'::uuid]) WHERE id='70000000-0000-0000-0000-000000000002') = 'inbox+t2@nuke.ag', 'admin: reads a hidden transfer''s inbox through the reader');
SELECT public.t_assert(public.t_refused($q$SELECT buyer_access_token FROM public.ownership_transfers$q$), 'admin: still cannot select the column directly');
RESET ROLE;

-- 6. The service role still selects the columns directly and reads the admin links.
SET ROLE service_role;
SET test.auth_role = 'service_role';
SELECT public.t_assert((SELECT count(buyer_access_token) FROM public.ownership_transfers) = 2, 'service role: selects the tokens directly');
SELECT public.t_assert((SELECT count(*) FROM public.transfer_admin_links(ARRAY['70000000-0000-0000-0000-000000000001'::uuid, '70000000-0000-0000-0000-000000000002'::uuid])) = 2, 'service role: reads the admin links');
RESET ROLE;
SET test.auth_role = '';

-- 7. Grants: anon keeps SELECT on exactly the 20 public columns; the 7 sensitive are ungranted; UPDATE intact.
SELECT public.t_assert((SELECT count(*) FROM pg_attribute a WHERE a.attrelid='public.ownership_transfers'::regclass AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege('anon','public.ownership_transfers',a.attname,'SELECT')) = 20, 'after: anon reads 20 columns');
SELECT public.t_assert(NOT has_table_privilege('anon','public.ownership_transfers','SELECT'), 'after: the table-wide SELECT is gone for anon');
SELECT public.t_assert(has_table_privilege('authenticated','public.ownership_transfers','UPDATE'), 'after: authenticated keeps UPDATE');

SELECT 'transfer party credentials contract: all checks passed' AS result;
