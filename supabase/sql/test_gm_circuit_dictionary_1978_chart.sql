-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_gm78 -f supabase/sql/test_gm_circuit_dictionary_1978_chart.sql
-- Proves 20261014143000_gm_circuit_dictionary_1978_chart.sql on top of RSI pass 3: new circuits inserted with their page,
-- shared numbers annotated (agreement or an unresolved conflict, neither source changed), and the residual and the
-- scoreboard naming the circuits the build cites.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_rsi_pass3.sql

-- The live shape of the dictionary (1973 rows): 9 agrees with the chart, 22 conflicts (the chart reads BLK), 999 is
-- not on the chart; 150 is absent here and comes from the chart.
CREATE TABLE public.gm_circuit_identification (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), circuit_number integer NOT NULL UNIQUE,
  wire_color text NOT NULL, wire_color_stripe text, circuit_name text NOT NULL,
  source_document text DEFAULT 'GM Service Manual Section 8C, Electrical Circuit Identification Table', notes text, created_at timestamptz DEFAULT now());
INSERT INTO public.gm_circuit_identification (circuit_number, wire_color, circuit_name, source_document) VALUES
  (9, 'BRN', 'Tail, License, Park and Side Marker Lamp Feed', 'GM 1973 Service Manual 8C-46'),
  (22, 'WHT', 'Direct Ground Trailer', 'GM 1973 Service Manual 8C-46'),
  (999, 'GRY', 'not on the chart', 'fixture');

-- Live: row security on, no policy, on the cavity library and the PDM tables.
ALTER TABLE public.connector_cavity_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdm_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdm_channels ENABLE ROW LEVEL SECURITY;

\i supabase/migrations/20261014143000_gm_circuit_dictionary_1978_chart.sql

DO $$
DECLARE n int; got text;
BEGIN
  SELECT count(*) INTO n FROM public.gm_circuit_identification WHERE source_document LIKE 'GM ST 352 78%';
  IF n <> 272 THEN RAISE EXCEPTION 'circuits added from the chart: got %, want 272 (274 read, 2 already present)', n; END IF;
  SELECT wire_color || '|' || circuit_name || '|' || source_document INTO got FROM public.gm_circuit_identification WHERE circuit_number = 150;
  IF got IS DISTINCT FROM 'BLK|Ground Circuit - Direct|GM ST 352 78, 1978 Light Duty Truck Wiring Diagrams (C/K), Circuit Tabulation p.9' THEN
    RAISE EXCEPTION 'circuit 150 from the chart: %', got;
  END IF;
  SELECT string_agg(circuit_number || '=' || wire_color || ':' || coalesce(notes, '-'), ' | ' ORDER BY circuit_number) INTO got
  FROM public.gm_circuit_identification WHERE circuit_number IN (9, 22, 999);
  IF got IS DISTINCT FROM '9=BRN:colour agrees with GM ST 352 78 (1978 C/K) Circuit Tabulation p.8 | 22=WHT:GM ST 352 78 (1978 C/K) Circuit Tabulation p.8 reads BLK (conflict, not resolved) | 999=GRY:-' THEN
    RAISE EXCEPTION 'second-source notes: %', got;
  END IF;
  IF EXISTS (SELECT 1 FROM public.gm_circuit_identification WHERE circuit_number = 813) THEN
    RAISE EXCEPTION 'circuit 813 has no readable colour and must not be loaded';
  END IF;

  SELECT string_agg(gm_circuit_number || ':' || status || ':' || coalesce(gm_wire_color, '-') || ':' || coalesce(gm_circuit_name, '-'), ' | ' ORDER BY gm_circuit_number) INTO got
  FROM public.v_harness_factory_residual;
  IF got IS DISTINCT FROM '9:carried:BRN:Tail, License, Park and Side Marker Lamp Feed | 29:unassessed:DK GRN:Horn Feed | 150:baseline gap:BLK:Ground Circuit - Direct' THEN
    RAISE EXCEPTION 'residual names: %', got;
  END IF;
  SELECT numerator || '/' || denominator INTO got FROM public.v_harness_coverage WHERE measure = 'GM circuits the build cites, named in the circuit dictionary';
  IF got IS DISTINCT FROM '2/2' THEN RAISE EXCEPTION 'coverage: build-cited circuits named %', got; END IF;
  SELECT count(*) INTO n FROM public.stack_needs WHERE stack_id = 'SH';
  IF n <> 18 THEN RAISE EXCEPTION 'SH needs: got %, want 18', n; END IF;
END $$;

-- A logged-out reader resolves the cavity and protection keys of a public vehicle, and not a private vehicle's PDM.
GRANT SELECT ON public.connector_cavity_layouts, public.pdm_units, public.pdm_channels, public.vehicles TO anon;
INSERT INTO public.vehicles VALUES ('00000000-0000-0000-0000-00000000aaaa', false, NULL, NULL, 1977);
INSERT INTO public.pdm_units (vehicle_id, unit_name, model, channel_count) VALUES ('00000000-0000-0000-0000-00000000aaaa', 'PDM30 (other)', 'MoTeC PDM30', 30);
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fixture read" ON public.vehicles FOR SELECT USING (true);
SET ROLE anon;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.connector_cavity_layouts WHERE connector_model = 'MIL-DTL-38999 III 25-61';
  IF n <> 61 THEN RAISE EXCEPTION 'anon reads % of the 61 bulkhead cavities', n; END IF;
  SELECT count(*) INTO n FROM public.pdm_units;
  IF n <> 2 THEN RAISE EXCEPTION 'anon reads % PDM units, want the public K5''s 2', n; END IF;
  SELECT count(*) INTO n FROM public.pdm_channels;
  IF n <> 5 THEN RAISE EXCEPTION 'anon reads % PDM channels, want the K5''s 5', n; END IF;
END $$;
RESET ROLE;

SELECT 'test_gm_circuit_dictionary_1978_chart: PASS' AS result;
