-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_work_order_line_items -f this-file.sql
-- Proves that after 20261014104500_work_order_line_items_party_policies.sql a work order's parties (its customer, the
-- shop's active owners, the vehicle's insiders, admins) read and update its line items, anon and signed-in strangers
-- read and write none, nobody but the service role inserts or deletes, and that the live policies it replaces let
-- anon read and rewrite every row. Starts from the live access rule (helpers/work_order_is_accessible_live_20261014.sql)
-- and the live policies and grants as read on 2026-10-14. The seeds are a disposable database's rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.work_order_line_items') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'wo_table_owner') THEN CREATE ROLE wo_table_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role, wo_table_owner;
GRANT CREATE ON SCHEMA public TO wo_table_owner;

-- The tables the access rule reads, with the columns it uses, owned like production's by a non-superuser.
SET ROLE wo_table_owner;
CREATE TABLE public.work_orders (id uuid PRIMARY KEY, vehicle_id uuid, customer_id uuid, organization_id uuid);
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, user_id uuid, owner_id uuid, uploaded_by uuid);
CREATE TABLE public.business_ownership (business_id uuid, owner_id uuid, status text);
CREATE TABLE public.admin_users (user_id uuid, is_active boolean);
CREATE TABLE public.vehicle_access_grants (vehicle_id uuid, user_id uuid);
-- Stands in for vehicle_user_has_access: a contributor grant table, so the rule's last vehicle branch is exercised.
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle uuid, p_user uuid) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT EXISTS (SELECT 1 FROM public.vehicle_access_grants g WHERE g.vehicle_id = p_vehicle AND g.user_id = p_user) $$;
\ir helpers/work_order_is_accessible_live_20261014.sql

-- work_order_line_items as live: the columns the web reads and writes, row security on, the two live policies
-- verbatim, every privilege granted to the API roles (2026-10-14).
CREATE TABLE public.work_order_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL,
  line_number integer,
  task_type text NOT NULL,
  task_description text,
  hours_labor numeric,
  labor_rate_cents integer,
  parts_cost_cents integer,
  total_cost_cents integer,
  status text NOT NULL DEFAULT 'pending',
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.work_order_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view work_order_line_items" ON public.work_order_line_items FOR SELECT USING (true);
CREATE POLICY "Service role manages work_order_line_items" ON public.work_order_line_items USING (true) WITH CHECK (true);
GRANT ALL ON public.work_order_line_items TO anon, authenticated, service_role;
RESET ROLE;

-- Seeds. W1: vehicle V1 (user C1), customer C1, shop O1 (active owner S1, inactive owner S2).
--        W2: vehicle V2 (owner U3, contributor K4), no customer, no shop. Admin A1. Stranger X9.
INSERT INTO public.vehicles VALUES
 ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000c1', NULL, NULL),
 ('10000000-0000-0000-0000-000000000002', NULL, '20000000-0000-0000-0000-0000000000a3', NULL);
INSERT INTO public.work_orders VALUES
 ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000c1', '40000000-0000-0000-0000-000000000001'),
 ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', NULL, NULL);
INSERT INTO public.business_ownership VALUES
 ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000b1', 'active'),
 ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000b2', 'inactive');
