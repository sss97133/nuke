-- Lock 4 of the data locks (P3.5 of the approved lock-down plan, 2026-09-27): the DDL tripwire.
-- Every DDL command run in this database (who, when, what, the statement text) lands in
-- public.ddl_audit_log through two event triggers.
--
-- THIS IS A TRIPWIRE, NOT A LOCK. Locks 1-3 bind every non-owner role; the owner (postgres — the CI
-- connection, the Management API, anyone with the database password) can still DROP a trigger, DROP a
-- constraint or GRANT DELETE. This file makes such a command leave a row: command tag, object, role,
-- application, client address and the statement text. The owner can also disable this tripwire
-- (ALTER EVENT TRIGGER ... DISABLE / DROP EVENT TRIGGER), and event triggers do not fire for commands on
-- event triggers themselves, so that act is NOT recorded here. Detection, not prevention: the daily
-- ledger drift check (P3.5) is what reads this table.
--
-- SCHEMA_LAW pre-mint checklist (a new table is minted here; the seven questions):
--  1. §1 search: security_audit_log (1 row, 0 writer functions, admin-only RLS; columns user_id / ip /
--     user_agent — an HTTP-identity event log), vehicle_edit_audit (row edits on vehicles),
--     analytics_audit_log (report runs), pii_audit_log, reattribution_audit, schema_migrations (CI's
--     applied list, no executor). None records a DDL command with its database identity and statement
--     text; folding DDL into security_audit_log would make its jsonb `details` the schema. No fit → mint.
--  2. §2 not a fact about a vehicle; it is a fact about the database. Not an observation row.
--  3. §3 DNA: occurred_at, session_user_name/current_user_name (who), application_name/client_addr
--     (where from), command_tag/object_type/object_identity (what), query_text (the evidence). Trust is
--     T1 (recorded by the server itself). Vocabulary of command_tag is PostgreSQL's own.
--  4. §4 no view can produce this (the information is gone once the command finishes); rows are
--     append-only, never corrected.
--  5. §5 invariants: RLS on, no policies, no INSERT/UPDATE/DELETE grant to any non-owner role; the trigger
--     functions are SECURITY DEFINER so the row is written whoever ran the DDL. Attack test at the bottom.
--  6. §6 writers: the two event-trigger functions only. Readers: the owner and service_role (SELECT).
--  7. §7 this migration; RLS enabled explicitly (the ensure_rls event trigger would do it anyway).
--
-- Noise control: temporary objects (pg_temp_* schemas — nine functions create temp tables) and
-- REFRESH MATERIALIZED VIEW (a cron rhythm, not a schema change) are skipped. A failure inside the
-- trigger function never fails the DDL (WARNING to the server log instead) — a tripwire that blocks a CI
-- migration would be removed within a day.
--
-- Supabase specifics: CREATE EVENT TRIGGER is allowed for postgres through supautils (ensure_rls is an
-- existing postgres-owned event trigger). Verified in a rolled-back transaction on 2026-09-27 before this
-- file shipped: CREATE TABLE, ALTER TABLE ... DISABLE/ENABLE TRIGGER on vehicles, GRANT, REVOKE and
-- DROP TABLE each left a row with session_user postgres, the client address, application_name
-- 'mgmt-api' and the statement text; a CREATE TEMP TABLE left none.

SET statement_timeout = '120s';
SET lock_timeout = '10s';

-- ─── 1. The table ─────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ddl_audit_log (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  event              text NOT NULL,                 -- 'ddl_command_end' | 'sql_drop'
  command_tag        text NOT NULL,                 -- 'ALTER TABLE', 'DROP TRIGGER', 'GRANT', ...
  object_type        text,                          -- 'table', 'trigger', 'function', 'table constraint', ...
  schema_name        text,
  object_identity    text,                          -- 'public.vehicles', 'public.f(text)', ...
  session_user_name  text NOT NULL,                 -- the login role (postgres, supabase_admin, ...)
  current_user_name  text NOT NULL,                 -- after SET ROLE, if any
  application_name   text,                          -- psql, PostgREST, pg_cron, the dashboard, ...
  client_addr        inet,
  backend_pid        integer,
  transaction_id     bigint,
  query_text         text                           -- current_query(), first 8,000 characters
);

COMMENT ON TABLE public.ddl_audit_log IS
  'DDL tripwire (2026-09-27): one row per DDL command (and per dropped object), written by the event triggers ddl_audit_command_end / ddl_audit_sql_drop. Append-only; readable by the owner and service_role. Detection, not prevention: the owner can disable the triggers and that act is not recorded here.';

CREATE INDEX IF NOT EXISTS ddl_audit_log_occurred_at_idx ON public.ddl_audit_log (occurred_at DESC);

ALTER TABLE public.ddl_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ddl_audit_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ddl_audit_log TO service_role;
-- no policies: anon/authenticated have no grant at all; service_role bypasses RLS and may only SELECT.

-- ─── 2. The recorders (SECURITY DEFINER: the row is written whoever ran the DDL) ─────────────────
CREATE OR REPLACE FUNCTION public.ddl_audit_command_end()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  r         record;
  v_seen    integer := 0;
  v_written integer := 0;
