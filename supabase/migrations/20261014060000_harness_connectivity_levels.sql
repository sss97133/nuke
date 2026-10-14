-- A vehicle's wiring harness at four connectivity levels: signal -> net -> segment -> routing over topology.
--
-- Case ledger 13.12 and 13.12.1; schema proposal cdfc46c3 (add_table, approved for build 2026-10-14). VEC (VDA 4968)
-- keeps Signal, Net/Connection, the physical wire (WireElementReference) and Topology apart. Until now
-- vehicle_custom_circuits held all four in one row: the K5's coolant-temp wire (#110) is one row with four end rows
-- because it passes the 61-pin firewall connector, so its cabin and engine pieces cannot carry their own length or cut
-- state, a net cannot carry its load and protection, and a planned length cannot be graded against the cut length.
--
-- Additive only. vehicle_custom_circuits stays the legacy reader until a parity view reproduces it. New rows carry
-- testimony (source, method, observed_at, trust) and supersede instead of updating. Library tables
-- (catalog_parts, connector_cavity_layouts, device_pin_maps) stay specifications; these are occurrences on one vehicle.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schema_proposals
                 WHERE id = 'cdfc46c3-aee7-4a95-8169-58f45d64d5c7' AND status = 'approved') THEN
    RAISE EXCEPTION 'schema proposal cdfc46c3 is not approved';
  END IF;
  IF to_regclass('public.harness_signals') IS NOT NULL THEN
    RAISE EXCEPTION 'harness_signals already exists';
  END IF;
END $guard$;

