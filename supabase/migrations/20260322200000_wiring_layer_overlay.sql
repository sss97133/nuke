-- =============================================================================
-- WIRING LAYER OVERLAY SYSTEM
-- =============================================================================
-- The squarebody wiring layer overlay: factory harness mapped at circuit-level
-- resolution with upgrade templates (Motec M150+PDM30, AAW, etc.) as deltas.
--
-- Architecture: 3 layers
--   Layer 0: Factory harness library (per-generation reference data)
--   Layer 1: Upgrade templates (shop intelligence as deltas from factory)
--   Layer 2: Vehicle overlay (per-vehicle customization + measurements)
--
-- This replaces the never-created canvas-based builder tables
-- (harness_designs, harness_sections, harness_endpoints, wiring_connections).
-- =============================================================================

-- ============================================
-- LIBRARY: Wire specifications reference
-- ============================================
CREATE TABLE IF NOT EXISTS wire_specifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wire_type text NOT NULL,
  display_name text NOT NULL,

  insulation_material text,
  temperature_rating_c int,
  voltage_rating_v int,
  conductor_plating text,
  wall_thickness_in numeric,

  tier text NOT NULL,
  mil_spec_reference text,
  typical_cost_per_ft numeric,

  chemical_resistance text[],
  notes text,

  created_at timestamptz DEFAULT now(),
  UNIQUE (wire_type)
);

COMMENT ON TABLE wire_specifications IS 'Reference library of wire insulation types from consumer GPT to MIL-W-22759/44 aerospace grade. Owned by wiring-layer-overlay system.';

-- ============================================
-- LIBRARY: Connector specifications reference
-- ============================================
CREATE TABLE IF NOT EXISTS connector_specifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_family text NOT NULL,
  display_name text NOT NULL,

  shell_material text,
  contact_material text,
  contact_sizes text[],
  available_pin_counts int[],

  sealing_type text,
  ip_rating text,
  temperature_range text,
  vibration_rating text,
  mating_cycles int,

  tier text NOT NULL,
  typical_cost_range text,
  crimp_tooling text,

  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (connector_family)
);

COMMENT ON TABLE connector_specifications IS 'Reference library of automotive/motorsport connector families. Deutsch DT through Autosport AS. Owned by wiring-layer-overlay system.';

-- ============================================
-- LIBRARY: Device pin maps (Motec, PDM, displays)
-- ============================================
CREATE TABLE IF NOT EXISTS device_pin_maps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_family text NOT NULL,
  device_model text NOT NULL,
  firmware_version text,

  connector_name text NOT NULL,
  connector_type text NOT NULL,
  pin_count int NOT NULL,

  pin_number text NOT NULL,
  pin_function text NOT NULL,
  signal_type text,
  max_current_amps numeric,
  default_wire_color text,
  default_wire_gauge_awg int,
  requires_shielding boolean DEFAULT false,
  requires_twisted_pair boolean DEFAULT false,

  typical_connection text,
  notes text,

  source_document text,
  created_at timestamptz DEFAULT now(),

  UNIQUE (device_model, connector_name, pin_number, COALESCE(firmware_version, '__default__'))
);

COMMENT ON TABLE device_pin_maps IS 'Complete pin maps for ECUs (Motec M150, M1), PDMs (PDM30, PDM15), displays (C125, C127). Every pin with function, signal type, wire spec. Owned by wiring-layer-overlay system.';

CREATE INDEX idx_device_pin_maps_model ON device_pin_maps (device_model);
CREATE INDEX idx_device_pin_maps_family ON device_pin_maps (device_family);

-- ============================================
-- LIBRARY: Factory harness circuits
-- ============================================
CREATE TABLE IF NOT EXISTS factory_harness_circuits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generation text NOT NULL,
  year_range int4range,
  model_applicability text[],
  option_dependency text,

  circuit_code text NOT NULL,
  circuit_name text NOT NULL,
  system_category text NOT NULL,

  wire_color_gm text NOT NULL,
  wire_color_stripe text,
  wire_color_description text,
  wire_gauge_awg int NOT NULL,
  wire_type text DEFAULT 'GPT',

  from_component text NOT NULL,
  from_connector text,
  from_pin text,
  from_location_zone text NOT NULL,

  to_component text NOT NULL,
  to_connector text,
  to_pin text,
  to_location_zone text NOT NULL,

  fuse_position text,
  fuse_rating_amps numeric,
  fuse_type text,

  routing_description text,
  passes_through_bulkhead boolean DEFAULT false,
  bulkhead_pin text,
  length_typical_ft numeric,

  known_failure_modes text[],
  failure_severity text,
  failure_notes text,

  source_document text,
  source_page text,
  notes text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE (generation, circuit_code, COALESCE(option_dependency, '__standard__'))
);

