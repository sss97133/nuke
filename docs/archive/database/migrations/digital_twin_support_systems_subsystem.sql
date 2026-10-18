-- ============================================================
-- DIGITAL TWIN: Support Systems Subsystem DDL
-- Covers: Exhaust, Fuel, Cooling, Safety & Emissions
--
-- Architecture:
--   Follows the reference implementation established in
--   digital_twin_engine_subsystem.sql. Every component gets
--   a spec table with factory specification, condition grade,
--   provenance, and originality tracking. Work events are
--   logged via the shared component_events table referencing
--   actors.
--
-- Dependencies:
--   - vehicles(id)
--   - actors(id)           (from engine subsystem migration)
--   - component_events     (from engine subsystem migration)
--   - engine_exhaust_manifolds (from engine subsystem — manifold end)
--   - engine_cooling_interfaces (from engine subsystem — water pump/thermostat end)
--   - engine_carburetors / engine_fuel_injection (from engine subsystem)
--
-- Pattern: DO NOT recreate actors or component_events.
-- ============================================================

BEGIN;


-- ============================================================
-- ============================================================
--  SUBSYSTEM 1: EXHAUST SYSTEM
--  Everything AFTER the exhaust manifold / header collector.
-- ============================================================
-- ============================================================


-- ============================================================
-- 1. EXHAUST_PIPES — per-section pipe specs
-- ============================================================

CREATE TABLE exhaust_pipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Section identification
  section TEXT NOT NULL,
  side TEXT,

  -- Specifications
  diameter_inches NUMERIC(4,2),
  material TEXT,
  wall_thickness_inches NUMERIC(4,3),
  bend_type TEXT,
  length_inches NUMERIC(6,1),
  manufacturer TEXT,
  part_number TEXT,
  coating TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE exhaust_pipes ADD CONSTRAINT chk_exp_section
  CHECK (section IN (
    'header_collector', 'y_pipe', 'h_pipe', 'x_pipe', 'cat_pipe',
    'intermediate', 'over_axle', 'tailpipe'
  ));
ALTER TABLE exhaust_pipes ADD CONSTRAINT chk_exp_side
  CHECK (side IS NULL OR side IN ('left', 'right', 'center', 'single'));
ALTER TABLE exhaust_pipes ADD CONSTRAINT chk_exp_material
  CHECK (material IS NULL OR material IN ('mild_steel', 'stainless', 'aluminized', 'titanium', 'other'));
ALTER TABLE exhaust_pipes ADD CONSTRAINT chk_exp_bend
  CHECK (bend_type IS NULL OR bend_type IN ('mandrel', 'crush', 'straight', 'other'));
ALTER TABLE exhaust_pipes ADD CONSTRAINT chk_exp_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE exhaust_pipes ADD CONSTRAINT chk_exp_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_exhaust_pipes_vehicle ON exhaust_pipes(vehicle_id);

COMMENT ON TABLE exhaust_pipes IS 'Per-section exhaust pipe specifications. One row per pipe section (e.g. y_pipe, intermediate, tailpipe). Covers everything downstream of engine_exhaust_manifolds.';
COMMENT ON COLUMN exhaust_pipes.id IS 'Primary key.';
COMMENT ON COLUMN exhaust_pipes.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN exhaust_pipes.section IS 'Pipe section: header_collector, y_pipe, h_pipe, x_pipe, cat_pipe, intermediate, over_axle, tailpipe.';
COMMENT ON COLUMN exhaust_pipes.side IS 'Which side: left, right, center, single (for single exhaust).';
COMMENT ON COLUMN exhaust_pipes.diameter_inches IS 'Pipe outer diameter in inches, e.g. 2.50.';
COMMENT ON COLUMN exhaust_pipes.material IS 'Pipe material: mild_steel, stainless, aluminized, titanium, other.';
COMMENT ON COLUMN exhaust_pipes.wall_thickness_inches IS 'Pipe wall thickness in inches.';
COMMENT ON COLUMN exhaust_pipes.bend_type IS 'How bends were formed: mandrel, crush, straight, other.';
COMMENT ON COLUMN exhaust_pipes.length_inches IS 'Section length in inches.';
COMMENT ON COLUMN exhaust_pipes.manufacturer IS 'Pipe or exhaust system manufacturer, e.g. Flowmaster, Magnaflow.';
COMMENT ON COLUMN exhaust_pipes.part_number IS 'Manufacturer part number for this section.';
COMMENT ON COLUMN exhaust_pipes.coating IS 'Applied coating, e.g. ceramic, high_temp_paint, raw.';
COMMENT ON COLUMN exhaust_pipes.is_original IS 'True if factory-installed exhaust pipe.';
COMMENT ON COLUMN exhaust_pipes.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN exhaust_pipes.condition_notes IS 'Freeform condition details, e.g. surface rust at weld joints.';
COMMENT ON COLUMN exhaust_pipes.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN exhaust_pipes.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN exhaust_pipes.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN exhaust_pipes.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 2. CATALYTIC_CONVERTERS
-- ============================================================

CREATE TABLE catalytic_converters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Position
  position TEXT,
  side TEXT,

  -- Specifications
  converter_count INTEGER DEFAULT 1,
  converter_type TEXT,
  substrate TEXT,
  oem_yn BOOLEAN,
  cat_delete_yn BOOLEAN DEFAULT FALSE,
  part_number TEXT,
  manufacturer TEXT,
  inlet_diameter_inches NUMERIC(4,2),
  outlet_diameter_inches NUMERIC(4,2),

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE catalytic_converters ADD CONSTRAINT chk_cat_type
  CHECK (converter_type IS NULL OR converter_type IN ('two_way', 'three_way', 'three_way_heated', 'pre_cat', 'test_pipe', 'other'));
ALTER TABLE catalytic_converters ADD CONSTRAINT chk_cat_substrate
  CHECK (substrate IS NULL OR substrate IN ('ceramic', 'metallic', 'other'));
ALTER TABLE catalytic_converters ADD CONSTRAINT chk_cat_position
  CHECK (position IS NULL OR position IN ('pre_cat', 'main', 'rear', 'underfloor', 'close_coupled'));
ALTER TABLE catalytic_converters ADD CONSTRAINT chk_cat_side
  CHECK (side IS NULL OR side IN ('left', 'right', 'center', 'single'));
ALTER TABLE catalytic_converters ADD CONSTRAINT chk_cat_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE catalytic_converters ADD CONSTRAINT chk_cat_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_catalytic_converters_vehicle ON catalytic_converters(vehicle_id);

COMMENT ON TABLE catalytic_converters IS 'Catalytic converter specifications and condition. One row per converter installed.';
COMMENT ON COLUMN catalytic_converters.id IS 'Primary key.';
COMMENT ON COLUMN catalytic_converters.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN catalytic_converters.position IS 'Converter position: pre_cat, main, rear, underfloor, close_coupled.';
COMMENT ON COLUMN catalytic_converters.side IS 'Which side: left, right, center, single.';
COMMENT ON COLUMN catalytic_converters.converter_count IS 'Number of converters at this position (usually 1).';
COMMENT ON COLUMN catalytic_converters.converter_type IS 'Converter chemistry: two_way, three_way, three_way_heated, pre_cat, test_pipe, other.';
COMMENT ON COLUMN catalytic_converters.substrate IS 'Internal substrate: ceramic, metallic, other.';
COMMENT ON COLUMN catalytic_converters.oem_yn IS 'True if this is an OEM (factory-supplied) converter.';
COMMENT ON COLUMN catalytic_converters.cat_delete_yn IS 'True if converter has been removed and replaced with a test pipe.';
COMMENT ON COLUMN catalytic_converters.part_number IS 'Converter part number.';
COMMENT ON COLUMN catalytic_converters.manufacturer IS 'Converter manufacturer, e.g. Magnaflow, Eastern, Walker.';
COMMENT ON COLUMN catalytic_converters.inlet_diameter_inches IS 'Inlet pipe diameter in inches.';
COMMENT ON COLUMN catalytic_converters.outlet_diameter_inches IS 'Outlet pipe diameter in inches.';
COMMENT ON COLUMN catalytic_converters.is_original IS 'True if factory-installed catalytic converter.';
COMMENT ON COLUMN catalytic_converters.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN catalytic_converters.condition_notes IS 'Freeform condition details, e.g. rattle indicates substrate failure.';
COMMENT ON COLUMN catalytic_converters.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN catalytic_converters.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN catalytic_converters.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN catalytic_converters.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 3. MUFFLERS
-- ============================================================

CREATE TABLE mufflers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Position
  position TEXT,
  side TEXT,

  -- Specifications
  manufacturer TEXT,
  part_number TEXT,
  muffler_type TEXT,
  inlet_diameter_inches NUMERIC(4,2),
  outlet_diameter_inches NUMERIC(4,2),
  inlet_count INTEGER DEFAULT 1,
  outlet_count INTEGER DEFAULT 1,
  body_length_inches NUMERIC(5,1),
  body_width_inches NUMERIC(5,1),
  body_height_inches NUMERIC(5,1),
  material TEXT,
  internal_construction TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE mufflers ADD CONSTRAINT chk_muf_type
  CHECK (muffler_type IS NULL OR muffler_type IN (
    'chambered', 'turbo', 'straight_through', 'glasspack',
    'resonator', 'cherry_bomb', 'bullet', 'other'
  ));
