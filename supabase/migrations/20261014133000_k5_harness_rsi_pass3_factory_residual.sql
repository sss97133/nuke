-- RSI pass 3 on the K5 harness model: the factory baseline and the residual against it. Case ledger 13.12.1 item 8 and
-- 13.12.2; schema proposal 47ad7e95 (approved for build 2026-10-14).
--
-- After pass 2, stack SH's baseline and residual layers were missing. The case ledger set the test (13.12.1 item 8):
-- not "the factory harness accounts for the build" (a standalone-ECU restomod is mostly new circuits) but the
-- classification itself: each factory circuit carried or not, each build net factory-derived or new.
--
-- Measured before this pass (read-only, 2026-10-14):
--   - factory_harness_circuits: 71 squarebody 1973-87 rows (63 apply to a 1977 truck; 26 of those cite a GM circuit
--     number in source_document, "Circuit #N") beside 60 nuke_build rows (generation 'nuke_build', excluded by the
--     generation join: the K5 overlay's factory_generation is squarebody_1973_1987).
--   - The K5 registry names the factory circuit a wire end takes the place of on 65 wire ends (28 distinct GM numbers:
--     circuit 9 brown at the lamps, 150 black grounds, 183 / 184 at the tailgate window, LT GRN-11A at the dimmer, and
--     so on). Those facts landed today as 65 vehicle_observations through ingest-observation (load_observations.py
--     --factory-refs; property_key 'factory circuit', structured_data.gm_circuits). Sampled plug + wire pairs resolve to
--     exactly one live wire end each (29 of 29).
--   - Evidence links were one-shot inserts in pass 1; observations landing later had no path to the harness rows.
--
-- This pass:
--   1. factory_harness_circuits.gm_circuit_number, filled only from the row's own cited source_document.
--   2. link_harness_evidence(vehicle_id): the pass-1 linking rule as an idempotent, re-runnable fold (wire ends by plug +
--      wire, plugs by code; superseded observations skipped). Run here for the K5.
--   3. v_harness_factory_residual: per public vehicle and GM circuit number, 'carried' (a build wire end cites it and the
--      baseline has it), 'unassessed' (baseline only; no evidence either way, never read as deleted), 'baseline gap'
--      (the build cites it and no baseline row is keyed to it: the baseline is incomplete there).
--   4. v_harness_coverage gains the baseline and residual measures; stack SH gains three needs.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schema_proposals WHERE id = '47ad7e95-fa84-4b3e-b201-b6ebecf08d8b' AND status = 'approved') THEN
    RAISE EXCEPTION 'schema proposal 47ad7e95 is not approved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'connector_cavity_layouts' AND column_name = 'source') THEN
    RAISE EXCEPTION 'RSI pass 2 (20261014123000) has not run';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'factory_harness_circuits' AND column_name = 'gm_circuit_number') THEN
    RAISE EXCEPTION 'factory_harness_circuits.gm_circuit_number already exists';
  END IF;
  IF (SELECT count(*) FROM public.vehicle_observations WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
        AND structured_data->>'property_key' = 'factory circuit' AND NOT coalesce(is_superseded, false)) = 0 THEN
    RAISE EXCEPTION 'the K5 factory-circuit observations have not landed (load_observations.py --factory-refs)';
  END IF;
END $guard$;

-- 1. The baseline key.
ALTER TABLE public.factory_harness_circuits ADD COLUMN gm_circuit_number integer;
COMMENT ON COLUMN public.factory_harness_circuits.gm_circuit_number IS 'GM circuit identification number, the key a build wire end cites ("circuit 9 brown"). Filled only where source_document cites it (Circuit #N); null means not cited, not absent.';
COMMENT ON COLUMN public.factory_harness_circuits.generation IS 'The factory body generation the circuit belongs to (squarebody_1973_1987). nuke_build rows are a build plan filed here, not factory baseline; baselines join on a vehicle overlay''s factory_generation.';
UPDATE public.factory_harness_circuits SET gm_circuit_number = substring(source_document FROM 'Circuit #([0-9]+)')::int
WHERE generation <> 'nuke_build' AND source_document ~ 'Circuit #[0-9]+';

