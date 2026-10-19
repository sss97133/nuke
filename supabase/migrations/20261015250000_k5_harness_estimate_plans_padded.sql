-- RSI pass 39 on the harness model: a segment's planned length is a cut length (route or estimate, x the pad), and an
-- estimate never stands shorter than its route. Case ledger 13.12.3.
--
-- harness_segments.planned_length_ft means "length to cut in feet, from routing plus the pad rule" (its column comment,
-- 20261014060000). Pass 34 (#1664) planned routed segments with no plan as route x pad, and left every plan from the
-- cut list alone. Those plans are the wire's whole-length zone estimate copied onto its only segment (the reshape,
-- "whole-wire zone estimate from the legacy row"; the segment fold, "whole-wire estimate from the wire row"), and the
-- registry keeps that estimate without the pad (kits_v5.py applies it: "zone estimates x the locked pad", state row 33).
-- So 186 live segments carried an unpadded estimate as their cut. After the pass 38 branches (#1690) routed 397 of 669
-- segments, live as anon at 20:12Z, 14 of those estimates were shorter than their own route: #67 dome lamp 3.5 ft over an
-- 11.29 ft route, #79/#90/#91 clearance lamps 3.5 ft over 6.99-8.48 ft, PDM_BPOS 1.9 over 5.4, PDM_GND1/2 3.5 over
-- 5.91, FAN_GND 2.2 over 5.85, #21 2.2 over 4.34, COIL_PWR 3.0 over 5.13, #52 4.6 over 5.45, INJ7/8_PWR 1.5 over 1.67,
-- #121 2.0 over 2.01.
--
-- This pass re-issues plan_harness_segment_lengths(vehicle). For each live segment whose plan is empty, a whole-wire
-- estimate, or one this rule wrote:
--   1. routed, and the wire's estimate (its only segment) is not longer than the route: route x pad, as in pass 34;
--      when an estimate was shorter, the method says so;
--   2. otherwise, with a whole-wire estimate: estimate x pad (1.20 in the engine section, 1.15 elsewhere, K5_WIRING_STATE.md
--      row 33), and the method names the route it is longer than, or that it is not routed;
--   3. a plan this rule wrote whose route and estimate are both gone is cleared to unknown, with the reason.
-- A plan from a tape, a twin landmark route, or the April concept rows is never touched. The registry takes the same
-- routes as wire lengths through inputs/route_lengths.json (same PR), so the printed cut list agrees with the model.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF to_regclass('public.v_harness_route_length_check') IS NULL THEN RAISE EXCEPTION 'RSI pass 34 (20261015230000) has not run'; END IF;
  IF obj_description('public.plan_harness_segment_lengths(uuid)'::regprocedure) LIKE '%RSI pass 39%' THEN
    RAISE EXCEPTION 'RSI pass 39 has already run';
  END IF;
END $guard$;

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
           -- the wire's whole-length estimate belongs to its only live segment
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
      AND (s.planned_length_ft IS NULL
        OR coalesce(s.planned_length_method, '') LIKE 'route length x pad%'
        OR coalesce(s.planned_length_method, '') LIKE 'zone estimate x pad%'
        OR coalesce(s.planned_length_method, '') LIKE 'whole-wire zone estimate from the legacy row%'
        OR coalesce(s.planned_length_method, '') LIKE 'whole-wire estimate from the wire row%')),
  s1 AS (
    SELECT s0.*, branches || ' branch' || CASE WHEN branches = 1 THEN '' ELSE 'es' END AS branch_words,
           -- the registry rounds a route up to the tenth of a foot, so an estimate within 1.2 in of its route is that route
           route_in > 0 AND (est_ft IS NULL OR est_ft * 12 <= route_in + 1.2) AS by_route
    FROM s0)
  SELECT id, old_ft, old_method,
         CASE WHEN by_route THEN round(route_in / 12.0 * pad, 2)
              WHEN est_ft IS NOT NULL THEN round(est_ft * pad, 2) END,
         CASE WHEN by_route THEN
                'route length x pad (RSI pass 34): ' || route_in || ' in over ' || branch_words || ' x ' || pad_words
                || ', K5_WIRING_STATE.md row 33)'
                || CASE WHEN est_ft * 12 < route_in THEN '; the wire''s ' || est_ft || ' ft estimate is shorter than its route (RSI pass 39)' ELSE '' END
              WHEN est_ft IS NOT NULL THEN
                'zone estimate x pad (RSI pass 39): the wire''s ' || est_ft || ' ft estimate x ' || pad_words || ', K5_WIRING_STATE.md row 33)'
                || CASE WHEN route_in > 0 THEN '; longer than its route, ' || route_in || ' in over ' || branch_words ELSE '; not routed' END
              WHEN coalesce(old_method, '') LIKE 'route length x pad%' OR coalesce(old_method, '') LIKE 'zone estimate x pad%' THEN
                'unknown: no live route and no whole-wire estimate for this segment (RSI pass 39); it was ' || coalesce(old_ft::text, 'unplanned')
         END,
         route_in > 0 AND est_ft * 12 < route_in
  FROM s1;

  SELECT count(*) FILTER (WHERE est_short), count(*) FILTER (WHERE method LIKE 'zone estimate x pad%') INTO n_est_short, n_from_est FROM plan_seg;

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
COMMENT ON FUNCTION public.plan_harness_segment_lengths(uuid) IS 'Plans the cut length of each live segment of the vehicle whose plan is empty, a whole-wire estimate, or one this rule wrote: route x pad when routed and the wire''s estimate is not longer than the route; else the whole-wire estimate x pad (1.20 engine section, 1.15 elsewhere, K5_WIRING_STATE.md row 33); a plan of its own with no route and no estimate left is cleared to unknown. Tape, twin-landmark and April concept plans are never touched. Idempotent; the registry loader calls it after routing. RSI pass 34, re-issued in RSI pass 39; case ledger 13.12.3.';
REVOKE ALL ON FUNCTION public.plan_harness_segment_lengths(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_harness_segment_lengths(uuid) TO service_role;

DO $check$
DECLARE r jsonb;
BEGIN
  IF has_function_privilege('anon', 'public.plan_harness_segment_lengths(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'anon can run the planner'; END IF;
  r := public.plan_harness_segment_lengths('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  RAISE NOTICE 'RSI pass 39 on the K5: %', r;
END $check$;

COMMIT;
