-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_reshape -f supabase/sql/test_k5_harness_reshape_v1.sql
-- Proves 20261014101500_k5_harness_reshape_v1_reissue.sql on a fixture with every wire shape the K5 has: a firewall crossing
-- from each side, wires joined at a splice, a door pass-through, a grommet, a wire with one end, a wire with none, and
-- a concept wire that must stay out.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
    OR current_setting('server_version_num')::int / 10000 <> 17
    OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable PG17 database';
  END IF;
END $$;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.auth_uid', true), '')::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

-- The live shapes both harness migrations touch (only the columns they use).
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean, user_id uuid, owner_id uuid);
CREATE TABLE public.pdm_channels (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.catalog_parts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), part_number text);
CREATE TABLE public.harness_designs (id uuid PRIMARY KEY, vehicle_id uuid);
CREATE TABLE public.harness_endpoints (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), design_id uuid, code text, name text,
  endpoint_type text, location_zone text, is_superseded boolean DEFAULT false);
CREATE TABLE public.vehicle_wiring_overlays (id uuid PRIMARY KEY, vehicle_id uuid);
CREATE TABLE public.vehicle_custom_circuits (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), overlay_id uuid, circuit_code text,
  circuit_name text, wire_gauge_awg integer, wire_type text, wire_color text, planned_length_ft numeric,
  from_endpoint_id uuid, to_endpoint_id uuid, fuse_rating_amps numeric, source text, observed_at timestamptz,
  created_at timestamptz DEFAULT now(), trust text, is_superseded boolean DEFAULT false, design_status text, build_state text);
CREATE TABLE public.wire_termination_specs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, circuit_id uuid,
  endpoint_id uuid, is_superseded boolean DEFAULT false);
CREATE TABLE public.vehicle_harness_landmarks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid);
CREATE TABLE public.wiring_decision_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), endpoint_id uuid);
CREATE TABLE public.connector_cavity_layouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), connector_model text, cavity_id text);
CREATE TABLE public.schema_proposals (id uuid PRIMARY KEY, status text);
INSERT INTO public.schema_proposals VALUES ('cdfc46c3-aee7-4a95-8169-58f45d64d5c7', 'approved');

\i supabase/migrations/20261014060000_harness_connectivity_levels.sql

-- Fixture: the K5, its overlay and design, thirteen plugs, ten wires.
INSERT INTO public.vehicles VALUES ('e08bf694-970f-4cbe-8a74-8715158a0f2e', true, NULL, NULL);
INSERT INTO public.vehicle_wiring_overlays VALUES ('00000000-0000-0000-0000-0000000000f0', 'e08bf694-970f-4cbe-8a74-8715158a0f2e');
INSERT INTO public.harness_designs VALUES ('00000000-0000-0000-0000-0000000000d0', 'e08bf694-970f-4cbe-8a74-8715158a0f2e');
INSERT INTO public.harness_endpoints (id, design_id, code, name, endpoint_type, location_zone) VALUES
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d0', 'M130-B', 'M130 B', 'ecu', 'cabin'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d0', 'CLT-ECU', 'coolant temp', 'sensor', 'engine'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d0', 'FIREWALL-CABIN', '61-pin cab half', 'connector', 'firewall'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000d0', 'FIREWALL-ENGINE', '61-pin engine half', 'connector', 'firewall'),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000d0', 'SPL-X', 'splice', 'splice', 'engine'),
  ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000d0', 'LAMP-1', 'lamp 1', 'actuator', 'engine'),
  ('00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-0000000000d0', 'LAMP-2', 'lamp 2', 'actuator', 'engine'),
  ('00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000d0', 'PDM-A', 'PDM A', 'ecu', 'cabin'),
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000d0', 'DOOR-PASS', 'door pass', 'actuator', 'cabin'),
  ('00000000-0000-0000-0000-0000000000ea', '00000000-0000-0000-0000-0000000000d0', 'SW-1', 'switch', 'switch', 'cabin'),
  ('00000000-0000-0000-0000-0000000000eb', '00000000-0000-0000-0000-0000000000d0', 'FIREWALL-GROMMET', 'grommet', 'connector', 'firewall'),
  ('00000000-0000-0000-0000-0000000000ec', '00000000-0000-0000-0000-0000000000d0', 'BATT', 'battery', 'power_source', 'engine'),
  ('00000000-0000-0000-0000-0000000000ed', '00000000-0000-0000-0000-0000000000d0', 'STARTER', 'starter', 'actuator', 'engine');
