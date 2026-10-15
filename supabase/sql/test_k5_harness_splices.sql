-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_splices -f supabase/sql/test_k5_harness_splices.sql
-- Proves 20261015090000_k5_harness_splices.sql on top of RSI pass 15: registry-shaped splice rows land as splices and
-- members (at a pin, in-line with sides, a place the model lacks, a lead named in words); the net fold joins wires that
-- share only a splice; the pin view tells a spliced pin from two wires crowded into one contact; the fill check finds a
-- splice over its crimp range and a pin with no lead named; the writer is idempotent, supersedes a changed splice,
-- retires a dropped one, and refuses a splice that would join a supply to ground.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_pdm_channel_settings_fold.sql

-- TP1 and TP2 share PDM30-A A2 again (the pass 14 test moved TP2 to A3); TQ2 moves into TQ1's contact f.
UPDATE public.wire_termination_specs SET cavity = 'A2' WHERE id = '00000000-0000-0000-0000-0000000d0021';
UPDATE public.wire_termination_specs SET cavity = 'f' WHERE id = '00000000-0000-0000-0000-0000000d0041';
UPDATE public.vehicle_custom_circuits SET wire_gauge_awg = 22 WHERE circuit_code IN ('TP1', 'TP2');

\i supabase/migrations/20261015090000_k5_harness_splices.sql

