-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_resync -f supabase/sql/test_k5_harness_resync_fold.sql
-- Proves 20261015003000_k5_harness_resync_fold.sql on top of RSI pass 10: after a loader-style run (wires superseded
-- with successors, their ends superseded and reinserted, one wire retired), the fold moves segments to the successor
-- wires and ends, retires the dropped wire's segments, refreshes a legacy zone estimate, leaves an ambiguous end counted,
-- and is idempotent.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_scoreboard_grain.sql

ALTER TABLE public.vehicle_custom_circuits ADD COLUMN IF NOT EXISTS superseded_by uuid;
ALTER TABLE public.wire_termination_specs ADD COLUMN IF NOT EXISTS superseded_by uuid;

-- The loader's run, in the shapes it writes: successors inserted, old wires and ends superseded, successors linked on
-- the wires only.
INSERT INTO public.vehicle_custom_circuits (id, overlay_id, circuit_code, circuit_name, planned_length_ft, design_status, build_state) VALUES
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000f0', '110', 'coolant temp (changed)', 4.6, 'decided', 'uncut'),
  ('00000000-0000-0000-0000-00000000aa04', '00000000-0000-0000-0000-0000000000f0', 'L1', 'lamp 1 branch (changed)', 2.5, 'decided', 'uncut'),
  ('00000000-0000-0000-0000-00000000aa06', '00000000-0000-0000-0000-0000000000f0', 'D1', 'door switch (changed)', 5.0, 'decided', 'uncut');
UPDATE public.vehicle_custom_circuits SET is_superseded = true, superseded_by = '00000000-0000-0000-0000-00000000aa01' WHERE id = '00000000-0000-0000-0000-000000000a01';
UPDATE public.vehicle_custom_circuits SET is_superseded = true, superseded_by = '00000000-0000-0000-0000-00000000aa04' WHERE id = '00000000-0000-0000-0000-000000000a04';
UPDATE public.vehicle_custom_circuits SET is_superseded = true, superseded_by = '00000000-0000-0000-0000-00000000aa06' WHERE id = '00000000-0000-0000-0000-000000000a06';
UPDATE public.vehicle_custom_circuits SET is_superseded = true WHERE id = '00000000-0000-0000-0000-000000000a02';   -- S1 retired
UPDATE public.wire_termination_specs SET is_superseded = true
WHERE circuit_id IN ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000a04', '00000000-0000-0000-0000-000000000a06', '00000000-0000-0000-0000-000000000a02');
INSERT INTO public.wire_termination_specs (id, vehicle_id, circuit_id, endpoint_id) VALUES
  -- 110': the same four plugs
  ('00000000-0000-0000-0000-000000ab0101', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-000000ab0102', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000e3'),
  ('00000000-0000-0000-0000-000000ab0103', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000e4'),
  ('00000000-0000-0000-0000-000000ab0104', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000e2'),
  -- L1': splice -> lamp 1
  ('00000000-0000-0000-0000-000000ab0401', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000aa04', '00000000-0000-0000-0000-0000000000e5'),
  ('00000000-0000-0000-0000-000000ab0402', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000aa04', '00000000-0000-0000-0000-0000000000e6'),
  -- D1': switch, door pass, and two ends on the PDM (ambiguous)
  ('00000000-0000-0000-0000-000000ab0601', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000aa06', '00000000-0000-0000-0000-0000000000ea'),
  ('00000000-0000-0000-0000-000000ab0602', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000aa06', '00000000-0000-0000-0000-0000000000e9'),
  ('00000000-0000-0000-0000-000000ab0603', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000aa06', '00000000-0000-0000-0000-0000000000e8'),
  ('00000000-0000-0000-0000-000000ab0604', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000aa06', '00000000-0000-0000-0000-0000000000e8');

DO $$
DECLARE n int;
BEGIN
  SELECT numerator INTO n FROM public.v_harness_coverage WHERE measure = 'decided wires with a recorded build step';
  IF n IS NULL THEN RAISE EXCEPTION 'fixture: scoreboard missing'; END IF;
END $$;

\i supabase/migrations/20261015003000_k5_harness_resync_fold.sql

DO $$
DECLARE got text; r jsonb; n int;
BEGIN
  SELECT string_agg(c.circuit_code || ':' || right(s.from_termination_id::text, 6) || '>' || right(s.to_termination_id::text, 6), ' ' ORDER BY c.circuit_code COLLATE "C", s.from_termination_id)
    INTO got
  FROM public.harness_segments s JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
  WHERE NOT s.is_superseded AND c.circuit_code IN ('110', 'L1', 'D1', 'S1');
  IF got IS DISTINCT FROM '110:ab0101>ab0102 110:ab0103>ab0104 D1:ab0601>ab0602 D1:ab0602>0b0603 L1:ab0401>ab0402' THEN
    RAISE EXCEPTION 'segments after the fold: %', got;
  END IF;
  SELECT count(*) INTO n FROM public.harness_segments s JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
  WHERE c.circuit_code = 'S1' AND s.is_superseded AND s.design_note LIKE '%left the design%';
  IF n <> 2 THEN RAISE EXCEPTION 'S1 segments retired: %, want 2', n; END IF;
  SELECT planned_length_ft::text INTO got FROM public.harness_segments s WHERE s.vehicle_custom_circuit_id = '00000000-0000-0000-0000-00000000aa04';
  IF got IS DISTINCT FROM '2.5' THEN RAISE EXCEPTION 'L1 plan: %', got; END IF;
  SELECT numerator INTO n FROM public.v_harness_coverage WHERE measure = 'live segments on superseded legacy rows (must be 0)';
  IF n <> 1 THEN RAISE EXCEPTION 'drift measure: %, want 1 (the ambiguous PDM end of D1)', n; END IF;
  r := public.resync_harness_segments('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF (r->>'segments_moved_to_successor')::int + (r->>'segments_retired')::int + (r->>'ends_moved')::int + (r->>'segments_replanned')::int <> 0 THEN
    RAISE EXCEPTION 'the fold is not idempotent: %', r;
  END IF;
  SELECT count(*) INTO n FROM public.stack_needs WHERE stack_id = 'SH';
  IF n <> 23 THEN RAISE EXCEPTION 'SH needs: %, want 23', n; END IF;
END $$;

SELECT 'test_k5_harness_resync_fold: PASS' AS result;
