-- RSI pass 8 on the harness model: the build is logged. Case ledger 13.12.2 / 13.12.3; schema proposal 6e3ceb06
-- (approved for build 2026-10-14).
--
-- Stack SH's outcome layer was empty, and build progress had no log: vehicle_custom_circuits.build_state (uncut, cut,
-- terminated_a, terminated_b, routed, verified) was overwritten in place, so who cut or terminated a wire, and when, was
-- lost as soon as it was written (AGENTS.md invariant 2: testimony is never overwritten). Since 20261014193000 only the
-- vehicle's signed-in owner (and the service role) may change it; every row is still 'uncut' (2,469 rows, 528 live,
-- measured 2026-10-14), so the log starts before the first cut.
--
-- This pass:
--   1. harness_build_events: one row per change of one wire's build state (from, to, who, when); append-only (updates
--      and deletes refused by vein_append_only), readable where the vehicle is public or the reader owns it, written only
--      by the trigger.
--   2. An AFTER UPDATE OF build_state trigger on vehicle_custom_circuits logs every change from every write path (the
--      owner's BUILD skin, the service role); a write that does not change the state logs nothing.
--   3. The scoreboard's outcome layer gains "decided wires with a recorded build step"; stack SH gains the table.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schema_proposals WHERE id = '6e3ceb06-2547-4091-8f94-dbde0c184b05' AND status = 'approved') THEN
    RAISE EXCEPTION 'schema proposal 6e3ceb06 is not approved';
  END IF;
  IF to_regclass('public.v_harness_segment_geometry') IS NULL THEN
    RAISE EXCEPTION 'RSI pass 7 (20261014173000) has not run';
  END IF;
  IF to_regclass('public.harness_build_events') IS NOT NULL THEN
    RAISE EXCEPTION 'harness_build_events already exists';
  END IF;
END $guard$;

-- 1. The log.
CREATE TABLE public.harness_build_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  circuit_id uuid NOT NULL REFERENCES public.vehicle_custom_circuits(id),
  from_state text NOT NULL,
  to_state text NOT NULL,
  actor_user_id uuid,
  actor_role text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_state <> to_state),
  CHECK (to_state IN ('uncut', 'cut', 'terminated_a', 'terminated_b', 'routed', 'verified')));
CREATE INDEX harness_build_events_circuit ON public.harness_build_events (circuit_id, observed_at);
CREATE INDEX harness_build_events_vehicle ON public.harness_build_events (vehicle_id, observed_at);
COMMENT ON TABLE public.harness_build_events IS 'Grain: one change of one wire''s build state (vehicle_custom_circuits.build_state), with who and when. Append-only; written only by the trigger on vehicle_custom_circuits. The outcome log of stack SH: build_state is the latest of these. Proposal 6e3ceb06.';
COMMENT ON COLUMN public.harness_build_events.id IS 'Row key.';
COMMENT ON COLUMN public.harness_build_events.vehicle_id IS 'The vehicle the wire belongs to (through its wiring overlay).';
COMMENT ON COLUMN public.harness_build_events.circuit_id IS 'The wire (vehicle_custom_circuits row) whose build state changed.';
COMMENT ON COLUMN public.harness_build_events.from_state IS 'Build state before the change.';
COMMENT ON COLUMN public.harness_build_events.to_state IS 'Build state after the change: uncut, cut, terminated_a, terminated_b, routed, verified.';
COMMENT ON COLUMN public.harness_build_events.actor_user_id IS 'The signed-in user who made the change (auth.uid()); null for a service or migration write.';
COMMENT ON COLUMN public.harness_build_events.actor_role IS 'The database role of the write: authenticated for the owner''s BUILD skin, service_role or the migration role otherwise.';
COMMENT ON COLUMN public.harness_build_events.observed_at IS 'When the change was written.';
CREATE TRIGGER harness_build_events_append_only BEFORE UPDATE OR DELETE ON public.harness_build_events
  FOR EACH ROW EXECUTE FUNCTION public.vein_append_only();
ALTER TABLE public.harness_build_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read for public vehicles" ON public.harness_build_events FOR SELECT USING (EXISTS (
  SELECT 1 FROM public.vehicles v WHERE v.id = harness_build_events.vehicle_id
    AND (v.is_public = true OR v.user_id = auth.uid() OR v.owner_id = auth.uid())));
REVOKE ALL ON public.harness_build_events FROM anon, authenticated;
GRANT SELECT ON public.harness_build_events TO anon, authenticated, service_role;

-- 2. Every change of build_state is logged.
CREATE FUNCTION public.log_harness_build_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NEW.build_state IS DISTINCT FROM OLD.build_state THEN
    INSERT INTO public.harness_build_events (vehicle_id, circuit_id, from_state, to_state, actor_user_id, actor_role)
    SELECT o.vehicle_id, NEW.id, OLD.build_state, NEW.build_state, auth.uid(), coalesce(nullif(auth.role(), ''), session_user::text)
    FROM public.vehicle_wiring_overlays o WHERE o.id = NEW.overlay_id;
  END IF;
  RETURN NEW;
