-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_pdmset -f supabase/sql/test_k5_pdm_channel_settings_fold.sql
-- Proves 20261015043000_pdm_channel_settings_fold.sql on top of RSI pass 14: registry-shaped pdm_settings rows land on
-- the channels (set, open, conflict, a paired output), nets take the limit and, when the output's every load sits in
-- them, the load; a load split over nets is not divided; the scoreboard counts limits, loads, open and conflicting
-- outputs; the writer is idempotent and clears a channel the rows stop naming.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_net_refold_shared_pins.sql

-- PDM30 OUT21 exists on the truck; the fixture's pass 1 made channels only for the pins it saw.
INSERT INTO public.pdm_channels (pdm_unit_id, channel_number, channel_group_name, fuse_rating_amps, notes)
SELECT u.id, 21, 'OUT21', 8, 'fixture' FROM public.pdm_units u WHERE u.model = 'MoTeC PDM30';

\i supabase/migrations/20261015043000_pdm_channel_settings_fold.sql

DO $$
DECLARE r jsonb; got text; n int; rows_ jsonb;
BEGIN
  rows_ := '[
    {"output": "PDM30 OUT9", "loads": ["TP1"], "load_a": 2.8, "limit_a": 4, "status": "set", "source": "fixture lamp datasheet"},
    {"output": "PDM30 OUT2", "loads": ["TP2", "GONE"], "load_a": 11.0, "limit_a": 14, "status": "set", "source": "fixture motor"},
    {"output": "PDM30 OUT1", "loads": ["TG_X"], "load_a": null, "limit_a": null, "status": "OPEN: needs the horn current", "source": "needs the horn current"},
    {"output": "PDM30 OUT21", "loads": ["LOCKS"], "load_a": 9.0, "limit_a": null, "status": "CONFLICT: needs 12 A; an 8 A output''s setting cap is 10 A", "source": "fixture actuators"},
    {"output": "PDM15 OUT1 + OUT6", "loads": ["FAN"], "load_a": 25.0, "limit_a": 16, "status": "set: 16 A per output (fan junction)", "source": "fixture fan"},
    {"output": "PDM99 OUT1", "loads": [], "load_a": null, "limit_a": null, "status": "set", "source": "no such unit"}
  ]';
  r := public.load_pdm_settings('e08bf694-970f-4cbe-8a74-8715158a0f2e', rows_, 'fixture registry @ test');
  IF (r->>'channels_written')::int <> 6 OR (r->>'rows_unmatched')::int <> 1 THEN RAISE EXCEPTION 'load: %', r; END IF;

  SELECT string_agg(replace(u.model, 'MoTeC ', '') || ' OUT' || ch.channel_number || '=' || ch.setting_status || '/' || coalesce(ch.max_current_setting_a::text, '-') || '/' || coalesce(ch.load_a::text, '-'),
                    ' ' ORDER BY u.model, ch.channel_number) INTO got
  FROM public.pdm_channels ch JOIN public.pdm_units u ON u.id = ch.pdm_unit_id WHERE ch.setting_status IS NOT NULL;
  IF got IS DISTINCT FROM 'PDM15 OUT1=set/16/25.0 PDM15 OUT6=set/16/25.0 PDM30 OUT1=open/-/- PDM30 OUT2=set/14/11.0 PDM30 OUT9=set/4/2.8 PDM30 OUT21=conflict/-/9.0' THEN
    RAISE EXCEPTION 'channels: %', got;
  END IF;
  SELECT setting_basis INTO got FROM public.pdm_channels ch JOIN public.pdm_units u ON u.id = ch.pdm_unit_id WHERE u.model = 'MoTeC PDM30' AND ch.channel_number = 1;
  IF got IS DISTINCT FROM 'needs the horn current | OPEN: needs the horn current' THEN RAISE EXCEPTION 'open basis: %', got; END IF;

  -- Nets: TP1 carries OUT9's limit and its whole load; TP2 carries OUT2's limit, but OUT2 also feeds a wire not in TP2's net.
  SELECT string_agg(net_code || '=' || coalesce(protection_setting_a::text, '-') || '/' || coalesce(nominal_current_a::text, '-'), ' ' ORDER BY net_code) INTO got
  FROM public.harness_nets WHERE net_code IN ('TP1', 'TP2') AND NOT is_superseded;
  IF got IS DISTINCT FROM 'TP1=4/2.8 TP2=14/-' THEN RAISE EXCEPTION 'nets: %', got; END IF;
  SELECT method INTO got FROM public.harness_nets WHERE net_code = 'TP1' AND NOT is_superseded;
  IF got NOT LIKE '%limit and load (RSI pass 15): PDM30 OUT9 set, limit 4 A, load 2.8 A' THEN RAISE EXCEPTION 'TP1 basis: %', got; END IF;

  SELECT string_agg(measure || '=' || numerator || '/' || denominator, '; ' ORDER BY measure) INTO got FROM public.v_harness_coverage
  WHERE measure IN ('PDM outputs still waiting on a cited load current', 'PDM outputs whose load needs more than the output or its wire allows (must be 0)');
  IF got IS DISTINCT FROM 'PDM outputs still waiting on a cited load current=1/6; PDM outputs whose load needs more than the output or its wire allows (must be 0)=1/6' THEN
    RAISE EXCEPTION 'output measures: %', got;
  END IF;
  SELECT numerator INTO n FROM public.v_harness_coverage WHERE measure = 'PDM-fed nets with a programmed limit';
  IF n < 2 THEN RAISE EXCEPTION 'PDM-fed nets with a limit: %', n; END IF;
  SELECT numerator INTO n FROM public.v_harness_coverage WHERE measure = 'PDM-fed nets with a load';
  IF n < 1 THEN RAISE EXCEPTION 'PDM-fed nets with a load: %', n; END IF;
  SELECT count(*) INTO n FROM public.v_harness_coverage;
  IF n <> 31 THEN RAISE EXCEPTION 'scoreboard measures: %, want 31', n; END IF;
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a measure has no grain'; END IF;

  -- Idempotent; then the design drops OUT1 and the channel clears.
  r := public.load_pdm_settings('e08bf694-970f-4cbe-8a74-8715158a0f2e', rows_, 'fixture registry @ test');
  IF (r->>'channels_written')::int <> 0 OR (r->'protection'->>'nets_given_limit_or_load')::int <> 0 THEN RAISE EXCEPTION 'not idempotent: %', r; END IF;
  r := public.load_pdm_settings('e08bf694-970f-4cbe-8a74-8715158a0f2e', rows_ - 2, 'fixture registry @ test');
  IF (r->>'channels_cleared')::int <> 1 THEN RAISE EXCEPTION 'clear: %', r; END IF;
  -- The design raises TP1's lamp load: the net follows.
  r := public.load_pdm_settings('e08bf694-970f-4cbe-8a74-8715158a0f2e',
         jsonb_set(rows_ - 2, '{0,load_a}', '3.1'), 'fixture registry @ test');
  SELECT nominal_current_a::text INTO got FROM public.harness_nets WHERE net_code = 'TP1' AND NOT is_superseded;
  IF got IS DISTINCT FROM '3.1' THEN RAISE EXCEPTION 'TP1 load after the change: %', got; END IF;

  IF has_function_privilege('anon', 'public.load_pdm_settings(uuid,jsonb,text)', 'EXECUTE') THEN RAISE EXCEPTION 'the public can write settings'; END IF;
  SELECT count(*) INTO n FROM public.stack_needs WHERE stack_id = 'SH';
  IF n <> 35 THEN RAISE EXCEPTION 'SH needs: %, want 35', n; END IF;
END $$;

SELECT 'test_k5_pdm_channel_settings_fold: PASS' AS result;