INSERT INTO public.catalog_parts (id, part_number) VALUES ('00000000-0000-0000-0000-00000000c001', 'M22759/32-20-2');

INSERT INTO public.vehicle_custom_circuits (id, overlay_id, circuit_code, circuit_name, wire_gauge_awg, wire_type, wire_color,
  planned_length_ft, from_endpoint_id, to_endpoint_id, source, observed_at, trust, design_status, build_state) VALUES
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000f0', '110', 'coolant temp', 22, 'M22759/16', 'yellow/red', 4.6,
   '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2', 'k5_registry v5', '2026-09-26', 'T3', 'decided', 'uncut'),
  ('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-0000000000f0', 'S1', 'starter signal', 20, 'M22759/32', 'red', 6.0,
   '00000000-0000-0000-0000-0000000000ed', '00000000-0000-0000-0000-0000000000e8', 'k5_registry v5', '2026-09-26', 'T3', 'decided', 'uncut'),
  ('00000000-0000-0000-0000-000000000a03', '00000000-0000-0000-0000-0000000000f0', 'L0', 'lamp feed', 20, 'M22759/32', 'red', 3.0,
   '00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000e5', 'k5_registry v5', '2026-09-26', 'T3', 'decided', 'uncut'),
  ('00000000-0000-0000-0000-000000000a04', '00000000-0000-0000-0000-0000000000f0', 'L1', 'lamp 1 branch', 20, 'M22759/32', 'red', 1.0,
   '00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e6', 'k5_registry v5', '2026-09-26', 'T3', 'decided', 'uncut'),
  ('00000000-0000-0000-0000-000000000a05', '00000000-0000-0000-0000-0000000000f0', 'L2', 'lamp 2 branch', 20, 'M22759/32', 'red', 1.5,
   '00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e7', 'k5_registry v5', '2026-09-26', 'T3', 'decided', 'uncut'),
  ('00000000-0000-0000-0000-000000000a06', '00000000-0000-0000-0000-0000000000f0', 'D1', 'door switch', 18, 'M22759/32', 'white/blue', 5.0,
   '00000000-0000-0000-0000-0000000000ea', '00000000-0000-0000-0000-0000000000e8', 'k5_registry v5', '2026-09-26', 'T3', 'decided', 'uncut'),
  ('00000000-0000-0000-0000-000000000a07', '00000000-0000-0000-0000-0000000000f0', 'B1', 'starter feed', 2, 'M22759/16', 'red', 7.6,
   '00000000-0000-0000-0000-0000000000ec', '00000000-0000-0000-0000-0000000000ed', 'k5_registry v5', '2026-09-26', 'T3', 'decided', 'uncut'),
  ('00000000-0000-0000-0000-000000000a08', '00000000-0000-0000-0000-0000000000f0', 'N1', 'no ends recorded', 20, 'M22759/32', 'black', NULL,
   NULL, NULL, 'k5_registry v5', '2026-09-26', 'T3', 'decided', 'uncut'),
  ('00000000-0000-0000-0000-000000000a09', '00000000-0000-0000-0000-0000000000f0', 'O1', 'one end recorded', 22, 'M22759/16', 'white', 2.0,
   '00000000-0000-0000-0000-0000000000e1', NULL, 'k5_registry v5', '2026-09-26', 'T3', 'decided', 'uncut'),
  ('00000000-0000-0000-0000-000000000a0a', '00000000-0000-0000-0000-0000000000f0', 'C1', 'April concept', 20, 'TXL', 'red', NULL,
   NULL, NULL, 'April 2026 plan', '2026-04-01', 'T3', 'concept', 'uncut'),
  ('00000000-0000-0000-0000-000000000a0c', '00000000-0000-0000-0000-0000000000f0', 'ETH_TX+', 'ethernet TX+', 24, 'Cat5 pair', 'white/orange', 3.0,
   '00000000-0000-0000-0000-0000000000e1', NULL, 'k5_registry v5', '2026-09-26', 'T3', 'decided', 'uncut'),
  ('00000000-0000-0000-0000-000000000a0d', '00000000-0000-0000-0000-0000000000f0', 'ETH_TX-', 'ethernet TX-', 24, 'Cat5 pair', 'orange', 3.0,
   '00000000-0000-0000-0000-0000000000e1', NULL, 'k5_registry v5', '2026-09-26', 'T3', 'decided', 'uncut');

