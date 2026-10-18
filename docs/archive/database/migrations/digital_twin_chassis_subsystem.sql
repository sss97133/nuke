-- ============================================================
-- DIGITAL TWIN: Chassis Subsystem DDL
-- Front Suspension, Rear Suspension, Steering, Brakes
--
-- Architecture:
--   Every component gets a spec table with factory specification,
--   condition grade, provenance, and originality tracking.
--   Work events are logged via component_events referencing actors.
--   Evidence linking uses the existing field_evidence table.
--
-- Pattern: Follows the reference implementation established in
-- digital_twin_engine_subsystem.sql. Does NOT recreate actors
-- or component_events (shared across all subsystems).
-- ============================================================

BEGIN;


-- ============================================================
-- FRONT SUSPENSION
-- ============================================================


-- ============================================================
-- 1. FRONT_SUSPENSION_CONFIG — type and alignment specs
-- ============================================================

CREATE TABLE front_suspension_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Configuration
  suspension_type TEXT,
  subframe_type TEXT,
  crossmember_part_number TEXT,
  ride_height_spec_mm NUMERIC(6,1),
  wheel_travel_mm NUMERIC(5,1),

  -- Alignment specifications
  caster_degrees NUMERIC(5,2),
  caster_tolerance NUMERIC(4,2),
  camber_degrees NUMERIC(5,2),
  camber_tolerance NUMERIC(4,2),
  toe_in_mm NUMERIC(5,2),
  toe_tolerance_mm NUMERIC(4,2),
  steering_axis_inclination_degrees NUMERIC(5,2),
  scrub_radius_mm NUMERIC(5,1),
  turning_radius_ft NUMERIC(4,1),

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE front_suspension_config ADD CONSTRAINT chk_fsc_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE front_suspension_config ADD CONSTRAINT chk_fsc_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE front_suspension_config ADD CONSTRAINT chk_fsc_type
  CHECK (suspension_type IS NULL OR suspension_type IN (
    'solid_axle', 'ifs_torsion_bar', 'ifs_coilover', 'ifs_macpherson',
    'ifs_double_wishbone', 'leaf_spring', 'other'
  ));

CREATE INDEX idx_front_susp_config_vehicle ON front_suspension_config(vehicle_id);

COMMENT ON TABLE front_suspension_config IS 'Front suspension configuration and alignment specifications. One row per vehicle.';
COMMENT ON COLUMN front_suspension_config.id IS 'Primary key.';
COMMENT ON COLUMN front_suspension_config.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN front_suspension_config.suspension_type IS 'Type: solid_axle, ifs_torsion_bar, ifs_coilover, ifs_macpherson, ifs_double_wishbone, leaf_spring, other.';
COMMENT ON COLUMN front_suspension_config.subframe_type IS 'Subframe style, e.g. bolt_in, welded, tubular, unibody, none.';
COMMENT ON COLUMN front_suspension_config.crossmember_part_number IS 'Crossmember or subframe part number.';
COMMENT ON COLUMN front_suspension_config.ride_height_spec_mm IS 'Factory ride height specification in mm.';
COMMENT ON COLUMN front_suspension_config.wheel_travel_mm IS 'Total wheel travel in mm.';
COMMENT ON COLUMN front_suspension_config.caster_degrees IS 'Caster angle specification in degrees. Positive = rearward tilt.';
COMMENT ON COLUMN front_suspension_config.caster_tolerance IS 'Caster tolerance +/- in degrees.';
COMMENT ON COLUMN front_suspension_config.camber_degrees IS 'Camber angle specification in degrees. Negative = top inward.';
COMMENT ON COLUMN front_suspension_config.camber_tolerance IS 'Camber tolerance +/- in degrees.';
COMMENT ON COLUMN front_suspension_config.toe_in_mm IS 'Toe-in specification in mm. Positive = toe-in, negative = toe-out.';
COMMENT ON COLUMN front_suspension_config.toe_tolerance_mm IS 'Toe tolerance +/- in mm.';
COMMENT ON COLUMN front_suspension_config.steering_axis_inclination_degrees IS 'Steering axis inclination (SAI/KPI) in degrees.';
COMMENT ON COLUMN front_suspension_config.scrub_radius_mm IS 'Scrub radius at ground level in mm. Positive = offset outward.';
COMMENT ON COLUMN front_suspension_config.turning_radius_ft IS 'Curb-to-curb turning radius in feet.';
COMMENT ON COLUMN front_suspension_config.is_original IS 'True if factory-original suspension configuration.';
COMMENT ON COLUMN front_suspension_config.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN front_suspension_config.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN front_suspension_config.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN front_suspension_config.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN front_suspension_config.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN front_suspension_config.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 2. FRONT_SPRINGS — coil, leaf, or torsion bar
-- ============================================================

CREATE TABLE front_springs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  side TEXT NOT NULL,

  -- Specification
  spring_type TEXT,
  rate_lbs_in NUMERIC(6,1),
  free_length_inches NUMERIC(5,2),
  installed_length_inches NUMERIC(5,2),
  material TEXT,
  wire_diameter_mm NUMERIC(5,2),
  coil_count NUMERIC(4,1),
  leaf_count INTEGER,
  leaf_width_inches NUMERIC(4,2),
  torsion_bar_diameter_mm NUMERIC(5,2),
  torsion_bar_length_mm NUMERIC(6,1),
  progressive_rate BOOLEAN DEFAULT FALSE,
  part_number TEXT,
  manufacturer TEXT,
  color_code TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE front_springs ADD CONSTRAINT chk_fs_side
  CHECK (side IN ('left', 'right'));
ALTER TABLE front_springs ADD CONSTRAINT chk_fs_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE front_springs ADD CONSTRAINT chk_fs_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE front_springs ADD CONSTRAINT chk_fs_type
  CHECK (spring_type IS NULL OR spring_type IN ('coil', 'leaf', 'torsion_bar', 'air', 'other'));
ALTER TABLE front_springs ADD CONSTRAINT chk_fs_material
  CHECK (material IS NULL OR material IN ('steel', 'chrome_vanadium', 'chrome_silicon', 'composite', 'other'));

CREATE INDEX idx_front_springs_vehicle ON front_springs(vehicle_id);

COMMENT ON TABLE front_springs IS 'Front spring specifications per side. One row per spring (left/right).';
COMMENT ON COLUMN front_springs.id IS 'Primary key.';
COMMENT ON COLUMN front_springs.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN front_springs.side IS 'Which side: left or right.';
COMMENT ON COLUMN front_springs.spring_type IS 'Spring type: coil, leaf, torsion_bar, air, other.';
COMMENT ON COLUMN front_springs.rate_lbs_in IS 'Spring rate in pounds per inch.';
COMMENT ON COLUMN front_springs.free_length_inches IS 'Uncompressed free length in inches (coil springs).';
COMMENT ON COLUMN front_springs.installed_length_inches IS 'Installed/compressed length in inches.';
COMMENT ON COLUMN front_springs.material IS 'Spring material: steel, chrome_vanadium, chrome_silicon, composite, other.';
COMMENT ON COLUMN front_springs.wire_diameter_mm IS 'Coil spring wire diameter in mm.';
COMMENT ON COLUMN front_springs.coil_count IS 'Number of coils (coil springs). May be fractional e.g. 5.5.';
COMMENT ON COLUMN front_springs.leaf_count IS 'Number of leaves (leaf springs).';
COMMENT ON COLUMN front_springs.leaf_width_inches IS 'Leaf width in inches (leaf springs).';
COMMENT ON COLUMN front_springs.torsion_bar_diameter_mm IS 'Torsion bar diameter in mm.';
COMMENT ON COLUMN front_springs.torsion_bar_length_mm IS 'Torsion bar effective length in mm.';
COMMENT ON COLUMN front_springs.progressive_rate IS 'True if spring has a progressive (variable) rate.';
COMMENT ON COLUMN front_springs.part_number IS 'Spring part number.';
COMMENT ON COLUMN front_springs.manufacturer IS 'Spring manufacturer.';
COMMENT ON COLUMN front_springs.color_code IS 'Factory color code or stripe identification.';
COMMENT ON COLUMN front_springs.is_original IS 'True if factory-installed spring.';
COMMENT ON COLUMN front_springs.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN front_springs.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN front_springs.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN front_springs.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN front_springs.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN front_springs.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 3. FRONT_DAMPERS — shock absorbers per side
-- ============================================================

CREATE TABLE front_dampers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  side TEXT NOT NULL,

  -- Specification
  manufacturer TEXT,
  model TEXT,
  part_number TEXT,
  damper_type TEXT,
  valving TEXT,
  adjustable BOOLEAN DEFAULT FALSE,
  adjustment_positions INTEGER,
  extended_length_inches NUMERIC(5,2),
  compressed_length_inches NUMERIC(5,2),
  shaft_diameter_mm NUMERIC(5,2),
  body_diameter_mm NUMERIC(5,2),
  mount_type_upper TEXT,
  mount_type_lower TEXT,
  reservoir_type TEXT,
  gas_charged BOOLEAN,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE front_dampers ADD CONSTRAINT chk_fd_side
  CHECK (side IN ('left', 'right'));
ALTER TABLE front_dampers ADD CONSTRAINT chk_fd_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE front_dampers ADD CONSTRAINT chk_fd_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE front_dampers ADD CONSTRAINT chk_fd_type
  CHECK (damper_type IS NULL OR damper_type IN ('mono_tube', 'twin_tube', 'coilover', 'air', 'other'));

CREATE INDEX idx_front_dampers_vehicle ON front_dampers(vehicle_id);

