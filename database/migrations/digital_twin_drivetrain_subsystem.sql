-- ============================================================
-- DIGITAL TWIN: Drivetrain Subsystem DDL
-- Covers: Transmission, Transfer Case, Driveline/Axle
--
-- Architecture:
--   Follows the reference pattern established in
--   digital_twin_engine_subsystem.sql. Every component gets a
--   spec table with factory specification, condition grade,
--   provenance, and originality tracking.
--   Work events are logged via component_events referencing actors.
--   Evidence linking uses the existing field_evidence table.
--
-- Dependencies:
--   - vehicles(id)                   — parent FK
--   - actors(id)                     — already exists (engine subsystem)
--   - component_events               — already exists (engine subsystem)
--   - digital_twin_set_updated_at()  — already exists (engine subsystem)
-- ============================================================

BEGIN;

-- ============================================================
-- SUBSYSTEM 1: TRANSMISSION
-- ============================================================

-- ============================================================
-- 1. TRANSMISSION_CASES — the main housing/assembly
-- ============================================================

CREATE TABLE transmission_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Identification
  casting_number TEXT,
  serial_number TEXT,
  part_number TEXT,
  date_code TEXT,
  manufacturer TEXT,
  model TEXT,

  -- Specification
  transmission_type TEXT,
  speed_count INTEGER,
  gear_driven BOOLEAN DEFAULT FALSE,
  overdrive BOOLEAN DEFAULT FALSE,
  case_material TEXT,
  tail_housing_type TEXT,
  input_spline_count INTEGER,
  output_spline_count INTEGER,
  fluid_type TEXT,
  fluid_capacity_quarts NUMERIC(4,1),
  weight_lbs NUMERIC(6,1),
  torque_rating_lb_ft INTEGER,
  bellhousing_pattern TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transmission_cases ADD CONSTRAINT chk_tc_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE transmission_cases ADD CONSTRAINT chk_tc_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE transmission_cases ADD CONSTRAINT chk_tc_type
  CHECK (transmission_type IS NULL OR transmission_type IN (
    'manual', 'automatic', 'dct', 'cvt', 'semi_automatic', 'sequential', 'other'
  ));
ALTER TABLE transmission_cases ADD CONSTRAINT chk_tc_speed_count
  CHECK (speed_count IS NULL OR (speed_count >= 1 AND speed_count <= 12));
ALTER TABLE transmission_cases ADD CONSTRAINT chk_tc_case_material
  CHECK (case_material IS NULL OR case_material IN ('cast_iron', 'aluminum', 'magnesium', 'other'));

CREATE INDEX idx_trans_cases_vehicle ON transmission_cases(vehicle_id);

COMMENT ON TABLE transmission_cases IS 'Transmission case/housing specifications. One row per transmission installed in a vehicle (current or historical).';
COMMENT ON COLUMN transmission_cases.id IS 'Primary key.';
COMMENT ON COLUMN transmission_cases.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN transmission_cases.casting_number IS 'Casting number stamped on the case.';
COMMENT ON COLUMN transmission_cases.serial_number IS 'Transmission serial number.';
COMMENT ON COLUMN transmission_cases.part_number IS 'Manufacturer part number or GM service number.';
COMMENT ON COLUMN transmission_cases.date_code IS 'Date code on the case, e.g. P0910 = built Oct 9 at plant P.';
COMMENT ON COLUMN transmission_cases.manufacturer IS 'Manufacturer, e.g. Muncie, Borg-Warner, Tremec, GM Hydramatic, ZF, Aisin.';
COMMENT ON COLUMN transmission_cases.model IS 'Model designation, e.g. M22, T-10, TH400, 4L60E, T56.';
COMMENT ON COLUMN transmission_cases.transmission_type IS 'Type: manual, automatic, dct, cvt, semi_automatic, sequential, other.';
COMMENT ON COLUMN transmission_cases.speed_count IS 'Number of forward speeds, 1-12.';
COMMENT ON COLUMN transmission_cases.gear_driven IS 'True if all gears are helical/spur (no synchronizers).';
COMMENT ON COLUMN transmission_cases.overdrive IS 'True if transmission has an overdrive gear (ratio < 1.0).';
COMMENT ON COLUMN transmission_cases.case_material IS 'Case material: cast_iron, aluminum, magnesium, other.';
COMMENT ON COLUMN transmission_cases.tail_housing_type IS 'Tail/extension housing style, e.g. long, short, integral.';
COMMENT ON COLUMN transmission_cases.input_spline_count IS 'Number of splines on the input shaft.';
COMMENT ON COLUMN transmission_cases.output_spline_count IS 'Number of splines on the output shaft.';
COMMENT ON COLUMN transmission_cases.fluid_type IS 'Required fluid, e.g. dexron_iii, atf4, gl4_75w90, gl5_80w90, mtf.';
COMMENT ON COLUMN transmission_cases.fluid_capacity_quarts IS 'Fluid capacity in quarts.';
COMMENT ON COLUMN transmission_cases.weight_lbs IS 'Dry weight of the transmission in pounds.';
COMMENT ON COLUMN transmission_cases.torque_rating_lb_ft IS 'Maximum rated input torque in lb-ft.';
COMMENT ON COLUMN transmission_cases.bellhousing_pattern IS 'Bellhousing bolt pattern, e.g. gm_small_block, ford_small_block, mopar_a833.';
COMMENT ON COLUMN transmission_cases.is_original IS 'True if this is the factory-installed transmission.';
COMMENT ON COLUMN transmission_cases.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN transmission_cases.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN transmission_cases.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN transmission_cases.provenance_detail IS 'Detailed provenance info: source, date acquired, documentation.';
COMMENT ON COLUMN transmission_cases.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN transmission_cases.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 2. TRANSMISSION_GEARS — one row per gear ratio
-- ============================================================

