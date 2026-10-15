-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_conform -f supabase/sql/test_k5_harness_conform_segments.sql
-- Proves 20261015150000_k5_harness_conform_segments.sql on top of RSI pass 19: a wire the loader adds with no segment gets
-- its segment and a net of its own; a wire the loader superseded whose start moved to a new plug (resync leaves that end on
-- the superseded row) takes its new end in place; a wire with two live ends on one plug is left alone; the scoreboard
-- counts decided wires with no live segment; the fold is idempotent and every UPDATE has a WHERE.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_segment_ends_fill.sql

-- TN1: a wire the loader added after the reshape (two ends, no segment).
-- TY1 -> TY2: a wire whose start moved from PDM30-A to the splice SPL-X; the loader superseded TY1 and its ends.
INSERT INTO public.vehicle_custom_circuits (id, overlay_id, circuit_code, circuit_name, design_status, build_state, from_endpoint_id, to_endpoint_id, planned_length_ft) VALUES
  ('00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-0000000000f0', 'TN1', 'new pigtail', 'decided', 'uncut',
   '00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000e5', 0.5),
  ('00000000-0000-0000-0000-00000000c0b1', '00000000-0000-0000-0000-0000000000f0', 'TY1', 'moved feed', 'decided', 'uncut',
   '00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000e7', 4.6);