-- 1. Signal: what the wire means.
CREATE TABLE public.harness_signals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id    uuid NOT NULL REFERENCES public.vehicles(id),
  signal_key    text NOT NULL,
  name          text NOT NULL,
  signal_type   text,
  source        text NOT NULL,
  method        text NOT NULL,
  observed_at   timestamptz NOT NULL,
  trust         text NOT NULL,
  is_superseded boolean NOT NULL DEFAULT false,
  superseded_by uuid REFERENCES public.harness_signals(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX harness_signals_live_key ON public.harness_signals (vehicle_id, signal_key) WHERE NOT is_superseded;

-- 2. Net: what is electrically joined, with its load and its protection.
CREATE TABLE public.harness_nets (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id               uuid NOT NULL REFERENCES public.vehicles(id),
  net_code                 text NOT NULL,
  signal_id                uuid REFERENCES public.harness_signals(id),
  function                 text,
  nominal_current_a        numeric CHECK (nominal_current_a IS NULL OR nominal_current_a >= 0),
  peak_current_a           numeric CHECK (peak_current_a IS NULL OR peak_current_a >= 0),
  duty                     text,
  protection_pdm_channel_id uuid REFERENCES public.pdm_channels(id),
  protection_fuse_part_id  uuid REFERENCES public.catalog_parts(id),
  protection_setting_a     numeric CHECK (protection_setting_a IS NULL OR protection_setting_a > 0),
  source                   text NOT NULL,
  method                   text NOT NULL,
  observed_at              timestamptz NOT NULL,
  trust                    text NOT NULL,
  is_superseded            boolean NOT NULL DEFAULT false,
  superseded_by            uuid REFERENCES public.harness_nets(id),
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX harness_nets_live_key ON public.harness_nets (vehicle_id, net_code) WHERE NOT is_superseded;
CREATE INDEX harness_nets_signal ON public.harness_nets (signal_id);

-- 3. Segment: one physical wire between two terminations.
CREATE TABLE public.harness_segments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id            uuid NOT NULL REFERENCES public.vehicles(id),
  net_id                uuid NOT NULL REFERENCES public.harness_nets(id),
  from_termination_id   uuid REFERENCES public.wire_termination_specs(id),
  to_termination_id     uuid REFERENCES public.wire_termination_specs(id),
  wire_part_id          uuid REFERENCES public.catalog_parts(id),
  gauge_awg             integer,
  colour                text,
  planned_length_ft     numeric CHECK (planned_length_ft IS NULL OR planned_length_ft > 0),
  planned_length_method text,
  measured_length_ft    numeric CHECK (measured_length_ft IS NULL OR measured_length_ft > 0),
  measured_at           timestamptz,
  build_state           text NOT NULL DEFAULT 'uncut'
                        CHECK (build_state IN ('uncut', 'cut', 'terminated', 'installed', 'tested')),
  source                text NOT NULL,
  method                text NOT NULL,
  observed_at           timestamptz NOT NULL,
  trust                 text NOT NULL,
  is_superseded         boolean NOT NULL DEFAULT false,
  superseded_by         uuid REFERENCES public.harness_segments(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (from_termination_id IS DISTINCT FROM to_termination_id),
  CHECK ((measured_length_ft IS NULL) = (measured_at IS NULL))
);
CREATE UNIQUE INDEX harness_segments_live_ends ON public.harness_segments (net_id, from_termination_id, to_termination_id) WHERE NOT is_superseded;
CREATE INDEX harness_segments_vehicle ON public.harness_segments (vehicle_id);
CREATE INDEX harness_segments_from ON public.harness_segments (from_termination_id);
CREATE INDEX harness_segments_to ON public.harness_segments (to_termination_id);

-- 4. Topology: the route graph's points; vehicle_harness_landmarks becomes its branches.
CREATE TABLE public.harness_topology_nodes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id    uuid NOT NULL REFERENCES public.vehicles(id),
  node_code     text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('breakout', 'clip', 'grommet', 'bulkhead', 'device', 'splice', 'ground', 'landmark')),
  pos_x_m       numeric,
  pos_y_m       numeric,
  pos_z_m       numeric,
  pos_source    text,
  source        text NOT NULL,
  method        text NOT NULL,
  observed_at   timestamptz NOT NULL,
  trust         text NOT NULL,
  is_superseded boolean NOT NULL DEFAULT false,
  superseded_by uuid REFERENCES public.harness_topology_nodes(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX harness_topology_nodes_live_key ON public.harness_topology_nodes (vehicle_id, node_code) WHERE NOT is_superseded;

ALTER TABLE public.vehicle_harness_landmarks
  ADD COLUMN from_node_id uuid REFERENCES public.harness_topology_nodes(id),
  ADD COLUMN to_node_id   uuid REFERENCES public.harness_topology_nodes(id);

-- 5. Routing: a segment's passage along topology branches, in order.
CREATE TABLE public.harness_routings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id    uuid NOT NULL REFERENCES public.harness_segments(id),
  landmark_id   uuid NOT NULL REFERENCES public.vehicle_harness_landmarks(id),
  seq           integer NOT NULL CHECK (seq >= 1),
  source        text NOT NULL,
  observed_at   timestamptz NOT NULL,
  trust         text NOT NULL,
  is_superseded boolean NOT NULL DEFAULT false,
  superseded_by uuid REFERENCES public.harness_routings(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX harness_routings_live_seq ON public.harness_routings (segment_id, seq) WHERE NOT is_superseded;

-- 6. Keys on existing tables: mating, variant membership on wires and ends, the library keyed to itself.
ALTER TABLE public.harness_endpoints
  ADD COLUMN mates_with_endpoint_id uuid REFERENCES public.harness_endpoints(id);
ALTER TABLE public.wiring_decision_links
  ADD COLUMN segment_id     uuid REFERENCES public.harness_segments(id),
  ADD COLUMN termination_id uuid REFERENCES public.wire_termination_specs(id);
ALTER TABLE public.connector_cavity_layouts
  ADD COLUMN housing_part_id uuid REFERENCES public.catalog_parts(id);
ALTER TABLE public.wire_termination_specs
  ADD COLUMN cavity_layout_id uuid REFERENCES public.connector_cavity_layouts(id);

-- 7. Access: public read for public vehicles (the harness_endpoints rule), writes by the service role only.
ALTER TABLE public.harness_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harness_nets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harness_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harness_topology_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.harness_routings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read for public vehicles" ON public.harness_signals FOR SELECT USING (EXISTS (
  SELECT 1 FROM public.vehicles v WHERE v.id = harness_signals.vehicle_id
    AND (v.is_public = true OR v.user_id = auth.uid() OR v.owner_id = auth.uid())));
CREATE POLICY "Public read for public vehicles" ON public.harness_nets FOR SELECT USING (EXISTS (
  SELECT 1 FROM public.vehicles v WHERE v.id = harness_nets.vehicle_id
    AND (v.is_public = true OR v.user_id = auth.uid() OR v.owner_id = auth.uid())));
CREATE POLICY "Public read for public vehicles" ON public.harness_segments FOR SELECT USING (EXISTS (
  SELECT 1 FROM public.vehicles v WHERE v.id = harness_segments.vehicle_id
    AND (v.is_public = true OR v.user_id = auth.uid() OR v.owner_id = auth.uid())));
CREATE POLICY "Public read for public vehicles" ON public.harness_topology_nodes FOR SELECT USING (EXISTS (
  SELECT 1 FROM public.vehicles v WHERE v.id = harness_topology_nodes.vehicle_id
    AND (v.is_public = true OR v.user_id = auth.uid() OR v.owner_id = auth.uid())));
CREATE POLICY "Public read for public vehicles" ON public.harness_routings FOR SELECT USING (EXISTS (
  SELECT 1 FROM public.harness_segments s JOIN public.vehicles v ON v.id = s.vehicle_id
  WHERE s.id = harness_routings.segment_id
    AND (v.is_public = true OR v.user_id = auth.uid() OR v.owner_id = auth.uid())));
REVOKE ALL ON public.harness_signals, public.harness_nets, public.harness_segments,
  public.harness_topology_nodes, public.harness_routings FROM anon, authenticated;
GRANT SELECT ON public.harness_signals, public.harness_nets, public.harness_segments,
  public.harness_topology_nodes, public.harness_routings TO anon, authenticated;
GRANT ALL ON public.harness_signals, public.harness_nets, public.harness_segments,
  public.harness_topology_nodes, public.harness_routings TO service_role;

-- 8. The model describes itself.
COMMENT ON TABLE public.harness_signals IS 'Grain: one meaning carried in one vehicle''s harness (coolant temp, crank position, CAN-H). VEC Signal. Append-only; corrections supersede. Proposal cdfc46c3, case ledger 13.12.';
COMMENT ON COLUMN public.harness_signals.vehicle_id IS 'The vehicle whose harness carries this signal.';
COMMENT ON COLUMN public.harness_signals.signal_key IS 'Stable key within the vehicle, e.g. coolant_temp; unique among live rows.';
COMMENT ON COLUMN public.harness_signals.name IS 'Name in the builder''s vocabulary (coolant temp, oil PSI, crank sensor).';
COMMENT ON COLUMN public.harness_signals.signal_type IS 'Electrical kind: analog_temp_input, analog_5v, half_bridge, can_h, power, ground and so on.';
COMMENT ON COLUMN public.harness_signals.source IS 'The evidence this row rests on: a document and page, an owner call, a measurement record; never the export it was loaded from.';
COMMENT ON COLUMN public.harness_signals.method IS 'How the row was produced: transcribed, measured, decided, derived by a named rule.';
COMMENT ON COLUMN public.harness_signals.observed_at IS 'Event time: when the source said or measured it. Ingest time is created_at.';
COMMENT ON COLUMN public.harness_signals.trust IS 'Trust tier of the source (T1 maker or service manual ... T3 agent interpretation).';
COMMENT ON COLUMN public.harness_signals.is_superseded IS 'True once a later row replaced this one; readers filter on false.';
COMMENT ON COLUMN public.harness_signals.superseded_by IS 'The row that replaced this one.';
COMMENT ON COLUMN public.harness_signals.created_at IS 'Ingest time: when Nuke recorded the row.';

COMMENT ON TABLE public.harness_nets IS 'Grain: one electrically continuous net in one vehicle''s harness, joining contact points through splices and bulkhead cavities. VEC Net/Connection. Carries its load model and protection so margins are computed, not typed. Append-only; corrections supersede.';
COMMENT ON COLUMN public.harness_nets.vehicle_id IS 'The vehicle whose harness holds this net.';
COMMENT ON COLUMN public.harness_nets.net_code IS 'Stable key within the vehicle, e.g. the build''s circuit number (110); unique among live rows.';
COMMENT ON COLUMN public.harness_nets.signal_id IS 'The meaning this net carries.';
COMMENT ON COLUMN public.harness_nets.function IS 'What the net does in the system, in the builder''s words.';
COMMENT ON COLUMN public.harness_nets.nominal_current_a IS 'Continuous current through the net in amperes, from the load''s source.';
COMMENT ON COLUMN public.harness_nets.peak_current_a IS 'Peak or inrush current in amperes, from the load''s source.';
COMMENT ON COLUMN public.harness_nets.duty IS 'Duty pattern: continuous, intermittent, cranking, signal.';
COMMENT ON COLUMN public.harness_nets.protection_pdm_channel_id IS 'The PDM output that protects this net, when a PDM does.';
COMMENT ON COLUMN public.harness_nets.protection_fuse_part_id IS 'The fuse part that protects this net, when a fuse does.';
COMMENT ON COLUMN public.harness_nets.protection_setting_a IS 'Trip setting in amperes: the PDM output current limit or the fuse rating.';
COMMENT ON COLUMN public.harness_nets.source IS 'The evidence this row rests on, never the export it was loaded from.';
COMMENT ON COLUMN public.harness_nets.method IS 'How the row was produced.';
COMMENT ON COLUMN public.harness_nets.observed_at IS 'Event time: when the source said or decided it.';
COMMENT ON COLUMN public.harness_nets.trust IS 'Trust tier of the source.';
COMMENT ON COLUMN public.harness_nets.is_superseded IS 'True once a later row replaced this one.';
COMMENT ON COLUMN public.harness_nets.superseded_by IS 'The row that replaced this one.';
COMMENT ON COLUMN public.harness_nets.created_at IS 'Ingest time.';

COMMENT ON TABLE public.harness_segments IS 'Grain: one physical wire between two terminations (VEC WireElementReference). A wire through a bulkhead is two segments of one net. planned_length_ft is a prediction; measured_length_ft is its outcome. Append-only; corrections supersede.';
COMMENT ON COLUMN public.harness_segments.vehicle_id IS 'The vehicle this wire is on; equals its net''s vehicle.';
COMMENT ON COLUMN public.harness_segments.net_id IS 'The net this wire belongs to.';
COMMENT ON COLUMN public.harness_segments.from_termination_id IS 'The wire end at one side: a wire_termination_specs row (cavity, terminal, seal, tool).';
COMMENT ON COLUMN public.harness_segments.to_termination_id IS 'The wire end at the other side.';
COMMENT ON COLUMN public.harness_segments.wire_part_id IS 'The wire as a catalog part (e.g. M22759/16-22 in a colour).';
COMMENT ON COLUMN public.harness_segments.gauge_awg IS 'Conductor size in AWG.';
COMMENT ON COLUMN public.harness_segments.colour IS 'Insulation colour and stripe, e.g. yellow/red.';
COMMENT ON COLUMN public.harness_segments.planned_length_ft IS 'Prediction: length to cut in feet, from routing plus the pad rule.';
COMMENT ON COLUMN public.harness_segments.planned_length_method IS 'How the planned length was computed (routing, twin path, estimate) and its rule version.';
COMMENT ON COLUMN public.harness_segments.measured_length_ft IS 'Outcome: the length actually cut, in feet.';
COMMENT ON COLUMN public.harness_segments.measured_at IS 'Event time of the cut-length measurement.';
COMMENT ON COLUMN public.harness_segments.build_state IS 'Build fold: uncut, cut, terminated, installed, tested.';
COMMENT ON COLUMN public.harness_segments.source IS 'The evidence this row rests on, never the export it was loaded from.';
COMMENT ON COLUMN public.harness_segments.method IS 'How the row was produced.';
COMMENT ON COLUMN public.harness_segments.observed_at IS 'Event time: when the source said, decided or measured it.';
COMMENT ON COLUMN public.harness_segments.trust IS 'Trust tier of the source.';
COMMENT ON COLUMN public.harness_segments.is_superseded IS 'True once a later row replaced this one.';
COMMENT ON COLUMN public.harness_segments.superseded_by IS 'The row that replaced this one.';
COMMENT ON COLUMN public.harness_segments.created_at IS 'Ingest time.';

COMMENT ON TABLE public.harness_topology_nodes IS 'Grain: one point on one vehicle''s route graph (breakout, clip, grommet, bulkhead, device, splice, ground, landmark). VEC TopologyNode. vehicle_harness_landmarks rows are the branches between these points.';
COMMENT ON COLUMN public.harness_topology_nodes.vehicle_id IS 'The vehicle this route graph belongs to.';
COMMENT ON COLUMN public.harness_topology_nodes.node_code IS 'Stable key within the vehicle; unique among live rows.';
COMMENT ON COLUMN public.harness_topology_nodes.kind IS 'What the point is: breakout, clip, grommet, bulkhead, device, splice, ground, landmark.';
COMMENT ON COLUMN public.harness_topology_nodes.pos_x_m IS 'Position in metres in the vehicle frame (x).';
COMMENT ON COLUMN public.harness_topology_nodes.pos_y_m IS 'Position in metres in the vehicle frame (y).';
COMMENT ON COLUMN public.harness_topology_nodes.pos_z_m IS 'Position in metres in the vehicle frame (z).';
COMMENT ON COLUMN public.harness_topology_nodes.pos_source IS 'Where the position came from: twin object, tape measurement, drawing.';
COMMENT ON COLUMN public.harness_topology_nodes.source IS 'The evidence this row rests on.';
COMMENT ON COLUMN public.harness_topology_nodes.method IS 'How the row was produced.';
COMMENT ON COLUMN public.harness_topology_nodes.observed_at IS 'Event time.';
COMMENT ON COLUMN public.harness_topology_nodes.trust IS 'Trust tier of the source.';
COMMENT ON COLUMN public.harness_topology_nodes.is_superseded IS 'True once a later row replaced this one.';
COMMENT ON COLUMN public.harness_topology_nodes.superseded_by IS 'The row that replaced this one.';
COMMENT ON COLUMN public.harness_topology_nodes.created_at IS 'Ingest time.';

COMMENT ON TABLE public.harness_routings IS 'Grain: one segment''s passage along one topology branch (vehicle_harness_landmarks row), in order. VEC Routing. A segment''s routed length is the sum of its branches.';
COMMENT ON COLUMN public.harness_routings.segment_id IS 'The wire being routed.';
COMMENT ON COLUMN public.harness_routings.landmark_id IS 'The topology branch it passes along.';
COMMENT ON COLUMN public.harness_routings.seq IS 'Order of this branch along the wire, from its from-end, starting at 1.';
COMMENT ON COLUMN public.harness_routings.source IS 'The evidence this row rests on.';
COMMENT ON COLUMN public.harness_routings.observed_at IS 'Event time.';
COMMENT ON COLUMN public.harness_routings.trust IS 'Trust tier of the source.';
COMMENT ON COLUMN public.harness_routings.is_superseded IS 'True once a later row replaced this one.';
COMMENT ON COLUMN public.harness_routings.superseded_by IS 'The row that replaced this one.';
COMMENT ON COLUMN public.harness_routings.created_at IS 'Ingest time.';

COMMENT ON COLUMN public.vehicle_harness_landmarks.from_node_id IS 'Topology branch start (harness_topology_nodes).';
COMMENT ON COLUMN public.vehicle_harness_landmarks.to_node_id IS 'Topology branch end (harness_topology_nodes).';
COMMENT ON COLUMN public.harness_endpoints.mates_with_endpoint_id IS 'The connector half this one mates with (VEC Mating), e.g. the 61-pin cabin half with its engine half.';
COMMENT ON COLUMN public.wiring_decision_links.segment_id IS 'A wire this decision or option includes (variant membership at segment grain).';
COMMENT ON COLUMN public.wiring_decision_links.termination_id IS 'A wire end this decision or option includes (variant membership at wire-end grain).';
COMMENT ON COLUMN public.connector_cavity_layouts.housing_part_id IS 'The connector housing part these cavities belong to (catalog_parts); replaces the connector_model text as the key.';
COMMENT ON COLUMN public.wire_termination_specs.cavity_layout_id IS 'The cavity this wire end occupies, as a key into connector_cavity_layouts (VEC CavityReference).';

COMMENT ON COLUMN public.harness_signals.id IS 'Row key.';
COMMENT ON COLUMN public.harness_nets.id IS 'Row key.';
COMMENT ON COLUMN public.harness_segments.id IS 'Row key.';
COMMENT ON COLUMN public.harness_topology_nodes.id IS 'Row key.';
COMMENT ON COLUMN public.harness_routings.id IS 'Row key.';

-- 9. This migration's own result.
DO $check$
DECLARE missing int;
BEGIN
  SELECT count(*) INTO missing
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name IN ('harness_signals', 'harness_nets', 'harness_segments', 'harness_topology_nodes', 'harness_routings')
    AND col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position) IS NULL;
  IF missing > 0 THEN RAISE EXCEPTION '% new columns are undescribed', missing; END IF;
  IF has_table_privilege('anon', 'public.harness_segments', 'INSERT')
     OR NOT has_table_privilege('anon', 'public.harness_segments', 'SELECT') THEN
    RAISE EXCEPTION 'harness grants did not land as written';
  END IF;
END $check$;

COMMIT;
