-- Contract: the comps make+year filter is served by idx_vehicles_lower_make_year.
\set ON_ERROR_STOP on
CREATE TABLE IF NOT EXISTS public.vehicles (id uuid primary key default gen_random_uuid(), make text, year int);
\i supabase/migrations/20261023110000_vehicles_lower_make_year_index.sql
-- idempotent re-run
\i supabase/migrations/20261023110000_vehicles_lower_make_year_index.sql
INSERT INTO public.vehicles (make, year) SELECT (ARRAY['Porsche','Mazda','Ford'])[1 + g % 3], 1960 + g % 60 FROM generate_series(1, 20000) g;
ANALYZE public.vehicles;
SET enable_seqscan = off;
DO $t$
DECLARE plan text := ''; l text;
BEGIN
  FOR l IN EXECUTE 'EXPLAIN SELECT 1 FROM public.vehicles WHERE lower(make) = lower(''porsche'') AND year BETWEEN 1990 AND 1995' LOOP
    plan := plan || l || E'\n';
  END LOOP;
  IF plan NOT LIKE '%idx_vehicles_lower_make_year%' THEN
    RAISE EXCEPTION 'comps filter does not use idx_vehicles_lower_make_year: %', plan;
  END IF;
END
$t$;
SELECT 'ok' AS vehicles_lower_make_year_index;
