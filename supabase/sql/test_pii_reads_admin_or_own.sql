-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_pii_reads -f this-file.sql
-- Proves that after 20261020163000_pii_reads_admin_or_own.sql a signed-in stranger (or anon) no longer reads the agent
-- mail inbox, photo EXIF attributions, SMS session phone numbers, inbox recipient addresses or shop department heads'
-- e-mail, while active admins keep the inbox reads and an uploader keeps their own attributions. Starts from the live
-- policies, view options and grants as read on 2026-10-19 and shows each leak there first.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.agent_messages') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pii_reads_owner') THEN CREATE ROLE pii_reads_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role, pii_reads_owner;
GRANT CREATE ON SCHEMA public TO pii_reads_owner;
GRANT SELECT, REFERENCES ON auth.users TO pii_reads_owner;

-- The tables, views and function with the columns the policies and the probes touch, owned like production's by a
-- role that is not a superuser, granted to the API roles as live.
SET ROLE pii_reads_owner;
CREATE TABLE public.admin_users (user_id uuid PRIMARY KEY, is_active boolean);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, full_name text, is_public boolean DEFAULT true);
CREATE TABLE public.agent_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), from_email text, to_email text, to_role text);
CREATE TABLE public.device_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), uploaded_by_user_id uuid REFERENCES auth.users(id),
  actual_contributor_id uuid REFERENCES auth.users(id), latitude numeric, longitude numeric, camera_serial text);
CREATE TABLE public.vault_sms_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, phone_number text, state text);
CREATE TABLE public.contact_inbox (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), to_address text, status text, received_at timestamptz);
CREATE TABLE public.shop_locations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, name text);
CREATE TABLE public.shop_departments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), location_id uuid, department_head_user_id uuid);
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_sms_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_inbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_users_self ON public.admin_users FOR SELECT USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Public can view all profiles" ON public.profiles FOR SELECT USING (is_public = true);
CREATE POLICY allow_authenticated_read_agent_messages ON public.agent_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY device_attributions_public_read ON public.device_attributions FOR SELECT USING (true);
CREATE POLICY vault_sms_user_policy ON public.vault_sms_sessions FOR SELECT USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Admins can read contact inbox" ON public.contact_inbox FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = (SELECT auth.uid()) AND au.is_active));
-- Both views as live: no security_invoker, so they run as their owner.
CREATE VIEW public.vault_active_sms_sessions AS
  SELECT s.id, s.phone_number, s.state, p.full_name AS user_name
  FROM public.vault_sms_sessions s LEFT JOIN public.profiles p ON s.user_id = p.id
  WHERE s.state <> ALL (ARRAY['completed', 'expired']);
CREATE VIEW public.v_inbox_summary AS
  SELECT to_address, count(*) AS total, max(received_at) AS latest_email
  FROM public.contact_inbox WHERE status <> 'spam' GROUP BY to_address;
CREATE FUNCTION public.get_shop_org_chart(p_shop_id uuid) RETURNS TABLE(location_name text, department_head_name text)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY SELECT sl.name, u.email FROM public.shop_locations sl
    LEFT JOIN public.shop_departments sd ON sd.location_id = sl.id
    LEFT JOIN auth.users u ON sd.department_head_user_id = u.id
  WHERE sl.shop_id = p_shop_id;
END $$;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_shop_org_chart(uuid) TO anon, authenticated, service_role;
RESET ROLE;

