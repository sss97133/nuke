-- A material correction is a segment revision, not an edit to a cut piece.
-- Live owners compared 2026-11-25. Receipt: 2026-11-25_segment-material-revisions.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

ALTER TABLE public.vehicle_custom_circuits
  ADD COLUMN checks_invalidated_at timestamptz,
  ADD COLUMN checks_invalidation_reason text,
  ADD COLUMN checks_input_hash text;
COMMENT ON COLUMN public.vehicle_custom_circuits.checks_invalidated_at IS 'When a material/topology input last invalidated stored checks. Does not replace the original checked_at or erase the recorded result.';
COMMENT ON COLUMN public.vehicle_custom_circuits.checks_invalidation_reason IS 'Input change that invalidated applicability of the stored check result; projection metadata, not a test witness.';
COMMENT ON COLUMN public.vehicle_custom_circuits.checks_input_hash IS 'Canonical input hash bound by a validated check-result writer. NULL means unbound legacy checks; material/topology edits clear it. No existing result is assigned a fresh hash by this migration.';
GRANT SELECT (checks_invalidated_at, checks_invalidation_reason, checks_input_hash) ON public.vehicle_custom_circuits TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.harness_segment_spec_status(p_vehicle_id uuid)
RETURNS TABLE(segment_id uuid, vehicle_id uuid, circuit_id uuid, current_circuit_id uuid,
  expected_gauge_awg integer, expected_colour text, expected_part_number text, catalog_matches bigint,
  expected_part_id uuid, target_from_termination_id uuid, target_to_termination_id uuid,
  physical_progress boolean, needs_revision boolean, blockers text[])
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $fn$
WITH RECURSIVE
visible AS (
  SELECT v.id FROM public.vehicles v WHERE v.id = p_vehicle_id AND v.deleted_at IS NULL
    AND (v.is_public IS TRUE OR (auth.uid() IS NOT NULL AND coalesce(auth.jwt()->>'is_anonymous', 'false') <> 'true'
        AND (v.user_id = auth.uid() OR v.owner_id = auth.uid())) OR current_user IN ('postgres', 'service_role'))
),
current_ends AS MATERIALIZED (
  SELECT t.id, t.vehicle_id, t.circuit_id, t.cavity, e.code, e.design_id
  FROM public.wire_termination_specs t JOIN visible v ON v.id = t.vehicle_id
  JOIN public.harness_endpoints e ON e.id = t.endpoint_id AND NOT coalesce(e.is_superseded, false)
  JOIN public.harness_designs d ON d.id = e.design_id AND d.vehicle_id = t.vehicle_id
  WHERE NOT coalesce(t.is_superseded, false)
),
catalog AS MATERIALIZED (
  SELECT cp.part_number, count(*) AS n, min(cp.id::text)::uuid AS part_id
  FROM public.catalog_parts cp WHERE cp.part_number ~ '^M22759/(16|32)-' GROUP BY cp.part_number
),
seg AS (
  SELECT s.* FROM public.harness_segments s JOIN visible v ON v.id = s.vehicle_id WHERE NOT s.is_superseded
),
chain AS (
  SELECT s.id AS segment_id, c.id, c.overlay_id, c.circuit_code, c.superseded_by,
    coalesce(c.is_superseded, false) AS is_superseded, ARRAY[c.id] AS visited
  FROM seg s JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
  JOIN public.vehicle_wiring_overlays o ON o.id = c.overlay_id AND o.vehicle_id = s.vehicle_id
  UNION ALL
  SELECT x.segment_id, c.id, c.overlay_id, c.circuit_code, c.superseded_by,
    coalesce(c.is_superseded, false), x.visited || c.id
  FROM chain x JOIN public.vehicle_custom_circuits c ON c.id = x.superseded_by
    AND c.overlay_id = x.overlay_id AND c.circuit_code = x.circuit_code
  WHERE x.is_superseded AND NOT c.id = ANY(x.visited) AND cardinality(x.visited) < 64
),
target AS (
  SELECT s.*, c.id AS current_id, c.design_status AS source_design_status, c.wire_gauge_awg AS expected_gauge, lower(btrim(c.wire_color)) AS expected_color,
    CASE WHEN c.wire_type ~ '^M22759/(16|32)$' AND c.wire_gauge_awg IS NOT NULL
      THEN c.wire_type || '-' || c.wire_gauge_awg || '-' || colours.digits END AS expected_pn,
    (s.build_state <> 'uncut' OR s.measured_length_ft IS NOT NULL OR s.measured_at IS NOT NULL
      OR coalesce(old_c.build_state, 'uncut') <> 'uncut' OR old_c.measured_length_ft IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.harness_build_events b
        WHERE b.vehicle_id = s.vehicle_id AND b.circuit_id = s.vehicle_custom_circuit_id AND b.to_state <> 'uncut')) AS progressed,
    n.vehicle_id = s.vehicle_id AND NOT n.is_superseded AS valid_net
  FROM seg s
  LEFT JOIN chain x ON x.segment_id = s.id AND NOT x.is_superseded
  LEFT JOIN public.vehicle_custom_circuits c ON c.id = x.id
  LEFT JOIN public.vehicle_custom_circuits old_c ON old_c.id = s.vehicle_custom_circuit_id
    AND EXISTS (SELECT 1 FROM public.vehicle_wiring_overlays old_o WHERE old_o.id = old_c.overlay_id AND old_o.vehicle_id = s.vehicle_id)
  LEFT JOIN public.harness_nets n ON n.id = s.net_id
  LEFT JOIN LATERAL (
    SELECT CASE WHEN bool_and(code IS NOT NULL) THEN string_agg(code, '' ORDER BY ord) END AS digits
    FROM (SELECT ord, CASE lower(btrim(token))
      WHEN 'black' THEN '0' WHEN 'brown' THEN '1' WHEN 'red' THEN '2' WHEN 'orange' THEN '3'
      WHEN 'yellow' THEN '4' WHEN 'green' THEN '5' WHEN 'blue' THEN '6' WHEN 'violet' THEN '7'
      WHEN 'gray' THEN '8' WHEN 'white' THEN '9' END AS code
      FROM unnest(string_to_array(c.wire_color, '/')) WITH ORDINALITY u(token, ord)) codes
  ) colours ON true
),
resolved AS (
  SELECT t.*, coalesce(parts.n, 0) AS match_count, CASE WHEN parts.n = 1 THEN parts.part_id END AS material_id,
    ends.from_id, ends.to_id
  FROM target t
  LEFT JOIN catalog parts ON parts.part_number = t.expected_pn
  LEFT JOIN LATERAL (
    SELECT max(new_id::text) FILTER (WHERE side = 'from')::uuid AS from_id,
           max(new_id::text) FILTER (WHERE side = 'to')::uuid AS to_id
    FROM (
      SELECT e.side, CASE WHEN count(nt.id) = 1 THEN min(nt.id::text)::uuid END AS new_id
      FROM (VALUES ('from', t.from_termination_id), ('to', t.to_termination_id)) e(side, old_id)
      JOIN public.wire_termination_specs ot ON ot.id = e.old_id AND ot.vehicle_id = t.vehicle_id
      JOIN public.harness_endpoints oe ON oe.id = ot.endpoint_id
      JOIN public.harness_designs od ON od.id = oe.design_id AND od.vehicle_id = t.vehicle_id
      LEFT JOIN current_ends nt ON nt.vehicle_id = t.vehicle_id AND nt.circuit_id = t.current_id
        AND nt.cavity IS NOT DISTINCT FROM ot.cavity AND nt.code = oe.code AND nt.design_id = oe.design_id
      GROUP BY e.side
    ) paired
  ) ends ON true
),
qualified AS (
  SELECT r.*, (r.current_id IS NOT NULL AND (
    r.vehicle_custom_circuit_id IS DISTINCT FROM r.current_id OR r.gauge_awg IS DISTINCT FROM r.expected_gauge
    OR lower(btrim(r.colour)) IS DISTINCT FROM r.expected_color OR r.wire_part_id IS DISTINCT FROM r.material_id
    OR (r.from_id IS NOT NULL AND r.from_termination_id IS DISTINCT FROM r.from_id)
    OR (r.to_id IS NOT NULL AND r.to_termination_id IS DISTINCT FROM r.to_id))) AS revision
  FROM resolved r
)
SELECT q.id, q.vehicle_id, q.vehicle_custom_circuit_id, q.current_id, q.expected_gauge, q.expected_color,
  q.expected_pn, q.match_count, q.material_id, q.from_id, q.to_id, q.progressed, q.revision,
  array_remove(ARRAY[
    CASE WHEN q.current_id IS NULL THEN 'source_revision_unresolved' END,
    CASE WHEN q.current_id IS NOT NULL AND q.source_design_status IS DISTINCT FROM 'decided' THEN 'source_design_not_decided' END,
    CASE WHEN q.current_id IS DISTINCT FROM q.vehicle_custom_circuit_id THEN 'source_revision_changed' END,
    CASE WHEN q.valid_net IS NOT TRUE THEN 'net_vehicle_or_revision_mismatch' END,
    CASE WHEN q.expected_pn IS NULL THEN 'material_mapping_unknown' END,
    CASE WHEN q.expected_pn IS NOT NULL AND q.match_count = 0 THEN 'catalog_part_missing' END,
    CASE WHEN q.match_count > 1 THEN 'catalog_part_ambiguous' END,
    CASE WHEN q.from_id IS NULL OR q.to_id IS NULL OR q.from_id = q.to_id THEN 'current_termination_pair_unresolved' END,
    CASE WHEN q.revision THEN 'segment_revision_required' END,
    CASE WHEN q.progressed AND (q.revision OR q.current_id IS NULL OR q.from_id IS NULL OR q.to_id IS NULL)
      THEN 'physical_revision_hold' END
  ], NULL)::text[]