INSERT INTO public.wire_termination_specs (id, vehicle_id, circuit_id, endpoint_id, cavity) VALUES
  ('00000000-0000-0000-0000-00000000c1a1', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-0000000000e8', 'A9'),
  ('00000000-0000-0000-0000-00000000c1a2', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000c0a1', '00000000-0000-0000-0000-0000000000e5', 'splice 1'),
  ('00000000-0000-0000-0000-00000000c1b1', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000c0b1', '00000000-0000-0000-0000-0000000000e8', 'A11'),
  ('00000000-0000-0000-0000-00000000c1b2', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000c0b1', '00000000-0000-0000-0000-0000000000e7', 'lamp lead');
INSERT INTO public.harness_nets (id, vehicle_id, net_code, source, method, observed_at, trust) VALUES
  ('00000000-0000-0000-0000-00000000c2b1', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', 'TY1', 'fixture', 'fixture', now(), 'fixture');
INSERT INTO public.harness_segments (id, vehicle_id, net_id, vehicle_custom_circuit_id, from_termination_id, to_termination_id, planned_length_ft, planned_length_method, design_status, source, method, observed_at, trust) VALUES
  ('00000000-0000-0000-0000-00000000c3b1', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000c2b1', '00000000-0000-0000-0000-00000000c0b1',
   '00000000-0000-0000-0000-00000000c1b1', '00000000-0000-0000-0000-00000000c1b2', 4.6, 'whole-wire zone estimate', 'decided', 'fixture', 'reshaped v1', now(), 'fixture');
-- The loader's run: TY1 superseded by TY2, which starts at the splice; its ends re-inserted, the old ones superseded.
INSERT INTO public.vehicle_custom_circuits (id, overlay_id, circuit_code, circuit_name, design_status, build_state, from_endpoint_id, to_endpoint_id, planned_length_ft) VALUES
  ('00000000-0000-0000-0000-00000000c0b2', '00000000-0000-0000-0000-0000000000f0', 'TY1', 'moved feed', 'decided', 'uncut',
   '00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e7', 4.6);
UPDATE public.vehicle_custom_circuits SET is_superseded = true, superseded_by = '00000000-0000-0000-0000-00000000c0b2' WHERE id = '00000000-0000-0000-0000-00000000c0b1';
UPDATE public.wire_termination_specs SET is_superseded = true WHERE circuit_id = '00000000-0000-0000-0000-00000000c0b1';
INSERT INTO public.wire_termination_specs (id, vehicle_id, circuit_id, endpoint_id, cavity) VALUES
  ('00000000-0000-0000-0000-00000000c1c1', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000c0b2', '00000000-0000-0000-0000-0000000000e5', 'splice 3'),
  ('00000000-0000-0000-0000-00000000c1c2', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000c0b2', '00000000-0000-0000-0000-0000000000e7', 'lamp lead');
SELECT public.resync_harness_segments('e08bf694-970f-4cbe-8a74-8715158a0f2e');

\i supabase/migrations/20261015150000_k5_harness_conform_segments.sql

DO $$
DECLARE r jsonb; got text; n int;
BEGIN
  -- Before: TN1 has no segment; TY1's segment moved to TY2 but kept the superseded PDM30-A end.
  SELECT numerator || '/' || denominator INTO got FROM public.v_harness_coverage WHERE measure = 'decided wires with no live segment (must be 0)';
  IF split_part(got, '/', 1)::int < 1 THEN RAISE EXCEPTION 'wires with no segment before: %', got; END IF;
  SELECT coalesce(ft.id::text, '-') || '/' || ft.is_superseded INTO got FROM public.harness_segments s JOIN public.wire_termination_specs ft ON ft.id = s.from_termination_id
  WHERE s.id = '00000000-0000-0000-0000-00000000c3b1';
  IF got IS DISTINCT FROM '00000000-0000-0000-0000-00000000c1b1/true' THEN RAISE EXCEPTION 'TY segment before: %', got; END IF;

  r := public.conform_harness_segments('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  RAISE NOTICE 'conform: %', r;
  IF (r->>'segments_added')::int < 1 OR (r->>'segments_updated')::int < 1 OR (r->>'nets_for_new_wires')::int < 1 THEN RAISE EXCEPTION 'conform: %', r; END IF;

  -- TN1: one segment, PDM30-A A9 -> SPL-X, on a net of its own, with its whole-wire length.
  SELECT fe.cavity || '>' || te.cavity || '/' || n2.net_code || '/' || coalesce(s.planned_length_ft::text, '-') INTO got
  FROM public.harness_segments s JOIN public.wire_termination_specs fe ON fe.id = s.from_termination_id JOIN public.wire_termination_specs te ON te.id = s.to_termination_id
  JOIN public.harness_nets n2 ON n2.id = s.net_id
  WHERE s.vehicle_custom_circuit_id = '00000000-0000-0000-0000-00000000c0a1' AND NOT s.is_superseded;
  IF got IS DISTINCT FROM 'A9>splice 1/wire TN1/0.5' THEN RAISE EXCEPTION 'TN1: %', got; END IF;
  -- TY2: the same segment row, now from the splice end; its length kept.
  SELECT s.vehicle_custom_circuit_id::text || '/' || fe.cavity || '>' || te.cavity || '/' || s.planned_length_ft INTO got
  FROM public.harness_segments s JOIN public.wire_termination_specs fe ON fe.id = s.from_termination_id JOIN public.wire_termination_specs te ON te.id = s.to_termination_id
  WHERE s.id = '00000000-0000-0000-0000-00000000c3b1' AND NOT s.is_superseded;
  IF got IS DISTINCT FROM '00000000-0000-0000-0000-00000000c0b2/splice 3>lamp lead/4.6' THEN RAISE EXCEPTION 'TY2: %', got; END IF;
  -- D1 (two live ends on PDM30-A, the pass 11 fixture) is left as it was.
  SELECT count(*) INTO n FROM public.harness_segments s JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
  WHERE c.circuit_code = 'D1' AND NOT s.is_superseded AND s.method LIKE '%RSI pass 25%';
  IF n <> 0 THEN RAISE EXCEPTION 'D1 was conformed'; END IF;

  SELECT numerator INTO n FROM public.v_harness_coverage WHERE measure = 'decided wires with no live segment (must be 0)';
  IF n <> 0 THEN RAISE EXCEPTION 'wires with no segment after: %', n; END IF;
  SELECT numerator INTO n FROM public.v_harness_coverage WHERE measure = 'live segments on superseded legacy rows (must be 0)';
  IF n <> 1 THEN RAISE EXCEPTION 'segments on superseded rows after: %, want D1''s 1', n; END IF;
  SELECT count(*) INTO n FROM public.v_harness_coverage;
  IF n <> 38 THEN RAISE EXCEPTION 'scoreboard measures: %, want 38', n; END IF;
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a measure has no grain'; END IF;

  r := public.conform_harness_segments('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF (r->>'segments_added')::int + (r->>'segments_updated')::int + (r->>'segments_superseded')::int + (r->>'nets_for_new_wires')::int <> 0 THEN
    RAISE EXCEPTION 'not idempotent: %', r;
  END IF;
  IF has_function_privilege('anon', 'public.conform_harness_segments(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'the public can run the fold'; END IF;
  SELECT count(*) INTO n FROM public.stack_needs WHERE stack_id = 'SH';
  IF n <> 41 THEN RAISE EXCEPTION 'SH needs: %, want 41', n; END IF;
END $$;

DO $$
DECLARE st text; t text; bad text[] := '{}';
BEGIN
  FOR st IN SELECT s FROM pg_proc p,
              regexp_split_to_table(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '''([^'']|'''')*''', '''''', 'g'), ';') s
            WHERE p.proname = 'conform_harness_segments' AND p.pronamespace = 'public'::regnamespace LOOP
    LOOP t := regexp_replace(st, '\([^()]*\)', ' ', 'g'); EXIT WHEN t = st; st := t; END LOOP;
    IF st ~* '(^|\s)(UPDATE\s+\S+\s+(\S+\s+)?SET|DELETE\s+FROM)\M' AND st !~* '\mWHERE\M' THEN bad := bad || left(btrim(st), 80); END IF;
  END LOOP;
  IF cardinality(bad) > 0 THEN RAISE EXCEPTION 'UPDATE or DELETE with no WHERE: %', bad; END IF;
END $$;

SELECT 'test_k5_harness_conform_segments: PASS' AS result;
