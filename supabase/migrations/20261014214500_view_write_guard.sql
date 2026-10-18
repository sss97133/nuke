-- No view in public can again let anon or authenticated write past row-level security.
--
-- A view without security_invoker runs as its owner. When the owner bypasses row-level security (postgres does on
-- Supabase) and the view is auto-updatable (pg_relation_is_updatable mask 28: INSERT, UPDATE, DELETE), a write through
-- it reaches the table below with no policy applied. Supabase's default privileges grant anon and authenticated ALL on
-- every new relation in public, so a plain CREATE VIEW over one table opens such a hole at once. On 2026-10-14
-- production held 21; 20261014124500_owner_view_writes_revoked and 20261014130000_vehicle_timeline_events_invoker
-- closed them. Measured again at ~11:20Z: 258 views in public, all owned by postgres or supabase_admin (both
-- BYPASSRLS), 86 with security_invoker, 46 updatable, and one that matches: geometry_columns, allowed below.
--
-- The event trigger view_write_guard runs at the end of CREATE VIEW, ALTER VIEW, ALTER TABLE, CREATE RULE and GRANT,
-- and fails the statement when it leaves a view in public that is owner-run (a BYPASSRLS owner, no security_invoker),
-- auto-updatable, and writable by anon or authenticated: INSERT or UPDATE on the view or on any of its columns, DELETE,
-- or TRUNCATE. CREATE VIEW, ALTER and CREATE RULE check the views they touch. A GRANT reports no object to an event
-- trigger, so a GRANT on tables or views checks every view in public (118 ms for 258 views on production,
-- 2026-10-14). What fails:
--   * a migration creating such a view, even when a later statement would revoke its writes: create it
--     WITH (security_invoker = true) so the policies of the table below apply to its callers;
--   * CREATE OR REPLACE VIEW public.vehicle_timeline_events without WITH (security_invoker = true) (a replace resets
--     every option it does not restate), and ALTER VIEW ... RESET (security_invoker) on any view that keeps writes;
--   * a GRANT of a write on one of the 20 views 20261014124500 closed, an ALTER ... OWNER TO a BYPASSRLS role, or a
--     CREATE RULE that makes such a view writable.
-- A view that must run as its owner to read (it shows what the caller cannot read in the table below) and takes no
-- writes: create it WITH (security_invoker = true), REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON it FROM anon,
-- authenticated, then ALTER VIEW ... RESET (security_invoker). A later CREATE OR REPLACE keeps the revoked grants.
--
-- Allowed: geometry_columns. PostGIS owns it (supabase_admin) and replaces it on extension updates; its INSERT,
-- UPDATE and DELETE rules are DO INSTEAD NOTHING, so a write through it changes nothing.
--
-- Unlike ddl_audit_command_end (20260927170300), this trigger fails the command it reads: blocking is its job. What it
-- cannot see, the daily check does: scripts/data/readme-stats.mjs runs scripts/ci/owner-writable-views.mjs against the
-- live catalog and exits 1 while any view outside the allowed one matches, which covers a role given BYPASSRLS
-- (ALTER ROLE fires no event trigger) and this trigger disabled or dropped.
-- Contract: supabase/sql/test_view_write_guard.sql (scripts/ci/run-db-contracts.sh, job db-contracts).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.view_write_guard()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_views oid[];
  v_holes text;