-- 2. The evidence fold.
CREATE FUNCTION public.link_harness_evidence(p_vehicle_id uuid) RETURNS integer
LANGUAGE sql SECURITY INVOKER SET search_path = public AS $fn$
WITH plugs AS (
  SELECT e.id, e.code FROM public.harness_endpoints e JOIN public.harness_designs d ON d.id = e.design_id
  WHERE d.vehicle_id = p_vehicle_id AND NOT coalesce(e.is_superseded, false)),
ends AS (
  SELECT t.id AS term_id, c.circuit_code, p.code AS ep_code
  FROM public.wire_termination_specs t
  JOIN public.vehicle_custom_circuits c ON c.id = t.circuit_id AND NOT coalesce(c.is_superseded, false)
  JOIN plugs p ON p.id = t.endpoint_id
  WHERE t.vehicle_id = p_vehicle_id AND NOT coalesce(t.is_superseded, false)),
obs AS (
  SELECT o.id, o.vehicle_id, o.structured_data AS sd,
         CASE o.structured_data->>'state' WHEN 'cited' THEN 'supports' WHEN 'bench' THEN 'needs_bench' ELSE 'open' END AS relation
  FROM public.vehicle_observations o
  WHERE o.vehicle_id = p_vehicle_id AND o.structured_data->>'domain' = 'wiring' AND o.structured_data ? 'plug'
    AND NOT coalesce(o.is_superseded, false)),
ins AS (
  INSERT INTO public.harness_evidence (vehicle_id, observation_id, row_kind, row_id, field, relation)
  SELECT DISTINCT o.vehicle_id, o.id, 'termination', t.term_id, o.sd->>'row_field', o.relation
  FROM obs o JOIN ends t ON t.ep_code = o.sd->>'plug' AND t.circuit_code = o.sd->>'wire_id'
  UNION
  SELECT DISTINCT o.vehicle_id, o.id, 'endpoint', p.id, o.sd->>'row_field', o.relation
  FROM obs o JOIN plugs p ON p.code = o.sd->>'plug'
  WHERE o.sd->>'wire_id' IS NULL
  ON CONFLICT DO NOTHING
  RETURNING 1)
SELECT count(*)::int FROM ins
$fn$;
COMMENT ON FUNCTION public.link_harness_evidence(uuid) IS 'Evidence fold for stack SH: links a vehicle''s wiring observations (structured_data.domain = wiring) to the wire ends (plug + wire) and plugs (plug, no wire) they speak to, as harness_evidence rows; idempotent; returns the number of new links. Superseded observations are skipped. Run after observations land.';
REVOKE ALL ON FUNCTION public.link_harness_evidence(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_harness_evidence(uuid) TO service_role;

DO $link$
DECLARE n int;
BEGIN
  n := public.link_harness_evidence('e08bf694-970f-4cbe-8a74-8715158a0f2e');
  RAISE NOTICE 'link_harness_evidence(K5): % new links', n;
END $link$;

-- 3. The residual.
CREATE VIEW public.v_harness_factory_residual AS
WITH veh AS (
  SELECT o.vehicle_id, o.factory_generation, v.year
  FROM public.vehicle_wiring_overlays o JOIN public.vehicles v ON v.id = o.vehicle_id
  WHERE v.is_public IS TRUE AND o.factory_generation IS NOT NULL AND v.year IS NOT NULL),
base AS (
  SELECT veh.vehicle_id, f.gm_circuit_number AS gm, array_agg(f.circuit_code ORDER BY f.circuit_code) AS factory_codes
  FROM veh JOIN public.factory_harness_circuits f ON f.generation = veh.factory_generation AND f.year_range @> veh.year
  WHERE f.gm_circuit_number IS NOT NULL
  GROUP BY 1, 2),
cite AS (
  SELECT h.vehicle_id, n.gm::int AS gm, h.row_id AS termination_id
  FROM public.harness_evidence h
  JOIN public.vehicle_observations o ON o.id = h.observation_id AND NOT coalesce(o.is_superseded, false)
  CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(o.structured_data->'gm_circuits', '[]'::jsonb)) n(gm)
  WHERE h.row_kind = 'termination' AND o.structured_data->>'property_key' = 'factory circuit'
    AND h.vehicle_id IN (SELECT vehicle_id FROM veh)),
