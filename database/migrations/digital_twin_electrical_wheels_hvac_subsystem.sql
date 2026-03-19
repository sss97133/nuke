-- ============================================================
-- DIGITAL TWIN: Electrical, Wheels/Tires, and HVAC Subsystem DDL
--
-- Follows the reference implementation established in
-- digital_twin_engine_subsystem.sql exactly:
--   - vehicle_id FK to vehicles(id) ON DELETE CASCADE
--   - is_original, condition_grade, provenance on every table
--   - Every column commented
--   - CHECK constraints on all enumerated values
--   - Indexes on vehicle_id
--   - Shared updated_at trigger (function already exists — DO NOT recreate)
--   - RLS: public SELECT, service role full access
--
-- DO NOT recreate: actors, component_events, digital_twin_set_updated_at
-- Those are shared across all subsystems and already exist.
-- ============================================================

BEGIN;

-- ============================================================
-- ELECTRICAL SUBSYSTEM
-- ============================================================

-- ============================================================
-- 1. WIRING_HARNESSES
-- ============================================================

CREATE TABLE wiring_harnesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Harness identity
  harness_zone TEXT NOT NULL,
  type TEXT NOT NULL,
  manufacturer TEXT,
  part_number TEXT,

  -- Specification
  gauge_range TEXT,
  connector_types TEXT[],
  circuit_count INTEGER,
  wrapped_yn BOOLEAN,
  loomed_yn BOOLEAN,
  terminal_material TEXT,
  date_code TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wiring_harnesses ADD CONSTRAINT chk_wh_zone
  CHECK (harness_zone IN ('engine', 'dash', 'body', 'tail', 'door', 'trunk'));
ALTER TABLE wiring_harnesses ADD CONSTRAINT chk_wh_type
  CHECK (type IN ('original', 'aftermarket', 'custom'));
ALTER TABLE wiring_harnesses ADD CONSTRAINT chk_wh_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE wiring_harnesses ADD CONSTRAINT chk_wh_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE wiring_harnesses ADD CONSTRAINT chk_wh_circuit_count
  CHECK (circuit_count IS NULL OR circuit_count > 0);

CREATE INDEX idx_wiring_harnesses_vehicle ON wiring_harnesses(vehicle_id);

COMMENT ON TABLE wiring_harnesses IS 'Vehicle wiring harness specifications by zone. One row per harness zone (engine, dash, body, tail, door, trunk).';
COMMENT ON COLUMN wiring_harnesses.id IS 'Primary key.';
COMMENT ON COLUMN wiring_harnesses.vehicle_id IS 'FK to vehicles(id). The vehicle this harness belongs to.';
COMMENT ON COLUMN wiring_harnesses.harness_zone IS 'Area of vehicle the harness serves: engine, dash, body, tail, door, trunk.';
COMMENT ON COLUMN wiring_harnesses.type IS 'Harness origin: original (factory), aftermarket (commercial replacement), custom (hand-built).';
COMMENT ON COLUMN wiring_harnesses.manufacturer IS 'Harness manufacturer, e.g. GM, American Autowire, Painless Performance.';
COMMENT ON COLUMN wiring_harnesses.part_number IS 'Manufacturer or OEM part number.';
COMMENT ON COLUMN wiring_harnesses.gauge_range IS 'Wire gauge range present in harness, e.g. 12-18AWG, 16-20AWG.';
COMMENT ON COLUMN wiring_harnesses.connector_types IS 'Array of connector types present, e.g. {weatherpack, metripack,deutsch}.';
COMMENT ON COLUMN wiring_harnesses.circuit_count IS 'Total number of individual circuits in this harness.';
COMMENT ON COLUMN wiring_harnesses.wrapped_yn IS 'True if harness is wrapped with tape or protective loom.';
COMMENT ON COLUMN wiring_harnesses.loomed_yn IS 'True if harness runs through protective split-loom conduit.';
COMMENT ON COLUMN wiring_harnesses.terminal_material IS 'Terminal material, e.g. tin_plated_copper, gold_plated, aluminum.';
COMMENT ON COLUMN wiring_harnesses.date_code IS 'Date code if present on harness (common on factory harnesses).';
COMMENT ON COLUMN wiring_harnesses.is_original IS 'True if this is the factory-installed harness for this zone.';
COMMENT ON COLUMN wiring_harnesses.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN wiring_harnesses.condition_notes IS 'Freeform condition details, e.g. melted insulation near firewall, previous rodent damage.';
COMMENT ON COLUMN wiring_harnesses.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN wiring_harnesses.provenance_detail IS 'Detailed provenance info: installer, date, reason for replacement.';
COMMENT ON COLUMN wiring_harnesses.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN wiring_harnesses.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 2. BATTERIES
-- ============================================================

CREATE TABLE batteries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Identity
  location TEXT,
  type TEXT,
  group_size TEXT,
  manufacturer TEXT,
  part_number TEXT,

  -- Electrical specification
  cca INTEGER,
  voltage NUMERIC(4,1),
  reserve_capacity_minutes INTEGER,
  amp_hour_rating NUMERIC(6,1),

  -- Physical state
  age_years NUMERIC(4,1),
  date_code TEXT,
  terminal_type TEXT,
  hold_down_type TEXT,
  cable_gauge TEXT,
  ground_strap_count INTEGER,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE batteries ADD CONSTRAINT chk_bat_type
  CHECK (type IS NULL OR type IN ('lead_acid', 'agm', 'gel', 'lithium', 'optima'));
ALTER TABLE batteries ADD CONSTRAINT chk_bat_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE batteries ADD CONSTRAINT chk_bat_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE batteries ADD CONSTRAINT chk_bat_voltage
  CHECK (voltage IS NULL OR voltage IN (6.0, 12.0, 16.0, 24.0, 48.0));
ALTER TABLE batteries ADD CONSTRAINT chk_bat_cca
  CHECK (cca IS NULL OR (cca > 0 AND cca <= 2000));
ALTER TABLE batteries ADD CONSTRAINT chk_bat_age
  CHECK (age_years IS NULL OR (age_years >= 0 AND age_years <= 50));

CREATE INDEX idx_batteries_vehicle ON batteries(vehicle_id);

COMMENT ON TABLE batteries IS 'Battery specifications and condition. One row per battery installed (some vehicles have multiple).';
COMMENT ON COLUMN batteries.id IS 'Primary key.';
COMMENT ON COLUMN batteries.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN batteries.location IS 'Physical location of battery, e.g. engine_bay, trunk, under_rear_seat, bed.';
COMMENT ON COLUMN batteries.type IS 'Battery chemistry: lead_acid, agm, gel, lithium, optima.';
COMMENT ON COLUMN batteries.group_size IS 'BCI group size designation, e.g. 24F, 34/78, 65, H6.';
COMMENT ON COLUMN batteries.manufacturer IS 'Battery manufacturer, e.g. Delco, Interstate, Optima, Odyssey.';
COMMENT ON COLUMN batteries.part_number IS 'Manufacturer part number.';
COMMENT ON COLUMN batteries.cca IS 'Cold cranking amps rating at 0 degrees F.';
COMMENT ON COLUMN batteries.voltage IS 'Nominal battery voltage: 6.0, 12.0, 16.0, 24.0, or 48.0.';
COMMENT ON COLUMN batteries.reserve_capacity_minutes IS 'Reserve capacity in minutes at 25A draw.';
COMMENT ON COLUMN batteries.amp_hour_rating IS 'Amp-hour (Ah) capacity rating.';
COMMENT ON COLUMN batteries.age_years IS 'Approximate age in years at time of record.';
COMMENT ON COLUMN batteries.date_code IS 'Factory date code stamped on battery (format varies by manufacturer).';
COMMENT ON COLUMN batteries.terminal_type IS 'Terminal post type, e.g. top_post, side_post, dual_post, j_strap.';
COMMENT ON COLUMN batteries.hold_down_type IS 'Hold-down hardware type, e.g. top_bar, j_bolt, bracket.';
COMMENT ON COLUMN batteries.cable_gauge IS 'Battery cable wire gauge, e.g. 2AWG, 1/0AWG.';
COMMENT ON COLUMN batteries.ground_strap_count IS 'Number of chassis ground straps installed.';
COMMENT ON COLUMN batteries.is_original IS 'True if this is the factory-specified battery type for this vehicle.';
COMMENT ON COLUMN batteries.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN batteries.condition_notes IS 'Freeform condition details, e.g. terminal corrosion, cracked case.';
COMMENT ON COLUMN batteries.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN batteries.provenance_detail IS 'Detailed provenance: purchase date, retailer, reason for replacement.';
COMMENT ON COLUMN batteries.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN batteries.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 3. ALTERNATORS_GENERATORS
-- ============================================================

CREATE TABLE alternators_generators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Identity
  type TEXT NOT NULL,
  manufacturer TEXT,
  part_number TEXT,
  casting_number TEXT,
  date_code TEXT,

  -- Specification
  output_amps INTEGER,
  voltage_output NUMERIC(4,1),
  pulley_type TEXT,
  pulley_diameter_inches NUMERIC(4,2),
  rotation TEXT,
  internal_regulator_yn BOOLEAN,
  one_wire_yn BOOLEAN,
  regulator_part_number TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE alternators_generators ADD CONSTRAINT chk_altgen_type
  CHECK (type IN ('alternator', 'generator'));
