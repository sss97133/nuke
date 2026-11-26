-- Preserve exact/16 aught size tokens; no design/source rows are changed.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';

-- Do not replace an independently changed producer definition on deployment.
-- A fresh disposable fixture may not have this earlier loader installed.
DO $guard$
BEGIN
 IF to_regprocedure('public.key_harness_segments(uuid)') IS NOT NULL AND
  (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.key_harness_segments(uuid)'))<>'c197b70be4073cf1ce1493162686a823'
 THEN RAISE EXCEPTION 'Existing segment-key producer drifted; review its current definition'; END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.key_harness_segments(p_vehicle_id uuid) RETURNS jsonb
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
  JOIN public.vehicle_wiring_overlays o ON o.id=c.overlay_id AND o.vehicle_id=s.vehicle_id
  CROSS JOIN LATERAL (
    SELECT cp.id FROM public.catalog_parts cp
    WHERE c.wire_type ~ '^M22759/(16|32)$'
      AND cp.part_number = c.wire_type || '-' || (CASE WHEN c.wire_gauge_awg>0 THEN c.wire_gauge_awg::text
        WHEN c.wire_type='M22759/16' AND c.wire_gauge_awg=0 THEN '01'
        WHEN c.wire_type='M22759/16' AND c.wire_gauge_awg=-1 THEN '02' END) || '-' || (
        SELECT CASE WHEN count(*)=count(digit) THEN string_agg(digit, '' ORDER BY ord) END
        FROM unnest(string_to_array(lower(c.wire_color), '/')) WITH ORDINALITY AS u(x, ord)
        CROSS JOIN LATERAL(SELECT CASE btrim(x) WHEN 'black' THEN '0' WHEN 'brown' THEN '1' WHEN 'red' THEN '2' WHEN 'orange' THEN '3'
                                   WHEN 'yellow' THEN '4' WHEN 'green' THEN '5' WHEN 'blue' THEN '6' WHEN 'violet' THEN '7'
                                   WHEN 'gray' THEN '8' WHEN 'white' THEN '9' END AS digit) colours)
    ORDER BY cp.id LIMIT 1) p
  WHERE s.vehicle_id = p_vehicle_id AND NOT s.is_superseded AND s.wire_part_id IS DISTINCT FROM p.id
    -- Key a design plan, never reinterpret material already cut, measured or
    -- progressed on its circuit, including newly recognized colours/sizes.
    AND NOT coalesce(c.is_superseded,false)
    AND s.build_state='uncut' AND s.measured_length_ft IS NULL AND s.measured_at IS NULL
      AND c.build_state='uncut' AND to_jsonb(c)->>'measured_length_ft' IS NULL
      AND NOT EXISTS(SELECT FROM public.harness_build_events b
       WHERE b.vehicle_id=p_vehicle_id AND b.circuit_id=c.id AND b.to_state<>'uncut');

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
COMMENT ON FUNCTION public.key_harness_segments(uuid) IS 'Keys uncut/unmeasured live design pieces to exact existing M22759 stock from a current circuit of the same vehicle; every colour token must resolve, preserving base/stripe order. AWG index0 maps to /16 size01 and-1 to02; other nonpositive family/size combinations remain unsupported. Recorded piece/circuit cuts, measurements and build progress retain their material identity. Missing catalog stock remains unresolved. Existing option coupling propagation is preserved. Invoker/service-only; no gauge selection, physical fit or purchasing release.';
REVOKE ALL ON FUNCTION public.key_harness_segments(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.key_harness_segments(uuid) TO service_role;

DO $patch$
DECLARE b text:=pg_get_functiondef('public.harness_schematic_model(uuid)'::regprocedure);
 a text:=$a$c.wire_type ~ '^M22759/(16|32)$' AND c.wire_gauge_awg > 0
    AND cc.digits IS NOT NULL THEN c.wire_type || '-' || c.wire_gauge_awg || '-' || cc.digits$a$;
 z text:=$z$c.wire_type ~ '^M22759/(16|32)$'
    AND (c.wire_gauge_awg>0 OR(c.wire_type='M22759/16' AND c.wire_gauge_awg IN(0,-1)))
    AND cc.digits IS NOT NULL THEN c.wire_type || '-' ||
      CASE WHEN c.wire_gauge_awg>0 THEN c.wire_gauge_awg::text
       WHEN c.wire_gauge_awg=0 THEN '01' WHEN c.wire_gauge_awg=-1 THEN '02' END || '-' || cc.digits$z$;
BEGIN
 IF (length(b)-length(replace(b,a,'')))/length(a)<>1 THEN RAISE EXCEPTION 'Aught expected-part anchor drift'; END IF;
 EXECUTE replace(b,a,z);
END $patch$;
COMMIT;
