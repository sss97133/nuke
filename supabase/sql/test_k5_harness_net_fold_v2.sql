-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_fold2 -f supabase/sql/test_k5_harness_net_fold_v2.sql
-- Proves 20261014153000_k5_harness_net_fold_v2.sql on top of RSI pass 4: a v1-shaped net that joins the battery + post
-- and a PDM output to ground (through a stud bank and a lamp typed ground) is superseded and refolded; the scoreboard's
-- physics check reads 0; design loads and PDM protection land on the new nets; the nets that did not change keep their ids.
\set ON_ERROR_STOP on
\i supabase/sql/test_gm_circuit_dictionary_1978_chart.sql

ALTER TABLE public.vehicle_custom_circuits ADD COLUMN notes text;
INSERT INTO public.device_pin_maps VALUES ('PDM30', 'A24', 'OUT19', 8);
INSERT INTO public.pdm_channels (pdm_unit_id, channel_number, channel_group_name, fuse_rating_amps)
SELECT id, 19, 'OUT19', 8 FROM public.pdm_units WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND model = 'MoTeC PDM30';

-- The DC primary as the legacy rows hold it, and the net the v1 fold made of it.
INSERT INTO public.harness_endpoints (id, design_id, code, name, endpoint_type, location_zone) VALUES
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000d0', 'ODYSSEY', 'battery', 'power_source', 'engine'),
  ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000d0', 'PS-STUDS', 'DC primary cable ends', 'ground', 'engine'),
  ('00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-0000000000d0', 'GND-BANK-ENG', 'ground star', 'ground', 'engine'),
  ('00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000d0', 'MARKER-LF', 'left front side marker', 'ground', 'engine');
INSERT INTO public.vehicle_custom_circuits (id, overlay_id, circuit_code, circuit_name, wire_gauge_awg, from_endpoint_id, to_endpoint_id, source, observed_at, trust, design_status, build_state, notes) VALUES
  ('00000000-0000-0000-0000-000000000c63', '00000000-0000-0000-0000-0000000000f0', '63', 'battery + to isolator', 2, '00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000f5', 'k5_registry v5', '2026-09-26', 'T3', 'decided', 'uncut',
   'sized from physics 2026-09-28: load 180 A (every load with the engine off; cranking 200 A brief); ampacity 240 A'),
  ('00000000-0000-0000-0000-000000000c64', '00000000-0000-0000-0000-0000000000f0', 'ODY_NEG', 'battery return', 2, '00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000f5', 'k5_registry v5', '2026-09-26', 'T3', 'decided', 'uncut',
   'sized from physics 2026-09-28: load 180 A (the battery''s return); ampacity 240 A'),
  ('00000000-0000-0000-0000-000000000c65', '00000000-0000-0000-0000-0000000000f0', 'G1', 'block ground', 2, '00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-0000000000f5', 'k5_registry v5', '2026-09-26', 'T3', 'decided', 'uncut',
   'sized from physics 2026-09-28: load 150 A (starter return 200 A brief); ampacity 240 A'),
  ('00000000-0000-0000-0000-000000000c66', '00000000-0000-0000-0000-0000000000f0', '87', 'marker LF feed', 18, '00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000f7', 'k5_registry v5', '2026-09-26', 'T3', 'decided', 'uncut', NULL),
  ('00000000-0000-0000-0000-000000000c67', '00000000-0000-0000-0000-0000000000f0', 'MK_LF_GND', 'marker LF ground lead', 18, '00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-0000000000f6', 'k5_registry v5', '2026-09-26', 'T3', 'decided', 'uncut', NULL);