COMMENT ON TABLE front_dampers IS 'Front shock absorber/damper specifications per side.';
COMMENT ON COLUMN front_dampers.id IS 'Primary key.';
COMMENT ON COLUMN front_dampers.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN front_dampers.side IS 'Which side: left or right.';
COMMENT ON COLUMN front_dampers.manufacturer IS 'Damper manufacturer, e.g. Bilstein, Monroe, KYB, Koni.';
COMMENT ON COLUMN front_dampers.model IS 'Model name, e.g. 5100 Series, Sensatrac, Sport.';
COMMENT ON COLUMN front_dampers.part_number IS 'Manufacturer part number.';
COMMENT ON COLUMN front_dampers.damper_type IS 'Type: mono_tube, twin_tube, coilover, air, other.';
COMMENT ON COLUMN front_dampers.valving IS 'Valving description or specification.';
COMMENT ON COLUMN front_dampers.adjustable IS 'True if damping is externally adjustable.';
COMMENT ON COLUMN front_dampers.adjustment_positions IS 'Number of adjustment positions if adjustable.';
COMMENT ON COLUMN front_dampers.extended_length_inches IS 'Fully extended length in inches.';
COMMENT ON COLUMN front_dampers.compressed_length_inches IS 'Fully compressed length in inches.';
COMMENT ON COLUMN front_dampers.shaft_diameter_mm IS 'Piston shaft diameter in mm.';
COMMENT ON COLUMN front_dampers.body_diameter_mm IS 'Shock body outer diameter in mm.';
COMMENT ON COLUMN front_dampers.mount_type_upper IS 'Upper mount type, e.g. stem, bar_pin, eye, stud.';
COMMENT ON COLUMN front_dampers.mount_type_lower IS 'Lower mount type, e.g. stem, bar_pin, eye, stud.';
COMMENT ON COLUMN front_dampers.reservoir_type IS 'Reservoir type, e.g. internal, remote, piggyback, none.';
COMMENT ON COLUMN front_dampers.gas_charged IS 'True if gas (nitrogen) charged.';
COMMENT ON COLUMN front_dampers.is_original IS 'True if factory-installed damper.';
COMMENT ON COLUMN front_dampers.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN front_dampers.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN front_dampers.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN front_dampers.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN front_dampers.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN front_dampers.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 4. FRONT_SWAY_BARS
-- ============================================================

CREATE TABLE front_sway_bars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Specification
  diameter_mm NUMERIC(5,2),
  material TEXT,
  type TEXT,
  end_link_type TEXT,
  end_link_part_number TEXT,
  bushing_type TEXT,
  bushing_material TEXT,
  adjustable BOOLEAN DEFAULT FALSE,
  adjustment_holes INTEGER,
  part_number TEXT,
  manufacturer TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE front_sway_bars ADD CONSTRAINT chk_fsb_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE front_sway_bars ADD CONSTRAINT chk_fsb_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE front_sway_bars ADD CONSTRAINT chk_fsb_material
  CHECK (material IS NULL OR material IN ('steel', 'chromoly', 'aluminum', 'hollow', 'other'));
ALTER TABLE front_sway_bars ADD CONSTRAINT chk_fsb_type
  CHECK (type IS NULL OR type IN ('solid', 'hollow', 'splined', 'other'));
ALTER TABLE front_sway_bars ADD CONSTRAINT chk_fsb_bushing_material
  CHECK (bushing_material IS NULL OR bushing_material IN ('rubber', 'polyurethane', 'delrin', 'bronze', 'spherical', 'other'));

CREATE INDEX idx_front_sway_bars_vehicle ON front_sway_bars(vehicle_id);

COMMENT ON TABLE front_sway_bars IS 'Front anti-roll (sway) bar specifications.';
COMMENT ON COLUMN front_sway_bars.id IS 'Primary key.';
COMMENT ON COLUMN front_sway_bars.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN front_sway_bars.diameter_mm IS 'Bar diameter in mm.';
COMMENT ON COLUMN front_sway_bars.material IS 'Bar material: steel, chromoly, aluminum, hollow, other.';
COMMENT ON COLUMN front_sway_bars.type IS 'Bar construction: solid, hollow, splined, other.';
COMMENT ON COLUMN front_sway_bars.end_link_type IS 'End link type, e.g. dogbone, ball_joint, adjustable_rod_end.';
COMMENT ON COLUMN front_sway_bars.end_link_part_number IS 'End link part number.';
COMMENT ON COLUMN front_sway_bars.bushing_type IS 'Bushing style, e.g. split, clam_shell, greaseable.';
COMMENT ON COLUMN front_sway_bars.bushing_material IS 'Bushing material: rubber, polyurethane, delrin, bronze, spherical, other.';
COMMENT ON COLUMN front_sway_bars.adjustable IS 'True if bar has multiple mounting holes for rate adjustment.';
COMMENT ON COLUMN front_sway_bars.adjustment_holes IS 'Number of adjustment holes per arm.';
COMMENT ON COLUMN front_sway_bars.part_number IS 'Sway bar part number.';
COMMENT ON COLUMN front_sway_bars.manufacturer IS 'Manufacturer, e.g. Addco, Hellwig, factory.';
COMMENT ON COLUMN front_sway_bars.is_original IS 'True if factory-installed sway bar.';
COMMENT ON COLUMN front_sway_bars.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN front_sway_bars.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN front_sway_bars.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN front_sway_bars.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN front_sway_bars.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN front_sway_bars.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 5. FRONT_CONTROL_ARMS — upper and lower per side
-- ============================================================

CREATE TABLE front_control_arms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  side TEXT NOT NULL,
  position TEXT NOT NULL,

  -- Specification
  material TEXT,
  construction TEXT,
  bushing_type TEXT,
  bushing_material TEXT,
  ball_joint_type TEXT,
  ball_joint_manufacturer TEXT,
  ball_joint_part_number TEXT,
  shaft_type TEXT,
  cross_shaft_part_number TEXT,
  part_number TEXT,
  manufacturer TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE front_control_arms ADD CONSTRAINT chk_fca_side
  CHECK (side IN ('left', 'right'));
ALTER TABLE front_control_arms ADD CONSTRAINT chk_fca_position
  CHECK (position IN ('upper', 'lower'));
ALTER TABLE front_control_arms ADD CONSTRAINT chk_fca_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE front_control_arms ADD CONSTRAINT chk_fca_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE front_control_arms ADD CONSTRAINT chk_fca_material
  CHECK (material IS NULL OR material IN ('stamped_steel', 'cast_iron', 'forged_steel', 'tubular_steel', 'aluminum', 'chromoly', 'other'));
ALTER TABLE front_control_arms ADD CONSTRAINT chk_fca_bushing_material
  CHECK (bushing_material IS NULL OR bushing_material IN ('rubber', 'polyurethane', 'delrin', 'spherical', 'other'));
ALTER TABLE front_control_arms ADD CONSTRAINT chk_fca_ball_joint
  CHECK (ball_joint_type IS NULL OR ball_joint_type IN ('press_in', 'bolt_in', 'screw_in', 'riveted', 'other'));

CREATE INDEX idx_front_ctrl_arms_vehicle ON front_control_arms(vehicle_id);

COMMENT ON TABLE front_control_arms IS 'Front control arm (A-arm) specifications. One row per arm (upper/lower, left/right).';
COMMENT ON COLUMN front_control_arms.id IS 'Primary key.';
COMMENT ON COLUMN front_control_arms.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN front_control_arms.side IS 'Which side: left or right.';
COMMENT ON COLUMN front_control_arms.position IS 'Arm position: upper or lower.';
COMMENT ON COLUMN front_control_arms.material IS 'Arm material: stamped_steel, cast_iron, forged_steel, tubular_steel, aluminum, chromoly, other.';
COMMENT ON COLUMN front_control_arms.construction IS 'Construction style, e.g. stamped, boxed, tubular, forged.';
COMMENT ON COLUMN front_control_arms.bushing_type IS 'Bushing style, e.g. press_in, bolt_through, bonded.';
COMMENT ON COLUMN front_control_arms.bushing_material IS 'Bushing material: rubber, polyurethane, delrin, spherical, other.';
COMMENT ON COLUMN front_control_arms.ball_joint_type IS 'Ball joint mounting: press_in, bolt_in, screw_in, riveted, other.';
COMMENT ON COLUMN front_control_arms.ball_joint_manufacturer IS 'Ball joint manufacturer, e.g. Moog, TRW, Spicer.';
COMMENT ON COLUMN front_control_arms.ball_joint_part_number IS 'Ball joint part number.';
COMMENT ON COLUMN front_control_arms.shaft_type IS 'Control arm shaft type, e.g. factory, offset_for_alignment.';
COMMENT ON COLUMN front_control_arms.cross_shaft_part_number IS 'Cross shaft or pivot bolt part number.';
COMMENT ON COLUMN front_control_arms.part_number IS 'Control arm assembly part number.';
COMMENT ON COLUMN front_control_arms.manufacturer IS 'Arm manufacturer.';
COMMENT ON COLUMN front_control_arms.is_original IS 'True if factory-installed control arm.';
COMMENT ON COLUMN front_control_arms.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN front_control_arms.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN front_control_arms.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN front_control_arms.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN front_control_arms.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN front_control_arms.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 6. FRONT_STEERING_KNUCKLES — per side
-- ============================================================

CREATE TABLE front_steering_knuckles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  side TEXT NOT NULL,

  -- Specification
  material TEXT,
  spindle_type TEXT,
  bearing_type TEXT,
  hub_integration TEXT,
  rotor_mounting TEXT,
  caliper_mounting TEXT,
  steering_arm_type TEXT,
  part_number TEXT,
  manufacturer TEXT,
  casting_number TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE front_steering_knuckles ADD CONSTRAINT chk_fsk_side
  CHECK (side IN ('left', 'right'));
ALTER TABLE front_steering_knuckles ADD CONSTRAINT chk_fsk_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE front_steering_knuckles ADD CONSTRAINT chk_fsk_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE front_steering_knuckles ADD CONSTRAINT chk_fsk_material
  CHECK (material IS NULL OR material IN ('cast_iron', 'ductile_iron', 'forged_steel', 'aluminum', 'other'));
ALTER TABLE front_steering_knuckles ADD CONSTRAINT chk_fsk_bearing
  CHECK (bearing_type IS NULL OR bearing_type IN ('tapered_roller', 'ball_bearing', 'unit_bearing', 'king_pin', 'other'));