COMMENT ON TABLE factory_harness_circuits IS 'Every circuit in a factory wiring harness, per vehicle generation. Squarebody (1973-1987 C/K) is first generation mapped. GM wire colors, routing, fuse positions, known failure modes. Owned by wiring-layer-overlay system.';

CREATE INDEX idx_factory_circuits_generation ON factory_harness_circuits (generation);
CREATE INDEX idx_factory_circuits_system ON factory_harness_circuits (system_category);

-- ============================================
-- LIBRARY: Upgrade templates
-- ============================================
CREATE TABLE IF NOT EXISTS upgrade_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text,

  applicable_generations text[] NOT NULL,
  applicable_models text[],

  upgrade_category text NOT NULL,
  platform text,

  wiring_tier text NOT NULL
    CHECK (wiring_tier IN ('consumer','enthusiast','professional','ultra')),
  wire_spec text,
  connector_standard text,
  sheathing_spec text,
  construction_method text,

  estimated_hours_min numeric,
  estimated_hours_max numeric,
  estimated_parts_cost_min numeric,
  estimated_parts_cost_max numeric,
  difficulty_level int CHECK (difficulty_level BETWEEN 1 AND 10),

  prerequisite_slugs text[],
  conflicts_with_slugs text[],
  replaces_slugs text[],

  source_references text[],
  notes text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE upgrade_templates IS 'Upgrade templates as deltas from factory base. Each template defines which factory circuits to keep/remove/modify and what new circuits to add. Encodes shop-level implicit knowledge (e.g., Motec dealer knows M150 pin assignments). Owned by wiring-layer-overlay system.';

-- ============================================
-- LIBRARY: Upgrade circuit actions (what a template does to factory circuits)
-- ============================================
CREATE TABLE IF NOT EXISTS upgrade_circuit_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upgrade_template_id uuid NOT NULL REFERENCES upgrade_templates(id) ON DELETE CASCADE,
  factory_circuit_id uuid NOT NULL REFERENCES factory_harness_circuits(id),

  action text NOT NULL CHECK (action IN ('keep','remove','modify','replace')),
  modification_notes text,
  replacement_circuit_id uuid,

  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE upgrade_circuit_actions IS 'Maps each upgrade template to factory circuits it affects. Action: keep (unchanged), remove (deleted), modify (changed specs), replace (swapped with upgrade_new_circuits entry). Owned by wiring-layer-overlay system.';

CREATE INDEX idx_upgrade_actions_template ON upgrade_circuit_actions (upgrade_template_id);
CREATE INDEX idx_upgrade_actions_factory ON upgrade_circuit_actions (factory_circuit_id);

-- ============================================
-- LIBRARY: New circuits added by an upgrade
-- ============================================
CREATE TABLE IF NOT EXISTS upgrade_new_circuits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upgrade_template_id uuid NOT NULL REFERENCES upgrade_templates(id) ON DELETE CASCADE,

  circuit_code text NOT NULL,
  circuit_name text NOT NULL,
  system_category text NOT NULL,

  wire_color text,
  wire_gauge_awg int,
  wire_type text,
  is_shielded boolean DEFAULT false,
  is_twisted_pair boolean DEFAULT false,

  from_component text NOT NULL,
  from_connector text,
  from_pin text,
  from_location_zone text,
  to_component text NOT NULL,
  to_connector text,
  to_pin text,
  to_location_zone text,

  fuse_type text,
  fuse_rating_amps numeric,
  pdm_channel text,

  device_name text,
  device_connector text,
  device_pin text,
  signal_type text,
  max_current_amps numeric,

  routing_description text,
  passes_through_bulkhead boolean DEFAULT false,
  length_typical_ft numeric,

  notes text,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE upgrade_new_circuits IS 'New circuits introduced by upgrade templates. For Motec/PDM templates, includes device-level pin mapping (device_name, device_connector, device_pin, signal_type). Owned by wiring-layer-overlay system.';

CREATE INDEX idx_upgrade_circuits_template ON upgrade_new_circuits (upgrade_template_id);

-- ============================================
-- VEHICLE: Per-vehicle custom circuits
-- (must be created before vehicle_circuit_measurements due to FK)
-- ============================================
CREATE TABLE IF NOT EXISTS vehicle_custom_circuits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  overlay_id uuid NOT NULL, -- FK added after vehicle_wiring_overlays created

  circuit_code text NOT NULL,
  circuit_name text NOT NULL,
  system_category text NOT NULL,

  wire_color text,
  wire_gauge_awg int,
  wire_type text,
  is_shielded boolean DEFAULT false,

  from_component text NOT NULL,
  from_connector text,
  from_pin text,
  from_location_zone text,
  to_component text NOT NULL,
  to_connector text,
  to_pin text,
  to_location_zone text,

  fuse_type text,
  fuse_rating_amps numeric,

  measured_length_ft numeric,
  routing_description text,

  notes text,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE vehicle_custom_circuits IS 'Custom circuits specific to a vehicle build, not from any template. Winch wiring, auxiliary lights, one-off accessories. Owned by wiring-layer-overlay system.';