ALTER TABLE mufflers ADD CONSTRAINT chk_muf_position
  CHECK (position IS NULL OR position IN ('main', 'rear', 'resonator_front', 'resonator_rear'));
ALTER TABLE mufflers ADD CONSTRAINT chk_muf_side
  CHECK (side IS NULL OR side IN ('left', 'right', 'center', 'single'));
ALTER TABLE mufflers ADD CONSTRAINT chk_muf_material
  CHECK (material IS NULL OR material IN ('mild_steel', 'stainless', 'aluminized', 'titanium', 'other'));
ALTER TABLE mufflers ADD CONSTRAINT chk_muf_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE mufflers ADD CONSTRAINT chk_muf_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_mufflers_vehicle ON mufflers(vehicle_id);

COMMENT ON TABLE mufflers IS 'Muffler and resonator specifications. One row per muffler/resonator installed.';
COMMENT ON COLUMN mufflers.id IS 'Primary key.';
COMMENT ON COLUMN mufflers.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN mufflers.position IS 'Muffler position: main, rear, resonator_front, resonator_rear.';
COMMENT ON COLUMN mufflers.side IS 'Which side: left, right, center, single.';
COMMENT ON COLUMN mufflers.manufacturer IS 'Muffler manufacturer, e.g. Flowmaster, Magnaflow, Borla, Cherry Bomb.';
COMMENT ON COLUMN mufflers.part_number IS 'Manufacturer part number.';
COMMENT ON COLUMN mufflers.muffler_type IS 'Muffler design: chambered, turbo, straight_through, glasspack, resonator, cherry_bomb, bullet, other.';
COMMENT ON COLUMN mufflers.inlet_diameter_inches IS 'Inlet pipe diameter in inches.';
COMMENT ON COLUMN mufflers.outlet_diameter_inches IS 'Outlet pipe diameter in inches.';
COMMENT ON COLUMN mufflers.inlet_count IS 'Number of inlets (1 for single, 2 for dual-in).';
COMMENT ON COLUMN mufflers.outlet_count IS 'Number of outlets (1 for single, 2 for dual-out).';
COMMENT ON COLUMN mufflers.body_length_inches IS 'Muffler body length in inches.';
COMMENT ON COLUMN mufflers.body_width_inches IS 'Muffler body width in inches.';
COMMENT ON COLUMN mufflers.body_height_inches IS 'Muffler body height in inches (for oval bodies).';
COMMENT ON COLUMN mufflers.material IS 'Body material: mild_steel, stainless, aluminized, titanium, other.';
COMMENT ON COLUMN mufflers.internal_construction IS 'Internal design description, e.g. two_chamber, louvered_core, perforated_core.';
COMMENT ON COLUMN mufflers.is_original IS 'True if factory-installed muffler.';
COMMENT ON COLUMN mufflers.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN mufflers.condition_notes IS 'Freeform condition details, e.g. slight blow at inlet weld.';
COMMENT ON COLUMN mufflers.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN mufflers.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN mufflers.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN mufflers.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 4. EXHAUST_TIPS
-- ============================================================

CREATE TABLE exhaust_tips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Position
  side TEXT,
  position TEXT,

  -- Specifications
  tip_type TEXT,
  inlet_diameter_inches NUMERIC(4,2),
  outlet_diameter_inches NUMERIC(4,2),
  length_inches NUMERIC(5,1),
  material TEXT,
  finish TEXT,
  manufacturer TEXT,
  part_number TEXT,
  tip_count INTEGER DEFAULT 1,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE exhaust_tips ADD CONSTRAINT chk_etip_type
  CHECK (tip_type IS NULL OR tip_type IN (
    'turn_down', 'rolled', 'angle_cut', 'dual_wall',
    'slash_cut', 'intercooled', 'diffuser', 'stock', 'other'
  ));
ALTER TABLE exhaust_tips ADD CONSTRAINT chk_etip_side
  CHECK (side IS NULL OR side IN ('left', 'right', 'center', 'single'));
ALTER TABLE exhaust_tips ADD CONSTRAINT chk_etip_material
  CHECK (material IS NULL OR material IN ('chrome', 'stainless', 'carbon_fiber', 'black', 'titanium', 'other'));
ALTER TABLE exhaust_tips ADD CONSTRAINT chk_etip_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE exhaust_tips ADD CONSTRAINT chk_etip_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_exhaust_tips_vehicle ON exhaust_tips(vehicle_id);

COMMENT ON TABLE exhaust_tips IS 'Exhaust tip specifications and finish. One row per tip location.';
COMMENT ON COLUMN exhaust_tips.id IS 'Primary key.';
COMMENT ON COLUMN exhaust_tips.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN exhaust_tips.side IS 'Which side: left, right, center, single.';
COMMENT ON COLUMN exhaust_tips.position IS 'Tip exit position description, e.g. rear_bumper, side_exit, dumps.';
COMMENT ON COLUMN exhaust_tips.tip_type IS 'Tip style: turn_down, rolled, angle_cut, dual_wall, slash_cut, intercooled, diffuser, stock, other.';
COMMENT ON COLUMN exhaust_tips.inlet_diameter_inches IS 'Inlet diameter in inches (pipe it slides over).';
COMMENT ON COLUMN exhaust_tips.outlet_diameter_inches IS 'Outlet (visible) diameter in inches.';
COMMENT ON COLUMN exhaust_tips.length_inches IS 'Tip length in inches.';
COMMENT ON COLUMN exhaust_tips.material IS 'Tip material: chrome, stainless, carbon_fiber, black, titanium, other.';
COMMENT ON COLUMN exhaust_tips.finish IS 'Surface finish description, e.g. polished, brushed, powder_coated, burnt_blue.';
COMMENT ON COLUMN exhaust_tips.manufacturer IS 'Tip manufacturer.';
COMMENT ON COLUMN exhaust_tips.part_number IS 'Manufacturer part number.';
COMMENT ON COLUMN exhaust_tips.tip_count IS 'Number of tips at this location (e.g. 2 for quad tips per side).';
COMMENT ON COLUMN exhaust_tips.is_original IS 'True if factory-installed exhaust tip.';
COMMENT ON COLUMN exhaust_tips.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN exhaust_tips.condition_notes IS 'Freeform condition details, e.g. pitting on chrome, discolored.';
COMMENT ON COLUMN exhaust_tips.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN exhaust_tips.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN exhaust_tips.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN exhaust_tips.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- ============================================================
--  SUBSYSTEM 2: FUEL SYSTEM
--  Everything that delivers fuel BEFORE the engine.
--  (engine_carburetors and engine_fuel_injection already exist)
-- ============================================================
-- ============================================================


-- ============================================================
-- 5. FUEL_TANKS
-- ============================================================

CREATE TABLE fuel_tanks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Specifications
  capacity_gallons NUMERIC(5,1),
  material TEXT,
  location TEXT,
  sender_type TEXT,
  vent_type TEXT,
  baffled_yn BOOLEAN DEFAULT FALSE,
  filler_neck_location TEXT,
  filler_neck_material TEXT,
  fuel_pickup TEXT,
  anti_slosh_foam BOOLEAN DEFAULT FALSE,
  manufacturer TEXT,
  part_number TEXT,
  rust_grade TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE fuel_tanks ADD CONSTRAINT chk_ft_material
  CHECK (material IS NULL OR material IN ('steel', 'stainless', 'poly', 'aluminum', 'fiberglass', 'other'));
ALTER TABLE fuel_tanks ADD CONSTRAINT chk_ft_rust
  CHECK (rust_grade IS NULL OR rust_grade IN ('none', 'surface', 'moderate', 'severe', 'perforated'));
ALTER TABLE fuel_tanks ADD CONSTRAINT chk_ft_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE fuel_tanks ADD CONSTRAINT chk_ft_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_fuel_tanks_vehicle ON fuel_tanks(vehicle_id);

