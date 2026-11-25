-- Isolated PostgreSQL 17 contract for 20261126003000_public_tables_revoke_truncate_trigger_references.sql.
-- Tables, a view and a materialized view get the live default privileges (arwdDxt to anon and authenticated). After the
-- migration:
--   * none grants TRUNCATE, TRIGGER or REFERENCES to anon or authenticated;
--   * SELECT, INSERT, UPDATE and DELETE are as they were;
--   * a table created afterwards gets none of the three;
--   * a relation another role owns is left alone;
--   * re-applying changes nothing.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.grants_fx_a') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN CREATE ROLE postgres SUPERUSER NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grants_fx_other') THEN CREATE ROLE grants_fx_other NOLOGIN; END IF;
END $$;
CREATE FUNCTION public.t_assert(v boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;

-- The migration runs as postgres (the role CI applies migrations with); objects are created as postgres with the live
-- default privileges.
SET ROLE postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
CREATE TABLE public.grants_fx_a(id int);
CREATE TABLE public.grants_fx_b(id int);
ALTER TABLE public.grants_fx_b ENABLE ROW LEVEL SECURITY;
CREATE VIEW public.grants_fx_v WITH (security_invoker = true) AS SELECT id FROM public.grants_fx_a;
CREATE MATERIALIZED VIEW public.grants_fx_m AS SELECT 1 AS id;
RESET ROLE;
CREATE TABLE public.grants_fx_other_owned(id int);
ALTER TABLE public.grants_fx_other_owned OWNER TO grants_fx_other;
GRANT ALL ON public.grants_fx_other_owned TO anon, authenticated;

SELECT t_assert(has_table_privilege('anon', 'public.grants_fx_a', 'TRUNCATE')
  AND has_table_privilege('authenticated', 'public.grants_fx_m', 'REFERENCES'), 'before: the defaults grant the three verbs');

SET ROLE postgres;
\ir ../migrations/20261126003000_public_tables_revoke_truncate_trigger_references.sql
RESET ROLE;

SELECT t_assert(NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['public.grants_fx_a', 'public.grants_fx_b', 'public.grants_fx_v', 'public.grants_fx_m']) rel,
               unnest(ARRAY['anon', 'authenticated']) ro, unnest(ARRAY['TRUNCATE', 'TRIGGER', 'REFERENCES']) v
   WHERE has_table_privilege(ro, rel::regclass, v)), 'after: no TRUNCATE, TRIGGER or REFERENCES for anon or authenticated');
SELECT t_assert(NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY['public.grants_fx_a', 'public.grants_fx_b', 'public.grants_fx_v']) rel,
               unnest(ARRAY['anon', 'authenticated']) ro, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) v
   WHERE NOT has_table_privilege(ro, rel::regclass, v)), 'after: SELECT, INSERT, UPDATE and DELETE are untouched');
SELECT t_assert(has_table_privilege('anon', 'public.grants_fx_other_owned', 'TRUNCATE'),
  'a relation another role owns is left alone');

SET ROLE postgres;
CREATE TABLE public.grants_fx_new(id int);
RESET ROLE;
SELECT t_assert(has_table_privilege('anon', 'public.grants_fx_new', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.grants_fx_new', 'TRUNCATE')
  AND NOT has_table_privilege('authenticated', 'public.grants_fx_new', 'TRIGGER')
  AND NOT has_table_privilege('authenticated', 'public.grants_fx_new', 'REFERENCES'),
  'a table created afterwards keeps SELECT and gets none of the three');

SELECT md5(string_agg(c.relname || coalesce(c.relacl::text, ''), ',' ORDER BY c.relname)) AS acl_before
  FROM pg_class c WHERE c.relname LIKE 'grants_fx_%' \gset
SET ROLE postgres;
\ir ../migrations/20261126003000_public_tables_revoke_truncate_trigger_references.sql
RESET ROLE;
SELECT t_assert((SELECT md5(string_agg(c.relname || coalesce(c.relacl::text, ''), ',' ORDER BY c.relname))
  FROM pg_class c WHERE c.relname LIKE 'grants_fx_%') = :'acl_before', 're-applying changes nothing');

-- Leave the server's roles as they were (the runner checks).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
DROP TABLE public.grants_fx_other_owned;