INSERT INTO public.admin_users VALUES ('20000000-0000-0000-0000-0000000000d1', true);
INSERT INTO public.vehicle_access_grants VALUES ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-0000000000e4');
INSERT INTO public.work_order_line_items (id, work_order_id, line_number, task_type, task_description, labor_rate_cents, parts_cost_cents, total_cost_cents) VALUES
 ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 1, 'labor', 'Frame', 12500, 0, 57673),
 ('50000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 2, 'parts', 'Bushings', NULL, 8800, 8800),
 ('50000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002', 1, 'labor', 'Wiring', 12500, 0, 25000);

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean, text) TO anon, authenticated, service_role;
-- Runs one statement as the current role; true when it raised insufficient_privilege (a revoked grant or a
-- refused row), false when it ran.
CREATE FUNCTION public.t_refused(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN false;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION public.t_refused(text) TO anon, authenticated, service_role;
CREATE FUNCTION public.t_rows(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
GRANT EXECUTE ON FUNCTION public.t_rows(text) TO anon, authenticated, service_role;

-- 1. Before: the live policies give anon every row and every write.
SET ROLE anon;
SET test.auth_uid = '';
SELECT public.t_assert((SELECT count(*) FROM public.work_order_line_items) = 3, 'before: anon reads all 3 line items');
SELECT public.t_assert((SELECT sum(total_cost_cents) FROM public.work_order_line_items) = 91473, 'before: anon reads the costs');
BEGIN;
SELECT public.t_assert(public.t_rows($q$UPDATE public.work_order_line_items SET status = 'tampered'$q$) = 3, 'before: anon updates all 3');
SELECT public.t_assert(public.t_rows($q$DELETE FROM public.work_order_line_items$q$) = 3, 'before: anon deletes all 3');
ROLLBACK;
RESET ROLE;
SELECT public.t_assert(has_table_privilege('anon', 'public.work_order_line_items', 'TRUNCATE'), 'before: anon holds TRUNCATE');

-- 2. Apply the migration as the table owner, twice (the second run is a no-op).
SET ROLE wo_table_owner;
\ir ../migrations/20261014104500_work_order_line_items_party_policies.sql
\ir ../migrations/20261014104500_work_order_line_items_party_policies.sql
RESET ROLE;
SELECT public.t_assert((SELECT count(*) FROM pg_policy WHERE polrelid = 'public.work_order_line_items'::regclass) = 3, 'after: three policies');
SELECT public.t_assert(NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.work_order_line_items'::regclass AND polroles = '{0}'::oid[] AND pg_get_expr(polqual, polrelid) = 'true'),
  'after: no policy grants PUBLIC every row');

-- 3. anon: no rows, no writes.
SET ROLE anon;
SET test.auth_uid = '';
SELECT public.t_assert((SELECT count(*) FROM public.work_order_line_items) = 0, 'anon reads no line item');
SELECT public.t_assert(public.t_refused($q$UPDATE public.work_order_line_items SET status = 'tampered'$q$), 'anon update refused');
SELECT public.t_assert(public.t_refused($q$DELETE FROM public.work_order_line_items$q$), 'anon delete refused');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.work_order_line_items (work_order_id, task_type) VALUES ('30000000-0000-0000-0000-000000000001', 'labor')$q$), 'anon insert refused');
SELECT public.t_assert(public.t_refused($q$TRUNCATE public.work_order_line_items$q$), 'anon truncate refused');
RESET ROLE;

-- 4. A signed-in stranger: no rows; an update touches nothing; insert, delete and truncate refused.
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000f9';
SELECT public.t_assert((SELECT count(*) FROM public.work_order_line_items) = 0, 'stranger reads no line item');
SELECT public.t_assert(public.t_rows($q$UPDATE public.work_order_line_items SET status = 'tampered'$q$) = 0, 'stranger updates nothing');
SELECT public.t_assert(public.t_refused($q$DELETE FROM public.work_order_line_items$q$), 'stranger delete refused');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.work_order_line_items (work_order_id, task_type) VALUES ('30000000-0000-0000-0000-000000000001', 'labor')$q$), 'stranger insert refused');
SELECT public.t_assert(public.t_refused($q$TRUNCATE public.work_order_line_items$q$), 'stranger truncate refused');