ALTER TABLE alternators_generators ADD CONSTRAINT chk_altgen_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE alternators_generators ADD CONSTRAINT chk_altgen_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE alternators_generators ADD CONSTRAINT chk_altgen_rotation
  CHECK (rotation IS NULL OR rotation IN ('clockwise', 'counterclockwise'));
ALTER TABLE alternators_generators ADD CONSTRAINT chk_altgen_output
  CHECK (output_amps IS NULL OR (output_amps > 0 AND output_amps <= 500));

CREATE INDEX idx_alternators_generators_vehicle ON alternators_generators(vehicle_id);

COMMENT ON TABLE alternators_generators IS 'Alternator or generator specifications. One row per charging unit installed.';
COMMENT ON COLUMN alternators_generators.id IS 'Primary key.';
COMMENT ON COLUMN alternators_generators.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN alternators_generators.type IS 'Unit type: alternator (AC with rectifier) or generator (DC, pre-1960s).';
COMMENT ON COLUMN alternators_generators.manufacturer IS 'Manufacturer, e.g. Delco-Remy, Bosch, Powermaster, Tuff-Stuff.';
COMMENT ON COLUMN alternators_generators.part_number IS 'Manufacturer or OEM part number.';
COMMENT ON COLUMN alternators_generators.casting_number IS 'Casting number on body (for originality verification).';
COMMENT ON COLUMN alternators_generators.date_code IS 'Date code stamped on unit.';
COMMENT ON COLUMN alternators_generators.output_amps IS 'Rated output in amperes at full charge.';
COMMENT ON COLUMN alternators_generators.voltage_output IS 'Regulated output voltage, typically 13.8-14.4V.';
COMMENT ON COLUMN alternators_generators.pulley_type IS 'Pulley type, e.g. single_v, double_v, serpentine, overdrive.';
COMMENT ON COLUMN alternators_generators.pulley_diameter_inches IS 'Drive pulley diameter in inches.';
COMMENT ON COLUMN alternators_generators.rotation IS 'Rotation direction when viewed from pulley end: clockwise or counterclockwise.';
COMMENT ON COLUMN alternators_generators.internal_regulator_yn IS 'True if voltage regulator is integrated inside the unit.';
COMMENT ON COLUMN alternators_generators.one_wire_yn IS 'True if converted to one-wire/self-exciting configuration.';
COMMENT ON COLUMN alternators_generators.regulator_part_number IS 'External regulator part number, if applicable.';
COMMENT ON COLUMN alternators_generators.is_original IS 'True if factory-installed charging unit.';
COMMENT ON COLUMN alternators_generators.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN alternators_generators.condition_notes IS 'Freeform condition details, e.g. brushes worn, diode plate failed.';
COMMENT ON COLUMN alternators_generators.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN alternators_generators.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN alternators_generators.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN alternators_generators.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 4. STARTERS
-- ============================================================

CREATE TABLE starters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Identity
  type TEXT,
  manufacturer TEXT,
  part_number TEXT,
  casting_number TEXT,
  date_code TEXT,

  -- Specification
  torque_lb_ft NUMERIC(5,1),
  engagement_type TEXT,
  mounting_block TEXT,
  shim_count INTEGER,
  solenoid_integrated_yn BOOLEAN,
  solenoid_part_number TEXT,
  pinion_tooth_count INTEGER,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE starters ADD CONSTRAINT chk_str_type
  CHECK (type IS NULL OR type IN ('gear_reduction', 'direct_drive', 'high_torque_mini'));
ALTER TABLE starters ADD CONSTRAINT chk_str_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE starters ADD CONSTRAINT chk_str_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE starters ADD CONSTRAINT chk_str_shim_count
  CHECK (shim_count IS NULL OR (shim_count >= 0 AND shim_count <= 20));

CREATE INDEX idx_starters_vehicle ON starters(vehicle_id);

COMMENT ON TABLE starters IS 'Starter motor specifications. One row per starter installed.';
COMMENT ON COLUMN starters.id IS 'Primary key.';
COMMENT ON COLUMN starters.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN starters.type IS 'Starter design: gear_reduction, direct_drive, high_torque_mini.';
COMMENT ON COLUMN starters.manufacturer IS 'Manufacturer, e.g. Delco-Remy, Nippondenso, Powermaster, Tilton.';
COMMENT ON COLUMN starters.part_number IS 'Manufacturer or OEM part number.';
COMMENT ON COLUMN starters.casting_number IS 'Casting number on housing for originality verification.';
COMMENT ON COLUMN starters.date_code IS 'Date code stamped on unit.';
COMMENT ON COLUMN starters.torque_lb_ft IS 'Cranking torque rating in lb-ft.';
COMMENT ON COLUMN starters.engagement_type IS 'Engagement mechanism, e.g. inertia_bendix, pre_engaged_solenoid.';
COMMENT ON COLUMN starters.mounting_block IS 'Mounting block/adapter used, e.g. stock, sbc_168_tooth, sbc_153_tooth.';
COMMENT ON COLUMN starters.shim_count IS 'Number of shims used between starter and block for pinion clearance.';
COMMENT ON COLUMN starters.solenoid_integrated_yn IS 'True if solenoid is mounted on starter body.';
COMMENT ON COLUMN starters.solenoid_part_number IS 'Solenoid part number if separate or replacement.';
COMMENT ON COLUMN starters.pinion_tooth_count IS 'Number of teeth on starter drive pinion gear.';
COMMENT ON COLUMN starters.is_original IS 'True if factory-installed starter.';
COMMENT ON COLUMN starters.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN starters.condition_notes IS 'Freeform condition details, e.g. slow crank hot, brushes replaced.';
COMMENT ON COLUMN starters.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN starters.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN starters.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN starters.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 5. IGNITION_SWITCHES
-- ============================================================

CREATE TABLE ignition_switches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Identity
  type TEXT,
  manufacturer TEXT,
  part_number TEXT,

  -- Specification
  location TEXT,
  position_count INTEGER,
  positions_available TEXT[],
  tumbler_condition TEXT,
  key_count INTEGER,
  key_type TEXT,
  anti_theft_type TEXT,
  wiring_connector_type TEXT,
  lock_cylinder_included_yn BOOLEAN,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ignition_switches ADD CONSTRAINT chk_igs_type
  CHECK (type IS NULL OR type IN ('key', 'push_button', 'toggle'));
ALTER TABLE ignition_switches ADD CONSTRAINT chk_igs_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE ignition_switches ADD CONSTRAINT chk_igs_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE ignition_switches ADD CONSTRAINT chk_igs_key_count
  CHECK (key_count IS NULL OR (key_count >= 0 AND key_count <= 20));

CREATE INDEX idx_ignition_switches_vehicle ON ignition_switches(vehicle_id);

COMMENT ON TABLE ignition_switches IS 'Ignition switch and lock cylinder specifications.';
COMMENT ON COLUMN ignition_switches.id IS 'Primary key.';
COMMENT ON COLUMN ignition_switches.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN ignition_switches.type IS 'Switch activation type: key, push_button, toggle.';
COMMENT ON COLUMN ignition_switches.manufacturer IS 'Switch manufacturer, e.g. GM, Ford, Painless, Ididit.';
COMMENT ON COLUMN ignition_switches.part_number IS 'Manufacturer or OEM part number.';
COMMENT ON COLUMN ignition_switches.location IS 'Physical location, e.g. column, dash_center, dash_right, floor_console.';
COMMENT ON COLUMN ignition_switches.position_count IS 'Number of switch positions, typically 4 (off/acc/on/start) or 3.';
COMMENT ON COLUMN ignition_switches.positions_available IS 'Array of switch positions, e.g. {off, accessory, on, start}.';
COMMENT ON COLUMN ignition_switches.tumbler_condition IS 'Lock cylinder condition: smooth, stiff, worn, damaged, replaced.';
COMMENT ON COLUMN ignition_switches.key_count IS 'Number of keys with the vehicle.';
COMMENT ON COLUMN ignition_switches.key_type IS 'Key type, e.g. single_sided, double_sided, transponder, vats.';
COMMENT ON COLUMN ignition_switches.anti_theft_type IS 'Anti-theft system tied to switch, e.g. none, vats, passlock, passlock2.';
COMMENT ON COLUMN ignition_switches.wiring_connector_type IS 'Wiring harness connector type at switch.';
COMMENT ON COLUMN ignition_switches.lock_cylinder_included_yn IS 'True if the lock cylinder is present and functional.';
COMMENT ON COLUMN ignition_switches.is_original IS 'True if factory-installed ignition switch assembly.';
COMMENT ON COLUMN ignition_switches.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN ignition_switches.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN ignition_switches.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN ignition_switches.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN ignition_switches.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN ignition_switches.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 6. GAUGES_INSTRUMENTS — one row per gauge/instrument
-- ============================================================