CREATE TABLE transmission_gears (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  transmission_case_id UUID REFERENCES transmission_cases(id) ON DELETE SET NULL,

  gear_number INTEGER NOT NULL,
  ratio NUMERIC(6,3) NOT NULL,
  synchro_type TEXT,
  synchro_material TEXT,
  gear_material TEXT,
  gear_tooth_count INTEGER,
  is_overdrive BOOLEAN DEFAULT FALSE,
  is_reverse BOOLEAN DEFAULT FALSE,

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transmission_gears ADD CONSTRAINT chk_tg_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE transmission_gears ADD CONSTRAINT chk_tg_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE transmission_gears ADD CONSTRAINT chk_tg_synchro
  CHECK (synchro_type IS NULL OR synchro_type IN (
    'brass', 'carbon', 'steel', 'paper', 'double_cone', 'triple_cone', 'none', 'other'
  ));
ALTER TABLE transmission_gears ADD CONSTRAINT chk_tg_gear_number
  CHECK (gear_number >= -1 AND gear_number <= 12);

CREATE INDEX idx_trans_gears_vehicle ON transmission_gears(vehicle_id);
CREATE INDEX idx_trans_gears_case ON transmission_gears(transmission_case_id);

COMMENT ON TABLE transmission_gears IS 'Per-gear ratio and synchronizer specifications. One row per gear position including reverse (-1 or use is_reverse flag).';
COMMENT ON COLUMN transmission_gears.id IS 'Primary key.';
COMMENT ON COLUMN transmission_gears.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN transmission_gears.transmission_case_id IS 'FK to transmission_cases(id). Which transmission this gear belongs to.';
COMMENT ON COLUMN transmission_gears.gear_number IS 'Gear position: 1-12 for forward gears, -1 for reverse. 0 not used.';
COMMENT ON COLUMN transmission_gears.ratio IS 'Gear ratio, e.g. 2.20 for first gear, 0.73 for overdrive.';
COMMENT ON COLUMN transmission_gears.synchro_type IS 'Synchronizer type: brass, carbon, steel, paper, double_cone, triple_cone, none, other.';
COMMENT ON COLUMN transmission_gears.synchro_material IS 'Synchronizer ring material detail if non-standard.';
COMMENT ON COLUMN transmission_gears.gear_material IS 'Gear material, e.g. case_hardened_steel, sintered.';
COMMENT ON COLUMN transmission_gears.gear_tooth_count IS 'Number of teeth on this gear for ratio verification.';
COMMENT ON COLUMN transmission_gears.is_overdrive IS 'True if this gear has a ratio less than 1.0.';
COMMENT ON COLUMN transmission_gears.is_reverse IS 'True if this is the reverse gear.';
COMMENT ON COLUMN transmission_gears.is_original IS 'True if factory-original gear.';
COMMENT ON COLUMN transmission_gears.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN transmission_gears.condition_notes IS 'Freeform condition details, e.g. slight whine in 2nd.';
COMMENT ON COLUMN transmission_gears.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN transmission_gears.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN transmission_gears.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN transmission_gears.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 3. TRANSMISSION_INTERNALS — shafts, bearings, seals
-- ============================================================

CREATE TABLE transmission_internals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  transmission_case_id UUID REFERENCES transmission_cases(id) ON DELETE SET NULL,

  -- Input shaft
  input_shaft_spline_count INTEGER,
  input_shaft_length_mm NUMERIC(6,2),
  input_shaft_material TEXT,
  pilot_bearing_type TEXT,

  -- Output shaft
  output_shaft_spline_count INTEGER,
  output_shaft_length_mm NUMERIC(6,2),
  output_shaft_material TEXT,

  -- Countershaft (manual)
  countershaft_count INTEGER,
  countershaft_material TEXT,

  -- Bearings
  main_bearing_type TEXT,
  countershaft_bearing_type TEXT,
  tailshaft_bearing_type TEXT,
  bearing_preload_spec TEXT,

  -- Seals
  front_seal_type TEXT,
  rear_seal_type TEXT,
  shift_shaft_seal_type TEXT,
  speedometer_seal_type TEXT,

  -- Automatic-specific
  band_count INTEGER,
  band_material TEXT,
  servo_type TEXT,
  accumulator_type TEXT,
  planetary_set_count INTEGER,
  sprag_type TEXT,
  valve_body_type TEXT,
  separator_plate_id TEXT,

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transmission_internals ADD CONSTRAINT chk_ti_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE transmission_internals ADD CONSTRAINT chk_ti_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE transmission_internals ADD CONSTRAINT chk_ti_main_bearing
  CHECK (main_bearing_type IS NULL OR main_bearing_type IN (
    'ball', 'roller', 'tapered_roller', 'needle', 'bushing', 'other'
  ));

CREATE INDEX idx_trans_internals_vehicle ON transmission_internals(vehicle_id);

COMMENT ON TABLE transmission_internals IS 'Transmission internal components: input/output shafts, countershaft, bearings, seals, and automatic-specific parts (bands, servos, planetary sets, valve body).';
COMMENT ON COLUMN transmission_internals.id IS 'Primary key.';
COMMENT ON COLUMN transmission_internals.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN transmission_internals.transmission_case_id IS 'FK to transmission_cases(id).';
COMMENT ON COLUMN transmission_internals.input_shaft_spline_count IS 'Number of splines on the input shaft.';
COMMENT ON COLUMN transmission_internals.input_shaft_length_mm IS 'Input shaft overall length in mm.';
COMMENT ON COLUMN transmission_internals.input_shaft_material IS 'Input shaft material.';
COMMENT ON COLUMN transmission_internals.pilot_bearing_type IS 'Pilot bushing/bearing type at input shaft tip, e.g. bronze_bushing, needle_bearing.';
COMMENT ON COLUMN transmission_internals.output_shaft_spline_count IS 'Number of splines on the output shaft.';
COMMENT ON COLUMN transmission_internals.output_shaft_length_mm IS 'Output shaft overall length in mm.';
COMMENT ON COLUMN transmission_internals.output_shaft_material IS 'Output shaft material.';
COMMENT ON COLUMN transmission_internals.countershaft_count IS 'Number of countershafts (1 for most, 2 for some heavy-duty or twin-countershaft designs).';
COMMENT ON COLUMN transmission_internals.countershaft_material IS 'Countershaft material.';
COMMENT ON COLUMN transmission_internals.main_bearing_type IS 'Main shaft bearing type: ball, roller, tapered_roller, needle, bushing, other.';
COMMENT ON COLUMN transmission_internals.countershaft_bearing_type IS 'Countershaft bearing type.';
COMMENT ON COLUMN transmission_internals.tailshaft_bearing_type IS 'Tailshaft/extension housing bearing type.';
COMMENT ON COLUMN transmission_internals.bearing_preload_spec IS 'Bearing preload specification.';
COMMENT ON COLUMN transmission_internals.front_seal_type IS 'Front pump or input shaft seal type.';
COMMENT ON COLUMN transmission_internals.rear_seal_type IS 'Rear output shaft seal type.';
COMMENT ON COLUMN transmission_internals.shift_shaft_seal_type IS 'Shift lever shaft seal type (manual).';
COMMENT ON COLUMN transmission_internals.speedometer_seal_type IS 'Speedometer drive gear seal type.';
COMMENT ON COLUMN transmission_internals.band_count IS 'Number of friction bands (automatic only).';
COMMENT ON COLUMN transmission_internals.band_material IS 'Band friction material, e.g. organic, kevlar, carbon.';
COMMENT ON COLUMN transmission_internals.servo_type IS 'Band servo type/size.';
COMMENT ON COLUMN transmission_internals.accumulator_type IS 'Shift accumulator type for shift quality tuning.';
COMMENT ON COLUMN transmission_internals.planetary_set_count IS 'Number of planetary gear sets (automatic only).';
COMMENT ON COLUMN transmission_internals.sprag_type IS 'One-way clutch/sprag type and count.';
COMMENT ON COLUMN transmission_internals.valve_body_type IS 'Valve body type: stock, shift_kit, manual, transbrake, full_manual.';
COMMENT ON COLUMN transmission_internals.separator_plate_id IS 'Separator plate identification for valve body compatibility.';
COMMENT ON COLUMN transmission_internals.is_original IS 'True if factory-original internals.';
COMMENT ON COLUMN transmission_internals.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN transmission_internals.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN transmission_internals.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN transmission_internals.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN transmission_internals.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN transmission_internals.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 4. TRANSMISSION_TORQUE_CONVERTERS — for automatics
-- ============================================================

CREATE TABLE transmission_torque_converters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  transmission_case_id UUID REFERENCES transmission_cases(id) ON DELETE SET NULL,

  manufacturer TEXT,
  part_number TEXT,
  diameter_inches NUMERIC(5,2),
  stall_speed_rpm INTEGER,
  torque_multiplication NUMERIC(4,2),
  lockup_equipped BOOLEAN DEFAULT FALSE,
  lockup_type TEXT,
  bolt_count INTEGER,
  bolt_pattern TEXT,
  pilot_diameter_mm NUMERIC(6,2),
  fluid_coupling BOOLEAN DEFAULT FALSE,
  billet_cover BOOLEAN DEFAULT FALSE,
  anti_balloon_plate BOOLEAN DEFAULT FALSE,
  furnace_brazed BOOLEAN DEFAULT FALSE,
  weight_lbs NUMERIC(5,1),

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transmission_torque_converters ADD CONSTRAINT chk_ttc_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE transmission_torque_converters ADD CONSTRAINT chk_ttc_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE transmission_torque_converters ADD CONSTRAINT chk_ttc_stall
  CHECK (stall_speed_rpm IS NULL OR (stall_speed_rpm >= 500 AND stall_speed_rpm <= 8000));
ALTER TABLE transmission_torque_converters ADD CONSTRAINT chk_ttc_lockup
  CHECK (lockup_type IS NULL OR lockup_type IN ('mechanical', 'electronic', 'multi_disc', 'none', 'other'));

CREATE INDEX idx_trans_tc_vehicle ON transmission_torque_converters(vehicle_id);

COMMENT ON TABLE transmission_torque_converters IS 'Torque converter specifications for automatic transmissions. One row per converter installed.';
COMMENT ON COLUMN transmission_torque_converters.id IS 'Primary key.';
COMMENT ON COLUMN transmission_torque_converters.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN transmission_torque_converters.transmission_case_id IS 'FK to transmission_cases(id).';
COMMENT ON COLUMN transmission_torque_converters.manufacturer IS 'Converter manufacturer, e.g. GM, Hughes, TCI, B&M, Precision Industries.';
COMMENT ON COLUMN transmission_torque_converters.part_number IS 'Manufacturer part number.';
COMMENT ON COLUMN transmission_torque_converters.diameter_inches IS 'Converter diameter in inches, e.g. 12.0 for TH400.';
COMMENT ON COLUMN transmission_torque_converters.stall_speed_rpm IS 'Stall speed in RPM, 500-8000.';
COMMENT ON COLUMN transmission_torque_converters.torque_multiplication IS 'Torque multiplication ratio at stall.';
COMMENT ON COLUMN transmission_torque_converters.lockup_equipped IS 'True if converter has lockup clutch.';
COMMENT ON COLUMN transmission_torque_converters.lockup_type IS 'Lockup type: mechanical, electronic, multi_disc, none, other.';
COMMENT ON COLUMN transmission_torque_converters.bolt_count IS 'Number of converter-to-flexplate bolts.';
COMMENT ON COLUMN transmission_torque_converters.bolt_pattern IS 'Bolt circle pattern description.';
COMMENT ON COLUMN transmission_torque_converters.pilot_diameter_mm IS 'Pilot hub diameter in mm for crank register.';
COMMENT ON COLUMN transmission_torque_converters.fluid_coupling IS 'True if fluid coupling (no torque multiplication) vs true converter.';
COMMENT ON COLUMN transmission_torque_converters.billet_cover IS 'True if billet steel cover (performance/racing).';
COMMENT ON COLUMN transmission_torque_converters.anti_balloon_plate IS 'True if anti-balloon plate installed for high RPM.';
COMMENT ON COLUMN transmission_torque_converters.furnace_brazed IS 'True if fins are furnace-brazed (performance).';
COMMENT ON COLUMN transmission_torque_converters.weight_lbs IS 'Converter weight in pounds.';
COMMENT ON COLUMN transmission_torque_converters.is_original IS 'True if factory-installed torque converter.';
COMMENT ON COLUMN transmission_torque_converters.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN transmission_torque_converters.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN transmission_torque_converters.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN transmission_torque_converters.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN transmission_torque_converters.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN transmission_torque_converters.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 5. TRANSMISSION_SHIFTERS
-- ============================================================

CREATE TABLE transmission_shifters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  transmission_case_id UUID REFERENCES transmission_cases(id) ON DELETE SET NULL,

  shifter_type TEXT,
  manufacturer TEXT,
  model TEXT,
  part_number TEXT,
  linkage_type TEXT,
  shift_pattern TEXT,
  shift_knob_material TEXT,
  shift_boot_type TEXT,
  console_mounted BOOLEAN,
  column_shift BOOLEAN DEFAULT FALSE,
  reverse_lockout BOOLEAN DEFAULT FALSE,
  short_throw BOOLEAN DEFAULT FALSE,
  gate_type TEXT,

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transmission_shifters ADD CONSTRAINT chk_ts_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE transmission_shifters ADD CONSTRAINT chk_ts_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE transmission_shifters ADD CONSTRAINT chk_ts_type
  CHECK (shifter_type IS NULL OR shifter_type IN (
    'floor_manual', 'console_auto', 'column_manual', 'column_auto',
    'pistol_grip', 'ratchet', 'paddle', 'sequential', 'other'
  ));
ALTER TABLE transmission_shifters ADD CONSTRAINT chk_ts_linkage
  CHECK (linkage_type IS NULL OR linkage_type IN (
    'mechanical_rod', 'cable', 'electronic', 'direct_mount', 'other'
  ));

CREATE INDEX idx_trans_shifters_vehicle ON transmission_shifters(vehicle_id);

COMMENT ON TABLE transmission_shifters IS 'Transmission shifter/selector specifications. One row per shifter installed.';
COMMENT ON COLUMN transmission_shifters.id IS 'Primary key.';
COMMENT ON COLUMN transmission_shifters.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN transmission_shifters.transmission_case_id IS 'FK to transmission_cases(id).';
COMMENT ON COLUMN transmission_shifters.shifter_type IS 'Shifter type: floor_manual, console_auto, column_manual, column_auto, pistol_grip, ratchet, paddle, sequential, other.';
COMMENT ON COLUMN transmission_shifters.manufacturer IS 'Shifter manufacturer, e.g. Hurst, B&M, factory.';
COMMENT ON COLUMN transmission_shifters.model IS 'Shifter model, e.g. Competition Plus, Pro Stick, Quicksilver.';
COMMENT ON COLUMN transmission_shifters.part_number IS 'Shifter part number.';
COMMENT ON COLUMN transmission_shifters.linkage_type IS 'Linkage type: mechanical_rod, cable, electronic, direct_mount, other.';
COMMENT ON COLUMN transmission_shifters.shift_pattern IS 'Shift pattern description, e.g. H_pattern, reverse_left_up, dogleg_first.';
COMMENT ON COLUMN transmission_shifters.shift_knob_material IS 'Knob material, e.g. plastic, wood, leather, billet_aluminum, cue_ball.';
COMMENT ON COLUMN transmission_shifters.shift_boot_type IS 'Shift boot type, e.g. rubber, leather, vinyl.';
COMMENT ON COLUMN transmission_shifters.console_mounted IS 'True if shifter is mounted in a console.';
COMMENT ON COLUMN transmission_shifters.column_shift IS 'True if column-mounted shifter.';
COMMENT ON COLUMN transmission_shifters.reverse_lockout IS 'True if reverse lockout mechanism is present.';
COMMENT ON COLUMN transmission_shifters.short_throw IS 'True if short-throw modification or aftermarket short-throw shifter.';
COMMENT ON COLUMN transmission_shifters.gate_type IS 'Shift gate type, e.g. open, gated, spring_loaded.';
COMMENT ON COLUMN transmission_shifters.is_original IS 'True if factory-installed shifter.';
COMMENT ON COLUMN transmission_shifters.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN transmission_shifters.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN transmission_shifters.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN transmission_shifters.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN transmission_shifters.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN transmission_shifters.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 6. TRANSMISSION_CLUTCH_SYSTEMS — for manual transmissions
-- ============================================================

CREATE TABLE transmission_clutch_systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  transmission_case_id UUID REFERENCES transmission_cases(id) ON DELETE SET NULL,

  -- Clutch disc
  disc_diameter_inches NUMERIC(5,2),
  disc_spline_count INTEGER,
  disc_material TEXT,
  disc_type TEXT,
  disc_manufacturer TEXT,
  disc_part_number TEXT,
  disc_sprung BOOLEAN DEFAULT TRUE,
  disc_marcel BOOLEAN DEFAULT TRUE,

  -- Pressure plate
  pressure_plate_type TEXT,
  pressure_plate_manufacturer TEXT,
  pressure_plate_part_number TEXT,
  clamp_load_lbs INTEGER,
  pressure_plate_fingers INTEGER,

  -- Release
  throwout_bearing_type TEXT,
  throwout_bearing_part_number TEXT,
  release_mechanism TEXT,
  pivot_ball_type TEXT,
  clutch_fork_type TEXT,

  -- Hydraulic (if applicable)
  master_cylinder_bore_mm NUMERIC(5,2),
  master_cylinder_part_number TEXT,
  slave_cylinder_bore_mm NUMERIC(5,2),
  slave_cylinder_type TEXT,
  clutch_line_type TEXT,

  -- Cable (if applicable)
  cable_type TEXT,
  cable_self_adjusting BOOLEAN,

  -- Flywheel coupling
  dual_mass_flywheel BOOLEAN DEFAULT FALSE,

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transmission_clutch_systems ADD CONSTRAINT chk_tcs_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE transmission_clutch_systems ADD CONSTRAINT chk_tcs_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE transmission_clutch_systems ADD CONSTRAINT chk_tcs_disc_material
  CHECK (disc_material IS NULL OR disc_material IN (
    'organic', 'ceramic', 'kevlar', 'carbon', 'metallic', 'sintered_iron', 'other'
  ));
ALTER TABLE transmission_clutch_systems ADD CONSTRAINT chk_tcs_pp_type
  CHECK (pressure_plate_type IS NULL OR pressure_plate_type IN (
    'diaphragm', 'long_style', 'borg_beck', 'multi_disc', 'other'
  ));
ALTER TABLE transmission_clutch_systems ADD CONSTRAINT chk_tcs_release
  CHECK (release_mechanism IS NULL OR release_mechanism IN (
    'hydraulic', 'cable', 'mechanical_linkage', 'other'
  ));

CREATE INDEX idx_trans_clutch_vehicle ON transmission_clutch_systems(vehicle_id);

COMMENT ON TABLE transmission_clutch_systems IS 'Manual transmission clutch system: disc, pressure plate, release bearing, hydraulics/cable. One row per clutch system installed.';
COMMENT ON COLUMN transmission_clutch_systems.id IS 'Primary key.';
COMMENT ON COLUMN transmission_clutch_systems.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN transmission_clutch_systems.transmission_case_id IS 'FK to transmission_cases(id).';
COMMENT ON COLUMN transmission_clutch_systems.disc_diameter_inches IS 'Clutch disc diameter in inches, e.g. 10.5, 11.0.';
COMMENT ON COLUMN transmission_clutch_systems.disc_spline_count IS 'Number of splines on clutch disc hub.';
COMMENT ON COLUMN transmission_clutch_systems.disc_material IS 'Disc friction material: organic, ceramic, kevlar, carbon, metallic, sintered_iron, other.';
COMMENT ON COLUMN transmission_clutch_systems.disc_type IS 'Disc description, e.g. single, twin, triple.';
COMMENT ON COLUMN transmission_clutch_systems.disc_manufacturer IS 'Clutch disc manufacturer.';
COMMENT ON COLUMN transmission_clutch_systems.disc_part_number IS 'Clutch disc part number.';
COMMENT ON COLUMN transmission_clutch_systems.disc_sprung IS 'True if disc has dampener springs in hub.';
COMMENT ON COLUMN transmission_clutch_systems.disc_marcel IS 'True if disc has marcel (wavy) spring layer.';
COMMENT ON COLUMN transmission_clutch_systems.pressure_plate_type IS 'Pressure plate type: diaphragm, long_style, borg_beck, multi_disc, other.';
COMMENT ON COLUMN transmission_clutch_systems.pressure_plate_manufacturer IS 'Pressure plate manufacturer, e.g. GM, Centerforce, McLeod.';
COMMENT ON COLUMN transmission_clutch_systems.pressure_plate_part_number IS 'Pressure plate part number.';
COMMENT ON COLUMN transmission_clutch_systems.clamp_load_lbs IS 'Pressure plate clamping force in pounds.';
COMMENT ON COLUMN transmission_clutch_systems.pressure_plate_fingers IS 'Number of pressure plate fingers or diaphragm spring segments.';
COMMENT ON COLUMN transmission_clutch_systems.throwout_bearing_type IS 'Throwout/release bearing type, e.g. sealed_ball, self_aligning, hydraulic_integrated.';
COMMENT ON COLUMN transmission_clutch_systems.throwout_bearing_part_number IS 'Throwout bearing part number.';
COMMENT ON COLUMN transmission_clutch_systems.release_mechanism IS 'Clutch release mechanism: hydraulic, cable, mechanical_linkage, other.';
COMMENT ON COLUMN transmission_clutch_systems.pivot_ball_type IS 'Clutch fork pivot ball type, e.g. stock, hardened, roller.';
COMMENT ON COLUMN transmission_clutch_systems.clutch_fork_type IS 'Clutch fork type, e.g. stamped_steel, forged, aftermarket.';
COMMENT ON COLUMN transmission_clutch_systems.master_cylinder_bore_mm IS 'Clutch master cylinder bore diameter in mm.';
COMMENT ON COLUMN transmission_clutch_systems.master_cylinder_part_number IS 'Clutch master cylinder part number.';
COMMENT ON COLUMN transmission_clutch_systems.slave_cylinder_bore_mm IS 'Slave/release cylinder bore diameter in mm.';
COMMENT ON COLUMN transmission_clutch_systems.slave_cylinder_type IS 'Slave cylinder type, e.g. external, concentric, internal.';
COMMENT ON COLUMN transmission_clutch_systems.clutch_line_type IS 'Clutch hydraulic line type, e.g. rubber, stainless_braided.';
COMMENT ON COLUMN transmission_clutch_systems.cable_type IS 'Clutch cable type if cable-operated.';
COMMENT ON COLUMN transmission_clutch_systems.cable_self_adjusting IS 'True if clutch cable is self-adjusting.';
COMMENT ON COLUMN transmission_clutch_systems.dual_mass_flywheel IS 'True if paired with a dual-mass flywheel.';
COMMENT ON COLUMN transmission_clutch_systems.is_original IS 'True if factory-installed clutch system.';
COMMENT ON COLUMN transmission_clutch_systems.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN transmission_clutch_systems.condition_notes IS 'Freeform condition details, e.g. 60% disc life remaining.';
COMMENT ON COLUMN transmission_clutch_systems.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN transmission_clutch_systems.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN transmission_clutch_systems.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN transmission_clutch_systems.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 7. TRANSMISSION_CONTROLLERS — electronic transmission controls
-- ============================================================

CREATE TABLE transmission_controllers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  transmission_case_id UUID REFERENCES transmission_cases(id) ON DELETE SET NULL,

  -- TCM/PCM
  controller_type TEXT,
  tcm_part_number TEXT,
  tcm_manufacturer TEXT,
  calibration_id TEXT,
  software_version TEXT,

  -- Solenoids
  shift_solenoid_count INTEGER,
  shift_solenoid_type TEXT,
  tcc_solenoid_type TEXT,
  pressure_control_solenoid_type TEXT,
  epc_solenoid_type TEXT,

  -- Sensors
  input_speed_sensor_type TEXT,
  output_speed_sensor_type TEXT,
  tft_sensor_type TEXT,
  line_pressure_sensor BOOLEAN DEFAULT FALSE,
  range_sensor_type TEXT,

  -- Wiring
  connector_type TEXT,
  wire_harness_part_number TEXT,

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transmission_controllers ADD CONSTRAINT chk_tcntrl_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE transmission_controllers ADD CONSTRAINT chk_tcntrl_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE transmission_controllers ADD CONSTRAINT chk_tcntrl_type
  CHECK (controller_type IS NULL OR controller_type IN (
    'standalone_tcm', 'integrated_pcm', 'aftermarket_standalone', 'none', 'other'
  ));

CREATE INDEX idx_trans_controllers_vehicle ON transmission_controllers(vehicle_id);

COMMENT ON TABLE transmission_controllers IS 'Electronic transmission control specifications: TCM, solenoids, sensors, wiring. One row per controller setup.';
COMMENT ON COLUMN transmission_controllers.id IS 'Primary key.';
COMMENT ON COLUMN transmission_controllers.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN transmission_controllers.transmission_case_id IS 'FK to transmission_cases(id).';
COMMENT ON COLUMN transmission_controllers.controller_type IS 'Controller type: standalone_tcm, integrated_pcm, aftermarket_standalone, none, other.';
COMMENT ON COLUMN transmission_controllers.tcm_part_number IS 'TCM/PCM part number.';
COMMENT ON COLUMN transmission_controllers.tcm_manufacturer IS 'TCM manufacturer, e.g. GM, Ford, Compushift, US Shift.';
COMMENT ON COLUMN transmission_controllers.calibration_id IS 'TCM calibration/PROM identifier.';
COMMENT ON COLUMN transmission_controllers.software_version IS 'Controller software version if updatable.';
COMMENT ON COLUMN transmission_controllers.shift_solenoid_count IS 'Number of shift solenoids.';
COMMENT ON COLUMN transmission_controllers.shift_solenoid_type IS 'Shift solenoid type, e.g. on_off, pwm, variable_force.';
COMMENT ON COLUMN transmission_controllers.tcc_solenoid_type IS 'Torque converter clutch solenoid type.';
COMMENT ON COLUMN transmission_controllers.pressure_control_solenoid_type IS 'Pressure control solenoid type.';
COMMENT ON COLUMN transmission_controllers.epc_solenoid_type IS 'Electronic pressure control solenoid type.';
COMMENT ON COLUMN transmission_controllers.input_speed_sensor_type IS 'Input/turbine speed sensor type.';
COMMENT ON COLUMN transmission_controllers.output_speed_sensor_type IS 'Output/vehicle speed sensor type.';
COMMENT ON COLUMN transmission_controllers.tft_sensor_type IS 'Transmission fluid temperature sensor type.';
COMMENT ON COLUMN transmission_controllers.line_pressure_sensor IS 'True if line pressure sensor is installed.';
COMMENT ON COLUMN transmission_controllers.range_sensor_type IS 'Transmission range (PRNDL) sensor type.';
COMMENT ON COLUMN transmission_controllers.connector_type IS 'Case connector type/pin count.';
COMMENT ON COLUMN transmission_controllers.wire_harness_part_number IS 'Internal wire harness part number.';
COMMENT ON COLUMN transmission_controllers.is_original IS 'True if factory-installed controller.';
COMMENT ON COLUMN transmission_controllers.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN transmission_controllers.condition_notes IS 'Freeform condition details, e.g. DTC codes present.';
COMMENT ON COLUMN transmission_controllers.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN transmission_controllers.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN transmission_controllers.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN transmission_controllers.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 8. TRANSMISSION_COOLERS
-- ============================================================

CREATE TABLE transmission_coolers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  transmission_case_id UUID REFERENCES transmission_cases(id) ON DELETE SET NULL,

  cooler_type TEXT,
  cooler_location TEXT,
  cooler_manufacturer TEXT,
  cooler_part_number TEXT,
  capacity_gph NUMERIC(5,1),
  row_count INTEGER,
  core_size TEXT,
  line_size TEXT,
  line_material TEXT,
  fan_equipped BOOLEAN DEFAULT FALSE,
  fan_type TEXT,
  thermostat_equipped BOOLEAN DEFAULT FALSE,
  thermostat_temp_f INTEGER,
  integrated_in_radiator BOOLEAN DEFAULT TRUE,

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transmission_coolers ADD CONSTRAINT chk_tcool_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE transmission_coolers ADD CONSTRAINT chk_tcool_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE transmission_coolers ADD CONSTRAINT chk_tcool_type
  CHECK (cooler_type IS NULL OR cooler_type IN (
    'tube_fin', 'plate_fin', 'stacked_plate', 'radiator_internal', 'remote', 'other'
  ));

CREATE INDEX idx_trans_coolers_vehicle ON transmission_coolers(vehicle_id);

COMMENT ON TABLE transmission_coolers IS 'Transmission fluid cooler specifications. One row per cooler installed.';
COMMENT ON COLUMN transmission_coolers.id IS 'Primary key.';
COMMENT ON COLUMN transmission_coolers.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN transmission_coolers.transmission_case_id IS 'FK to transmission_cases(id).';
COMMENT ON COLUMN transmission_coolers.cooler_type IS 'Cooler type: tube_fin, plate_fin, stacked_plate, radiator_internal, remote, other.';
COMMENT ON COLUMN transmission_coolers.cooler_location IS 'Cooler mounting location, e.g. front_of_radiator, below_radiator, frame_mounted.';
COMMENT ON COLUMN transmission_coolers.cooler_manufacturer IS 'Cooler manufacturer, e.g. Hayden, Derale, B&M.';
COMMENT ON COLUMN transmission_coolers.cooler_part_number IS 'Cooler part number.';
COMMENT ON COLUMN transmission_coolers.capacity_gph IS 'Cooler flow capacity in gallons per hour.';
COMMENT ON COLUMN transmission_coolers.row_count IS 'Number of tube rows in the cooler core.';
COMMENT ON COLUMN transmission_coolers.core_size IS 'Core dimensions, e.g. 11x6x0.75.';
COMMENT ON COLUMN transmission_coolers.line_size IS 'Cooler line size, e.g. 5/16, 3/8, -6AN.';
COMMENT ON COLUMN transmission_coolers.line_material IS 'Cooler line material, e.g. steel, rubber, stainless_braided.';
COMMENT ON COLUMN transmission_coolers.fan_equipped IS 'True if dedicated electric fan is on the cooler.';
COMMENT ON COLUMN transmission_coolers.fan_type IS 'Fan type if equipped, e.g. pusher, puller.';
COMMENT ON COLUMN transmission_coolers.thermostat_equipped IS 'True if inline thermostat is installed.';
COMMENT ON COLUMN transmission_coolers.thermostat_temp_f IS 'Thermostat opening temperature in Fahrenheit.';
COMMENT ON COLUMN transmission_coolers.integrated_in_radiator IS 'True if cooler is the internal tank in the radiator (factory style).';
COMMENT ON COLUMN transmission_coolers.is_original IS 'True if factory-installed cooler.';
COMMENT ON COLUMN transmission_coolers.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN transmission_coolers.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN transmission_coolers.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN transmission_coolers.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN transmission_coolers.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN transmission_coolers.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- SUBSYSTEM 2: TRANSFER CASE (4WD/AWD vehicles)
-- ============================================================

-- ============================================================
-- 9. TRANSFER_CASES — the main unit
-- ============================================================

CREATE TABLE transfer_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Identification
  casting_number TEXT,
  serial_number TEXT,
  part_number TEXT,
  date_code TEXT,
  manufacturer TEXT,
  model TEXT,

  -- Specification
  transfer_case_type TEXT,
  ratio_high NUMERIC(5,3) DEFAULT 1.000,
  ratio_low NUMERIC(5,3),
  drive_type TEXT,
  front_output_type TEXT,
  rear_output_type TEXT,
  front_output_spline_count INTEGER,
  rear_output_spline_count INTEGER,
  input_spline_count INTEGER,
  fluid_type TEXT,
  fluid_capacity_quarts NUMERIC(4,1),
  case_material TEXT,
  weight_lbs NUMERIC(6,1),
  torque_rating_lb_ft INTEGER,
  speedometer_drive TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transfer_cases ADD CONSTRAINT chk_xfer_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE transfer_cases ADD CONSTRAINT chk_xfer_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE transfer_cases ADD CONSTRAINT chk_xfer_type
  CHECK (transfer_case_type IS NULL OR transfer_case_type IN (
    'part_time', 'full_time', 'awd', 'on_demand', 'selectable', 'other'
  ));
ALTER TABLE transfer_cases ADD CONSTRAINT chk_xfer_drive
  CHECK (drive_type IS NULL OR drive_type IN ('chain', 'gear', 'other'));
ALTER TABLE transfer_cases ADD CONSTRAINT chk_xfer_material
  CHECK (case_material IS NULL OR case_material IN ('cast_iron', 'aluminum', 'magnesium', 'other'));

CREATE INDEX idx_xfer_cases_vehicle ON transfer_cases(vehicle_id);

COMMENT ON TABLE transfer_cases IS 'Transfer case specifications for 4WD/AWD vehicles. One row per transfer case installed (current or historical).';
COMMENT ON COLUMN transfer_cases.id IS 'Primary key.';
COMMENT ON COLUMN transfer_cases.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN transfer_cases.casting_number IS 'Casting number on the case.';
COMMENT ON COLUMN transfer_cases.serial_number IS 'Transfer case serial number.';
COMMENT ON COLUMN transfer_cases.part_number IS 'Manufacturer part number.';
COMMENT ON COLUMN transfer_cases.date_code IS 'Date code on the case.';
COMMENT ON COLUMN transfer_cases.manufacturer IS 'Manufacturer, e.g. New Process, Borg-Warner, Dana, Magna.';
COMMENT ON COLUMN transfer_cases.model IS 'Model designation, e.g. NP205, NP203, NP241, BW4401, BW1345.';
COMMENT ON COLUMN transfer_cases.transfer_case_type IS 'Type: part_time, full_time, awd, on_demand, selectable, other.';
COMMENT ON COLUMN transfer_cases.ratio_high IS 'High-range ratio, typically 1.000.';
COMMENT ON COLUMN transfer_cases.ratio_low IS 'Low-range ratio, e.g. 1.96 for NP205, 2.72 for NP241.';
COMMENT ON COLUMN transfer_cases.drive_type IS 'Internal drive mechanism: chain or gear.';
COMMENT ON COLUMN transfer_cases.front_output_type IS 'Front output configuration, e.g. fixed_yoke, slip_yoke, cv_flange.';
COMMENT ON COLUMN transfer_cases.rear_output_type IS 'Rear output configuration.';
COMMENT ON COLUMN transfer_cases.front_output_spline_count IS 'Spline count on front output shaft.';
COMMENT ON COLUMN transfer_cases.rear_output_spline_count IS 'Spline count on rear output shaft.';
COMMENT ON COLUMN transfer_cases.input_spline_count IS 'Spline count on input shaft.';
COMMENT ON COLUMN transfer_cases.fluid_type IS 'Required fluid, e.g. atf, gl5_80w90, synthetic_atf.';
COMMENT ON COLUMN transfer_cases.fluid_capacity_quarts IS 'Fluid capacity in quarts.';
COMMENT ON COLUMN transfer_cases.case_material IS 'Case material: cast_iron, aluminum, magnesium, other.';
COMMENT ON COLUMN transfer_cases.weight_lbs IS 'Dry weight in pounds.';
COMMENT ON COLUMN transfer_cases.torque_rating_lb_ft IS 'Maximum rated input torque in lb-ft.';
COMMENT ON COLUMN transfer_cases.speedometer_drive IS 'Speedometer drive location and type.';
COMMENT ON COLUMN transfer_cases.is_original IS 'True if factory-installed transfer case.';
COMMENT ON COLUMN transfer_cases.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN transfer_cases.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN transfer_cases.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN transfer_cases.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN transfer_cases.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN transfer_cases.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 10. TRANSFER_CASE_INTERNALS — chain, planetary, bearings, seals
-- ============================================================

CREATE TABLE transfer_case_internals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  transfer_case_id UUID REFERENCES transfer_cases(id) ON DELETE SET NULL,

  -- Chain / gear drive
  chain_type TEXT,
  chain_part_number TEXT,
  chain_width_mm NUMERIC(5,2),
  chain_link_count INTEGER,
  driven_sprocket_tooth_count INTEGER,
  drive_sprocket_tooth_count INTEGER,

  -- Planetary (if gear-driven)
  planetary_type TEXT,
  planetary_gear_count INTEGER,
  sun_gear_tooth_count INTEGER,
  ring_gear_tooth_count INTEGER,

  -- Bearings
  input_bearing_type TEXT,
  front_output_bearing_type TEXT,
  rear_output_bearing_type TEXT,
  intermediate_bearing_type TEXT,

  -- Seals
  front_output_seal_type TEXT,
  rear_output_seal_type TEXT,
  input_seal_type TEXT,
  shift_shaft_seal_type TEXT,

  -- Shift mechanism
  shift_fork_material TEXT,
  shift_rail_count INTEGER,
  mode_sleeve_type TEXT,

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transfer_case_internals ADD CONSTRAINT chk_xferi_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE transfer_case_internals ADD CONSTRAINT chk_xferi_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE transfer_case_internals ADD CONSTRAINT chk_xferi_chain
  CHECK (chain_type IS NULL OR chain_type IN ('morse_hy_vo', 'silent', 'roller', 'none', 'other'));

CREATE INDEX idx_xfer_internals_vehicle ON transfer_case_internals(vehicle_id);

COMMENT ON TABLE transfer_case_internals IS 'Transfer case internal components: chain/gear drive, planetary, bearings, seals, shift mechanism.';
COMMENT ON COLUMN transfer_case_internals.id IS 'Primary key.';
COMMENT ON COLUMN transfer_case_internals.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN transfer_case_internals.transfer_case_id IS 'FK to transfer_cases(id).';
COMMENT ON COLUMN transfer_case_internals.chain_type IS 'Drive chain type: morse_hy_vo, silent, roller, none (gear-driven), other.';
COMMENT ON COLUMN transfer_case_internals.chain_part_number IS 'Chain part number.';
COMMENT ON COLUMN transfer_case_internals.chain_width_mm IS 'Chain width in mm.';
COMMENT ON COLUMN transfer_case_internals.chain_link_count IS 'Number of chain links.';
COMMENT ON COLUMN transfer_case_internals.driven_sprocket_tooth_count IS 'Driven (output) sprocket tooth count.';
COMMENT ON COLUMN transfer_case_internals.drive_sprocket_tooth_count IS 'Drive (input) sprocket tooth count.';
COMMENT ON COLUMN transfer_case_internals.planetary_type IS 'Planetary gear set type, e.g. simple, compound, ravigneaux.';
COMMENT ON COLUMN transfer_case_internals.planetary_gear_count IS 'Number of planet gears.';
COMMENT ON COLUMN transfer_case_internals.sun_gear_tooth_count IS 'Sun gear tooth count.';
COMMENT ON COLUMN transfer_case_internals.ring_gear_tooth_count IS 'Ring gear tooth count.';
COMMENT ON COLUMN transfer_case_internals.input_bearing_type IS 'Input shaft bearing type.';
COMMENT ON COLUMN transfer_case_internals.front_output_bearing_type IS 'Front output shaft bearing type.';
COMMENT ON COLUMN transfer_case_internals.rear_output_bearing_type IS 'Rear output shaft bearing type.';
COMMENT ON COLUMN transfer_case_internals.intermediate_bearing_type IS 'Intermediate shaft bearing type.';
COMMENT ON COLUMN transfer_case_internals.front_output_seal_type IS 'Front output shaft seal type.';
COMMENT ON COLUMN transfer_case_internals.rear_output_seal_type IS 'Rear output shaft seal type.';
COMMENT ON COLUMN transfer_case_internals.input_seal_type IS 'Input shaft seal type.';
COMMENT ON COLUMN transfer_case_internals.shift_shaft_seal_type IS 'Shift lever shaft seal type.';
COMMENT ON COLUMN transfer_case_internals.shift_fork_material IS 'Shift fork material, e.g. cast_iron, steel, aluminum.';
COMMENT ON COLUMN transfer_case_internals.shift_rail_count IS 'Number of shift rails.';
COMMENT ON COLUMN transfer_case_internals.mode_sleeve_type IS 'Mode/range selector sleeve type.';
COMMENT ON COLUMN transfer_case_internals.is_original IS 'True if factory-original internals.';
COMMENT ON COLUMN transfer_case_internals.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN transfer_case_internals.condition_notes IS 'Freeform condition details, e.g. chain stretch measured at 0.5%.';
COMMENT ON COLUMN transfer_case_internals.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN transfer_case_internals.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN transfer_case_internals.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN transfer_case_internals.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 11. TRANSFER_CASE_CONTROLS — shift type, motor, sensors
-- ============================================================

CREATE TABLE transfer_case_controls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  transfer_case_id UUID REFERENCES transfer_cases(id) ON DELETE SET NULL,

  shift_type TEXT,
  shift_lever_type TEXT,
  shift_motor_manufacturer TEXT,
  shift_motor_part_number TEXT,
  shift_motor_type TEXT,
  encoder_motor_part_number TEXT,
  position_sensor_type TEXT,
  position_sensor_part_number TEXT,
  front_axle_actuator_type TEXT,
  front_axle_actuator_part_number TEXT,
  vacuum_switch_type TEXT,
  indicator_light_type TEXT,
  control_module_part_number TEXT,
  control_module_manufacturer TEXT,

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transfer_case_controls ADD CONSTRAINT chk_xferc_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE transfer_case_controls ADD CONSTRAINT chk_xferc_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE transfer_case_controls ADD CONSTRAINT chk_xferc_shift
  CHECK (shift_type IS NULL OR shift_type IN (
    'manual_floor', 'manual_dash', 'electric_pushbutton', 'electric_switch',
    'electric_dial', 'vacuum', 'cable', 'other'
  ));

CREATE INDEX idx_xfer_controls_vehicle ON transfer_case_controls(vehicle_id);

COMMENT ON TABLE transfer_case_controls IS 'Transfer case shift/control mechanisms: shift type, motors, sensors, actuators.';
COMMENT ON COLUMN transfer_case_controls.id IS 'Primary key.';
COMMENT ON COLUMN transfer_case_controls.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN transfer_case_controls.transfer_case_id IS 'FK to transfer_cases(id).';
COMMENT ON COLUMN transfer_case_controls.shift_type IS 'Shift mechanism: manual_floor, manual_dash, electric_pushbutton, electric_switch, electric_dial, vacuum, cable, other.';
COMMENT ON COLUMN transfer_case_controls.shift_lever_type IS 'Shift lever description for manual shift, e.g. twin_stick, single_lever.';
COMMENT ON COLUMN transfer_case_controls.shift_motor_manufacturer IS 'Shift motor manufacturer.';
COMMENT ON COLUMN transfer_case_controls.shift_motor_part_number IS 'Shift motor part number.';
COMMENT ON COLUMN transfer_case_controls.shift_motor_type IS 'Shift motor type, e.g. dc_gear_motor, stepper.';
COMMENT ON COLUMN transfer_case_controls.encoder_motor_part_number IS 'Encoder motor part number for position feedback.';
COMMENT ON COLUMN transfer_case_controls.position_sensor_type IS 'Position/mode sensor type for electronic shift.';
COMMENT ON COLUMN transfer_case_controls.position_sensor_part_number IS 'Position sensor part number.';
COMMENT ON COLUMN transfer_case_controls.front_axle_actuator_type IS 'Front axle engagement actuator type, e.g. vacuum, electric, manual_hub.';
COMMENT ON COLUMN transfer_case_controls.front_axle_actuator_part_number IS 'Front axle actuator part number.';
COMMENT ON COLUMN transfer_case_controls.vacuum_switch_type IS 'Vacuum switch type for vacuum-actuated systems.';
COMMENT ON COLUMN transfer_case_controls.indicator_light_type IS 'Dashboard 4WD indicator light type.';
COMMENT ON COLUMN transfer_case_controls.control_module_part_number IS 'Electronic shift control module part number.';
COMMENT ON COLUMN transfer_case_controls.control_module_manufacturer IS 'Control module manufacturer.';
COMMENT ON COLUMN transfer_case_controls.is_original IS 'True if factory-installed controls.';
COMMENT ON COLUMN transfer_case_controls.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN transfer_case_controls.condition_notes IS 'Freeform condition details, e.g. shift motor intermittent.';
COMMENT ON COLUMN transfer_case_controls.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN transfer_case_controls.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN transfer_case_controls.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN transfer_case_controls.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- SUBSYSTEM 3: DRIVELINE / AXLE
-- ============================================================

-- ============================================================
-- 12. DRIVESHAFTS
-- ============================================================

CREATE TABLE driveshafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  position TEXT NOT NULL,
  length_inches NUMERIC(6,2),
  tube_diameter_inches NUMERIC(5,3),
  tube_wall_thickness_inches NUMERIC(4,3),
  tube_material TEXT,
  u_joint_series TEXT,
  u_joint_type TEXT,
  slip_yoke_spline_count INTEGER,
  slip_yoke_type TEXT,
  flange_yoke_bolt_count INTEGER,
  flange_yoke_bolt_circle_mm NUMERIC(6,2),
  carrier_bearing_equipped BOOLEAN DEFAULT FALSE,
  carrier_bearing_part_number TEXT,
  cv_joint_equipped BOOLEAN DEFAULT FALSE,
  balance_weight_count INTEGER,
  critical_speed_rpm INTEGER,
  phasing_degrees NUMERIC(4,1),
  part_number TEXT,
  manufacturer TEXT,

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE driveshafts ADD CONSTRAINT chk_ds_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE driveshafts ADD CONSTRAINT chk_ds_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE driveshafts ADD CONSTRAINT chk_ds_position
  CHECK (position IN ('front', 'rear', 'center', 'front_half', 'rear_half'));
ALTER TABLE driveshafts ADD CONSTRAINT chk_ds_material
  CHECK (tube_material IS NULL OR tube_material IN (
    'steel', 'aluminum', 'carbon_fiber', 'chromoly', 'other'
  ));

CREATE INDEX idx_driveshafts_vehicle ON driveshafts(vehicle_id);

COMMENT ON TABLE driveshafts IS 'Driveshaft specifications. One row per driveshaft section (front, rear, center for multi-piece).';
COMMENT ON COLUMN driveshafts.id IS 'Primary key.';
COMMENT ON COLUMN driveshafts.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN driveshafts.position IS 'Position: front, rear, center, front_half, rear_half.';
COMMENT ON COLUMN driveshafts.length_inches IS 'Overall driveshaft length in inches.';
COMMENT ON COLUMN driveshafts.tube_diameter_inches IS 'Driveshaft tube outer diameter in inches.';
COMMENT ON COLUMN driveshafts.tube_wall_thickness_inches IS 'Tube wall thickness in inches.';
COMMENT ON COLUMN driveshafts.tube_material IS 'Tube material: steel, aluminum, carbon_fiber, chromoly, other.';
COMMENT ON COLUMN driveshafts.u_joint_series IS 'U-joint series, e.g. 1310, 1330, 1350, 1410.';
COMMENT ON COLUMN driveshafts.u_joint_type IS 'U-joint type, e.g. external_snap_ring, internal_clip, u_bolt, strap.';
COMMENT ON COLUMN driveshafts.slip_yoke_spline_count IS 'Slip yoke spline count for transmission/transfer case end.';
COMMENT ON COLUMN driveshafts.slip_yoke_type IS 'Slip yoke type, e.g. internal, external.';
COMMENT ON COLUMN driveshafts.flange_yoke_bolt_count IS 'Flange yoke bolt count for pinion/output flange end.';
COMMENT ON COLUMN driveshafts.flange_yoke_bolt_circle_mm IS 'Flange yoke bolt circle diameter in mm.';
COMMENT ON COLUMN driveshafts.carrier_bearing_equipped IS 'True if two-piece shaft with carrier bearing.';
COMMENT ON COLUMN driveshafts.carrier_bearing_part_number IS 'Carrier/center support bearing part number.';
COMMENT ON COLUMN driveshafts.cv_joint_equipped IS 'True if driveshaft uses CV joint instead of U-joint.';
COMMENT ON COLUMN driveshafts.balance_weight_count IS 'Number of balance weights welded to tube.';
COMMENT ON COLUMN driveshafts.critical_speed_rpm IS 'Calculated critical speed in RPM for shaft whip.';
COMMENT ON COLUMN driveshafts.phasing_degrees IS 'U-joint phasing angle in degrees.';
COMMENT ON COLUMN driveshafts.part_number IS 'Driveshaft assembly part number.';
COMMENT ON COLUMN driveshafts.manufacturer IS 'Driveshaft manufacturer, e.g. factory, Tom Wood, Inland Empire.';
COMMENT ON COLUMN driveshafts.is_original IS 'True if factory-installed driveshaft.';
COMMENT ON COLUMN driveshafts.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN driveshafts.condition_notes IS 'Freeform condition details, e.g. vibration at 65mph.';
COMMENT ON COLUMN driveshafts.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN driveshafts.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN driveshafts.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN driveshafts.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 13. FRONT_AXLES
-- ============================================================

CREATE TABLE front_axles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Identification
  casting_number TEXT,
  part_number TEXT,
  manufacturer TEXT,
  model TEXT,
  date_code TEXT,

  -- Specification
  axle_type TEXT,
  ratio NUMERIC(5,3),
  ring_gear_diameter_inches NUMERIC(5,3),
  spline_count INTEGER,
  locking_type TEXT,
  locking_manufacturer TEXT,
  locking_model TEXT,
  hub_type TEXT,
  hub_bolt_count INTEGER,
  hub_bolt_pattern TEXT,
  knuckle_type TEXT,
  knuckle_material TEXT,
  kingpin_type TEXT,
  kingpin_size TEXT,
  axle_shaft_material TEXT,
  axle_shaft_type TEXT,
  steering_stop_spec TEXT,
  caster_degrees NUMERIC(4,1),
  camber_degrees NUMERIC(4,1),
  gross_axle_weight_rating_lbs INTEGER,
  width_inches NUMERIC(6,2),

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE front_axles ADD CONSTRAINT chk_fa_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE front_axles ADD CONSTRAINT chk_fa_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE front_axles ADD CONSTRAINT chk_fa_type
  CHECK (axle_type IS NULL OR axle_type IN (
    'solid', 'ifs', 'ifs_cv', 'twin_traction_beam', 'dead_beam', 'other'
  ));
ALTER TABLE front_axles ADD CONSTRAINT chk_fa_locking
  CHECK (locking_type IS NULL OR locking_type IN (
    'open', 'limited_slip', 'locking_manual', 'locking_auto', 'selectable', 'spool', 'other'
  ));
ALTER TABLE front_axles ADD CONSTRAINT chk_fa_hub
  CHECK (hub_type IS NULL OR hub_type IN (
    'manual_locking', 'auto_locking', 'warn_premium', 'fixed', 'unit_bearing', 'other'
  ));
ALTER TABLE front_axles ADD CONSTRAINT chk_fa_knuckle
  CHECK (knuckle_type IS NULL OR knuckle_type IN (
    'closed_knuckle', 'open_knuckle', 'kingpin', 'ball_joint', 'other'
  ));

CREATE INDEX idx_front_axles_vehicle ON front_axles(vehicle_id);

COMMENT ON TABLE front_axles IS 'Front axle assembly specifications. One row per front axle installed (current or historical).';
COMMENT ON COLUMN front_axles.id IS 'Primary key.';
COMMENT ON COLUMN front_axles.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN front_axles.casting_number IS 'Housing casting number.';
COMMENT ON COLUMN front_axles.part_number IS 'Assembly part number.';
COMMENT ON COLUMN front_axles.manufacturer IS 'Axle manufacturer, e.g. Dana, GM Corporate, Ford, AAM.';
COMMENT ON COLUMN front_axles.model IS 'Axle model, e.g. Dana 44, Dana 60, GM 10-bolt, 8.25 IFS.';
COMMENT ON COLUMN front_axles.date_code IS 'Date code stamped on the housing.';
COMMENT ON COLUMN front_axles.axle_type IS 'Configuration: solid, ifs, ifs_cv, twin_traction_beam, dead_beam, other.';
COMMENT ON COLUMN front_axles.ratio IS 'Gear ratio, e.g. 3.730, 4.100.';
COMMENT ON COLUMN front_axles.ring_gear_diameter_inches IS 'Ring gear diameter in inches.';
COMMENT ON COLUMN front_axles.spline_count IS 'Axle shaft spline count.';
COMMENT ON COLUMN front_axles.locking_type IS 'Differential locking: open, limited_slip, locking_manual, locking_auto, selectable, spool, other.';
COMMENT ON COLUMN front_axles.locking_manufacturer IS 'Locker/LSD manufacturer, e.g. ARB, Detroit, Eaton.';
COMMENT ON COLUMN front_axles.locking_model IS 'Locker/LSD model name.';
COMMENT ON COLUMN front_axles.hub_type IS 'Hub type: manual_locking, auto_locking, warn_premium, fixed, unit_bearing, other.';
COMMENT ON COLUMN front_axles.hub_bolt_count IS 'Number of wheel studs/bolts per hub.';
COMMENT ON COLUMN front_axles.hub_bolt_pattern IS 'Bolt pattern, e.g. 6x5.5, 5x5.';
COMMENT ON COLUMN front_axles.knuckle_type IS 'Steering knuckle type: closed_knuckle, open_knuckle, kingpin, ball_joint, other.';
COMMENT ON COLUMN front_axles.knuckle_material IS 'Knuckle material, e.g. cast_iron, ductile_iron, forged_steel.';
COMMENT ON COLUMN front_axles.kingpin_type IS 'Kingpin type if applicable, e.g. closed_knuckle, open_knuckle.';
COMMENT ON COLUMN front_axles.kingpin_size IS 'Kingpin size/spec.';
COMMENT ON COLUMN front_axles.axle_shaft_material IS 'Axle shaft material, e.g. 1541h, 4340_chromoly, oem.';
COMMENT ON COLUMN front_axles.axle_shaft_type IS 'Axle shaft type, e.g. inner_outer, unit, birfield_cv.';
COMMENT ON COLUMN front_axles.steering_stop_spec IS 'Steering stop/lock specification.';
COMMENT ON COLUMN front_axles.caster_degrees IS 'Factory caster angle in degrees.';
COMMENT ON COLUMN front_axles.camber_degrees IS 'Factory camber angle in degrees.';
COMMENT ON COLUMN front_axles.gross_axle_weight_rating_lbs IS 'GAWR in pounds.';
COMMENT ON COLUMN front_axles.width_inches IS 'Overall axle width in inches (flange to flange).';
COMMENT ON COLUMN front_axles.is_original IS 'True if factory-installed front axle.';
COMMENT ON COLUMN front_axles.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN front_axles.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN front_axles.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN front_axles.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN front_axles.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN front_axles.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 14. REAR_AXLES
-- ============================================================

CREATE TABLE rear_axles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Identification
  casting_number TEXT,
  part_number TEXT,
  axle_code TEXT,
  date_code TEXT,
  manufacturer TEXT,
  model TEXT,

  -- Specification
  housing_type TEXT,
  ring_gear_diameter_inches NUMERIC(5,3),
  ratio NUMERIC(5,3),
  spline_count INTEGER,
  limited_slip_type TEXT,
  limited_slip_manufacturer TEXT,
  limited_slip_model TEXT,
  axle_shaft_type TEXT,
  axle_shaft_material TEXT,
  axle_shaft_c_clip BOOLEAN,
  axle_bearing_type TEXT,
  hub_bolt_count INTEGER,
  hub_bolt_pattern TEXT,
  cover_type TEXT,
  cover_material TEXT,
  fluid_type TEXT,
  fluid_capacity_quarts NUMERIC(4,1),
  gross_axle_weight_rating_lbs INTEGER,
  width_inches NUMERIC(6,2),
  pinion_offset_inches NUMERIC(5,3),

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rear_axles ADD CONSTRAINT chk_ra_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE rear_axles ADD CONSTRAINT chk_ra_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE rear_axles ADD CONSTRAINT chk_ra_housing
  CHECK (housing_type IS NULL OR housing_type IN (
    'banjo', 'salisbury', 'semi_floating', 'full_floating', 'irs', 'other'
  ));
ALTER TABLE rear_axles ADD CONSTRAINT chk_ra_ls
  CHECK (limited_slip_type IS NULL OR limited_slip_type IN (
    'open', 'clutch_type', 'cone_type', 'gear_type', 'viscous',
    'electronic', 'locker', 'spool', 'mini_spool', 'other'
  ));

CREATE INDEX idx_rear_axles_vehicle ON rear_axles(vehicle_id);

COMMENT ON TABLE rear_axles IS 'Rear axle assembly specifications. One row per rear axle installed (current or historical).';
COMMENT ON COLUMN rear_axles.id IS 'Primary key.';
COMMENT ON COLUMN rear_axles.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN rear_axles.casting_number IS 'Housing casting number.';
COMMENT ON COLUMN rear_axles.part_number IS 'Assembly part number.';
COMMENT ON COLUMN rear_axles.axle_code IS 'Axle code stamped on housing or tag, e.g. GM RPO code GU6.';
COMMENT ON COLUMN rear_axles.date_code IS 'Date code stamped on the housing or tag.';
COMMENT ON COLUMN rear_axles.manufacturer IS 'Axle manufacturer, e.g. Dana, GM Corporate, Ford, Chrysler, AAM, Eaton.';
COMMENT ON COLUMN rear_axles.model IS 'Axle model, e.g. Dana 60, GM 12-bolt, Ford 9-inch, Chrysler 8.75.';
COMMENT ON COLUMN rear_axles.housing_type IS 'Housing style: banjo, salisbury, semi_floating, full_floating, irs, other.';
COMMENT ON COLUMN rear_axles.ring_gear_diameter_inches IS 'Ring gear diameter in inches, e.g. 8.875 for GM 12-bolt.';
COMMENT ON COLUMN rear_axles.ratio IS 'Gear ratio, e.g. 3.730, 4.100, 4.560.';
COMMENT ON COLUMN rear_axles.spline_count IS 'Axle shaft spline count.';
COMMENT ON COLUMN rear_axles.limited_slip_type IS 'Differential type: open, clutch_type, cone_type, gear_type, viscous, electronic, locker, spool, mini_spool, other.';
COMMENT ON COLUMN rear_axles.limited_slip_manufacturer IS 'LSD/locker manufacturer, e.g. Eaton, Auburn, Detroit Truetrac, ARB.';
COMMENT ON COLUMN rear_axles.limited_slip_model IS 'LSD/locker model name.';
COMMENT ON COLUMN rear_axles.axle_shaft_type IS 'Shaft type, e.g. c_clip, full_floating, press_fit.';
COMMENT ON COLUMN rear_axles.axle_shaft_material IS 'Shaft material, e.g. 1541h, 4340_chromoly, oem.';
COMMENT ON COLUMN rear_axles.axle_shaft_c_clip IS 'True if axle shafts are retained by C-clips in the differential.';
COMMENT ON COLUMN rear_axles.axle_bearing_type IS 'Axle bearing type, e.g. ball, tapered_roller, sealed_unit.';
COMMENT ON COLUMN rear_axles.hub_bolt_count IS 'Number of wheel studs per hub.';
COMMENT ON COLUMN rear_axles.hub_bolt_pattern IS 'Bolt pattern, e.g. 5x4.75, 6x5.5.';
COMMENT ON COLUMN rear_axles.cover_type IS 'Differential cover type, e.g. stamped_steel, cast_aluminum, finned_aluminum, girdle.';
COMMENT ON COLUMN rear_axles.cover_material IS 'Cover material.';
COMMENT ON COLUMN rear_axles.fluid_type IS 'Required gear oil, e.g. gl5_75w90, gl5_80w90_ls.';
COMMENT ON COLUMN rear_axles.fluid_capacity_quarts IS 'Gear oil capacity in quarts.';
COMMENT ON COLUMN rear_axles.gross_axle_weight_rating_lbs IS 'GAWR in pounds.';
COMMENT ON COLUMN rear_axles.width_inches IS 'Overall axle width in inches (flange to flange).';
COMMENT ON COLUMN rear_axles.pinion_offset_inches IS 'Pinion offset from axle centerline (hypoid offset) in inches.';
COMMENT ON COLUMN rear_axles.is_original IS 'True if factory-installed rear axle.';
COMMENT ON COLUMN rear_axles.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN rear_axles.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN rear_axles.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN rear_axles.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN rear_axles.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN rear_axles.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 15. AXLE_BEARINGS — per-axle bearing specs
-- ============================================================

CREATE TABLE axle_bearings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  axle_position TEXT NOT NULL,
  side TEXT NOT NULL,
  bearing_type TEXT,
  bearing_part_number TEXT,
  bearing_manufacturer TEXT,
  preload_spec TEXT,
  preload_method TEXT,
  seal_type TEXT,
  seal_part_number TEXT,
  seal_manufacturer TEXT,
  retainer_type TEXT,
  retainer_bolt_count INTEGER,
  abs_tone_ring BOOLEAN DEFAULT FALSE,
  measured_play_mm NUMERIC(5,3),

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE axle_bearings ADD CONSTRAINT chk_ab_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE axle_bearings ADD CONSTRAINT chk_ab_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE axle_bearings ADD CONSTRAINT chk_ab_position
  CHECK (axle_position IN ('front', 'rear'));
ALTER TABLE axle_bearings ADD CONSTRAINT chk_ab_side
  CHECK (side IN ('left', 'right'));
ALTER TABLE axle_bearings ADD CONSTRAINT chk_ab_type
  CHECK (bearing_type IS NULL OR bearing_type IN (
    'ball', 'tapered_roller', 'sealed_unit', 'needle', 'cylindrical_roller', 'other'
  ));

CREATE INDEX idx_axle_bearings_vehicle ON axle_bearings(vehicle_id);

COMMENT ON TABLE axle_bearings IS 'Per-axle bearing specifications. One row per bearing position (axle_position + side).';
COMMENT ON COLUMN axle_bearings.id IS 'Primary key.';
COMMENT ON COLUMN axle_bearings.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN axle_bearings.axle_position IS 'Which axle: front or rear.';
COMMENT ON COLUMN axle_bearings.side IS 'Which side: left or right.';
COMMENT ON COLUMN axle_bearings.bearing_type IS 'Bearing type: ball, tapered_roller, sealed_unit, needle, cylindrical_roller, other.';
COMMENT ON COLUMN axle_bearings.bearing_part_number IS 'Bearing part number, e.g. Timken A-6.';
COMMENT ON COLUMN axle_bearings.bearing_manufacturer IS 'Bearing manufacturer, e.g. Timken, Koyo, National.';
COMMENT ON COLUMN axle_bearings.preload_spec IS 'Bearing preload specification value.';
COMMENT ON COLUMN axle_bearings.preload_method IS 'How preload is set, e.g. crush_sleeve, shim, torque_spec.';
COMMENT ON COLUMN axle_bearings.seal_type IS 'Axle seal type, e.g. lip_seal, o_ring, unitized.';
COMMENT ON COLUMN axle_bearings.seal_part_number IS 'Seal part number.';
COMMENT ON COLUMN axle_bearings.seal_manufacturer IS 'Seal manufacturer.';
COMMENT ON COLUMN axle_bearings.retainer_type IS 'Bearing retainer type, e.g. c_clip, retainer_plate, press_fit.';
COMMENT ON COLUMN axle_bearings.retainer_bolt_count IS 'Number of retainer plate bolts.';
COMMENT ON COLUMN axle_bearings.abs_tone_ring IS 'True if ABS tone ring is on the axle shaft or integrated into bearing.';
COMMENT ON COLUMN axle_bearings.measured_play_mm IS 'Last measured bearing end-play in mm.';
COMMENT ON COLUMN axle_bearings.is_original IS 'True if factory-installed bearing.';
COMMENT ON COLUMN axle_bearings.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN axle_bearings.condition_notes IS 'Freeform condition details, e.g. slight growl at speed.';
COMMENT ON COLUMN axle_bearings.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN axle_bearings.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN axle_bearings.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN axle_bearings.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 16. DIFFERENTIALS — carrier, gear setup specs
-- ============================================================

CREATE TABLE differentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  axle_position TEXT NOT NULL,
  carrier_type TEXT,
  carrier_breaks TEXT,
  gear_type TEXT,
  ring_gear_bolt_count INTEGER,
  ring_gear_bolt_size TEXT,
  pinion_spline_count INTEGER,
  pinion_depth_mm NUMERIC(6,3),
  backlash_mm NUMERIC(5,3),
  backlash_spec_mm TEXT,
  pattern_contact TEXT,
  carrier_bearing_preload TEXT,
  pinion_bearing_preload TEXT,
  crush_sleeve_part_number TEXT,
  shim_pack_thickness_mm NUMERIC(5,3),
  pinion_nut_torque_lb_ft INTEGER,
  ring_gear_torque_lb_ft INTEGER,
  setup_bearing_used BOOLEAN DEFAULT FALSE,
  gear_set_manufacturer TEXT,
  gear_set_part_number TEXT,

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE differentials ADD CONSTRAINT chk_diff_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE differentials ADD CONSTRAINT chk_diff_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE differentials ADD CONSTRAINT chk_diff_position
  CHECK (axle_position IN ('front', 'rear', 'center'));
ALTER TABLE differentials ADD CONSTRAINT chk_diff_carrier
  CHECK (carrier_type IS NULL OR carrier_type IN (
    'drop_in', 'nodular_iron', 'aluminum', 'billet', 'other'
  ));
ALTER TABLE differentials ADD CONSTRAINT chk_diff_gear_type
  CHECK (gear_type IS NULL OR gear_type IN (
    'hypoid', 'spiral_bevel', 'straight_bevel', 'worm', 'other'
  ));

CREATE INDEX idx_differentials_vehicle ON differentials(vehicle_id);

COMMENT ON TABLE differentials IS 'Differential carrier and ring-and-pinion setup specifications. One row per differential (front, rear, or center).';
COMMENT ON COLUMN differentials.id IS 'Primary key.';
COMMENT ON COLUMN differentials.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN differentials.axle_position IS 'Which differential: front, rear, or center.';
COMMENT ON COLUMN differentials.carrier_type IS 'Carrier type: drop_in, nodular_iron, aluminum, billet, other.';
COMMENT ON COLUMN differentials.carrier_breaks IS 'Carrier break point, e.g. 3.73_and_down for GM 12-bolt.';
COMMENT ON COLUMN differentials.gear_type IS 'Ring and pinion gear type: hypoid, spiral_bevel, straight_bevel, worm, other.';
COMMENT ON COLUMN differentials.ring_gear_bolt_count IS 'Number of ring gear bolts.';
COMMENT ON COLUMN differentials.ring_gear_bolt_size IS 'Ring gear bolt size, e.g. 7/16-20, 3/8-24.';
COMMENT ON COLUMN differentials.pinion_spline_count IS 'Pinion shaft spline count.';
COMMENT ON COLUMN differentials.pinion_depth_mm IS 'Measured pinion depth in mm from centerline.';
COMMENT ON COLUMN differentials.backlash_mm IS 'Measured ring gear backlash in mm.';
COMMENT ON COLUMN differentials.backlash_spec_mm IS 'Factory backlash specification range, e.g. 0.15-0.20.';
COMMENT ON COLUMN differentials.pattern_contact IS 'Gear contact pattern description, e.g. centered, heel_heavy, toe_heavy.';
COMMENT ON COLUMN differentials.carrier_bearing_preload IS 'Carrier bearing preload specification.';
COMMENT ON COLUMN differentials.pinion_bearing_preload IS 'Pinion bearing preload specification.';
COMMENT ON COLUMN differentials.crush_sleeve_part_number IS 'Crush sleeve part number if applicable.';
COMMENT ON COLUMN differentials.shim_pack_thickness_mm IS 'Total shim pack thickness in mm for pinion depth.';
COMMENT ON COLUMN differentials.pinion_nut_torque_lb_ft IS 'Pinion nut torque specification in lb-ft.';
COMMENT ON COLUMN differentials.ring_gear_torque_lb_ft IS 'Ring gear bolt torque specification in lb-ft.';
COMMENT ON COLUMN differentials.setup_bearing_used IS 'True if setup was performed with dedicated setup bearings.';
COMMENT ON COLUMN differentials.gear_set_manufacturer IS 'Ring and pinion manufacturer, e.g. factory, Motive, Yukon, US Gear, Richmond.';
COMMENT ON COLUMN differentials.gear_set_part_number IS 'Ring and pinion gear set part number.';
COMMENT ON COLUMN differentials.is_original IS 'True if factory-installed differential setup.';
COMMENT ON COLUMN differentials.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN differentials.condition_notes IS 'Freeform condition details, e.g. gear whine at decel.';
COMMENT ON COLUMN differentials.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN differentials.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN differentials.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN differentials.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 17. CV_JOINTS_OR_U_JOINTS — per-joint specs
-- ============================================================

CREATE TABLE cv_joints_or_u_joints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  location TEXT NOT NULL,
  joint_type TEXT NOT NULL,
  series TEXT,
  manufacturer TEXT,
  part_number TEXT,
  cap_diameter_mm NUMERIC(6,3),
  snap_ring_type TEXT,
  grease_type TEXT,
  grease_fitting BOOLEAN DEFAULT FALSE,
  boot_type TEXT,
  boot_material TEXT,
  boot_clamp_type TEXT,
  max_angle_degrees NUMERIC(4,1),
  operating_angle_degrees NUMERIC(4,1),
  plunge_length_mm NUMERIC(6,2),

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE cv_joints_or_u_joints ADD CONSTRAINT chk_cvu_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE cv_joints_or_u_joints ADD CONSTRAINT chk_cvu_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE cv_joints_or_u_joints ADD CONSTRAINT chk_cvu_location
  CHECK (location IN (
    'front_driveshaft_front', 'front_driveshaft_rear',
    'rear_driveshaft_front', 'rear_driveshaft_rear',
    'center_carrier',
    'front_axle_inner_left', 'front_axle_inner_right',
    'front_axle_outer_left', 'front_axle_outer_right',
    'rear_axle_inner_left', 'rear_axle_inner_right',
    'rear_axle_outer_left', 'rear_axle_outer_right',
    'other'
  ));
ALTER TABLE cv_joints_or_u_joints ADD CONSTRAINT chk_cvu_type
  CHECK (joint_type IN (
    'u_joint', 'rzeppa_cv', 'birfield_cv', 'tripod_cv', 'double_cardan', 'plunging_cv', 'other'
  ));

CREATE INDEX idx_cvu_joints_vehicle ON cv_joints_or_u_joints(vehicle_id);

COMMENT ON TABLE cv_joints_or_u_joints IS 'Per-joint CV or U-joint specifications. One row per joint location in the driveline.';
COMMENT ON COLUMN cv_joints_or_u_joints.id IS 'Primary key.';
COMMENT ON COLUMN cv_joints_or_u_joints.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN cv_joints_or_u_joints.location IS 'Joint location in the driveline. See CHECK constraint for valid values.';
COMMENT ON COLUMN cv_joints_or_u_joints.joint_type IS 'Joint type: u_joint, rzeppa_cv, birfield_cv, tripod_cv, double_cardan, plunging_cv, other.';
COMMENT ON COLUMN cv_joints_or_u_joints.series IS 'U-joint series, e.g. 1310, 1330, 1350. NULL for CV joints.';
COMMENT ON COLUMN cv_joints_or_u_joints.manufacturer IS 'Joint manufacturer, e.g. Spicer, Moog, GKN, factory.';
COMMENT ON COLUMN cv_joints_or_u_joints.part_number IS 'Joint part number.';
COMMENT ON COLUMN cv_joints_or_u_joints.cap_diameter_mm IS 'U-joint bearing cap diameter in mm.';
COMMENT ON COLUMN cv_joints_or_u_joints.snap_ring_type IS 'Snap ring/clip type, e.g. external, internal, injected_nylon.';
COMMENT ON COLUMN cv_joints_or_u_joints.grease_type IS 'Required grease type, e.g. moly, nlgi2, cv_joint_grease.';
COMMENT ON COLUMN cv_joints_or_u_joints.grease_fitting IS 'True if joint has a grease zerk fitting.';
COMMENT ON COLUMN cv_joints_or_u_joints.boot_type IS 'CV boot type, e.g. standard, heavy_duty, split. NULL for U-joints.';
COMMENT ON COLUMN cv_joints_or_u_joints.boot_material IS 'Boot material, e.g. rubber, thermoplastic, silicone.';
COMMENT ON COLUMN cv_joints_or_u_joints.boot_clamp_type IS 'Boot clamp type, e.g. crimp, ear_type, worm_gear.';
COMMENT ON COLUMN cv_joints_or_u_joints.max_angle_degrees IS 'Maximum operating angle in degrees.';
COMMENT ON COLUMN cv_joints_or_u_joints.operating_angle_degrees IS 'Current installed operating angle in degrees.';
COMMENT ON COLUMN cv_joints_or_u_joints.plunge_length_mm IS 'Available plunge/slide length in mm (CV joints).';
COMMENT ON COLUMN cv_joints_or_u_joints.is_original IS 'True if factory-installed joint.';
COMMENT ON COLUMN cv_joints_or_u_joints.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN cv_joints_or_u_joints.condition_notes IS 'Freeform condition details, e.g. slight play detected.';
COMMENT ON COLUMN cv_joints_or_u_joints.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN cv_joints_or_u_joints.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN cv_joints_or_u_joints.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN cv_joints_or_u_joints.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 18. HUBS_AND_WHEEL_BEARINGS — per-corner specs
-- ============================================================

CREATE TABLE hubs_and_wheel_bearings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  corner TEXT NOT NULL,
  hub_type TEXT,
  hub_part_number TEXT,
  hub_manufacturer TEXT,
  hub_material TEXT,
  hub_bolt_count INTEGER,
  hub_bolt_pattern TEXT,
  hub_bolt_size TEXT,
  bearing_type TEXT,
  bearing_inner_part_number TEXT,
  bearing_outer_part_number TEXT,
  bearing_manufacturer TEXT,
  preload_spec TEXT,
  preload_method TEXT,
  seal_type TEXT,
  seal_part_number TEXT,
  dust_cap_type TEXT,
  cotter_pin_required BOOLEAN,
  spindle_nut_torque_lb_ft INTEGER,
  abs_sensor_equipped BOOLEAN DEFAULT FALSE,
  abs_sensor_type TEXT,
  abs_sensor_part_number TEXT,
  abs_tone_ring_tooth_count INTEGER,
  wheel_stud_size TEXT,
  wheel_stud_material TEXT,

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE hubs_and_wheel_bearings ADD CONSTRAINT chk_hwb_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE hubs_and_wheel_bearings ADD CONSTRAINT chk_hwb_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE hubs_and_wheel_bearings ADD CONSTRAINT chk_hwb_corner
  CHECK (corner IN ('front_left', 'front_right', 'rear_left', 'rear_right'));
ALTER TABLE hubs_and_wheel_bearings ADD CONSTRAINT chk_hwb_hub_type
  CHECK (hub_type IS NULL OR hub_type IN (
    'serviceable', 'unit_bearing', 'manual_locking', 'auto_locking',
    'free_spinning', 'drive_flange', 'other'
  ));
ALTER TABLE hubs_and_wheel_bearings ADD CONSTRAINT chk_hwb_bearing_type
  CHECK (bearing_type IS NULL OR bearing_type IN (
    'tapered_roller', 'ball', 'sealed_unit', 'needle', 'other'
  ));

CREATE INDEX idx_hubs_wb_vehicle ON hubs_and_wheel_bearings(vehicle_id);

COMMENT ON TABLE hubs_and_wheel_bearings IS 'Per-corner hub and wheel bearing specifications. One row per wheel position.';
COMMENT ON COLUMN hubs_and_wheel_bearings.id IS 'Primary key.';
COMMENT ON COLUMN hubs_and_wheel_bearings.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN hubs_and_wheel_bearings.corner IS 'Wheel position: front_left, front_right, rear_left, rear_right.';
COMMENT ON COLUMN hubs_and_wheel_bearings.hub_type IS 'Hub type: serviceable, unit_bearing, manual_locking, auto_locking, free_spinning, drive_flange, other.';
COMMENT ON COLUMN hubs_and_wheel_bearings.hub_part_number IS 'Hub assembly part number.';
COMMENT ON COLUMN hubs_and_wheel_bearings.hub_manufacturer IS 'Hub manufacturer.';
COMMENT ON COLUMN hubs_and_wheel_bearings.hub_material IS 'Hub material, e.g. cast_iron, ductile_iron, aluminum.';
COMMENT ON COLUMN hubs_and_wheel_bearings.hub_bolt_count IS 'Number of wheel studs.';
COMMENT ON COLUMN hubs_and_wheel_bearings.hub_bolt_pattern IS 'Bolt pattern, e.g. 5x4.75, 6x5.5.';
COMMENT ON COLUMN hubs_and_wheel_bearings.hub_bolt_size IS 'Wheel stud thread size, e.g. 7/16-20, 1/2-20, M12x1.5.';
COMMENT ON COLUMN hubs_and_wheel_bearings.bearing_type IS 'Bearing type: tapered_roller, ball, sealed_unit, needle, other.';
COMMENT ON COLUMN hubs_and_wheel_bearings.bearing_inner_part_number IS 'Inner wheel bearing part number (serviceable hubs).';
COMMENT ON COLUMN hubs_and_wheel_bearings.bearing_outer_part_number IS 'Outer wheel bearing part number (serviceable hubs).';
COMMENT ON COLUMN hubs_and_wheel_bearings.bearing_manufacturer IS 'Bearing manufacturer, e.g. Timken, SKF, Koyo.';
COMMENT ON COLUMN hubs_and_wheel_bearings.preload_spec IS 'Bearing preload specification.';
COMMENT ON COLUMN hubs_and_wheel_bearings.preload_method IS 'How preload is set, e.g. torque_and_back_off, torque_to_spec, cotter_pin.';
COMMENT ON COLUMN hubs_and_wheel_bearings.seal_type IS 'Wheel bearing grease seal type.';
COMMENT ON COLUMN hubs_and_wheel_bearings.seal_part_number IS 'Seal part number.';
COMMENT ON COLUMN hubs_and_wheel_bearings.dust_cap_type IS 'Dust cap type, e.g. press_fit, threaded, integrated.';
COMMENT ON COLUMN hubs_and_wheel_bearings.cotter_pin_required IS 'True if cotter pin is used to retain spindle nut.';
COMMENT ON COLUMN hubs_and_wheel_bearings.spindle_nut_torque_lb_ft IS 'Spindle nut torque specification in lb-ft.';
COMMENT ON COLUMN hubs_and_wheel_bearings.abs_sensor_equipped IS 'True if ABS wheel speed sensor is installed at this corner.';
COMMENT ON COLUMN hubs_and_wheel_bearings.abs_sensor_type IS 'ABS sensor type, e.g. passive_magnetic, active_hall_effect.';
COMMENT ON COLUMN hubs_and_wheel_bearings.abs_sensor_part_number IS 'ABS sensor part number.';
COMMENT ON COLUMN hubs_and_wheel_bearings.abs_tone_ring_tooth_count IS 'ABS tone ring tooth count.';
COMMENT ON COLUMN hubs_and_wheel_bearings.wheel_stud_size IS 'Wheel stud thread size.';
COMMENT ON COLUMN hubs_and_wheel_bearings.wheel_stud_material IS 'Wheel stud material, e.g. grade_8, arp.';
COMMENT ON COLUMN hubs_and_wheel_bearings.is_original IS 'True if factory-installed hub/bearing assembly.';
COMMENT ON COLUMN hubs_and_wheel_bearings.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN hubs_and_wheel_bearings.condition_notes IS 'Freeform condition details, e.g. repack interval due.';
COMMENT ON COLUMN hubs_and_wheel_bearings.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN hubs_and_wheel_bearings.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN hubs_and_wheel_bearings.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN hubs_and_wheel_bearings.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- UPDATED_AT TRIGGERS
-- Uses digital_twin_set_updated_at() created in engine subsystem.
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'transmission_cases',
    'transmission_gears',
    'transmission_internals',
    'transmission_torque_converters',
    'transmission_shifters',
    'transmission_clutch_systems',
    'transmission_controllers',
    'transmission_coolers',
    'transfer_cases',
    'transfer_case_internals',
    'transfer_case_controls',
    'driveshafts',
    'front_axles',
    'rear_axles',
    'axle_bearings',
    'differentials',
    'cv_joints_or_u_joints',
    'hubs_and_wheel_bearings'
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
    'transmission_cases',
    'transmission_gears',
    'transmission_internals',
    'transmission_torque_converters',
    'transmission_shifters',
    'transmission_clutch_systems',
    'transmission_controllers',
    'transmission_coolers',
    'transfer_cases',
    'transfer_case_internals',
    'transfer_case_controls',
    'driveshafts',
    'front_axles',
    'rear_axles',
    'axle_bearings',
    'differentials',
    'cv_joints_or_u_joints',
    'hubs_and_wheel_bearings'
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
