-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_rsi1 -f supabase/sql/test_k5_harness_rsi_pass1.sql
-- Proves 20261014103000_k5_harness_rsi_pass1.sql on top of the reshape: design state (contradicted, candidate), options
-- at segment grain, PDM protection from the pin library, catalog keys on wire ends, evidence links, the stack
-- registration and the coverage view.
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
CREATE TABLE public.pdm_units (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, unit_name text, model text,
  channel_count integer, rated_amps numeric, notes text);
CREATE TABLE public.pdm_channels (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pdm_unit_id uuid, channel_number integer,
  channel_group_name text, fuse_rating_amps numeric, notes text);
CREATE TABLE public.device_pin_maps (device_model text, pin_number text, pin_function text, max_current_amps numeric);
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, source_identifier text, structured_data jsonb);
CREATE TABLE public.stacks (stack_id text, version integer, name text, question text, family text, path text[],
  external_dimensions text[], who_cares text, scoring text, status text, thesis_vein_id text, thesis_vein_version integer,
  source text, supersedes_version integer, registered_at timestamptz, registered_by text, PRIMARY KEY (stack_id, version));
CREATE TABLE public.stack_needs (stack_id text, version integer, layer text, kind text, object text, denominator text,
  fresh_within interval, note text, substrate text);
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
  endpoint_id uuid, is_superseded boolean DEFAULT false, cavity text, terminal_contact_pn text, crimp_tool_pn text,
  terminal_contact_catalog_id uuid, crimp_tool_catalog_id uuid);
CREATE TABLE public.vehicle_harness_landmarks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid);
CREATE TABLE public.wiring_decision_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), decision_id uuid NOT NULL, relation text,
  other_decision_id uuid, endpoint_id uuid, note text, source text, trust text, created_at timestamptz DEFAULT now(),
  CHECK (num_nonnulls(other_decision_id, endpoint_id) = 1));
CREATE TABLE public.connector_cavity_layouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), connector_model text, cavity_id text);
CREATE TABLE public.schema_proposals (id uuid PRIMARY KEY, status text);
INSERT INTO public.schema_proposals VALUES ('cdfc46c3-aee7-4a95-8169-58f45d64d5c7', 'approved'), ('50296583-f549-4f51-b5a7-a9e282926741', 'approved');

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
  ('00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000d0', 'PDM30-A', 'PDM30 A', 'ecu', 'cabin'),
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000d0', 'DOOR-PASS', 'door pass', 'actuator', 'cabin'),
  ('00000000-0000-0000-0000-0000000000ea', '00000000-0000-0000-0000-0000000000d0', 'SW-1', 'switch', 'switch', 'cabin'),
  ('00000000-0000-0000-0000-0000000000eb', '00000000-0000-0000-0000-0000000000d0', 'FIREWALL-GROMMET', 'grommet', 'connector', 'firewall'),
  ('00000000-0000-0000-0000-0000000000ec', '00000000-0000-0000-0000-0000000000d0', 'BATT', 'battery', 'power_source', 'engine'),
  ('00000000-0000-0000-0000-0000000000ed', '00000000-0000-0000-0000-0000000000d0', 'STARTER', 'starter', 'actuator', 'engine'),
  ('00000000-0000-0000-0000-0000000000ee', '00000000-0000-0000-0000-0000000000d0', 'FIREWALL-BODY-A', 'body bulkhead A', 'connector', 'firewall');
