-- RSI pass 42 on the harness model: a wire's planned length carries what it is and where it came from, and the segment
-- planner says so. Case ledger 13.12.3.
--
-- Live as anon at 21:15Z, 354 of 417 decided K5 wires carry vehicle_custom_circuits.planned_length_ft, and nothing on
-- the row says what the number is: a route over the twin graph (206 in the registry), a zone estimate (115), a design
-- length (25 pin leads), an older twin path (8). The basis lives only in the registry file. The segment planner
-- (passes 34 and 39) therefore labels every whole-wire length "zone estimate x pad", including the pin leads' 4 and 6 in
-- design lengths and the twin paths. The same pass gives the 33 PDM pigtails and the PCS ignition pin lead their design
-- length (registry, the pin leads' rule), so their 33 segments, which had no plan, get one.
--
-- This pass:
--   1. vehicle_custom_circuits gains planned_length_kind (tape | twin | route | design | estimate) and
--      planned_length_basis (the registry's words, with its source). The registry loader writes both.
--   2. plan_harness_segment_lengths names the kind: "design length x pad", "twin path x pad", "registry route x pad", or
--      "zone estimate x pad" as before. A wire whose length is taped on the truck is never re-planned.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF obj_description('public.plan_harness_segment_lengths(uuid)'::regprocedure) NOT LIKE '%RSI pass 39%' THEN
    RAISE EXCEPTION 'RSI pass 39 (20261015250000) has not run';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'vehicle_custom_circuits'
             AND column_name = 'planned_length_kind') THEN
    RAISE EXCEPTION 'RSI pass 42 has already run';
  END IF;
END $guard$;

-- 1. The wire's length says what it is.
ALTER TABLE public.vehicle_custom_circuits
  ADD COLUMN planned_length_kind text CHECK (planned_length_kind IN ('tape', 'twin', 'route', 'design', 'estimate')),
  ADD COLUMN planned_length_basis text;
COMMENT ON COLUMN public.vehicle_custom_circuits.planned_length_kind IS 'What planned_length_ft is: tape (measured on the vehicle), twin (a path in the digital twin), route (the sum of the wire''s route over the twin route graph), design (a length the design sets, e.g. a pin lead), estimate (a zone estimate). Written by the registry loader from the registry''s length_kind. RSI pass 42.';
COMMENT ON COLUMN public.vehicle_custom_circuits.planned_length_basis IS 'Where planned_length_ft came from, in the registry''s words with its source (k5_registry.json length_basis). RSI pass 42.';

-- 2. The planner names the kind.
CREATE OR REPLACE FUNCTION public.plan_harness_segment_lengths(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE n_planned int; n_replanned int; n_cleared int; n_from_est int; n_est_short int;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS plan_seg (id uuid PRIMARY KEY, old_ft numeric, old_method text, new_ft numeric, method text,
    est_short boolean) ON COMMIT DROP;
  TRUNCATE plan_seg;

  INSERT INTO plan_seg (id, old_ft, old_method, new_ft, method, est_short)
  WITH s0 AS (
    SELECT s.id, s.planned_length_ft AS old_ft, s.planned_length_method AS old_method,
           CASE WHEN c.harness_section = 'engine' THEN 1.20 ELSE 1.15 END AS pad,
           CASE WHEN c.harness_section = 'engine' THEN '1.20 (engine bay' ELSE '1.15 (body' END AS pad_words,
           r.route_in, r.branches,
           -- what the wire's length is (RSI pass 42); no kind reads as a zone estimate
           CASE c.planned_length_kind WHEN 'design' THEN 'design length' WHEN 'twin' THEN 'twin path'
                WHEN 'route' THEN 'route over the twin graph' ELSE 'estimate' END AS est_words,
           CASE c.planned_length_kind WHEN 'design' THEN 'design length x pad (RSI pass 42)' WHEN 'twin' THEN 'twin path x pad (RSI pass 42)'
                WHEN 'route' THEN 'registry route x pad (RSI pass 42)' ELSE 'zone estimate x pad (RSI pass 39)' END AS est_rule,
           -- the wire's whole length belongs to its only live segment
           CASE WHEN c.planned_length_ft > 0 AND NOT EXISTS (
                  SELECT 1 FROM public.harness_segments o
                  WHERE o.vehicle_custom_circuit_id = s.vehicle_custom_circuit_id AND o.id <> s.id AND NOT o.is_superseded)
                THEN c.planned_length_ft END AS est_ft
    FROM public.harness_segments s
    JOIN public.vehicle_custom_circuits c ON c.id = s.vehicle_custom_circuit_id
    LEFT JOIN LATERAL (SELECT sum(l.distance_in) AS route_in, count(*) AS branches
                       FROM public.harness_routings h JOIN public.vehicle_harness_landmarks l ON l.id = h.landmark_id
                       WHERE h.segment_id = s.id AND NOT h.is_superseded) r ON true
    WHERE s.vehicle_id = p_vehicle_id AND NOT s.is_superseded
      AND coalesce(c.planned_length_kind, '') <> 'tape'          -- a length taped on the truck is never re-planned
      AND (s.planned_length_ft IS NULL
        OR coalesce(s.planned_length_method, '') ~ '^(route length|zone estimate|design length|twin path|registry route) x pad'
        OR coalesce(s.planned_length_method, '') LIKE 'whole-wire zone estimate from the legacy row%'
        OR coalesce(s.planned_length_method, '') LIKE 'whole-wire estimate from the wire row%')),
  s1 AS (
    SELECT s0.*, branches || ' branch' || CASE WHEN branches = 1 THEN '' ELSE 'es' END AS branch_words,
           -- the registry rounds a route up to the tenth of a foot, so a length within 1.2 in of its route is that route
           route_in > 0 AND (est_ft IS NULL OR est_ft * 12 <= route_in + 1.2) AS by_route
    FROM s0)
  SELECT id, old_ft, old_method,
         CASE WHEN by_route THEN round(route_in / 12.0 * pad, 2)
              WHEN est_ft IS NOT NULL THEN round(est_ft * pad, 2) END,
         CASE WHEN by_route THEN
                'route length x pad (RSI pass 34): ' || route_in || ' in over ' || branch_words || ' x ' || pad_words
                || ', K5_WIRING_STATE.md row 33)'
                || CASE WHEN est_ft * 12 < route_in THEN '; the wire''s ' || est_ft || ' ft ' || est_words || ' is shorter than its route (RSI pass 39)' ELSE '' END
              WHEN est_ft IS NOT NULL THEN
                est_rule || ': the wire''s ' || est_ft || ' ft ' || est_words || ' x ' || pad_words || ', K5_WIRING_STATE.md row 33)'
                || CASE WHEN route_in > 0 THEN '; longer than its route, ' || route_in || ' in over ' || branch_words ELSE '; not routed' END
              WHEN coalesce(old_method, '') ~ '^(route length|zone estimate|design length|twin path|registry route) x pad' THEN
                'unknown: no live route and no whole-wire length for this segment (RSI pass 39); it was ' || coalesce(old_ft::text, 'unplanned')
         END,
         route_in > 0 AND est_ft * 12 < route_in
  FROM s1;

  SELECT count(*) FILTER (WHERE est_short), count(*) FILTER (WHERE method ~ '^(zone estimate|design length|twin path|registry route) x pad')
  INTO n_est_short, n_from_est FROM plan_seg;

  WITH upd AS (
    UPDATE public.harness_segments s SET planned_length_ft = p.new_ft, planned_length_method = p.method
    FROM plan_seg p
    WHERE s.id = p.id AND p.method IS NOT NULL
      AND (s.planned_length_ft IS DISTINCT FROM p.new_ft OR s.planned_length_method IS DISTINCT FROM p.method)
    RETURNING p.old_ft IS NULL AS was_empty, p.new_ft IS NULL AS cleared)
  SELECT count(*) FILTER (WHERE was_empty AND NOT cleared), count(*) FILTER (WHERE NOT was_empty AND NOT cleared),
         count(*) FILTER (WHERE cleared AND NOT was_empty)
  INTO n_planned, n_replanned, n_cleared FROM upd;

  RETURN jsonb_build_object('segments_planned_from_route', n_planned, 'segments_replanned', n_replanned, 'plans_cleared', n_cleared,
                            'segments_on_a_padded_estimate', n_from_est, 'estimates_shorter_than_their_route', n_est_short);
END $fn$;
COMMENT ON FUNCTION public.plan_harness_segment_lengths(uuid) IS 'Plans the cut length of each live segment of the vehicle whose plan is empty, a whole-wire length, or one this rule wrote: route x pad when routed and the wire''s length is not longer than the route; else the wire''s whole length x pad (1.20 engine section, 1.15 elsewhere, K5_WIRING_STATE.md row 33), named by its kind (design length, twin path, registry route, zone estimate; vehicle_custom_circuits.planned_length_kind); a plan of its own with no route and no length left is cleared to unknown. A taped wire, tape, twin-landmark and April concept plans are never touched. Idempotent; the registry loader calls it after routing. RSI pass 34, re-issued in RSI passes 39 and 42; case ledger 13.12.3.';
REVOKE ALL ON FUNCTION public.plan_harness_segment_lengths(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_harness_segment_lengths(uuid) TO service_role;

DO $check$
BEGIN
  IF has_function_privilege('anon', 'public.plan_harness_segment_lengths(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'anon can run the planner'; END IF;
END $check$;

COMMIT;