cited AS (
  SELECT c.vehicle_id, c.gm, count(DISTINCT c.termination_id) AS wire_ends, count(DISTINCT s.net_id) AS nets
  FROM cite c
  LEFT JOIN public.harness_segments s ON NOT s.is_superseded AND c.termination_id IN (s.from_termination_id, s.to_termination_id)
  GROUP BY 1, 2)
SELECT coalesce(b.vehicle_id, c.vehicle_id) AS vehicle_id, coalesce(b.gm, c.gm) AS gm_circuit_number, b.factory_codes,
  CASE WHEN b.gm IS NOT NULL AND c.gm IS NOT NULL THEN 'carried' WHEN b.gm IS NOT NULL THEN 'unassessed' ELSE 'baseline gap' END AS status,
  coalesce(c.wire_ends, 0) AS wire_ends, coalesce(c.nets, 0) AS nets
FROM base b FULL JOIN cited c ON c.vehicle_id = b.vehicle_id AND c.gm = b.gm;
COMMENT ON VIEW public.v_harness_factory_residual IS 'Stack SH residual layer: per public vehicle and GM circuit number, the build against its factory baseline. carried: a build wire end cites the circuit and the baseline has it; unassessed: baseline only, no evidence either way (never read as deleted); baseline gap: the build cites a circuit no baseline row is keyed to. factory_codes are the baseline rows sharing the number. Case ledger 13.12.1 item 8.';
GRANT SELECT ON public.v_harness_factory_residual TO anon, authenticated, service_role;

-- 4. The scoreboard.
CREATE OR REPLACE VIEW public.v_harness_coverage AS
WITH seg AS (SELECT s.* FROM public.harness_segments s JOIN public.vehicles v ON v.id = s.vehicle_id
             WHERE NOT s.is_superseded AND v.is_public IS TRUE),
ends AS (SELECT t.* FROM public.wire_termination_specs t JOIN public.vehicles v ON v.id = t.vehicle_id
         WHERE NOT coalesce(t.is_superseded, false) AND v.is_public IS TRUE
           AND EXISTS (SELECT 1 FROM seg WHERE t.id IN (seg.from_termination_id, seg.to_termination_id))),
nets AS (SELECT n.* FROM public.harness_nets n JOIN public.vehicles v ON v.id = n.vehicle_id
         WHERE NOT n.is_superseded AND v.is_public IS TRUE),
base AS (SELECT o.vehicle_id, f.* FROM public.vehicle_wiring_overlays o JOIN public.vehicles v ON v.id = o.vehicle_id
         JOIN public.factory_harness_circuits f ON f.generation = o.factory_generation AND f.year_range @> v.year
         WHERE v.is_public IS TRUE),
