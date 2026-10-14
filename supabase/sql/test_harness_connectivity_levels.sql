-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_harness_levels -f supabase/sql/test_harness_connectivity_levels.sql
-- Proves 20261014060000_harness_connectivity_levels.sql on the K5's wire #110 (coolant temp), case ledger 13.12.1 H1:
-- one signal, one net, two segments mated at the 61-pin cavity w, each segment with its own length and build state;
-- the four wire ends the legacy query returns are reproduced through the segments; supersession, checks, access and
-- descriptions hold.
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
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;

-- The live shapes the migration references (only the columns it touches).
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean, user_id uuid, owner_id uuid);
CREATE TABLE public.pdm_channels (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.catalog_parts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), part_number text);
CREATE TABLE public.harness_endpoints (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text);
CREATE TABLE public.wire_termination_specs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid,
  endpoint_id uuid REFERENCES public.harness_endpoints(id), cavity text, terminal_contact_pn text, pin_seal_pn text, crimp_tool_pn text);
CREATE TABLE public.vehicle_harness_landmarks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid,
  landmark_code text, distance_in numeric);
CREATE TABLE public.wiring_decision_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), decision_id uuid, relation text,
  endpoint_id uuid REFERENCES public.harness_endpoints(id));
CREATE TABLE public.connector_cavity_layouts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), connector_model text, cavity_id text);
CREATE TABLE public.schema_proposals (id uuid PRIMARY KEY, status text);
INSERT INTO public.schema_proposals VALUES ('cdfc46c3-aee7-4a95-8169-58f45d64d5c7', 'approved');
GRANT SELECT ON public.vehicles TO anon, authenticated;

\i supabase/migrations/20261014060000_harness_connectivity_levels.sql

-- Fixture: the K5 (public) and a private vehicle; wire #110's four ends as the live database holds them.
INSERT INTO public.vehicles VALUES ('00000000-0000-0000-0000-0000000000a1', true, NULL, NULL),
                                   ('00000000-0000-0000-0000-0000000000b1', false, NULL, '00000000-0000-0000-0000-0000000000f1');
INSERT INTO public.harness_endpoints (id, code) VALUES
  ('00000000-0000-0000-0000-00000000e001', 'M130-B'), ('00000000-0000-0000-0000-00000000e002', 'FIREWALL-CABIN'),
  ('00000000-0000-0000-0000-00000000e003', 'FIREWALL-ENGINE'), ('00000000-0000-0000-0000-00000000e004', 'CLT-ECU');