COMMENT ON TABLE fuel_tanks IS 'Fuel tank specifications and condition. One row per tank (some vehicles have dual tanks).';
COMMENT ON COLUMN fuel_tanks.id IS 'Primary key.';
COMMENT ON COLUMN fuel_tanks.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN fuel_tanks.capacity_gallons IS 'Fuel capacity in US gallons.';
COMMENT ON COLUMN fuel_tanks.material IS 'Tank material: steel, stainless, poly, aluminum, fiberglass, other.';
COMMENT ON COLUMN fuel_tanks.location IS 'Tank location description, e.g. in_cab_behind_seat, under_bed, rear_of_chassis, in_trunk.';
COMMENT ON COLUMN fuel_tanks.sender_type IS 'Fuel level sender type, e.g. arm_float, capacitive, resistive.';
COMMENT ON COLUMN fuel_tanks.vent_type IS 'Tank vent system, e.g. vented_cap, evap_canister, rollover_valve.';
COMMENT ON COLUMN fuel_tanks.baffled_yn IS 'True if tank has internal baffles to reduce slosh.';
COMMENT ON COLUMN fuel_tanks.filler_neck_location IS 'Filler neck location, e.g. left_rear_quarter, right_rear_quarter, behind_license_plate.';
COMMENT ON COLUMN fuel_tanks.filler_neck_material IS 'Filler neck material, e.g. steel, rubber_flex, stainless.';
COMMENT ON COLUMN fuel_tanks.fuel_pickup IS 'Fuel pickup type, e.g. single_pickup, dual_pickup, sump.';
COMMENT ON COLUMN fuel_tanks.anti_slosh_foam IS 'True if anti-slosh foam is installed inside the tank.';
COMMENT ON COLUMN fuel_tanks.manufacturer IS 'Tank manufacturer, e.g. OEM, Tanks Inc, Spectra Premium.';
COMMENT ON COLUMN fuel_tanks.part_number IS 'Tank part number.';
COMMENT ON COLUMN fuel_tanks.rust_grade IS 'Interior rust condition: none, surface, moderate, severe, perforated.';
COMMENT ON COLUMN fuel_tanks.is_original IS 'True if factory-installed fuel tank.';
COMMENT ON COLUMN fuel_tanks.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN fuel_tanks.condition_notes IS 'Freeform condition details, e.g. seam seepage at rear.';
COMMENT ON COLUMN fuel_tanks.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN fuel_tanks.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN fuel_tanks.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN fuel_tanks.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 6. FUEL_PUMPS
-- ============================================================

CREATE TABLE fuel_pumps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Specifications
  pump_type TEXT,
  manufacturer TEXT,
  part_number TEXT,
  flow_gph NUMERIC(6,1),
  pressure_psi NUMERIC(5,1),
  regulator_yn BOOLEAN DEFAULT FALSE,
  regulator_type TEXT,
  regulator_pressure_psi NUMERIC(5,1),
  fuel_pump_relay_yn BOOLEAN,
  mounting_location TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE fuel_pumps ADD CONSTRAINT chk_fp_type
  CHECK (pump_type IS NULL OR pump_type IN (
    'mechanical', 'electric_inline', 'electric_in_tank',
    'electric_external', 'high_pressure_efi', 'other'
  ));
ALTER TABLE fuel_pumps ADD CONSTRAINT chk_fp_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE fuel_pumps ADD CONSTRAINT chk_fp_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_fuel_pumps_vehicle ON fuel_pumps(vehicle_id);

COMMENT ON TABLE fuel_pumps IS 'Fuel pump specifications. One row per pump (some systems have multiple pumps).';
COMMENT ON COLUMN fuel_pumps.id IS 'Primary key.';
COMMENT ON COLUMN fuel_pumps.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN fuel_pumps.pump_type IS 'Pump type: mechanical, electric_inline, electric_in_tank, electric_external, high_pressure_efi, other.';
COMMENT ON COLUMN fuel_pumps.manufacturer IS 'Pump manufacturer, e.g. AC Delco, Carter, Walbro, Holley, Aeromotive.';
COMMENT ON COLUMN fuel_pumps.part_number IS 'Pump part number.';
COMMENT ON COLUMN fuel_pumps.flow_gph IS 'Maximum fuel flow in gallons per hour.';
COMMENT ON COLUMN fuel_pumps.pressure_psi IS 'Output pressure in PSI at rated flow.';
COMMENT ON COLUMN fuel_pumps.regulator_yn IS 'True if a fuel pressure regulator is installed.';
COMMENT ON COLUMN fuel_pumps.regulator_type IS 'Regulator type, e.g. bypass, deadhead, return_style.';
COMMENT ON COLUMN fuel_pumps.regulator_pressure_psi IS 'Regulated fuel pressure in PSI.';
COMMENT ON COLUMN fuel_pumps.fuel_pump_relay_yn IS 'True if pump is relay-controlled (vs direct key-on power).';
COMMENT ON COLUMN fuel_pumps.mounting_location IS 'Where the pump is mounted, e.g. engine_block, frame_rail, in_tank, trunk.';
COMMENT ON COLUMN fuel_pumps.is_original IS 'True if factory-installed fuel pump.';
COMMENT ON COLUMN fuel_pumps.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN fuel_pumps.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN fuel_pumps.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN fuel_pumps.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN fuel_pumps.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN fuel_pumps.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 7. FUEL_LINES
-- ============================================================

CREATE TABLE fuel_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Specifications
  segment TEXT,
  material TEXT,
  diameter_inches NUMERIC(4,3),
  fitting_type TEXT,
  routing TEXT,
  return_line_yn BOOLEAN DEFAULT FALSE,
  manufacturer TEXT,
  part_number TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE fuel_lines ADD CONSTRAINT chk_fl_material
  CHECK (material IS NULL OR material IN ('steel', 'stainless_braided', 'nylon', 'rubber', 'ptfe', 'other'));
ALTER TABLE fuel_lines ADD CONSTRAINT chk_fl_segment
  CHECK (segment IS NULL OR segment IN (
    'tank_to_pump', 'pump_to_filter', 'filter_to_carb',
    'filter_to_rail', 'return', 'crossover', 'vent', 'other'
  ));
ALTER TABLE fuel_lines ADD CONSTRAINT chk_fl_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE fuel_lines ADD CONSTRAINT chk_fl_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_fuel_lines_vehicle ON fuel_lines(vehicle_id);

COMMENT ON TABLE fuel_lines IS 'Fuel line specifications per segment. One row per line segment.';
COMMENT ON COLUMN fuel_lines.id IS 'Primary key.';
COMMENT ON COLUMN fuel_lines.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN fuel_lines.segment IS 'Line segment: tank_to_pump, pump_to_filter, filter_to_carb, filter_to_rail, return, crossover, vent, other.';
COMMENT ON COLUMN fuel_lines.material IS 'Line material: steel, stainless_braided, nylon, rubber, ptfe, other.';
COMMENT ON COLUMN fuel_lines.diameter_inches IS 'Line inner diameter in inches, e.g. 0.375 for 3/8.';
COMMENT ON COLUMN fuel_lines.fitting_type IS 'Fitting type, e.g. compression, an_fitting, barb, push_lock, flare.';
COMMENT ON COLUMN fuel_lines.routing IS 'Line routing description, e.g. along_frame_rail, through_tunnel.';
COMMENT ON COLUMN fuel_lines.return_line_yn IS 'True if this is a fuel return line.';
COMMENT ON COLUMN fuel_lines.manufacturer IS 'Line or fitting manufacturer.';
COMMENT ON COLUMN fuel_lines.part_number IS 'Part number.';
COMMENT ON COLUMN fuel_lines.is_original IS 'True if factory-installed fuel line.';
COMMENT ON COLUMN fuel_lines.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN fuel_lines.condition_notes IS 'Freeform condition details, e.g. kink at frame crossmember.';
COMMENT ON COLUMN fuel_lines.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN fuel_lines.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN fuel_lines.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN fuel_lines.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 8. FUEL_FILTERS
-- ============================================================

CREATE TABLE fuel_filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Specifications
  filter_type TEXT,
  location TEXT,
  manufacturer TEXT,
  part_number TEXT,
  micron_rating INTEGER,
  element_material TEXT,
  mounting_type TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE fuel_filters ADD CONSTRAINT chk_ff_type
  CHECK (filter_type IS NULL OR filter_type IN ('inline', 'canister', 'in_carb', 'in_tank_sock', 'high_flow', 'other'));
ALTER TABLE fuel_filters ADD CONSTRAINT chk_ff_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE fuel_filters ADD CONSTRAINT chk_ff_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE fuel_filters ADD CONSTRAINT chk_ff_micron
  CHECK (micron_rating IS NULL OR (micron_rating >= 1 AND micron_rating <= 1000));

CREATE INDEX idx_fuel_filters_vehicle ON fuel_filters(vehicle_id);

COMMENT ON TABLE fuel_filters IS 'Fuel filter specifications. One row per filter in the system.';
COMMENT ON COLUMN fuel_filters.id IS 'Primary key.';
COMMENT ON COLUMN fuel_filters.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN fuel_filters.filter_type IS 'Filter type: inline, canister, in_carb, in_tank_sock, high_flow, other.';
COMMENT ON COLUMN fuel_filters.location IS 'Filter location, e.g. carb_inlet, frame_rail, engine_bay, in_tank.';
COMMENT ON COLUMN fuel_filters.manufacturer IS 'Filter manufacturer, e.g. AC Delco, Wix, K&N.';
COMMENT ON COLUMN fuel_filters.part_number IS 'Filter part number.';
COMMENT ON COLUMN fuel_filters.micron_rating IS 'Filtration rating in microns, 1-1000.';
COMMENT ON COLUMN fuel_filters.element_material IS 'Filter element material, e.g. paper, sintered_bronze, stainless_mesh, nylon.';
COMMENT ON COLUMN fuel_filters.mounting_type IS 'How filter is mounted, e.g. hose_clamp, threaded, bracket, push_on.';
COMMENT ON COLUMN fuel_filters.is_original IS 'True if factory-type filter.';
COMMENT ON COLUMN fuel_filters.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN fuel_filters.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN fuel_filters.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN fuel_filters.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN fuel_filters.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN fuel_filters.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 9. FUEL_SYSTEM_ELECTRONICS — EFI sensors and controls
-- ============================================================

