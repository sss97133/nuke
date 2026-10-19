-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_grain -f supabase/sql/test_k5_harness_scoreboard_grain.sql
-- Proves 20261014235500_k5_harness_scoreboard_grain.sql on top of RSI pass 8: same rows and values, and every measure
-- names what it counts.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_build_events.sql

CREATE TEMP TABLE before_cov AS SELECT vehicle_id, layer, measure, numerator, denominator FROM public.v_harness_coverage;

\i supabase/migrations/20261014235500_k5_harness_scoreboard_grain.sql

DO $$
DECLARE n int; got text;
BEGIN
  SELECT count(*) INTO n FROM (
    (SELECT vehicle_id, layer, measure, numerator, denominator FROM public.v_harness_coverage EXCEPT SELECT * FROM before_cov)
    UNION ALL
    (SELECT * FROM before_cov EXCEPT SELECT vehicle_id, layer, measure, numerator, denominator FROM public.v_harness_coverage)) d;
  IF n <> 0 THEN RAISE EXCEPTION 'the scoreboard rows changed: % differ', n; END IF;
  SELECT count(*) INTO n FROM public.v_harness_coverage WHERE grain IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION '% measures without a grain', n; END IF;
  SELECT grain INTO got FROM public.v_harness_coverage WHERE measure = 'wire ends keyed to a cavity';
  IF got IS DISTINCT FROM 'wire ends' THEN RAISE EXCEPTION 'grain: %', got; END IF;
  SELECT count(*) INTO n FROM public.v_harness_coverage;
  IF n <> 22 THEN RAISE EXCEPTION 'scoreboard rows: %, want 22', n; END IF;
  IF has_table_privilege('anon', 'public.v_harness_coverage', 'INSERT') OR NOT has_table_privilege('anon', 'public.v_harness_coverage', 'SELECT') THEN
    RAISE EXCEPTION 'scoreboard grants changed';
  END IF;
END $$;

SELECT 'test_k5_harness_scoreboard_grain: PASS' AS result;
