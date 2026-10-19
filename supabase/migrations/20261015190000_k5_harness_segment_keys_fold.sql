-- RSI pass 30 on the harness model: a segment's wire part and option links are keyed after every load. Case ledger
-- 13.12.3.
--
-- Two segment keys were written once, by migrations:
--   - wire_part_id: reshape v1 (20261014101500) keyed each segment to the catalog's exact M22759 part (spec, gauge and
--     MIL-STD-681 colour digits) from its wire.
--   - Option links: RSI pass 1 (20261014113000) gave each segment the option couplings of its wire-end plugs
--     (wiring_decision_links, relation coupled_with).
-- Segments made since come from conform_harness_segments (pass 25): a wire the loader adds gets a new segment with
-- neither key. Live as anon on 2026-10-15 18:08Z, after passes 26 and 29 added 27 wires:
--   - segments keyed to a wire part read 398 / 670, down from 400 when the two retired woofer jumpers took theirs;
--     29 live segments have a catalog part their wire names and no key, and 1 is keyed to a part its wire no longer
--     names;
--   - segments carrying an option link read 476 / 670; 55 live segments sit on coupled plugs with no link.
--
-- This pass: key_harness_segments(vehicle) applies both rules to every live segment of the vehicle. It keys a missing
-- or stale wire part where the catalog holds the wire's exact part, and leaves a key alone when the catalog has none. It
-- links a segment to every option its plugs are coupled with that it does not carry yet. The registry loader calls it
-- after the segments conform.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF to_regprocedure('public.conform_harness_segments(uuid)') IS NULL THEN
    RAISE EXCEPTION 'RSI pass 25 (20261015150000) has not run';
  END IF;
  IF to_regprocedure('public.key_harness_segments(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'key_harness_segments already exists';
  END IF;
END $guard$;

CREATE FUNCTION public.key_harness_segments(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE n_keyed int; n_rekeyed int; n_links int; n_linked_segments int;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS segkey_part (seg_id uuid PRIMARY KEY, old_part uuid, part_id uuid) ON COMMIT DROP;
  TRUNCATE segkey_part;

  -- The reshape's rule: the catalog's exact M22759/16 or /32 part for the wire's spec, gauge and colour digits.
  INSERT INTO segkey_part
  SELECT s.id, s.wire_part_id, p.id
  FROM public.harness_segments s
  JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
  CROSS JOIN LATERAL (
    SELECT cp.id FROM public.catalog_parts cp
    WHERE c.wire_type ~ '^M22759/(16|32)$'
      AND cp.part_number = c.wire_type || '-' || c.wire_gauge_awg || '-' || (
        SELECT string_agg(CASE x WHEN 'black' THEN '0' WHEN 'brown' THEN '1' WHEN 'red' THEN '2' WHEN 'orange' THEN '3'
                                   WHEN 'yellow' THEN '4' WHEN 'green' THEN '5' WHEN 'blue' THEN '6' WHEN 'violet' THEN '7'
                                   WHEN 'gray' THEN '8' WHEN 'white' THEN '9' END, '' ORDER BY ord)
        FROM unnest(string_to_array(lower(c.wire_color), '/')) WITH ORDINALITY AS u(x, ord))
    ORDER BY cp.id LIMIT 1) p
  WHERE s.vehicle_id = p_vehicle_id AND NOT s.is_superseded AND s.wire_part_id IS DISTINCT FROM p.id;

  SELECT count(*) FILTER (WHERE old_part IS NULL), count(*) FILTER (WHERE old_part IS NOT NULL) INTO n_keyed, n_rekeyed FROM segkey_part;
  UPDATE public.harness_segments s SET wire_part_id = k.part_id
  FROM segkey_part k
  WHERE s.id = k.seg_id;

  -- Pass 1's rule: a segment carries the option couplings of its wire-end plugs.
  WITH ins AS (
    INSERT INTO public.wiring_decision_links (decision_id, relation, segment_id, note, source, trust)
    SELECT DISTINCT l.decision_id, 'coupled_with', s.id,
           'derived from the coupling of the segment''s wire-end plugs (RSI pass 1 rule, re-run by key_harness_segments, pass 30)',
           'wiring_decision_links (endpoint couplings)', 'T3'
    FROM public.harness_segments s
    JOIN public.wire_termination_specs t ON t.id IN (s.from_termination_id, s.to_termination_id)
    JOIN public.wiring_decision_links l ON l.endpoint_id = t.endpoint_id AND l.relation = 'coupled_with'
    WHERE s.vehicle_id = p_vehicle_id AND NOT s.is_superseded
      AND NOT EXISTS (SELECT 1 FROM public.wiring_decision_links x
                      WHERE x.segment_id = s.id AND x.decision_id = l.decision_id AND x.relation = 'coupled_with')
    RETURNING segment_id)
  SELECT count(*), count(DISTINCT segment_id) INTO n_links, n_linked_segments FROM ins;

  RETURN jsonb_build_object('segments_keyed_to_a_part', n_keyed, 'segments_rekeyed', n_rekeyed,
                            'option_links_added', n_links, 'segments_given_links', n_linked_segments);
END $fn$;
COMMENT ON FUNCTION public.key_harness_segments(uuid) IS 'Keys every live segment of the vehicle: wire_part_id to the catalog''s exact M22759/16 or /32 part for its wire''s spec, gauge and colour (the reshape v1 rule; a key the catalog cannot back is left alone), and an option link (wiring_decision_links coupled_with) for every option its wire-end plugs are coupled with (the RSI pass 1 rule). Idempotent; the registry loader calls it after the segments conform. RSI pass 30, case ledger 13.12.3.';
REVOKE ALL ON FUNCTION public.key_harness_segments(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.key_harness_segments(uuid) TO service_role;

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, note) VALUES
  ('SH', 1, 'key', 'function', 'key_harness_segments', NULL, 'every segment the loader adds is keyed to its wire part and its plugs'' options');

DO $check$
DECLARE r jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a scoreboard measure has no grain'; END IF;
  r := public.key_harness_segments('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  RAISE NOTICE 'RSI pass 30 on the K5: %', r;
END $check$;

COMMIT;