res AS (SELECT * FROM public.v_harness_factory_residual)
SELECT vehicle_id, 'fold' AS layer, 'segments decided' AS measure, count(*) FILTER (WHERE design_status = 'decided') AS numerator, count(*) AS denominator FROM seg GROUP BY 1
UNION ALL SELECT vehicle_id, 'fold', 'segments with both ends known', count(*) FILTER (WHERE from_termination_id IS NOT NULL AND to_termination_id IS NOT NULL), count(*) FROM seg GROUP BY 1
UNION ALL SELECT vehicle_id, 'key', 'segments keyed to a wire part', count(wire_part_id), count(*) FROM seg GROUP BY 1
UNION ALL SELECT vehicle_id, 'prediction', 'segments with a planned length', count(planned_length_ft), count(*) FROM seg GROUP BY 1
UNION ALL SELECT vehicle_id, 'outcome', 'segments measured as cut', count(measured_length_ft), count(*) FROM seg GROUP BY 1
UNION ALL SELECT s.vehicle_id, 'key', 'segments carrying an option link', count(DISTINCT l.segment_id), count(DISTINCT s.id) FROM seg s LEFT JOIN public.wiring_decision_links l ON l.segment_id = s.id GROUP BY 1
UNION ALL SELECT s.vehicle_id, 'dimension', 'segments routed over topology', count(DISTINCT r.segment_id), count(DISTINCT s.id) FROM seg s LEFT JOIN public.harness_routings r ON r.segment_id = s.id AND NOT r.is_superseded GROUP BY 1
UNION ALL SELECT vehicle_id, 'key', 'wire ends keyed to a cavity', count(cavity_layout_id), count(*) FROM ends GROUP BY 1
UNION ALL SELECT vehicle_id, 'key', 'wire ends keyed to a terminal part', count(terminal_contact_catalog_id), count(*) FROM ends GROUP BY 1
UNION ALL SELECT vehicle_id, 'key', 'wire ends keyed to a crimp tool', count(crimp_tool_catalog_id), count(*) FROM ends GROUP BY 1
UNION ALL SELECT e.vehicle_id, 'log', 'wire ends with cited evidence', count(DISTINCT h.row_id) FILTER (WHERE h.relation = 'supports'), count(DISTINCT e.id) FROM ends e LEFT JOIN public.harness_evidence h ON h.row_kind = 'termination' AND h.row_id = e.id GROUP BY 1
UNION ALL SELECT vehicle_id, 'fold', 'nets with protection', count(*) FILTER (WHERE protection_pdm_channel_id IS NOT NULL OR protection_fuse_part_id IS NOT NULL), count(*) FROM nets GROUP BY 1
UNION ALL SELECT vehicle_id, 'fold', 'nets with a load model', count(nominal_current_a), count(*) FROM nets GROUP BY 1
UNION ALL SELECT vehicle_id, 'baseline', 'factory circuits keyed to a GM circuit number', count(gm_circuit_number), count(*) FROM base GROUP BY 1
UNION ALL SELECT vehicle_id, 'residual', 'factory GM circuits carried by the build', count(*) FILTER (WHERE status = 'carried'), count(*) FILTER (WHERE status <> 'baseline gap') FROM res GROUP BY 1
UNION ALL SELECT vehicle_id, 'residual', 'GM circuits the build cites that the baseline cannot key', count(*) FILTER (WHERE status = 'baseline gap'), count(*) FILTER (WHERE status <> 'unassessed') FROM res GROUP BY 1
UNION ALL SELECT n.vehicle_id, 'residual', 'nets carrying a factory circuit', count(DISTINCT n.id) FILTER (WHERE EXISTS (
           SELECT 1 FROM public.harness_segments s JOIN public.harness_evidence h ON h.row_kind = 'termination' AND h.row_id IN (s.from_termination_id, s.to_termination_id)
           JOIN public.vehicle_observations o ON o.id = h.observation_id AND NOT coalesce(o.is_superseded, false)
           WHERE s.net_id = n.id AND NOT s.is_superseded AND o.structured_data->>'property_key' = 'factory circuit')), count(DISTINCT n.id) FROM nets n GROUP BY 1;
COMMENT ON VIEW public.v_harness_coverage IS 'The harness model measuring itself: per public vehicle, per stack layer, a measure with its numerator and denominator. RSI scoreboard for stack SH; case ledger 13.12.2. Baseline and residual measures since RSI pass 3 (20261014133000).';
GRANT SELECT ON public.v_harness_coverage TO anon, authenticated, service_role;

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, note) VALUES
  ('SH', 1, 'baseline', 'column', 'factory_harness_circuits.gm_circuit_number', 'factory_harness_circuits.id', 'factory circuits keyed to a GM circuit number'),
  ('SH', 1, 'residual', 'table', 'v_harness_factory_residual', NULL, 'per GM circuit: carried, unassessed, or a baseline gap'),
  ('SH', 1, 'log', 'function', 'link_harness_evidence', NULL, 'the evidence fold, re-run as observations land');

-- Result.
DO $check$
DECLARE keyed int; carried int; unassessed int; gap int; nets int; total_nets int;
BEGIN
  SELECT count(*) INTO keyed FROM public.factory_harness_circuits WHERE gm_circuit_number IS NOT NULL;
  SELECT count(*) FILTER (WHERE status = 'carried'), count(*) FILTER (WHERE status = 'unassessed'), count(*) FILTER (WHERE status = 'baseline gap')
    INTO carried, unassessed, gap
  FROM public.v_harness_factory_residual WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';
  SELECT numerator, denominator INTO nets, total_nets FROM public.v_harness_coverage
  WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND measure = 'nets carrying a factory circuit';
  IF carried + gap = 0 THEN
    RAISE EXCEPTION 'no factory-circuit evidence reached the residual';
  END IF;
  RAISE NOTICE 'RSI pass 3: % factory rows keyed; K5 GM circuits carried %, unassessed %, baseline gap %; nets carrying a factory circuit % of %',
    keyed, carried, unassessed, gap, nets, total_nets;
END $check$;

COMMIT;