ALTER TABLE front_steering_knuckles ADD CONSTRAINT chk_fsk_hub
  CHECK (hub_integration IS NULL OR hub_integration IN ('separate_hub', 'integral_hub', 'unit_bearing', 'other'));

CREATE INDEX idx_front_knuckles_vehicle ON front_steering_knuckles(vehicle_id);

COMMENT ON TABLE front_steering_knuckles IS 'Front steering knuckle/spindle specifications per side.';
COMMENT ON COLUMN front_steering_knuckles.id IS 'Primary key.';
COMMENT ON COLUMN front_steering_knuckles.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN front_steering_knuckles.side IS 'Which side: left or right.';
COMMENT ON COLUMN front_steering_knuckles.material IS 'Knuckle material: cast_iron, ductile_iron, forged_steel, aluminum, other.';
COMMENT ON COLUMN front_steering_knuckles.spindle_type IS 'Spindle type, e.g. integral, press_on, bolt_on.';
COMMENT ON COLUMN front_steering_knuckles.bearing_type IS 'Wheel bearing type: tapered_roller, ball_bearing, unit_bearing, king_pin, other.';
COMMENT ON COLUMN front_steering_knuckles.hub_integration IS 'Hub integration: separate_hub, integral_hub, unit_bearing, other.';
COMMENT ON COLUMN front_steering_knuckles.rotor_mounting IS 'Rotor mounting style, e.g. hat_mount, hub_mount, lug_mount.';
COMMENT ON COLUMN front_steering_knuckles.caliper_mounting IS 'Caliper bracket mounting description.';
COMMENT ON COLUMN front_steering_knuckles.steering_arm_type IS 'Steering arm integration, e.g. integral, bolt_on.';
COMMENT ON COLUMN front_steering_knuckles.part_number IS 'Knuckle part number.';
COMMENT ON COLUMN front_steering_knuckles.manufacturer IS 'Knuckle manufacturer.';
COMMENT ON COLUMN front_steering_knuckles.casting_number IS 'Casting number on the knuckle.';
COMMENT ON COLUMN front_steering_knuckles.is_original IS 'True if factory-installed knuckle.';
COMMENT ON COLUMN front_steering_knuckles.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN front_steering_knuckles.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN front_steering_knuckles.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN front_steering_knuckles.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN front_steering_knuckles.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN front_steering_knuckles.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- REAR SUSPENSION
-- ============================================================


-- ============================================================
-- 7. REAR_SUSPENSION_CONFIG — type and alignment specs
-- ============================================================

CREATE TABLE rear_suspension_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Configuration
  suspension_type TEXT,
  axle_type TEXT,
  axle_ratio TEXT,
  axle_spline_count INTEGER,
  axle_part_number TEXT,
  ride_height_spec_mm NUMERIC(6,1),
  wheel_travel_mm NUMERIC(5,1),

  -- Alignment specifications
  camber_degrees NUMERIC(5,2),
  camber_tolerance NUMERIC(4,2),
  toe_in_mm NUMERIC(5,2),
  toe_tolerance_mm NUMERIC(4,2),
  thrust_angle_degrees NUMERIC(5,2),
  thrust_angle_tolerance NUMERIC(4,2),
  pinion_angle_degrees NUMERIC(5,2),

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rear_suspension_config ADD CONSTRAINT chk_rsc_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE rear_suspension_config ADD CONSTRAINT chk_rsc_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE rear_suspension_config ADD CONSTRAINT chk_rsc_type
  CHECK (suspension_type IS NULL OR suspension_type IN (
    'leaf_spring', 'coil_spring', 'coilover', 'irs', 'torsion_bar', 'air_ride', 'other'
  ));
ALTER TABLE rear_suspension_config ADD CONSTRAINT chk_rsc_axle_type
  CHECK (axle_type IS NULL OR axle_type IN (
    'semi_floating', 'full_floating', 'independent', '3_quarter_floating', 'other'
  ));

CREATE INDEX idx_rear_susp_config_vehicle ON rear_suspension_config(vehicle_id);

COMMENT ON TABLE rear_suspension_config IS 'Rear suspension configuration and alignment specifications. One row per vehicle.';
COMMENT ON COLUMN rear_suspension_config.id IS 'Primary key.';
COMMENT ON COLUMN rear_suspension_config.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN rear_suspension_config.suspension_type IS 'Type: leaf_spring, coil_spring, coilover, irs, torsion_bar, air_ride, other.';
COMMENT ON COLUMN rear_suspension_config.axle_type IS 'Axle type: semi_floating, full_floating, independent, 3_quarter_floating, other.';
COMMENT ON COLUMN rear_suspension_config.axle_ratio IS 'Ring and pinion ratio, e.g. 3.73, 4.10, 4.56.';
COMMENT ON COLUMN rear_suspension_config.axle_spline_count IS 'Axle shaft spline count, e.g. 28, 31, 33, 35, 40.';
COMMENT ON COLUMN rear_suspension_config.axle_part_number IS 'Axle housing or assembly part number.';
COMMENT ON COLUMN rear_suspension_config.ride_height_spec_mm IS 'Factory ride height specification in mm.';
COMMENT ON COLUMN rear_suspension_config.wheel_travel_mm IS 'Total wheel travel in mm.';
COMMENT ON COLUMN rear_suspension_config.camber_degrees IS 'Rear camber specification in degrees.';
COMMENT ON COLUMN rear_suspension_config.camber_tolerance IS 'Rear camber tolerance +/- in degrees.';
COMMENT ON COLUMN rear_suspension_config.toe_in_mm IS 'Rear toe specification in mm.';
COMMENT ON COLUMN rear_suspension_config.toe_tolerance_mm IS 'Rear toe tolerance +/- in mm.';
COMMENT ON COLUMN rear_suspension_config.thrust_angle_degrees IS 'Thrust angle specification in degrees.';
COMMENT ON COLUMN rear_suspension_config.thrust_angle_tolerance IS 'Thrust angle tolerance +/- in degrees.';
COMMENT ON COLUMN rear_suspension_config.pinion_angle_degrees IS 'Driveshaft pinion angle in degrees.';
COMMENT ON COLUMN rear_suspension_config.is_original IS 'True if factory-original rear suspension configuration.';
COMMENT ON COLUMN rear_suspension_config.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN rear_suspension_config.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN rear_suspension_config.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN rear_suspension_config.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN rear_suspension_config.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN rear_suspension_config.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 8. REAR_SPRINGS — per side
-- ============================================================

CREATE TABLE rear_springs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  side TEXT NOT NULL,

  -- Specification
  spring_type TEXT,
  rate_lbs_in NUMERIC(6,1),
  free_length_inches NUMERIC(5,2),
  installed_length_inches NUMERIC(5,2),
  material TEXT,
  wire_diameter_mm NUMERIC(5,2),
  coil_count NUMERIC(4,1),
  leaf_count INTEGER,
  leaf_width_inches NUMERIC(4,2),
  leaf_thickness_inches NUMERIC(4,3),
  eye_type TEXT,
  progressive_rate BOOLEAN DEFAULT FALSE,
  helper_spring BOOLEAN DEFAULT FALSE,
  overload_leaf BOOLEAN DEFAULT FALSE,
  part_number TEXT,
  manufacturer TEXT,
  color_code TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rear_springs ADD CONSTRAINT chk_rs_side
  CHECK (side IN ('left', 'right'));
ALTER TABLE rear_springs ADD CONSTRAINT chk_rs_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE rear_springs ADD CONSTRAINT chk_rs_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE rear_springs ADD CONSTRAINT chk_rs_type
  CHECK (spring_type IS NULL OR spring_type IN ('coil', 'leaf', 'torsion_bar', 'air', 'other'));
ALTER TABLE rear_springs ADD CONSTRAINT chk_rs_material
  CHECK (material IS NULL OR material IN ('steel', 'chrome_vanadium', 'chrome_silicon', 'composite', 'other'));

CREATE INDEX idx_rear_springs_vehicle ON rear_springs(vehicle_id);

COMMENT ON TABLE rear_springs IS 'Rear spring specifications per side. One row per spring (left/right).';
COMMENT ON COLUMN rear_springs.id IS 'Primary key.';
COMMENT ON COLUMN rear_springs.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN rear_springs.side IS 'Which side: left or right.';
COMMENT ON COLUMN rear_springs.spring_type IS 'Spring type: coil, leaf, torsion_bar, air, other.';
COMMENT ON COLUMN rear_springs.rate_lbs_in IS 'Spring rate in pounds per inch.';
COMMENT ON COLUMN rear_springs.free_length_inches IS 'Uncompressed free length in inches (coil springs).';
COMMENT ON COLUMN rear_springs.installed_length_inches IS 'Installed/compressed length in inches.';
COMMENT ON COLUMN rear_springs.material IS 'Spring material: steel, chrome_vanadium, chrome_silicon, composite, other.';
COMMENT ON COLUMN rear_springs.wire_diameter_mm IS 'Coil spring wire diameter in mm.';
COMMENT ON COLUMN rear_springs.coil_count IS 'Number of coils (coil springs). May be fractional.';
COMMENT ON COLUMN rear_springs.leaf_count IS 'Number of leaves (leaf springs).';
COMMENT ON COLUMN rear_springs.leaf_width_inches IS 'Leaf width in inches (leaf springs).';
COMMENT ON COLUMN rear_springs.leaf_thickness_inches IS 'Individual leaf thickness in inches.';
COMMENT ON COLUMN rear_springs.eye_type IS 'Leaf spring eye type, e.g. standard_eye, military_wrap, berlin_eye.';
COMMENT ON COLUMN rear_springs.progressive_rate IS 'True if spring has a progressive (variable) rate.';
COMMENT ON COLUMN rear_springs.helper_spring IS 'True if helper/overload spring is present.';
COMMENT ON COLUMN rear_springs.overload_leaf IS 'True if an overload leaf is included in the pack.';
COMMENT ON COLUMN rear_springs.part_number IS 'Spring part number.';
COMMENT ON COLUMN rear_springs.manufacturer IS 'Spring manufacturer.';
COMMENT ON COLUMN rear_springs.color_code IS 'Factory color code or stripe identification.';
COMMENT ON COLUMN rear_springs.is_original IS 'True if factory-installed spring.';
COMMENT ON COLUMN rear_springs.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN rear_springs.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN rear_springs.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN rear_springs.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN rear_springs.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN rear_springs.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 9. REAR_DAMPERS — per side (same pattern as front)
-- ============================================================