DO $$
DECLARE r jsonb; got text; n int; rows_ jsonb; old_id uuid;
BEGIN
  rows_ := '[
    {"at": "PDM30-A A02", "wires": ["TP1", "TP2", "20 AWG pin lead"], "splice": "D-609-04", "equiv_awg": 16},
    {"at": "SPL-X", "wires": ["L0", "L1", "L2"], "splice": "M81824/1-2", "type": "in-line", "sides": [["L0"], ["L1", "L2"]], "equiv_awg": [20, 17]},
    {"at": "NOPE-PLUG B01", "wires": ["GHOST"], "splice": "D-609-99", "equiv_awg": 22},
    {"at": "PDM30-A A24", "wires": ["87", "BB1", "D1"], "splice": "D-609-04", "equiv_awg": 14}
  ]';
  r := public.load_harness_splices('e08bf694-970f-4cbe-8a74-8715158a0f2e', rows_, 'fixture registry @ test');
  IF (r->>'splices_written')::int <> 4 OR (r->>'members')::int <> 10 OR (r->>'members_keyed')::int <> 8
     OR r->'members_not_a_wire' IS DISTINCT FROM '["20 AWG pin lead", "GHOST"]'::jsonb
     OR r->'places_not_in_the_model' IS DISTINCT FROM '["NOPE-PLUG B01"]'::jsonb THEN
    RAISE EXCEPTION 'load: %', r;
  END IF;

  SELECT string_agg(splice_code || '=' || placement || '/' || coalesce(cavity, '-') || '/' || (part_id IS NOT NULL), ' ' ORDER BY splice_code COLLATE "C") INTO got
  FROM public.harness_splices WHERE NOT is_superseded;
  IF got IS DISTINCT FROM 'NOPE-PLUG B1 #1=at_pin/B1/false PDM30-A A2 #1=at_pin/A2/true PDM30-A A24 #1=at_pin/A24/true SPL-X=in_line/-/true' THEN
    RAISE EXCEPTION 'splices: %', got;
  END IF;
  SELECT string_agg(m.member_label || ':' || coalesce(m.side::text, '-'), ' ' ORDER BY m.ordinal) INTO got
  FROM public.harness_splice_members m JOIN public.harness_splices h ON h.id = m.splice_id WHERE h.splice_code = 'SPL-X';
  IF got IS DISTINCT FROM 'L0:1 L1:2 L2:2' THEN RAISE EXCEPTION 'SPL-X sides: %', got; END IF;

  -- The fold: 87, BB1 and D1 share only the splice and become one net; TP1 and TP2 stay one.
  SELECT string_agg(DISTINCT (c.circuit_code || '>' || n2.net_code) COLLATE "C", ' ' ORDER BY (c.circuit_code || '>' || n2.net_code) COLLATE "C") INTO got
  FROM public.harness_segments s JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
  JOIN public.harness_nets n2 ON n2.id = s.net_id
  WHERE NOT s.is_superseded AND c.circuit_code IN ('87', 'BB1', 'D1', 'TP1', 'TP2');
  IF got IS DISTINCT FROM '87>PDM30-A A24 #1 BB1>PDM30-A A24 #1 D1>PDM30-A A24 #1 TP1>PDM30-A A2 TP2>PDM30-A A2' THEN RAISE EXCEPTION 'nets: %', got; END IF;

  -- Pins: the spliced pin holds both its wires in the splice; f is two wires in one contact with no splice.
  SELECT string_agg(plug || ' ' || cavity || ' x' || wires || ' ' || coalesce(splices, '-') || ' ' || wires_in_a_splice, '; ' ORDER BY plug, cavity COLLATE "C") INTO got
  FROM public.v_harness_pin_occupancy WHERE (plug = 'PDM30-A' AND cavity IN ('A2', 'A24')) OR (plug = 'FIREWALL-CABIN' AND cavity = 'f');
  IF got IS DISTINCT FROM 'FIREWALL-CABIN f x2 - 0; PDM30-A A2 x2 PDM30-A A2 #1 2; PDM30-A A24 x1 PDM30-A A24 #1 1' THEN RAISE EXCEPTION 'occupancy: %', got; END IF;

  -- Fill: A2 fits (2 x 22 + a 20 AWG lead in a 20-16 splice); A24 is over on 87 and BB1 alone (18 + 18; D1's gauge unknown);
  -- SPL-X side 1 fits, side 2 waits on L1's gauge.
  SELECT string_agg(splice_code || '/' || side || '=' || status, ' ' ORDER BY splice_code COLLATE "C", side) INTO got FROM public.v_harness_splice_check;
  IF got IS DISTINCT FROM 'NOPE-PLUG B1 #1/0=part range unknown PDM30-A A2 #1/0=fits PDM30-A A24 #1/0=over the crimp range SPL-X/1=fits SPL-X/2=gauge unknown' THEN
    RAISE EXCEPTION 'fill: %', got;
  END IF;
  SELECT conductors_named || ' = ' || circular_mils INTO got FROM public.v_harness_splice_check WHERE splice_code = 'PDM30-A A2 #1';
  IF got IS DISTINCT FROM 'TP1 (22 AWG), TP2 (22 AWG), 20 AWG pin lead = 2306' THEN RAISE EXCEPTION 'A2 fill: %', got; END IF;

  SELECT string_agg(measure || '=' || numerator || '/' || denominator, '; ' ORDER BY measure COLLATE "C") INTO got FROM public.v_harness_coverage
  WHERE measure IN ('splice members keyed to a live wire', 'pin cavities shared by several wires with no splice the design names (must be 0)',
                    'spliced pins whose lead into the pin the design names', 'splice sides outside the part''s crimp range (must be 0)');
  IF got IS DISTINCT FROM 'pin cavities shared by several wires with no splice the design names (must be 0)=1/2; splice members keyed to a live wire=8/10; splice sides outside the part''s crimp range (must be 0)=1/3; spliced pins whose lead into the pin the design names=1/3' THEN
    RAISE EXCEPTION 'splice measures: %', got;
  END IF;
  SELECT count(*) INTO n FROM public.v_harness_coverage;
  IF n <> 35 THEN RAISE EXCEPTION 'scoreboard measures: %, want 35', n; END IF;
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a measure has no grain'; END IF;
  SELECT numerator INTO n FROM public.v_harness_coverage WHERE measure = 'nets that join a supply to ground (must be 0)';
  IF n <> 0 THEN RAISE EXCEPTION 'supply joined to ground: %', n; END IF;

  -- Idempotent.
  r := public.load_harness_splices('e08bf694-970f-4cbe-8a74-8715158a0f2e', rows_, 'fixture registry @ test');
  IF (r->>'splices_written')::int <> 0 OR (r->>'splices_kept')::int <> 4 OR (r->'nets'->>'nets_superseded')::int <> 0 THEN RAISE EXCEPTION 'not idempotent: %', r; END IF;

  -- The design takes D1 off A24's splice and drops the place the model lacks: one splice superseded, one retired, D1 splits off.
  SELECT id INTO old_id FROM public.harness_splices WHERE splice_code = 'PDM30-A A24 #1' AND NOT is_superseded;
  rows_ := jsonb_set(rows_ - 2, '{2,wires}', '["87", "BB1"]');
  r := public.load_harness_splices('e08bf694-970f-4cbe-8a74-8715158a0f2e', rows_, 'fixture registry @ test');
  IF (r->>'splices_written')::int <> 1 OR (r->>'splices_changed')::int <> 1 OR (r->>'splices_retired')::int <> 1 OR (r->>'splices_kept')::int <> 2 THEN
    RAISE EXCEPTION 'change: %', r;
  END IF;
  SELECT is_superseded::text || '/' || (superseded_by = (SELECT id FROM public.harness_splices WHERE splice_code = 'PDM30-A A24 #1' AND NOT is_superseded))::text INTO got
  FROM public.harness_splices WHERE id = old_id;
  IF got IS DISTINCT FROM 'true/true' THEN RAISE EXCEPTION 'old splice: %', got; END IF;
  IF EXISTS (SELECT 1 FROM public.harness_segments s JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
             JOIN public.harness_nets n2 ON n2.id = s.net_id WHERE NOT s.is_superseded AND c.circuit_code = 'D1' AND n2.net_code = 'PDM30-A A24 #1') THEN
    RAISE EXCEPTION 'D1 still in the splice''s net';
  END IF;

  -- A splice that joins the battery + cable to its return is refused, and nothing lands.
  BEGIN
    r := public.load_harness_splices('e08bf694-970f-4cbe-8a74-8715158a0f2e',
           rows_ || '[{"at": "SPL-SHORT", "wires": ["63", "ODY_NEG"], "splice": "D-609-05"}]'::jsonb, 'fixture registry @ test');
    RAISE EXCEPTION 'a supply-to-ground splice was accepted: %', r;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'the splices would join a supply to ground%' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.harness_splices WHERE splice_code = 'SPL-SHORT') THEN RAISE EXCEPTION 'the refused splice landed'; END IF;

  IF has_function_privilege('anon', 'public.load_harness_splices(uuid,jsonb,text)', 'EXECUTE') THEN RAISE EXCEPTION 'the public can write splices'; END IF;
  IF has_table_privilege('anon', 'public.harness_splices', 'INSERT') OR NOT has_table_privilege('anon', 'public.harness_splices', 'SELECT') THEN
    RAISE EXCEPTION 'splice grants';
  END IF;
  IF has_table_privilege('anon', 'public.v_harness_splice_check', 'INSERT') THEN RAISE EXCEPTION 'the fill view keeps a public write grant'; END IF;
  SELECT count(*) INTO n FROM public.stack_needs WHERE stack_id = 'SH';
  IF n <> 39 THEN RAISE EXCEPTION 'SH needs: %, want 39', n; END IF;
END $$;

SELECT 'test_k5_harness_splices: PASS' AS result;
