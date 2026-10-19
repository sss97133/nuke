-- RSI pass 32 on the harness model: the node-kind and citation folds follow a plug by its code, not its row id. Case
-- ledger 13.12.3.
--
-- Pass 31 (#1645) placed the M130 and PDM30, and the loader re-inserted their 30 plugs (a plug whose position changes
-- is superseded and written again, with a new id). Live as anon at 18:34Z this showed two weaknesses in pass 28's folds:
--   1. carry_harness_termination_evidence matched an old wire end to its live successor on the same endpoint id. A
--      re-inserted plug has a new id, so citations on ends at those plugs stopped following: wire ends with cited
--      evidence went from 88 to 85 / 985.
--   2. classify_harness_endpoint_nodes gave a re-inserted plug the reshape's generic rule, not the kind its previous row
--      held. For the 30 plugs of that run the two agree. But PS-STUDS and MARKER-LF are terminals by evidence (net fold
--      v2), while the generic rule makes ground-typed plugs a bus. If either is ever re-inserted, the net fold would
--      join battery + to ground (PS-STUDS) or PDM30 OUT19 to ground (MARKER-LF), and the splice load would refuse the
--      whole run.
--
-- This pass re-issues both functions:
--   1. A plug with no node kind keeps the kind of its own previous row (same design and code), with that basis.
--      Only a plug with no history takes the generic rule.
--   2. A citation follows to the live end of the same wire at the plug with the same code and the same cavity.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF to_regprocedure('public.classify_harness_endpoint_nodes(uuid)') IS NULL
     OR to_regprocedure('public.carry_harness_termination_evidence(uuid)') IS NULL THEN
    RAISE EXCEPTION 'RSI pass 28 (20261015180000) has not run';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.classify_harness_endpoint_nodes(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE n_bus int; n_terminals int; n_kept int;
BEGIN
  WITH t AS (
    SELECT e.id,
           prev.node_kind AS prev_kind, prev.node_kind_basis AS prev_basis,
           CASE WHEN e.code LIKE 'SPL-%' OR e.endpoint_type IN ('splice', 'ground') OR e.code LIKE '%-STUD' THEN 'bus' ELSE 'terminals' END AS rule_kind
    FROM public.harness_endpoints e
    JOIN public.harness_designs d ON d.id = e.design_id AND d.vehicle_id = p_vehicle_id
    LEFT JOIN LATERAL (
      SELECT p.node_kind, p.node_kind_basis FROM public.harness_endpoints p
      WHERE p.design_id = e.design_id AND p.code = e.code AND p.id <> e.id AND p.node_kind IS NOT NULL
      -- a kind set by evidence (or kept from it) before one the generic rule set
      ORDER BY (coalesce(p.node_kind_basis, '') LIKE 'reshape v1 rule%'), p.id LIMIT 1) prev ON true
    WHERE NOT coalesce(e.is_superseded, false) AND e.node_kind IS NULL),
  upd AS (
    UPDATE public.harness_endpoints e
    SET node_kind = coalesce(t.prev_kind, t.rule_kind),
        node_kind_basis = CASE WHEN t.prev_kind IS NOT NULL
                               THEN left('kept from this plug''s previous row (RSI pass 32): ' || coalesce(t.prev_basis, 'no basis recorded'), 2000)
                               WHEN t.rule_kind = 'bus'
                               THEN 'reshape v1 rule, applied to a plug the loader added (RSI pass 28): a splice, ground bus or stud is one electrical node'
                               ELSE 'reshape v1 rule, applied to a plug the loader added (RSI pass 28): a device or connector; each wire end is its own node' END
    FROM t
    WHERE e.id = t.id
    RETURNING e.node_kind, t.prev_kind IS NOT NULL AS kept)
  SELECT count(*) FILTER (WHERE node_kind = 'bus'), count(*) FILTER (WHERE node_kind = 'terminals'), count(*) FILTER (WHERE kept)
    INTO n_bus, n_terminals, n_kept FROM upd;
  RETURN jsonb_build_object('plugs_given_bus', n_bus, 'plugs_given_terminals', n_terminals, 'kinds_kept_from_previous_row', n_kept);
END $fn$;
COMMENT ON FUNCTION public.classify_harness_endpoint_nodes(uuid) IS 'Gives every live plug of the vehicle that has no node_kind the kind of its own previous row (same design and code, with that basis; PS-STUDS and MARKER-LF are terminals by evidence), and a plug with no history the reshape v1 rule (a splice, ground bus or stud is a bus; a device or connector is terminals). Never changes a plug that has a kind. Idempotent; the registry loader calls it before the folds. RSI passes 28 and 32, case ledger 13.12.3.';

CREATE OR REPLACE FUNCTION public.carry_harness_termination_evidence(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE n_links int; n_ends int;
BEGIN
  WITH src AS (
    SELECT DISTINCT h.vehicle_id, h.observation_id, h.field, h.relation, s.id AS live_end
    FROM public.harness_evidence h
    JOIN public.wire_termination_specs p ON p.id = h.row_id AND p.is_superseded IS TRUE AND p.vehicle_id = p_vehicle_id
    JOIN public.harness_endpoints pe ON pe.id = p.endpoint_id
    JOIN public.vehicle_custom_circuits pc ON pc.id = p.circuit_id
    JOIN public.wire_termination_specs s ON s.vehicle_id = p.vehicle_id AND NOT coalesce(s.is_superseded, false)
         AND coalesce(btrim(s.cavity), '') = coalesce(btrim(p.cavity), '')
    JOIN public.harness_endpoints se ON se.id = s.endpoint_id AND se.code = pe.code AND se.design_id = pe.design_id
    JOIN public.vehicle_custom_circuits sc ON sc.id = s.circuit_id AND sc.overlay_id = pc.overlay_id
         AND sc.circuit_code = pc.circuit_code AND NOT coalesce(sc.is_superseded, false)
    WHERE h.row_kind = 'termination' AND h.vehicle_id = p_vehicle_id),
  ins AS (
    INSERT INTO public.harness_evidence (vehicle_id, observation_id, row_kind, row_id, field, relation)
    SELECT x.vehicle_id, x.observation_id, 'termination', x.live_end, x.field, x.relation
    FROM src x
    WHERE NOT EXISTS (SELECT 1 FROM public.harness_evidence e2
                      WHERE e2.row_kind = 'termination' AND e2.row_id = x.live_end AND e2.observation_id = x.observation_id
                        AND e2.relation = x.relation AND e2.field IS NOT DISTINCT FROM x.field)
    RETURNING row_id)
  SELECT count(*), count(DISTINCT row_id) INTO n_links, n_ends FROM ins;
  RETURN jsonb_build_object('links_carried', n_links, 'ends_given_links', n_ends);
END $fn$;
COMMENT ON FUNCTION public.carry_harness_termination_evidence(uuid) IS 'Copies each citation (harness_evidence, row_kind termination) on a superseded wire end of the vehicle to the live end of the same wire (its live circuit row with the same code) at the plug with the same code and the same cavity: the registry loader re-inserts every end of a wire, and every plug whose row changes, without superseded_by. An end that moved keeps none. Old links stay. Idempotent; the loader calls it after the keys. RSI passes 28 and 32, case ledger 13.12.3.';

DO $check$
DECLARE a jsonb; b jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a scoreboard measure has no grain'; END IF;
  a := public.classify_harness_endpoint_nodes('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  b := public.carry_harness_termination_evidence('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  RAISE NOTICE 'RSI pass 32 on the K5: nodes %, evidence %', a, b;
END $check$;

COMMIT;