CREATE TABLE rear_dampers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  side TEXT NOT NULL,

  -- Specification
  manufacturer TEXT,
  model TEXT,
  part_number TEXT,
  damper_type TEXT,
  valving TEXT,
  adjustable BOOLEAN DEFAULT FALSE,
  adjustment_positions INTEGER,
  extended_length_inches NUMERIC(5,2),
  compressed_length_inches NUMERIC(5,2),
  shaft_diameter_mm NUMERIC(5,2),
  body_diameter_mm NUMERIC(5,2),
  mount_type_upper TEXT,
  mount_type_lower TEXT,
  reservoir_type TEXT,
  gas_charged BOOLEAN,
  stagger_position TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rear_dampers ADD CONSTRAINT chk_rd_side
  CHECK (side IN ('left', 'right'));
ALTER TABLE rear_dampers ADD CONSTRAINT chk_rd_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE rear_dampers ADD CONSTRAINT chk_rd_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE rear_dampers ADD CONSTRAINT chk_rd_type
  CHECK (damper_type IS NULL OR damper_type IN ('mono_tube', 'twin_tube', 'coilover', 'air', 'other'));

CREATE INDEX idx_rear_dampers_vehicle ON rear_dampers(vehicle_id);

COMMENT ON TABLE rear_dampers IS 'Rear shock absorber/damper specifications per side.';
COMMENT ON COLUMN rear_dampers.id IS 'Primary key.';
COMMENT ON COLUMN rear_dampers.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN rear_dampers.side IS 'Which side: left or right.';
COMMENT ON COLUMN rear_dampers.manufacturer IS 'Damper manufacturer, e.g. Bilstein, Monroe, KYB, Koni.';
COMMENT ON COLUMN rear_dampers.model IS 'Model name, e.g. 5100 Series, Sensatrac, Sport.';
COMMENT ON COLUMN rear_dampers.part_number IS 'Manufacturer part number.';
COMMENT ON COLUMN rear_dampers.damper_type IS 'Type: mono_tube, twin_tube, coilover, air, other.';
COMMENT ON COLUMN rear_dampers.valving IS 'Valving description or specification.';
COMMENT ON COLUMN rear_dampers.adjustable IS 'True if damping is externally adjustable.';
COMMENT ON COLUMN rear_dampers.adjustment_positions IS 'Number of adjustment positions if adjustable.';
COMMENT ON COLUMN rear_dampers.extended_length_inches IS 'Fully extended length in inches.';
COMMENT ON COLUMN rear_dampers.compressed_length_inches IS 'Fully compressed length in inches.';
COMMENT ON COLUMN rear_dampers.shaft_diameter_mm IS 'Piston shaft diameter in mm.';
COMMENT ON COLUMN rear_dampers.body_diameter_mm IS 'Shock body outer diameter in mm.';
COMMENT ON COLUMN rear_dampers.mount_type_upper IS 'Upper mount type, e.g. stem, bar_pin, eye, stud.';
COMMENT ON COLUMN rear_dampers.mount_type_lower IS 'Lower mount type, e.g. stem, bar_pin, eye, stud.';
COMMENT ON COLUMN rear_dampers.reservoir_type IS 'Reservoir type, e.g. internal, remote, piggyback, none.';
COMMENT ON COLUMN rear_dampers.gas_charged IS 'True if gas (nitrogen) charged.';
COMMENT ON COLUMN rear_dampers.stagger_position IS 'Stagger shock position if applicable, e.g. front_of_axle, rear_of_axle.';
COMMENT ON COLUMN rear_dampers.is_original IS 'True if factory-installed damper.';
COMMENT ON COLUMN rear_dampers.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN rear_dampers.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN rear_dampers.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN rear_dampers.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN rear_dampers.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN rear_dampers.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 10. REAR_SWAY_BARS — same pattern as front
-- ============================================================

CREATE TABLE rear_sway_bars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Specification
  diameter_mm NUMERIC(5,2),
  material TEXT,
  type TEXT,
  end_link_type TEXT,
  end_link_part_number TEXT,
  bushing_type TEXT,
  bushing_material TEXT,
  adjustable BOOLEAN DEFAULT FALSE,
  adjustment_holes INTEGER,
  part_number TEXT,
  manufacturer TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rear_sway_bars ADD CONSTRAINT chk_rsb_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE rear_sway_bars ADD CONSTRAINT chk_rsb_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE rear_sway_bars ADD CONSTRAINT chk_rsb_material
  CHECK (material IS NULL OR material IN ('steel', 'chromoly', 'aluminum', 'hollow', 'other'));
ALTER TABLE rear_sway_bars ADD CONSTRAINT chk_rsb_type
  CHECK (type IS NULL OR type IN ('solid', 'hollow', 'splined', 'other'));
ALTER TABLE rear_sway_bars ADD CONSTRAINT chk_rsb_bushing_material
  CHECK (bushing_material IS NULL OR bushing_material IN ('rubber', 'polyurethane', 'delrin', 'bronze', 'spherical', 'other'));

CREATE INDEX idx_rear_sway_bars_vehicle ON rear_sway_bars(vehicle_id);

COMMENT ON TABLE rear_sway_bars IS 'Rear anti-roll (sway) bar specifications.';
COMMENT ON COLUMN rear_sway_bars.id IS 'Primary key.';
COMMENT ON COLUMN rear_sway_bars.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN rear_sway_bars.diameter_mm IS 'Bar diameter in mm.';
COMMENT ON COLUMN rear_sway_bars.material IS 'Bar material: steel, chromoly, aluminum, hollow, other.';
COMMENT ON COLUMN rear_sway_bars.type IS 'Bar construction: solid, hollow, splined, other.';
COMMENT ON COLUMN rear_sway_bars.end_link_type IS 'End link type, e.g. dogbone, ball_joint, adjustable_rod_end.';
COMMENT ON COLUMN rear_sway_bars.end_link_part_number IS 'End link part number.';
COMMENT ON COLUMN rear_sway_bars.bushing_type IS 'Bushing style, e.g. split, clam_shell, greaseable.';
COMMENT ON COLUMN rear_sway_bars.bushing_material IS 'Bushing material: rubber, polyurethane, delrin, bronze, spherical, other.';
COMMENT ON COLUMN rear_sway_bars.adjustable IS 'True if bar has multiple mounting holes for rate adjustment.';
COMMENT ON COLUMN rear_sway_bars.adjustment_holes IS 'Number of adjustment holes per arm.';
COMMENT ON COLUMN rear_sway_bars.part_number IS 'Sway bar part number.';
COMMENT ON COLUMN rear_sway_bars.manufacturer IS 'Manufacturer, e.g. Addco, Hellwig, factory.';
COMMENT ON COLUMN rear_sway_bars.is_original IS 'True if factory-installed sway bar.';
COMMENT ON COLUMN rear_sway_bars.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN rear_sway_bars.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN rear_sway_bars.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN rear_sway_bars.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN rear_sway_bars.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN rear_sway_bars.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 11. REAR_TRAILING_ARMS_AND_LINKS — suspension locating devices
-- ============================================================

CREATE TABLE rear_trailing_arms_and_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  side TEXT,
  link_position TEXT,

  -- Specification
  link_type TEXT,
  material TEXT,
  bushing_type TEXT,
  bushing_material TEXT,
  adjustable BOOLEAN DEFAULT FALSE,
  length_inches NUMERIC(5,2),
  part_number TEXT,
  manufacturer TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rear_trailing_arms_and_links ADD CONSTRAINT chk_rtal_side
  CHECK (side IS NULL OR side IN ('left', 'right', 'center'));
ALTER TABLE rear_trailing_arms_and_links ADD CONSTRAINT chk_rtal_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE rear_trailing_arms_and_links ADD CONSTRAINT chk_rtal_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE rear_trailing_arms_and_links ADD CONSTRAINT chk_rtal_link_type
  CHECK (link_type IS NULL OR link_type IN (
    'trailing_arm', '4_link', '3_link', 'watts_link', 'panhard',
    'torque_arm', 'ladder_bar', 'traction_bar', 'other'
  ));
ALTER TABLE rear_trailing_arms_and_links ADD CONSTRAINT chk_rtal_material
  CHECK (material IS NULL OR material IN ('steel', 'chromoly', 'aluminum', 'tubular_steel', 'other'));
ALTER TABLE rear_trailing_arms_and_links ADD CONSTRAINT chk_rtal_bushing_material
  CHECK (bushing_material IS NULL OR bushing_material IN ('rubber', 'polyurethane', 'delrin', 'spherical', 'other'));

CREATE INDEX idx_rear_links_vehicle ON rear_trailing_arms_and_links(vehicle_id);

