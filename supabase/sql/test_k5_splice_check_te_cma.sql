-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_tecma -f supabase/sql/test_k5_splice_check_te_cma.sql
-- Proves 20261015103000_k5_splice_check_te_cma.sql on top of RSI pass 16 (re-issued writer): the D-609 stub splices carry
-- TE's CMA range and CMA per gauge; the fill check uses them, so two 22 AWG wires and a 20 AWG pin lead in a D-609-04
-- (2,306 CM by the AWG formula, inside 20-16 AWG) read 2,724 CMA, over TE's 2,680; a butt splice with no maker table keeps
-- the AWG basis and says so.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_splices_where.sql

DO $$
DECLARE got text;
BEGIN
  SELECT status || ' ' || circular_mils INTO got FROM public.v_harness_splice_check WHERE splice_code = 'PDM30-A A2 #1';
  IF got IS DISTINCT FROM 'fits 2306' THEN RAISE EXCEPTION 'before: %', got; END IF;
END $$;

\i supabase/migrations/20261015103000_k5_splice_check_te_cma.sql

DO $$
DECLARE got text; n int;
BEGIN
  SELECT string_agg(part_number || '=' || (application_data->>'range_cma') || '/' || (application_data->'cma_by_awg'->>'22'), ' ' ORDER BY part_number) INTO got
  FROM public.catalog_parts WHERE part_number LIKE 'D-609-0_';
  IF got IS DISTINCT FROM 'D-609-03=[300, 1510]/754 D-609-04=[779, 2680]/754 D-609-05=[1900, 6755]/754' THEN RAISE EXCEPTION 'catalog: %', got; END IF;

  SELECT status || ' ' || circular_mils || ' ' || part_max_circular_mils || ' | ' || area_basis INTO got
  FROM public.v_harness_splice_check WHERE splice_code = 'PDM30-A A2 #1';
  IF got IS DISTINCT FROM 'over the crimp range 2724 2680 | maker: CMA range and CMA per gauge (TE/Raychem SCD)' THEN RAISE EXCEPTION 'A2 on TE figures: %', got; END IF;

  SELECT status || ' | ' || area_basis INTO got FROM public.v_harness_splice_check WHERE splice_code = 'SPL-X' AND side = 1;
  IF got IS DISTINCT FROM 'fits | AWG formula against the crimp tool''s AWG cavity range' THEN RAISE EXCEPTION 'SPL-X side 1: %', got; END IF;

  SELECT numerator || '/' || denominator INTO got FROM public.v_harness_coverage WHERE measure = 'splice sides outside the part''s crimp range (must be 0)';
  IF got IS DISTINCT FROM '1/2' THEN RAISE EXCEPTION 'outside the crimp range: %', got; END IF;

  IF has_table_privilege('anon', 'public.v_harness_splice_check', 'INSERT') OR NOT has_table_privilege('anon', 'public.v_harness_splice_check', 'SELECT') THEN
    RAISE EXCEPTION 'fill view grants';
  END IF;
  SELECT count(*) INTO n FROM public.stack_needs WHERE stack_id = 'SH';
  IF n <> 40 THEN RAISE EXCEPTION 'SH needs: %, want 40', n; END IF;
END $$;

SELECT 'test_k5_splice_check_te_cma: PASS' AS result;