CREATE TABLE fuel_system_electronics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Fuel pressure sensing
  fuel_pressure_sensor_yn BOOLEAN DEFAULT FALSE,
  fuel_pressure_sensor_type TEXT,
  fuel_pressure_sensor_location TEXT,

  -- Fuel rail
  fuel_rail_pressure_psi NUMERIC(5,1),
  fuel_rail_material TEXT,
  fuel_rail_type TEXT,

  -- O2 sensing
  wideband_o2_yn BOOLEAN DEFAULT FALSE,
  wideband_o2_manufacturer TEXT,
  wideband_o2_part_number TEXT,
  narrowband_o2_count INTEGER DEFAULT 0,

  -- Flex fuel
  flex_fuel_sensor_yn BOOLEAN DEFAULT FALSE,
  flex_fuel_sensor_manufacturer TEXT,
  flex_fuel_ethanol_content_pct NUMERIC(4,1),

  -- ECU / Controller
  ecu_manufacturer TEXT,
  ecu_model TEXT,
  ecu_tune TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE fuel_system_electronics ADD CONSTRAINT chk_fse_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE fuel_system_electronics ADD CONSTRAINT chk_fse_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE fuel_system_electronics ADD CONSTRAINT chk_fse_rail_material
  CHECK (fuel_rail_material IS NULL OR fuel_rail_material IN ('aluminum', 'stainless', 'composite', 'other'));
ALTER TABLE fuel_system_electronics ADD CONSTRAINT chk_fse_ethanol
  CHECK (flex_fuel_ethanol_content_pct IS NULL OR (flex_fuel_ethanol_content_pct >= 0 AND flex_fuel_ethanol_content_pct <= 100));

CREATE INDEX idx_fuel_elec_vehicle ON fuel_system_electronics(vehicle_id);

COMMENT ON TABLE fuel_system_electronics IS 'EFI-specific fuel system electronics: sensors, fuel rail, O2, flex fuel, ECU. Applicable to fuel-injected vehicles or EFI conversions.';
COMMENT ON COLUMN fuel_system_electronics.id IS 'Primary key.';
COMMENT ON COLUMN fuel_system_electronics.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN fuel_system_electronics.fuel_pressure_sensor_yn IS 'True if fuel pressure sensor is installed.';
COMMENT ON COLUMN fuel_system_electronics.fuel_pressure_sensor_type IS 'Sensor type, e.g. gauge_sender, ecu_input, stand_alone.';
COMMENT ON COLUMN fuel_system_electronics.fuel_pressure_sensor_location IS 'Sensor location, e.g. fuel_rail, filter_outlet, return_line.';
COMMENT ON COLUMN fuel_system_electronics.fuel_rail_pressure_psi IS 'Operating fuel rail pressure in PSI.';
COMMENT ON COLUMN fuel_system_electronics.fuel_rail_material IS 'Fuel rail material: aluminum, stainless, composite, other.';
COMMENT ON COLUMN fuel_system_electronics.fuel_rail_type IS 'Fuel rail type, e.g. stock, billet, tube_style.';
COMMENT ON COLUMN fuel_system_electronics.wideband_o2_yn IS 'True if wideband O2 sensor is installed.';
COMMENT ON COLUMN fuel_system_electronics.wideband_o2_manufacturer IS 'Wideband O2 manufacturer, e.g. Innovate, AEM, PLX.';
COMMENT ON COLUMN fuel_system_electronics.wideband_o2_part_number IS 'Wideband O2 sensor part number.';
COMMENT ON COLUMN fuel_system_electronics.narrowband_o2_count IS 'Number of narrowband O2 sensors installed.';
COMMENT ON COLUMN fuel_system_electronics.flex_fuel_sensor_yn IS 'True if flex fuel (ethanol content) sensor is installed.';
COMMENT ON COLUMN fuel_system_electronics.flex_fuel_sensor_manufacturer IS 'Flex fuel sensor manufacturer.';
COMMENT ON COLUMN fuel_system_electronics.flex_fuel_ethanol_content_pct IS 'Current ethanol content reading, 0-100 percent.';
COMMENT ON COLUMN fuel_system_electronics.ecu_manufacturer IS 'Engine control unit manufacturer, e.g. GM, Holley, FAST, MegaSquirt.';
COMMENT ON COLUMN fuel_system_electronics.ecu_model IS 'ECU model, e.g. Terminator_X, Sniper, MS3.';
COMMENT ON COLUMN fuel_system_electronics.ecu_tune IS 'Current tune description or file reference.';
COMMENT ON COLUMN fuel_system_electronics.is_original IS 'True if factory-original EFI electronics.';
COMMENT ON COLUMN fuel_system_electronics.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN fuel_system_electronics.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN fuel_system_electronics.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN fuel_system_electronics.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN fuel_system_electronics.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN fuel_system_electronics.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- ============================================================
--  SUBSYSTEM 3: COOLING SYSTEM
--  The radiator circuit — everything outside the engine.
--  (engine_cooling_interfaces covers water pump/thermostat)
-- ============================================================
-- ============================================================


-- ============================================================
-- 10. RADIATORS
-- ============================================================

CREATE TABLE radiators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Specifications
  radiator_type TEXT,
  core_material TEXT,
  tank_material TEXT,
  rows INTEGER,
  tube_size TEXT,
  core_width_inches NUMERIC(5,1),
  core_height_inches NUMERIC(5,1),
  core_thickness_inches NUMERIC(4,1),
  capacity_quarts NUMERIC(4,1),
  cap_pressure_psi INTEGER,
  inlet_location TEXT,
  outlet_location TEXT,
  trans_cooler_built_in BOOLEAN DEFAULT FALSE,
  manufacturer TEXT,
  part_number TEXT,
  fin_density_fpi INTEGER,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE radiators ADD CONSTRAINT chk_rad_type
  CHECK (radiator_type IS NULL OR radiator_type IN ('crossflow', 'downflow', 'dual_pass', 'other'));
ALTER TABLE radiators ADD CONSTRAINT chk_rad_core_material
  CHECK (core_material IS NULL OR core_material IN ('copper_brass', 'aluminum', 'plastic_aluminum', 'other'));
ALTER TABLE radiators ADD CONSTRAINT chk_rad_tank_material
  CHECK (tank_material IS NULL OR tank_material IN ('brass', 'aluminum', 'plastic', 'other'));
ALTER TABLE radiators ADD CONSTRAINT chk_rad_rows
  CHECK (rows IS NULL OR (rows >= 1 AND rows <= 6));
ALTER TABLE radiators ADD CONSTRAINT chk_rad_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE radiators ADD CONSTRAINT chk_rad_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_radiators_vehicle ON radiators(vehicle_id);

COMMENT ON TABLE radiators IS 'Radiator specifications and condition. One row per radiator (most vehicles have one).';
COMMENT ON COLUMN radiators.id IS 'Primary key.';
COMMENT ON COLUMN radiators.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN radiators.radiator_type IS 'Flow direction: crossflow, downflow, dual_pass, other.';
COMMENT ON COLUMN radiators.core_material IS 'Core material: copper_brass, aluminum, plastic_aluminum, other.';
COMMENT ON COLUMN radiators.tank_material IS 'Tank material: brass, aluminum, plastic, other.';
COMMENT ON COLUMN radiators.rows IS 'Number of tube rows, 1-6.';
COMMENT ON COLUMN radiators.tube_size IS 'Tube size description, e.g. 1_inch, 5_8_inch.';
COMMENT ON COLUMN radiators.core_width_inches IS 'Core width in inches.';
COMMENT ON COLUMN radiators.core_height_inches IS 'Core height in inches.';
COMMENT ON COLUMN radiators.core_thickness_inches IS 'Core thickness (depth) in inches.';
COMMENT ON COLUMN radiators.capacity_quarts IS 'Radiator coolant capacity in quarts.';
COMMENT ON COLUMN radiators.cap_pressure_psi IS 'Radiator cap pressure rating in PSI.';
COMMENT ON COLUMN radiators.inlet_location IS 'Inlet hose connection location, e.g. upper_left, upper_right.';
COMMENT ON COLUMN radiators.outlet_location IS 'Outlet hose connection location, e.g. lower_left, lower_right.';
COMMENT ON COLUMN radiators.trans_cooler_built_in IS 'True if automatic transmission cooler is built into the radiator.';
COMMENT ON COLUMN radiators.manufacturer IS 'Radiator manufacturer, e.g. Harrison, Champion, Griffin, Be Cool.';
COMMENT ON COLUMN radiators.part_number IS 'Radiator part number.';
COMMENT ON COLUMN radiators.fin_density_fpi IS 'Fin density in fins per inch.';
COMMENT ON COLUMN radiators.is_original IS 'True if factory-installed radiator.';
COMMENT ON COLUMN radiators.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN radiators.condition_notes IS 'Freeform condition details, e.g. re-cored in 2019, minor seepage at tank seam.';
COMMENT ON COLUMN radiators.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN radiators.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN radiators.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN radiators.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 11. COOLING_FANS
-- ============================================================