COMMENT ON TABLE rear_trailing_arms_and_links IS 'Rear suspension locating links and trailing arms. One row per link.';
COMMENT ON COLUMN rear_trailing_arms_and_links.id IS 'Primary key.';
COMMENT ON COLUMN rear_trailing_arms_and_links.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN rear_trailing_arms_and_links.side IS 'Which side: left, right, or center (for panhard/watts). NULL for shared components.';
COMMENT ON COLUMN rear_trailing_arms_and_links.link_position IS 'Link position description, e.g. upper, lower, lateral, diagonal.';
COMMENT ON COLUMN rear_trailing_arms_and_links.link_type IS 'Link type: trailing_arm, 4_link, 3_link, watts_link, panhard, torque_arm, ladder_bar, traction_bar, other.';
COMMENT ON COLUMN rear_trailing_arms_and_links.material IS 'Link material: steel, chromoly, aluminum, tubular_steel, other.';
COMMENT ON COLUMN rear_trailing_arms_and_links.bushing_type IS 'Bushing style, e.g. press_in, bolt_through, bonded.';
COMMENT ON COLUMN rear_trailing_arms_and_links.bushing_material IS 'Bushing material: rubber, polyurethane, delrin, spherical, other.';
COMMENT ON COLUMN rear_trailing_arms_and_links.adjustable IS 'True if link length is adjustable (threaded body or heim joints).';
COMMENT ON COLUMN rear_trailing_arms_and_links.length_inches IS 'Link length center-to-center in inches.';
COMMENT ON COLUMN rear_trailing_arms_and_links.part_number IS 'Link part number.';
COMMENT ON COLUMN rear_trailing_arms_and_links.manufacturer IS 'Link manufacturer.';
COMMENT ON COLUMN rear_trailing_arms_and_links.is_original IS 'True if factory-installed link.';
COMMENT ON COLUMN rear_trailing_arms_and_links.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN rear_trailing_arms_and_links.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN rear_trailing_arms_and_links.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN rear_trailing_arms_and_links.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN rear_trailing_arms_and_links.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN rear_trailing_arms_and_links.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- STEERING
-- ============================================================


-- ============================================================
-- 12. STEERING_GEARBOXES
-- ============================================================

CREATE TABLE steering_gearboxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Specification
  gearbox_type TEXT,
  ratio_overall TEXT,
  ratio_on_center TEXT,
  turns_lock_to_lock NUMERIC(3,1),
  power_assist_type TEXT,
  manufacturer TEXT,
  part_number TEXT,
  casting_number TEXT,
  date_code TEXT,
  sector_shaft_spline_count INTEGER,
  input_shaft_spline_count INTEGER,
  mounting_bolt_count INTEGER,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE steering_gearboxes ADD CONSTRAINT chk_sgb_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE steering_gearboxes ADD CONSTRAINT chk_sgb_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE steering_gearboxes ADD CONSTRAINT chk_sgb_type
  CHECK (gearbox_type IS NULL OR gearbox_type IN (
    'recirculating_ball', 'rack_and_pinion', 'worm_and_sector',
    'worm_and_roller', 'cam_and_lever', 'other'
  ));
ALTER TABLE steering_gearboxes ADD CONSTRAINT chk_sgb_assist
  CHECK (power_assist_type IS NULL OR power_assist_type IN (
    'manual', 'hydraulic', 'electric', 'electro_hydraulic', 'other'
  ));

CREATE INDEX idx_steering_gearboxes_vehicle ON steering_gearboxes(vehicle_id);

COMMENT ON TABLE steering_gearboxes IS 'Steering gearbox/rack specifications. One row per steering gear installed.';
COMMENT ON COLUMN steering_gearboxes.id IS 'Primary key.';
COMMENT ON COLUMN steering_gearboxes.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN steering_gearboxes.gearbox_type IS 'Type: recirculating_ball, rack_and_pinion, worm_and_sector, worm_and_roller, cam_and_lever, other.';
COMMENT ON COLUMN steering_gearboxes.ratio_overall IS 'Overall steering ratio, e.g. 16:1, 12.7:1.';
COMMENT ON COLUMN steering_gearboxes.ratio_on_center IS 'On-center steering ratio if variable, e.g. 14:1.';
COMMENT ON COLUMN steering_gearboxes.turns_lock_to_lock IS 'Number of steering wheel turns lock to lock.';
COMMENT ON COLUMN steering_gearboxes.power_assist_type IS 'Assist type: manual, hydraulic, electric, electro_hydraulic, other.';
COMMENT ON COLUMN steering_gearboxes.manufacturer IS 'Gearbox manufacturer, e.g. Saginaw, Gemmer, ZF, TRW.';
COMMENT ON COLUMN steering_gearboxes.part_number IS 'Gearbox part number.';
COMMENT ON COLUMN steering_gearboxes.casting_number IS 'Casting number on the gearbox housing.';
COMMENT ON COLUMN steering_gearboxes.date_code IS 'Date code stamped on the gearbox.';
COMMENT ON COLUMN steering_gearboxes.sector_shaft_spline_count IS 'Output (sector/pitman) shaft spline count.';
COMMENT ON COLUMN steering_gearboxes.input_shaft_spline_count IS 'Input (steering column) shaft spline count.';
COMMENT ON COLUMN steering_gearboxes.mounting_bolt_count IS 'Number of frame mounting bolts, e.g. 3, 4.';
COMMENT ON COLUMN steering_gearboxes.is_original IS 'True if factory-installed steering gear.';
COMMENT ON COLUMN steering_gearboxes.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN steering_gearboxes.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN steering_gearboxes.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN steering_gearboxes.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN steering_gearboxes.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN steering_gearboxes.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 13. STEERING_COLUMNS
-- ============================================================

CREATE TABLE steering_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Specification
  column_type TEXT,
  collapsible BOOLEAN,
  key_type TEXT,
  column_shift BOOLEAN DEFAULT FALSE,
  shift_indicator TEXT,
  tilt_range_degrees NUMERIC(4,1),
  telescope_range_inches NUMERIC(3,1),
  upper_bearing_type TEXT,
  lower_bearing_type TEXT,
  intermediate_shaft_type TEXT,
  rag_joint BOOLEAN,
  part_number TEXT,
  manufacturer TEXT,
  length_inches NUMERIC(5,2),

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE steering_columns ADD CONSTRAINT chk_sc_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE steering_columns ADD CONSTRAINT chk_sc_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE steering_columns ADD CONSTRAINT chk_sc_type
  CHECK (column_type IS NULL OR column_type IN (
    'fixed', 'tilt', 'tilt_telescope', 'telescope', 'collapsible_fixed', 'other'
  ));
ALTER TABLE steering_columns ADD CONSTRAINT chk_sc_key_type
  CHECK (key_type IS NULL OR key_type IN (
    'ignition_lock', 'push_button', 'keyless', 'column_lock', 'other'
  ));

CREATE INDEX idx_steering_columns_vehicle ON steering_columns(vehicle_id);

COMMENT ON TABLE steering_columns IS 'Steering column specifications. One row per column installed.';
COMMENT ON COLUMN steering_columns.id IS 'Primary key.';
COMMENT ON COLUMN steering_columns.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN steering_columns.column_type IS 'Column type: fixed, tilt, tilt_telescope, telescope, collapsible_fixed, other.';
COMMENT ON COLUMN steering_columns.collapsible IS 'True if column is energy-absorbing/collapsible (post-1967 federal requirement).';
COMMENT ON COLUMN steering_columns.key_type IS 'Ignition key type: ignition_lock, push_button, keyless, column_lock, other.';
COMMENT ON COLUMN steering_columns.column_shift IS 'True if transmission shift lever is on the column.';
COMMENT ON COLUMN steering_columns.shift_indicator IS 'Shift indicator type, e.g. column_quadrant, dash_indicator, none.';
COMMENT ON COLUMN steering_columns.tilt_range_degrees IS 'Tilt adjustment range in degrees (tilt columns only).';
COMMENT ON COLUMN steering_columns.telescope_range_inches IS 'Telescope adjustment range in inches.';
COMMENT ON COLUMN steering_columns.upper_bearing_type IS 'Upper column bearing type.';
COMMENT ON COLUMN steering_columns.lower_bearing_type IS 'Lower column bearing type.';
COMMENT ON COLUMN steering_columns.intermediate_shaft_type IS 'Intermediate shaft type, e.g. solid, collapsible, universal_joint.';
COMMENT ON COLUMN steering_columns.rag_joint IS 'True if steering column uses a rag joint (flexible coupling) at the gearbox.';
COMMENT ON COLUMN steering_columns.part_number IS 'Column assembly part number.';
COMMENT ON COLUMN steering_columns.manufacturer IS 'Column manufacturer.';
COMMENT ON COLUMN steering_columns.length_inches IS 'Column length in inches.';
COMMENT ON COLUMN steering_columns.is_original IS 'True if factory-installed column.';
COMMENT ON COLUMN steering_columns.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN steering_columns.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN steering_columns.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN steering_columns.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN steering_columns.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN steering_columns.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 14. STEERING_LINKAGE — tie rods, drag link, pitman/idler arms
-- ============================================================

CREATE TABLE steering_linkage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Specification
  linkage_type TEXT,
  tie_rod_type TEXT,
  tie_rod_end_type TEXT,
  tie_rod_end_manufacturer TEXT,
  tie_rod_end_part_number TEXT,
  drag_link_type TEXT,
  drag_link_part_number TEXT,
  pitman_arm_type TEXT,
  pitman_arm_part_number TEXT,
  pitman_arm_spline_count INTEGER,
  idler_arm_type TEXT,
  idler_arm_part_number TEXT,
  center_link_part_number TEXT,
  relay_rod_part_number TEXT,
  sleeve_clamp_type TEXT,
  dampener_equipped BOOLEAN DEFAULT FALSE,
  dampener_manufacturer TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE steering_linkage ADD CONSTRAINT chk_sl_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE steering_linkage ADD CONSTRAINT chk_sl_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE steering_linkage ADD CONSTRAINT chk_sl_type
  CHECK (linkage_type IS NULL OR linkage_type IN (
    'parallelogram', 'rack', 'cross_steer', 'drag_link', 'other'
  ));
ALTER TABLE steering_linkage ADD CONSTRAINT chk_sl_tie_rod
  CHECK (tie_rod_type IS NULL OR tie_rod_type IN (
    'inner_outer', 'one_piece', 'adjustable_sleeve', 'other'
  ));

CREATE INDEX idx_steering_linkage_vehicle ON steering_linkage(vehicle_id);

