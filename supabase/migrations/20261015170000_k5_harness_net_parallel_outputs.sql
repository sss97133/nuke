-- RSI pass 27 on the harness model: a net fed by several paralleled PDM outputs is protected by all of them. Case
-- ledger 13.12.3.
--
-- MoTeC allows outputs of one type in parallel on a common channel or an identical condition (PDM user manual printed
-- p.6 and pp.22-23). The K5 parallels PDM30 OUT17 and OUT18 at the headlight dimmer's common: #85 (OUT17, pin A20) and
-- #86 (OUT18, pin A22) are each 20 AWG and meet at the dimmer, so a fault on either wire is fed by both outputs, up to
-- 4 + 4 = 8 A before both trip (registry pdm_settings; 20 AWG M22759/32 wire cap 8 A).
--
-- The model held one protecting output per net. fold_harness_net_protection took the highest-rated pin
-- (DISTINCT ON), so:
--   - #86, which the design feeds from OUT18, read "protected by OUT17". Live as anon on 2026-10-15 17:30Z, "PDM-fed
--     wires not protected by the output the design names (must be 0)" read 1 of 63, and that was the only row.
--   - The net's limit read 4 A, one output's setting. The fault current the wire must carry is the sum.
--
-- This pass:
--   1. harness_nets gains protection_pdm_channel_ids: every PDM output whose pin lands on the net, the highest-rated
--      first. protection_pdm_channel_id stays the first of them, so every reader of it is unchanged.
--   2. fold_harness_net_protection writes the set. A net's limit (protection_setting_a) is the sum of the set's
--      programmed limits when every output in the set is set, else unknown. Its load (nominal_current_a) is the sum of
--      the outputs' distinct cited loads when each output's every load sits in the net. An output pair that one
--      registry row names, such as the fan's "PDM15 OUT1 + OUT6", carries that row's one load on both channels and is
--      counted once.
--   3. v_harness_pdm_protection_check: protected_by lists the set, and a wire agrees when the output its design names
--      is in it.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF to_regprocedure('public.load_pdm_settings(uuid,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'RSI pass 15 (20261015043000) has not run';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'harness_nets'
             AND column_name = 'protection_pdm_channel_ids') THEN
    RAISE EXCEPTION 'harness_nets.protection_pdm_channel_ids already exists';
  END IF;
END $guard$;

-- 1. The set.
ALTER TABLE public.harness_nets ADD COLUMN protection_pdm_channel_ids uuid[];
COMMENT ON COLUMN public.harness_nets.protection_pdm_channel_ids IS 'Every PDM output whose pin lands on this net, the highest-rated first (protection_pdm_channel_id is the first). More than one is paralleled outputs (MoTeC PDM user manual p.6, pp.22-23): a fault anywhere on the net is fed by all of them, so protection_setting_a is the sum of their limits. Written by fold_harness_net_protection. RSI pass 27, case ledger 13.12.3.';

