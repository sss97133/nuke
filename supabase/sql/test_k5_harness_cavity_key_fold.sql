-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_cavkey -f supabase/sql/test_k5_harness_cavity_key_fold.sql
-- Proves 20261015110000_k5_harness_cavity_key_fold.sql on top of RSI pass 16 (re-issued writer): wire ends added after
-- passes 2 and 9 are keyed by the same rules (Superseal by number on its own plug letter, the 61-pin by exact designator
-- with case kept, Deutsch by the housing part's series and size); a cavity on the wrong plug letter or out of range
-- stays unkeyed; a key already set is not touched; the fold is idempotent.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_splices_where.sql

-- Pass 9's Deutsch fixture is on another chain: its column, a 2-way plug and that model's cavities, as pass 9 made them.
ALTER TABLE public.harness_endpoints ADD COLUMN IF NOT EXISTS part_number text;
INSERT INTO public.harness_endpoints (id, design_id, code, name, endpoint_type, location_zone, part_number) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d0', 'PUMP-PLUG', 'two-way plug', 'connector', 'rear', 'QFS-BKCN-GM,DT06-2S,DT04-2P');
INSERT INTO public.connector_cavity_layouts (connector_model, cavity_id, position_index, source, method)
SELECT 'Deutsch DT 2-way', n::text, n, 'fixture', 'numbering only' FROM generate_series(1, 2) n;

-- Ends the loader added after the cavity passes: TP1 on PDM30-A A02, TQ1 on the 61-pin cab half f, a new end on the
-- Deutsch 2-way plug (cavity 2) and one on its out-of-range cavity 5, and one on PDM30-A named B07 (wrong plug letter).
UPDATE public.wire_termination_specs SET connector_family = 'ssc' WHERE id = '00000000-0000-0000-0000-0000000d0011';
UPDATE public.wire_termination_specs SET connector_family = 'd38999_20' WHERE id = '00000000-0000-0000-0000-0000000d0031';
INSERT INTO public.wire_termination_specs (id, vehicle_id, circuit_id, endpoint_id, cavity, connector_family) VALUES
  ('00000000-0000-0000-0000-00000000aa01', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a06', '00000000-0000-0000-0000-0000000000d1', '2', 'dt'),
  ('00000000-0000-0000-0000-00000000aa02', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a06', '00000000-0000-0000-0000-0000000000d1', '5', 'dt'),
  ('00000000-0000-0000-0000-00000000aa03', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a06', '00000000-0000-0000-0000-0000000000e8', 'B07', 'ssc');

CREATE TEMP TABLE keyed_before AS SELECT id, cavity_layout_id FROM public.wire_termination_specs WHERE cavity_layout_id IS NOT NULL;

\i supabase/migrations/20261015110000_k5_harness_cavity_key_fold.sql

DO $$
DECLARE got text; r jsonb; n int;
BEGIN
  SELECT string_agg(t.id::text || '=' || coalesce(l.connector_model || '/' || l.cavity_id, '-'), ' ' ORDER BY t.id) INTO got
  FROM public.wire_termination_specs t LEFT JOIN public.connector_cavity_layouts l ON l.id = t.cavity_layout_id
  WHERE t.id IN ('00000000-0000-0000-0000-0000000d0011', '00000000-0000-0000-0000-0000000d0031', '00000000-0000-0000-0000-00000000aa01',
                 '00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-00000000aa03');
  IF got IS DISTINCT FROM '00000000-0000-0000-0000-00000000aa01=Deutsch DT 2-way/2 00000000-0000-0000-0000-00000000aa02=- 00000000-0000-0000-0000-00000000aa03=- 00000000-0000-0000-0000-0000000d0011=TE Superseal 1.0 34-way key 1/2 00000000-0000-0000-0000-0000000d0031=MIL-DTL-38999 III 25-61/f' THEN
    RAISE EXCEPTION 'keys: %', got;
  END IF;
  SELECT count(*) INTO n FROM keyed_before b JOIN public.wire_termination_specs t ON t.id = b.id WHERE t.cavity_layout_id IS DISTINCT FROM b.cavity_layout_id;
  IF n <> 0 THEN RAISE EXCEPTION '% earlier keys changed', n; END IF;
  SELECT connector_housing_catalog_id IS NOT NULL INTO got FROM public.wire_termination_specs WHERE id = '00000000-0000-0000-0000-0000000d0011';
  IF got IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'housing not keyed on the PDM30-A end'; END IF;

  r := public.key_harness_wire_end_cavities('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF (r->>'ends_keyed')::int <> 0 OR (r->>'housings_keyed')::int <> 0 THEN RAISE EXCEPTION 'not idempotent: %', r; END IF;
  IF has_function_privilege('anon', 'public.key_harness_wire_end_cavities(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'the public can key ends'; END IF;
END $$;

SELECT 'test_k5_harness_cavity_key_fold: PASS' AS result;
