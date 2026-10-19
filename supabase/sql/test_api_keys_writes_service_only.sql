-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_api_keys -f this-file.sql
-- Contract for 20261014183000_api_keys_writes_service_only.sql. Synthetic rows only; never production.
-- api_keys is built with its production columns, constraints, row policies and the default API grants:
--   * before: a signed-in caller inserts a key with a hash it chose and scopes {admin}, and widens its own key;
--   * after: anon and authenticated get insufficient_privilege on every insert and update, still read and delete
--     their own keys and never see anyone else's; the service role still writes; the migration is idempotent.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.api_keys') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dm_contract_deployer') THEN CREATE ROLE dm_contract_deployer NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role, dm_contract_deployer;
GRANT SELECT, REFERENCES ON auth.users TO dm_contract_deployer;
INSERT INTO auth.users (id) VALUES ('20000000-0000-0000-0000-000000000001'), ('20000000-0000-0000-0000-000000000002');
-- Prod's deploy role owns the table and is not a superuser; build and migrate as one.
GRANT CREATE ON SCHEMA public TO dm_contract_deployer;
SET ROLE dm_contract_deployer;
DO $$ BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'the contract must run as a non-superuser after SET ROLE';
  END IF;
END $$;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
-- denied(sql) is true when the statement fails with insufficient_privilege (42501).
CREATE FUNCTION pg_temp.denied(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN true;
END $$;
-- rows(sql) runs a write and returns how many rows it touched, then undoes it.
CREATE FUNCTION pg_temp.rows(p_sql text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'P0001', DETAIL = n::text;
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS p_sql = PG_EXCEPTION_DETAIL;
    RETURN p_sql::integer;
  END;
END $$;

-- Production shape (information_schema, pg_constraint and pg_policies, 2026-10-14).
CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CONSTRAINT api_keys_name_length CHECK (char_length(name) >= 1 AND char_length(name) <= 100),
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  scopes text[] DEFAULT ARRAY['read', 'write'],
  is_active boolean DEFAULT true,
  rate_limit_per_hour integer DEFAULT 1000,
  rate_limit_remaining integer DEFAULT 1000,
  rate_limit_reset_at timestamptz,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  agent_registration_id text
);
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can create own API keys" ON public.api_keys FOR INSERT TO public
  WITH CHECK ((SELECT auth.uid() AS uid) = user_id);
CREATE POLICY "Users can delete own API keys" ON public.api_keys FOR DELETE TO public
  USING ((SELECT auth.uid() AS uid) = user_id);
CREATE POLICY "Users can update own API keys" ON public.api_keys FOR UPDATE TO public
  USING ((SELECT auth.uid() AS uid) = user_id);
CREATE POLICY "Users can view own API keys" ON public.api_keys FOR SELECT TO public
  USING ((SELECT auth.uid() AS uid) = user_id);
GRANT ALL ON public.api_keys TO anon, authenticated, service_role;
INSERT INTO public.api_keys (user_id, name, key_hash, key_prefix, scopes) VALUES
 ('20000000-0000-0000-0000-000000000001', 'mine', 'sha256_mine', 'aaaa1111', ARRAY['read']),
 ('20000000-0000-0000-0000-000000000002', 'theirs', 'sha256_theirs', 'bbbb2222', ARRAY['read']);

-- 1. Before: a signed-in caller mints itself an admin key and widens its own key.
SET ROLE authenticated;
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000001', false);
SELECT pg_temp.ok('before: a signed-in caller inserts a key it chose, scoped admin',
  pg_temp.rows($q$INSERT INTO public.api_keys (user_id, name, key_hash, key_prefix, scopes)
    VALUES ('20000000-0000-0000-0000-000000000001', 'self-minted', 'sha256_chosen', 'cccc3333', ARRAY['admin'])$q$) = 1);
SELECT pg_temp.ok('before: a signed-in caller widens its own key to admin and never expiring',
  pg_temp.rows($q$UPDATE public.api_keys SET scopes = ARRAY['admin'], expires_at = NULL, rate_limit_per_hour = 1000000$q$) = 1);
RESET ROLE;
SET ROLE dm_contract_deployer;
\ir ../migrations/20261014183000_api_keys_writes_service_only.sql
-- A second application changes nothing and passes its own check.
\ir ../migrations/20261014183000_api_keys_writes_service_only.sql

-- 2. After: no inserts or updates for anon or authenticated; own reads and deletes stay.
SET ROLE authenticated;
SELECT set_config('test.auth_uid', '20000000-0000-0000-0000-000000000001', false);
SELECT pg_temp.ok('authenticated: inserting a key is denied',
  pg_temp.denied($q$INSERT INTO public.api_keys (user_id, name, key_hash, key_prefix, scopes)
    VALUES ('20000000-0000-0000-0000-000000000001', 'self-minted', 'sha256_chosen', 'cccc3333', ARRAY['admin'])$q$));
SELECT pg_temp.ok('authenticated: updating any column of its own key is denied',
  pg_temp.denied($q$UPDATE public.api_keys SET scopes = ARRAY['admin']$q$)
  AND pg_temp.denied($q$UPDATE public.api_keys SET expires_at = NULL$q$)
  AND pg_temp.denied($q$UPDATE public.api_keys SET is_active = true$q$));
SELECT pg_temp.ok('authenticated: reads its own key only, and still deletes it',
  (SELECT count(*) FROM public.api_keys) = 1
  AND (SELECT name FROM public.api_keys) = 'mine'
  AND pg_temp.rows($q$DELETE FROM public.api_keys$q$) = 1);
RESET ROLE;
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false);
SELECT pg_temp.ok('anon: inserts and updates are denied, and no key is visible',
  pg_temp.denied($q$INSERT INTO public.api_keys (user_id, name, key_hash, key_prefix) VALUES (NULL, 'x', 'sha256_x', 'x')$q$)
  AND pg_temp.denied($q$UPDATE public.api_keys SET scopes = ARRAY['admin']$q$)
  AND pg_temp.denied($q$TRUNCATE public.api_keys$q$)
  AND (SELECT count(*) FROM public.api_keys) = 0);
RESET ROLE;
SET ROLE service_role;
SELECT pg_temp.ok('the service role still mints and changes keys',
  pg_temp.rows($q$INSERT INTO public.api_keys (user_id, name, key_hash, key_prefix, scopes)
    VALUES ('20000000-0000-0000-0000-000000000002', 'minted', 'sha256_minted', 'dddd4444', ARRAY['read'])$q$) = 1
  AND pg_temp.rows($q$UPDATE public.api_keys SET is_active = false WHERE name = 'theirs'$q$) = 1);
RESET ROLE;
SELECT pg_temp.ok('the two keys are as seeded',
  (SELECT count(*) FROM public.api_keys) = 2
  AND NOT EXISTS (SELECT 1 FROM public.api_keys WHERE 'admin' = ANY (scopes)));