-- 5. The customer of W1 (also V1's user): W1's two items, toggles one, cannot touch W2 or move an item there.
SET test.auth_uid = '20000000-0000-0000-0000-0000000000c1';
SELECT public.t_assert((SELECT count(*) FROM public.work_order_line_items) = 2, 'customer reads W1''s two items');
SELECT public.t_assert(public.t_rows($q$UPDATE public.work_order_line_items SET status = 'complete' WHERE id = '50000000-0000-0000-0000-000000000001'$q$) = 1, 'customer toggles a W1 item');
SELECT public.t_assert(public.t_rows($q$UPDATE public.work_order_line_items SET status = 'complete' WHERE id = '50000000-0000-0000-0000-000000000003'$q$) = 0, 'customer cannot update a W2 item');
SELECT public.t_assert(public.t_refused($q$UPDATE public.work_order_line_items SET work_order_id = '30000000-0000-0000-0000-000000000002' WHERE id = '50000000-0000-0000-0000-000000000002'$q$),
  'customer cannot move an item onto a work order they cannot see');

-- 6. The shop's active owner reads W1; an inactive owner reads nothing.
SET test.auth_uid = '20000000-0000-0000-0000-0000000000b1';
SELECT public.t_assert((SELECT count(*) FROM public.work_order_line_items) = 2, 'active shop owner reads W1''s items');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000b2';
SELECT public.t_assert((SELECT count(*) FROM public.work_order_line_items) = 0, 'inactive shop owner reads nothing');

-- 7. V2's owner and its contributor read and update W2's item; an admin reads all three.
SET test.auth_uid = '20000000-0000-0000-0000-0000000000a3';
SELECT public.t_assert((SELECT array_agg(id::text) FROM public.work_order_line_items) = ARRAY['50000000-0000-0000-0000-000000000003'], 'vehicle owner reads W2''s item');
SELECT public.t_assert(public.t_rows($q$UPDATE public.work_order_line_items SET status = 'in_progress' WHERE id = '50000000-0000-0000-0000-000000000003'$q$) = 1, 'vehicle owner updates W2''s item');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000e4';
SELECT public.t_assert((SELECT count(*) FROM public.work_order_line_items) = 1, 'vehicle contributor reads W2''s item');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000d1';
SELECT public.t_assert((SELECT count(*) FROM public.work_order_line_items) = 3, 'admin reads all three');
RESET ROLE;

-- 8. The service role still inserts and deletes.
SET ROLE service_role;
SET test.auth_uid = '';
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.work_order_line_items (work_order_id, task_type) VALUES ('30000000-0000-0000-0000-000000000002', 'parts')$q$) = 1, 'service role inserts');
SELECT public.t_assert(public.t_rows($q$DELETE FROM public.work_order_line_items WHERE task_type = 'parts' AND work_order_id = '30000000-0000-0000-0000-000000000002'$q$) = 1, 'service role deletes');
SELECT public.t_assert((SELECT count(*) FROM public.work_order_line_items) = 3, 'service role reads all three');
RESET ROLE;

-- 9. Grants: anon keeps SELECT only; authenticated keeps SELECT and UPDATE; nobody in the API roles but the
--    service role inserts, deletes or truncates.
SELECT public.t_assert(has_table_privilege('anon', 'public.work_order_line_items', 'SELECT'), 'anon keeps SELECT');
SELECT public.t_assert(NOT has_table_privilege('anon', 'public.work_order_line_items', 'INSERT,UPDATE,DELETE,TRUNCATE'), 'anon holds no write privilege');
SELECT public.t_assert(has_table_privilege('authenticated', 'public.work_order_line_items', 'SELECT')
  AND has_table_privilege('authenticated', 'public.work_order_line_items', 'UPDATE'), 'authenticated keeps SELECT and UPDATE');
SELECT public.t_assert(NOT has_table_privilege('authenticated', 'public.work_order_line_items', 'INSERT,DELETE,TRUNCATE'), 'authenticated holds no insert, delete or truncate');
SELECT public.t_assert(has_table_privilege('service_role', 'public.work_order_line_items', 'INSERT,UPDATE,DELETE'), 'service role keeps its writes');
SELECT public.t_assert((SELECT work_order_id FROM public.work_order_line_items WHERE id = '50000000-0000-0000-0000-000000000002') = '30000000-0000-0000-0000-000000000001', 'the refused move left the row on W1');

-- 10. A drifted policy set stops the migration and leaves the policies as found.
SET ROLE wo_table_owner;
CREATE POLICY drifted_extra ON public.work_order_line_items FOR SELECT USING (false);
\set ON_ERROR_STOP off
\ir ../migrations/20261014104500_work_order_line_items_party_policies.sql
\set ON_ERROR_STOP on
RESET ROLE;
SELECT public.t_assert((SELECT count(*) FROM pg_policy WHERE polrelid = 'public.work_order_line_items'::regclass) = 4, 'drift: the migration changed nothing');
SELECT public.t_assert(EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.work_order_line_items'::regclass AND polname = 'drifted_extra'), 'drift: the extra policy is still there');

SELECT 'work_order_line_items party policies contract: all checks passed' AS result;
