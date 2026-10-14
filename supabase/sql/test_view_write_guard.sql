-- Empty disposable PG17 only, as a superuser (vanilla PG17 lets only a superuser create an event trigger; supautils lets
-- postgres on Supabase), from the repository root, with node on the path (it prints the daily query):
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_view_guard -f supabase/sql/test_view_write_guard.sql
-- scripts/ci/run-db-contracts.sh runs it that way in the db-contracts job.
-- Contract for 20261014214500_view_write_guard.sql and for the daily query in scripts/ci/owner-writable-views.mjs.
-- Synthetic objects only; never production. Supabase's shape: anon, authenticated and service_role; views owned by a
-- role that bypasses row-level security and is not a superuser (postgres on Supabase); default privileges granting
-- those three ALL on every new relation in public. It proves:
--   * refused, named, and undone: a plain view over one table (even with a revoke right after it); replacing an invoker
--     view without restating security_invoker; switching security_invoker off on a view with writes; a GRANT of INSERT,
--     UPDATE (also on one column), DELETE or TRUNCATE on an owner-run read-only view, directly or through ALL TABLES IN
--     SCHEMA; recreating that view plainly; a CREATE RULE that makes a counting view writable; OWNER TO a BYPASSRLS role;
--   * allowed: security_invoker views with their writes, views nothing can write through, the owner-run read-only
--     pattern and a later CREATE OR REPLACE of it, views outside public, geometry_columns, an owner subject to row
--     security, GRANTs that add no write;
--   * the trigger fires for roles that cannot execute its function, superusers included; the migration is idempotent
--     and refuses to install over an open hole;
--   * the daily query finds exactly the holes the guard refuses (made with the trigger disabled), the allowed name with
--     them, and with those holes open a GRANT on any table fails naming them; one of them really lets anon delete a row
--     the table's policy hides from it.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.fx_notes') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database';
  END IF;
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Run as a superuser: vanilla PG17 lets only a superuser create an event trigger';
  END IF;