INSERT INTO public.wire_termination_specs (id, vehicle_id, circuit_id, endpoint_id, cavity) VALUES
  ('00000000-0000-0000-0000-0000000c6301', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000c63', '00000000-0000-0000-0000-0000000000f4', '+ post (main cable)'),
  ('00000000-0000-0000-0000-0000000c6302', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000c63', '00000000-0000-0000-0000-0000000000f5', 'stud, lug 238LTP'),
  ('00000000-0000-0000-0000-0000000c6401', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000c64', '00000000-0000-0000-0000-0000000000f4', '- post'),
  ('00000000-0000-0000-0000-0000000c6402', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000c64', '00000000-0000-0000-0000-0000000000f5', 'stud, lug 238LTP'),
  ('00000000-0000-0000-0000-0000000c6501', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000c65', '00000000-0000-0000-0000-0000000000f6', 'ring 1'),
  ('00000000-0000-0000-0000-0000000c6502', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000c65', '00000000-0000-0000-0000-0000000000f5', 'stud, lug 238LTP'),
  ('00000000-0000-0000-0000-0000000c6601', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000c66', '00000000-0000-0000-0000-0000000000e8', 'A24'),
  ('00000000-0000-0000-0000-0000000c6602', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000c66', '00000000-0000-0000-0000-0000000000f7', 'park-circuit lead'),
  ('00000000-0000-0000-0000-0000000c6701', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000c67', '00000000-0000-0000-0000-0000000000f7', 'second lead'),
  ('00000000-0000-0000-0000-0000000c6702', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000c67', '00000000-0000-0000-0000-0000000000f6', 'ring 2');
INSERT INTO public.harness_signals (id, vehicle_id, signal_key, name, signal_type, source, method, observed_at, trust) VALUES
  ('00000000-0000-0000-0000-00000000a5a5', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', 'GND-BANK-ENG', 'GND-BANK-ENG', 'ground', 'fixture', 'reshaped v1', '2026-09-26', 'T3');
INSERT INTO public.harness_nets (id, vehicle_id, net_code, signal_id, function, source, method, observed_at, trust, protection_pdm_channel_id) VALUES
  ('00000000-0000-0000-0000-00000000b5b5', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', 'GND-BANK-ENG', '00000000-0000-0000-0000-00000000a5a5', 'GND-BANK-ENG', 'fixture', 'reshaped v1', '2026-09-26', 'T3',
   (SELECT ch.id FROM public.pdm_channels ch JOIN public.pdm_units u ON u.id = ch.pdm_unit_id WHERE u.model = 'MoTeC PDM30' AND u.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND ch.channel_number = 19));
INSERT INTO public.harness_segments (vehicle_id, net_id, from_termination_id, to_termination_id, vehicle_custom_circuit_id, source, method, observed_at, trust)
SELECT 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000b5b5', a, b, c, 'fixture', 'reshaped v1', '2026-09-26', 'T3'
FROM (VALUES
  ('00000000-0000-0000-0000-0000000c6301'::uuid, '00000000-0000-0000-0000-0000000c6302'::uuid, '00000000-0000-0000-0000-000000000c63'::uuid),
  ('00000000-0000-0000-0000-0000000c6401', '00000000-0000-0000-0000-0000000c6402', '00000000-0000-0000-0000-000000000c64'),
  ('00000000-0000-0000-0000-0000000c6501', '00000000-0000-0000-0000-0000000c6502', '00000000-0000-0000-0000-000000000c65'),
  ('00000000-0000-0000-0000-0000000c6601', '00000000-0000-0000-0000-0000000c6602', '00000000-0000-0000-0000-000000000c66'),
  ('00000000-0000-0000-0000-0000000c6701', '00000000-0000-0000-0000-0000000c6702', '00000000-0000-0000-0000-000000000c67')) v(a, b, c);

-- Before: the scoreboard sees the short.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.harness_nets WHERE NOT is_superseded;
  IF n <> 10 THEN RAISE EXCEPTION 'fixture: live nets %, want 10', n; END IF;
END $$;
CREATE TEMP TABLE before_nets AS SELECT id, net_code FROM public.harness_nets WHERE NOT is_superseded AND net_code <> 'GND-BANK-ENG';

\i supabase/migrations/20261014153000_k5_harness_net_fold_v2.sql

DO $$
DECLARE n int; got text;
BEGIN
  SELECT string_agg(code || '=' || node_kind, ' ' ORDER BY code COLLATE "C") INTO got FROM public.harness_endpoints
  WHERE code IN ('PS-STUDS', 'MARKER-LF', 'GND-BANK-ENG', 'SPL-X', 'ODYSSEY');
  IF got IS DISTINCT FROM 'GND-BANK-ENG=bus MARKER-LF=terminals ODYSSEY=terminals PS-STUDS=terminals SPL-X=bus' THEN RAISE EXCEPTION 'node kinds: %', got; END IF;

  SELECT is_superseded::text || ':' || coalesce((SELECT net_code FROM public.harness_nets x WHERE x.id = n.superseded_by), '-') INTO got
  FROM public.harness_nets n WHERE n.id = '00000000-0000-0000-0000-00000000b5b5';
  IF got IS DISTINCT FROM 'true:GND-BANK-ENG' THEN RAISE EXCEPTION 'the shorted net: %', got; END IF;

  SELECT string_agg(n.net_code || ':' || coalesce(n.nominal_current_a::text, '-') || '/' || coalesce(n.peak_current_a::text, '-') || ':' || coalesce(ch.channel_group_name, '-')
                    || ':' || (SELECT string_agg(c.circuit_code, ',' ORDER BY c.circuit_code COLLATE "C") FROM public.harness_segments s JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id WHERE s.net_id = n.id AND NOT s.is_superseded),
                    ' | ' ORDER BY n.net_code COLLATE "C") INTO got
  FROM public.harness_nets n LEFT JOIN public.pdm_channels ch ON ch.id = n.protection_pdm_channel_id
  WHERE NOT n.is_superseded AND n.net_code IN ('63', '87', 'GND-BANK-ENG', 'ODY_NEG');
  IF got IS DISTINCT FROM '63:180/200:-:63 | 87:-/-:OUT19:87 | GND-BANK-ENG:150/-:-:G1,MK_LF_GND | ODY_NEG:180/-:-:ODY_NEG' THEN
    RAISE EXCEPTION 'refolded nets: %', got;
  END IF;

  SELECT count(*) INTO n FROM before_nets b JOIN public.harness_nets n ON n.id = b.id AND NOT n.is_superseded;
  IF n <> 9 THEN RAISE EXCEPTION 'unchanged nets kept: %, want 9', n; END IF;
  SELECT numerator INTO n FROM public.v_harness_coverage WHERE measure = 'nets that join a supply to ground (must be 0)';
  IF n <> 0 THEN RAISE EXCEPTION 'physics check: %', n; END IF;
  SELECT count(*) INTO n FROM public.stack_needs WHERE stack_id = 'SH';
  IF n <> 19 THEN RAISE EXCEPTION 'SH needs: got %, want 19', n; END IF;
END $$;

SELECT 'test_k5_harness_net_fold_v2: PASS' AS result;