CREATE FUNCTION public.t_is(p_got text, p_want text, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF p_got IS DISTINCT FROM p_want THEN RAISE EXCEPTION 'FAIL: % (got %, want %)', p_what, p_got, p_want; END IF; END $$;
CREATE FUNCTION public.t_refused(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN false;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END $$;
-- What the caller reads, one count per surface (non-null personal fields only).
CREATE FUNCTION public.t_reads() RETURNS text LANGUAGE sql AS $$
  SELECT format('agent_mail=%s exif=%s sms_phones=%s inbox_addresses=%s',
    (SELECT count(to_email) FROM public.agent_messages), (SELECT count(latitude) FROM public.device_attributions),
    (SELECT count(phone_number) FROM public.vault_active_sms_sessions), (SELECT count(to_address) FROM public.v_inbox_summary)) $$;
GRANT EXECUTE ON FUNCTION public.t_is(text, text, text), public.t_refused(text), public.t_reads() TO anon, authenticated;

-- Seeds. Admin A1 (active), stranger X9, uploader U1 with one attribution, SMS user S1, a shop with a department head.
INSERT INTO auth.users (id, email) VALUES
 ('20000000-0000-0000-0000-0000000000a1', 'a1@example.invalid'), ('20000000-0000-0000-0000-0000000000e9', 'x9@example.invalid'),
 ('20000000-0000-0000-0000-0000000000b1', 'u1@example.invalid'), ('20000000-0000-0000-0000-0000000000c1', 'head@example.invalid');
INSERT INTO public.admin_users VALUES ('20000000-0000-0000-0000-0000000000a1', true);
INSERT INTO public.profiles (id, full_name) VALUES ('20000000-0000-0000-0000-0000000000d1', 'SMS User');
INSERT INTO public.agent_messages (from_email, to_email, to_role) VALUES
 ('agent@example.invalid', 'outside@example.invalid', 'founder'), ('a@example.invalid', 'b@example.invalid', 'founder');
INSERT INTO public.device_attributions (uploaded_by_user_id, latitude, longitude, camera_serial) VALUES
 ('20000000-0000-0000-0000-0000000000b1', 36.1, -115.1, 'SN1'), ('20000000-0000-0000-0000-0000000000a1', 34.0, -118.2, 'SN2');
INSERT INTO public.vault_sms_sessions (user_id, phone_number, state) VALUES ('20000000-0000-0000-0000-0000000000d1', '+15550000000', 'awaiting');
INSERT INTO public.contact_inbox (to_address, status, received_at) VALUES ('team@example.invalid', 'unread', now());
INSERT INTO public.shop_locations (id, shop_id, name) VALUES ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'HQ');
INSERT INTO public.shop_departments (location_id, department_head_user_id) VALUES ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-0000000000c1');

-- 1. Before: a stranger reads every surface; anon reads the attributions and the department head's e-mail.
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000e9';
SELECT public.t_is(public.t_reads(), 'agent_mail=2 exif=2 sms_phones=1 inbox_addresses=1', 'before: a signed-in stranger reads every surface');
RESET ROLE;
SET ROLE anon;
SET test.auth_uid = '';
SELECT public.t_is((SELECT count(latitude) FROM public.device_attributions)::text, '2', 'before: anon reads photo GPS');
SELECT public.t_is((SELECT count(department_head_name) FROM public.get_shop_org_chart('30000000-0000-0000-0000-000000000001'))::text, '1',
  'before: anon reads a department head''s e-mail');
RESET ROLE;

-- 2. The migration, twice.
\ir ../migrations/20261020163000_pii_reads_admin_or_own.sql
\ir ../migrations/20261020163000_pii_reads_admin_or_own.sql

-- 3. After.
SET ROLE authenticated;
SET test.auth_uid = '20000000-0000-0000-0000-0000000000e9';
SELECT public.t_is(public.t_reads(), 'agent_mail=0 exif=0 sms_phones=0 inbox_addresses=0', 'after: a signed-in stranger reads none of them');
SELECT public.t_is(public.t_refused($q$SELECT * FROM public.get_shop_org_chart('30000000-0000-0000-0000-000000000001')$q$)::text, 'true',
  'after: a signed-in account cannot call get_shop_org_chart');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000a1';
SELECT public.t_is(public.t_reads(), 'agent_mail=2 exif=1 sms_phones=0 inbox_addresses=1', 'after: an active admin keeps the inbox reads and their own attribution');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000b1';
SELECT public.t_is(public.t_reads(), 'agent_mail=0 exif=1 sms_phones=0 inbox_addresses=0', 'after: an uploader reads their own attribution');
SET test.auth_uid = '20000000-0000-0000-0000-0000000000d1';
SELECT public.t_is(public.t_reads(), 'agent_mail=0 exif=0 sms_phones=1 inbox_addresses=0', 'after: an SMS user reads their own session');
RESET ROLE;
SET ROLE anon;
SET test.auth_uid = '';
SELECT public.t_is((SELECT count(*) FROM public.device_attributions)::text, '0', 'after: anon reads no attribution rows');
SELECT public.t_is(public.t_refused($q$SELECT * FROM public.get_shop_org_chart('30000000-0000-0000-0000-000000000001')$q$)::text, 'true',
  'after: anon cannot call get_shop_org_chart');
RESET ROLE;
SET ROLE service_role;
SELECT public.t_is((SELECT count(department_head_name) FROM public.get_shop_org_chart('30000000-0000-0000-0000-000000000001'))::text, '1',
  'after: the service role still can');
RESET ROLE;

SELECT 'pii reads admin or own: ok' AS result;
