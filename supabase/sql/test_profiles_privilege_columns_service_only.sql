-- Empty disposable PG17 only. Auto-run by scripts/ci/run-db-contracts.sh (db-contracts job) in dm_refinement_*.
-- Proves that after 20261014233000_profiles_privilege_columns_service_only.sql a signed-in or anonymous caller
-- cannot set or change profiles.user_type or role (the admin levers), the owner still edits every other column, the
-- service role still sets them, and the one existing admin row is untouched. The trigger must be SECURITY INVOKER so
-- current_user is the real caller.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.profiles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_role', true), '') $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='prof_owner') THEN CREATE ROLE prof_owner NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role, prof_owner;
GRANT CREATE ON SCHEMA public TO prof_owner;

SET ROLE prof_owner;
CREATE TYPE public.user_type AS ENUM ('user', 'moderator', 'admin', 'professional');
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  username text,
  bio text,
  user_type public.user_type NOT NULL DEFAULT 'user'::public.user_type,
  role text NOT NULL DEFAULT 'user'::text
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
-- The live own-row policies (no column cap) plus an admin-update-any policy, so the test exercises an admin row.
CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT TO public WITH CHECK ((SELECT auth.uid()) = id);
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO public USING ((SELECT auth.uid()) = id) WITH CHECK ((SELECT auth.uid()) = id);
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO public USING (true);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO anon, authenticated, service_role;
RESET ROLE;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;
CREATE FUNCTION public.t_refused(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN false; EXCEPTION WHEN insufficient_privilege THEN RETURN true; END $$;
CREATE FUNCTION public.t_rows(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
GRANT EXECUTE ON FUNCTION public.t_assert(boolean,text), public.t_refused(text), public.t_rows(text) TO anon, authenticated, service_role;

-- Seed: the one existing admin (A1), set by the service role, and a plain user (U1) who owns their row.
SET ROLE service_role; SET test.auth_role='service_role'; SET test.auth_uid='';
INSERT INTO public.profiles (id, username, user_type, role) VALUES ('20000000-0000-0000-0000-0000000000a1', 'admin1', 'admin', 'admin');
RESET ROLE;

-- 1. Before the migration a signed-in user could self-promote (sanity: the own-row policy allows it today).
SET ROLE authenticated; SET test.auth_role='authenticated'; SET test.auth_uid='20000000-0000-0000-0000-0000000000c1';
INSERT INTO public.profiles (id, username) VALUES ('20000000-0000-0000-0000-0000000000c1', 'user1');
SELECT public.t_assert(public.t_rows($q$UPDATE public.profiles SET user_type='admin' WHERE id='20000000-0000-0000-0000-0000000000c1'$q$) = 1, 'before: a user can self-promote to admin');
UPDATE public.profiles SET user_type='user' WHERE id='20000000-0000-0000-0000-0000000000c1'; -- reset
RESET ROLE;

-- 2. Apply the migration as the table owner, twice.
SET test.auth_role=''; SET test.auth_uid='';
SET ROLE prof_owner;
\ir ../migrations/20261014233000_profiles_privilege_columns_service_only.sql
\ir ../migrations/20261014233000_profiles_privilege_columns_service_only.sql
RESET ROLE;

-- 3. After: a signed-in user cannot set or change user_type/role, but edits other columns freely.
SET ROLE authenticated; SET test.auth_role='authenticated'; SET test.auth_uid='20000000-0000-0000-0000-0000000000c1';
SELECT public.t_assert(public.t_refused($q$UPDATE public.profiles SET user_type='admin' WHERE id='20000000-0000-0000-0000-0000000000c1'$q$), 'after: user cannot change user_type');
SELECT public.t_assert(public.t_refused($q$UPDATE public.profiles SET role='admin' WHERE id='20000000-0000-0000-0000-0000000000c1'$q$), 'after: user cannot change role');
SELECT public.t_assert(public.t_rows($q$UPDATE public.profiles SET bio='hello', username='u1b' WHERE id='20000000-0000-0000-0000-0000000000c1'$q$) = 1, 'after: user still edits other columns');
-- a whole-row rewrite that keeps user_type/role unchanged still passes (the upsert path)
SELECT public.t_assert(public.t_rows($q$UPDATE public.profiles SET bio='x', user_type='user', role='user' WHERE id='20000000-0000-0000-0000-0000000000c1'$q$) = 1, 'after: a whole-row update with unchanged user_type/role passes');
RESET ROLE;

-- 4. A new signed-in profile cannot arrive privileged, but a default one can.
SET ROLE authenticated; SET test.auth_role='authenticated'; SET test.auth_uid='20000000-0000-0000-0000-0000000000c2';
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.profiles (id, username, user_type) VALUES ('20000000-0000-0000-0000-0000000000c2','u2','admin')$q$), 'after: cannot insert a profile as admin');
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.profiles (id, username, role) VALUES ('20000000-0000-0000-0000-0000000000c2','u2','moderator')$q$), 'after: cannot insert a profile with a privileged role');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.profiles (id, username) VALUES ('20000000-0000-0000-0000-0000000000c2','u2')$q$) = 1, 'after: a default (non-privileged) profile insert works');
RESET ROLE;

-- 5. An anonymous caller is blocked too (anonymous sign-in is on).
SET ROLE anon; SET test.auth_role='anon'; SET test.auth_uid='20000000-0000-0000-0000-0000000000a9';
SELECT public.t_assert(public.t_refused($q$INSERT INTO public.profiles (id, username, user_type) VALUES ('20000000-0000-0000-0000-0000000000a9','a9','admin')$q$), 'after: anon cannot insert an admin profile');
RESET ROLE;

-- 6. The service role still sets and changes user_type/role, and the existing admin row is intact.
SET ROLE service_role; SET test.auth_role='service_role'; SET test.auth_uid='';
SELECT public.t_assert(public.t_rows($q$UPDATE public.profiles SET user_type='moderator' WHERE id='20000000-0000-0000-0000-0000000000c1'$q$) = 1, 'service role: sets user_type');
SELECT public.t_assert((SELECT user_type FROM public.profiles WHERE id='20000000-0000-0000-0000-0000000000a1') = 'admin', 'the existing admin row is untouched');
SELECT public.t_assert(public.t_rows($q$INSERT INTO public.profiles (id, username, user_type, role) VALUES ('20000000-0000-0000-0000-0000000000f1','s1','admin','admin')$q$) = 1, 'service role: creates a new admin');
RESET ROLE;

-- 7. An admin editing their OWN profile's other columns is not blocked (user_type unchanged); but even an admin
--    cannot change user_type through the client path (only the service role does).
SET ROLE authenticated; SET test.auth_role='authenticated'; SET test.auth_uid='20000000-0000-0000-0000-0000000000a1';
SELECT public.t_assert(public.t_rows($q$UPDATE public.profiles SET bio='admin bio' WHERE id='20000000-0000-0000-0000-0000000000a1'$q$) = 1, 'admin: edits own non-privilege columns');
SELECT public.t_assert(public.t_refused($q$UPDATE public.profiles SET user_type='user' WHERE id='20000000-0000-0000-0000-0000000000a1'$q$), 'admin: cannot change own user_type via the client');
RESET ROLE;

SELECT 'profiles privilege columns service-only contract: all checks passed' AS result;