COMMENT ON TABLE steering_linkage IS 'Steering linkage components: tie rods, drag link, pitman arm, idler arm, center link.';
COMMENT ON COLUMN steering_linkage.id IS 'Primary key.';
COMMENT ON COLUMN steering_linkage.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN steering_linkage.linkage_type IS 'Linkage geometry: parallelogram, rack, cross_steer, drag_link, other.';
COMMENT ON COLUMN steering_linkage.tie_rod_type IS 'Tie rod construction: inner_outer, one_piece, adjustable_sleeve, other.';
COMMENT ON COLUMN steering_linkage.tie_rod_end_type IS 'Tie rod end type, e.g. standard, greaseable, sealed.';
COMMENT ON COLUMN steering_linkage.tie_rod_end_manufacturer IS 'Tie rod end manufacturer, e.g. Moog, TRW, Spicer.';
COMMENT ON COLUMN steering_linkage.tie_rod_end_part_number IS 'Tie rod end part number.';
COMMENT ON COLUMN steering_linkage.drag_link_type IS 'Drag link type description.';
COMMENT ON COLUMN steering_linkage.drag_link_part_number IS 'Drag link part number.';
COMMENT ON COLUMN steering_linkage.pitman_arm_type IS 'Pitman arm type, e.g. standard, drop, raised.';
COMMENT ON COLUMN steering_linkage.pitman_arm_part_number IS 'Pitman arm part number.';
COMMENT ON COLUMN steering_linkage.pitman_arm_spline_count IS 'Pitman arm spline count for sector shaft fit.';
COMMENT ON COLUMN steering_linkage.idler_arm_type IS 'Idler arm type description.';
COMMENT ON COLUMN steering_linkage.idler_arm_part_number IS 'Idler arm part number.';
COMMENT ON COLUMN steering_linkage.center_link_part_number IS 'Center link (relay rod) part number.';
COMMENT ON COLUMN steering_linkage.relay_rod_part_number IS 'Relay rod part number (same as center link on some applications).';
COMMENT ON COLUMN steering_linkage.sleeve_clamp_type IS 'Tie rod adjusting sleeve clamp type, e.g. pinch_bolt, clamp.';
COMMENT ON COLUMN steering_linkage.dampener_equipped IS 'True if steering dampener/stabilizer is installed.';
COMMENT ON COLUMN steering_linkage.dampener_manufacturer IS 'Steering dampener manufacturer.';
COMMENT ON COLUMN steering_linkage.is_original IS 'True if factory-original steering linkage.';
COMMENT ON COLUMN steering_linkage.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN steering_linkage.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN steering_linkage.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN steering_linkage.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN steering_linkage.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN steering_linkage.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 15. POWER_STEERING_SYSTEMS
-- ============================================================

CREATE TABLE power_steering_systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Specification
  pump_type TEXT,
  pump_manufacturer TEXT,
  pump_part_number TEXT,
  pump_flow_rate_gpm NUMERIC(4,1),
  pump_max_pressure_psi INTEGER,
  fluid_type TEXT,
  fluid_capacity_oz NUMERIC(4,1),
  cooler_equipped BOOLEAN DEFAULT FALSE,
  cooler_type TEXT,
  hose_material TEXT,
  pressure_hose_part_number TEXT,
  return_hose_part_number TEXT,
  pressure_spec_psi INTEGER,
  reservoir_type TEXT,
  reservoir_part_number TEXT,
  filter_equipped BOOLEAN DEFAULT FALSE,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE power_steering_systems ADD CONSTRAINT chk_pss_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE power_steering_systems ADD CONSTRAINT chk_pss_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE power_steering_systems ADD CONSTRAINT chk_pss_pump_type
  CHECK (pump_type IS NULL OR pump_type IN (
    'saginaw_p_series', 'saginaw_tc', 'thompson', 'vane', 'gear',
    'electric', 'remote_reservoir', 'other'
  ));
ALTER TABLE power_steering_systems ADD CONSTRAINT chk_pss_hose_material
  CHECK (hose_material IS NULL OR hose_material IN (
    'rubber', 'braided_stainless', 'nylon', 'ptfe', 'other'
  ));

CREATE INDEX idx_power_steering_vehicle ON power_steering_systems(vehicle_id);

COMMENT ON TABLE power_steering_systems IS 'Power steering hydraulic/electric system specifications.';
COMMENT ON COLUMN power_steering_systems.id IS 'Primary key.';
COMMENT ON COLUMN power_steering_systems.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN power_steering_systems.pump_type IS 'Pump type: saginaw_p_series, saginaw_tc, thompson, vane, gear, electric, remote_reservoir, other.';
COMMENT ON COLUMN power_steering_systems.pump_manufacturer IS 'Pump manufacturer, e.g. Saginaw, Thompson, ZF.';
COMMENT ON COLUMN power_steering_systems.pump_part_number IS 'Pump part number.';
COMMENT ON COLUMN power_steering_systems.pump_flow_rate_gpm IS 'Pump flow rate in gallons per minute.';
COMMENT ON COLUMN power_steering_systems.pump_max_pressure_psi IS 'Maximum pump pressure in PSI.';
COMMENT ON COLUMN power_steering_systems.fluid_type IS 'Required fluid type, e.g. atf_dexron, power_steering_fluid, synthetic.';
COMMENT ON COLUMN power_steering_systems.fluid_capacity_oz IS 'System fluid capacity in ounces.';
COMMENT ON COLUMN power_steering_systems.cooler_equipped IS 'True if power steering cooler is installed.';
COMMENT ON COLUMN power_steering_systems.cooler_type IS 'Cooler type, e.g. tube_fin, remote, integrated_in_radiator.';
COMMENT ON COLUMN power_steering_systems.hose_material IS 'Hose material: rubber, braided_stainless, nylon, ptfe, other.';
COMMENT ON COLUMN power_steering_systems.pressure_hose_part_number IS 'High pressure hose part number.';
COMMENT ON COLUMN power_steering_systems.return_hose_part_number IS 'Return hose part number.';
COMMENT ON COLUMN power_steering_systems.pressure_spec_psi IS 'System operating pressure specification in PSI.';
COMMENT ON COLUMN power_steering_systems.reservoir_type IS 'Reservoir type, e.g. integral, remote, canister.';
COMMENT ON COLUMN power_steering_systems.reservoir_part_number IS 'Reservoir part number.';
COMMENT ON COLUMN power_steering_systems.filter_equipped IS 'True if in-line filter is installed.';
COMMENT ON COLUMN power_steering_systems.is_original IS 'True if factory-installed power steering system.';
COMMENT ON COLUMN power_steering_systems.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN power_steering_systems.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN power_steering_systems.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN power_steering_systems.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN power_steering_systems.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN power_steering_systems.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- BRAKES
-- ============================================================


-- ============================================================
-- 16. BRAKE_SYSTEMS — master configuration
-- ============================================================

CREATE TABLE brake_systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Configuration
  system_type TEXT,
  boost_type TEXT,
  booster_diameter_inches NUMERIC(4,1),
  booster_part_number TEXT,
  master_cylinder_bore_inches NUMERIC(4,3),
  master_cylinder_type TEXT,
  master_cylinder_part_number TEXT,
  proportioning_valve_type TEXT,
  proportioning_valve_adjustable BOOLEAN DEFAULT FALSE,
  proportioning_valve_part_number TEXT,
  distribution_block_type TEXT,
  abs_equipped BOOLEAN DEFAULT FALSE,
  abs_generation TEXT,
  abs_manufacturer TEXT,
  abs_module_part_number TEXT,
  parking_brake_type TEXT,
  parking_brake_actuation TEXT,
  brake_fluid_type TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE brake_systems ADD CONSTRAINT chk_bs_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE brake_systems ADD CONSTRAINT chk_bs_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE brake_systems ADD CONSTRAINT chk_bs_type
  CHECK (system_type IS NULL OR system_type IN (
    '4_wheel_disc', 'front_disc_rear_drum', '4_wheel_drum', 'other'
  ));
ALTER TABLE brake_systems ADD CONSTRAINT chk_bs_boost
  CHECK (boost_type IS NULL OR boost_type IN (
    'vacuum', 'hydroboost', 'electric', 'manual', 'other'
  ));

CREATE INDEX idx_brake_systems_vehicle ON brake_systems(vehicle_id);

COMMENT ON TABLE brake_systems IS 'Master brake system configuration: booster, master cylinder, proportioning, ABS.';
COMMENT ON COLUMN brake_systems.id IS 'Primary key.';
COMMENT ON COLUMN brake_systems.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN brake_systems.system_type IS 'Brake layout: 4_wheel_disc, front_disc_rear_drum, 4_wheel_drum, other.';
COMMENT ON COLUMN brake_systems.boost_type IS 'Brake assist type: vacuum, hydroboost, electric, manual, other.';
COMMENT ON COLUMN brake_systems.booster_diameter_inches IS 'Brake booster diaphragm diameter in inches, e.g. 9, 11.';
COMMENT ON COLUMN brake_systems.booster_part_number IS 'Brake booster part number.';
COMMENT ON COLUMN brake_systems.master_cylinder_bore_inches IS 'Master cylinder bore diameter in inches, e.g. 1.000, 1.125.';
COMMENT ON COLUMN brake_systems.master_cylinder_type IS 'Master cylinder type, e.g. single_reservoir, dual_reservoir, tandem.';
COMMENT ON COLUMN brake_systems.master_cylinder_part_number IS 'Master cylinder part number.';
COMMENT ON COLUMN brake_systems.proportioning_valve_type IS 'Proportioning valve type, e.g. fixed, height_sensing, adjustable.';
COMMENT ON COLUMN brake_systems.proportioning_valve_adjustable IS 'True if proportioning valve is adjustable.';
COMMENT ON COLUMN brake_systems.proportioning_valve_part_number IS 'Proportioning valve part number.';
COMMENT ON COLUMN brake_systems.distribution_block_type IS 'Distribution/combination valve type.';
COMMENT ON COLUMN brake_systems.abs_equipped IS 'True if ABS is installed.';
COMMENT ON COLUMN brake_systems.abs_generation IS 'ABS generation or version identifier.';
COMMENT ON COLUMN brake_systems.abs_manufacturer IS 'ABS system manufacturer, e.g. Bosch, Kelsey-Hayes, Delphi.';
COMMENT ON COLUMN brake_systems.abs_module_part_number IS 'ABS control module part number.';
COMMENT ON COLUMN brake_systems.parking_brake_type IS 'Parking brake mechanism, e.g. drum_in_hat, caliper_integrated, band, transmission.';
COMMENT ON COLUMN brake_systems.parking_brake_actuation IS 'Parking brake actuation, e.g. foot_pedal, hand_lever, center_console, electric.';
COMMENT ON COLUMN brake_systems.brake_fluid_type IS 'Required brake fluid, e.g. DOT3, DOT4, DOT5, DOT5_1.';
COMMENT ON COLUMN brake_systems.is_original IS 'True if factory-original brake system.';
COMMENT ON COLUMN brake_systems.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN brake_systems.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN brake_systems.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN brake_systems.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN brake_systems.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN brake_systems.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 17. BRAKE_ROTORS — per corner
-- ============================================================