FROM qualified q;
$fn$;
COMMENT ON FUNCTION public.harness_segment_spec_status(uuid) IS 'Read-only material/current-source qualification for one visible vehicle. One row per retained live physical segment; exact catalog ambiguity and incomplete successor ends remain blockers. Physical progress includes segment measurements and circuit build history. No source evidence or financial data is returned. SECURITY INVOKER preserves underlying RLS.';
REVOKE ALL ON FUNCTION public.harness_segment_spec_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.harness_segment_spec_status(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.key_harness_segments(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $fn$
DECLARE r record; old_segment public.harness_segments%ROWTYPE; c public.vehicle_custom_circuits%ROWTYPE;
  new_id uuid; replaced integer := 0; keyed integer := 0; rekeyed integer := 0; links integer := 0;
  held jsonb; same_ends boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('harness-material:' || p_vehicle_id::text, 0));
  PERFORM 1 FROM public.harness_segments s WHERE s.vehicle_id = p_vehicle_id AND NOT s.is_superseded ORDER BY s.id FOR UPDATE;
  FOR r IN SELECT * FROM public.harness_segment_spec_status(p_vehicle_id)
    WHERE needs_revision AND NOT physical_progress
      AND current_circuit_id IS NOT NULL AND target_from_termination_id IS NOT NULL AND target_to_termination_id IS NOT NULL
      AND target_from_termination_id <> target_to_termination_id
      AND NOT 'net_vehicle_or_revision_mismatch' = ANY(blockers)
      AND NOT 'source_design_not_decided' = ANY(blockers)
    ORDER BY segment_id
  LOOP
    SELECT * INTO old_segment FROM public.harness_segments WHERE id = r.segment_id AND NOT is_superseded FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT * INTO c FROM public.vehicle_custom_circuits WHERE id = r.current_circuit_id;
    same_ends := old_segment.from_termination_id = r.target_from_termination_id
      AND old_segment.to_termination_id = r.target_to_termination_id;
    -- Another valid current projection may already occupy the target pair. Do not merge identities silently.
    IF EXISTS (SELECT 1 FROM public.harness_segments s WHERE NOT s.is_superseded AND s.id <> old_segment.id
      AND s.net_id = old_segment.net_id AND s.from_termination_id = r.target_from_termination_id
      AND s.to_termination_id = r.target_to_termination_id) THEN CONTINUE; END IF;
    new_id := gen_random_uuid();
    UPDATE public.harness_segments SET is_superseded = true WHERE id = old_segment.id;
    INSERT INTO public.harness_segments (id, vehicle_id, net_id, vehicle_custom_circuit_id,
      from_termination_id, to_termination_id, wire_part_id, gauge_awg, colour,
      planned_length_ft, planned_length_method, measured_length_ft, measured_at, build_state,
      design_status, design_note, source, method, observed_at, trust)
    VALUES (new_id, old_segment.vehicle_id, old_segment.net_id, r.current_circuit_id,
      r.target_from_termination_id, r.target_to_termination_id, r.expected_part_id, r.expected_gauge_awg, r.expected_colour,
      CASE WHEN same_ends THEN old_segment.planned_length_ft END,
      CASE WHEN same_ends THEN old_segment.planned_length_method END, NULL, NULL, 'uncut',
      old_segment.design_status, old_segment.design_note,
      coalesce(c.source, old_segment.source),
      'material projection revision of ' || old_segment.id || ' from circuit ' || c.id
        || '; exact catalog matches=' || r.catalog_matches || '; no physical completion or material evidence inherited',
      coalesce(c.observed_at, c.created_at),
      CASE WHEN c.trust NOT IN ('T1','T2','T3') THEN c.trust
        WHEN old_segment.trust NOT IN ('T1','T2','T3') THEN old_segment.trust ELSE 'T3' END);
    UPDATE public.harness_segments SET superseded_by = new_id WHERE id = old_segment.id;
    -- A route describes the unchanged end pair, not material suitability. Keep the original witness clocks.
    IF same_ends THEN
      INSERT INTO public.harness_routings (segment_id, landmark_id, seq, source, observed_at, trust)
      SELECT new_id, h.landmark_id, h.seq, h.source, h.observed_at, h.trust
      FROM public.harness_routings h JOIN public.vehicle_harness_landmarks l ON l.id = h.landmark_id
      WHERE h.segment_id = old_segment.id AND NOT h.is_superseded AND l.vehicle_id = p_vehicle_id AND NOT coalesce(l.is_superseded, false);
      INSERT INTO public.wiring_decision_links (decision_id, relation, segment_id, note, source, trust)
      SELECT l.decision_id, l.relation, new_id, l.note, l.source, l.trust FROM public.wiring_decision_links l
      JOIN public.wiring_decisions d ON d.id = l.decision_id AND d.vehicle_id = p_vehicle_id AND NOT coalesce(d.is_superseded, false)
      WHERE l.segment_id = old_segment.id AND l.relation = 'coupled_with';
    END IF;
    -- No harness_evidence copy: changed material does not inherit a cut, test, or material witness.
    UPDATE public.vehicle_custom_circuits SET checks_input_hash = NULL, checks_invalidated_at = statement_timestamp(),
      checks_invalidation_reason = 'segment material/source/end revision changed'
    WHERE id = r.current_circuit_id;
    replaced := replaced + 1;
    IF old_segment.wire_part_id IS NULL AND r.expected_part_id IS NOT NULL THEN keyed := keyed + 1; END IF;
    IF old_segment.wire_part_id IS NOT NULL AND old_segment.wire_part_id IS DISTINCT FROM r.expected_part_id THEN rekeyed := rekeyed + 1; END IF;
  END LOOP;
  INSERT INTO public.wiring_decision_links (decision_id, relation, segment_id, note, source, trust)
  SELECT DISTINCT l.decision_id, 'coupled_with', s.id,
    'derived from current endpoint option membership (key_harness_segments)', l.source, 'T3'
  FROM public.harness_segments s
  JOIN public.wire_termination_specs t ON t.id IN (s.from_termination_id, s.to_termination_id)
    AND t.vehicle_id = s.vehicle_id AND NOT coalesce(t.is_superseded, false)
  JOIN public.wiring_decision_links l ON l.endpoint_id = t.endpoint_id AND l.relation = 'coupled_with'
  JOIN public.wiring_decisions d ON d.id = l.decision_id AND d.vehicle_id = s.vehicle_id AND NOT coalesce(d.is_superseded, false)
  WHERE s.vehicle_id = p_vehicle_id AND NOT s.is_superseded
    AND NOT EXISTS (SELECT 1 FROM public.wiring_decision_links x WHERE x.segment_id = s.id
      AND x.decision_id = l.decision_id AND x.relation = 'coupled_with');
  GET DIAGNOSTICS links = ROW_COUNT;
  SELECT coalesce(jsonb_agg(jsonb_build_object('segment_id', segment_id, 'current_circuit_id', current_circuit_id, 'blockers', blockers)), '[]'::jsonb)
    INTO held FROM public.harness_segment_spec_status(p_vehicle_id) WHERE 'physical_revision_hold' = ANY(blockers);
  RETURN jsonb_build_object('segments_superseded', replaced, 'segments_keyed_to_a_part', keyed,
    'segments_rekeyed', rekeyed, 'option_links_added', links, 'physical_holds', held);
END $fn$;

COMMENT ON FUNCTION public.key_harness_segments(uuid) IS 'Atomically supersedes unbuilt segment projections when their material or source/end revision changes; exact catalog missing/ambiguity clears stale keys. Complete same-vehicle current ends required. Retains physical progress as queryable holds, never copies measurements/build completion/material witnesses. Reuses unchanged routing and option membership; invalidates circuit checks. Serialized per vehicle and idempotent.';
REVOKE ALL ON FUNCTION public.key_harness_segments(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.key_harness_segments(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.resync_harness_segments(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $fn$
DECLARE result jsonb;
BEGIN
  result := public.key_harness_segments(p_vehicle_id);
  -- A missing successor may be a partially admitted loader batch. Retain it with
  -- source_revision_unresolved, rather than treating absence as retirement.
  RETURN result || jsonb_build_object('segments_moved_to_successor', 0, 'segments_retired', 0,
    'ends_moved', 0, 'segments_replanned', 0,
    'segments_still_on_superseded_rows', (SELECT count(*) FROM public.harness_segment_spec_status(p_vehicle_id)
      WHERE current_circuit_id IS DISTINCT FROM circuit_id));
END $fn$;
COMMENT ON FUNCTION public.resync_harness_segments(uuid) IS 'Delegates segment source/material/end revision to key_harness_segments. Never mutates or retires a physical piece during loader supersession; missing successor remains a queryable unresolved hold. Conform owns new topology after complete admission.';
REVOKE ALL ON FUNCTION public.resync_harness_segments(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resync_harness_segments(uuid) TO service_role;

-- Extend the deployed topology owner; preserve the original segmentation rule.
CREATE OR REPLACE FUNCTION public.conform_harness_segments(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE replacement record; successor_id uuid; material_result jsonb; n_todo int; n_nets int; n_updated int; n_inserted int; n_retired int; n_skipped int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('harness-material:' || p_vehicle_id::text, 0));
  PERFORM public.key_harness_segments(p_vehicle_id);
  CREATE TEMP TABLE IF NOT EXISTS conf_material_status ON COMMIT DROP AS
    SELECT * FROM public.harness_segment_spec_status(p_vehicle_id) WITH NO DATA;
  TRUNCATE conf_material_status;
  INSERT INTO conf_material_status SELECT * FROM public.harness_segment_spec_status(p_vehicle_id);
  CREATE TEMP TABLE IF NOT EXISTS conf_w (wire_id uuid PRIMARY KEY, code text, from_endpoint_id uuid, to_endpoint_id uuid, gauge int,
    colour text, wire_type text, planned numeric, source text, observed_at timestamptz, trust text) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS conf_hop (wire_id uuid, n int, hops int, from_term uuid, to_term uuid) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS conf_seg (seg_id uuid PRIMARY KEY, wire_id uuid, from_term uuid, to_term uuid, created_at timestamptz) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS conf_match (seg_id uuid PRIMARY KEY, wire_id uuid, hop_n int) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS conf_pair (seg_id uuid, wire_id uuid, hop_n int) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS conf_net (wire_id uuid PRIMARY KEY, net_id uuid, signal_id uuid, net_code text) ON COMMIT DROP;
  TRUNCATE conf_w, conf_hop, conf_seg, conf_match, conf_pair, conf_net;

  INSERT INTO conf_w
  SELECT c.id, c.circuit_code, c.from_endpoint_id, c.to_endpoint_id, c.wire_gauge_awg, c.wire_color, c.wire_type, c.planned_length_ft,
         coalesce(c.source, 'vehicle_custom_circuits ' || c.circuit_code), coalesce(c.observed_at, c.created_at), coalesce(c.trust, 'T3')
  FROM public.vehicle_custom_circuits c JOIN public.vehicle_wiring_overlays o ON o.id = c.overlay_id
  WHERE o.vehicle_id = p_vehicle_id AND NOT coalesce(c.is_superseded, false) AND c.design_status = 'decided'
    AND NOT EXISTS (SELECT 1 FROM conf_material_status q
      WHERE (q.circuit_id = c.id OR q.current_circuit_id = c.id)
        AND q.physical_progress)
    AND (NOT EXISTS (SELECT 1 FROM conf_material_status q
           WHERE q.current_circuit_id = c.id AND q.circuit_id IS DISTINCT FROM c.id)
      OR (EXISTS (SELECT 1 FROM public.wire_termination_specs t WHERE t.circuit_id = c.id
            AND t.vehicle_id = p_vehicle_id AND t.endpoint_id = c.from_endpoint_id AND NOT coalesce(t.is_superseded, false))
        AND EXISTS (SELECT 1 FROM public.wire_termination_specs t WHERE t.circuit_id = c.id
            AND t.vehicle_id = p_vehicle_id AND t.endpoint_id = c.to_endpoint_id AND NOT coalesce(t.is_superseded, false))));

  -- The reshape's segmentation of each wire's live ends (20261014101500; the rule pass 19 applies).
  INSERT INTO conf_hop
  WITH e AS (
    SELECT w.wire_id, t.id AS term_id, h.code,
           (h.code ILIKE '%GROMMET%' OR h.code IN ('AMP-PASS', 'Firewall')) AS is_grommet,
           CASE WHEN t.endpoint_id = w.from_endpoint_id THEN 'F' WHEN t.endpoint_id = w.to_endpoint_id THEN 'T' ELSE 'M' END AS role,
           coalesce((SELECT fe.location_zone IN ('engine', 'chassis') FROM public.harness_endpoints fe WHERE fe.id = w.from_endpoint_id), false) AS from_engine
    FROM conf_w w
    JOIN public.wire_termination_specs t ON t.circuit_id = w.wire_id AND t.vehicle_id = p_vehicle_id AND NOT coalesce(t.is_superseded, false)
    JOIN public.harness_endpoints h ON h.id = t.endpoint_id AND NOT coalesce(h.is_superseded, false)
    JOIN public.harness_designs hd ON hd.id = h.design_id AND hd.vehicle_id = p_vehicle_id),
  ends AS (
    SELECT wire_id, term_id, code, role,
           CASE WHEN role = 'F' THEN 0 WHEN role = 'T' THEN 100
                WHEN code = 'FIREWALL-CABIN' THEN CASE WHEN from_engine THEN 60 ELSE 40 END
                WHEN code = 'FIREWALL-ENGINE' THEN CASE WHEN from_engine THEN 40 ELSE 60 END
                ELSE 50 END AS ord
    FROM e WHERE NOT coalesce(is_grommet, false)),
  wired AS (SELECT DISTINCT wire_id FROM ends),
  bounds AS (
    SELECT w.wire_id, NULL::uuid AS term_id, NULL::text AS code, 'F'::text AS role, -1 AS ord
    FROM wired w WHERE NOT EXISTS (SELECT 1 FROM ends x WHERE x.wire_id = w.wire_id AND x.role = 'F')
    UNION ALL
    SELECT w.wire_id, NULL::uuid, NULL::text, 'T', 101
    FROM wired w WHERE NOT EXISTS (SELECT 1 FROM ends x WHERE x.wire_id = w.wire_id AND x.role = 'T')),
  all_ends AS (SELECT wire_id, term_id, code, role, ord FROM ends UNION ALL SELECT wire_id, term_id, code, role, ord FROM bounds),
  seq AS (
    SELECT wire_id, term_id, code, ord,
           lead(term_id) OVER w AS next_term, lead(code) OVER w AS next_code, lead(ord) OVER w AS next_ord,
           row_number() OVER w AS pos
    FROM all_ends WINDOW w AS (PARTITION BY wire_id ORDER BY ord, code NULLS FIRST, term_id)),
  hops AS (
    SELECT wire_id, pos, term_id AS from_term, next_term AS to_term
    FROM seq
    WHERE next_ord IS NOT NULL AND (term_id IS NOT NULL OR next_term IS NOT NULL)
      AND NOT (coalesce(code, '') IN ('FIREWALL-CABIN', 'FIREWALL-ENGINE')
               AND coalesce(next_code, '') IN ('FIREWALL-CABIN', 'FIREWALL-ENGINE') AND code <> next_code))
  SELECT wire_id, row_number() OVER (PARTITION BY wire_id ORDER BY pos)::int, count(*) OVER (PARTITION BY wire_id)::int, from_term, to_term
  FROM hops;

  -- Two live ends of one wire on one plug is an ambiguity the rule cannot order (pass 11 leaves it in place): skip the wire.
  DELETE FROM conf_hop h
  WHERE h.wire_id IN (SELECT t.circuit_id FROM public.wire_termination_specs t
                      JOIN conf_w w ON w.wire_id = t.circuit_id
                      JOIN public.harness_endpoints e ON e.id = t.endpoint_id
                      WHERE NOT coalesce(t.is_superseded, false) AND NOT (e.code ILIKE '%GROMMET%' OR e.code IN ('AMP-PASS', 'Firewall'))
                      GROUP BY t.circuit_id, t.endpoint_id HAVING count(*) > 1);
  GET DIAGNOSTICS n_skipped = ROW_COUNT;

  INSERT INTO conf_seg
  SELECT s.id, w.wire_id, s.from_termination_id, s.to_termination_id, s.created_at
  FROM public.harness_segments s JOIN conf_material_status q ON q.segment_id = s.id
  JOIN conf_w w ON w.wire_id = q.current_circuit_id
  WHERE s.vehicle_id = p_vehicle_id AND NOT s.is_superseded;   -- every live segment, whatever its design status

  -- Segments that already are a desired hop stay as they are.
  INSERT INTO conf_match
  SELECT DISTINCT ON (s.seg_id) s.seg_id, s.wire_id, h.n
  FROM conf_seg s JOIN conf_hop h ON h.wire_id = s.wire_id
       AND h.from_term IS NOT DISTINCT FROM s.from_term AND h.to_term IS NOT DISTINCT FROM s.to_term
  ORDER BY s.seg_id, h.n;
  DELETE FROM conf_match m USING conf_match m2
  WHERE m.wire_id = m2.wire_id AND m.hop_n = m2.hop_n AND m.seg_id > m2.seg_id;   -- one segment per hop

  -- Unmatched segments take unmatched hops in order; what is left over is inserted or superseded.
  INSERT INTO conf_pair
  WITH us AS (
    SELECT s.seg_id, s.wire_id, row_number() OVER (PARTITION BY s.wire_id ORDER BY s.created_at, s.seg_id) AS k
    FROM conf_seg s WHERE s.seg_id NOT IN (SELECT seg_id FROM conf_match)
      AND s.wire_id IN (SELECT wire_id FROM conf_hop)),
  uh AS (
    SELECT h.wire_id, h.n, row_number() OVER (PARTITION BY h.wire_id ORDER BY h.n) AS k
    FROM conf_hop h WHERE NOT EXISTS (SELECT 1 FROM conf_match m WHERE m.wire_id = h.wire_id AND m.hop_n = h.n))
  SELECT us.seg_id, coalesce(us.wire_id, uh.wire_id), uh.n
  FROM us FULL JOIN uh ON uh.wire_id = us.wire_id AND uh.k = us.k;
  SELECT count(DISTINCT wire_id) INTO n_todo FROM conf_pair;

  -- A wire with no segment at all gets a net of its own; the net refold joins it to its node.
  INSERT INTO conf_net
  SELECT w.wire_id, gen_random_uuid(), gen_random_uuid(), 'wire ' || w.code
  FROM conf_w w
  WHERE w.wire_id IN (SELECT wire_id FROM conf_hop)
    AND NOT EXISTS (SELECT 1 FROM conf_seg s WHERE s.wire_id = w.wire_id)
    AND NOT EXISTS (SELECT 1 FROM public.harness_nets n WHERE n.vehicle_id = p_vehicle_id AND NOT n.is_superseded AND n.net_code = 'wire ' || w.code);
  INSERT INTO public.harness_signals (id, vehicle_id, signal_key, name, signal_type, source, method, observed_at, trust)
  SELECT c.signal_id, p_vehicle_id, c.net_code, w.code, NULL, w.source,
         'segment fold (RSI pass 25): a net for a wire with no segment, until the net refold joins it', w.observed_at, w.trust
  FROM conf_net c JOIN conf_w w ON w.wire_id = c.wire_id;
  INSERT INTO public.harness_nets (id, vehicle_id, net_code, signal_id, function, source, method, observed_at, trust)
  SELECT c.net_id, p_vehicle_id, c.net_code, c.signal_id, w.code, w.source,
         'segment fold (RSI pass 25): a net for a wire with no segment, until the net refold joins it', w.observed_at, w.trust
  FROM conf_net c JOIN conf_w w ON w.wire_id = c.wire_id;
  GET DIAGNOSTICS n_nets = ROW_COUNT;

  -- Segments left over are superseded, pointing at a segment the wire keeps.
  UPDATE public.harness_segments s
  SET is_superseded = true,
      superseded_by = (SELECT min(x.seg_id::text)::uuid
                       FROM (SELECT m.seg_id FROM conf_match m WHERE m.wire_id = p.wire_id
                             UNION ALL
                             SELECT p2.seg_id FROM conf_pair p2 WHERE p2.wire_id = p.wire_id AND p2.hop_n IS NOT NULL AND p2.seg_id IS NOT NULL) x),
      method = s.method || '; superseded by the segment fold (RSI pass 25): the wire''s live ends make fewer hops'
  FROM conf_pair p
  WHERE s.id = p.seg_id AND p.hop_n IS NULL;
  GET DIAGNOSTICS n_retired = ROW_COUNT;

  -- A changed physical end pair is a new unbuilt design piece. Preserve the prior piece and all its witnesses.
  n_updated := 0;
  FOR replacement IN
    SELECT s.*, p.wire_id AS new_wire_id, h.from_term AS new_from, h.to_term AS new_to, w.gauge AS new_gauge, w.colour AS new_colour
    FROM conf_pair p JOIN conf_hop h ON h.wire_id = p.wire_id AND h.n = p.hop_n
    JOIN conf_w w ON w.wire_id = p.wire_id JOIN public.harness_segments s ON s.id = p.seg_id
    WHERE p.seg_id IS NOT NULL
  LOOP
    successor_id := gen_random_uuid();
    UPDATE public.harness_segments SET is_superseded = true WHERE id = replacement.id;
    INSERT INTO public.harness_segments (id, vehicle_id, net_id, vehicle_custom_circuit_id,
      from_termination_id, to_termination_id, gauge_awg, colour, build_state, design_status,
      source, method, observed_at, trust)
    VALUES (successor_id, replacement.vehicle_id, replacement.net_id, replacement.new_wire_id,
      replacement.new_from, replacement.new_to, replacement.new_gauge, replacement.new_colour, 'uncut',
      replacement.design_status, replacement.source,
      'topology projection revision of ' || replacement.id || '; changed ends require new routing and length',
      replacement.observed_at, CASE WHEN replacement.trust IN ('T1','T2','T3') THEN 'T3' ELSE replacement.trust END);
    UPDATE public.harness_segments SET superseded_by = successor_id WHERE id = replacement.id;
    UPDATE public.vehicle_custom_circuits SET checks_input_hash = NULL, checks_invalidated_at = statement_timestamp(),
      checks_invalidation_reason = 'physical segment topology changed'
      WHERE id = replacement.new_wire_id;
    n_updated := n_updated + 1;
  END LOOP;

  -- Hops left over become segments: copied from a segment the wire keeps, or new on the wire's own net.
  INSERT INTO public.harness_segments (vehicle_id, net_id, from_termination_id, to_termination_id, wire_part_id, gauge_awg, colour,
    planned_length_ft, planned_length_method, build_state, source, method, observed_at, trust, vehicle_custom_circuit_id, design_status)
  SELECT p_vehicle_id, coalesce(k.net_id, cn.net_id), h.from_term, h.to_term, NULL, w.gauge,
         w.colour,
         CASE WHEN h.hops = 1 AND w.planned > 0 THEN w.planned END,
         CASE WHEN h.hops = 1 THEN 'whole-wire estimate from the wire row'
              ELSE 'unknown: the whole-wire estimate (' || coalesce(w.planned::text, 'none') || ' ft) was never split at its junctions' END,
         'uncut', w.source,
         'hop ' || h.n || ' of ' || h.hops || ' of the wire, from its live ends (RSI pass 25, the reshape v1 rule)', w.observed_at, w.trust,
         w.wire_id, coalesce(k.design_status, 'decided')
  FROM conf_pair p
  JOIN conf_hop h ON h.wire_id = p.wire_id AND h.n = p.hop_n
  JOIN conf_w w ON w.wire_id = p.wire_id
  LEFT JOIN LATERAL (SELECT s.* FROM public.harness_segments s
                     WHERE s.vehicle_custom_circuit_id = p.wire_id AND NOT s.is_superseded ORDER BY s.created_at, s.id LIMIT 1) k ON true
  LEFT JOIN conf_net cn ON cn.wire_id = p.wire_id
  WHERE p.seg_id IS NULL AND coalesce(k.net_id, cn.net_id) IS NOT NULL;
  GET DIAGNOSTICS n_inserted = ROW_COUNT;

  material_result := public.key_harness_segments(p_vehicle_id);
  RETURN material_result || jsonb_build_object('wires_conformed', n_todo, 'segments_updated', n_updated, 'segments_added', n_inserted,
                            'segments_superseded', n_retired, 'nets_for_new_wires', n_nets, 'hops_skipped_two_ends_on_one_plug', n_skipped);
END $fn$;
COMMENT ON FUNCTION public.conform_harness_segments(uuid) IS 'Existing segmentation rule, with physical-progress and unresolved-successor holds. Changed unbuilt end pairs supersede their prior segment and clear route/length applicability. New hops are always uncut; material fold runs before and after. Never copies physical completion to a new hop.';
REVOKE ALL ON FUNCTION public.conform_harness_segments(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conform_harness_segments(uuid) TO service_role;

CREATE FUNCTION public.guard_harness_segment_material() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $fn$
DECLARE progressed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Harness segment history is retained; supersede a design revision'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.superseded_by IS DISTINCT FROM OLD.superseded_by THEN
      IF OLD.superseded_by IS NOT NULL OR NOT NEW.is_superseded OR NEW.superseded_by = NEW.id
        OR NOT EXISTS (SELECT 1 FROM public.harness_segments successor WHERE successor.id = NEW.superseded_by
          AND successor.vehicle_id = OLD.vehicle_id AND NOT successor.is_superseded) THEN
        RAISE EXCEPTION 'Segment successor is assigned once to a live same-vehicle revision; history cannot be retargeted';
      END IF;
    END IF;
    IF OLD.is_superseded AND (to_jsonb(NEW) - 'superseded_by') IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_by') THEN
      RAISE EXCEPTION 'A superseded segment revision is immutable';
    END IF;
    progressed := OLD.build_state <> 'uncut' OR OLD.measured_length_ft IS NOT NULL OR OLD.measured_at IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.vehicle_custom_circuits c WHERE c.id = OLD.vehicle_custom_circuit_id
        AND (coalesce(c.build_state, 'uncut') <> 'uncut' OR c.measured_length_ft IS NOT NULL))
      OR EXISTS (SELECT 1 FROM public.harness_build_events b WHERE b.circuit_id = OLD.vehicle_custom_circuit_id
        AND b.vehicle_id = OLD.vehicle_id AND b.to_state <> 'uncut');
    IF OLD.measured_length_ft IS NOT NULL AND ROW(NEW.measured_length_ft, NEW.measured_at)
      IS DISTINCT FROM ROW(OLD.measured_length_ft, OLD.measured_at) THEN
      RAISE EXCEPTION 'Recorded segment measurement requires an evidenced correction, never clearing or rewriting';
    END IF;
    IF array_position(ARRAY['uncut','cut','terminated','installed','tested'], NEW.build_state)
      < array_position(ARRAY['uncut','cut','terminated','installed','tested'], OLD.build_state) THEN
      RAISE EXCEPTION 'Physical segment progress cannot regress to bypass a material revision hold';
    END IF;
    -- Net membership is physical connectivity for a progressed piece; refolds must reconcile it explicitly.
    IF progressed AND ROW(NEW.id, NEW.net_id, NEW.vehicle_id, NEW.vehicle_custom_circuit_id, NEW.from_termination_id, NEW.to_termination_id,
        NEW.gauge_awg, NEW.colour, NEW.wire_part_id, NEW.is_superseded)
      IS DISTINCT FROM ROW(OLD.id, OLD.net_id, OLD.vehicle_id, OLD.vehicle_custom_circuit_id, OLD.from_termination_id, OLD.to_termination_id,
        OLD.gauge_awg, OLD.colour, OLD.wire_part_id, OLD.is_superseded) THEN
      RAISE EXCEPTION 'Physical material revision hold: retain measured/built segment % and reconcile its design', OLD.id;
    END IF;
  END IF;
  IF NOT NEW.is_superseded AND (
    NOT EXISTS (SELECT 1 FROM public.harness_nets n WHERE n.id = NEW.net_id AND n.vehicle_id = NEW.vehicle_id)
    OR (NEW.vehicle_custom_circuit_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.vehicle_custom_circuits c JOIN public.vehicle_wiring_overlays o ON o.id = c.overlay_id
      WHERE c.id = NEW.vehicle_custom_circuit_id AND o.vehicle_id = NEW.vehicle_id))
    OR EXISTS (SELECT 1 FROM public.wire_termination_specs t WHERE t.id IN (NEW.from_termination_id, NEW.to_termination_id)
      AND t.vehicle_id IS DISTINCT FROM NEW.vehicle_id)) THEN
    RAISE EXCEPTION 'Segment net, circuit and terminations must belong to the same vehicle';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.guard_harness_segment_material() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER harness_segments_material_guard BEFORE INSERT OR UPDATE OR DELETE ON public.harness_segments
  FOR EACH ROW EXECUTE FUNCTION public.guard_harness_segment_material();

-- Statement-level triggers recompute once per affected vehicle, including loader batches.
-- Updating check-applicability metadata alone is not a dependency change and does not recurse.
CREATE FUNCTION public.recompute_harness_circuit_material() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $fn$
DECLARE affected uuid[]; v uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT o.vehicle_id) INTO affected FROM new_material_rows n
      JOIN public.vehicle_wiring_overlays o ON o.id = n.overlay_id;
  ELSE
    SELECT array_agg(DISTINCT o.vehicle_id) INTO affected FROM new_material_rows n JOIN old_material_rows prior ON prior.id = n.id
      JOIN public.vehicle_wiring_overlays o ON o.id IN (prior.overlay_id, n.overlay_id)
    WHERE ROW(n.wire_type, n.wire_gauge_awg, n.wire_color, n.from_endpoint_id, n.to_endpoint_id,
      n.design_status, n.is_superseded, n.superseded_by, n.overlay_id)
      IS DISTINCT FROM ROW(prior.wire_type, prior.wire_gauge_awg, prior.wire_color, prior.from_endpoint_id, prior.to_endpoint_id,
      prior.design_status, prior.is_superseded, prior.superseded_by, prior.overlay_id);
    IF affected IS NULL THEN RETURN NULL; END IF;
    UPDATE public.vehicle_custom_circuits c SET checks_input_hash = NULL, checks_invalidated_at = statement_timestamp(),
      checks_invalidation_reason = 'circuit material, endpoints, design state or source revision changed'
    FROM new_material_rows n JOIN old_material_rows prior ON prior.id = n.id
    WHERE c.id = n.id AND ROW(n.wire_type, n.wire_gauge_awg, n.wire_color, n.from_endpoint_id, n.to_endpoint_id,
      n.design_status, n.is_superseded, n.superseded_by, n.overlay_id)
      IS DISTINCT FROM ROW(prior.wire_type, prior.wire_gauge_awg, prior.wire_color, prior.from_endpoint_id, prior.to_endpoint_id,
      prior.design_status, prior.is_superseded, prior.superseded_by, prior.overlay_id);
  END IF;
  FOREACH v IN ARRAY coalesce(affected, ARRAY[]::uuid[]) LOOP
    PERFORM public.key_harness_segments(v);
  END LOOP;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.recompute_harness_circuit_material() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER harness_circuit_material_insert AFTER INSERT ON public.vehicle_custom_circuits
  REFERENCING NEW TABLE AS new_material_rows FOR EACH STATEMENT EXECUTE FUNCTION public.recompute_harness_circuit_material();
CREATE TRIGGER harness_circuit_material_update AFTER UPDATE ON public.vehicle_custom_circuits
  REFERENCING OLD TABLE AS old_material_rows NEW TABLE AS new_material_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.recompute_harness_circuit_material();

CREATE FUNCTION public.recompute_harness_termination_material() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $fn$
DECLARE affected uuid[]; circuits uuid[]; v uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT vehicle_id), array_agg(DISTINCT circuit_id) INTO affected, circuits FROM new_material_rows;
  ELSE
    -- Include all end specifications: terminals, seals and tooling are check inputs too.
    SELECT array_agg(DISTINCT x.vehicle_id), array_agg(DISTINCT x.circuit_id) INTO affected, circuits
    FROM (SELECT n.vehicle_id, n.circuit_id FROM new_material_rows n JOIN old_material_rows o ON o.id = n.id
      WHERE to_jsonb(n) IS DISTINCT FROM to_jsonb(o)
      UNION SELECT o.vehicle_id, o.circuit_id FROM old_material_rows o JOIN new_material_rows n ON n.id = o.id
      WHERE to_jsonb(n) IS DISTINCT FROM to_jsonb(o)) x;
  END IF;
  UPDATE public.vehicle_custom_circuits SET checks_input_hash = NULL, checks_invalidated_at = statement_timestamp(),
    checks_invalidation_reason = 'termination inputs changed'
  WHERE id = ANY(coalesce(circuits, ARRAY[]::uuid[]));
  FOREACH v IN ARRAY coalesce(affected, ARRAY[]::uuid[]) LOOP
    PERFORM public.key_harness_segments(v);
  END LOOP;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.recompute_harness_termination_material() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER harness_termination_material_insert AFTER INSERT ON public.wire_termination_specs
  REFERENCING NEW TABLE AS new_material_rows FOR EACH STATEMENT EXECUTE FUNCTION public.recompute_harness_termination_material();
CREATE TRIGGER harness_termination_material_update AFTER UPDATE ON public.wire_termination_specs
  REFERENCING OLD TABLE AS old_material_rows NEW TABLE AS new_material_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.recompute_harness_termination_material();

-- One catalog batch is one recompute per matching vehicle, including formerly referenced part IDs.
CREATE FUNCTION public.recompute_harness_catalog_material() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $fn$
DECLARE v uuid; changed_ids uuid[]; changed_names text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(id), array_agg(part_number) INTO changed_ids, changed_names FROM new_material_rows
      WHERE part_number ~ '^M22759/';
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(id), array_agg(part_number) INTO changed_ids, changed_names FROM old_material_rows;
  ELSE
    SELECT array_agg(x.id), array_agg(x.part_number) INTO changed_ids, changed_names
    FROM (SELECT n.id, n.part_number FROM new_material_rows n JOIN old_material_rows o ON o.id = n.id
        WHERE n.part_number IS DISTINCT FROM o.part_number
      UNION SELECT o.id, o.part_number FROM old_material_rows o JOIN new_material_rows n ON n.id = o.id
        WHERE n.part_number IS DISTINCT FROM o.part_number) x;
  END IF;
  IF changed_ids IS NULL THEN RETURN NULL; END IF;
  FOR v IN
    SELECT vehicles_with_segments.vehicle_id
    FROM (SELECT DISTINCT s.vehicle_id FROM public.harness_segments s WHERE NOT s.is_superseded) vehicles_with_segments
    WHERE EXISTS (SELECT 1 FROM public.harness_segments s WHERE s.vehicle_id = vehicles_with_segments.vehicle_id
        AND NOT s.is_superseded AND s.wire_part_id = ANY(changed_ids))
      OR EXISTS (SELECT 1 FROM public.harness_segment_spec_status(vehicles_with_segments.vehicle_id) q
        WHERE q.expected_part_number = ANY(changed_names))
    ORDER BY vehicles_with_segments.vehicle_id
  LOOP
    UPDATE public.vehicle_custom_circuits c SET checks_input_hash = NULL, checks_invalidated_at = statement_timestamp(),
      checks_invalidation_reason = 'catalog material identity or match cardinality changed'
    WHERE c.id IN (SELECT q.current_circuit_id FROM public.harness_segment_spec_status(v) q WHERE q.needs_revision);
    PERFORM public.key_harness_segments(v);
  END LOOP;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION public.recompute_harness_catalog_material() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER harness_catalog_material_insert AFTER INSERT ON public.catalog_parts
  REFERENCING NEW TABLE AS new_material_rows FOR EACH STATEMENT EXECUTE FUNCTION public.recompute_harness_catalog_material();
CREATE TRIGGER harness_catalog_material_update AFTER UPDATE ON public.catalog_parts
  REFERENCING OLD TABLE AS old_material_rows NEW TABLE AS new_material_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.recompute_harness_catalog_material();
CREATE TRIGGER harness_catalog_material_delete AFTER DELETE ON public.catalog_parts
  REFERENCING OLD TABLE AS old_material_rows FOR EACH STATEMENT EXECUTE FUNCTION public.recompute_harness_catalog_material();

-- Existing sanctioned fold repairs every affected vehicle, without a hard-coded vehicle or segment edit.
DO $repair$
DECLARE v uuid;
BEGIN
  FOR v IN SELECT existing.vehicle_id
    FROM (SELECT DISTINCT s.vehicle_id FROM public.harness_segments s WHERE NOT s.is_superseded) existing
    WHERE EXISTS (SELECT 1 FROM public.harness_segment_spec_status(existing.vehicle_id) q WHERE q.needs_revision)
    ORDER BY existing.vehicle_id
  LOOP
    PERFORM public.key_harness_segments(v);
  END LOOP;
END $repair$;

COMMIT;