CREATE TABLE cooling_fans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Specifications
  fan_type TEXT,
  position TEXT,
  diameter_inches NUMERIC(4,1),
  blade_count INTEGER,
  clutch_type TEXT,
  clutch_engagement_temp_f INTEGER,
  cfm_rating INTEGER,
  amperage_draw NUMERIC(4,1),
  controller TEXT,
  shroud_yn BOOLEAN DEFAULT FALSE,
  shroud_material TEXT,
  manufacturer TEXT,
  part_number TEXT,
  thermostat_controlled BOOLEAN DEFAULT FALSE,
  activation_temp_f INTEGER,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE cooling_fans ADD CONSTRAINT chk_cf_type
  CHECK (fan_type IS NULL OR fan_type IN ('mechanical', 'electric', 'dual_electric', 'flex_fan', 'other'));
ALTER TABLE cooling_fans ADD CONSTRAINT chk_cf_position
  CHECK (position IS NULL OR position IN ('pusher', 'puller', 'engine_driven', 'auxiliary'));
ALTER TABLE cooling_fans ADD CONSTRAINT chk_cf_clutch
  CHECK (clutch_type IS NULL OR clutch_type IN ('thermal', 'non_thermal', 'severe_duty', 'electric', 'none'));
ALTER TABLE cooling_fans ADD CONSTRAINT chk_cf_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE cooling_fans ADD CONSTRAINT chk_cf_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_cooling_fans_vehicle ON cooling_fans(vehicle_id);

COMMENT ON TABLE cooling_fans IS 'Cooling fan specifications. One row per fan (vehicles may have mechanical + electric, or dual electric).';
COMMENT ON COLUMN cooling_fans.id IS 'Primary key.';
COMMENT ON COLUMN cooling_fans.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN cooling_fans.fan_type IS 'Fan type: mechanical, electric, dual_electric, flex_fan, other.';
COMMENT ON COLUMN cooling_fans.position IS 'Fan position relative to radiator: pusher, puller, engine_driven, auxiliary.';
COMMENT ON COLUMN cooling_fans.diameter_inches IS 'Fan blade diameter in inches.';
COMMENT ON COLUMN cooling_fans.blade_count IS 'Number of fan blades.';
COMMENT ON COLUMN cooling_fans.clutch_type IS 'Fan clutch type: thermal, non_thermal, severe_duty, electric, none.';
COMMENT ON COLUMN cooling_fans.clutch_engagement_temp_f IS 'Temperature at which thermal clutch engages, in Fahrenheit.';
COMMENT ON COLUMN cooling_fans.cfm_rating IS 'Rated airflow in cubic feet per minute.';
COMMENT ON COLUMN cooling_fans.amperage_draw IS 'Electric fan amperage draw.';
COMMENT ON COLUMN cooling_fans.controller IS 'Fan controller description, e.g. thermostatic_switch, ecu_controlled, manual_switch, adjustable.';
COMMENT ON COLUMN cooling_fans.shroud_yn IS 'True if a fan shroud is installed.';
COMMENT ON COLUMN cooling_fans.shroud_material IS 'Shroud material, e.g. plastic, fiberglass, aluminum, stamped_steel.';
COMMENT ON COLUMN cooling_fans.manufacturer IS 'Fan manufacturer, e.g. Flex-a-lite, SPAL, Hayden, OEM.';
COMMENT ON COLUMN cooling_fans.part_number IS 'Fan part number.';
COMMENT ON COLUMN cooling_fans.thermostat_controlled IS 'True if fan activation is thermostat-controlled.';
COMMENT ON COLUMN cooling_fans.activation_temp_f IS 'Temperature at which electric fan activates, in Fahrenheit.';
COMMENT ON COLUMN cooling_fans.is_original IS 'True if factory-installed cooling fan.';
COMMENT ON COLUMN cooling_fans.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN cooling_fans.condition_notes IS 'Freeform condition details, e.g. clutch slipping, fan wobble.';
COMMENT ON COLUMN cooling_fans.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN cooling_fans.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN cooling_fans.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN cooling_fans.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 12. COOLANT_HOSES — per-hose specs
-- ============================================================

CREATE TABLE coolant_hoses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Identification
  hose_location TEXT NOT NULL,
  side TEXT,

  -- Specifications
  material TEXT,
  inner_diameter_inches NUMERIC(4,2),
  length_inches NUMERIC(5,1),
  manufacturer TEXT,
  part_number TEXT,
  clamp_type TEXT,
  reinforced BOOLEAN DEFAULT FALSE,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE coolant_hoses ADD CONSTRAINT chk_ch_location
  CHECK (hose_location IN (
    'upper_radiator', 'lower_radiator', 'heater_supply', 'heater_return',
    'bypass', 'overflow', 'thermostat_housing', 'water_pump_inlet', 'other'
  ));
ALTER TABLE coolant_hoses ADD CONSTRAINT chk_ch_material
  CHECK (material IS NULL OR material IN ('rubber', 'silicone', 'epdm', 'reinforced_rubber', 'other'));
ALTER TABLE coolant_hoses ADD CONSTRAINT chk_ch_side
  CHECK (side IS NULL OR side IN ('left', 'right', 'center'));
ALTER TABLE coolant_hoses ADD CONSTRAINT chk_ch_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE coolant_hoses ADD CONSTRAINT chk_ch_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_coolant_hoses_vehicle ON coolant_hoses(vehicle_id);

COMMENT ON TABLE coolant_hoses IS 'Per-hose coolant hose specifications. One row per hose in the cooling system.';
COMMENT ON COLUMN coolant_hoses.id IS 'Primary key.';
COMMENT ON COLUMN coolant_hoses.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN coolant_hoses.hose_location IS 'Hose position: upper_radiator, lower_radiator, heater_supply, heater_return, bypass, overflow, thermostat_housing, water_pump_inlet, other.';
COMMENT ON COLUMN coolant_hoses.side IS 'Which side if applicable: left, right, center.';
COMMENT ON COLUMN coolant_hoses.material IS 'Hose material: rubber, silicone, epdm, reinforced_rubber, other.';
COMMENT ON COLUMN coolant_hoses.inner_diameter_inches IS 'Hose inner diameter in inches.';
COMMENT ON COLUMN coolant_hoses.length_inches IS 'Hose length in inches.';
COMMENT ON COLUMN coolant_hoses.manufacturer IS 'Hose manufacturer, e.g. Gates, Dayco, Mishimoto.';
COMMENT ON COLUMN coolant_hoses.part_number IS 'Hose part number.';
COMMENT ON COLUMN coolant_hoses.clamp_type IS 'Hose clamp type, e.g. tower, worm_gear, spring, t_bolt.';
COMMENT ON COLUMN coolant_hoses.reinforced IS 'True if hose is internally reinforced.';
COMMENT ON COLUMN coolant_hoses.is_original IS 'True if factory-installed hose.';
COMMENT ON COLUMN coolant_hoses.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN coolant_hoses.condition_notes IS 'Freeform condition details, e.g. soft spot near clamp, cracking visible.';
COMMENT ON COLUMN coolant_hoses.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN coolant_hoses.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN coolant_hoses.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN coolant_hoses.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 13. OVERFLOW_SYSTEMS — expansion tank / overflow bottle
-- ============================================================

CREATE TABLE overflow_systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Specifications
  system_type TEXT,
  material TEXT,
  capacity_quarts NUMERIC(4,1),
  cap_pressure_psi INTEGER,
  pressurized BOOLEAN DEFAULT FALSE,
  mounting_location TEXT,
  manufacturer TEXT,
  part_number TEXT,
  level_sensor_yn BOOLEAN DEFAULT FALSE,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE overflow_systems ADD CONSTRAINT chk_ov_type
  CHECK (system_type IS NULL OR system_type IN ('expansion_tank', 'overflow_bottle', 'surge_tank', 'none'));
ALTER TABLE overflow_systems ADD CONSTRAINT chk_ov_material
  CHECK (material IS NULL OR material IN ('plastic', 'aluminum', 'stainless', 'stamped_steel', 'other'));
ALTER TABLE overflow_systems ADD CONSTRAINT chk_ov_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE overflow_systems ADD CONSTRAINT chk_ov_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_overflow_systems_vehicle ON overflow_systems(vehicle_id);