CREATE TABLE gauges_instruments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Per-gauge identity
  gauge_type TEXT NOT NULL,
  manufacturer TEXT,
  part_number TEXT,
  model_name TEXT,

  -- Visual specification
  face_style TEXT,
  face_diameter_inches NUMERIC(4,2),
  scale_range TEXT,
  unit TEXT,
  lighting_type TEXT,
  bezel_material TEXT,
  bezel_finish TEXT,

  -- Technical specification
  sender_resistance_ohms TEXT,
  accuracy TEXT,
  sweep_degrees INTEGER,
  electric_yn BOOLEAN,
  stepper_motor_yn BOOLEAN,
  trip_computer_yn BOOLEAN,

  -- Physical state
  location TEXT,
  cluster_position TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE gauges_instruments ADD CONSTRAINT chk_gi_gauge_type
  CHECK (gauge_type IN (
    'speedometer', 'tachometer', 'fuel', 'coolant_temp', 'oil_pressure',
    'voltmeter', 'ammeter', 'vacuum', 'boost', 'egt', 'wideband_afr',
    'clock', 'odometer'
  ));
ALTER TABLE gauges_instruments ADD CONSTRAINT chk_gi_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE gauges_instruments ADD CONSTRAINT chk_gi_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE gauges_instruments ADD CONSTRAINT chk_gi_lighting
  CHECK (lighting_type IS NULL OR lighting_type IN ('none', 'incandescent', 'led', 'electroluminescent', 'fiber_optic'));
ALTER TABLE gauges_instruments ADD CONSTRAINT chk_gi_sweep
  CHECK (sweep_degrees IS NULL OR (sweep_degrees > 0 AND sweep_degrees <= 360));

CREATE INDEX idx_gauges_instruments_vehicle ON gauges_instruments(vehicle_id);

COMMENT ON TABLE gauges_instruments IS 'Individual gauge and instrument specifications. One row per gauge.';
COMMENT ON COLUMN gauges_instruments.id IS 'Primary key.';
COMMENT ON COLUMN gauges_instruments.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN gauges_instruments.gauge_type IS 'Gauge function: speedometer, tachometer, fuel, coolant_temp, oil_pressure, voltmeter, ammeter, vacuum, boost, egt, wideband_afr, clock, odometer.';
COMMENT ON COLUMN gauges_instruments.manufacturer IS 'Gauge manufacturer, e.g. AC Delco, Stewart Warner, VDO, Auto Meter.';
COMMENT ON COLUMN gauges_instruments.part_number IS 'Manufacturer or OEM part number.';
COMMENT ON COLUMN gauges_instruments.model_name IS 'Gauge series/model name, e.g. Ultra-Lite, Sport-Comp, Cobalt.';
COMMENT ON COLUMN gauges_instruments.face_style IS 'Face design description, e.g. black_printed, white_printed, orange_printed, analog, digital.';
COMMENT ON COLUMN gauges_instruments.face_diameter_inches IS 'Gauge face diameter in inches, e.g. 2.0625, 2.625, 3.375, 5.0.';
COMMENT ON COLUMN gauges_instruments.scale_range IS 'Full scale range, e.g. 0-80_psi, 0-8000_rpm, 120-160_f.';
COMMENT ON COLUMN gauges_instruments.unit IS 'Unit of measure, e.g. psi, rpm, mph, kph, volts, amps, in_hg.';
COMMENT ON COLUMN gauges_instruments.lighting_type IS 'Illumination method: none, incandescent, led, electroluminescent, fiber_optic.';
COMMENT ON COLUMN gauges_instruments.bezel_material IS 'Bezel material, e.g. chrome, stainless, black_plastic, carbon_fiber.';
COMMENT ON COLUMN gauges_instruments.bezel_finish IS 'Bezel finish, e.g. polished, brushed, powder_coated.';
COMMENT ON COLUMN gauges_instruments.sender_resistance_ohms IS 'Sender resistance range for compatibility, e.g. 0-90, 240-33.';
COMMENT ON COLUMN gauges_instruments.accuracy IS 'Stated accuracy, e.g. plus_minus_2pct, plus_minus_5pct.';
COMMENT ON COLUMN gauges_instruments.sweep_degrees IS 'Total pointer sweep arc in degrees.';
COMMENT ON COLUMN gauges_instruments.electric_yn IS 'True if electrically driven (vs mechanical cable).';
COMMENT ON COLUMN gauges_instruments.stepper_motor_yn IS 'True if gauge uses stepper motor movement (common in later factory clusters).';
COMMENT ON COLUMN gauges_instruments.trip_computer_yn IS 'True if gauge includes trip computer functionality.';
COMMENT ON COLUMN gauges_instruments.location IS 'Physical mounting location, e.g. instrument_cluster, a_pillar, dash_pod, under_dash.';
COMMENT ON COLUMN gauges_instruments.cluster_position IS 'Position within cluster if part of a cluster, e.g. driver_left, center_top, auxiliary_1.';
COMMENT ON COLUMN gauges_instruments.is_original IS 'True if factory-installed gauge.';
COMMENT ON COLUMN gauges_instruments.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN gauges_instruments.condition_notes IS 'Freeform condition details, e.g. needle sticks at cold, face faded.';
COMMENT ON COLUMN gauges_instruments.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN gauges_instruments.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN gauges_instruments.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN gauges_instruments.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 7. AUDIO_SYSTEMS
-- ============================================================

CREATE TABLE audio_systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Head unit
  head_unit_type TEXT,
  head_unit_manufacturer TEXT,
  head_unit_model TEXT,
  head_unit_part_number TEXT,
  din_size TEXT,

  -- Capabilities
  bluetooth_yn BOOLEAN,
  usb_yn BOOLEAN,
  aux_yn BOOLEAN,
  satellite_yn BOOLEAN,
  navigation_yn BOOLEAN,
  apple_carplay_yn BOOLEAN,
  android_auto_yn BOOLEAN,

  -- Amplification
  amplifier_yn BOOLEAN,
  amplifier_manufacturer TEXT,
  amplifier_model TEXT,
  amplifier_watts INTEGER,
  amplifier_channel_count INTEGER,

  -- Speakers
  speaker_count INTEGER,
  speaker_locations_jsonb JSONB DEFAULT '[]',
  subwoofer_yn BOOLEAN,
  subwoofer_size_inches NUMERIC(4,1),

  -- Antenna
  antenna_type TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audio_systems ADD CONSTRAINT chk_aud_head_unit_type
  CHECK (head_unit_type IS NULL OR head_unit_type IN ('am', 'am_fm', 'cassette', 'cd', 'digital'));
ALTER TABLE audio_systems ADD CONSTRAINT chk_aud_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE audio_systems ADD CONSTRAINT chk_aud_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE audio_systems ADD CONSTRAINT chk_aud_din_size
  CHECK (din_size IS NULL OR din_size IN ('single_din', 'double_din', 'one_half_din', 'custom'));
ALTER TABLE audio_systems ADD CONSTRAINT chk_aud_antenna_type
  CHECK (antenna_type IS NULL OR antenna_type IN ('fixed_mast', 'power_mast', 'in_glass', 'shark_fin', 'none'));
ALTER TABLE audio_systems ADD CONSTRAINT chk_aud_amplifier_watts
  CHECK (amplifier_watts IS NULL OR (amplifier_watts > 0 AND amplifier_watts <= 10000));
ALTER TABLE audio_systems ADD CONSTRAINT chk_aud_speaker_count
  CHECK (speaker_count IS NULL OR (speaker_count >= 0 AND speaker_count <= 20));

CREATE INDEX idx_audio_systems_vehicle ON audio_systems(vehicle_id);

COMMENT ON TABLE audio_systems IS 'Audio/entertainment system specifications. One row per vehicle (covers head unit, amp, speakers as a system).';
COMMENT ON COLUMN audio_systems.id IS 'Primary key.';
COMMENT ON COLUMN audio_systems.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN audio_systems.head_unit_type IS 'Head unit media type: am, am_fm, cassette, cd, digital.';
COMMENT ON COLUMN audio_systems.head_unit_manufacturer IS 'Head unit manufacturer, e.g. Delco, Pioneer, Kenwood, Alpine.';
COMMENT ON COLUMN audio_systems.head_unit_model IS 'Head unit model name or number.';
COMMENT ON COLUMN audio_systems.head_unit_part_number IS 'OEM or manufacturer part number.';
COMMENT ON COLUMN audio_systems.din_size IS 'DIN form factor: single_din, double_din, one_half_din, custom.';
COMMENT ON COLUMN audio_systems.bluetooth_yn IS 'True if Bluetooth audio streaming is supported.';
COMMENT ON COLUMN audio_systems.usb_yn IS 'True if USB media playback is supported.';
COMMENT ON COLUMN audio_systems.aux_yn IS 'True if 3.5mm aux input is present.';
COMMENT ON COLUMN audio_systems.satellite_yn IS 'True if satellite radio (e.g. SiriusXM) is equipped.';
COMMENT ON COLUMN audio_systems.navigation_yn IS 'True if built-in navigation is present.';
COMMENT ON COLUMN audio_systems.apple_carplay_yn IS 'True if Apple CarPlay is supported.';
COMMENT ON COLUMN audio_systems.android_auto_yn IS 'True if Android Auto is supported.';
COMMENT ON COLUMN audio_systems.amplifier_yn IS 'True if a separate power amplifier is installed.';
COMMENT ON COLUMN audio_systems.amplifier_manufacturer IS 'Amplifier manufacturer, e.g. Rockford Fosgate, JL Audio, Alpine.';
COMMENT ON COLUMN audio_systems.amplifier_model IS 'Amplifier model name or number.';
COMMENT ON COLUMN audio_systems.amplifier_watts IS 'Total amplifier output in watts RMS.';
COMMENT ON COLUMN audio_systems.amplifier_channel_count IS 'Number of amplifier channels.';
COMMENT ON COLUMN audio_systems.speaker_count IS 'Total number of speakers (excluding subwoofers).';
COMMENT ON COLUMN audio_systems.speaker_locations_jsonb IS 'JSON array of speaker location objects, e.g. [{"location":"front_door","size_inches":6.5,"brand":"Kicker"}].';
COMMENT ON COLUMN audio_systems.subwoofer_yn IS 'True if a subwoofer is installed.';
COMMENT ON COLUMN audio_systems.subwoofer_size_inches IS 'Subwoofer cone diameter in inches.';
COMMENT ON COLUMN audio_systems.antenna_type IS 'Antenna type: fixed_mast, power_mast, in_glass, shark_fin, none.';
COMMENT ON COLUMN audio_systems.is_original IS 'True if factory-installed audio system.';
COMMENT ON COLUMN audio_systems.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN audio_systems.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN audio_systems.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN audio_systems.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN audio_systems.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN audio_systems.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 8. COMFORT_ELECTRICAL — power convenience features
-- ============================================================