CREATE TABLE brake_rotors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  corner TEXT NOT NULL,

  -- Specification
  diameter_mm NUMERIC(6,1),
  thickness_mm NUMERIC(5,2),
  minimum_thickness_mm NUMERIC(5,2),
  rotor_type TEXT,
  material TEXT,
  hat_type TEXT,
  hat_height_mm NUMERIC(5,2),
  vane_count INTEGER,
  directional BOOLEAN DEFAULT FALSE,
  bolt_pattern TEXT,
  part_number TEXT,
  manufacturer TEXT,
  weight_lbs NUMERIC(5,1),

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE brake_rotors ADD CONSTRAINT chk_br_corner
  CHECK (corner IN ('front_left', 'front_right', 'rear_left', 'rear_right'));
ALTER TABLE brake_rotors ADD CONSTRAINT chk_br_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE brake_rotors ADD CONSTRAINT chk_br_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE brake_rotors ADD CONSTRAINT chk_br_type
  CHECK (rotor_type IS NULL OR rotor_type IN ('solid', 'vented', 'drilled', 'slotted', 'drilled_slotted', 'other'));
ALTER TABLE brake_rotors ADD CONSTRAINT chk_br_material
  CHECK (material IS NULL OR material IN ('cast_iron', 'carbon_ceramic', 'carbon_carbon', 'composite', 'other'));

CREATE INDEX idx_brake_rotors_vehicle ON brake_rotors(vehicle_id);

COMMENT ON TABLE brake_rotors IS 'Brake rotor specifications per corner. One row per rotor.';
COMMENT ON COLUMN brake_rotors.id IS 'Primary key.';
COMMENT ON COLUMN brake_rotors.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN brake_rotors.corner IS 'Which corner: front_left, front_right, rear_left, rear_right.';
COMMENT ON COLUMN brake_rotors.diameter_mm IS 'Rotor outer diameter in mm.';
COMMENT ON COLUMN brake_rotors.thickness_mm IS 'Rotor thickness in mm (new).';
COMMENT ON COLUMN brake_rotors.minimum_thickness_mm IS 'Minimum allowable thickness in mm before replacement.';
COMMENT ON COLUMN brake_rotors.rotor_type IS 'Rotor type: solid, vented, drilled, slotted, drilled_slotted, other.';
COMMENT ON COLUMN brake_rotors.material IS 'Rotor material: cast_iron, carbon_ceramic, carbon_carbon, composite, other.';
COMMENT ON COLUMN brake_rotors.hat_type IS 'Rotor hat type, e.g. integral, two_piece_floating, aluminum_hat.';
COMMENT ON COLUMN brake_rotors.hat_height_mm IS 'Rotor hat height in mm.';
COMMENT ON COLUMN brake_rotors.vane_count IS 'Number of internal cooling vanes (vented rotors).';
COMMENT ON COLUMN brake_rotors.directional IS 'True if rotor is directional (left/right specific vane pattern).';
COMMENT ON COLUMN brake_rotors.bolt_pattern IS 'Rotor to hub bolt pattern.';
COMMENT ON COLUMN brake_rotors.part_number IS 'Rotor part number.';
COMMENT ON COLUMN brake_rotors.manufacturer IS 'Rotor manufacturer, e.g. Brembo, StopTech, AC Delco.';
COMMENT ON COLUMN brake_rotors.weight_lbs IS 'Rotor weight in pounds.';
COMMENT ON COLUMN brake_rotors.is_original IS 'True if factory-installed rotor.';
COMMENT ON COLUMN brake_rotors.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN brake_rotors.condition_notes IS 'Freeform condition details, e.g. measured thickness, runout.';
COMMENT ON COLUMN brake_rotors.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN brake_rotors.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN brake_rotors.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN brake_rotors.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 18. BRAKE_DRUMS — per corner
-- ============================================================

CREATE TABLE brake_drums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  corner TEXT NOT NULL,

  -- Specification
  diameter_inches NUMERIC(5,3),
  max_diameter_inches NUMERIC(5,3),
  width_inches NUMERIC(4,2),
  material TEXT,
  shoe_width_inches NUMERIC(4,2),
  finned BOOLEAN DEFAULT FALSE,
  part_number TEXT,
  manufacturer TEXT,
  weight_lbs NUMERIC(5,1),

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE brake_drums ADD CONSTRAINT chk_bd_corner
  CHECK (corner IN ('front_left', 'front_right', 'rear_left', 'rear_right'));
ALTER TABLE brake_drums ADD CONSTRAINT chk_bd_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE brake_drums ADD CONSTRAINT chk_bd_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE brake_drums ADD CONSTRAINT chk_bd_material
  CHECK (material IS NULL OR material IN ('cast_iron', 'aluminum_iron_liner', 'composite', 'other'));

CREATE INDEX idx_brake_drums_vehicle ON brake_drums(vehicle_id);

COMMENT ON TABLE brake_drums IS 'Brake drum specifications per corner. One row per drum.';
COMMENT ON COLUMN brake_drums.id IS 'Primary key.';
COMMENT ON COLUMN brake_drums.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN brake_drums.corner IS 'Which corner: front_left, front_right, rear_left, rear_right.';
COMMENT ON COLUMN brake_drums.diameter_inches IS 'Drum inner diameter in inches.';
COMMENT ON COLUMN brake_drums.max_diameter_inches IS 'Maximum allowable diameter in inches before replacement.';
COMMENT ON COLUMN brake_drums.width_inches IS 'Drum braking surface width in inches.';
COMMENT ON COLUMN brake_drums.material IS 'Drum material: cast_iron, aluminum_iron_liner, composite, other.';
COMMENT ON COLUMN brake_drums.shoe_width_inches IS 'Brake shoe width that fits this drum in inches.';
COMMENT ON COLUMN brake_drums.finned IS 'True if drum has external cooling fins.';
COMMENT ON COLUMN brake_drums.part_number IS 'Drum part number.';
COMMENT ON COLUMN brake_drums.manufacturer IS 'Drum manufacturer.';
COMMENT ON COLUMN brake_drums.weight_lbs IS 'Drum weight in pounds.';
COMMENT ON COLUMN brake_drums.is_original IS 'True if factory-installed drum.';
COMMENT ON COLUMN brake_drums.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN brake_drums.condition_notes IS 'Freeform condition details, e.g. measured diameter, scoring.';
COMMENT ON COLUMN brake_drums.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN brake_drums.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN brake_drums.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN brake_drums.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 19. BRAKE_CALIPERS — per corner
-- ============================================================

CREATE TABLE brake_calipers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  corner TEXT NOT NULL,

  -- Specification
  caliper_type TEXT,
  piston_count INTEGER,
  piston_diameter_mm NUMERIC(5,2),
  piston_material TEXT,
  caliper_material TEXT,
  manufacturer TEXT,
  part_number TEXT,
  casting_number TEXT,
  bracket_type TEXT,
  pad_retention TEXT,
  bleeder_location TEXT,
  dust_boot_type TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE brake_calipers ADD CONSTRAINT chk_bc_corner
  CHECK (corner IN ('front_left', 'front_right', 'rear_left', 'rear_right'));
ALTER TABLE brake_calipers ADD CONSTRAINT chk_bc_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE brake_calipers ADD CONSTRAINT chk_bc_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE brake_calipers ADD CONSTRAINT chk_bc_type
  CHECK (caliper_type IS NULL OR caliper_type IN ('fixed', 'floating', 'sliding', 'other'));
ALTER TABLE brake_calipers ADD CONSTRAINT chk_bc_caliper_material
  CHECK (caliper_material IS NULL OR caliper_material IN ('cast_iron', 'aluminum', 'forged_aluminum', 'other'));
ALTER TABLE brake_calipers ADD CONSTRAINT chk_bc_piston_count
  CHECK (piston_count IS NULL OR (piston_count >= 1 AND piston_count <= 12));

CREATE INDEX idx_brake_calipers_vehicle ON brake_calipers(vehicle_id);