COMMENT ON TABLE overflow_systems IS 'Coolant overflow / expansion tank specifications.';
COMMENT ON COLUMN overflow_systems.id IS 'Primary key.';
COMMENT ON COLUMN overflow_systems.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN overflow_systems.system_type IS 'System type: expansion_tank, overflow_bottle, surge_tank, none.';
COMMENT ON COLUMN overflow_systems.material IS 'Tank material: plastic, aluminum, stainless, stamped_steel, other.';
COMMENT ON COLUMN overflow_systems.capacity_quarts IS 'Tank capacity in quarts.';
COMMENT ON COLUMN overflow_systems.cap_pressure_psi IS 'Pressure cap rating in PSI (if pressurized system).';
COMMENT ON COLUMN overflow_systems.pressurized IS 'True if this is a pressurized expansion tank (vs simple overflow).';
COMMENT ON COLUMN overflow_systems.mounting_location IS 'Where tank is mounted, e.g. fender_well, firewall, radiator_support.';
COMMENT ON COLUMN overflow_systems.manufacturer IS 'Tank manufacturer.';
COMMENT ON COLUMN overflow_systems.part_number IS 'Part number.';
COMMENT ON COLUMN overflow_systems.level_sensor_yn IS 'True if coolant level sensor is installed.';
COMMENT ON COLUMN overflow_systems.is_original IS 'True if factory-installed overflow system.';
COMMENT ON COLUMN overflow_systems.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN overflow_systems.condition_notes IS 'Freeform condition details, e.g. yellowed plastic, cap seal worn.';
COMMENT ON COLUMN overflow_systems.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN overflow_systems.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN overflow_systems.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN overflow_systems.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 14. INTERCOOLERS — for forced-induction vehicles
-- ============================================================

CREATE TABLE intercoolers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Specifications
  intercooler_type TEXT,
  mounting TEXT,
  core_width_inches NUMERIC(5,1),
  core_height_inches NUMERIC(5,1),
  core_thickness_inches NUMERIC(4,1),
  pipe_diameter_inches NUMERIC(4,2),
  pipe_material TEXT,
  core_material TEXT,
  end_tank_material TEXT,
  manufacturer TEXT,
  part_number TEXT,
  spray_bar_equipped BOOLEAN DEFAULT FALSE,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE intercoolers ADD CONSTRAINT chk_ic_type
  CHECK (intercooler_type IS NULL OR intercooler_type IN ('air_to_air', 'air_to_water', 'other'));
ALTER TABLE intercoolers ADD CONSTRAINT chk_ic_mounting
  CHECK (mounting IS NULL OR mounting IN ('top_mount', 'front_mount', 'side_mount', 'trunk_mount', 'other'));
ALTER TABLE intercoolers ADD CONSTRAINT chk_ic_core_material
  CHECK (core_material IS NULL OR core_material IN ('aluminum', 'copper_brass', 'other'));
ALTER TABLE intercoolers ADD CONSTRAINT chk_ic_pipe_material
  CHECK (pipe_material IS NULL OR pipe_material IN ('aluminum', 'stainless', 'silicone', 'rubber', 'other'));
ALTER TABLE intercoolers ADD CONSTRAINT chk_ic_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE intercoolers ADD CONSTRAINT chk_ic_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_intercoolers_vehicle ON intercoolers(vehicle_id);

COMMENT ON TABLE intercoolers IS 'Intercooler specifications for forced-induction vehicles (turbo/supercharged). One row per intercooler.';
COMMENT ON COLUMN intercoolers.id IS 'Primary key.';
COMMENT ON COLUMN intercoolers.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN intercoolers.intercooler_type IS 'Cooling medium: air_to_air, air_to_water, other.';
COMMENT ON COLUMN intercoolers.mounting IS 'Mount position: top_mount, front_mount, side_mount, trunk_mount, other.';
COMMENT ON COLUMN intercoolers.core_width_inches IS 'Core width in inches.';
COMMENT ON COLUMN intercoolers.core_height_inches IS 'Core height in inches.';
COMMENT ON COLUMN intercoolers.core_thickness_inches IS 'Core thickness in inches.';
COMMENT ON COLUMN intercoolers.pipe_diameter_inches IS 'Charge pipe outer diameter in inches.';
COMMENT ON COLUMN intercoolers.pipe_material IS 'Charge pipe material: aluminum, stainless, silicone, rubber, other.';
COMMENT ON COLUMN intercoolers.core_material IS 'Core material: aluminum, copper_brass, other.';
COMMENT ON COLUMN intercoolers.end_tank_material IS 'End tank material, e.g. cast_aluminum, fabricated_aluminum, plastic.';
COMMENT ON COLUMN intercoolers.manufacturer IS 'Intercooler manufacturer, e.g. Garrett, Mishimoto, Bell, OEM.';
COMMENT ON COLUMN intercoolers.part_number IS 'Intercooler part number.';
COMMENT ON COLUMN intercoolers.spray_bar_equipped IS 'True if water spray bar is installed for additional cooling.';
COMMENT ON COLUMN intercoolers.is_original IS 'True if factory-installed intercooler.';
COMMENT ON COLUMN intercoolers.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN intercoolers.condition_notes IS 'Freeform condition details, e.g. bent fins on leading edge.';
COMMENT ON COLUMN intercoolers.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN intercoolers.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN intercoolers.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN intercoolers.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- ============================================================
--  SUBSYSTEM 4: SAFETY & EMISSIONS
-- ============================================================
-- ============================================================


-- ============================================================
-- 15. SAFETY_EQUIPMENT
-- ============================================================

CREATE TABLE safety_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Seatbelts (per-position stored as JSONB array)
  seatbelts JSONB DEFAULT '[]',

  -- Airbags
  airbag_equipped BOOLEAN DEFAULT FALSE,
  airbag_locations TEXT[],
  airbag_module_manufacturer TEXT,
  airbag_warning_light_status TEXT,

  -- Roll protection
  roll_protection TEXT,
  roll_bar_manufacturer TEXT,
  roll_bar_material TEXT,
  roll_bar_tube_diameter_inches NUMERIC(4,2),
  roll_bar_padding_yn BOOLEAN,
  roll_bar_certified TEXT,

  -- Other safety
  fire_extinguisher_yn BOOLEAN DEFAULT FALSE,
  fire_extinguisher_type TEXT,
  fire_extinguisher_mount TEXT,
  kill_switch_yn BOOLEAN DEFAULT FALSE,
  kill_switch_location TEXT,
  window_net_yn BOOLEAN DEFAULT FALSE,
  window_net_type TEXT,
  harness_bar_yn BOOLEAN DEFAULT FALSE,
  arm_restraints_yn BOOLEAN DEFAULT FALSE,
  first_aid_kit_yn BOOLEAN DEFAULT FALSE,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE safety_equipment ADD CONSTRAINT chk_se_roll
  CHECK (roll_protection IS NULL OR roll_protection IN (
    'none', 'roll_bar', 'half_cage', 'full_cage', 'factory_rops', 'other'
  ));
ALTER TABLE safety_equipment ADD CONSTRAINT chk_se_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE safety_equipment ADD CONSTRAINT chk_se_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_safety_equip_vehicle ON safety_equipment(vehicle_id);

COMMENT ON TABLE safety_equipment IS 'Vehicle safety equipment: seatbelts, airbags, roll protection, fire suppression, kill switches.';
COMMENT ON COLUMN safety_equipment.id IS 'Primary key.';
COMMENT ON COLUMN safety_equipment.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN safety_equipment.seatbelts IS 'JSONB array of per-position seatbelt specs. Each element: {position: "driver"|"passenger"|"rear_left"|"rear_center"|"rear_right", type: "lap"|"3_point"|"4_point"|"5_point"|"6_point"|"none", manufacturer: text, condition: text, date_code: text}.';
COMMENT ON COLUMN safety_equipment.airbag_equipped IS 'True if any airbags are installed.';
COMMENT ON COLUMN safety_equipment.airbag_locations IS 'Array of airbag locations, e.g. {driver_wheel, passenger_dash, side_curtain, knee}.';
COMMENT ON COLUMN safety_equipment.airbag_module_manufacturer IS 'Airbag control module manufacturer.';
COMMENT ON COLUMN safety_equipment.airbag_warning_light_status IS 'Airbag warning light status, e.g. off, illuminated, flashing, removed.';
COMMENT ON COLUMN safety_equipment.roll_protection IS 'Roll protection level: none, roll_bar, half_cage, full_cage, factory_rops, other.';
COMMENT ON COLUMN safety_equipment.roll_bar_manufacturer IS 'Roll bar/cage manufacturer, e.g. Autopower, Kirk, custom.';
COMMENT ON COLUMN safety_equipment.roll_bar_material IS 'Roll bar material, e.g. mild_steel, chromoly, dom_tubing.';
COMMENT ON COLUMN safety_equipment.roll_bar_tube_diameter_inches IS 'Roll bar tube outer diameter in inches.';
COMMENT ON COLUMN safety_equipment.roll_bar_padding_yn IS 'True if roll bar padding is installed.';
COMMENT ON COLUMN safety_equipment.roll_bar_certified IS 'Certification standard, e.g. scca, nhra_8_50, fia, nhra_7_50, none.';
COMMENT ON COLUMN safety_equipment.fire_extinguisher_yn IS 'True if fire extinguisher is installed.';
COMMENT ON COLUMN safety_equipment.fire_extinguisher_type IS 'Extinguisher type, e.g. halon, dry_chemical, afff, clean_agent.';
COMMENT ON COLUMN safety_equipment.fire_extinguisher_mount IS 'Mount location, e.g. driver_seat, center_tunnel, trunk.';
COMMENT ON COLUMN safety_equipment.kill_switch_yn IS 'True if master kill switch is installed.';
COMMENT ON COLUMN safety_equipment.kill_switch_location IS 'Kill switch location, e.g. dash, rear_of_vehicle, under_hood.';
COMMENT ON COLUMN safety_equipment.window_net_yn IS 'True if window net(s) installed.';
COMMENT ON COLUMN safety_equipment.window_net_type IS 'Window net type, e.g. mesh, ribbon, sfi_rated.';
COMMENT ON COLUMN safety_equipment.harness_bar_yn IS 'True if harness bar is installed for racing harnesses.';
COMMENT ON COLUMN safety_equipment.arm_restraints_yn IS 'True if arm restraints are installed.';
COMMENT ON COLUMN safety_equipment.first_aid_kit_yn IS 'True if first aid kit is present.';
COMMENT ON COLUMN safety_equipment.is_original IS 'True if factory-original safety equipment.';
COMMENT ON COLUMN safety_equipment.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN safety_equipment.condition_notes IS 'Freeform condition details, e.g. seatbelt webbing frayed, retractor stiff.';
COMMENT ON COLUMN safety_equipment.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN safety_equipment.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN safety_equipment.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN safety_equipment.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 16. EMISSIONS_SYSTEMS
-- ============================================================

