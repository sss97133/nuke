-- RSI pass 28 on the harness model: two rules that ran once now run after every load. Case ledger 13.12.3.
--
-- Pass 26 (#1623) moved the wires that share an ECU or PDM pin onto a splice node beside the pin, with a lead wire into
-- the contact. The load (2026-10-15 17:28Z) inserted 25 nodes and 93 wires (68 of them re-inserted) and their 239 ends.
-- Live as anon, two measures fell for reasons that are not about the design:
--   1. Wire ends with cited evidence went from 88 to 51 of 935-985. The citations (harness_evidence, row_kind
--      termination) hang on wire_termination_specs rows. When the loader re-inserts a wire, it re-inserts every end,
--      including the 37 device ends that did not move (APS, CKP, CLT-ECU, CMP, KNOCK-1, FIREWALL-ENGINE ...). The links
--      stayed on the superseded rows. Pass 1 and pass 3 wrote them once, in their migrations. The loader sets no
--      superseded_by on wire ends, so nothing carried them.
--   2. The 25 new nodes have no node_kind. Net fold v2 (20261014153000) set node_kind once, by the reshape's rule: a
--      splice, ground bus or stud is a bus (one electrical node); anything else is terminals. A node the loader adds
--      later gets neither kind. Its wires are joined only through the splice rows (pass 16): the B16 net still holds its
--      12 wires and 3 leads.
--
-- This pass:
--   1. classify_harness_endpoint_nodes(vehicle): every live plug of the vehicle with no node_kind takes the reshape's
--      rule, with its basis.
--   2. carry_harness_termination_evidence(vehicle): a citation on a superseded wire end is copied to the live end of the
--      same wire (circuit code) at the same plug and cavity. An end that moved (a wire now ending at a splice instead of a pin)
--      keeps none, because the citation was about the old place. The copies are new links, and the old links stay on
--      the old rows.
-- The loader calls both after every run: the node rule before the net fold, the carry after the keys.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF to_regprocedure('public.conform_harness_segments(uuid)') IS NULL THEN
    RAISE EXCEPTION 'RSI pass 25 (20261015150000) has not run';
  END IF;
  IF to_regprocedure('public.classify_harness_endpoint_nodes(uuid)') IS NOT NULL
     OR to_regprocedure('public.carry_harness_termination_evidence(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'RSI pass 28 functions already exist';
  END IF;
END $guard$;

-- 1. The node rule, re-runnable.
CREATE FUNCTION public.classify_harness_endpoint_nodes(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE n_bus int; n_terminals int;
BEGIN
  WITH upd AS (
    UPDATE public.harness_endpoints e
    SET node_kind = CASE WHEN e.code LIKE 'SPL-%' OR e.endpoint_type IN ('splice', 'ground') OR e.code LIKE '%-STUD' THEN 'bus'
                         ELSE 'terminals' END,
        node_kind_basis = CASE WHEN e.code LIKE 'SPL-%' OR e.endpoint_type IN ('splice', 'ground') OR e.code LIKE '%-STUD'
                               THEN 'reshape v1 rule, applied to a plug the loader added (RSI pass 28): a splice, ground bus or stud is one electrical node'
                               ELSE 'reshape v1 rule, applied to a plug the loader added (RSI pass 28): a device or connector; each wire end is its own node' END
    FROM public.harness_designs d
    WHERE d.id = e.design_id AND d.vehicle_id = p_vehicle_id AND NOT coalesce(e.is_superseded, false) AND e.node_kind IS NULL
    RETURNING e.node_kind)
  SELECT count(*) FILTER (WHERE node_kind = 'bus'), count(*) FILTER (WHERE node_kind = 'terminals') INTO n_bus, n_terminals FROM upd;
  RETURN jsonb_build_object('plugs_given_bus', n_bus, 'plugs_given_terminals', n_terminals);
END $fn$;
COMMENT ON FUNCTION public.classify_harness_endpoint_nodes(uuid) IS 'Gives every live plug of the vehicle that has no node_kind the reshape v1 rule (net fold v2): a splice, ground bus or stud is a bus (one electrical node); a device or connector is terminals (each wire end its own node). Never changes a plug that already has a kind (PS-STUDS and MARKER-LF are terminals by evidence). Idempotent; the registry loader calls it before the net fold. RSI pass 28, case ledger 13.12.3.';
REVOKE ALL ON FUNCTION public.classify_harness_endpoint_nodes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classify_harness_endpoint_nodes(uuid) TO service_role;

-- 2. Citations follow an unchanged wire end.
CREATE FUNCTION public.carry_harness_termination_evidence(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $fn$
DECLARE n_links int; n_ends int;
BEGIN
  WITH src AS (
    SELECT DISTINCT h.vehicle_id, h.observation_id, h.field, h.relation, s.id AS live_end
    FROM public.harness_evidence h
    JOIN public.wire_termination_specs p ON p.id = h.row_id AND p.is_superseded IS TRUE AND p.vehicle_id = p_vehicle_id
    JOIN public.vehicle_custom_circuits pc ON pc.id = p.circuit_id
    JOIN public.wire_termination_specs s ON s.vehicle_id = p.vehicle_id AND NOT coalesce(s.is_superseded, false)
         AND s.endpoint_id = p.endpoint_id AND coalesce(btrim(s.cavity), '') = coalesce(btrim(p.cavity), '')
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
COMMENT ON FUNCTION public.carry_harness_termination_evidence(uuid) IS 'Copies each citation (harness_evidence, row_kind termination) on a superseded wire end of the vehicle to the live end of the same wire (its live circuit row with the same code) at the same plug and cavity: the registry loader re-inserts every end of a wire it re-inserts and sets no superseded_by, so links written once (RSI passes 1 and 3) stayed on the old rows. An end that moved keeps none. Old links stay. Idempotent; the loader calls it after the keys. RSI pass 28, case ledger 13.12.3.';
REVOKE ALL ON FUNCTION public.carry_harness_termination_evidence(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carry_harness_termination_evidence(uuid) TO service_role;

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, note) VALUES
  ('SH', 1, 'fold', 'function', 'classify_harness_endpoint_nodes', NULL, 'every plug the loader adds gets its node kind before the net fold'),
  ('SH', 1, 'log', 'function', 'carry_harness_termination_evidence', NULL, 'citations follow a wire end the loader re-inserts unchanged');

DO $check$
DECLARE a jsonb; b jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.v_harness_coverage WHERE grain IS NULL) THEN RAISE EXCEPTION 'a scoreboard measure has no grain'; END IF;
  a := public.classify_harness_endpoint_nodes('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  b := public.carry_harness_termination_evidence('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  RAISE NOTICE 'RSI pass 28 on the K5: nodes %, evidence %', a, b;
END $check$;

COMMIT;
