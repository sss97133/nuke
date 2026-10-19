-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_build -f supabase/sql/test_k5_harness_build_events.sql
-- Proves 20261014233000_k5_harness_build_events.sql on top of RSI pass 7: every change of build_state is logged with who
-- and when, a same-value write logs nothing, the log refuses updates and deletes, and the scoreboard counts wires with
-- a recorded build step.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_geometry_check.sql

CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.auth_role', true), '') $$;
CREATE OR REPLACE FUNCTION public.vein_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: register a new version or append a new run', TG_TABLE_NAME;
END;
$$;
INSERT INTO public.schema_proposals VALUES ('6e3ceb06-2547-4091-8f94-dbde0c184b05', 'approved');

\i supabase/migrations/20261014233000_k5_harness_build_events.sql

-- #110 cut by a migration-role write, then terminated by the signed-in owner; a same-value write logs nothing.
UPDATE public.vehicle_custom_circuits SET build_state = 'cut' WHERE id = '00000000-0000-0000-0000-000000000a01';
SELECT set_config('test.auth_uid', '00000000-0000-0000-0000-00000000f00d', false), set_config('test.auth_role', 'authenticated', false);
UPDATE public.vehicle_custom_circuits SET build_state = 'terminated_a' WHERE id = '00000000-0000-0000-0000-000000000a01';
UPDATE public.vehicle_custom_circuits SET build_state = 'terminated_a' WHERE id = '00000000-0000-0000-0000-000000000a01';
UPDATE public.vehicle_custom_circuits SET circuit_name = 'coolant temp (renamed)' WHERE id = '00000000-0000-0000-0000-000000000a01';
SELECT set_config('test.auth_uid', '', false), set_config('test.auth_role', '', false);

DO $$
DECLARE n int; got text;
BEGIN
  SELECT string_agg(from_state || '>' || to_state || ':' || actor_role || ':' || coalesce(actor_user_id::text, '-'), ' | ' ORDER BY observed_at, from_state DESC) INTO got
  FROM public.harness_build_events WHERE circuit_id = '00000000-0000-0000-0000-000000000a01';
  IF got IS DISTINCT FROM 'uncut>cut:' || session_user || ':- | cut>terminated_a:authenticated:00000000-0000-0000-0000-00000000f00d' THEN
    RAISE EXCEPTION 'build log: %', got;
  END IF;
  BEGIN
    UPDATE public.harness_build_events SET to_state = 'verified';
    RAISE EXCEPTION 'the build log accepted an update';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%append-only%' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.harness_build_events;
    RAISE EXCEPTION 'the build log accepted a delete';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%append-only%' THEN RAISE; END IF;
  END;
  SELECT numerator || '/' || denominator INTO got FROM public.v_harness_coverage WHERE measure = 'decided wires with a recorded build step';
  IF got IS DISTINCT FROM '1/15' THEN RAISE EXCEPTION 'outcome measure: %', got; END IF;
  SELECT count(*) INTO n FROM public.stack_needs WHERE stack_id = 'SH';
  IF n <> 22 THEN RAISE EXCEPTION 'SH needs: got %, want 22', n; END IF;
  IF has_table_privilege('anon', 'public.harness_build_events', 'INSERT') OR NOT has_table_privilege('anon', 'public.harness_build_events', 'SELECT') THEN
    RAISE EXCEPTION 'build log grants';
  END IF;
END $$;

SELECT 'test_k5_harness_build_events: PASS' AS result;
