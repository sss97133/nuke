-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_splices_where -f supabase/sql/test_k5_harness_splices_where.sql
-- Proves 20261015093000_k5_harness_splices_where.sql on top of RSI pass 16: every UPDATE and DELETE in the functions the
-- registry loader calls carries a top-level WHERE (the production API refuses one without, even inside a function; this
-- PG17 does not), and the re-issued writer still loads, keeps and retires splices as before.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_splices.sql
\i supabase/migrations/20261015093000_k5_harness_splices_where.sql

DO $$
DECLARE f text; st text; t text; bad text[] := '{}'; seen int := 0;
BEGIN
  FOREACH f IN ARRAY ARRAY['load_harness_splices', 'refold_harness_nets', 'fold_harness_net_protection', 'load_pdm_settings',
                           'resync_harness_segments', 'key_harness_endpoints_to_topology', 'key_harness_wire_ends'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = f AND pronamespace = 'public'::regnamespace) THEN
      RAISE EXCEPTION 'loader function % is missing', f;
    END IF;
    FOR st IN SELECT s FROM pg_proc p,
                regexp_split_to_table(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '''([^'']|'''')*''', '''''', 'g'), ';') s
              WHERE p.proname = f AND p.pronamespace = 'public'::regnamespace LOOP
      LOOP t := regexp_replace(st, '\([^()]*\)', ' ', 'g'); EXIT WHEN t = st; st := t; END LOOP;   -- drop subqueries
      IF st ~* '(^|\s)(UPDATE\s+\S+\s+(\S+\s+)?SET|DELETE\s+FROM)\M' THEN
        seen := seen + 1;
        IF st !~* '\mWHERE\M' THEN bad := bad || (f || ': ' || left(regexp_replace(btrim(st), '\s+', ' ', 'g'), 90)); END IF;
      END IF;
    END LOOP;
  END LOOP;
  IF cardinality(bad) > 0 THEN RAISE EXCEPTION 'UPDATE or DELETE with no WHERE (production refuses them): %', bad; END IF;
  RAISE NOTICE 'checked % UPDATE/DELETE statements in the loader''s functions: each has a WHERE', seen;
END $$;

DO $$
DECLARE r jsonb; n int;
BEGIN
  SELECT count(*) INTO n FROM public.harness_splices WHERE NOT is_superseded;
  r := public.load_harness_splices('e08bf694-970f-4cbe-8a74-8715158a0f2e', '[
    {"at": "PDM30-A A02", "wires": ["TP1", "TP2", "20 AWG pin lead"], "splice": "D-609-04", "equiv_awg": 16},
    {"at": "SPL-X", "wires": ["L0", "L1", "L2"], "splice": "M81824/1-2", "type": "in-line", "sides": [["L0"], ["L1", "L2"]], "equiv_awg": [20, 17]}
  ]', 'fixture registry @ test');
  IF (r->>'splices_kept')::int <> 2 OR (r->>'splices_written')::int <> 0 OR (r->>'splices_retired')::int <> n - 2 THEN
    RAISE EXCEPTION 're-issued writer: %', r;
  END IF;
  IF has_function_privilege('anon', 'public.load_harness_splices(uuid,jsonb,text)', 'EXECUTE') THEN RAISE EXCEPTION 'the public can write splices'; END IF;
END $$;

SELECT 'test_k5_harness_splices_where: PASS' AS result;
