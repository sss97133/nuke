-- Isolated PostgreSQL 17 contract for 20261019054333_close_work_order_pii_readers. Stand-ins carry the live
-- signatures, ACLs and the public technicians policy; synthetic rows only, never production. Run in an empty
-- disposable dm_refinement_* database:
--   createdb dm_refinement_pii && psql -X -v ON_ERROR_STOP=1 -d dm_refinement_pii -f supabase/sql/test_close_work_order_pii_readers.sql
-- Covered: function EXECUTE per role, the technicians policy swap and own-row reads, anon table grants, re-apply.
-- Not covered: the real function bodies, PostgREST.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.technicians') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* PostgreSQL 17 database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE public.technicians (id uuid PRIMARY KEY, name text, contact_info jsonb, user_id uuid);
CREATE TABLE public.equipment (id uuid PRIMARY KEY);
CREATE TABLE public.work_order_assignments (id uuid PRIMARY KEY);
ALTER TABLE public.technicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY technicians_public_read ON public.technicians FOR SELECT TO public USING (true);
GRANT ALL ON public.technicians, public.equipment, public.work_order_assignments TO anon, authenticated, service_role;
INSERT INTO public.technicians VALUES
  ('a0000000-0000-0000-0000-000000000001', 'tech one', '{"k":"private"}', '20000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000002', 'tech two', '{"k":"private"}', NULL);

CREATE FUNCTION public.resolve_work_order_status(p_query text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS
$$ SELECT jsonb_build_object('contact', jsonb_build_object('email', 'synthetic')) $$;
CREATE FUNCTION public.work_order_balance(p_work_order_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT jsonb_build_object('work_order_id', p_work_order_id) $$;
GRANT EXECUTE ON FUNCTION public.resolve_work_order_status(text), public.work_order_balance(uuid)
  TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;
SELECT pg_temp.ok('stand-in starts open to anon',
  has_function_privilege('anon', 'public.resolve_work_order_status(text)', 'EXECUTE')
  AND has_table_privilege('anon', 'public.technicians', 'SELECT'));

\ir ../migrations/20261019054333_close_work_order_pii_readers.sql
\ir ../migrations/20261019054333_close_work_order_pii_readers.sql

SELECT pg_temp.ok('resolve_work_order_status: no PUBLIC, anon or authenticated EXECUTE; service_role keeps it',
  NOT has_function_privilege('public', 'public.resolve_work_order_status(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.resolve_work_order_status(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.resolve_work_order_status(text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.resolve_work_order_status(text)', 'EXECUTE'));
SELECT pg_temp.ok('work_order_balance: no PUBLIC or anon EXECUTE; authenticated and service_role keep it',
  NOT has_function_privilege('public', 'public.work_order_balance(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.work_order_balance(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.work_order_balance(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.work_order_balance(uuid)', 'EXECUTE'));
SELECT pg_temp.ok('functions are kept, definer flag unchanged',
  (SELECT prosecdef FROM pg_proc WHERE oid = 'public.resolve_work_order_status(text)'::regprocedure)
  AND NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.work_order_balance(uuid)'::regprocedure));
SELECT pg_temp.ok('technicians: public policy gone, one own-row SELECT policy for authenticated',
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'technicians' AND policyname = 'technicians_public_read')
  AND (SELECT count(*) = 1 AND bool_and(cmd = 'SELECT' AND roles = '{authenticated}')
       FROM pg_policies WHERE schemaname = 'public' AND tablename = 'technicians'));
SELECT pg_temp.ok('anon holds no privilege on technicians, equipment or work_order_assignments',
  NOT EXISTS (SELECT 1 FROM unnest(ARRAY['public.technicians', 'public.equipment', 'public.work_order_assignments']) t,
    unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
    WHERE has_table_privilege('anon', t, p)));

SET ROLE anon;
DO $$ BEGIN
  PERFORM public.resolve_work_order_status('synthetic');
  RAISE EXCEPTION 'anon executed resolve_work_order_status';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM count(*) FROM public.technicians;
  RAISE EXCEPTION 'anon read technicians';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
SELECT pg_temp.ok('anon is refused the resolver and the technicians table', true);

SET ROLE authenticated;
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000001', false);
DO $$ BEGIN
  PERFORM public.resolve_work_order_status('synthetic');
  RAISE EXCEPTION 'authenticated executed resolve_work_order_status';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
SELECT pg_temp.ok('signed-in technician reads only their own row',
  (SELECT count(*) = 1 AND bool_and(id = 'a0000000-0000-0000-0000-000000000001') FROM public.technicians));
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000099', false);
SELECT pg_temp.ok('unrelated signed-in user reads no technician', (SELECT count(*) = 0 FROM public.technicians));
SELECT set_config('test.auth_uid', '', false);
SELECT pg_temp.ok('no uid reads no technician', (SELECT count(*) = 0 FROM public.technicians));
RESET ROLE;

SET ROLE service_role;
SELECT pg_temp.ok('service_role keeps the resolver and every technician row',
  public.resolve_work_order_status('synthetic') ? 'contact' AND (SELECT count(*) = 2 FROM public.technicians));
RESET ROLE;
SELECT 'close_work_order_pii_readers contract: PASS' AS result;
