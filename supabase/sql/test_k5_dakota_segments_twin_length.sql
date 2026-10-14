-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_dakota -f supabase/sql/test_k5_dakota_segments_twin_length.sql
-- Proves 20261015001000_k5_dakota_segments_twin_length.sql on top of the geometry check: a PDM30 -> Dakota segment
-- planned below the straight line is re-planned to the twin route; other segments are untouched.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_geometry_check.sql

INSERT INTO public.harness_endpoints (id, design_id, code, name, endpoint_type, location_zone, pos_x_m, pos_y_m, pos_z_m, pos_source) VALUES
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000d0', 'DAKOTA-VHX', 'Dakota VHX box', 'display', 'cabin', 0.62, -1.24, 1.05, 'fixture');
UPDATE public.harness_endpoints SET pos_x_m = -0.45, pos_y_m = -1.28, pos_z_m = 0.82 WHERE code = 'PDM30-A';
INSERT INTO public.vehicle_custom_circuits (id, overlay_id, circuit_code, circuit_name, design_status, build_state) VALUES
  ('00000000-0000-0000-0000-000000000b19', '00000000-0000-0000-0000-0000000000f0', '119', 'Dakota turn left', 'decided', 'uncut');
INSERT INTO public.wire_termination_specs (id, vehicle_id, circuit_id, endpoint_id, cavity) VALUES
  ('00000000-0000-0000-0000-0000000b1901', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000b19', '00000000-0000-0000-0000-0000000000e8', 'A11'),
  ('00000000-0000-0000-0000-0000000b1902', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-000000000b19', '00000000-0000-0000-0000-0000000000a7', 'LEFT');
INSERT INTO public.harness_segments (vehicle_id, net_id, from_termination_id, to_termination_id, vehicle_custom_circuit_id, planned_length_ft, planned_length_method, source, method, observed_at, trust)
SELECT 'e08bf694-970f-4cbe-8a74-8715158a0f2e', n.id, '00000000-0000-0000-0000-0000000b1901', '00000000-0000-0000-0000-0000000b1902',
       '00000000-0000-0000-0000-000000000b19', 1.5, 'whole-wire zone estimate', 'fixture', 'fixture', now(), 'T3'
FROM public.harness_nets n WHERE NOT n.is_superseded LIMIT 1;

\i supabase/migrations/20261015001000_k5_dakota_segments_twin_length.sql

DO $$
DECLARE got text;
BEGIN
  SELECT planned_ft || '/' || straight_ft INTO got FROM public.v_harness_segment_geometry WHERE circuit_code = '119';
  IF got IS DISTINCT FROM '3.7/3.59' THEN RAISE EXCEPTION '#119: %', got; END IF;
  SELECT string_agg(from_plug || '>' || to_plug || ':' || planned_ft, ' ' ORDER BY from_plug COLLATE "C") INTO got
  FROM public.v_harness_segment_geometry WHERE circuit_code = '110';
  IF got IS DISTINCT FROM 'FIREWALL-ENGINE>CLT-ECU:1.0 M130-B>FIREWALL-CABIN:2.0' THEN RAISE EXCEPTION 'other segments changed: %', got; END IF;
END $$;

SELECT 'test_k5_dakota_segments_twin_length: PASS' AS result;
