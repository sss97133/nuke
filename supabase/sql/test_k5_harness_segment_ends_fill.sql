-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_fill -f supabase/sql/test_k5_harness_segment_ends_fill.sql
-- Proves 20261015100000_k5_harness_segment_ends_fill.sql on top of RSI pass 16 (re-issued writer): a decided wire whose
-- only segment has no ends takes the reshape's segmentation of the ends that arrived later (hop 1 in place, hop 2 a new
-- segment, the whole-wire length cleared with its reason); a wire with only a grommet end is left alone; the scoreboard
-- counts wire ends on no live segment and reads 0 after the fill; the fill is idempotent and every UPDATE has a WHERE.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_splices_where.sql

-- Two wires the reshape left with an empty segment: TX1 now has three ends (PDM30-A A5, the door pass-through, LAMP-2);
-- TX2 has only a grommet end.
INSERT INTO public.vehicle_custom_circuits (id, overlay_id, circuit_code, circuit_name, design_status, build_state, from_endpoint_id, to_endpoint_id, planned_length_ft) VALUES
  ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000f0', 'TX1', 'late wire', 'decided', 'uncut',
   '00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000e7', 6.5),
  ('00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-0000000000f0', 'TX2', 'grommet only', 'decided', 'uncut',
   '00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000e6', 2.0);