END $$;
SET statement_timeout = '60s';
SET lock_timeout = '3s';

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dm_contract_view_owner') THEN CREATE ROLE dm_contract_view_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dm_contract_rls_owner') THEN CREATE ROLE dm_contract_rls_owner NOLOGIN; END IF;
END $$;
-- dm_contract_view_owner stands in for postgres on Supabase; dm_contract_rls_owner is subject to row security.
ALTER ROLE dm_contract_view_owner NOSUPERUSER BYPASSRLS;
ALTER ROLE dm_contract_rls_owner NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE, CREATE ON SCHEMA public TO dm_contract_view_owner, dm_contract_rls_owner;
ALTER DEFAULT PRIVILEGES FOR ROLE dm_contract_view_owner IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE dm_contract_rls_owner IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE SCHEMA fx_private AUTHORIZATION dm_contract_view_owner;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
-- refusal(statements) runs them in order. When the guard refuses one, every one of them is undone and the guard's
-- message comes back; when none is refused they stay done and the result is NULL. Any other error fails the contract.
CREATE FUNCTION pg_temp.refusal(VARIADIC p_sql text[]) RETURNS text LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY p_sql LOOP EXECUTE s; END LOOP;
  RETURN NULL;
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'view_write_guard: %' THEN RAISE; END IF;
  RETURN SQLERRM;
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
-- The guard's message for a tag and the views it names.
CREATE FUNCTION pg_temp.msg(p_tag text, p_views text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format('view_write_guard: %s leaves %s writable by anon or authenticated while it runs as its owner, so a write through it skips row-level security', p_tag, p_views)
$$;

\ir ../migrations/20261014214500_view_write_guard.sql
\ir ../migrations/20261014214500_view_write_guard.sql
SELECT pg_temp.ok('the migration, applied twice, leaves one enabled event trigger on the five tags',
  (SELECT count(*) FROM pg_event_trigger WHERE evtname = 'view_write_guard' AND evtevent = 'ddl_command_end'
      AND evtenabled = 'O' AND evtfoid = 'public.view_write_guard()'::regprocedure
      AND evttags @> ARRAY['CREATE VIEW', 'ALTER VIEW', 'ALTER TABLE', 'CREATE RULE', 'GRANT'] AND cardinality(evttags) = 5) = 1);
SELECT pg_temp.ok('no API role and not the view owner can execute the trigger function',
  NOT has_function_privilege('anon', 'public.view_write_guard()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.view_write_guard()', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.view_write_guard()', 'EXECUTE')
  AND NOT has_function_privilege('dm_contract_view_owner', 'public.view_write_guard()', 'EXECUTE'));

-- A row-secured table: everyone reads the rows not hidden; no policy lets anyone write.
SET ROLE dm_contract_view_owner;
CREATE TABLE public.fx_notes (id integer PRIMARY KEY, body text, hidden boolean NOT NULL DEFAULT false);
INSERT INTO public.fx_notes VALUES (1, 'shown', false), (2, 'hidden', true);
ALTER TABLE public.fx_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY fx_notes_read ON public.fx_notes FOR SELECT USING (NOT hidden);

-- Creating views.
SELECT pg_temp.ok('a plain view over one table is refused and named',
  pg_temp.refusal($q$CREATE VIEW public.fx_plain AS SELECT id, body FROM public.fx_notes$q$)
    = pg_temp.msg('CREATE VIEW', 'public.fx_plain'));
SELECT pg_temp.ok('... even when the next statement would revoke its writes',
  pg_temp.refusal($q$CREATE VIEW public.fx_plain AS SELECT id, body FROM public.fx_notes$q$,
                  $q$REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.fx_plain FROM anon, authenticated$q$)
    = pg_temp.msg('CREATE VIEW', 'public.fx_plain'));
SELECT pg_temp.ok('... and nothing is left behind', to_regclass('public.fx_plain') IS NULL);
SELECT pg_temp.ok('a security_invoker view and a view nothing can write through are created',
  pg_temp.refusal($q$CREATE VIEW public.fx_invoker WITH (security_invoker = true) AS SELECT id, body FROM public.fx_notes$q$,
                  $q$CREATE VIEW public.fx_counts AS SELECT count(*) AS n FROM public.fx_notes$q$) IS NULL);
SELECT pg_temp.ok('... the invoker view keeps the default writes, the counting view cannot be written through',
  has_table_privilege('anon', 'public.fx_invoker', 'DELETE')
  AND has_table_privilege('authenticated', 'public.fx_invoker', 'INSERT')
  AND pg_relation_is_updatable('public.fx_counts'::regclass, false) = 0);

-- Changing an invoker view that keeps writes.
SELECT pg_temp.ok('replacing it without restating security_invoker is refused (a replace resets the options it omits)',
  pg_temp.refusal($q$CREATE OR REPLACE VIEW public.fx_invoker AS SELECT id, body FROM public.fx_notes$q$)
    = pg_temp.msg('CREATE VIEW', 'public.fx_invoker'));
SELECT pg_temp.ok('switching security_invoker off is refused in every spelling',
  pg_temp.refusal($q$ALTER VIEW public.fx_invoker RESET (security_invoker)$q$) = pg_temp.msg('ALTER VIEW', 'public.fx_invoker')
  AND pg_temp.refusal($q$ALTER VIEW public.fx_invoker SET (security_invoker = false)$q$) = pg_temp.msg('ALTER VIEW', 'public.fx_invoker')
  AND pg_temp.refusal($q$ALTER TABLE public.fx_invoker SET (security_invoker = off)$q$) = pg_temp.msg('ALTER TABLE', 'public.fx_invoker'));
SELECT pg_temp.ok('... and it is still a security_invoker view',
  (SELECT reloptions FROM pg_class WHERE oid = 'public.fx_invoker'::regclass) = '{security_invoker=true}');
SELECT pg_temp.ok('replacing it with security_invoker restated is allowed',
  pg_temp.refusal($q$CREATE OR REPLACE VIEW public.fx_invoker WITH (security_invoker = true) AS SELECT id, body, hidden FROM public.fx_notes$q$) IS NULL);

-- An owner-run view for reads only.
SELECT pg_temp.ok('the owner-run read-only pattern goes through: created invoker, writes revoked, then reset',
  pg_temp.refusal($q$CREATE VIEW public.fx_readonly WITH (security_invoker = true) AS SELECT id, body FROM public.fx_notes$q$,
                  $q$REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.fx_readonly FROM anon, authenticated$q$,
                  $q$ALTER VIEW public.fx_readonly RESET (security_invoker)$q$) IS NULL);
SELECT pg_temp.ok('... it runs as its owner and grants no write',
  (SELECT reloptions FROM pg_class WHERE oid = 'public.fx_readonly'::regclass) IS NULL
  AND has_table_privilege('anon', 'public.fx_readonly', 'SELECT')
  AND NOT has_any_column_privilege('anon', 'public.fx_readonly', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.fx_readonly', 'DELETE'));
SELECT pg_temp.ok('a GRANT of any write on it is refused: INSERT, UPDATE, one column, DELETE, TRUNCATE, ALL TABLES IN SCHEMA',
  pg_temp.refusal($q$GRANT INSERT ON public.fx_readonly TO anon$q$) = pg_temp.msg('GRANT', 'public.fx_readonly')
  AND pg_temp.refusal($q$GRANT UPDATE ON public.fx_readonly TO authenticated$q$) = pg_temp.msg('GRANT', 'public.fx_readonly')
  AND pg_temp.refusal($q$GRANT UPDATE (body) ON public.fx_readonly TO anon$q$) = pg_temp.msg('GRANT', 'public.fx_readonly')
  AND pg_temp.refusal($q$GRANT DELETE ON public.fx_readonly TO authenticated$q$) = pg_temp.msg('GRANT', 'public.fx_readonly')
  AND pg_temp.refusal($q$GRANT TRUNCATE ON public.fx_readonly TO anon$q$) = pg_temp.msg('GRANT', 'public.fx_readonly')
  AND pg_temp.refusal($q$GRANT ALL ON ALL TABLES IN SCHEMA public TO anon$q$) = pg_temp.msg('GRANT', 'public.fx_readonly'));
SELECT pg_temp.ok('... none of them landed',
  NOT has_any_column_privilege('anon', 'public.fx_readonly', 'INSERT')
  AND NOT has_any_column_privilege('anon', 'public.fx_readonly', 'UPDATE')
  AND NOT has_any_column_privilege('authenticated', 'public.fx_readonly', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.fx_readonly', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.fx_readonly', 'TRUNCATE'));
SELECT pg_temp.ok('a GRANT that adds no write passes',
  pg_temp.refusal($q$GRANT SELECT ON public.fx_readonly, public.fx_notes TO anon, authenticated$q$) IS NULL);
SELECT pg_temp.ok('replacing it plainly keeps its revoked grants and passes',
  pg_temp.refusal($q$CREATE OR REPLACE VIEW public.fx_readonly AS SELECT id, body, hidden FROM public.fx_notes$q$) IS NULL);
SELECT pg_temp.ok('dropping and recreating it plainly is refused: a new view takes the default grants',
  pg_temp.refusal($q$DROP VIEW public.fx_readonly$q$,
                  $q$CREATE VIEW public.fx_readonly AS SELECT id, body FROM public.fx_notes$q$)
    = pg_temp.msg('CREATE VIEW', 'public.fx_readonly'));
SELECT pg_temp.ok('... and the drop is undone with it',
  to_regclass('public.fx_readonly') IS NOT NULL
  AND NOT has_table_privilege('anon', 'public.fx_readonly', 'INSERT'));

-- Rules, places and names the guard does not refuse.
SELECT pg_temp.ok('a rule that makes the counting view writable is refused',
  pg_temp.refusal($q$CREATE RULE fx_counts_delete AS ON DELETE TO public.fx_counts DO INSTEAD DELETE FROM public.fx_notes$q$)
    = pg_temp.msg('CREATE RULE', 'public.fx_counts'));
SELECT pg_temp.ok('... and is not left behind', NOT EXISTS (SELECT 1 FROM pg_rules WHERE rulename = 'fx_counts_delete'));
SELECT pg_temp.ok('a plain view outside public and the allowed geometry_columns are created with their writes',
  pg_temp.refusal($q$CREATE VIEW fx_private.fx_plain AS SELECT id, body FROM public.fx_notes$q$,
                  $q$GRANT ALL ON fx_private.fx_plain TO anon$q$,
                  $q$CREATE VIEW public.geometry_columns AS SELECT id, body FROM public.fx_notes$q$) IS NULL);
SELECT pg_temp.ok('... writable by anon',
  has_table_privilege('anon', 'fx_private.fx_plain', 'DELETE') AND has_table_privilege('anon', 'public.geometry_columns', 'DELETE'));
RESET ROLE;

-- Owners.
SELECT pg_temp.ok('an owner subject to row security may run a writable view as itself',
  pg_temp.refusal($q$ALTER VIEW public.fx_invoker OWNER TO dm_contract_rls_owner$q$,
                  $q$ALTER VIEW public.fx_invoker RESET (security_invoker)$q$) IS NULL);
SELECT pg_temp.ok('handing that view to a BYPASSRLS owner is refused, by ALTER VIEW or ALTER TABLE, to a superuser too',
  pg_temp.refusal($q$ALTER VIEW public.fx_invoker OWNER TO dm_contract_view_owner$q$) = pg_temp.msg('ALTER VIEW', 'public.fx_invoker')
  AND pg_temp.refusal($q$ALTER TABLE public.fx_invoker OWNER TO dm_contract_view_owner$q$) = pg_temp.msg('ALTER TABLE', 'public.fx_invoker'));
SELECT pg_temp.ok('... and its owner is unchanged',
  (SELECT relowner::regrole::text FROM pg_class WHERE oid = 'public.fx_invoker'::regclass) = 'dm_contract_rls_owner');

-- The daily query, against holes made with the trigger disabled.
ALTER EVENT TRIGGER view_write_guard DISABLE;
SET ROLE dm_contract_view_owner;
CREATE VIEW public.fx_hole_plain AS SELECT id, body FROM public.fx_notes;
CREATE VIEW public.fx_hole_column WITH (security_invoker = true) AS SELECT id, body FROM public.fx_notes;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.fx_hole_column FROM anon, authenticated;
ALTER VIEW public.fx_hole_column RESET (security_invoker);
GRANT UPDATE (body) ON public.fx_hole_column TO anon;
RESET ROLE;
ALTER EVENT TRIGGER view_write_guard ENABLE;
-- The daily query exactly as scripts/ci/owner-writable-views.mjs exports it.
\set detector `node --input-type=module -e "import { OWNER_WRITABLE_VIEWS_SQL as s } from './scripts/ci/owner-writable-views.mjs'; process.stdout.write(s)"`
CREATE TEMP VIEW owner_writable_views_detector AS :detector;
SELECT pg_temp.ok('the daily query finds exactly the two holes and the allowed name, each with its writes',
  (SELECT string_agg(view || ' ' || owner || ' ' || writes, ' | ' ORDER BY view) FROM owner_writable_views_detector)
  = 'fx_hole_column dm_contract_view_owner anon:UPDATE'
    || ' | fx_hole_plain dm_contract_view_owner anon:INSERT,anon:UPDATE,anon:DELETE,anon:TRUNCATE,authenticated:INSERT,authenticated:UPDATE,authenticated:DELETE,authenticated:TRUNCATE'
    || ' | geometry_columns dm_contract_view_owner anon:INSERT,anon:UPDATE,anon:DELETE,anon:TRUNCATE,authenticated:INSERT,authenticated:UPDATE,authenticated:DELETE,authenticated:TRUNCATE');
SET ROLE anon;
SELECT pg_temp.ok('the plain hole is real: anon deletes through it the row the table hides, which the table itself refuses',
  (SELECT count(*) FROM public.fx_notes) = 1
  AND pg_temp.rows($q$DELETE FROM public.fx_notes WHERE id = 2$q$) = 0
  AND pg_temp.rows($q$DELETE FROM public.fx_hole_plain WHERE id = 2$q$) = 1);
RESET ROLE;
SET ROLE dm_contract_view_owner;
SELECT pg_temp.ok('with the holes open, a GRANT on any table fails naming both of them and not the allowed name',
  pg_temp.refusal($q$GRANT SELECT ON public.fx_notes TO anon$q$) = pg_temp.msg('GRANT', 'public.fx_hole_column, public.fx_hole_plain'));
SELECT pg_temp.ok('... while an ALTER TABLE on a table reads no view and passes',
  pg_temp.refusal($q$ALTER TABLE public.fx_notes ADD COLUMN extra text$q$) IS NULL);
RESET ROLE;
\echo 'Expected next: the migration refuses to install over the two open holes (its error prints below).'
\set ON_ERROR_STOP off
\ir ../migrations/20261014214500_view_write_guard.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('the migration refuses to install over an open hole, and the trigger stays as it was',
  :'LAST_ERROR_MESSAGE' = 'view_write_guard: public.fx_hole_column, public.fx_hole_plain already writable by anon or authenticated while running as the owner; close it first (20261014124500_owner_view_writes_revoked.sql is the pattern)'
  AND (SELECT evtenabled FROM pg_event_trigger WHERE evtname = 'view_write_guard') = 'O');

DROP VIEW public.fx_hole_plain, public.fx_hole_column;
SELECT pg_temp.ok('closed again, the daily query lists only the allowed name and a GRANT passes',
  (SELECT string_agg(view, ',') FROM owner_writable_views_detector) = 'geometry_columns'
  AND pg_temp.refusal($q$GRANT SELECT ON public.fx_notes TO anon$q$) IS NULL);