INSERT INTO public.wire_termination_specs (id, vehicle_id, circuit_id, endpoint_id) VALUES
  -- 110: M130-B -> 61-pin cab half -> engine half -> CLT
  ('00000000-0000-0000-0000-0000000b0101', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000b0102', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000e3'),
  ('00000000-0000-0000-0000-0000000b0103', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000e4'),
  ('00000000-0000-0000-0000-0000000b0104', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000e2'),
  -- S1: starter (engine) -> engine half -> cab half -> PDM
  ('00000000-0000-0000-0000-0000000b0201', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-0000000000ed'),
  ('00000000-0000-0000-0000-0000000b0202', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-0000000000e3'),
  ('00000000-0000-0000-0000-0000000b0203', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-0000000000e4'),
  ('00000000-0000-0000-0000-0000000b0204', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-0000000000e8'),
  -- L0, L1, L2 meet at SPL-X
  ('00000000-0000-0000-0000-0000000b0301', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a03', '00000000-0000-0000-0000-0000000000e8'),
  ('00000000-0000-0000-0000-0000000b0302', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a03', '00000000-0000-0000-0000-0000000000e5'),
  ('00000000-0000-0000-0000-0000000b0401', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a04', '00000000-0000-0000-0000-0000000000e5'),
  ('00000000-0000-0000-0000-0000000b0402', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a04', '00000000-0000-0000-0000-0000000000e6'),
  ('00000000-0000-0000-0000-0000000b0501', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a05', '00000000-0000-0000-0000-0000000000e5'),
  ('00000000-0000-0000-0000-0000000b0502', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a05', '00000000-0000-0000-0000-0000000000e7'),
  -- D1: switch -> door pass-through -> PDM (two segments)
  ('00000000-0000-0000-0000-0000000b0601', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a06', '00000000-0000-0000-0000-0000000000ea'),
  ('00000000-0000-0000-0000-0000000b0602', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a06', '00000000-0000-0000-0000-0000000000e9'),
  ('00000000-0000-0000-0000-0000000b0603', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a06', '00000000-0000-0000-0000-0000000000e8'),
  -- B1: battery -> grommet -> starter (one segment)
  ('00000000-0000-0000-0000-0000000b0701', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a07', '00000000-0000-0000-0000-0000000000ec'),
  ('00000000-0000-0000-0000-0000000b0702', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a07', '00000000-0000-0000-0000-0000000000eb'),
  ('00000000-0000-0000-0000-0000000b0703', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a07', '00000000-0000-0000-0000-0000000000ed'),
  -- O1: one end only
  ('00000000-0000-0000-0000-0000000b0901', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a09', '00000000-0000-0000-0000-0000000000e1');

\i supabase/migrations/20261014101500_k5_harness_reshape_v1_reissue.sql

DO $$
DECLARE n int; got text; want text; r record;
BEGIN
  -- per-wire segment counts: 110 2, S1 2, L0 1, L1 1, L2 1, D1 2, B1 1, N1 1, O1 1; the concept wire none
  SELECT string_agg(c.circuit_code || '=' || coalesce(s.n, 0), ' ' ORDER BY c.circuit_code COLLATE "C") INTO got
  FROM public.vehicle_custom_circuits c
  LEFT JOIN (SELECT vehicle_custom_circuit_id, count(*) n FROM public.harness_segments GROUP BY 1) s ON s.vehicle_custom_circuit_id = c.id;
  want := '110=2 B1=1 C1=0 D1=2 ETH_TX+=1 ETH_TX-=1 L0=1 L1=1 L2=1 N1=1 O1=1 S1=2';
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'segments per wire: got %, want %', got, want; END IF;

  -- nets: L0, L1, L2 share the splice net; every other decided wire is its own net
  SELECT count(*) INTO n FROM public.harness_nets;
  IF n <> 9 THEN RAISE EXCEPTION 'nets: got %, want 9', n; END IF;
  SELECT count(DISTINCT s.net_id) INTO n FROM public.harness_segments s
   WHERE s.vehicle_custom_circuit_id IN ('00000000-0000-0000-0000-000000000a03', '00000000-0000-0000-0000-000000000a04', '00000000-0000-0000-0000-000000000a05');
  IF n <> 1 THEN RAISE EXCEPTION 'L0, L1, L2 should share one net, found %', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.harness_nets WHERE net_code = 'SPL-X') THEN RAISE EXCEPTION 'splice net not coded SPL-X'; END IF;
  SELECT count(*) INTO n FROM public.harness_signals;
  IF n <> 9 THEN RAISE EXCEPTION 'signals: got %, want 9 (ETH_TX+ and ETH_TX- keep separate keys)', n; END IF;

  -- 110 from the cab: M130-B -> cab half, then engine half -> CLT; S1 from the engine: starter -> engine half, then cab half -> PDM
  FOR r IN SELECT c.circuit_code, ef.code f, et.code t FROM public.harness_segments s
            JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
            LEFT JOIN public.wire_termination_specs tf ON tf.id = s.from_termination_id LEFT JOIN public.harness_endpoints ef ON ef.id = tf.endpoint_id
            LEFT JOIN public.wire_termination_specs tt ON tt.id = s.to_termination_id LEFT JOIN public.harness_endpoints et ON et.id = tt.endpoint_id
            WHERE c.circuit_code IN ('110', 'S1', 'D1', 'B1', 'N1', 'O1') LOOP
    IF (r.circuit_code, r.f, r.t) NOT IN (('110', 'M130-B', 'FIREWALL-CABIN'), ('110', 'FIREWALL-ENGINE', 'CLT-ECU'),
        ('S1', 'STARTER', 'FIREWALL-ENGINE'), ('S1', 'FIREWALL-CABIN', 'PDM-A'),
        ('D1', 'SW-1', 'DOOR-PASS'), ('D1', 'DOOR-PASS', 'PDM-A'), ('B1', 'BATT', 'STARTER'))
       AND NOT (r.circuit_code = 'N1' AND r.f IS NULL AND r.t IS NULL)
       AND NOT (r.circuit_code = 'O1' AND r.f = 'M130-B' AND r.t IS NULL) THEN
      RAISE EXCEPTION 'unexpected segment % : % -> %', r.circuit_code, r.f, r.t;
    END IF;
  END LOOP;

  -- lengths: a one-segment wire keeps its estimate; a split wire's segments say why they have none
  SELECT count(*) INTO n FROM public.harness_segments s JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
   WHERE c.circuit_code = 'L0' AND s.planned_length_ft = 3.0;
  IF n <> 1 THEN RAISE EXCEPTION 'L0 should keep its 3.0 ft estimate'; END IF;
  SELECT count(*) INTO n FROM public.harness_segments s JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
   WHERE c.circuit_code = '110' AND s.planned_length_ft IS NULL AND s.planned_length_method LIKE 'unknown:%';
  IF n <> 2 THEN RAISE EXCEPTION '110 segments should carry no length and the reason, got %', n; END IF;

  -- keys: red 20 AWG /32 resolves to the catalog part; the mate is set both ways
  SELECT count(*) INTO n FROM public.harness_segments WHERE wire_part_id = '00000000-0000-0000-0000-00000000c001';
  IF n <> 5 THEN RAISE EXCEPTION 'red 20 AWG segments keyed: got %, want 5 (S1 x2, L0, L1, L2)', n; END IF;
  SELECT count(*) INTO n FROM public.harness_endpoints a JOIN public.harness_endpoints b ON b.id = a.mates_with_endpoint_id
   WHERE (a.code, b.code) IN (('FIREWALL-CABIN', 'FIREWALL-ENGINE'), ('FIREWALL-ENGINE', 'FIREWALL-CABIN'));
  IF n <> 2 THEN RAISE EXCEPTION 'the 61-pin halves should mate both ways'; END IF;
END $$;

SELECT 'test_k5_harness_reshape_v1: PASS' AS result;
