-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_cron_key -f this-file.sql
-- Proves the cron key reader. With the live definition it returns the secrets-table key and never reads Vault; after
-- the migration it returns the Vault secret supabase_service_role_key when one is there, then the secrets table, then
-- the two settings, then NULL, and still answers in a database without a vault schema. EXECUTE stays with
-- service_role (anon and authenticated refused); it runs as its owner with a pinned search_path; the migration applies
-- twice. Every value below is a disposable test string, never a key.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public._app_secrets') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

-- Production's shapes, the columns the reader touches: the secrets table and Vault's decrypted view.
CREATE TABLE public._app_secrets (key text PRIMARY KEY, value text);
CREATE SCHEMA vault;
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, secret text);
CREATE VIEW vault.decrypted_secrets AS SELECT id, name, secret AS decrypted_secret FROM vault.secrets;

\ir helpers/get_service_role_key_for_cron_live_20261014.sql
-- Production's grants on it (2026-10-14 05:41Z): the owner and service_role.
REVOKE ALL ON FUNCTION public.get_service_role_key_for_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_service_role_key_for_cron() TO service_role;

CREATE FUNCTION public.t_assert(p_ok boolean, p_what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'FAIL: %', p_what; END IF; END $$;

INSERT INTO public._app_secrets (key, value) VALUES ('service_role_key', 'test-table-key-0000000001');
INSERT INTO vault.secrets (name, secret) VALUES ('supabase_service_role_key', 'test-vault-key-0000000001');

-- 1. Before: the secrets table answers; Vault is not read.
SELECT public.t_assert(public.get_service_role_key_for_cron() = 'test-table-key-0000000001',
  'before the migration the reader returns the secrets-table key');

-- 2. The change.
\ir ../migrations/20261014054500_cron_key_from_vault.sql

-- 3. After: Vault first, then the old order.
SELECT public.t_assert(public.get_service_role_key_for_cron() = 'test-vault-key-0000000001',
  'after the migration the Vault secret answers');
UPDATE vault.secrets SET secret = 'too-short' WHERE name = 'supabase_service_role_key';
SELECT public.t_assert(public.get_service_role_key_for_cron() = 'test-table-key-0000000001',
  'a Vault value of 10 characters or fewer falls back to the secrets table');
DELETE FROM vault.secrets;
SELECT public.t_assert(public.get_service_role_key_for_cron() = 'test-table-key-0000000001',
  'no Vault secret: the secrets table');
DELETE FROM public._app_secrets;
SET app.settings.service_role_key = 'test-setting-key-000000001';
SELECT public.t_assert(public.get_service_role_key_for_cron() = 'test-setting-key-000000001',
  'no table row: app.settings.service_role_key');
RESET app.settings.service_role_key;
SET app.service_role_key = 'test-setting-key-000000002';
SELECT public.t_assert(public.get_service_role_key_for_cron() = 'test-setting-key-000000002',
  'then app.service_role_key');
RESET app.service_role_key;
SELECT public.t_assert(public.get_service_role_key_for_cron() IS NULL, 'nothing anywhere: NULL');
INSERT INTO public._app_secrets (key, value) VALUES ('service_role_key', 'test-table-key-0000000001');
DROP SCHEMA vault CASCADE;
SELECT public.t_assert(public.get_service_role_key_for_cron() = 'test-table-key-0000000001',
  'a database with no vault schema still gets the secrets-table key');

-- 4. Who may call it and how it runs.
SELECT public.t_assert(NOT has_function_privilege('anon', 'public.get_service_role_key_for_cron()', 'EXECUTE'),
  'anon cannot execute it');
SELECT public.t_assert(NOT has_function_privilege('authenticated', 'public.get_service_role_key_for_cron()', 'EXECUTE'),
  'authenticated cannot execute it');
SELECT public.t_assert(has_function_privilege('service_role', 'public.get_service_role_key_for_cron()', 'EXECUTE'),
  'service_role can execute it');
SELECT public.t_assert((SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_service_role_key_for_cron()'::regprocedure),
  'it runs as its owner');
SELECT public.t_assert((SELECT proconfig FROM pg_proc WHERE oid = 'public.get_service_role_key_for_cron()'::regprocedure)
  = ARRAY['search_path=""'], 'its search_path is pinned to nothing');

-- 5. Applied a second time (a re-run of the deploy), the guard accepts its own body.
CREATE SCHEMA vault;
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, secret text);
CREATE VIEW vault.decrypted_secrets AS SELECT id, name, secret AS decrypted_secret FROM vault.secrets;
INSERT INTO vault.secrets (name, secret) VALUES ('supabase_service_role_key', 'test-vault-key-0000000002');
\ir ../migrations/20261014054500_cron_key_from_vault.sql
SELECT public.t_assert(public.get_service_role_key_for_cron() = 'test-vault-key-0000000002',
  'after a second apply the Vault secret still answers');

SELECT 'cron key reader contract: PASS' AS result;
