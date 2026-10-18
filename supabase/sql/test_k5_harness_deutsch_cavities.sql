-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_deutsch -f supabase/sql/test_k5_harness_deutsch_cavities.sql
-- Proves 20261014234500_k5_harness_deutsch_cavities.sql on top of RSI pass 2: six cited Deutsch models, wire ends keyed
-- by the plug's housing number and the cavity's leading number, out-of-range and unnamed plugs left unkeyed.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_rsi_pass2.sql

ALTER TABLE public.harness_endpoints ADD COLUMN part_number text;
INSERT INTO public.harness_endpoints (id, design_id, code, name, endpoint_type, location_zone, part_number) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d0', 'DOOR-L-PASS', 'door pass-through', 'connector', 'cabin', 'DT04-08PA,DT06-08SA,W8P,W8S'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d0', 'FUEL-PUMP', 'pump hanger', 'actuator', 'rear', 'QFS-BKCN-GM,DTP06-2S,DTP04-2P'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d0', 'WIDEBAND', 'lambda controller', 'ecu', 'engine', NULL);
INSERT INTO public.wire_termination_specs (id, vehicle_id, circuit_id, endpoint_id, cavity, connector_family) VALUES
  ('00000000-0000-0000-0000-0000000d0001', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a06', '00000000-0000-0000-0000-0000000000d1', '1', 'dt'),
  ('00000000-0000-0000-0000-0000000d0002', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a06', '00000000-0000-0000-0000-0000000000d1', '3 (lock)', 'dt'),
  ('00000000-0000-0000-0000-0000000d0003', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a06', '00000000-0000-0000-0000-0000000000d1', '9', 'dt'),
  ('00000000-0000-0000-0000-0000000d0004', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a06', '00000000-0000-0000-0000-0000000000d2', '1 (pump +)', 'dtp'),
  ('00000000-0000-0000-0000-0000000d0005', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a06', '00000000-0000-0000-0000-0000000000d3', '1', 'dtm');

\i supabase/migrations/20261014234500_k5_harness_deutsch_cavities.sql

DO $$
DECLARE got text;
BEGIN
  SELECT string_agg(connector_model || ':' || c || ':' || s, ' ' ORDER BY connector_model COLLATE "C") INTO got
  FROM (SELECT connector_model, count(*) c, count(source) s FROM public.connector_cavity_layouts WHERE connector_model LIKE 'Deutsch%' GROUP BY 1) m;
  IF got IS DISTINCT FROM 'Deutsch DT 12-way:12:12 Deutsch DT 2-way:2:2 Deutsch DT 6-way:6:6 Deutsch DT 8-way:8:8 Deutsch DTP 2-way:2:2 Deutsch DTP 4-way:4:4' THEN
    RAISE EXCEPTION 'Deutsch models: %', got;
  END IF;
  SELECT string_agg(right(t.id::text, 4) || '=' || coalesce(l.connector_model || '#' || l.cavity_id, '-'), ' ' ORDER BY t.id) INTO got
  FROM public.wire_termination_specs t LEFT JOIN public.connector_cavity_layouts l ON l.id = t.cavity_layout_id
  WHERE t.id::text LIKE '00000000-0000-0000-0000-0000000d%';
  IF got IS DISTINCT FROM '0001=Deutsch DT 8-way#1 0002=Deutsch DT 8-way#3 0003=- 0004=Deutsch DTP 2-way#1 0005=-' THEN
    RAISE EXCEPTION 'Deutsch keys: %', got;
  END IF;
END $$;

SELECT 'test_k5_harness_deutsch_cavities: PASS' AS result;