BEGIN
  IF tg_tag = 'GRANT' THEN
    -- A GRANT names no object here. One on tables or views reads every view in public; others read none.
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger_ddl_commands() d WHERE d.object_type = 'TABLE') THEN
      RETURN;
    END IF;
    SELECT pg_catalog.array_agg(c.oid) INTO v_views
      FROM pg_catalog.pg_class c
     WHERE c.relnamespace = 'public'::pg_catalog.regnamespace AND c.relkind = 'v';
  ELSE
    -- A rule is reported as itself; the view it belongs to is what changed. CREATE OR REPLACE reports a view twice.
    SELECT pg_catalog.array_agg(DISTINCT CASE WHEN d.classid = 'pg_catalog.pg_rewrite'::pg_catalog.regclass
                                              THEN (SELECT r.ev_class FROM pg_catalog.pg_rewrite r WHERE r.oid = d.objid)
                                              ELSE d.objid END)
      INTO v_views
      FROM pg_catalog.pg_event_trigger_ddl_commands() d
     WHERE d.classid IN ('pg_catalog.pg_class'::pg_catalog.regclass, 'pg_catalog.pg_rewrite'::pg_catalog.regclass);
  END IF;
  IF v_views IS NULL THEN
    RETURN;
  END IF;

  SELECT pg_catalog.string_agg(pg_catalog.format('public.%I', c.relname), ', ' ORDER BY c.relname)
    INTO v_holes
    FROM pg_catalog.unnest(v_views) t(oid)
    JOIN pg_catalog.pg_class c ON c.oid = t.oid
    JOIN pg_catalog.pg_roles o ON o.oid = c.relowner
   WHERE c.relnamespace = 'public'::pg_catalog.regnamespace
     AND c.relkind = 'v'
     AND c.relname <> 'geometry_columns'
     AND o.rolbypassrls
     AND NOT COALESCE((SELECT x.option_value::boolean FROM pg_catalog.pg_options_to_table(c.reloptions) x
                        WHERE x.option_name = 'security_invoker'), false)
     AND (pg_catalog.pg_relation_is_updatable(c.oid, false) & 28) > 0
     AND EXISTS (SELECT 1 FROM pg_catalog.unnest(ARRAY['anon', 'authenticated']) r(role)
                  WHERE pg_catalog.has_any_column_privilege(r.role, c.oid, 'INSERT')
                     OR pg_catalog.has_any_column_privilege(r.role, c.oid, 'UPDATE')
                     OR pg_catalog.has_table_privilege(r.role, c.oid, 'DELETE')
                     OR pg_catalog.has_table_privilege(r.role, c.oid, 'TRUNCATE'));

  IF v_holes IS NOT NULL THEN
    RAISE EXCEPTION 'view_write_guard: % leaves % writable by anon or authenticated while it runs as its owner, so a write through it skips row-level security', tg_tag, v_holes
      USING HINT = 'Create or replace the view WITH (security_invoker = true), or revoke INSERT, UPDATE, DELETE, TRUNCATE on it from anon and authenticated. supabase/migrations/20261014214500_view_write_guard.sql has the cases.';
  END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.view_write_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP EVENT TRIGGER IF EXISTS view_write_guard;
CREATE EVENT TRIGGER view_write_guard ON ddl_command_end
  WHEN TAG IN ('CREATE VIEW', 'ALTER VIEW', 'ALTER TABLE', 'CREATE RULE', 'GRANT')
  EXECUTE FUNCTION public.view_write_guard();
COMMENT ON EVENT TRIGGER view_write_guard IS
  'Fails DDL that leaves a public view owner-run, auto-updatable and writable by anon or authenticated (2026-10-14). See supabase/migrations/20261014214500_view_write_guard.sql.';

-- Last, in the same transaction: no install over an open hole, or every later GRANT on a table would fail naming it.
DO $check$
DECLARE v_holes text;
BEGIN
  SELECT string_agg(format('public.%I', c.relname), ', ' ORDER BY c.relname) INTO v_holes
    FROM pg_class c
    JOIN pg_roles o ON o.oid = c.relowner
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v' AND c.relname <> 'geometry_columns'
     AND o.rolbypassrls
     AND NOT coalesce((SELECT x.option_value::boolean FROM pg_options_to_table(c.reloptions) x
                        WHERE x.option_name = 'security_invoker'), false)
     AND (pg_relation_is_updatable(c.oid, false) & 28) > 0
     AND EXISTS (SELECT 1 FROM unnest(ARRAY['anon', 'authenticated']) r(role)
                  WHERE has_any_column_privilege(r.role, c.oid, 'INSERT') OR has_any_column_privilege(r.role, c.oid, 'UPDATE')
                     OR has_table_privilege(r.role, c.oid, 'DELETE') OR has_table_privilege(r.role, c.oid, 'TRUNCATE'));
  IF v_holes IS NOT NULL THEN
    RAISE EXCEPTION 'view_write_guard: % already writable by anon or authenticated while running as the owner; close it first (20261014124500_owner_view_writes_revoked.sql is the pattern)', v_holes;
  END IF;
END
$check$;

COMMIT;