CREATE TABLE emissions_systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- EGR
  egr_equipped BOOLEAN DEFAULT FALSE,
  egr_type TEXT,
  egr_condition TEXT,
  egr_delete BOOLEAN DEFAULT FALSE,
  egr_valve_part_number TEXT,

  -- Air injection (AIR/smog pump system)
  air_injection_equipped BOOLEAN DEFAULT FALSE,
  air_injection_type TEXT,
  air_injection_condition TEXT,
  air_injection_delete BOOLEAN DEFAULT FALSE,

  -- PCV
  pcv_equipped BOOLEAN DEFAULT TRUE,
  pcv_type TEXT,
  pcv_condition TEXT,
  pcv_valve_part_number TEXT,

  -- EVAP
  evap_equipped BOOLEAN DEFAULT FALSE,
  evap_type TEXT,
  evap_condition TEXT,
  charcoal_canister_yn BOOLEAN DEFAULT FALSE,
  charcoal_canister_condition TEXT,

  -- Catalytic reference (details in catalytic_converters table)
  catalytic_equipped BOOLEAN DEFAULT FALSE,
  catalytic_notes TEXT,

  -- Overall emissions
  emissions_standard TEXT,
  emissions_state TEXT,
  last_smog_check_date DATE,
  last_smog_check_result TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE emissions_systems ADD CONSTRAINT chk_em_egr_type
  CHECK (egr_type IS NULL OR egr_type IN (
    'ported_vacuum', 'backpressure', 'electronic', 'integral', 'none', 'other'
  ));
ALTER TABLE emissions_systems ADD CONSTRAINT chk_em_air_type
  CHECK (air_injection_type IS NULL OR air_injection_type IN (
    'belt_driven_pump', 'pulse_air', 'electric', 'none', 'other'
  ));
ALTER TABLE emissions_systems ADD CONSTRAINT chk_em_pcv_type
  CHECK (pcv_type IS NULL OR pcv_type IN (
    'standard_valve', 'catch_can', 'road_draft_tube', 'breather_only', 'other'
  ));
ALTER TABLE emissions_systems ADD CONSTRAINT chk_em_evap_type
  CHECK (evap_type IS NULL OR evap_type IN (
    'canister_purge', 'fuel_tank_vent', 'sealed_cap', 'none', 'other'
  ));
ALTER TABLE emissions_systems ADD CONSTRAINT chk_em_smog_result
  CHECK (last_smog_check_result IS NULL OR last_smog_check_result IN ('pass', 'fail', 'exempt', 'waiver'));
ALTER TABLE emissions_systems ADD CONSTRAINT chk_em_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE emissions_systems ADD CONSTRAINT chk_em_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_emissions_vehicle ON emissions_systems(vehicle_id);

COMMENT ON TABLE emissions_systems IS 'Emissions control system specifications: EGR, air injection, PCV, EVAP, catalytic reference, smog status.';
COMMENT ON COLUMN emissions_systems.id IS 'Primary key.';
COMMENT ON COLUMN emissions_systems.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN emissions_systems.egr_equipped IS 'True if EGR system is installed.';
COMMENT ON COLUMN emissions_systems.egr_type IS 'EGR valve type: ported_vacuum, backpressure, electronic, integral, none, other.';
COMMENT ON COLUMN emissions_systems.egr_condition IS 'EGR system condition description, e.g. functional, stuck_open, stuck_closed, removed.';
COMMENT ON COLUMN emissions_systems.egr_delete IS 'True if EGR system has been removed/disabled.';
COMMENT ON COLUMN emissions_systems.egr_valve_part_number IS 'EGR valve part number.';
COMMENT ON COLUMN emissions_systems.air_injection_equipped IS 'True if AIR (air injection reactor) system is installed.';
COMMENT ON COLUMN emissions_systems.air_injection_type IS 'Air injection type: belt_driven_pump, pulse_air, electric, none, other.';
COMMENT ON COLUMN emissions_systems.air_injection_condition IS 'Air injection condition description.';
COMMENT ON COLUMN emissions_systems.air_injection_delete IS 'True if air injection system has been removed.';
COMMENT ON COLUMN emissions_systems.pcv_equipped IS 'True if PCV system is installed (nearly all engines post-1963).';
COMMENT ON COLUMN emissions_systems.pcv_type IS 'PCV type: standard_valve, catch_can, road_draft_tube, breather_only, other.';
COMMENT ON COLUMN emissions_systems.pcv_condition IS 'PCV system condition description.';
COMMENT ON COLUMN emissions_systems.pcv_valve_part_number IS 'PCV valve part number.';
COMMENT ON COLUMN emissions_systems.evap_equipped IS 'True if evaporative emissions (EVAP) system is installed.';
COMMENT ON COLUMN emissions_systems.evap_type IS 'EVAP system type: canister_purge, fuel_tank_vent, sealed_cap, none, other.';
COMMENT ON COLUMN emissions_systems.evap_condition IS 'EVAP system condition description.';
COMMENT ON COLUMN emissions_systems.charcoal_canister_yn IS 'True if charcoal canister is present.';
COMMENT ON COLUMN emissions_systems.charcoal_canister_condition IS 'Charcoal canister condition, e.g. functional, saturated, cracked, missing.';
COMMENT ON COLUMN emissions_systems.catalytic_equipped IS 'True if catalytic converter(s) installed. See catalytic_converters table for details.';
COMMENT ON COLUMN emissions_systems.catalytic_notes IS 'Cross-reference notes for catalytic converter details.';
COMMENT ON COLUMN emissions_systems.emissions_standard IS 'Applicable emissions standard, e.g. pre_emissions, tier_1, carb, euro_4.';
COMMENT ON COLUMN emissions_systems.emissions_state IS 'State of registration for emissions compliance, e.g. CA, NY, federal.';
COMMENT ON COLUMN emissions_systems.last_smog_check_date IS 'Date of last smog/emissions test.';
COMMENT ON COLUMN emissions_systems.last_smog_check_result IS 'Last smog test result: pass, fail, exempt, waiver.';
COMMENT ON COLUMN emissions_systems.is_original IS 'True if factory-original emissions equipment.';
COMMENT ON COLUMN emissions_systems.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN emissions_systems.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN emissions_systems.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN emissions_systems.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN emissions_systems.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN emissions_systems.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 17. CRASH_STRUCTURE
-- ============================================================

