-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_business_user_roles -f this-file.sql
-- Proves that after 20261014210000_business_user_roles_owner_managed.sql only a business's active owner adds, changes
-- or removes staff roles (a member may delete their own), a stranger can no longer self-insert a role that grants
-- dealer_inventory management, and the blanket read of staff rows (including hourly_rate) is gone. Starts from the
-- live policies (helpers/business_user_roles_live_20261014.sql) and the live dealer_inventory ALL policy, and shows
-- the self-grant there first.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.business_user_roles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='bur_owner') THEN CREATE ROLE bur_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role, bur_owner;
GRANT CREATE ON SCHEMA public TO bur_owner;

SET ROLE bur_owner;
CREATE TABLE public.business_ownership (business_id uuid, owner_id uuid, status text);
CREATE TABLE public.business_user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid, user_id uuid, role_title text, role_type text, hourly_rate numeric(10,2),
  status text DEFAULT 'active', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.dealer_inventory (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dealer_id uuid, asking_price numeric, status text);
ALTER TABLE public.business_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_inventory ENABLE ROW LEVEL SECURITY;
\ir helpers/business_user_roles_live_20261014.sql
-- dealer_inventory as live: it trusts any business_user_roles row for the dealer.
CREATE POLICY "Dealer members can manage inventory" ON public.dealer_inventory FOR ALL USING (EXISTS (
  SELECT 1 FROM public.business_user_roles WHERE business_user_roles.business_id = dealer_inventory.dealer_id
    AND business_user_roles.user_id = (SELECT auth.uid())));
CREATE POLICY "Public can view dealer inventory" ON public.dealer_inventory FOR SELECT USING (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_user_roles, public.dealer_inventory TO anon, authenticated, service_role;
GRANT SELECT ON public.business_ownership TO anon, authenticated, service_role;
RESET ROLE;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
CREATE FUNCTION public.t_refused(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
CREATE FUNCTION public.t_rows(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean,text), public.t_refused(text), public.t_rows(text) TO anon, authenticated, service_role;
CREATE FUNCTION public.t_policy_hash() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(string_agg(
           p.polname || E'\t' || p.polcmd::text || E'\t' || p.polpermissive::text || E'\t'
           || coalesce((SELECT string_agg(r.rolname, ',' ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY (p.polroles)), 'public')
           || E'\t' || coalesce(pg_get_expr(p.polqual, p.polrelid), '')
           || E'\t' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
           E'\n' ORDER BY p.polname), 'UTF8')), 'base64')
  FROM pg_policy p WHERE p.polrelid = 'public.business_user_roles'::regclass $$;

-- Seeds. Business B1 owned by O1. Member M1 already on staff at B1. Dealer inventory row on B1. Stranger X9.
INSERT INTO public.business_ownership VALUES ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000f1'::uuid, 'active');
INSERT INTO public.business_user_roles (id, business_id, user_id, role_title, role_type, hourly_rate, status) VALUES
 ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a1'::uuid, 'Technician', 'technician', 42.50, 'active');
INSERT INTO public.dealer_inventory (id, dealer_id, asking_price, status) VALUES
 ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 25000, 'available');

-- 0. Fixture is the live policy set.
SELECT public.t_assert(public.t_policy_hash() = 'Aeb57aKPCTaS2vvvJ32l2IhZBIOPHC3QWvyrLDdQpd0=', 'fixture: policies as live');

-- 1. Before: a stranger self-inserts a role at B1 and then manages B1's dealer inventory; anon reads hourly_rate.
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000e9';
BEGIN;
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.business_user_roles (business_id, user_id, role_title, role_type)
  VALUES ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000e9', 'Boss', 'owner')$q$) = 1, 'before: stranger self-inserts a role');
SELECT public.t_assert(public.t_rows($q$UPDATE public.dealer_inventory SET asking_price = 1 WHERE dealer_id = '40000000-0000-0000-0000-000000000001'$q$) = 1, 'before: and manages the dealer inventory');
ROLLBACK;
RESET ROLE;
SET ROLE anon;
SET test.auth_uid = '';
SELECT public.t_assert((SELECT hourly_rate FROM public.business_user_roles WHERE id='50000000-0000-0000-0000-000000000001') = 42.50, 'before: anon reads hourly_rate');
RESET ROLE;

-- 2. Apply the migration as the table owner, twice.
SET test.auth_uid = '';
SET ROLE bur_owner;
\ir ../migrations/20261014210000_business_user_roles_owner_managed.sql
\ir ../migrations/20261014210000_business_user_roles_owner_managed.sql
RESET ROLE;

-- 3. After: a stranger cannot self-insert, so cannot reach the dealer inventory; anon cannot read staff rows.
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000e9';
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.business_user_roles (business_id, user_id, role_title, role_type)
  VALUES ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000e9', 'Boss', 'owner')$q$), 'after: stranger self-insert refused');
SELECT public.t_assert(public.t_rows($q$UPDATE public.dealer_inventory SET asking_price = 1 WHERE dealer_id = '40000000-0000-0000-0000-000000000001'$q$) = 0, 'after: stranger manages no dealer inventory');
RESET ROLE;
SET ROLE anon;
SET test.auth_uid = '';
SELECT public.t_assert(public.t_refused($q$SELECT hourly_rate FROM public.business_user_roles$q$) OR (SELECT count(*) FROM public.business_user_roles) = 0, 'after: anon reads no staff row');
RESET ROLE;

-- 4. The business owner adds, moves and removes staff; a member reads only their own row and may leave.
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000f1';
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.business_user_roles (business_id, user_id, role_title, role_type)
  VALUES ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000a2', 'Advisor', 'employee')$q$) = 1, 'owner: adds a staff member');
SELECT public.t_assert(public.t_rows($q$UPDATE public.business_user_roles SET role_title = 'Lead' WHERE user_id = '20000000-0000-0000-0000-0000000000a1'$q$) = 1, 'owner: updates a staff row');
SELECT public.t_assert((SELECT count(*) FROM public.business_user_roles) = 2, 'owner: reads the business roster');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.business_user_roles (business_id, user_id, role_title, role_type)
  VALUES ('40000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-0000000000f1', 'Boss', 'owner')$q$), 'owner: cannot add to a business they do not own');
RESET ROLE;
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000a1';
SELECT public.t_assert((SELECT count(*) FROM public.business_user_roles) = 1, 'member: reads only their own row');
SELECT public.t_assert(public.t_rows($q$UPDATE public.business_user_roles SET role_type = 'owner' WHERE user_id = '20000000-0000-0000-0000-0000000000a1'$q$) = 0, 'member: cannot escalate their own role (no row matches the owner-only update policy)');
SELECT public.t_assert(public.t_rows($q$DELETE FROM public.business_user_roles WHERE user_id = '20000000-0000-0000-0000-0000000000a1'$q$) = 1, 'member: may delete their own row (leave)');
RESET ROLE;

-- 5. The service role still manages roles freely.
SET ROLE service_role;
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.business_user_roles (business_id, user_id, role_title, role_type)
  VALUES ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-0000000000f2', 'Tech', 'technician')$q$) = 1, 'service role: inserts a role');
RESET ROLE;

SELECT 'business user roles owner-managed contract: all checks passed' AS result;
