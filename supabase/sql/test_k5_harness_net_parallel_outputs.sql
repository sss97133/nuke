-- Empty disposable PG17 only, from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_k5_parallel -f supabase/sql/test_k5_harness_net_parallel_outputs.sql
-- Proves 20261015170000_k5_harness_net_parallel_outputs.sql on top of RSI pass 25. Two wires from paralleled 8 A outputs
-- (PDM30 OUT17 on A20 and OUT18 on A22) meet at a dimmer's common, as #85/#86 do on the K5:
--   - the net is protected by both outputs (the set, OUT17 first);
--   - its limit is the sum of their programmed limits (4 + 4 = 8 A), and its load the sum of their cited loads;
--   - each wire agrees with the output its design names;
--   - an output in the set that is not set leaves the limit unknown;
--   - single-output nets keep their pass 15 limits and loads;
--   - the fold is idempotent.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_conform_segments.sql

-- The dimmer's two feeds, as the registry loader writes them.
INSERT INTO public.device_pin_maps (device_model, pin_number, pin_function) VALUES ('PDM30', 'A20', 'OUT17'), ('PDM30', 'A22', 'OUT18');
INSERT INTO public.pdm_channels (pdm_unit_id, channel_number, channel_group_name, fuse_rating_amps, notes,
                                 max_current_setting_a, load_a, setting_status, setting_basis, setting_loads)
SELECT u.id, x.n, 'OUT' || x.n, 8, 'fixture', 4, 2.95, 'set', 'fixture lamp, one lamp''s share', ARRAY[x.w]
FROM public.pdm_units u CROSS JOIN (VALUES (17, 'PA1'), (18, 'PA2')) x(n, w)
WHERE u.model = 'MoTeC PDM30' AND u.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';
INSERT INTO public.vehicle_custom_circuits (id, overlay_id, circuit_code, circuit_name, design_status, build_state, from_component,
                                            from_endpoint_id, to_endpoint_id, planned_length_ft) VALUES
  ('00000000-0000-0000-0000-00000000d0a1', '00000000-0000-0000-0000-0000000000f0', 'PA1', 'headlight left feed', 'decided', 'uncut',
   'PDM30:OUT17 (A20)', '00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000ea', 6.0),
  ('00000000-0000-0000-0000-00000000d0a2', '00000000-0000-0000-0000-0000000000f0', 'PA2', 'headlight right feed', 'decided', 'uncut',
   'PDM30:OUT18 (A22)', '00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000ea', 6.0);
