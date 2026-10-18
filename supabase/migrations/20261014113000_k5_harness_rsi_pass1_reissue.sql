-- Re-issue of 20261014103000 (failed on apply 2026-10-14 09:21Z and rolled back, nothing written: an abstract stack need's
-- text must already be a declared substrate (stack_needs.substrate is generated from it, with a foreign key to
-- stack_substrates). The two substrates are declared first now.
-- RSI pass 1 on the K5 harness model: evidence, design state, candidates, options at wire grain, protection, keys, and
-- the model measuring itself. Case ledger 13.12.2; schema proposal 50296583 (approved for build 2026-10-14).
--
-- Owner, 2026-10-14, on the reshape: "a bit light ... data model goes rsi". After 20261014093000 the K5's 390 decided
-- wires sat in harness_signals / harness_nets / harness_segments with row-level testimony only. Measured before this pass
-- (read-only, 2026-10-14): 783 k5-wiring observations on the K5 hold field-level facts (plug, wire, field, value,
-- citation, citation-audit result, check verdicts), 586 of them about a specific wire end; 25 decided wires route
-- through body bulkheads the owner retired on 2026-09-29; 927 option couplings could not reach wires because the link
-- check allowed only a decision or a plug as target; the K5 had no PDM units (the two pdm_units rows, PDM30 and PDM15,
-- are filed on e04bf9c5, a different Blazer, and are left there and named here); 27 terminal and 211 crimp-tool part
-- numbers on the K5's wire ends match catalog_parts exactly and were unkeyed; 138 concept wires (the unreviewed April
-- 2026 plan) were outside the model.
--
-- This pass, all from evidence already in the database:
--   1. harness_evidence links each observation to the harness row and field it speaks to (wire ends by plug + wire,
--      plugs by code).
--   2. harness_segments.design_status: decided, candidate or contradicted, with design_note. The 25 retired-bulkhead
--      routes become contradicted; the 138 concept wires enter as candidates with unknown ends.
--   3. Options reach wires: one coupled_with link per (option, segment) from the couplings of the segment's wire ends.
--   4. Protection: the K5 gets PDM30 and PDM15 units and their outputs from the pin library (device_pin_maps: output
--      number and rating per pin); each net with a wire end on a PDM output pin points at that output. The library names
--      PDM30 pins A01 / OUT1_A and PDM15 pins A1 / 'Output 1 (High Side)'; wire ends say A1; both forms are matched.
--   5. Keys: exact catalog matches fill terminal and crimp-tool keys on wire ends.
--   6. The model measures itself: stack SH in the stack registry, with column needs and denominators that
--      stack_coverage() reads hourly, and v_harness_coverage per public vehicle and layer.
-- harness_nets and harness_segments rows are recomputed derivations of the legacy rows and the observations, not testimony;
-- this pass enriches the rows the reshape wrote today in place and names itself in their method.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schema_proposals WHERE id = '50296583-f549-4f51-b5a7-a9e282926741' AND status = 'approved') THEN
    RAISE EXCEPTION 'schema proposal 50296583 is not approved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.harness_segments WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e') THEN
    RAISE EXCEPTION 'the K5 reshape (20261014101500) has not run';
  END IF;
  IF to_regclass('public.harness_evidence') IS NOT NULL THEN
    RAISE EXCEPTION 'harness_evidence already exists';
  END IF;
END $guard$;

-- 1. Schema.
ALTER TABLE public.harness_segments
  ADD COLUMN design_status text NOT NULL DEFAULT 'decided' CHECK (design_status IN ('decided', 'candidate', 'contradicted')),
  ADD COLUMN design_note text;
COMMENT ON COLUMN public.harness_segments.design_status IS 'Design fold: decided (in the design), candidate (proposed, unreviewed), contradicted (conflicts with a later owner call; design_note says which).';
COMMENT ON COLUMN public.harness_segments.design_note IS 'Why the segment is a candidate or contradicted, with the decision it conflicts with.';