UPDATE public.harness_endpoints SET mates_with_endpoint_id = '00000000-0000-0000-0000-00000000e003' WHERE code = 'FIREWALL-CABIN';
UPDATE public.harness_endpoints SET mates_with_endpoint_id = '00000000-0000-0000-0000-00000000e002' WHERE code = 'FIREWALL-ENGINE';
INSERT INTO public.wire_termination_specs (id, vehicle_id, endpoint_id, cavity, terminal_contact_pn, pin_seal_pn, crimp_tool_pn) VALUES
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000e001', 'B04', 'SSC-N', NULL, 'M22520/2-02'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000e002', 'w', 'M39029/56-351', NULL, 'M22520/2-10'),
  ('00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000e003', 'w', 'M39029/58-363', NULL, 'M22520/2-10'),
  ('00000000-0000-0000-0000-00000000d004', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000e004', '2', '12191818', '15366021', '15359996');

INSERT INTO public.harness_signals (id, vehicle_id, signal_key, name, signal_type, source, method, observed_at, trust) VALUES
  ('00000000-0000-0000-0000-00000000a110', '00000000-0000-0000-0000-0000000000a1', 'coolant_temp', 'coolant temp', 'analog_temp_input',
   'MoTeC M1 hardware tech note p.16 (B04 = AT2)', 'transcribed', '2026-05-13', 'T1');
INSERT INTO public.harness_nets (id, vehicle_id, net_code, signal_id, function, source, method, observed_at, trust) VALUES
  ('00000000-0000-0000-0000-00000000b110', '00000000-0000-0000-0000-0000000000a1', '110', '00000000-0000-0000-0000-00000000a110',
   'coolant temp sensor to M130 AT2', 'receipt 2026-05-13 wire-110 closure', 'decided', '2026-05-13', 'T2');
INSERT INTO public.harness_segments (id, vehicle_id, net_id, from_termination_id, to_termination_id, gauge_awg, colour,
                                     planned_length_ft, planned_length_method, source, method, observed_at, trust) VALUES
  ('00000000-0000-0000-0000-0000000c1101', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000b110',
   '00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000d002', 22, 'yellow/red', 1.2, 'estimate', 'registry wire 110, cabin side', 'decided', '2026-09-26', 'T3'),
  ('00000000-0000-0000-0000-0000000c1102', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000b110',
   '00000000-0000-0000-0000-00000000d003', '00000000-0000-0000-0000-00000000d004', 22, 'yellow/red', 3.4, 'estimate', 'registry wire 110, engine side', 'decided', '2026-09-26', 'T3');

DO $$
DECLARE n int; legacy text; modeled text;
BEGIN
  -- H1: one net, two segments, and the same four wire ends as the legacy query, now in order through the mate.
  SELECT count(*) INTO n FROM public.harness_segments WHERE net_id = '00000000-0000-0000-0000-00000000b110' AND NOT is_superseded;
  IF n <> 2 THEN RAISE EXCEPTION 'net 110 should have 2 live segments, has %', n; END IF;
  SELECT string_agg(e.code || ':' || t.cavity, ' ' ORDER BY e.code) INTO legacy
    FROM public.wire_termination_specs t JOIN public.harness_endpoints e ON e.id = t.endpoint_id;
  SELECT string_agg(e.code || ':' || t.cavity, ' ' ORDER BY e.code) INTO modeled
    FROM public.harness_segments s
    JOIN public.wire_termination_specs t ON t.id IN (s.from_termination_id, s.to_termination_id)
    JOIN public.harness_endpoints e ON e.id = t.endpoint_id
    WHERE s.net_id = '00000000-0000-0000-0000-00000000b110' AND NOT s.is_superseded;
  IF legacy IS DISTINCT FROM modeled THEN RAISE EXCEPTION 'segments do not reproduce the wire ends: % vs %', legacy, modeled; END IF;
  -- The two segments meet at mated halves.
  PERFORM 1 FROM public.harness_segments a JOIN public.wire_termination_specs ta ON ta.id = a.to_termination_id
    JOIN public.harness_endpoints ea ON ea.id = ta.endpoint_id
    JOIN public.harness_segments b ON b.net_id = a.net_id AND b.id <> a.id
    JOIN public.wire_termination_specs tb ON tb.id = b.from_termination_id
    WHERE ea.mates_with_endpoint_id = tb.endpoint_id AND ta.cavity = tb.cavity;
  IF NOT FOUND THEN RAISE EXCEPTION 'segments do not meet at a mated cavity'; END IF;
  -- Each segment carries its own state: cut the cabin side only.
  INSERT INTO public.harness_segments (vehicle_id, net_id, from_termination_id, to_termination_id, gauge_awg, colour,
    planned_length_ft, planned_length_method, measured_length_ft, measured_at, build_state, source, method, observed_at, trust)
  SELECT vehicle_id, net_id, from_termination_id, to_termination_id, gauge_awg, colour, planned_length_ft,
    planned_length_method, 1.3, '2026-10-20', 'cut', 'tape measure at the formboard (fixture)', 'measured', '2026-10-20', 'T1'
  FROM public.harness_segments WHERE id = '00000000-0000-0000-0000-0000000c1101';
  -- a second live row on the same ends must fail until the first is superseded
  RAISE EXCEPTION 'unreachable';
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

-- Supersede, then the measured row lands.
UPDATE public.harness_segments SET is_superseded = true WHERE id = '00000000-0000-0000-0000-0000000c1101';
INSERT INTO public.harness_segments (vehicle_id, net_id, from_termination_id, to_termination_id, gauge_awg, colour,
  planned_length_ft, planned_length_method, measured_length_ft, measured_at, build_state, source, method, observed_at, trust)
SELECT vehicle_id, net_id, from_termination_id, to_termination_id, gauge_awg, colour, planned_length_ft,
  planned_length_method, 1.3, '2026-10-20', 'cut', 'tape measure at the formboard (fixture)', 'measured', '2026-10-20', 'T1'
FROM public.harness_segments WHERE id = '00000000-0000-0000-0000-0000000c1101';

DO $$
DECLARE n int; err int := 0;
BEGIN
  SELECT count(*) INTO n FROM public.harness_segments
    WHERE net_id = '00000000-0000-0000-0000-00000000b110' AND NOT is_superseded AND build_state = 'cut' AND measured_length_ft = 1.3;
  IF n <> 1 THEN RAISE EXCEPTION 'the cabin segment should be cut and measured alone, got %', n; END IF;
  SELECT count(*) INTO n FROM public.harness_segments
    WHERE net_id = '00000000-0000-0000-0000-00000000b110' AND NOT is_superseded AND build_state = 'uncut';
  IF n <> 1 THEN RAISE EXCEPTION 'the engine segment should stay uncut, got %', n; END IF;
  BEGIN UPDATE public.harness_segments SET build_state = 'done' WHERE id = '00000000-0000-0000-0000-0000000c1102'; err := err + 1;
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.harness_segments SET measured_length_ft = 3.5 WHERE id = '00000000-0000-0000-0000-0000000c1102'; err := err + 1;
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF err > 0 THEN RAISE EXCEPTION '% invalid writes were accepted', err; END IF;
  -- every new column described
  SELECT count(*) INTO n FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name LIKE 'harness\_%' AND c.table_name <> 'harness_endpoints'
     AND col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position) IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '% columns undescribed', n; END IF;
END $$;

-- Access: anon reads the public vehicle's harness, not the private one, and cannot write.
INSERT INTO public.harness_signals (vehicle_id, signal_key, name, source, method, observed_at, trust)
VALUES ('00000000-0000-0000-0000-0000000000b1', 'private_sig', 'private', 'fixture', 'decided', now(), 'T3');
SET ROLE anon;
SELECT set_config('test.auth_uid', '', false);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.harness_signals;
  IF n <> 1 THEN RAISE EXCEPTION 'anon should see 1 signal (public vehicle only), sees %', n; END IF;
  SELECT count(*) INTO n FROM public.harness_segments;
  IF n < 2 THEN RAISE EXCEPTION 'anon should read the public segments, sees %', n; END IF;
  BEGIN
    INSERT INTO public.harness_signals (vehicle_id, signal_key, name, source, method, observed_at, trust)
    VALUES ('00000000-0000-0000-0000-0000000000a1', 'x', 'x', 'x', 'x', now(), 'T3');
    RAISE EXCEPTION 'anon inserted a signal';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('test.auth_uid', '00000000-0000-0000-0000-0000000000f1', false);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.harness_signals;
  IF n <> 2 THEN RAISE EXCEPTION 'the private vehicle''s owner should see 2 signals, sees %', n; END IF;
END $$;
RESET ROLE;

SELECT 'test_harness_connectivity_levels: PASS' AS result;