END
$fn$;
COMMENT ON FUNCTION public.log_harness_build_event() IS 'Trigger on vehicle_custom_circuits: appends a harness_build_events row (from, to, who, when) for every change of build_state.';
REVOKE ALL ON FUNCTION public.log_harness_build_event() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER vehicle_custom_circuits_log_build_state AFTER UPDATE OF build_state ON public.vehicle_custom_circuits
  FOR EACH ROW EXECUTE FUNCTION public.log_harness_build_event();

-- 3. The scoreboard's outcome layer.
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
res AS (SELECT * FROM public.v_harness_factory_residual),
wires AS (SELECT c.id, o.vehicle_id FROM public.vehicle_custom_circuits c
          JOIN public.vehicle_wiring_overlays o ON o.id = c.overlay_id JOIN public.vehicles v ON v.id = o.vehicle_id
          WHERE NOT coalesce(c.is_superseded, false) AND c.design_status = 'decided' AND v.is_public IS TRUE)
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
           WHERE s.net_id = n.id AND NOT s.is_superseded AND o.structured_data->>'property_key' = 'factory circuit')), count(DISTINCT n.id) FROM nets n GROUP BY 1
UNION ALL SELECT vehicle_id, 'dimension', 'GM circuits the build cites, named in the circuit dictionary', count(*) FILTER (WHERE status <> 'unassessed' AND gm_circuit_name IS NOT NULL), count(*) FILTER (WHERE status <> 'unassessed') FROM res GROUP BY 1
UNION ALL SELECT n.vehicle_id, 'fold', 'nets that join a supply to ground (must be 0)', count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM public.harness_segments s JOIN public.wire_termination_specs t ON t.id IN (s.from_termination_id, s.to_termination_id)
           JOIN public.harness_endpoints e ON e.id = t.endpoint_id
           WHERE s.net_id = n.id AND NOT s.is_superseded
             AND (t.cavity ILIKE '+ post%' OR (e.code ~ '^PDM(15|30)-[AB]$' AND EXISTS (
                   SELECT 1 FROM public.device_pin_maps p WHERE p.device_model = split_part(e.code, '-', 1)
                     AND regexp_replace(upper(p.pin_number), '^([A-Z]+)0*([0-9]+)$', '\1\2') = regexp_replace(upper(t.cavity), '^([A-Z]+)0*([0-9]+)$', '\1\2')
                     AND coalesce(substring(p.pin_function FROM '^OUT([0-9]+)'), substring(p.pin_function FROM '^Output ([0-9]+)')) IS NOT NULL))))
         AND EXISTS (
           SELECT 1 FROM public.harness_segments s JOIN public.wire_termination_specs t ON t.id IN (s.from_termination_id, s.to_termination_id)
           WHERE s.net_id = n.id AND NOT s.is_superseded AND t.cavity ILIKE '- post%')), count(*) FROM nets n GROUP BY 1
UNION ALL SELECT g.vehicle_id, 'dimension', 'segments with both plugs positioned', count(*) FILTER (WHERE g.straight_ft IS NOT NULL), count(*) FROM public.v_harness_segment_geometry g GROUP BY 1
UNION ALL SELECT g.vehicle_id, 'prediction', 'segments planned shorter than the straight line between their plugs (must be 0)', count(*) FILTER (WHERE g.planned_ft < g.straight_ft), count(*) FILTER (WHERE g.planned_ft IS NOT NULL AND g.straight_ft IS NOT NULL) FROM public.v_harness_segment_geometry g GROUP BY 1
UNION ALL SELECT w.vehicle_id, 'outcome', 'decided wires with a recorded build step', count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.harness_build_events e WHERE e.circuit_id = w.id)), count(*) FROM wires w GROUP BY 1;

COMMENT ON VIEW public.v_harness_coverage IS 'The harness model measuring itself: per public vehicle, per stack layer, a measure with its numerator and denominator. RSI scoreboard for stack SH; case ledger 13.12.2. Baseline and residual since RSI pass 3; the physics check since net fold v2; the geometry check since RSI pass 7; the build log since RSI pass 8 (20261014233000).';

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, note) VALUES
  ('SH', 1, 'outcome', 'table', 'harness_build_events', NULL, 'every change of a wire''s build state, with who and when');

DO $check$
DECLARE wires int;
BEGIN
  SELECT denominator INTO wires FROM public.v_harness_coverage
  WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND measure = 'decided wires with a recorded build step';
  RAISE NOTICE 'RSI pass 8: build log live; % decided K5 wires, 0 build steps recorded yet', wires;
END $check$;

COMMIT;