INSERT INTO public.catalog_parts (id, part_number) VALUES ('00000000-0000-0000-0000-00000000c001', 'M22759/32-20-2'),
  ('00000000-0000-0000-0000-00000000c002', 'SSC-N'), ('00000000-0000-0000-0000-00000000c003', 'M22520/2-02');

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
  ('00000000-0000-0000-0000-000000000a0b', '00000000-0000-0000-0000-0000000000f0', 'BB1', 'marker via body bulkhead', 18, 'M22759/32', 'brown', 9.0,
   '00000000-0000-0000-0000-0000000000ea', '00000000-0000-0000-0000-0000000000e6', 'k5_registry v5', '2026-09-26', 'T3', 'decided', 'uncut');

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
  ('00000000-0000-0000-0000-0000000b0901', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a09', '00000000-0000-0000-0000-0000000000e1'),
  -- BB1: switch -> retired body bulkhead -> lamp
  ('00000000-0000-0000-0000-0000000b0b01', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a0b', '00000000-0000-0000-0000-0000000000ea'),
  ('00000000-0000-0000-0000-0000000b0b02', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a0b', '00000000-0000-0000-0000-0000000000ee'),
  ('00000000-0000-0000-0000-0000000b0b03', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000a0b', '00000000-0000-0000-0000-0000000000e6');
-- cavities and part numbers the pass keys
UPDATE public.wire_termination_specs SET cavity = 'B04', terminal_contact_pn = 'SSC-N', crimp_tool_pn = 'M22520/2-02' WHERE id = '00000000-0000-0000-0000-0000000b0101';
UPDATE public.wire_termination_specs SET cavity = 'A3' WHERE id = '00000000-0000-0000-0000-0000000b0204';
UPDATE public.wire_termination_specs SET cavity = 'A1' WHERE id = '00000000-0000-0000-0000-0000000b0301';
UPDATE public.wire_termination_specs SET cavity = 'A2' WHERE id = '00000000-0000-0000-0000-0000000b0603';
INSERT INTO public.device_pin_maps VALUES ('PDM30', 'A01', 'OUT1_A', 20), ('PDM30', 'A02', 'OUT9', 8), ('PDM30', 'A03', 'OUT2_A', 20),
  ('PDM15', 'A1', 'Output 1 (High Side)', 20), ('PDM15', 'A9', 'Output 9 (Low Current)', 8);
-- options coupled to plugs
INSERT INTO public.wiring_decision_links (decision_id, relation, endpoint_id) VALUES
  ('00000000-0000-0000-0000-00000000dd01', 'coupled_with', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-00000000dd02', 'coupled_with', '00000000-0000-0000-0000-0000000000e5');
-- field-level facts (disposable test database only)
-- ALLOW_RAW_TESTIMONY_WRITE
INSERT INTO public.vehicle_observations (id, vehicle_id, source_identifier, structured_data) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', 'k5-wiring:CLT-ECU:#110 device end', '{"plug": "CLT-ECU", "wire_id": "110", "row_field": "device end", "state": "cited"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', 'k5-wiring:FIREWALL-ENGINE:#110 pull test', '{"plug": "FIREWALL-ENGINE", "wire_id": "110", "row_field": "pull test", "state": "bench"}'),
  ('00000000-0000-0000-0000-0000000000b3', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', 'k5-wiring:M130-B:plug / kit', '{"plug": "M130-B", "wire_id": null, "row_field": "plug / kit", "state": "cited"}');


\i supabase/migrations/20261014101500_k5_harness_reshape_v1_reissue.sql
\i supabase/migrations/20261014103000_k5_harness_rsi_pass1.sql

DO $$
DECLARE n int; got text;
BEGIN
  SELECT string_agg(design_status || '=' || c, ' ' ORDER BY design_status) INTO got
  FROM (SELECT design_status, count(*) c FROM public.harness_segments GROUP BY 1) s;
  IF got IS DISTINCT FROM 'candidate=1 contradicted=2 decided=12' THEN RAISE EXCEPTION 'design state: %', got; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.harness_segments s JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
                 WHERE c.circuit_code = 'C1' AND s.design_status = 'candidate' AND s.from_termination_id IS NULL AND s.to_termination_id IS NULL) THEN
    RAISE EXCEPTION 'the concept wire should be one candidate segment with unknown ends';
  END IF;
  IF EXISTS (SELECT 1 FROM public.harness_segments s JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
             WHERE c.circuit_code = 'BB1' AND (s.design_status <> 'contradicted' OR s.design_note NOT LIKE '%FIREWALL-BODY-A%')) THEN
    RAISE EXCEPTION 'the body-bulkhead wire should be contradicted, naming the bulkhead';
  END IF;

  -- options at segment grain: dd01 (M130-B) -> the 110 cabin segment and O1; dd02 (SPL-X) -> L0, L1, L2
  SELECT count(*) INTO n FROM public.wiring_decision_links WHERE segment_id IS NOT NULL;
  IF n <> 5 THEN RAISE EXCEPTION 'segment option links: got %, want 5', n; END IF;
  BEGIN
    INSERT INTO public.wiring_decision_links (decision_id, relation, endpoint_id, segment_id)
    SELECT '00000000-0000-0000-0000-00000000dd01', 'coupled_with', '00000000-0000-0000-0000-0000000000e1', id FROM public.harness_segments LIMIT 1;
    RAISE EXCEPTION 'a link with two targets was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- protection: the K5 PDM30 has OUT1, OUT2, OUT9 from the pin library; three nets point at them
  SELECT count(*) INTO n FROM public.pdm_units WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';
  IF n <> 2 THEN RAISE EXCEPTION 'K5 PDM units: got %, want 2', n; END IF;
  SELECT string_agg(ch.channel_group_name || ':' || ch.fuse_rating_amps, ' ' ORDER BY ch.channel_number) INTO got
  FROM public.pdm_channels ch JOIN public.pdm_units u ON u.id = ch.pdm_unit_id WHERE u.model = 'MoTeC PDM30';
  IF got IS DISTINCT FROM 'OUT1:20 OUT2:20 OUT9:8' THEN RAISE EXCEPTION 'PDM30 outputs: %', got; END IF;
  SELECT string_agg(ch.channel_group_name || ':' || ch.fuse_rating_amps, ' ' ORDER BY ch.channel_number) INTO got
  FROM public.pdm_channels ch JOIN public.pdm_units u ON u.id = ch.pdm_unit_id WHERE u.model = 'MoTeC PDM15';
  IF got IS DISTINCT FROM 'OUT1:20 OUT9:8' THEN RAISE EXCEPTION 'PDM15 outputs (the Output N naming): %', got; END IF;
  SELECT count(*) INTO n FROM public.harness_nets WHERE protection_pdm_channel_id IS NOT NULL;
  IF n <> 3 THEN RAISE EXCEPTION 'protected nets: got %, want 3 (S1, the SPL-X net, D1)', n; END IF;

  -- keys and evidence
  SELECT count(*) INTO n FROM public.wire_termination_specs
   WHERE terminal_contact_catalog_id = '00000000-0000-0000-0000-00000000c002' AND crimp_tool_catalog_id = '00000000-0000-0000-0000-00000000c003';
  IF n <> 1 THEN RAISE EXCEPTION 'terminal and tool keys on the M130 end: got %', n; END IF;
  SELECT string_agg(row_kind || '/' || relation, ' ' ORDER BY row_kind, relation) INTO got FROM public.harness_evidence;
  IF got IS DISTINCT FROM 'endpoint/supports termination/needs_bench termination/supports' THEN RAISE EXCEPTION 'evidence links: %', got; END IF;

  -- the model measures itself
  SELECT count(*) INTO n FROM public.stack_needs WHERE stack_id = 'SH';
  IF n <> 13 THEN RAISE EXCEPTION 'SH needs: got %, want 13', n; END IF;
  SELECT numerator INTO n FROM public.v_harness_coverage WHERE measure = 'nets with protection';
  IF n <> 3 THEN RAISE EXCEPTION 'coverage view: nets with protection %', n; END IF;
  SELECT denominator INTO n FROM public.v_harness_coverage WHERE measure = 'segments decided';
  IF n <> 15 THEN RAISE EXCEPTION 'coverage view: segment denominator %, want 15', n; END IF;
END $$;

SELECT 'test_k5_harness_rsi_pass1: PASS' AS result;
