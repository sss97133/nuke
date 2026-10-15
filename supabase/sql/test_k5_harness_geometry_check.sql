-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_geom -f supabase/sql/test_k5_harness_geometry_check.sql
-- Proves 20261014173000_k5_harness_geometry_check.sql on top of RSI pass 6: straight-line distance between positioned
-- plugs, and the scoreboard counting plans shorter than it.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_parts_catalog.sql

ALTER TABLE public.harness_endpoints ADD COLUMN pos_x_m numeric, ADD COLUMN pos_y_m numeric, ADD COLUMN pos_z_m numeric, ADD COLUMN pos_source text;
-- #110: M130-B (0,0,0) -> cab half (0.5,0,0) | engine half (0.5,0,0) -> CLT (1.5,0,0)
UPDATE public.harness_endpoints SET pos_x_m = 0, pos_y_m = 0, pos_z_m = 0, pos_source = 'fixture' WHERE code = 'M130-B';
UPDATE public.harness_endpoints SET pos_x_m = 0.5, pos_y_m = 0, pos_z_m = 0, pos_source = 'fixture' WHERE code IN ('FIREWALL-CABIN', 'FIREWALL-ENGINE');
UPDATE public.harness_endpoints SET pos_x_m = 1.5, pos_y_m = 0, pos_z_m = 0, pos_source = 'fixture' WHERE code = 'CLT-ECU';
UPDATE public.harness_segments SET planned_length_ft = 2.0 WHERE from_termination_id = '00000000-0000-0000-0000-0000000b0101';
UPDATE public.harness_segments SET planned_length_ft = 1.0 WHERE to_termination_id = '00000000-0000-0000-0000-0000000b0104';

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
GRANT ALL ON public.v_harness_coverage, public.v_harness_factory_residual TO anon, authenticated;

\i supabase/migrations/20261014173000_k5_harness_geometry_check.sql

DO $$
DECLARE got text; n int;
BEGIN
  SELECT string_agg(from_plug || '>' || to_plug || ':' || straight_ft || '/' || planned_ft, ' ' ORDER BY from_plug COLLATE "C") INTO got
  FROM public.v_harness_segment_geometry WHERE circuit_code = '110';
  IF got IS DISTINCT FROM 'FIREWALL-ENGINE>CLT-ECU:3.28/1.0 M130-B>FIREWALL-CABIN:1.64/2.0' THEN RAISE EXCEPTION 'geometry: %', got; END IF;
  SELECT numerator || '/' || denominator INTO got FROM public.v_harness_coverage
  WHERE measure = 'segments planned shorter than the straight line between their plugs (must be 0)';
  IF got IS DISTINCT FROM '1/2' THEN RAISE EXCEPTION 'geometry check: %', got; END IF;
  SELECT numerator INTO n FROM public.v_harness_coverage WHERE measure = 'segments with both plugs positioned';
  IF n <> 2 THEN RAISE EXCEPTION 'positioned segments: %', n; END IF;
  SELECT count(*) INTO n FROM public.stack_needs WHERE stack_id = 'SH';
  IF n <> 21 THEN RAISE EXCEPTION 'SH needs: got %, want 21', n; END IF;
  IF has_table_privilege('anon', 'public.v_harness_segment_geometry', 'INSERT') OR has_table_privilege('anon', 'public.v_harness_coverage', 'DELETE')
     OR has_table_privilege('authenticated', 'public.v_harness_factory_residual', 'UPDATE') THEN
    RAISE EXCEPTION 'a harness view keeps a public write grant';
  END IF;
  IF NOT has_table_privilege('anon', 'public.v_harness_segment_geometry', 'SELECT') THEN RAISE EXCEPTION 'anon cannot read the geometry view'; END IF;
END $$;

SELECT 'test_k5_harness_geometry_check: PASS' AS result;