-- 2. The fold.
CREATE OR REPLACE FUNCTION public.fold_harness_net_protection(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE added int; repointed int; cleared int; from_pin int; from_design int; conflicts int; limited int; sets int; paralleled int;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS fold_protection_pins (net_id uuid, channel_id uuid, fuse numeric, channel_number int, basis text) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS fold_protection_target (net_id uuid PRIMARY KEY, channel_id uuid, channel_ids uuid[], basis text, by_pin boolean) ON COMMIT DROP;
  TRUNCATE fold_protection_pins, fold_protection_target;

  -- Every PDM output pin a live segment of the net lands on.
  INSERT INTO fold_protection_pins
  SELECT DISTINCT s.net_id, ch.id, ch.fuse_rating_amps, ch.channel_number, e.code || ' ' || t.cavity || ' = ' || p.pin_function
  FROM public.harness_segments s
  JOIN public.harness_nets n ON n.id = s.net_id AND NOT n.is_superseded
  JOIN public.wire_termination_specs t ON t.id IN (s.from_termination_id, s.to_termination_id) AND NOT coalesce(t.is_superseded, false)
  JOIN public.harness_endpoints e ON e.id = t.endpoint_id AND e.code ~ '^PDM(15|30)-[AB]$'
  JOIN public.device_pin_maps p ON p.device_model = split_part(e.code, '-', 1) AND p.firmware_version IS NULL
       AND regexp_replace(upper(p.pin_number), '^([A-Z]+)0*([0-9]+)$', '\1\2') = regexp_replace(upper(t.cavity), '^([A-Z]+)0*([0-9]+)$', '\1\2')
       AND coalesce(substring(p.pin_function FROM '^OUT([0-9]+)'), substring(p.pin_function FROM '^Output ([0-9]+)')) IS NOT NULL
  JOIN public.pdm_units u ON u.vehicle_id = s.vehicle_id AND u.model = 'MoTeC ' || p.device_model
  JOIN public.pdm_channels ch ON ch.pdm_unit_id = u.id
       AND ch.channel_number = coalesce(substring(p.pin_function FROM '^OUT([0-9]+)'), substring(p.pin_function FROM '^Output ([0-9]+)'))::int
  WHERE s.vehicle_id = p_vehicle_id AND n.vehicle_id = p_vehicle_id AND NOT s.is_superseded;

  WITH nets AS (SELECT id FROM public.harness_nets WHERE vehicle_id = p_vehicle_id AND NOT is_superseded),
  pin AS (
    SELECT q.net_id,
           (array_agg(q.channel_id ORDER BY q.fuse DESC NULLS LAST, q.channel_number))[1] AS channel_id,
           array_agg(q.channel_id ORDER BY q.fuse DESC NULLS LAST, q.channel_number) AS channel_ids,
           string_agg(q.basis, '; ' ORDER BY q.fuse DESC NULLS LAST, q.channel_number) AS basis
    FROM (SELECT DISTINCT ON (net_id, channel_id) * FROM fold_protection_pins ORDER BY net_id, channel_id, basis) q
    GROUP BY q.net_id),
  design AS (
    SELECT s.net_id, min(ch.id::text)::uuid AS channel_id, count(DISTINCT ch.id) AS n_outputs,
           string_agg(DISTINCT c.circuit_code || ' from ' || d.box || ':OUT' || d.n, ', ') AS basis
    FROM public.harness_segments s
    JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
    CROSS JOIN LATERAL (SELECT coalesce(substring(c.from_component FROM '(PDM15|PDM30):OUT[0-9]+'), substring(c.from_component FROM 'SPL-(PDM15|PDM30)-OUT[0-9]+')) AS box,
                               coalesce(substring(c.from_component FROM '(?:PDM15|PDM30):OUT([0-9]+)'), substring(c.from_component FROM 'SPL-(?:PDM15|PDM30)-OUT([0-9]+)'))::int AS n) d
    JOIN public.pdm_units u ON u.vehicle_id = s.vehicle_id AND u.model = 'MoTeC ' || d.box
    JOIN public.pdm_channels ch ON ch.pdm_unit_id = u.id AND ch.channel_number = d.n
    WHERE s.vehicle_id = p_vehicle_id AND NOT s.is_superseded AND s.net_id IN (SELECT id FROM nets) AND d.box IS NOT NULL
    GROUP BY s.net_id)
  INSERT INTO fold_protection_target (net_id, channel_id, channel_ids, basis, by_pin)
  SELECT n.id,
         coalesce(pin.channel_id, CASE WHEN design.n_outputs = 1 THEN design.channel_id END),
         coalesce(pin.channel_ids, CASE WHEN design.n_outputs = 1 THEN ARRAY[design.channel_id] END),
         CASE WHEN pin.channel_id IS NOT NULL AND cardinality(pin.channel_ids) > 1
                THEN 'paralleled PDM output pins (' || pin.basis || ')'
              WHEN pin.channel_id IS NOT NULL THEN 'the PDM output pin (' || pin.basis || ')'
              WHEN design.n_outputs = 1 THEN 'the output the design names (' || design.basis || '); no wire end lands on a PDM pin' END,
         pin.channel_id IS NOT NULL
  FROM nets n LEFT JOIN pin ON pin.net_id = n.id LEFT JOIN design ON design.net_id = n.id;

  SELECT count(*) FILTER (WHERE by_pin), count(*) FILTER (WHERE channel_id IS NOT NULL AND NOT by_pin),
         count(*) FILTER (WHERE cardinality(channel_ids) > 1)
    INTO from_pin, from_design, paralleled
  FROM fold_protection_target;

  UPDATE public.harness_nets n SET protection_pdm_channel_id = f.channel_id,
         method = n.method || '; protection (RSI pass 13 fold): ' || f.basis
  FROM fold_protection_target f
  WHERE n.id = f.net_id AND f.channel_id IS NOT NULL AND n.protection_pdm_channel_id IS NULL;
  GET DIAGNOSTICS added = ROW_COUNT;
  UPDATE public.harness_nets n SET protection_pdm_channel_id = f.channel_id,
         method = n.method || '; protection re-pointed (RSI pass 13 fold): ' || f.basis
  FROM fold_protection_target f
  WHERE n.id = f.net_id AND f.channel_id IS NOT NULL AND n.protection_pdm_channel_id IS DISTINCT FROM f.channel_id;
  GET DIAGNOSTICS repointed = ROW_COUNT;
  UPDATE public.harness_nets n SET protection_pdm_channel_id = NULL,
         method = n.method || '; protection cleared (RSI pass 13 fold): no wire end on a PDM output pin and no output named by its wires'
  FROM fold_protection_target f
  WHERE n.id = f.net_id AND f.channel_id IS NULL AND n.protection_pdm_channel_id IS NOT NULL;
  GET DIAGNOSTICS cleared = ROW_COUNT;
  -- RSI pass 27: the whole set of outputs on the net.
  UPDATE public.harness_nets n SET protection_pdm_channel_ids = f.channel_ids,
         method = n.method || CASE WHEN cardinality(f.channel_ids) > 1 THEN '; paralleled outputs (RSI pass 27): ' || f.basis ELSE '' END
  FROM fold_protection_target f
  WHERE n.id = f.net_id AND n.protection_pdm_channel_ids IS DISTINCT FROM f.channel_ids;
  GET DIAGNOSTICS sets = ROW_COUNT;

  -- Limit and load from the protecting outputs (RSI pass 15, summed over paralleled outputs since pass 27): the sum of
  -- the programmed limits when every output in the set is set; the sum of the outputs' distinct cited loads when each
  -- output's every load sits in this net (a load split over several nets is not divided).
  UPDATE public.harness_nets n
  SET protection_setting_a = x.setting,
      nominal_current_a = coalesce(x.load, CASE WHEN n.method LIKE '%limit and load (RSI pass 15)%' THEN NULL ELSE n.nominal_current_a END),
      method = n.method || '; limit and load (RSI pass 15): ' || x.basis
  FROM (
    SELECT n2.id,
           CASE WHEN bool_and(ch.setting_status = 'set') THEN sum(ch.max_current_setting_a) END AS setting,
           CASE WHEN bool_and(ch.load_a IS NOT NULL AND cardinality(ch.setting_loads) > 0
                              AND NOT EXISTS (SELECT 1 FROM unnest(ch.setting_loads) lw(code)
                                              WHERE NOT EXISTS (SELECT 1 FROM public.harness_segments s
                                                                JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
                                                                WHERE s.net_id = n2.id AND NOT s.is_superseded AND c.circuit_code = lw.code)))
                THEN (SELECT sum(dl.load_a) FROM (SELECT DISTINCT ch2.load_a, ch2.setting_loads FROM public.pdm_channels ch2
                                                   WHERE ch2.id = ANY (n2.protection_pdm_channel_ids)) dl) END AS load,
           string_agg(replace(u.model, 'MoTeC ', '') || ' OUT' || ch.channel_number || ' ' || coalesce(ch.setting_status, 'not in the design''s settings')
                        || coalesce(', limit ' || ch.max_current_setting_a || ' A', '') || coalesce(', load ' || ch.load_a || ' A', ''),
                      ' + ' ORDER BY array_position(n2.protection_pdm_channel_ids, ch.id))
             || CASE WHEN count(*) > 1 THEN ' (paralleled: the limits add)' ELSE '' END AS basis
    FROM public.harness_nets n2
    JOIN public.pdm_channels ch ON ch.id = ANY (coalesce(n2.protection_pdm_channel_ids, ARRAY[n2.protection_pdm_channel_id]))
    JOIN public.pdm_units u ON u.id = ch.pdm_unit_id
    WHERE n2.vehicle_id = p_vehicle_id AND NOT n2.is_superseded AND n2.protection_pdm_channel_id IS NOT NULL
    GROUP BY n2.id) x
  WHERE n.id = x.id
    AND (n.protection_setting_a IS DISTINCT FROM x.setting
         OR (x.load IS NOT NULL AND n.nominal_current_a IS DISTINCT FROM x.load)
         OR (x.load IS NULL AND n.method LIKE '%limit and load (RSI pass 15)%' AND n.nominal_current_a IS NOT NULL));
  GET DIAGNOSTICS limited = ROW_COUNT;

  SELECT count(*) INTO conflicts FROM public.v_harness_pdm_protection_check
  WHERE vehicle_id = p_vehicle_id AND NOT agrees;
  RETURN jsonb_build_object('nets_protected_from_a_pin', from_pin, 'nets_protected_from_the_design', from_design,
                            'nets_with_paralleled_outputs', paralleled, 'protection_added', added,
                            'protection_repointed', repointed, 'protection_cleared', cleared, 'output_sets_written', sets,
                            'nets_given_limit_or_load', limited, 'wires_disagreeing_with_the_design', conflicts);
END $fn$;
COMMENT ON FUNCTION public.fold_harness_net_protection(uuid) IS 'Per live net of the vehicle: the PDM outputs that protect it (every output whose pin a segment of the net lands on, else the one output its wires'' design names), their summed programmed limit and, when each output''s every load sits in the net, their summed distinct cited load. Paralleled outputs (MoTeC PDM manual p.6, pp.22-23) are a set since RSI pass 27. Idempotent; returns counts. Case ledger 13.12.3.';

-- 3. The check against the design.
CREATE OR REPLACE VIEW public.v_harness_pdm_protection_check AS
WITH w AS (
  SELECT o.vehicle_id, c.id AS wire_id, c.circuit_code,
         coalesce(substring(c.from_component FROM '(PDM15|PDM30):OUT[0-9]+'), substring(c.from_component FROM 'SPL-(PDM15|PDM30)-OUT[0-9]+'))
           || ' OUT' || coalesce(substring(c.from_component FROM '(?:PDM15|PDM30):OUT([0-9]+)'), substring(c.from_component FROM 'SPL-(?:PDM15|PDM30)-OUT([0-9]+)')) AS declared_output
  FROM public.vehicle_custom_circuits c
  JOIN public.vehicle_wiring_overlays o ON o.id = c.overlay_id
  JOIN public.vehicles v ON v.id = o.vehicle_id AND v.is_public IS TRUE
  WHERE NOT coalesce(c.is_superseded, false) AND c.design_status = 'decided'
    AND c.from_component ~ '(PDM15|PDM30):OUT[0-9]+|SPL-(PDM15|PDM30)-OUT[0-9]+')
SELECT w.vehicle_id, w.wire_id, w.circuit_code, w.declared_output, p.protected_by,
       coalesce(w.declared_output = ANY (p.outputs), false) AS agrees
FROM w
LEFT JOIN LATERAL (
  SELECT string_agg(DISTINCT replace(u.model, 'MoTeC ', '') || ' OUT' || ch.channel_number, ', ') AS protected_by,
         array_agg(DISTINCT replace(u.model, 'MoTeC ', '') || ' OUT' || ch.channel_number) AS outputs
  FROM public.harness_segments s
  JOIN public.harness_nets n ON n.id = s.net_id AND NOT n.is_superseded
  JOIN public.pdm_channels ch ON ch.id = ANY (coalesce(n.protection_pdm_channel_ids, ARRAY[n.protection_pdm_channel_id]))
  JOIN public.pdm_units u ON u.id = ch.pdm_unit_id
  WHERE s.vehicle_custom_circuit_id = w.wire_id AND NOT s.is_superseded) p ON true;
COMMENT ON VIEW public.v_harness_pdm_protection_check IS 'Per decided wire of a public vehicle whose design names a PDM output (vehicle_custom_circuits.from_component, written by the registry loader): the outputs its net is protected by after the fold (paralleled outputs listed together since RSI pass 27), and whether the output the design names is one of them. RSI pass 13, case ledger 13.12.3.';
REVOKE ALL ON public.v_harness_pdm_protection_check FROM anon, authenticated;
GRANT SELECT ON public.v_harness_pdm_protection_check TO anon, authenticated;

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, note) VALUES
  ('SH', 1, 'fold', 'column', 'harness_nets.protection_pdm_channel_ids', NULL, 'every PDM output paralleled onto a net, whose limits add');

DO $check$
DECLARE r jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a scoreboard measure has no grain'; END IF;
  r := public.fold_harness_net_protection('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  RAISE NOTICE 'RSI pass 27 on the K5: protection fold %', r;
END $check$;

COMMIT;
