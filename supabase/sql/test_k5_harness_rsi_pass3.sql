-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_rsi3 -f supabase/sql/test_k5_harness_rsi_pass3.sql
-- Proves 20261014133000_k5_harness_rsi_pass3_factory_residual.sql on top of RSI pass 2: the GM-number key on the
-- factory baseline (cited rows only, factory generation only), the re-runnable evidence fold, and the residual:
-- carried, unassessed, baseline gap; superseded observations and other years ignored.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_rsi_pass2.sql

-- The live shapes pass 3 also touches.
ALTER TABLE public.vehicles ADD COLUMN year integer;
ALTER TABLE public.vehicle_wiring_overlays ADD COLUMN factory_generation text;
ALTER TABLE public.vehicle_observations ADD COLUMN is_superseded boolean DEFAULT false;
CREATE TABLE public.factory_harness_circuits (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), generation text, year_range int4range,
  circuit_code text, source_document text);
INSERT INTO public.schema_proposals VALUES ('47ad7e95-fa84-4b3e-b201-b6ebecf08d8b', 'approved');

UPDATE public.vehicles SET year = 1977;
UPDATE public.vehicle_wiring_overlays SET factory_generation = 'squarebody_1973_1987';
INSERT INTO public.factory_harness_circuits (generation, year_range, circuit_code, source_document) VALUES
  ('squarebody_1973_1987', '[1973,1988)', 'PARKING_L', 'GM Service Manual Section 8C, p8C-46, Circuit #9'),
  ('squarebody_1973_1987', '[1973,1988)', 'SIDE_MARKER_FL', 'GM Service Manual Section 8C, p8C-46, Circuit #9'),
  ('squarebody_1973_1987', '[1973,1988)', 'HORN_RELAY', 'GM Service Manual Section 8C, p8C-46, Circuit #29'),
  ('squarebody_1973_1987', '[1973,1988)', 'BAT_FEED', 'GM Service Manual 1985 C/K'),
  ('squarebody_1973_1987', '[1987,1988)', 'TBI_EST', 'GM Service Manual 1987 C/K, Circuit #423'),
  ('nuke_build', '[1973,1988)', 'NB-AC-01', 'Nuke build wiring plan, Circuit #9');

-- Factory-circuit facts as load_observations.py --factory-refs lands them (disposable test database only)
-- ALLOW_RAW_TESTIMONY_WRITE
INSERT INTO public.vehicle_observations (id, vehicle_id, source_identifier, structured_data, is_superseded) VALUES
  ('00000000-0000-0000-0000-0000000000f1', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', 'k5-wiring:LAMP-1:#L1 factory circuit',
   '{"domain": "wiring", "plug": "LAMP-1", "wire_id": "L1", "row_field": "#L1 factory circuit", "property_key": "factory circuit", "value": "circuit 9 brown", "state": "design", "gm_circuits": [9]}', false),
  ('00000000-0000-0000-0000-0000000000f2', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', 'k5-wiring:LAMP-2:#L2 factory circuit',
   '{"domain": "wiring", "plug": "LAMP-2", "wire_id": "L2", "row_field": "#L2 factory circuit", "property_key": "factory circuit", "value": "circuit 9 brown; circuit 150 black", "state": "design", "gm_circuits": [9, 150]}', false),
  ('00000000-0000-0000-0000-0000000000f3', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', 'k5-wiring:SW-1:#D1 factory circuit',
   '{"domain": "wiring", "plug": "SW-1", "wire_id": "D1", "row_field": "#D1 factory circuit", "property_key": "factory circuit", "value": "circuit 29", "state": "design", "gm_circuits": [29]}', true);

\i supabase/migrations/20261014133000_k5_harness_rsi_pass3_factory_residual.sql

DO $$
DECLARE n int; got text;
BEGIN
  SELECT string_agg(circuit_code || '=' || coalesce(gm_circuit_number::text, '-'), ' ' ORDER BY circuit_code COLLATE "C") INTO got FROM public.factory_harness_circuits;
  IF got IS DISTINCT FROM 'BAT_FEED=- HORN_RELAY=29 NB-AC-01=- PARKING_L=9 SIDE_MARKER_FL=9 TBI_EST=423' THEN RAISE EXCEPTION 'baseline keys: %', got; END IF;

  SELECT string_agg(right(row_id::text, 4) || ':' || field, ' ' ORDER BY row_id) INTO got
  FROM public.harness_evidence WHERE field LIKE '%factory circuit';
  IF got IS DISTINCT FROM '0402:#L1 factory circuit 0502:#L2 factory circuit' THEN RAISE EXCEPTION 'factory evidence links: %', got; END IF;
  n := public.link_harness_evidence('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF n <> 0 THEN RAISE EXCEPTION 'the evidence fold is not idempotent: % new links on a re-run', n; END IF;

  SELECT string_agg(gm_circuit_number || ':' || status || ':' || wire_ends || '/' || nets || ':' || coalesce(array_to_string(factory_codes, ','), '-'), ' ' ORDER BY gm_circuit_number) INTO got
  FROM public.v_harness_factory_residual;
  IF got IS DISTINCT FROM '9:carried:2/1:PARKING_L,SIDE_MARKER_FL 29:unassessed:0/0:HORN_RELAY 150:baseline gap:1/1:-' THEN
    RAISE EXCEPTION 'residual: %', got;
  END IF;

  SELECT string_agg(measure || '=' || numerator || '/' || denominator, '; ' ORDER BY measure COLLATE "C") INTO got
  FROM public.v_harness_coverage WHERE layer IN ('baseline', 'residual');
  IF got IS DISTINCT FROM 'GM circuits the build cites that the baseline cannot key=1/2; factory GM circuits carried by the build=1/2; factory circuits keyed to a GM circuit number=3/4; nets carrying a factory circuit=1/9' THEN
    RAISE EXCEPTION 'coverage: %', got;
  END IF;
  SELECT count(*) INTO n FROM public.stack_needs WHERE stack_id = 'SH';
  IF n <> 17 THEN RAISE EXCEPTION 'SH needs: got %, want 17', n; END IF;
END $$;

SELECT 'test_k5_harness_rsi_pass3: PASS' AS result;