-- ============================================
-- VEHICLE: Per-vehicle wiring overlay
-- ============================================
CREATE TABLE IF NOT EXISTS vehicle_wiring_overlays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),

  factory_generation text NOT NULL,
  wiring_tier text,

  status text NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning','measuring','ordering','building','installed','verified','archived')),

  applied_upgrade_ids uuid[] DEFAULT '{}',

  total_circuits int,
  total_wire_length_ft numeric,
  estimated_cost_min numeric,
  estimated_cost_max numeric,
  estimated_hours numeric,

  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE (vehicle_id)
);

COMMENT ON TABLE vehicle_wiring_overlays IS 'Per-vehicle wiring overlay combining factory base + applied upgrade templates + custom circuits. One overlay per vehicle. The wiring component of the digital twin. Owned by wiring-layer-overlay system.';

-- Add FK from vehicle_custom_circuits to vehicle_wiring_overlays
ALTER TABLE vehicle_custom_circuits
  ADD CONSTRAINT fk_custom_circuits_overlay
  FOREIGN KEY (overlay_id) REFERENCES vehicle_wiring_overlays(id) ON DELETE CASCADE;

CREATE INDEX idx_custom_circuits_overlay ON vehicle_custom_circuits (overlay_id);

-- ============================================
-- VEHICLE: Per-circuit measurements on THIS vehicle
-- ============================================
CREATE TABLE IF NOT EXISTS vehicle_circuit_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  overlay_id uuid NOT NULL REFERENCES vehicle_wiring_overlays(id) ON DELETE CASCADE,

  factory_circuit_id uuid REFERENCES factory_harness_circuits(id),
  upgrade_circuit_id uuid REFERENCES upgrade_new_circuits(id),
  custom_circuit_id uuid REFERENCES vehicle_custom_circuits(id),

  measured_length_ft numeric NOT NULL,
  measurement_method text,
  routing_notes text,
  deviation_notes text,

  measured_by text,
  measured_at timestamptz DEFAULT now(),

  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE vehicle_circuit_measurements IS 'Physical wire run measurements taken on a specific vehicle. Overrides typical_length_ft from templates. Captures deviations (e.g., headers require +8 inches on O2 sensor wire). Owned by wiring-layer-overlay system.';

CREATE INDEX idx_measurements_overlay ON vehicle_circuit_measurements (overlay_id);

-- ============================================
-- Enable RLS on all tables
-- ============================================
ALTER TABLE wire_specifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_specifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_pin_maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE factory_harness_circuits ENABLE ROW LEVEL SECURITY;
ALTER TABLE upgrade_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE upgrade_circuit_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE upgrade_new_circuits ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_wiring_overlays ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_circuit_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_custom_circuits ENABLE ROW LEVEL SECURITY;

-- Library tables: public read, service role write
CREATE POLICY "Public read wire_specifications" ON wire_specifications FOR SELECT USING (true);
CREATE POLICY "Public read connector_specifications" ON connector_specifications FOR SELECT USING (true);
CREATE POLICY "Public read device_pin_maps" ON device_pin_maps FOR SELECT USING (true);
CREATE POLICY "Public read factory_harness_circuits" ON factory_harness_circuits FOR SELECT USING (true);
CREATE POLICY "Public read upgrade_templates" ON upgrade_templates FOR SELECT USING (true);
CREATE POLICY "Public read upgrade_circuit_actions" ON upgrade_circuit_actions FOR SELECT USING (true);
CREATE POLICY "Public read upgrade_new_circuits" ON upgrade_new_circuits FOR SELECT USING (true);

-- Vehicle tables: authenticated users can read/write their own overlays
CREATE POLICY "Public read vehicle_wiring_overlays" ON vehicle_wiring_overlays FOR SELECT USING (true);
CREATE POLICY "Public read vehicle_circuit_measurements" ON vehicle_circuit_measurements FOR SELECT USING (true);
CREATE POLICY "Public read vehicle_custom_circuits" ON vehicle_custom_circuits FOR SELECT USING (true);

-- Service role bypass for all tables (edge functions need full access)
CREATE POLICY "Service role full access wire_specifications" ON wire_specifications FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access connector_specifications" ON connector_specifications FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access device_pin_maps" ON device_pin_maps FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access factory_harness_circuits" ON factory_harness_circuits FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access upgrade_templates" ON upgrade_templates FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access upgrade_circuit_actions" ON upgrade_circuit_actions FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access upgrade_new_circuits" ON upgrade_new_circuits FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access vehicle_wiring_overlays" ON vehicle_wiring_overlays FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access vehicle_circuit_measurements" ON vehicle_circuit_measurements FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access vehicle_custom_circuits" ON vehicle_custom_circuits FOR ALL USING (auth.role() = 'service_role');