INSERT INTO public.harness_nets (id, vehicle_id, net_code, source, method, observed_at, trust) VALUES
  ('00000000-0000-0000-0000-00000000f0a1', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', 'TX1', 'fixture', 'fixture', now(), 'fixture'),
  ('00000000-0000-0000-0000-00000000f0a2', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', 'TX2', 'fixture', 'fixture', now(), 'fixture');
INSERT INTO public.harness_segments (id, vehicle_id, net_id, vehicle_custom_circuit_id, from_termination_id, to_termination_id, planned_length_ft, planned_length_method, design_status, source, method, observed_at, trust) VALUES
  ('00000000-0000-0000-0000-00000000f0b1', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000f0a1', '00000000-0000-0000-0000-00000000f001', NULL, NULL, 6.5, 'whole-wire zone estimate', 'decided', 'fixture', 'reshaped v1', now(), 'fixture'),
  ('00000000-0000-0000-0000-00000000f0b2', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000f0a2', '00000000-0000-0000-0000-00000000f002', NULL, NULL, 2.0, 'whole-wire zone estimate', 'decided', 'fixture', 'reshaped v1', now(), 'fixture');
INSERT INTO public.wire_termination_specs (id, vehicle_id, circuit_id, endpoint_id, cavity) VALUES
  ('00000000-0000-0000-0000-00000000f0c1', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000e7', 'lamp lead'),
  ('00000000-0000-0000-0000-00000000f0c2', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000e9', '3'),
  ('00000000-0000-0000-0000-00000000f0c3', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000e8', 'A5'),
  ('00000000-0000-0000-0000-00000000f0c4', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000f002', '00000000-0000-0000-0000-0000000000eb', NULL);

\i supabase/migrations/20261015100000_k5_harness_segment_ends_fill.sql

DO $$
DECLARE r jsonb; got text; n int; before_ int;
BEGIN
  -- Before: TX1's 3 ends, and D1's two live ends at PDM30-A (the pass 11 fixture's ambiguous match, left in place).
  SELECT numerator INTO before_ FROM public.v_harness_coverage WHERE measure = 'wire ends of decided wires on no live segment (must be 0)';
  IF before_ <> 5 THEN RAISE EXCEPTION 'loose ends before the fill: %, want 5', before_; END IF;

  r := public.fill_harness_segment_ends('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF r IS DISTINCT FROM '{"segments_added": 1, "segments_filled": 1, "wires_with_no_hop": 1, "wires_with_empty_segments_and_live_ends": 2}'::jsonb THEN
    RAISE EXCEPTION 'fill: %', r;
  END IF;

  -- TX1: hop 1 in place (same row), hop 2 new; ends in order PDM30-A, door pass-through, LAMP-2; the length is cleared.
  SELECT string_agg((s.id = '00000000-0000-0000-0000-00000000f0b1')::text || ':' || fe.cavity || '>' || te.cavity || ':' || coalesce(s.planned_length_ft::text, '-'),
                    ' ' ORDER BY (s.id = '00000000-0000-0000-0000-00000000f0b1') DESC) INTO got
  FROM public.harness_segments s
  JOIN public.wire_termination_specs fe ON fe.id = s.from_termination_id JOIN public.wire_termination_specs te ON te.id = s.to_termination_id
  WHERE s.vehicle_custom_circuit_id = '00000000-0000-0000-0000-00000000f001' AND NOT s.is_superseded;
  IF got IS DISTINCT FROM 'true:A5>3:- false:3>lamp lead:-' THEN RAISE EXCEPTION 'TX1 segments: %', got; END IF;
  SELECT planned_length_method INTO got FROM public.harness_segments WHERE id = '00000000-0000-0000-0000-00000000f0b1';
  IF got NOT LIKE 'unknown: the whole-wire estimate (6.5 ft) was never split%' THEN RAISE EXCEPTION 'TX1 length reason: %', got; END IF;
  SELECT count(*) INTO n FROM public.harness_segments WHERE vehicle_custom_circuit_id = '00000000-0000-0000-0000-00000000f001' AND NOT is_superseded AND net_id = '00000000-0000-0000-0000-00000000f0a1';
  IF n <> 2 THEN RAISE EXCEPTION 'TX1 hops on its net: %', n; END IF;
  -- TX2: untouched (a grommet does not end a wire).
  SELECT coalesce(from_termination_id::text, '-') || '/' || coalesce(to_termination_id::text, '-') || '/' || planned_length_ft INTO got
  FROM public.harness_segments WHERE id = '00000000-0000-0000-0000-00000000f0b2';
  IF got IS DISTINCT FROM '-/-/2.0' THEN RAISE EXCEPTION 'TX2: %', got; END IF;

  SELECT numerator INTO n FROM public.v_harness_coverage WHERE measure = 'wire ends of decided wires on no live segment (must be 0)';
  IF n <> 2 THEN RAISE EXCEPTION 'loose ends after the fill: %, want D1''s 2', n; END IF;
  SELECT count(*) INTO n FROM public.v_harness_coverage;
  IF n <> 37 THEN RAISE EXCEPTION 'scoreboard measures: %, want 37', n; END IF;
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a measure has no grain'; END IF;

  r := public.fill_harness_segment_ends('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF (r->>'segments_filled')::int + (r->>'segments_added')::int <> 0 THEN RAISE EXCEPTION 'not idempotent: %', r; END IF;

  IF has_function_privilege('anon', 'public.fill_harness_segment_ends(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'the public can run the fill'; END IF;
  SELECT count(*) INTO n FROM public.stack_needs WHERE stack_id = 'SH';
  IF n <> 40 THEN RAISE EXCEPTION 'SH needs: %, want 40', n; END IF;
END $$;

-- The fill's UPDATEs carry a WHERE too (the production API refuses one without).
DO $$
DECLARE st text; t text; bad text[] := '{}';
BEGIN
  FOR st IN SELECT s FROM pg_proc p,
              regexp_split_to_table(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '''([^'']|'''')*''', '''''', 'g'), ';') s
            WHERE p.proname = 'fill_harness_segment_ends' AND p.pronamespace = 'public'::regnamespace LOOP
    LOOP t := regexp_replace(st, '\([^()]*\)', ' ', 'g'); EXIT WHEN t = st; st := t; END LOOP;
    IF st ~* '(^|\s)(UPDATE\s+\S+\s+(\S+\s+)?SET|DELETE\s+FROM)\M' AND st !~* '\mWHERE\M' THEN bad := bad || left(btrim(st), 80); END IF;
  END LOOP;
  IF cardinality(bad) > 0 THEN RAISE EXCEPTION 'UPDATE with no WHERE: %', bad; END IF;
END $$;

SELECT 'test_k5_harness_segment_ends_fill: PASS' AS result;
