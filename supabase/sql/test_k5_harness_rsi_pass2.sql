-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_rsi2 -f supabase/sql/test_k5_harness_rsi_pass2.sql
-- Proves 20261014123000_k5_harness_rsi_pass2_cavities.sql on top of RSI pass 1: the cited cavity models, wire ends keyed
-- by bulkhead designator (case kept) and by Superseal number (letter must match the plug), housing keys, the stack need.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_rsi_pass1.sql

-- The live shapes pass 2 also touches.
ALTER TABLE public.wire_termination_specs ADD COLUMN connector_family text, ADD COLUMN connector_housing_catalog_id uuid;
ALTER TABLE public.harness_endpoints ADD COLUMN catalog_part_id uuid;
ALTER TABLE public.connector_cavity_layouts ADD COLUMN row_index integer, ADD COLUMN col_index integer, ADD COLUMN ring_index integer,
  ADD COLUMN position_index integer, ADD COLUMN x_offset_mm numeric, ADD COLUMN y_offset_mm numeric, ADD COLUMN contact_size text,
  ADD COLUMN max_current_amps numeric, ADD COLUMN wire_gauge_range text, ADD UNIQUE (connector_model, cavity_id);
INSERT INTO public.schema_proposals VALUES ('d3c978f1-aa13-4d27-81c5-ba2decbdf496', 'approved');
INSERT INTO public.catalog_parts (id, part_number) VALUES
  ('d501615e-7546-4806-a272-c4f24b36feb5', '65044'), ('3c2f8db8-8802-4d34-8474-a1054a9beb1c', '65045');
-- an uncited seed row stays uncited and unused
INSERT INTO public.connector_cavity_layouts (connector_model, cavity_id, ring_index, position_index) VALUES ('D38999_J61', 'R1P1', 1, 1);

-- Fixture: families and cavities as the K5 rows carry them.
UPDATE public.wire_termination_specs SET connector_family = 'ssc' WHERE id IN
  ('00000000-0000-0000-0000-0000000b0101', '00000000-0000-0000-0000-0000000b0204', '00000000-0000-0000-0000-0000000b0301', '00000000-0000-0000-0000-0000000b0603');
UPDATE public.wire_termination_specs SET connector_family = 'd38999_20', cavity = 'PP' WHERE id IN
  ('00000000-0000-0000-0000-0000000b0102', '00000000-0000-0000-0000-0000000b0103');
UPDATE public.wire_termination_specs SET connector_family = 'd38999_20', cavity = 'j' WHERE id IN
  ('00000000-0000-0000-0000-0000000b0202', '00000000-0000-0000-0000-0000000b0203');
-- O1 on M130-B names an A cavity: housing known, cavity not keyed
UPDATE public.wire_termination_specs SET connector_family = 'ssc', cavity = 'A05' WHERE id = '00000000-0000-0000-0000-0000000b0901';
-- a Superseal-looking cavity on a plug that is not a Superseal connector: nothing keyed
UPDATE public.wire_termination_specs SET connector_family = 'ssc', cavity = 'A1' WHERE id = '00000000-0000-0000-0000-0000000b0b01';

\i supabase/migrations/20261014123000_k5_harness_rsi_pass2_cavities.sql

DO $$
DECLARE n int; got text;
BEGIN
  SELECT string_agg(connector_model || ':' || c || ':' || s, ' ' ORDER BY connector_model) INTO got
  FROM (SELECT connector_model, count(*) c, count(source) s FROM public.connector_cavity_layouts GROUP BY 1) m;
  IF got IS DISTINCT FROM 'D38999_J61:1:0 MIL-DTL-38999 III 25-61:61:61 TE Superseal 1.0 26-way key 1:26:26 TE Superseal 1.0 34-way key 1:34:34' THEN
    RAISE EXCEPTION 'cavity models: %', got;
  END IF;
  SELECT string_agg(ring_index || ':' || c, ' ' ORDER BY ring_index) INTO got
  FROM (SELECT ring_index, count(*) c FROM public.connector_cavity_layouts WHERE connector_model = 'MIL-DTL-38999 III 25-61' GROUP BY 1) r;
  IF got IS DISTINCT FROM '0:1 1:6 2:12 3:19 4:23' THEN RAISE EXCEPTION '25-61 rings: %', got; END IF;

  SELECT string_agg(right(t.id::text, 4) || '=' || coalesce(l.cavity_id, '-'), ' ' ORDER BY t.id) INTO got
  FROM public.wire_termination_specs t LEFT JOIN public.connector_cavity_layouts l ON l.id = t.cavity_layout_id
  WHERE t.connector_family IS NOT NULL;
  IF got IS DISTINCT FROM '0101=4 0102=PP 0103=PP 0202=j 0203=j 0204=3 0301=1 0603=2 0901=- 0b01=-' THEN
    RAISE EXCEPTION 'cavity keys: %', got;
  END IF;
  SELECT string_agg(right(t.id::text, 4) || '=' || p.part_number, ' ' ORDER BY t.id) INTO got
  FROM public.wire_termination_specs t JOIN public.catalog_parts p ON p.id = t.connector_housing_catalog_id;
  IF got IS DISTINCT FROM '0101=65045 0204=65044 0301=65044 0603=65044 0901=65045' THEN RAISE EXCEPTION 'housing keys: %', got; END IF;
  SELECT string_agg(e.code || '=' || p.part_number, ' ' ORDER BY e.code) INTO got
  FROM public.harness_endpoints e JOIN public.catalog_parts p ON p.id = e.catalog_part_id;
  IF got IS DISTINCT FROM 'M130-B=65045 PDM30-A=65044' THEN RAISE EXCEPTION 'plug housing keys: %', got; END IF;

  SELECT count(*) INTO n FROM public.stack_needs WHERE stack_id = 'SH';
  IF n <> 14 THEN RAISE EXCEPTION 'SH needs: got %, want 14', n; END IF;
  SELECT numerator INTO n FROM public.v_harness_coverage WHERE measure = 'wire ends keyed to a cavity';
  IF n <> 8 THEN RAISE EXCEPTION 'coverage view: wire ends keyed to a cavity %, want 8', n; END IF;
END $$;

SELECT 'test_k5_harness_rsi_pass2: PASS' AS result;