CREATE TABLE crash_structure (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Crumple zones
  front_crumple_zone TEXT,
  rear_crumple_zone TEXT,

  -- Reinforcements
  door_beam_type TEXT,
  door_beam_count_per_door INTEGER,
  b_pillar_reinforced BOOLEAN,
  a_pillar_reinforced BOOLEAN,
  roof_reinforced BOOLEAN,
  bumper_reinforcement_front TEXT,
  bumper_reinforcement_rear TEXT,
  side_impact_bars BOOLEAN DEFAULT FALSE,

  -- Subframe
  subframe_type TEXT,
  subframe_condition TEXT,
  subframe_connectors_installed BOOLEAN DEFAULT FALSE,
  subframe_connector_type TEXT,

  -- Bumpers
  front_bumper_type TEXT,
  rear_bumper_type TEXT,
  bumper_material TEXT,

  -- Crash history
  accident_history_yn BOOLEAN DEFAULT FALSE,
  accident_history_notes TEXT,
  frame_straightened BOOLEAN DEFAULT FALSE,
  structural_repair_notes TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE crash_structure ADD CONSTRAINT chk_cs_subframe_type
  CHECK (subframe_type IS NULL OR subframe_type IN (
    'full_frame', 'unibody', 'body_on_frame', 'subframe_front', 'subframe_rear', 'space_frame', 'other'
  ));
ALTER TABLE crash_structure ADD CONSTRAINT chk_cs_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE crash_structure ADD CONSTRAINT chk_cs_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_crash_structure_vehicle ON crash_structure(vehicle_id);

COMMENT ON TABLE crash_structure IS 'Crash structure and structural integrity: crumple zones, reinforcements, door beams, subframe, bumper reinforcements.';
COMMENT ON COLUMN crash_structure.id IS 'Primary key.';
COMMENT ON COLUMN crash_structure.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN crash_structure.front_crumple_zone IS 'Front crumple zone description, e.g. factory_engineered, reinforced, none_pre_regulation.';
COMMENT ON COLUMN crash_structure.rear_crumple_zone IS 'Rear crumple zone description.';
COMMENT ON COLUMN crash_structure.door_beam_type IS 'Door beam type, e.g. side_impact_bar, tubular, stamped, none.';
COMMENT ON COLUMN crash_structure.door_beam_count_per_door IS 'Number of beams per door.';
COMMENT ON COLUMN crash_structure.b_pillar_reinforced IS 'True if B-pillar has reinforcement.';
COMMENT ON COLUMN crash_structure.a_pillar_reinforced IS 'True if A-pillar has reinforcement.';
COMMENT ON COLUMN crash_structure.roof_reinforced IS 'True if roof has added reinforcement.';
COMMENT ON COLUMN crash_structure.bumper_reinforcement_front IS 'Front bumper reinforcement description, e.g. impact_bar, energy_absorber, chrome_bumper_bracket.';
COMMENT ON COLUMN crash_structure.bumper_reinforcement_rear IS 'Rear bumper reinforcement description.';
COMMENT ON COLUMN crash_structure.side_impact_bars IS 'True if side impact protection bars are present.';
COMMENT ON COLUMN crash_structure.subframe_type IS 'Chassis type: full_frame, unibody, body_on_frame, subframe_front, subframe_rear, space_frame, other.';
COMMENT ON COLUMN crash_structure.subframe_condition IS 'Subframe/frame condition, e.g. solid, surface_rust, scale_rust, repaired, compromised.';
COMMENT ON COLUMN crash_structure.subframe_connectors_installed IS 'True if aftermarket subframe connectors are installed (unibody vehicles).';
COMMENT ON COLUMN crash_structure.subframe_connector_type IS 'Connector type, e.g. weld_in, bolt_in.';
COMMENT ON COLUMN crash_structure.front_bumper_type IS 'Front bumper type, e.g. chrome, urethane, body_color, tube.';
COMMENT ON COLUMN crash_structure.rear_bumper_type IS 'Rear bumper type.';
COMMENT ON COLUMN crash_structure.bumper_material IS 'Primary bumper material, e.g. chrome_steel, aluminum, urethane, composite.';
COMMENT ON COLUMN crash_structure.accident_history_yn IS 'True if vehicle has known accident history.';
COMMENT ON COLUMN crash_structure.accident_history_notes IS 'Description of accident history if known.';
COMMENT ON COLUMN crash_structure.frame_straightened IS 'True if frame/unibody has been straightened.';
COMMENT ON COLUMN crash_structure.structural_repair_notes IS 'Description of any structural repairs performed.';
COMMENT ON COLUMN crash_structure.is_original IS 'True if factory-original crash structure.';
COMMENT ON COLUMN crash_structure.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN crash_structure.condition_notes IS 'Freeform condition details, e.g. minor surface rust on frame rails.';
COMMENT ON COLUMN crash_structure.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN crash_structure.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN crash_structure.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN crash_structure.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 18. VIN_PLATES_TAGS — per-location identification tags
-- ============================================================

CREATE TABLE vin_plates_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Identification
  tag_type TEXT NOT NULL,
  location TEXT NOT NULL,

  -- Content
  stamped_content TEXT,
  decoded_info JSONB DEFAULT '{}',
  photo_evidence_id UUID,

  -- Condition
  legibility TEXT,
  tampered BOOLEAN DEFAULT FALSE,
  tamper_notes TEXT,
  attachment_method TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE vin_plates_tags ADD CONSTRAINT chk_vpt_type
  CHECK (tag_type IN (
    'vin_plate', 'body_tag', 'trim_tag', 'emission_label',
    'tire_placard', 'fender_tag', 'cowl_tag', 'door_tag',
    'engine_stamp', 'trans_stamp', 'axle_tag', 'other'
  ));
ALTER TABLE vin_plates_tags ADD CONSTRAINT chk_vpt_legibility
  CHECK (legibility IS NULL OR legibility IN ('clear', 'partial', 'faded', 'illegible', 'missing'));
ALTER TABLE vin_plates_tags ADD CONSTRAINT chk_vpt_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE vin_plates_tags ADD CONSTRAINT chk_vpt_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_vin_plates_vehicle ON vin_plates_tags(vehicle_id);

COMMENT ON TABLE vin_plates_tags IS 'VIN plates, body tags, trim tags, and other identification labels. One row per tag/plate. Critical for provenance authentication.';
COMMENT ON COLUMN vin_plates_tags.id IS 'Primary key.';
COMMENT ON COLUMN vin_plates_tags.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN vin_plates_tags.tag_type IS 'Tag type: vin_plate, body_tag, trim_tag, emission_label, tire_placard, fender_tag, cowl_tag, door_tag, engine_stamp, trans_stamp, axle_tag, other.';
COMMENT ON COLUMN vin_plates_tags.location IS 'Physical location on the vehicle, e.g. dash_driver_side, door_jamb_driver, firewall, fender_inner_left.';
COMMENT ON COLUMN vin_plates_tags.stamped_content IS 'Raw text/numbers as stamped or printed on the tag.';
COMMENT ON COLUMN vin_plates_tags.decoded_info IS 'JSONB decoded interpretation of tag content. Structure varies by tag_type, e.g. {paint_code: "19", trim_code: "711", body_style: "37"} for a cowl tag.';
COMMENT ON COLUMN vin_plates_tags.photo_evidence_id IS 'UUID reference to field_evidence or vehicle_images for photographic documentation of this tag.';
COMMENT ON COLUMN vin_plates_tags.legibility IS 'How readable the tag is: clear, partial, faded, illegible, missing.';
COMMENT ON COLUMN vin_plates_tags.tampered IS 'True if tag shows signs of tampering (re-stamping, replacement, VIN swap).';
COMMENT ON COLUMN vin_plates_tags.tamper_notes IS 'Description of suspected tampering.';
COMMENT ON COLUMN vin_plates_tags.attachment_method IS 'How the tag is attached, e.g. rosette_rivets, spot_welded, adhesive, screwed.';
COMMENT ON COLUMN vin_plates_tags.is_original IS 'True if tag is believed to be factory-installed.';
COMMENT ON COLUMN vin_plates_tags.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN vin_plates_tags.condition_notes IS 'Freeform condition details, e.g. paint overspray on tag, one rivet replaced.';
COMMENT ON COLUMN vin_plates_tags.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN vin_plates_tags.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN vin_plates_tags.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN vin_plates_tags.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- UPDATED_AT TRIGGERS
-- Reuses the shared trigger function from the engine subsystem.
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'exhaust_pipes',
    'catalytic_converters',
    'mufflers',
    'exhaust_tips',
    'fuel_tanks',
    'fuel_pumps',
    'fuel_lines',
    'fuel_filters',
    'fuel_system_electronics',
    'radiators',
    'cooling_fans',
    'coolant_hoses',
    'overflow_systems',
    'intercoolers',
    'safety_equipment',
    'emissions_systems',
    'crash_structure',
    'vin_plates_tags'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at
       BEFORE UPDATE ON %I
       FOR EACH ROW
       EXECUTE FUNCTION digital_twin_set_updated_at()',
      tbl, tbl
    );
  END LOOP;
END $$;


-- ============================================================
-- RLS POLICIES
-- Same pattern as engine subsystem: public read, service role write.
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'exhaust_pipes',
    'catalytic_converters',
    'mufflers',
    'exhaust_tips',
    'fuel_tanks',
    'fuel_pumps',
    'fuel_lines',
    'fuel_filters',
    'fuel_system_electronics',
    'radiators',
    'cooling_fans',
    'coolant_hoses',
    'overflow_systems',
    'intercoolers',
    'safety_equipment',
    'emissions_systems',
    'crash_structure',
    'vin_plates_tags'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format(
      'CREATE POLICY "Anyone can view %s" ON %I FOR SELECT USING (true)',
      tbl, tbl
    );
    EXECUTE format(
      'CREATE POLICY "Service role manages %s" ON %I USING (true) WITH CHECK (true)',
      tbl, tbl
    );
  END LOOP;
END $$;


COMMIT;
