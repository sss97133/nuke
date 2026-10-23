-- The DDL audit and the view write guard also fire in replica mode.
--
-- Found 2026-10-20 by the image and vehicle-record rebuild lane (code and catalog read, not exercised): ddl_audit_command_end,
-- ddl_audit_sql_drop (20260927170300, Lock 4) and view_write_guard (20261014214500) are event triggers enabled 'O' (origin only). An event
-- trigger of that mode does not fire in a session whose session_replication_role is 'replica', and the postgres role (a member of
-- supabase_privileged_role) may set it, which supautils allows. In such a session a DDL command leaves no ddl_audit_log row and a
-- view that visitors can write through is not refused. Last 24 h: 968 audited DDL events since 2026-10-19 21:00Z, all from the management API,
-- pg_cron and Supavisor; there is no evidence the gap was used.
--
-- Change: ALTER EVENT TRIGGER ... ENABLE ALWAYS (evtenabled 'A') on those three, so they fire in every session replication role.
-- This closes one silent path only. The tripwire's stated limits stand (20260927170300): the owner can still DISABLE or DROP an event
-- trigger, and event triggers do not fire for commands on event triggers; detection, not prevention. Supabase-owned event triggers
-- (pgrst_*, issue_*, pgsodium_*, ensure_rls) are not ours and are left alone.
-- The migration fails if a trigger is missing or does not end up 'A', so a silent miss cannot ship.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  v_name text;
  v_mode "char";
BEGIN
  FOREACH v_name IN ARRAY ARRAY['ddl_audit_command_end', 'ddl_audit_sql_drop', 'view_write_guard'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = v_name) THEN
      RAISE EXCEPTION 'event trigger % does not exist; nothing to enable', v_name;
    END IF;
    EXECUTE format('ALTER EVENT TRIGGER %I ENABLE ALWAYS', v_name);
    SELECT evtenabled INTO v_mode FROM pg_event_trigger WHERE evtname = v_name;
    IF v_mode <> 'A' THEN
      RAISE EXCEPTION 'event trigger % is %, expected A (ENABLE ALWAYS)', v_name, v_mode;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Live verification (after apply):
--   select evtname, evtenabled from pg_event_trigger where evtname in ('ddl_audit_command_end', 'ddl_audit_sql_drop', 'view_write_guard');  -- all 'A'
