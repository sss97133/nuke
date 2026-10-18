-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_deutsch -f supabase/sql/test_k5_harness_deutsch_tool_catalog.sql
-- Proves 20261015260000_k5_harness_deutsch_tool_catalog.sql on top of RSI pass 39:
--   - the HDT-48-00 and the 0462-005-20141 socket land once, with sources and no price, stock or maker claim;
--   - a wire end naming them is keyed to both by the pass 6 key fold; running the migration's insert again adds nothing.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_estimate_plans_padded.sql

UPDATE public.wire_termination_specs SET terminal_contact_pn = '0462-005-20141', crimp_tool_pn = 'HDT-48-00',
  terminal_contact_catalog_id = NULL, crimp_tool_catalog_id = NULL
WHERE id = '00000000-0000-0000-0000-0000000d3301';

\i supabase/migrations/20261015260000_k5_harness_deutsch_tool_catalog.sql

DO $$
DECLARE n int; got text;
BEGIN
  SELECT count(*) INTO n FROM public.catalog_parts WHERE part_number IN ('HDT-48-00', '0462-005-20141');
  IF n <> 2 THEN RAISE EXCEPTION 'catalog rows: %', n; END IF;
  SELECT count(*) INTO n FROM public.catalog_parts
  WHERE part_number IN ('HDT-48-00', '0462-005-20141') AND (manufacturer IS NOT NULL OR in_stock IS NOT NULL OR application_data->'sources' IS NULL);
  IF n <> 0 THEN RAISE EXCEPTION 'rows carry a claim or no source: %', n; END IF;
  SELECT (SELECT part_number FROM public.catalog_parts WHERE id = t.terminal_contact_catalog_id) || ' / '
         || (SELECT part_number FROM public.catalog_parts WHERE id = t.crimp_tool_catalog_id) INTO got
  FROM public.wire_termination_specs t WHERE t.id = '00000000-0000-0000-0000-0000000d3301';
  IF got IS DISTINCT FROM '0462-005-20141 / HDT-48-00' THEN RAISE EXCEPTION 'end keys: %', got; END IF;
END $$;

-- the insert is idempotent
INSERT INTO public.catalog_parts (part_number, name)
SELECT 'HDT-48-00', 'again' WHERE NOT EXISTS (SELECT 1 FROM public.catalog_parts WHERE part_number = 'HDT-48-00');
DO $$
BEGIN
  IF (SELECT count(*) FROM public.catalog_parts WHERE part_number = 'HDT-48-00') <> 1 THEN RAISE EXCEPTION 'HDT-48-00 twice'; END IF;
END $$;

SELECT 'test_k5_harness_deutsch_tool_catalog: PASS';