CREATE TABLE comfort_electrical (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Power convenience
  power_windows_yn BOOLEAN,
  power_windows_switch_type TEXT,
  power_locks_yn BOOLEAN,
  power_mirrors_yn BOOLEAN,
  power_seats_yn BOOLEAN,
  power_seat_positions TEXT,
  cruise_control_yn BOOLEAN,
  cruise_control_type TEXT,
  keyless_entry_yn BOOLEAN,
  keyless_entry_type TEXT,
  remote_start_yn BOOLEAN,
  power_antenna_yn BOOLEAN,
  rear_defrost_yn BOOLEAN,
  heated_mirrors_yn BOOLEAN,
  heated_seats_yn BOOLEAN,
  heated_steering_yn BOOLEAN,
  rain_sensing_wipers_yn BOOLEAN,
  auto_dimming_mirror_yn BOOLEAN,
  memory_seats_yn BOOLEAN,
  memory_mirrors_yn BOOLEAN,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE comfort_electrical ADD CONSTRAINT chk_ce_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE comfort_electrical ADD CONSTRAINT chk_ce_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_comfort_electrical_vehicle ON comfort_electrical(vehicle_id);

COMMENT ON TABLE comfort_electrical IS 'Power convenience feature inventory. One row per vehicle. Boolean flags for what is installed and functional.';
COMMENT ON COLUMN comfort_electrical.id IS 'Primary key.';
COMMENT ON COLUMN comfort_electrical.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN comfort_electrical.power_windows_yn IS 'True if power windows are equipped.';
COMMENT ON COLUMN comfort_electrical.power_windows_switch_type IS 'Window switch type, e.g. rocker, momentary_toggle, auto_one_touch.';
COMMENT ON COLUMN comfort_electrical.power_locks_yn IS 'True if power door locks are equipped.';
COMMENT ON COLUMN comfort_electrical.power_mirrors_yn IS 'True if power-adjustable mirrors are equipped.';
COMMENT ON COLUMN comfort_electrical.power_seats_yn IS 'True if power-adjustable seats are equipped.';
COMMENT ON COLUMN comfort_electrical.power_seat_positions IS 'Power seat adjustment positions, e.g. 4-way, 6-way, 8-way, 10-way.';
COMMENT ON COLUMN comfort_electrical.cruise_control_yn IS 'True if cruise control is equipped.';
COMMENT ON COLUMN comfort_electrical.cruise_control_type IS 'Cruise control type, e.g. mechanical_cable, electronic_throttle, adaptive.';
COMMENT ON COLUMN comfort_electrical.keyless_entry_yn IS 'True if remote keyless entry is equipped.';
COMMENT ON COLUMN comfort_electrical.keyless_entry_type IS 'Keyless entry type, e.g. factory_fob, aftermarket_fob, proximity.';
COMMENT ON COLUMN comfort_electrical.remote_start_yn IS 'True if remote start is equipped.';
COMMENT ON COLUMN comfort_electrical.power_antenna_yn IS 'True if a power-retractable antenna is equipped.';
COMMENT ON COLUMN comfort_electrical.rear_defrost_yn IS 'True if rear window electric defrost grid is equipped.';
COMMENT ON COLUMN comfort_electrical.heated_mirrors_yn IS 'True if mirror heating elements are equipped.';
COMMENT ON COLUMN comfort_electrical.heated_seats_yn IS 'True if seat heating elements are equipped.';
COMMENT ON COLUMN comfort_electrical.heated_steering_yn IS 'True if heated steering wheel is equipped.';
COMMENT ON COLUMN comfort_electrical.rain_sensing_wipers_yn IS 'True if rain-sensing automatic wiper control is equipped.';
COMMENT ON COLUMN comfort_electrical.auto_dimming_mirror_yn IS 'True if auto-dimming (electrochromic) rearview mirror is equipped.';
COMMENT ON COLUMN comfort_electrical.memory_seats_yn IS 'True if memory seat position system is equipped.';
COMMENT ON COLUMN comfort_electrical.memory_mirrors_yn IS 'True if memory mirror position system is equipped.';
COMMENT ON COLUMN comfort_electrical.is_original IS 'True if these features are factory-installed on this vehicle.';
COMMENT ON COLUMN comfort_electrical.condition_grade IS 'Overall condition grade for comfort electrical systems: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN comfort_electrical.condition_notes IS 'Freeform notes on non-functional or partially functional items.';
COMMENT ON COLUMN comfort_electrical.provenance IS 'System origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN comfort_electrical.provenance_detail IS 'Detailed provenance info for aftermarket upgrades.';
COMMENT ON COLUMN comfort_electrical.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN comfort_electrical.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 9. EXTERIOR_LIGHTING_ELECTRICAL — lighting controls and circuits
-- ============================================================

CREATE TABLE exterior_lighting_electrical (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Headlight circuit
  headlight_switch_type TEXT,
  headlight_switch_location TEXT,
  dimmer_location TEXT,
  high_beam_relay_yn BOOLEAN,

  -- Signals
  turn_signal_type TEXT,
  hazard_switch_location TEXT,
  sequential_turn_yn BOOLEAN,

  -- Interior/courtesy
  dome_light_switch TEXT,
  underhood_light_yn BOOLEAN,
  trunk_light_yn BOOLEAN,
  courtesy_lights_jsonb JSONB DEFAULT '[]',
  map_lights_yn BOOLEAN,
  reading_lights_yn BOOLEAN,

  -- Other exterior circuits
  backup_light_switch_type TEXT,
  license_plate_light_yn BOOLEAN,
  marker_lights_yn BOOLEAN,
  fog_lights_yn BOOLEAN,
  aux_lights_yn BOOLEAN,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE exterior_lighting_electrical ADD CONSTRAINT chk_ele_dimmer_location
  CHECK (dimmer_location IS NULL OR dimmer_location IN ('floor', 'column', 'stalk'));
ALTER TABLE exterior_lighting_electrical ADD CONSTRAINT chk_ele_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE exterior_lighting_electrical ADD CONSTRAINT chk_ele_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE exterior_lighting_electrical ADD CONSTRAINT chk_ele_turn_signal_type
  CHECK (turn_signal_type IS NULL OR turn_signal_type IN (
    'column_lever', 'dash_toggle', 'floor_switch', 'self_canceling', 'non_canceling'
  ));

CREATE INDEX idx_exterior_lighting_electrical_vehicle ON exterior_lighting_electrical(vehicle_id);

COMMENT ON TABLE exterior_lighting_electrical IS 'Exterior lighting control circuits and switch specifications. One row per vehicle.';
COMMENT ON COLUMN exterior_lighting_electrical.id IS 'Primary key.';
COMMENT ON COLUMN exterior_lighting_electrical.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN exterior_lighting_electrical.headlight_switch_type IS 'Headlight switch design, e.g. push_pull_rheostat, rocker, stalk_auto.';
COMMENT ON COLUMN exterior_lighting_electrical.headlight_switch_location IS 'Headlight switch location in interior, e.g. dash_left, column_stalk, instrument_panel.';
COMMENT ON COLUMN exterior_lighting_electrical.dimmer_location IS 'High-beam dimmer location: floor, column, or stalk.';
COMMENT ON COLUMN exterior_lighting_electrical.high_beam_relay_yn IS 'True if high-beam relay (for headlight upgrade) is installed.';
COMMENT ON COLUMN exterior_lighting_electrical.turn_signal_type IS 'Turn signal mechanism: column_lever, dash_toggle, floor_switch, self_canceling, non_canceling.';
COMMENT ON COLUMN exterior_lighting_electrical.hazard_switch_location IS 'Hazard flasher switch location, e.g. dash_center, column_button, steering_wheel.';
COMMENT ON COLUMN exterior_lighting_electrical.sequential_turn_yn IS 'True if sequential turn signal operation (Thunderbird-style).';
COMMENT ON COLUMN exterior_lighting_electrical.dome_light_switch IS 'Dome light switch type, e.g. door_jamb_only, dash_override, headlight_circuit.';
COMMENT ON COLUMN exterior_lighting_electrical.underhood_light_yn IS 'True if engine compartment light is installed and functional.';
COMMENT ON COLUMN exterior_lighting_electrical.trunk_light_yn IS 'True if trunk/cargo area light is installed and functional.';
COMMENT ON COLUMN exterior_lighting_electrical.courtesy_lights_jsonb IS 'JSON array of courtesy light locations, e.g. [{"location":"front_footwell"},{"location":"rear_footwell"}].';
COMMENT ON COLUMN exterior_lighting_electrical.map_lights_yn IS 'True if map/reading lights are in the overhead console.';
COMMENT ON COLUMN exterior_lighting_electrical.reading_lights_yn IS 'True if dedicated reading lights are present.';
COMMENT ON COLUMN exterior_lighting_electrical.backup_light_switch_type IS 'Backup light switch activation, e.g. column_mounted, transmission_mounted, ecm_controlled.';
COMMENT ON COLUMN exterior_lighting_electrical.license_plate_light_yn IS 'True if license plate illumination is present and functional.';
COMMENT ON COLUMN exterior_lighting_electrical.marker_lights_yn IS 'True if side marker lights are present.';
COMMENT ON COLUMN exterior_lighting_electrical.fog_lights_yn IS 'True if fog lights are installed.';
COMMENT ON COLUMN exterior_lighting_electrical.aux_lights_yn IS 'True if auxiliary driving/spot lights are installed.';
COMMENT ON COLUMN exterior_lighting_electrical.is_original IS 'True if factory-original lighting electrical configuration.';
COMMENT ON COLUMN exterior_lighting_electrical.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN exterior_lighting_electrical.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN exterior_lighting_electrical.provenance IS 'System origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN exterior_lighting_electrical.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN exterior_lighting_electrical.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN exterior_lighting_electrical.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 10. FUSE_PANELS
-- ============================================================

CREATE TABLE fuse_panels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Identity
  location TEXT,
  type TEXT,
  manufacturer TEXT,
  part_number TEXT,

  -- Specification
  circuit_count INTEGER,
  max_amp_rating INTEGER,
  fusible_link_count INTEGER,
  aftermarket_circuits_added INTEGER,

  -- Physical state
  cover_present_yn BOOLEAN,
  label_legible_yn BOOLEAN,
  grounds_clean_yn BOOLEAN,
  corrosion_present_yn BOOLEAN,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE fuse_panels ADD CONSTRAINT chk_fp_type
  CHECK (type IS NULL OR type IN ('glass_fuse', 'ato_blade', 'maxi_fuse', 'circuit_breaker', 'fusible_link'));
ALTER TABLE fuse_panels ADD CONSTRAINT chk_fp_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE fuse_panels ADD CONSTRAINT chk_fp_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE fuse_panels ADD CONSTRAINT chk_fp_circuit_count
  CHECK (circuit_count IS NULL OR (circuit_count > 0 AND circuit_count <= 200));
ALTER TABLE fuse_panels ADD CONSTRAINT chk_fp_aftermarket_circuits
  CHECK (aftermarket_circuits_added IS NULL OR aftermarket_circuits_added >= 0);

CREATE INDEX idx_fuse_panels_vehicle ON fuse_panels(vehicle_id);

COMMENT ON TABLE fuse_panels IS 'Fuse panel/PDC specifications. One row per panel (some vehicles have multiple: interior + underhood).';
COMMENT ON COLUMN fuse_panels.id IS 'Primary key.';
COMMENT ON COLUMN fuse_panels.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN fuse_panels.location IS 'Panel location, e.g. under_dash_left, under_dash_right, under_hood, trunk.';
COMMENT ON COLUMN fuse_panels.type IS 'Fuse technology: glass_fuse, ato_blade, maxi_fuse, circuit_breaker, fusible_link.';
COMMENT ON COLUMN fuse_panels.manufacturer IS 'Panel manufacturer, e.g. GM, Ford, Littelfuse, Bussman.';
COMMENT ON COLUMN fuse_panels.part_number IS 'OEM or replacement part number.';
COMMENT ON COLUMN fuse_panels.circuit_count IS 'Total number of fused circuits in this panel.';
COMMENT ON COLUMN fuse_panels.max_amp_rating IS 'Highest rated fuse position in the panel in amps.';
COMMENT ON COLUMN fuse_panels.fusible_link_count IS 'Number of fusible links feeding this panel.';
COMMENT ON COLUMN fuse_panels.aftermarket_circuits_added IS 'Number of circuits added beyond the factory design.';
COMMENT ON COLUMN fuse_panels.cover_present_yn IS 'True if the protective cover/lid is present.';
COMMENT ON COLUMN fuse_panels.label_legible_yn IS 'True if circuit labels on panel or cover are still readable.';
COMMENT ON COLUMN fuse_panels.grounds_clean_yn IS 'True if chassis ground connections at panel are clean and tight.';
COMMENT ON COLUMN fuse_panels.corrosion_present_yn IS 'True if corrosion is visible on terminals or bus bars.';
COMMENT ON COLUMN fuse_panels.is_original IS 'True if this is the factory-installed fuse panel.';
COMMENT ON COLUMN fuse_panels.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN fuse_panels.condition_notes IS 'Freeform condition details, e.g. evidence of past circuit fire, blown fuses.';
COMMENT ON COLUMN fuse_panels.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN fuse_panels.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN fuse_panels.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN fuse_panels.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- WHEELS & TIRES SUBSYSTEM
-- ============================================================

-- ============================================================
-- 11. WHEELS — one row per corner
-- ============================================================

CREATE TABLE wheels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Corner position
  corner TEXT NOT NULL,

  -- Specification
  diameter_inches NUMERIC(4,1),
  width_inches NUMERIC(4,1),
  offset_mm NUMERIC(5,1),
  backspacing_inches NUMERIC(4,2),
  bolt_pattern TEXT,
  center_bore_mm NUMERIC(6,2),
  material TEXT,
  manufacturer TEXT,
  model TEXT,
  part_number TEXT,
  finish TEXT,
  lug_nut_seat_type TEXT,
  lug_nut_thread_size TEXT,
  center_cap_present_yn BOOLEAN,

  -- Measured state
  runout_thou NUMERIC(5,1),
  weight_lbs NUMERIC(5,2),
  curb_damage_yn BOOLEAN,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wheels ADD CONSTRAINT chk_whl_corner
  CHECK (corner IN ('lf', 'rf', 'lr', 'rr'));
ALTER TABLE wheels ADD CONSTRAINT chk_whl_material
  CHECK (material IS NULL OR material IN ('steel', 'cast_alloy', 'forged_alloy', 'wire', 'magnesium'));
ALTER TABLE wheels ADD CONSTRAINT chk_whl_finish
  CHECK (finish IS NULL OR finish IN ('painted', 'polished', 'chrome', 'machined', 'powder_coated'));
ALTER TABLE wheels ADD CONSTRAINT chk_whl_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE wheels ADD CONSTRAINT chk_whl_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE wheels ADD CONSTRAINT chk_whl_diameter
  CHECK (diameter_inches IS NULL OR (diameter_inches >= 10 AND diameter_inches <= 30));
ALTER TABLE wheels ADD CONSTRAINT chk_whl_width
  CHECK (width_inches IS NULL OR (width_inches >= 3 AND width_inches <= 20));

CREATE INDEX idx_wheels_vehicle ON wheels(vehicle_id);

COMMENT ON TABLE wheels IS 'Wheel specifications per corner. One row per corner position (lf, rf, lr, rr).';
COMMENT ON COLUMN wheels.id IS 'Primary key.';
COMMENT ON COLUMN wheels.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN wheels.corner IS 'Corner position: lf (left front), rf (right front), lr (left rear), rr (right rear).';
COMMENT ON COLUMN wheels.diameter_inches IS 'Wheel diameter in inches (bead seat to bead seat), e.g. 15, 17, 20.';
COMMENT ON COLUMN wheels.width_inches IS 'Wheel width in inches (bead seat to bead seat), e.g. 7, 8.5, 10.';
COMMENT ON COLUMN wheels.offset_mm IS 'Wheel offset in mm. Positive = more positive/flush, negative = deeper dish.';
COMMENT ON COLUMN wheels.backspacing_inches IS 'Backspacing in inches from mounting flange to inner bead seat.';
COMMENT ON COLUMN wheels.bolt_pattern IS 'Bolt circle pattern, e.g. 5x4.75, 5x120, 4x100.';
COMMENT ON COLUMN wheels.center_bore_mm IS 'Hub-centric center bore diameter in mm.';
COMMENT ON COLUMN wheels.material IS 'Wheel material: steel, cast_alloy, forged_alloy, wire, magnesium.';
COMMENT ON COLUMN wheels.manufacturer IS 'Wheel manufacturer, e.g. Kelsey-Hayes, American Racing, BBS, Enkei.';
COMMENT ON COLUMN wheels.model IS 'Wheel model name, e.g. Torq-Thrust, Smoothie, Rally, Ansen Sprint.';
COMMENT ON COLUMN wheels.part_number IS 'Manufacturer part number or OEM part number.';
COMMENT ON COLUMN wheels.finish IS 'Wheel finish: painted, polished, chrome, machined, powder_coated.';
COMMENT ON COLUMN wheels.lug_nut_seat_type IS 'Lug nut seat type, e.g. conical_60deg, ball_seat, flat_washer.';
COMMENT ON COLUMN wheels.lug_nut_thread_size IS 'Lug nut thread size, e.g. 1/2-20, 7/16-20, 12x1.5.';
COMMENT ON COLUMN wheels.center_cap_present_yn IS 'True if the center cap/hubcap is present.';
COMMENT ON COLUMN wheels.runout_thou IS 'Measured lateral or radial runout in thousandths of an inch.';
COMMENT ON COLUMN wheels.weight_lbs IS 'Wheel weight in pounds.';
COMMENT ON COLUMN wheels.curb_damage_yn IS 'True if visible curb rash or impact damage is present on the rim.';
COMMENT ON COLUMN wheels.is_original IS 'True if factory-original wheel for this vehicle.';
COMMENT ON COLUMN wheels.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN wheels.condition_notes IS 'Freeform condition details, e.g. hairline crack at valve stem, stripped lug hole.';
COMMENT ON COLUMN wheels.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN wheels.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN wheels.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN wheels.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 12. TIRES — one row per corner
-- ============================================================

CREATE TABLE tires (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Corner position
  corner TEXT NOT NULL,

  -- Specification
  size_designation TEXT,
  brand TEXT,
  model TEXT,
  type TEXT,
  speed_rating TEXT,
  load_index INTEGER,
  ply_rating TEXT,

  -- Age and wear
  dot_date_code TEXT,
  tread_depth_32nds NUMERIC(4,1),

  -- Condition flags
  dry_rot_yn BOOLEAN,
  sidewall_condition TEXT,
  ozone_cracking_yn BOOLEAN,
  plugged_yn BOOLEAN,
  patched_yn BOOLEAN,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tires ADD CONSTRAINT chk_tir_corner
  CHECK (corner IN ('lf', 'rf', 'lr', 'rr'));
ALTER TABLE tires ADD CONSTRAINT chk_tir_type
  CHECK (type IS NULL OR type IN (
    'all_season', 'summer', 'winter', 'all_terrain', 'mud_terrain',
    'highway', 'performance'
  ));
ALTER TABLE tires ADD CONSTRAINT chk_tir_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE tires ADD CONSTRAINT chk_tir_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE tires ADD CONSTRAINT chk_tir_sidewall_condition
  CHECK (sidewall_condition IS NULL OR sidewall_condition IN (
    'excellent', 'good', 'cracked', 'bulged', 'damaged', 'dry_rotted'
  ));
ALTER TABLE tires ADD CONSTRAINT chk_tir_tread_depth
  CHECK (tread_depth_32nds IS NULL OR (tread_depth_32nds >= 0 AND tread_depth_32nds <= 20));
ALTER TABLE tires ADD CONSTRAINT chk_tir_load_index
  CHECK (load_index IS NULL OR (load_index >= 60 AND load_index <= 150));

CREATE INDEX idx_tires_vehicle ON tires(vehicle_id);

COMMENT ON TABLE tires IS 'Tire specifications and condition per corner. One row per corner position (lf, rf, lr, rr).';
COMMENT ON COLUMN tires.id IS 'Primary key.';
COMMENT ON COLUMN tires.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN tires.corner IS 'Corner position: lf (left front), rf (right front), lr (left rear), rr (right rear).';
COMMENT ON COLUMN tires.size_designation IS 'Full tire size designation, e.g. P215/65R15, LT265/75R16, F60-15, L60-15.';
COMMENT ON COLUMN tires.brand IS 'Tire brand, e.g. Goodyear, Firestone, BFGoodrich, Michelin.';
COMMENT ON COLUMN tires.model IS 'Tire model name, e.g. Eagle GT, Radial T/A, All-Terrain T/A KO2.';
COMMENT ON COLUMN tires.type IS 'Tire usage category: all_season, summer, winter, all_terrain, mud_terrain, highway, performance.';
COMMENT ON COLUMN tires.speed_rating IS 'Speed rating letter, e.g. S, T, H, V, W, Y, Z.';
COMMENT ON COLUMN tires.load_index IS 'Load index number (60-150). Higher = more load capacity.';
COMMENT ON COLUMN tires.ply_rating IS 'Ply rating or load range designation, e.g. 4-ply, C, D, E.';
COMMENT ON COLUMN tires.dot_date_code IS 'DOT date code (last 4 digits of DOT), e.g. 2819 = week 28 of 2019.';
COMMENT ON COLUMN tires.tread_depth_32nds IS 'Remaining tread depth in 32nds of an inch. New tires typically 10/32 to 12/32.';
COMMENT ON COLUMN tires.dry_rot_yn IS 'True if dry rot (surface cracking/hardening from age/UV) is present.';
COMMENT ON COLUMN tires.sidewall_condition IS 'Sidewall assessment: excellent, good, cracked, bulged, damaged, dry_rotted.';
COMMENT ON COLUMN tires.ozone_cracking_yn IS 'True if ozone cracking (fine circumferential cracks) is visible.';
COMMENT ON COLUMN tires.plugged_yn IS 'True if tire has been plug-repaired.';
COMMENT ON COLUMN tires.patched_yn IS 'True if tire has been patch-repaired from inside.';
COMMENT ON COLUMN tires.is_original IS 'True if these are the factory-specified tires.';
COMMENT ON COLUMN tires.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN tires.condition_notes IS 'Freeform condition details, e.g. uneven wear on inside edge, feathering.';
COMMENT ON COLUMN tires.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN tires.provenance_detail IS 'Detailed provenance info: purchase date, retailer, mileage at install.';
COMMENT ON COLUMN tires.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN tires.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 13. SPARE_WHEEL_TIRE
-- ============================================================

CREATE TABLE spare_wheel_tire (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Identity
  type TEXT,
  location TEXT,

  -- Wheel spec
  wheel_diameter_inches NUMERIC(4,1),
  wheel_width_inches NUMERIC(4,1),
  wheel_material TEXT,
  wheel_manufacturer TEXT,
  wheel_finish TEXT,
  wheel_condition TEXT,

  -- Tire spec
  tire_size_designation TEXT,
  tire_brand TEXT,
  tire_dot_date_code TEXT,
  tire_tread_depth_32nds NUMERIC(4,1),
  tire_condition TEXT,

  -- Hardware
  inflated_yn BOOLEAN,
  pressure_psi INTEGER,
  jack_present_yn BOOLEAN,
  jack_type TEXT,
  lug_wrench_present_yn BOOLEAN,
  extension_bar_present_yn BOOLEAN,
  wheel_lock_key_present_yn BOOLEAN,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE spare_wheel_tire ADD CONSTRAINT chk_spt_type
  CHECK (type IS NULL OR type IN ('full_size_matching', 'full_size_different', 'compact_temporary', 'none'));
ALTER TABLE spare_wheel_tire ADD CONSTRAINT chk_spt_location
  CHECK (location IS NULL OR location IN ('under_bed', 'trunk', 'tailgate_mount', 'roof_mount', 'side_mount'));
ALTER TABLE spare_wheel_tire ADD CONSTRAINT chk_spt_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE spare_wheel_tire ADD CONSTRAINT chk_spt_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE spare_wheel_tire ADD CONSTRAINT chk_spt_pressure
  CHECK (pressure_psi IS NULL OR (pressure_psi >= 0 AND pressure_psi <= 150));

CREATE INDEX idx_spare_wheel_tire_vehicle ON spare_wheel_tire(vehicle_id);

COMMENT ON TABLE spare_wheel_tire IS 'Spare wheel and tire assembly specifications. One row per vehicle.';
COMMENT ON COLUMN spare_wheel_tire.id IS 'Primary key.';
COMMENT ON COLUMN spare_wheel_tire.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN spare_wheel_tire.type IS 'Spare type: full_size_matching, full_size_different, compact_temporary (donut), none.';
COMMENT ON COLUMN spare_wheel_tire.location IS 'Spare storage location: under_bed, trunk, tailgate_mount, roof_mount, side_mount.';
COMMENT ON COLUMN spare_wheel_tire.wheel_diameter_inches IS 'Spare wheel diameter in inches.';
COMMENT ON COLUMN spare_wheel_tire.wheel_width_inches IS 'Spare wheel width in inches.';
COMMENT ON COLUMN spare_wheel_tire.wheel_material IS 'Spare wheel material, e.g. steel, cast_alloy, forged_alloy.';
COMMENT ON COLUMN spare_wheel_tire.wheel_manufacturer IS 'Spare wheel manufacturer.';
COMMENT ON COLUMN spare_wheel_tire.wheel_finish IS 'Spare wheel finish, e.g. painted, bare_steel, polished.';
COMMENT ON COLUMN spare_wheel_tire.wheel_condition IS 'Spare wheel condition assessment.';
COMMENT ON COLUMN spare_wheel_tire.tire_size_designation IS 'Spare tire size designation, e.g. T125/70R16, P215/65R15.';
COMMENT ON COLUMN spare_wheel_tire.tire_brand IS 'Spare tire brand.';
COMMENT ON COLUMN spare_wheel_tire.tire_dot_date_code IS 'DOT date code (last 4 digits) on spare tire.';
COMMENT ON COLUMN spare_wheel_tire.tire_tread_depth_32nds IS 'Spare tire tread depth in 32nds of an inch.';
COMMENT ON COLUMN spare_wheel_tire.tire_condition IS 'Spare tire condition assessment, e.g. like_new, good, dry_rotted.';
COMMENT ON COLUMN spare_wheel_tire.inflated_yn IS 'True if spare is properly inflated.';
COMMENT ON COLUMN spare_wheel_tire.pressure_psi IS 'Current inflation pressure in PSI.';
COMMENT ON COLUMN spare_wheel_tire.jack_present_yn IS 'True if the vehicle jack is present with the spare.';
COMMENT ON COLUMN spare_wheel_tire.jack_type IS 'Jack type, e.g. scissors, bottle, floor, factory_scissors.';
COMMENT ON COLUMN spare_wheel_tire.lug_wrench_present_yn IS 'True if the lug wrench is present.';
COMMENT ON COLUMN spare_wheel_tire.extension_bar_present_yn IS 'True if a lug wrench extension bar is present (trucks).';
COMMENT ON COLUMN spare_wheel_tire.wheel_lock_key_present_yn IS 'True if wheel lock key is present (if vehicle has wheel locks).';
COMMENT ON COLUMN spare_wheel_tire.is_original IS 'True if spare is the factory-original spare assembly.';
COMMENT ON COLUMN spare_wheel_tire.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN spare_wheel_tire.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN spare_wheel_tire.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN spare_wheel_tire.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN spare_wheel_tire.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN spare_wheel_tire.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- HVAC SUBSYSTEM
-- ============================================================

-- ============================================================
-- 14. HVAC_SYSTEMS — top-level system configuration
-- ============================================================

CREATE TABLE hvac_systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- System identity
  system_type TEXT,
  ac_type TEXT,
  refrigerant TEXT,

  -- Compressor
  compressor_manufacturer TEXT,
  compressor_model TEXT,
  compressor_part_number TEXT,
  compressor_displacement_cc NUMERIC(6,1),
  compressor_clutch_type TEXT,

  -- Condenser
  condenser_type TEXT,
  condenser_location TEXT,
  condenser_rows INTEGER,

  -- Evaporator
  evaporator_location TEXT,
  evaporator_type TEXT,

  -- Expansion
  expansion_valve_type TEXT,
  orifice_tube_size TEXT,

  -- Charge specification
  ac_charge_oz NUMERIC(5,1),
  system_pressure_low_psi INTEGER,
  system_pressure_high_psi INTEGER,
  receiver_drier_yn BOOLEAN,
  accumulator_yn BOOLEAN,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE hvac_systems ADD CONSTRAINT chk_hvac_system_type
  CHECK (system_type IS NULL OR system_type IN ('heat_only', 'heat_ac', 'auto_climate'));
ALTER TABLE hvac_systems ADD CONSTRAINT chk_hvac_ac_type
  CHECK (ac_type IS NULL OR ac_type IN ('none', 'factory_original', 'dealer_installed', 'aftermarket_retrofit'));
ALTER TABLE hvac_systems ADD CONSTRAINT chk_hvac_refrigerant
  CHECK (refrigerant IS NULL OR refrigerant IN ('r12', 'r134a', 'r1234yf'));
ALTER TABLE hvac_systems ADD CONSTRAINT chk_hvac_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE hvac_systems ADD CONSTRAINT chk_hvac_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE hvac_systems ADD CONSTRAINT chk_hvac_ac_charge
  CHECK (ac_charge_oz IS NULL OR (ac_charge_oz > 0 AND ac_charge_oz <= 200));
ALTER TABLE hvac_systems ADD CONSTRAINT chk_hvac_pressure_low
  CHECK (system_pressure_low_psi IS NULL OR (system_pressure_low_psi >= 0 AND system_pressure_low_psi <= 200));
ALTER TABLE hvac_systems ADD CONSTRAINT chk_hvac_pressure_high
  CHECK (system_pressure_high_psi IS NULL OR (system_pressure_high_psi >= 0 AND system_pressure_high_psi <= 600));

CREATE INDEX idx_hvac_systems_vehicle ON hvac_systems(vehicle_id);

COMMENT ON TABLE hvac_systems IS 'HVAC system top-level specifications: AC, refrigerant, compressor, condenser, evaporator. One row per vehicle.';
COMMENT ON COLUMN hvac_systems.id IS 'Primary key.';
COMMENT ON COLUMN hvac_systems.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN hvac_systems.system_type IS 'Overall HVAC capability: heat_only, heat_ac, auto_climate.';
COMMENT ON COLUMN hvac_systems.ac_type IS 'AC installation origin: none, factory_original, dealer_installed, aftermarket_retrofit.';
COMMENT ON COLUMN hvac_systems.refrigerant IS 'Refrigerant type: r12 (vintage), r134a (1992-2017), r1234yf (2017+).';
COMMENT ON COLUMN hvac_systems.compressor_manufacturer IS 'Compressor manufacturer, e.g. Harrison/Frigidaire, Sanden, Denso, Delphi.';
COMMENT ON COLUMN hvac_systems.compressor_model IS 'Compressor model, e.g. A6, DA-6, R4, V5, SD-7H15.';
COMMENT ON COLUMN hvac_systems.compressor_part_number IS 'Compressor OEM or aftermarket part number.';
COMMENT ON COLUMN hvac_systems.compressor_displacement_cc IS 'Compressor displacement per revolution in cc.';
COMMENT ON COLUMN hvac_systems.compressor_clutch_type IS 'Clutch type, e.g. electromagnetic, variable_displacement, continuously_variable.';
COMMENT ON COLUMN hvac_systems.condenser_type IS 'Condenser construction, e.g. tube_and_fin, parallel_flow, serpentine.';
COMMENT ON COLUMN hvac_systems.condenser_location IS 'Condenser location, e.g. front_of_radiator, side_mount, roof_mount.';
COMMENT ON COLUMN hvac_systems.condenser_rows IS 'Number of tube rows in condenser core.';
COMMENT ON COLUMN hvac_systems.evaporator_location IS 'Evaporator location, e.g. under_dash, under_seat, in_dash, trunk.';
COMMENT ON COLUMN hvac_systems.evaporator_type IS 'Evaporator construction, e.g. tube_and_fin, plate_fin, stacked.';
COMMENT ON COLUMN hvac_systems.expansion_valve_type IS 'Expansion device type, e.g. thermostatic_expansion_valve, orifice_tube, block_valve.';
COMMENT ON COLUMN hvac_systems.orifice_tube_size IS 'Orifice tube size/color code if applicable, e.g. green, brown, red.';
COMMENT ON COLUMN hvac_systems.ac_charge_oz IS 'System refrigerant charge specification in ounces.';
COMMENT ON COLUMN hvac_systems.system_pressure_low_psi IS 'Specified low-side operating pressure in PSI.';
COMMENT ON COLUMN hvac_systems.system_pressure_high_psi IS 'Specified high-side operating pressure in PSI.';
COMMENT ON COLUMN hvac_systems.receiver_drier_yn IS 'True if a receiver-drier (TXV system) is installed.';
COMMENT ON COLUMN hvac_systems.accumulator_yn IS 'True if an accumulator-drier (orifice tube system) is installed.';
COMMENT ON COLUMN hvac_systems.is_original IS 'True if factory-installed HVAC system.';
COMMENT ON COLUMN hvac_systems.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN hvac_systems.condition_notes IS 'Freeform condition details, e.g. system holds charge, blows 40F.';
COMMENT ON COLUMN hvac_systems.provenance IS 'System origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN hvac_systems.provenance_detail IS 'Detailed provenance info, e.g. retrofit installer, conversion date.';
COMMENT ON COLUMN hvac_systems.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN hvac_systems.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 15. HEATER_CORES
-- ============================================================

CREATE TABLE heater_cores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Identity
  manufacturer TEXT,
  part_number TEXT,

  -- Specification
  material TEXT,
  width_inches NUMERIC(5,2),
  height_inches NUMERIC(5,2),
  depth_inches NUMERIC(5,2),
  inlet_diameter_inches NUMERIC(4,2),
  outlet_diameter_inches NUMERIC(4,2),
  row_count INTEGER,
  fin_count_per_inch INTEGER,

  -- Connections
  shutoff_valve_type TEXT,
  hose_size_inches NUMERIC(4,2),
  hose_condition TEXT,

  -- Condition flags
  leak_history_yn BOOLEAN,
  bypass_yn BOOLEAN,
  sealer_evidence_yn BOOLEAN,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE heater_cores ADD CONSTRAINT chk_hc_material
  CHECK (material IS NULL OR material IN ('copper_brass', 'aluminum'));
ALTER TABLE heater_cores ADD CONSTRAINT chk_hc_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE heater_cores ADD CONSTRAINT chk_hc_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE heater_cores ADD CONSTRAINT chk_hc_shutoff_valve
  CHECK (shutoff_valve_type IS NULL OR shutoff_valve_type IN (
    'none', 'cable_operated', 'vacuum_operated', 'electric_solenoid', 'manual_inline'
  ));
ALTER TABLE heater_cores ADD CONSTRAINT chk_hc_hose_condition
  CHECK (hose_condition IS NULL OR hose_condition IN ('excellent', 'good', 'fair', 'cracked', 'leaking', 'replaced'));

CREATE INDEX idx_heater_cores_vehicle ON heater_cores(vehicle_id);

COMMENT ON TABLE heater_cores IS 'Heater core specifications and condition. One row per heater core installed.';
COMMENT ON COLUMN heater_cores.id IS 'Primary key.';
COMMENT ON COLUMN heater_cores.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN heater_cores.manufacturer IS 'Heater core manufacturer, e.g. Spectra, Dorman, ACDelco, GM.';
COMMENT ON COLUMN heater_cores.part_number IS 'OEM or aftermarket part number.';
COMMENT ON COLUMN heater_cores.material IS 'Core tank and tube material: copper_brass (vintage/rebuildable) or aluminum (modern).';
COMMENT ON COLUMN heater_cores.width_inches IS 'Core width dimension in inches.';
COMMENT ON COLUMN heater_cores.height_inches IS 'Core height dimension in inches.';
COMMENT ON COLUMN heater_cores.depth_inches IS 'Core depth (thickness) dimension in inches.';
COMMENT ON COLUMN heater_cores.inlet_diameter_inches IS 'Coolant inlet hose diameter in inches.';
COMMENT ON COLUMN heater_cores.outlet_diameter_inches IS 'Coolant outlet hose diameter in inches.';
COMMENT ON COLUMN heater_cores.row_count IS 'Number of tube rows in the core.';
COMMENT ON COLUMN heater_cores.fin_count_per_inch IS 'Fin density, fins per inch of core depth.';
COMMENT ON COLUMN heater_cores.shutoff_valve_type IS 'Heater flow shutoff valve type: none, cable_operated, vacuum_operated, electric_solenoid, manual_inline.';
COMMENT ON COLUMN heater_cores.hose_size_inches IS 'Heater hose diameter in inches, e.g. 0.625, 0.75.';
COMMENT ON COLUMN heater_cores.hose_condition IS 'Heater hose condition: excellent, good, fair, cracked, leaking, replaced.';
COMMENT ON COLUMN heater_cores.leak_history_yn IS 'True if the core has had or currently has a coolant leak.';
COMMENT ON COLUMN heater_cores.bypass_yn IS 'True if heater core coolant circuit has been bypassed (hoses looped together).';
COMMENT ON COLUMN heater_cores.sealer_evidence_yn IS 'True if evidence of stop-leak or sealer compound is present.';
COMMENT ON COLUMN heater_cores.is_original IS 'True if factory-installed heater core.';
COMMENT ON COLUMN heater_cores.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN heater_cores.condition_notes IS 'Freeform condition details, e.g. weeping at inlet tank, replaced 2022.';
COMMENT ON COLUMN heater_cores.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN heater_cores.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN heater_cores.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN heater_cores.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 16. VENTILATION — ductwork, blower, controls
-- ============================================================

CREATE TABLE ventilation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Duct and vent layout
  vent_locations_jsonb JSONB DEFAULT '[]',
  dash_vent_count INTEGER,
  floor_duct_yn BOOLEAN,
  rear_duct_yn BOOLEAN,
  defroster_vent_yn BOOLEAN,

  -- Blower motor
  fan_motor_speed_count INTEGER,
  fan_motor_manufacturer TEXT,
  fan_motor_part_number TEXT,
  fan_motor_condition TEXT,
  resistor_pack_present_yn BOOLEAN,
  blower_wheel_type TEXT,

  -- Controls
  blend_door_type TEXT,
  blend_door_condition TEXT,
  temperature_cable_type TEXT,
  mode_cable_count INTEGER,
  fresh_air_provision_yn BOOLEAN,
  recirculate_yn BOOLEAN,
  recirculate_control TEXT,

  -- Defrost
  defrost_type TEXT,
  defrost_timer_yn BOOLEAN,

  -- Cabin air
  cabin_filter_yn BOOLEAN,
  cabin_filter_location TEXT,

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ventilation ADD CONSTRAINT chk_vent_blend_door_type
  CHECK (blend_door_type IS NULL OR blend_door_type IN ('cable', 'vacuum', 'electric'));
ALTER TABLE ventilation ADD CONSTRAINT chk_vent_defrost_type
  CHECK (defrost_type IS NULL OR defrost_type IN ('hot_air', 'electric', 'both'));
ALTER TABLE ventilation ADD CONSTRAINT chk_vent_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE ventilation ADD CONSTRAINT chk_vent_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE ventilation ADD CONSTRAINT chk_vent_fan_speed_count
  CHECK (fan_motor_speed_count IS NULL OR (fan_motor_speed_count >= 1 AND fan_motor_speed_count <= 8));
ALTER TABLE ventilation ADD CONSTRAINT chk_vent_fan_motor_condition
  CHECK (fan_motor_condition IS NULL OR fan_motor_condition IN ('excellent', 'good', 'fair', 'noisy', 'failed'));
ALTER TABLE ventilation ADD CONSTRAINT chk_vent_blend_door_condition
  CHECK (blend_door_condition IS NULL OR blend_door_condition IN ('excellent', 'good', 'stiff', 'broken', 'failed'));

CREATE INDEX idx_ventilation_vehicle ON ventilation(vehicle_id);

COMMENT ON TABLE ventilation IS 'HVAC ventilation system: blower motor, blend doors, ductwork, defrost controls. One row per vehicle.';
COMMENT ON COLUMN ventilation.id IS 'Primary key.';
COMMENT ON COLUMN ventilation.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN ventilation.vent_locations_jsonb IS 'JSON array of vent outlet locations, e.g. [{"location":"dash_center"},{"location":"dash_left"},{"location":"floor_left"}].';
COMMENT ON COLUMN ventilation.dash_vent_count IS 'Number of dash-mounted directional vents.';
COMMENT ON COLUMN ventilation.floor_duct_yn IS 'True if floor heating ducts are present.';
COMMENT ON COLUMN ventilation.rear_duct_yn IS 'True if rear seat heating/cooling ducts are present.';
COMMENT ON COLUMN ventilation.defroster_vent_yn IS 'True if windshield defroster outlet duct is present.';
COMMENT ON COLUMN ventilation.fan_motor_speed_count IS 'Number of blower motor speed settings, e.g. 3, 4, or infinitely variable.';
COMMENT ON COLUMN ventilation.fan_motor_manufacturer IS 'Blower motor manufacturer, e.g. AC Delco, Dorman, Behr.';
COMMENT ON COLUMN ventilation.fan_motor_part_number IS 'Blower motor part number.';
COMMENT ON COLUMN ventilation.fan_motor_condition IS 'Blower motor condition: excellent, good, fair, noisy, failed.';
COMMENT ON COLUMN ventilation.resistor_pack_present_yn IS 'True if a blower resistor pack (multi-speed control) is present.';
COMMENT ON COLUMN ventilation.blower_wheel_type IS 'Blower wheel style, e.g. squirrel_cage, centrifugal, axial.';
COMMENT ON COLUMN ventilation.blend_door_type IS 'Temperature blend door actuation: cable, vacuum, electric.';
COMMENT ON COLUMN ventilation.blend_door_condition IS 'Blend door condition: excellent, good, stiff, broken, failed.';
COMMENT ON COLUMN ventilation.temperature_cable_type IS 'Temperature control cable type if cable-operated, e.g. bowden, push_pull.';
COMMENT ON COLUMN ventilation.mode_cable_count IS 'Number of mode/vent selection control cables.';
COMMENT ON COLUMN ventilation.fresh_air_provision_yn IS 'True if fresh outside air can be selected (vs all-recirculation).';
COMMENT ON COLUMN ventilation.recirculate_yn IS 'True if interior recirculation mode is available.';
COMMENT ON COLUMN ventilation.recirculate_control IS 'Recirculate control type, e.g. manual_door, cable, electric_actuator.';
COMMENT ON COLUMN ventilation.defrost_type IS 'Windshield defrost method: hot_air (from heater), electric (grid on glass), both.';
COMMENT ON COLUMN ventilation.defrost_timer_yn IS 'True if a timed defrost shutoff is present.';
COMMENT ON COLUMN ventilation.cabin_filter_yn IS 'True if a cabin air filter is equipped.';
COMMENT ON COLUMN ventilation.cabin_filter_location IS 'Cabin filter location, e.g. under_dash, behind_glove_box, cowl_area.';
COMMENT ON COLUMN ventilation.is_original IS 'True if factory-original ventilation system.';
COMMENT ON COLUMN ventilation.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN ventilation.condition_notes IS 'Freeform condition details, e.g. blend door actuator broken, mode cable snapped.';
COMMENT ON COLUMN ventilation.provenance IS 'System origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN ventilation.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN ventilation.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN ventilation.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- UPDATED_AT TRIGGERS
-- Reuses digital_twin_set_updated_at() created in the engine
-- migration. DO NOT recreate the function.
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'wiring_harnesses',
    'batteries',
    'alternators_generators',
    'starters',
    'ignition_switches',
    'gauges_instruments',
    'audio_systems',
    'comfort_electrical',
    'exterior_lighting_electrical',
    'fuse_panels',
    'wheels',
    'tires',
    'spare_wheel_tire',
    'hvac_systems',
    'heater_cores',
    'ventilation'
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
-- Public read, service role full access.
-- Same pattern as engine migration and field_evidence.
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'wiring_harnesses',
    'batteries',
    'alternators_generators',
    'starters',
    'ignition_switches',
    'gauges_instruments',
    'audio_systems',
    'comfort_electrical',
    'exterior_lighting_electrical',
    'fuse_panels',
    'wheels',
    'tires',
    'spare_wheel_tire',
    'hvac_systems',
    'heater_cores',
    'ventilation'
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