BEGIN
  IF tg_tag = 'REFRESH MATERIALIZED VIEW' THEN
    RETURN;
  END IF;

  FOR r IN SELECT command_tag, object_type, schema_name, object_identity
             FROM pg_catalog.pg_event_trigger_ddl_commands()
  LOOP
    v_seen := v_seen + 1;
    IF r.schema_name LIKE 'pg\_temp%' OR r.schema_name LIKE 'pg\_toast%' THEN
      CONTINUE;
    END IF;
    INSERT INTO public.ddl_audit_log
      (event, command_tag, object_type, schema_name, object_identity,
       session_user_name, current_user_name, application_name, client_addr, backend_pid, transaction_id, query_text)
    VALUES
      (tg_event, COALESCE(r.command_tag, tg_tag), r.object_type, r.schema_name, r.object_identity,
       session_user, current_user, current_setting('application_name', true), inet_client_addr(),
       pg_backend_pid(), pg_current_xact_id()::text::bigint, left(current_query(), 8000));
    v_written := v_written + 1;
  END LOOP;

  -- Commands that report no object (GRANT, REVOKE, ALTER ... SET, ...) still leave one row. DROP
  -- commands report nothing here either, but ddl_audit_sql_drop already recorded them with the
  -- object identity, so they are not doubled.
  IF v_seen = 0 AND tg_tag NOT LIKE 'DROP %' THEN
    INSERT INTO public.ddl_audit_log
      (event, command_tag, session_user_name, current_user_name, application_name, client_addr,
       backend_pid, transaction_id, query_text)
    VALUES
      (tg_event, tg_tag, session_user, current_user, current_setting('application_name', true),
       inet_client_addr(), pg_backend_pid(), pg_current_xact_id()::text::bigint, left(current_query(), 8000));
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ddl_audit_log: could not record % (%: %)', tg_tag, SQLSTATE, SQLERRM;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ddl_audit_sql_drop()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT object_type, schema_name, object_identity, is_temporary, original, normal
             FROM pg_catalog.pg_event_trigger_dropped_objects()
  LOOP
    -- roots and their normal dependents only; internal sub-objects (a table's own indexes, types,
    -- constraints) would triple the rows without adding a fact
    IF r.is_temporary OR NOT (r.original OR r.normal) OR r.schema_name LIKE 'pg\_temp%' THEN
      CONTINUE;
    END IF;
    INSERT INTO public.ddl_audit_log
      (event, command_tag, object_type, schema_name, object_identity,
       session_user_name, current_user_name, application_name, client_addr, backend_pid, transaction_id, query_text)
    VALUES
      (tg_event, tg_tag, r.object_type, r.schema_name, r.object_identity,
       session_user, current_user, current_setting('application_name', true), inet_client_addr(),
       pg_backend_pid(), pg_current_xact_id()::text::bigint, left(current_query(), 8000));
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ddl_audit_log: could not record drop under % (%: %)', tg_tag, SQLSTATE, SQLERRM;
END;
$fn$;

REVOKE ALL ON FUNCTION public.ddl_audit_command_end() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.ddl_audit_sql_drop()    FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.ddl_audit_command_end() IS 'DDL tripwire recorder (ddl_command_end). Fail-open: a failure here is a WARNING, never a failed DDL.';
COMMENT ON FUNCTION public.ddl_audit_sql_drop()    IS 'DDL tripwire recorder (sql_drop). Fail-open: a failure here is a WARNING, never a failed DDL.';

-- ─── 3. The event triggers ────────────────────────────────────────────────────────────────────────
DROP EVENT TRIGGER IF EXISTS ddl_audit_command_end;
CREATE EVENT TRIGGER ddl_audit_command_end ON ddl_command_end
  EXECUTE FUNCTION public.ddl_audit_command_end();

DROP EVENT TRIGGER IF EXISTS ddl_audit_sql_drop;
CREATE EVENT TRIGGER ddl_audit_sql_drop ON sql_drop
  EXECUTE FUNCTION public.ddl_audit_sql_drop();

COMMENT ON EVENT TRIGGER ddl_audit_command_end IS 'DDL tripwire (2026-09-27). The owner can disable it; disabling it is not recorded. See public.ddl_audit_log.';
COMMENT ON EVENT TRIGGER ddl_audit_sql_drop    IS 'DDL tripwire (2026-09-27). The owner can disable it; disabling it is not recorded. See public.ddl_audit_log.';

-- ─── Live verification (run after apply) ─────────────────────────────────────────────────────────
-- SELECT evtname, evtenabled FROM pg_event_trigger WHERE evtname LIKE 'ddl_audit%';   -> 2 rows, 'O'
-- The apply itself is the first proof: this file's own CREATE FUNCTION / CREATE EVENT TRIGGER / COMMENT
-- statements after step 3 appear in the table:
-- SELECT occurred_at, command_tag, object_identity, session_user_name, application_name, left(query_text, 60)
--   FROM public.ddl_audit_log ORDER BY id DESC LIMIT 10;
-- Attack test (rolled back): BEGIN; ALTER TABLE public.vehicles DISABLE TRIGGER trg_guard_vehicle_sale_price;
--   SELECT command_tag, object_identity, query_text FROM public.ddl_audit_log ORDER BY id DESC LIMIT 1;
--   -> 'ALTER TABLE' | 'public.vehicles' | the statement.   ROLLBACK;