INSERT INTO public.wire_termination_specs (id, vehicle_id, circuit_id, endpoint_id, cavity) VALUES
  ('00000000-0000-0000-0000-00000000d1a1', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000d0a1', '00000000-0000-0000-0000-0000000000e8', 'A20'),
  ('00000000-0000-0000-0000-00000000d1a2', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000d0a1', '00000000-0000-0000-0000-0000000000ea', 'common'),
  ('00000000-0000-0000-0000-00000000d1b1', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000d0a2', '00000000-0000-0000-0000-0000000000e8', 'A22'),
  ('00000000-0000-0000-0000-00000000d1b2', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000d0a2', '00000000-0000-0000-0000-0000000000ea', 'common');
INSERT INTO public.harness_nets (id, vehicle_id, net_code, source, method, observed_at, trust) VALUES
  ('00000000-0000-0000-0000-00000000d2a1', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', 'PAR', 'fixture', 'fixture', now(), 'fixture');
INSERT INTO public.harness_segments (id, vehicle_id, net_id, vehicle_custom_circuit_id, from_termination_id, to_termination_id, planned_length_ft, planned_length_method, design_status, source, method, observed_at, trust) VALUES
  ('00000000-0000-0000-0000-00000000d3a1', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000d2a1', '00000000-0000-0000-0000-00000000d0a1',
   '00000000-0000-0000-0000-00000000d1a1', '00000000-0000-0000-0000-00000000d1a2', 6.0, 'whole-wire zone estimate', 'decided', 'fixture', 'fixture', now(), 'fixture'),
  ('00000000-0000-0000-0000-00000000d3a2', 'e08bf694-970f-4cbe-8a74-8715158a0f2e', '00000000-0000-0000-0000-00000000d2a1', '00000000-0000-0000-0000-00000000d0a2',
   '00000000-0000-0000-0000-00000000d1b1', '00000000-0000-0000-0000-00000000d1b2', 6.0, 'whole-wire zone estimate', 'decided', 'fixture', 'fixture', now(), 'fixture');

-- Before the pass, the single-output nets' limits and loads, to hold them unchanged.
CREATE TEMP TABLE par_before_nets AS
SELECT net_code, protection_pdm_channel_id, protection_setting_a, nominal_current_a FROM public.harness_nets
WHERE NOT is_superseded AND net_code <> 'PAR';

\i supabase/migrations/20261015170000_k5_harness_net_parallel_outputs.sql

DO $$
DECLARE r jsonb; got text; n int;
BEGIN
  -- The migration's own run already folded; a second run changes nothing.
  r := public.fold_harness_net_protection('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  IF (r->>'output_sets_written')::int <> 0 OR (r->>'nets_given_limit_or_load')::int <> 0 OR (r->>'protection_repointed')::int <> 0 THEN
    RAISE EXCEPTION 'not idempotent: %', r;
  END IF;
  IF (r->>'nets_with_paralleled_outputs')::int <> 1 THEN RAISE EXCEPTION 'paralleled nets: %', r; END IF;

  -- The set, its first output, the summed limit and load.
  SELECT (SELECT string_agg('OUT' || ch.channel_number, '+' ORDER BY ord) FROM unnest(n.protection_pdm_channel_ids) WITH ORDINALITY a(id, ord)
          JOIN public.pdm_channels ch ON ch.id = a.id)
         || ' first=OUT' || (SELECT channel_number FROM public.pdm_channels WHERE id = n.protection_pdm_channel_id)
         || ' limit=' || coalesce(n.protection_setting_a::text, '-') || ' load=' || coalesce(n.nominal_current_a::text, '-')
    INTO got FROM public.harness_nets n WHERE n.net_code = 'PAR' AND NOT n.is_superseded;
  IF got IS DISTINCT FROM 'OUT17+OUT18 first=OUT17 limit=8 load=5.90' THEN RAISE EXCEPTION 'PAR: %', got; END IF;
  SELECT method INTO got FROM public.harness_nets WHERE net_code = 'PAR' AND NOT is_superseded;
  IF got NOT LIKE '%paralleled outputs (RSI pass 27): paralleled PDM output pins (PDM30-A A20 = OUT17; PDM30-A A22 = OUT18)%'
     OR got NOT LIKE '%PDM30 OUT17 set, limit 4 A, load 2.95 A + PDM30 OUT18 set, limit 4 A, load 2.95 A (paralleled: the limits add)' THEN
    RAISE EXCEPTION 'PAR basis: %', got;
  END IF;

  -- Each wire agrees with the output its design names.
  SELECT string_agg(circuit_code || ':' || declared_output || '@' || protected_by || '=' || agrees, ' ' ORDER BY circuit_code) INTO got
  FROM public.v_harness_pdm_protection_check WHERE circuit_code IN ('PA1', 'PA2');
  IF got IS DISTINCT FROM 'PA1:PDM30 OUT17@PDM30 OUT17, PDM30 OUT18=true PA2:PDM30 OUT18@PDM30 OUT17, PDM30 OUT18=true' THEN
    RAISE EXCEPTION 'check: %', got;
  END IF;

  -- Single-output nets: the set is their one output, and limits and loads are as pass 15 left them.
  SELECT count(*) INTO n FROM par_before_nets b JOIN public.harness_nets h ON h.net_code = b.net_code AND NOT h.is_superseded
  WHERE h.protection_pdm_channel_id IS DISTINCT FROM b.protection_pdm_channel_id
     OR h.protection_setting_a IS DISTINCT FROM b.protection_setting_a OR h.nominal_current_a IS DISTINCT FROM b.nominal_current_a
     OR (h.protection_pdm_channel_id IS NOT NULL AND h.protection_pdm_channel_ids IS DISTINCT FROM ARRAY[h.protection_pdm_channel_id])
     OR (h.protection_pdm_channel_id IS NULL AND h.protection_pdm_channel_ids IS NOT NULL);
  IF n <> 0 THEN RAISE EXCEPTION '% single-output nets changed', n; END IF;

  -- An output in the set that is not set leaves the sum unknown; setting it back restores it.
  UPDATE public.pdm_channels SET setting_status = 'open', max_current_setting_a = NULL WHERE channel_number = 18 AND notes = 'fixture';
  r := public.fold_harness_net_protection('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  SELECT coalesce(protection_setting_a::text, '-') INTO got FROM public.harness_nets WHERE net_code = 'PAR' AND NOT is_superseded;
  IF got <> '-' THEN RAISE EXCEPTION 'partial set limit: %', got; END IF;
  UPDATE public.pdm_channels SET setting_status = 'set', max_current_setting_a = 4 WHERE channel_number = 18 AND notes = 'fixture';
  r := public.fold_harness_net_protection('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  SELECT protection_setting_a::text INTO got FROM public.harness_nets WHERE net_code = 'PAR' AND NOT is_superseded;
  IF got <> '8' THEN RAISE EXCEPTION 'restored limit: %', got; END IF;

  -- Grants: the set is public like the net; the fold is not callable by visitors.
  IF NOT has_column_privilege('anon', 'public.harness_nets', 'protection_pdm_channel_ids', 'SELECT') THEN RAISE EXCEPTION 'anon cannot read the set'; END IF;
  IF has_function_privilege('anon', 'public.fold_harness_net_protection(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'anon can run the fold'; END IF;
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a measure has no grain'; END IF;
END $$;

SELECT 'test_k5_harness_net_parallel_outputs: PASS';