COMMENT ON TABLE brake_calipers IS 'Brake caliper specifications per corner. One row per caliper.';
COMMENT ON COLUMN brake_calipers.id IS 'Primary key.';
COMMENT ON COLUMN brake_calipers.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN brake_calipers.corner IS 'Which corner: front_left, front_right, rear_left, rear_right.';
COMMENT ON COLUMN brake_calipers.caliper_type IS 'Caliper type: fixed, floating, sliding, other.';
COMMENT ON COLUMN brake_calipers.piston_count IS 'Number of pistons per caliper, 1-12.';
COMMENT ON COLUMN brake_calipers.piston_diameter_mm IS 'Piston diameter in mm (largest if differential bore).';
COMMENT ON COLUMN brake_calipers.piston_material IS 'Piston material, e.g. steel, phenolic, aluminum, titanium.';
COMMENT ON COLUMN brake_calipers.caliper_material IS 'Caliper body material: cast_iron, aluminum, forged_aluminum, other.';
COMMENT ON COLUMN brake_calipers.manufacturer IS 'Caliper manufacturer, e.g. Delco Moraine, Bendix, Kelsey-Hayes, Brembo, Wilwood.';
COMMENT ON COLUMN brake_calipers.part_number IS 'Caliper part number.';
COMMENT ON COLUMN brake_calipers.casting_number IS 'Casting number on the caliper body.';
COMMENT ON COLUMN brake_calipers.bracket_type IS 'Caliper bracket/mounting type, e.g. knuckle_mount, bracket_mount, direct.';
COMMENT ON COLUMN brake_calipers.pad_retention IS 'Pad retention method, e.g. pins, bolts, clips, spring.';
COMMENT ON COLUMN brake_calipers.bleeder_location IS 'Bleeder screw location, e.g. top_inboard, top_outboard.';
COMMENT ON COLUMN brake_calipers.dust_boot_type IS 'Piston dust boot type, e.g. square_cut_seal, lip_seal, wiper.';
COMMENT ON COLUMN brake_calipers.is_original IS 'True if factory-installed caliper.';
COMMENT ON COLUMN brake_calipers.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN brake_calipers.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN brake_calipers.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN brake_calipers.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN brake_calipers.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN brake_calipers.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 20. BRAKE_PADS_AND_SHOES — per corner
-- ============================================================

CREATE TABLE brake_pads_and_shoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  corner TEXT NOT NULL,

  -- Specification
  friction_type TEXT,
  friction_material TEXT,
  manufacturer TEXT,
  compound TEXT,
  part_number TEXT,
  thickness_mm NUMERIC(5,2),
  minimum_thickness_mm NUMERIC(5,2),
  width_mm NUMERIC(5,1),
  length_mm NUMERIC(5,1),
  wear_sensor_equipped BOOLEAN DEFAULT FALSE,
  chamfered BOOLEAN,
  slotted BOOLEAN,
  noise_shim TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE brake_pads_and_shoes ADD CONSTRAINT chk_bps_corner
  CHECK (corner IN ('front_left', 'front_right', 'rear_left', 'rear_right'));
ALTER TABLE brake_pads_and_shoes ADD CONSTRAINT chk_bps_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE brake_pads_and_shoes ADD CONSTRAINT chk_bps_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE brake_pads_and_shoes ADD CONSTRAINT chk_bps_friction_type
  CHECK (friction_type IS NULL OR friction_type IN ('pad', 'shoe'));
ALTER TABLE brake_pads_and_shoes ADD CONSTRAINT chk_bps_material
  CHECK (friction_material IS NULL OR friction_material IN (
    'organic', 'semi_metallic', 'ceramic', 'metallic', 'sintered', 'other'
  ));

CREATE INDEX idx_brake_pads_shoes_vehicle ON brake_pads_and_shoes(vehicle_id);

COMMENT ON TABLE brake_pads_and_shoes IS 'Brake pad or shoe specifications per corner. One row per pad/shoe set.';
COMMENT ON COLUMN brake_pads_and_shoes.id IS 'Primary key.';
COMMENT ON COLUMN brake_pads_and_shoes.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN brake_pads_and_shoes.corner IS 'Which corner: front_left, front_right, rear_left, rear_right.';
COMMENT ON COLUMN brake_pads_and_shoes.friction_type IS 'Friction element type: pad (disc brake) or shoe (drum brake).';
COMMENT ON COLUMN brake_pads_and_shoes.friction_material IS 'Friction material: organic, semi_metallic, ceramic, metallic, sintered, other.';
COMMENT ON COLUMN brake_pads_and_shoes.manufacturer IS 'Pad/shoe manufacturer, e.g. EBC, Hawk, Raybestos, Wagner.';
COMMENT ON COLUMN brake_pads_and_shoes.compound IS 'Specific compound name, e.g. HPS, DTC-60, Yellowstuff.';
COMMENT ON COLUMN brake_pads_and_shoes.part_number IS 'Pad/shoe part number.';
COMMENT ON COLUMN brake_pads_and_shoes.thickness_mm IS 'New pad/shoe lining thickness in mm.';
COMMENT ON COLUMN brake_pads_and_shoes.minimum_thickness_mm IS 'Minimum lining thickness before replacement in mm.';
COMMENT ON COLUMN brake_pads_and_shoes.width_mm IS 'Pad/shoe width in mm.';
COMMENT ON COLUMN brake_pads_and_shoes.length_mm IS 'Pad/shoe length in mm.';
COMMENT ON COLUMN brake_pads_and_shoes.wear_sensor_equipped IS 'True if electronic wear sensor is installed.';
COMMENT ON COLUMN brake_pads_and_shoes.chamfered IS 'True if pad edges are chamfered.';
COMMENT ON COLUMN brake_pads_and_shoes.slotted IS 'True if pad face has slots for gas/dust evacuation.';
COMMENT ON COLUMN brake_pads_and_shoes.noise_shim IS 'Noise shim type, e.g. adhesive, clip_on, titanium, none.';
COMMENT ON COLUMN brake_pads_and_shoes.is_original IS 'True if factory-installed pad/shoe.';
COMMENT ON COLUMN brake_pads_and_shoes.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN brake_pads_and_shoes.condition_notes IS 'Freeform condition details, e.g. measured remaining thickness.';
COMMENT ON COLUMN brake_pads_and_shoes.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN brake_pads_and_shoes.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN brake_pads_and_shoes.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN brake_pads_and_shoes.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 21. BRAKE_LINES — per corner
-- ============================================================

CREATE TABLE brake_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  corner TEXT NOT NULL,

  -- Specification
  line_material TEXT,
  flex_hose_material TEXT,
  flex_hose_length_inches NUMERIC(5,1),
  hard_line_material TEXT,
  hard_line_diameter_inches NUMERIC(4,3),
  fitting_type TEXT,
  routing_description TEXT,
  proportioning_inline BOOLEAN DEFAULT FALSE,
  residual_pressure_valve BOOLEAN DEFAULT FALSE,
  part_number TEXT,
  manufacturer TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE brake_lines ADD CONSTRAINT chk_bl_corner
  CHECK (corner IN ('front_left', 'front_right', 'rear_left', 'rear_right'));
ALTER TABLE brake_lines ADD CONSTRAINT chk_bl_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE brake_lines ADD CONSTRAINT chk_bl_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE brake_lines ADD CONSTRAINT chk_bl_line_material
  CHECK (line_material IS NULL OR line_material IN ('steel', 'stainless_braided', 'rubber', 'ptfe', 'other'));
ALTER TABLE brake_lines ADD CONSTRAINT chk_bl_hard_line
  CHECK (hard_line_material IS NULL OR hard_line_material IN (
    'steel', 'stainless_steel', 'nickel_copper', 'copper_nickel', 'other'
  ));

CREATE INDEX idx_brake_lines_vehicle ON brake_lines(vehicle_id);

COMMENT ON TABLE brake_lines IS 'Brake line and hose specifications per corner.';
COMMENT ON COLUMN brake_lines.id IS 'Primary key.';
COMMENT ON COLUMN brake_lines.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN brake_lines.corner IS 'Which corner: front_left, front_right, rear_left, rear_right.';
COMMENT ON COLUMN brake_lines.line_material IS 'Overall line material: steel, stainless_braided, rubber, ptfe, other.';
COMMENT ON COLUMN brake_lines.flex_hose_material IS 'Flexible hose material, e.g. rubber, stainless_braided_ptfe.';
COMMENT ON COLUMN brake_lines.flex_hose_length_inches IS 'Flexible hose length in inches.';
COMMENT ON COLUMN brake_lines.hard_line_material IS 'Hard line material: steel, stainless_steel, nickel_copper, copper_nickel, other.';
COMMENT ON COLUMN brake_lines.hard_line_diameter_inches IS 'Hard line outer diameter in inches, e.g. 0.187 (3/16), 0.250 (1/4).';
COMMENT ON COLUMN brake_lines.fitting_type IS 'Line fitting type, e.g. double_flare, iso_bubble, an_fitting.';
COMMENT ON COLUMN brake_lines.routing_description IS 'Line routing description for this corner.';
COMMENT ON COLUMN brake_lines.proportioning_inline IS 'True if inline proportioning device is on this line.';
COMMENT ON COLUMN brake_lines.residual_pressure_valve IS 'True if residual pressure valve is installed on this circuit.';
COMMENT ON COLUMN brake_lines.part_number IS 'Line kit or hose part number.';
COMMENT ON COLUMN brake_lines.manufacturer IS 'Line/hose manufacturer.';
COMMENT ON COLUMN brake_lines.is_original IS 'True if factory-installed brake line.';
COMMENT ON COLUMN brake_lines.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN brake_lines.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN brake_lines.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN brake_lines.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN brake_lines.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN brake_lines.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- UPDATED_AT TRIGGERS
-- Uses the shared trigger function from engine subsystem.
-- If engine migration has not been applied, create it here.
-- ============================================================

CREATE OR REPLACE FUNCTION digital_twin_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'front_suspension_config',
    'front_springs',
    'front_dampers',
    'front_sway_bars',
    'front_control_arms',
    'front_steering_knuckles',
    'rear_suspension_config',
    'rear_springs',
    'rear_dampers',
    'rear_sway_bars',
    'rear_trailing_arms_and_links',
    'steering_gearboxes',
    'steering_columns',
    'steering_linkage',
    'power_steering_systems',
    'brake_systems',
    'brake_rotors',
    'brake_drums',
    'brake_calipers',
    'brake_pads_and_shoes',
    'brake_lines'
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
    'front_suspension_config',
    'front_springs',
    'front_dampers',
    'front_sway_bars',
    'front_control_arms',
    'front_steering_knuckles',
    'rear_suspension_config',
    'rear_springs',
    'rear_dampers',
    'rear_sway_bars',
    'rear_trailing_arms_and_links',
    'steering_gearboxes',
    'steering_columns',
    'steering_linkage',
    'power_steering_systems',
    'brake_systems',
    'brake_rotors',
    'brake_drums',
    'brake_calipers',
    'brake_pads_and_shoes',
    'brake_lines'
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