DO $c$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.wiring_decision_links'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%num_nonnulls(other_decision_id, endpoint_id)%' LOOP
    EXECUTE format('ALTER TABLE public.wiring_decision_links DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $c$;
ALTER TABLE public.wiring_decision_links ADD CONSTRAINT wiring_decision_links_one_target
  CHECK (num_nonnulls(other_decision_id, endpoint_id, segment_id, termination_id) = 1);

CREATE TABLE public.harness_evidence (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id     uuid NOT NULL REFERENCES public.vehicles(id),
  observation_id uuid NOT NULL REFERENCES public.vehicle_observations(id),
  row_kind       text NOT NULL CHECK (row_kind IN ('signal', 'net', 'segment', 'termination', 'endpoint')),
  row_id         uuid NOT NULL,
  field          text,
  relation       text NOT NULL CHECK (relation IN ('supports', 'needs_bench', 'open', 'contradicts')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX harness_evidence_once ON public.harness_evidence (observation_id, row_kind, row_id, coalesce(field, ''));
CREATE INDEX harness_evidence_row ON public.harness_evidence (row_kind, row_id);
COMMENT ON TABLE public.harness_evidence IS 'Grain: one observation speaking to one field of one harness row. The observation (vehicle_observations) holds the source, clocks, trust and citation check; this row says which harness fact it supports, questions or contradicts. Proposal 50296583, case ledger 13.12.2.';
COMMENT ON COLUMN public.harness_evidence.id IS 'Row key.';
COMMENT ON COLUMN public.harness_evidence.vehicle_id IS 'The vehicle the observation and the harness row belong to.';
COMMENT ON COLUMN public.harness_evidence.observation_id IS 'The observation: a fact with its source document, clocks and trust.';
COMMENT ON COLUMN public.harness_evidence.row_kind IS 'Which harness table the row is in: signal, net, segment, termination (wire_termination_specs), endpoint (harness_endpoints).';
COMMENT ON COLUMN public.harness_evidence.row_id IS 'The harness row the observation speaks to.';
COMMENT ON COLUMN public.harness_evidence.field IS 'The fact within the row, in the observation''s words (tool, strip length, pull test, device end, plug / kit).';
COMMENT ON COLUMN public.harness_evidence.relation IS 'supports (cited), needs_bench (only a bench check settles it), open (deferred or unresolved), contradicts.';
COMMENT ON COLUMN public.harness_evidence.created_at IS 'Ingest time of the link.';
ALTER TABLE public.harness_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read for public vehicles" ON public.harness_evidence FOR SELECT USING (EXISTS (
  SELECT 1 FROM public.vehicles v WHERE v.id = harness_evidence.vehicle_id
    AND (v.is_public = true OR v.user_id = auth.uid() OR v.owner_id = auth.uid())));
REVOKE ALL ON public.harness_evidence FROM anon, authenticated;
GRANT SELECT ON public.harness_evidence TO anon, authenticated;
GRANT ALL ON public.harness_evidence TO service_role;

-- Working sets.
CREATE TEMP TABLE p1_e ON COMMIT DROP AS
SELECT e.id, e.code FROM public.harness_endpoints e JOIN public.harness_designs d ON d.id = e.design_id
WHERE d.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND NOT coalesce(e.is_superseded, false);
CREATE TEMP TABLE p1_t ON COMMIT DROP AS
SELECT t.id AS term_id, t.circuit_id, t.cavity, c.circuit_code, e.code AS ep_code
FROM public.wire_termination_specs t
JOIN public.vehicle_custom_circuits c ON c.id = t.circuit_id AND NOT coalesce(c.is_superseded, false)
LEFT JOIN p1_e e ON e.id = t.endpoint_id
WHERE t.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND NOT coalesce(t.is_superseded, false);

-- 2a. Routes the owner retired.
UPDATE public.harness_segments s
SET design_status = 'contradicted',
    design_note = 'routes through ' || b.codes || ', a body bulkhead the owner retired on 2026-09-29 (one 61-pin at the fuse-box hole, nothing else through the firewall; K5_WIRING_STATE rows 0ah, 0aj); the path is undefined',
    method = s.method || '; rsi pass 1: design state'
FROM (SELECT circuit_id, string_agg(DISTINCT ep_code, ', ' ORDER BY ep_code) AS codes
      FROM p1_t WHERE ep_code LIKE 'FIREWALL-BODY-%' GROUP BY circuit_id) b
WHERE s.vehicle_custom_circuit_id = b.circuit_id;

-- 2b. Concept wires enter as candidates: their own signal and net, one segment with unknown ends.
CREATE TEMP TABLE p1_concept ON COMMIT DROP AS
SELECT c.id, c.circuit_code, c.circuit_name, c.wire_gauge_awg, c.wire_type, c.wire_color, c.planned_length_ft,
       coalesce(c.source, 'vehicle_custom_circuits') AS source, coalesce(c.observed_at, c.created_at) AS observed_at,
       coalesce(c.trust, 'T3') AS trust, gen_random_uuid() AS signal_id, gen_random_uuid() AS net_id
FROM public.vehicle_custom_circuits c JOIN public.vehicle_wiring_overlays o ON o.id = c.overlay_id
WHERE o.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND NOT coalesce(c.is_superseded, false) AND c.design_status = 'concept';

INSERT INTO public.harness_signals (id, vehicle_id, signal_key, name, source, method, observed_at, trust)
SELECT signal_id, 'e08bf694-970f-4cbe-8a74-8715158a0f2e', circuit_code,
       coalesce(circuit_name, circuit_code), source, 'rsi pass 1: candidate wire from the April 2026 plan', observed_at, trust
FROM p1_concept;
INSERT INTO public.harness_nets (id, vehicle_id, net_code, signal_id, function, source, method, observed_at, trust)
SELECT net_id, 'e08bf694-970f-4cbe-8a74-8715158a0f2e', circuit_code, signal_id, coalesce(circuit_name, circuit_code),
       source, 'rsi pass 1: candidate wire from the April 2026 plan', observed_at, trust
FROM p1_concept;
INSERT INTO public.harness_segments (vehicle_id, net_id, gauge_awg, colour, planned_length_ft, planned_length_method,
  build_state, design_status, design_note, source, method, observed_at, trust, vehicle_custom_circuit_id)
SELECT 'e08bf694-970f-4cbe-8a74-8715158a0f2e', net_id, wire_gauge_awg, wire_color,
       CASE WHEN planned_length_ft > 0 THEN planned_length_ft END, 'April 2026 plan estimate', 'uncut', 'candidate',
       'April 2026 whole-truck plan, unreviewed; no wire ends recorded; its insulation may break the Tefzel-only lock',
       source, 'rsi pass 1: candidate wire from the April 2026 plan', observed_at, trust, id
FROM p1_concept;

-- 3. Options reach wires: each segment inherits the option couplings of its own wire ends.
INSERT INTO public.wiring_decision_links (decision_id, relation, segment_id, note, source, trust)
SELECT DISTINCT l.decision_id, 'coupled_with', s.id,
       'rsi pass 1: derived from the coupling of the segment''s wire-end plugs',
       'wiring_decision_links (endpoint couplings), 2026-10-14', 'T3'
FROM public.harness_segments s
JOIN public.wire_termination_specs t ON t.id IN (s.from_termination_id, s.to_termination_id)
JOIN public.wiring_decision_links l ON l.endpoint_id = t.endpoint_id AND l.relation = 'coupled_with'
WHERE s.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND NOT s.is_superseded;

-- 4. Protection from the pin library.
CREATE TEMP TABLE p1_units ON COMMIT DROP AS
SELECT m.model, gen_random_uuid() AS unit_id FROM (VALUES ('PDM30'), ('PDM15')) m(model);
INSERT INTO public.pdm_units (id, vehicle_id, unit_name, model, channel_count, rated_amps, notes)
SELECT u.unit_id, 'e08bf694-970f-4cbe-8a74-8715158a0f2e', u.model || ' (K5)', 'MoTeC ' || u.model,
       (SELECT count(DISTINCT coalesce(substring(p.pin_function FROM '^OUT([0-9]+)'), substring(p.pin_function FROM '^Output ([0-9]+)')))::int FROM public.device_pin_maps p
        WHERE p.device_model = u.model AND coalesce(substring(p.pin_function FROM '^OUT([0-9]+)'), substring(p.pin_function FROM '^Output ([0-9]+)')) IS NOT NULL),
       CASE u.model WHEN 'PDM30' THEN 100 END,
       'rsi pass 1: outputs from device_pin_maps; PDM30 100 A total per the MoTeC PDM manual (docs/wiring VALIDATION_REPORT); PDM15 total not in the substrate. Two older rows for these models are filed on e04bf9c5, another Blazer.'
FROM p1_units u;
INSERT INTO public.pdm_channels (pdm_unit_id, channel_number, channel_group_name, fuse_rating_amps, notes)
SELECT u.unit_id, o.n, 'OUT' || o.n, o.amps,
       'rsi pass 1: rating = the output pins'' max current in device_pin_maps (' || o.pins || ')'
FROM p1_units u
JOIN (SELECT p.device_model, coalesce(substring(p.pin_function FROM '^OUT([0-9]+)'), substring(p.pin_function FROM '^Output ([0-9]+)'))::int AS n, max(p.max_current_amps) AS amps,
             string_agg(p.pin_number, ' ' ORDER BY p.pin_number) AS pins
      FROM public.device_pin_maps p WHERE p.device_model IN ('PDM30', 'PDM15') AND coalesce(substring(p.pin_function FROM '^OUT([0-9]+)'), substring(p.pin_function FROM '^Output ([0-9]+)')) IS NOT NULL
      GROUP BY 1, 2) o ON o.device_model = u.model;

UPDATE public.harness_nets n
SET protection_pdm_channel_id = x.channel_id,
    method = n.method || '; rsi pass 1: protection from the PDM output pin (' || x.pin || ')'
FROM (
  SELECT DISTINCT ON (s.net_id) s.net_id, ch.id AS channel_id, t.ep_code || ' ' || t.cavity || ' = ' || p.pin_function AS pin
  FROM public.harness_segments s
  JOIN p1_t t ON t.term_id IN (s.from_termination_id, s.to_termination_id)
  JOIN public.device_pin_maps p ON p.device_model = split_part(t.ep_code, '-', 1)
       AND regexp_replace(upper(p.pin_number), '^([A-Z]+)0*([0-9]+)$', '\1\2') = regexp_replace(upper(t.cavity), '^([A-Z]+)0*([0-9]+)$', '\1\2')
       AND coalesce(substring(p.pin_function FROM '^OUT([0-9]+)'), substring(p.pin_function FROM '^Output ([0-9]+)')) IS NOT NULL
  JOIN p1_units u ON u.model = p.device_model
  JOIN public.pdm_channels ch ON ch.pdm_unit_id = u.unit_id AND ch.channel_number = coalesce(substring(p.pin_function FROM '^OUT([0-9]+)'), substring(p.pin_function FROM '^Output ([0-9]+)'))::int
  WHERE s.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND t.ep_code ~ '^PDM(15|30)-[AB]$'
  ORDER BY s.net_id, ch.fuse_rating_amps DESC NULLS LAST
) x
WHERE n.id = x.net_id;

-- 5. Keys on wire ends where the part number matches the catalog exactly.
UPDATE public.wire_termination_specs t SET terminal_contact_catalog_id = cp.id
FROM public.catalog_parts cp
WHERE t.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND NOT coalesce(t.is_superseded, false)
  AND t.terminal_contact_catalog_id IS NULL AND cp.part_number = t.terminal_contact_pn
  AND cp.id = (SELECT min(c2.id::text)::uuid FROM public.catalog_parts c2 WHERE c2.part_number = t.terminal_contact_pn);
UPDATE public.wire_termination_specs t SET crimp_tool_catalog_id = cp.id
FROM public.catalog_parts cp
WHERE t.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND NOT coalesce(t.is_superseded, false)
  AND t.crimp_tool_catalog_id IS NULL AND cp.part_number = t.crimp_tool_pn
  AND cp.id = (SELECT min(c2.id::text)::uuid FROM public.catalog_parts c2 WHERE c2.part_number = t.crimp_tool_pn);

-- 1b. Evidence: wire-end facts by plug + wire; plug facts by plug.
INSERT INTO public.harness_evidence (vehicle_id, observation_id, row_kind, row_id, field, relation)
SELECT DISTINCT o.vehicle_id, o.id, 'termination', t.term_id, o.structured_data->>'row_field',
       CASE o.structured_data->>'state' WHEN 'cited' THEN 'supports' WHEN 'bench' THEN 'needs_bench' ELSE 'open' END
FROM public.vehicle_observations o
JOIN p1_t t ON t.ep_code = o.structured_data->>'plug' AND t.circuit_code = o.structured_data->>'wire_id'
WHERE o.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND o.source_identifier LIKE 'k5-wiring:%';
INSERT INTO public.harness_evidence (vehicle_id, observation_id, row_kind, row_id, field, relation)
SELECT DISTINCT o.vehicle_id, o.id, 'endpoint', e.id, o.structured_data->>'row_field',
       CASE o.structured_data->>'state' WHEN 'cited' THEN 'supports' WHEN 'bench' THEN 'needs_bench' ELSE 'open' END
FROM public.vehicle_observations o
JOIN p1_e e ON e.code = o.structured_data->>'plug'
WHERE o.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND o.source_identifier LIKE 'k5-wiring:%'
  AND o.structured_data->>'wire_id' IS NULL;

-- 6. The model measures itself.
CREATE VIEW public.v_harness_coverage AS
WITH seg AS (SELECT s.* FROM public.harness_segments s JOIN public.vehicles v ON v.id = s.vehicle_id
             WHERE NOT s.is_superseded AND v.is_public IS TRUE),
ends AS (SELECT t.* FROM public.wire_termination_specs t JOIN public.vehicles v ON v.id = t.vehicle_id
         WHERE NOT coalesce(t.is_superseded, false) AND v.is_public IS TRUE
           AND EXISTS (SELECT 1 FROM seg WHERE t.id IN (seg.from_termination_id, seg.to_termination_id))),
nets AS (SELECT n.* FROM public.harness_nets n JOIN public.vehicles v ON v.id = n.vehicle_id
         WHERE NOT n.is_superseded AND v.is_public IS TRUE)
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
UNION ALL SELECT vehicle_id, 'fold', 'nets with a load model', count(nominal_current_a), count(*) FROM nets GROUP BY 1;
COMMENT ON VIEW public.v_harness_coverage IS 'The harness model measuring itself: per public vehicle, per stack layer, a measure with its numerator and denominator. RSI scoreboard for stack SH; case ledger 13.12.2.';
GRANT SELECT ON public.v_harness_coverage TO anon, authenticated, service_role;

INSERT INTO public.stacks (stack_id, version, name, question, path, scoring, status, source, registered_at, registered_by)
VALUES ('SH', 1, 'The wiring harness as data',
  'For one vehicle, what is every wire, wire end, plug, net and decision, with the evidence behind each, and how complete is each layer?',
  ARRAY[
    'log: partial. Field-level facts as vehicle_observations (k5-wiring:*), linked to harness rows through harness_evidence; legacy rows hold row-level source only',
    'key: partial. Segments to catalog wire parts, wire ends to terminal and tool parts; cavity keys wait on the library repair (standard 25-61 letters, GT150 2-way)',
    'dimension: partial. Catalog parts, cavity layouts, the device pin library (PDM outputs and ratings, M130 pins); topology nodes and branches empty',
    'fold: real. Signals, nets (merged through splices, ground points, studs), segments split at terminating pass-throughs; design state decided / candidate / contradicted; build state; protection from the PDM pin library',
    'baseline: missing, named. The factory harness of the body generation (factory_harness_circuits, mixed with build rows today)',
    'residual: missing, named. Each factory circuit kept, replaced or deleted; each net factory-derived or new',
    'feature: real. v_harness_coverage per vehicle and layer',
    'prediction: partial. planned_length_ft per segment, from whole-wire zone estimates until routing exists',
    'outcome: missing, named. measured_length_ft and test results, as wires are cut'],
  'Coverage per layer from stack_coverage() over the column needs; planned length graded against cut length once wires are cut.',
  'measured',
  'Case ledger 13.12 to 13.12.2; migrations 20261014060000 (tables), 20261014101500 (K5 reshape), 20261014113000 (RSI pass 1); proposals cdfc46c3, 50296583.',
  now(), 'claude-code (Opus 5.5), lead session skylar-17, for the owner');
INSERT INTO public.stack_substrates (substrate, note, source, registered_at, registered_by) VALUES
  ('factory harness baseline', 'The factory harness of a body generation, kept apart from build rows (factory_harness_circuits holds 71 squarebody 1973-87 circuits beside 60 build rows on 2026-10-14).', 'data-machine-cases.md 13.12.2', now(), 'claude-code (Opus 5.5), lead session skylar-17, for the owner'),
  ('harness residual against factory', 'Each factory circuit kept, replaced or deleted, and each net factory-derived or new, for one build against its body generation.', 'data-machine-cases.md 13.12.2', now(), 'claude-code (Opus 5.5), lead session skylar-17, for the owner')
ON CONFLICT (substrate) DO NOTHING;
INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, note) VALUES
  ('SH', 1, 'log', 'table', 'harness_evidence', NULL, 'observations linked to the harness facts they speak to'),
  ('SH', 1, 'key', 'column', 'harness_segments.wire_part_id', 'harness_segments.id', 'segments keyed to a catalog wire part'),
  ('SH', 1, 'key', 'column', 'wire_termination_specs.cavity_layout_id', 'wire_termination_specs.id', 'wire ends keyed to a cavity'),
  ('SH', 1, 'key', 'column', 'wire_termination_specs.terminal_contact_catalog_id', 'wire_termination_specs.id', 'wire ends keyed to a terminal part'),
  ('SH', 1, 'key', 'column', 'wire_termination_specs.crimp_tool_catalog_id', 'wire_termination_specs.id', 'wire ends keyed to a crimp tool'),
  ('SH', 1, 'dimension', 'column', 'connector_cavity_layouts.housing_part_id', 'connector_cavity_layouts.id', 'cavities keyed to their housing part'),
  ('SH', 1, 'fold', 'column', 'harness_nets.protection_pdm_channel_id', 'harness_nets.id', 'nets protected by a PDM output'),
  ('SH', 1, 'fold', 'column', 'harness_nets.nominal_current_a', 'harness_nets.id', 'nets with a load model'),
  ('SH', 1, 'baseline', 'abstract', 'factory harness baseline', NULL, 'the factory harness of the body generation, kept apart from build rows'),
  ('SH', 1, 'residual', 'abstract', 'harness residual against factory', NULL, 'each factory circuit kept, replaced or deleted; each net factory-derived or new'),
  ('SH', 1, 'feature', 'table', 'v_harness_coverage', NULL, 'the per-vehicle scoreboard'),
  ('SH', 1, 'prediction', 'column', 'harness_segments.planned_length_ft', 'harness_segments.id', 'segments with a planned length'),
  ('SH', 1, 'outcome', 'column', 'harness_segments.measured_length_ft', 'harness_segments.id', 'segments measured as cut');

-- Result.
DO $check$
DECLARE r record; contradicted int; candidates int; links int; protected int; evidence int;
BEGIN
  SELECT count(*) FILTER (WHERE design_status = 'contradicted'), count(*) FILTER (WHERE design_status = 'candidate')
    INTO contradicted, candidates FROM public.harness_segments WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';
  SELECT count(*) INTO links FROM public.wiring_decision_links l JOIN public.harness_segments s ON s.id = l.segment_id
   WHERE s.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';
  SELECT count(*) INTO protected FROM public.harness_nets WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND protection_pdm_channel_id IS NOT NULL;
  SELECT count(*) INTO evidence FROM public.harness_evidence;
  IF candidates = 0 AND EXISTS (SELECT 1 FROM p1_concept) THEN RAISE EXCEPTION 'concept wires did not enter as candidates'; END IF;
  RAISE NOTICE 'RSI pass 1: % contradicted, % candidates, % option links, % protected nets, % evidence links',
    contradicted, candidates, links, protected, evidence;
END $check$;

COMMIT;
