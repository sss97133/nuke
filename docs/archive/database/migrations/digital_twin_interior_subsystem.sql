-- ============================================================
-- DIGITAL TWIN: Interior Subsystem DDL
-- Pattern follows digital_twin_engine_subsystem.sql exactly.
--
-- Architecture:
--   Every component gets a spec table with factory specification,
--   condition grade, provenance, and originality tracking.
--   Work events are logged via component_events referencing actors.
--   Both actors and component_events are defined in the engine
--   subsystem migration and are shared — DO NOT recreate them here.
--
-- Tables (10):
--   1.  seats
--   2.  dash_assemblies
--   3.  steering_wheels
--   4.  carpeting
--   5.  headliners
--   6.  door_panels
--   7.  consoles
--   8.  interior_trim
--   9.  rear_cargo_areas
--   10. sound_deadening
-- ============================================================

BEGIN;


-- ============================================================
-- 1. SEATS — per-position occupant seating
--    One row per seat position per vehicle.
--    Positions: driver, passenger, rear_left, rear_center,
--               rear_right, third_row_left, third_row_right.
-- ============================================================

CREATE TABLE seats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Position identity
  position TEXT NOT NULL,

  -- Factory specification
  seat_type TEXT,
  material TEXT,
  color TEXT,
  headrest_type TEXT,

  -- Functional state
  power_yn BOOLEAN,
  heated_yn BOOLEAN,
  cooled_yn BOOLEAN,
  lumbar_yn BOOLEAN,
  track_operation TEXT,
  recliner_operation TEXT,

  -- Physical condition
  bolster_condition TEXT,
  foam_condition TEXT,
  frame_condition TEXT,

  -- Provenance and grade
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE seats ADD CONSTRAINT chk_seats_position
  CHECK (position IN (
    'driver', 'passenger',
    'rear_left', 'rear_center', 'rear_right',
    'third_row_left', 'third_row_right'
  ));
ALTER TABLE seats ADD CONSTRAINT chk_seats_type
  CHECK (seat_type IS NULL OR seat_type IN (
    'bucket', 'bench', 'sport', 'racing', 'captain', 'other'
  ));
ALTER TABLE seats ADD CONSTRAINT chk_seats_material
  CHECK (material IS NULL OR material IN (
    'vinyl', 'cloth', 'leather', 'alcantara', 'velour', 'other'
  ));
ALTER TABLE seats ADD CONSTRAINT chk_seats_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE seats ADD CONSTRAINT chk_seats_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE seats ADD CONSTRAINT chk_seats_track_op
  CHECK (track_operation IS NULL OR track_operation IN (
    'full_range', 'partial_range', 'stuck', 'missing', 'not_applicable'
  ));
ALTER TABLE seats ADD CONSTRAINT chk_seats_recliner_op
  CHECK (recliner_operation IS NULL OR recliner_operation IN (
    'functional', 'stiff', 'stuck', 'missing', 'not_applicable'
  ));

CREATE INDEX idx_seats_vehicle ON seats(vehicle_id);

COMMENT ON TABLE seats IS 'Per-position seat specifications and condition. One row per seat position.';
COMMENT ON COLUMN seats.id IS 'Primary key.';
COMMENT ON COLUMN seats.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN seats.position IS 'Seat position: driver, passenger, rear_left, rear_center, rear_right, third_row_left, third_row_right.';
COMMENT ON COLUMN seats.seat_type IS 'Seat style: bucket, bench, sport, racing, captain, other.';
COMMENT ON COLUMN seats.material IS 'Primary surface material: vinyl, cloth, leather, alcantara, velour, other.';
COMMENT ON COLUMN seats.color IS 'Seat color as described or observed, e.g. black, saddle, parchment.';
COMMENT ON COLUMN seats.headrest_type IS 'Headrest style, e.g. integrated, adjustable_separate, none.';
COMMENT ON COLUMN seats.power_yn IS 'True if seat has power adjustment motors.';
COMMENT ON COLUMN seats.heated_yn IS 'True if seat has heating elements.';
COMMENT ON COLUMN seats.cooled_yn IS 'True if seat has ventilation/cooling.';
COMMENT ON COLUMN seats.lumbar_yn IS 'True if seat has lumbar support (power or manual).';
COMMENT ON COLUMN seats.track_operation IS 'Fore-aft track operation: full_range, partial_range, stuck, missing, not_applicable.';
COMMENT ON COLUMN seats.recliner_operation IS 'Seatback recliner state: functional, stiff, stuck, missing, not_applicable.';
COMMENT ON COLUMN seats.bolster_condition IS 'Condition of seat bolsters, e.g. excellent, cracked, worn_through.';
COMMENT ON COLUMN seats.foam_condition IS 'Condition of seat cushion foam, e.g. firm, collapsed, replaced.';
COMMENT ON COLUMN seats.frame_condition IS 'Condition of seat frame/structure, e.g. solid, cracked, repaired.';
COMMENT ON COLUMN seats.is_original IS 'True if factory-installed seat for this position.';
COMMENT ON COLUMN seats.condition_grade IS 'Overall condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN seats.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN seats.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN seats.provenance_detail IS 'Detailed provenance info: manufacturer, part number, date acquired.';
COMMENT ON COLUMN seats.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN seats.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 2. DASH_ASSEMBLIES — instrument panel and dashboard
--    Typically one row per vehicle; split rows only if a
--    two-piece dash is tracked separately.
-- ============================================================

CREATE TABLE dash_assemblies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Factory specification
  material TEXT,
  color TEXT,
  pad_type TEXT,
  gauge_cluster_type TEXT,
  vent_style TEXT,

  -- Physical state
  crack_locations_jsonb JSONB DEFAULT '[]',
  defroster_duct_condition TEXT,
  glovebox_condition TEXT,
  ashtray_present BOOLEAN,

  -- Provenance and grade
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE dash_assemblies ADD CONSTRAINT chk_dash_material
  CHECK (material IS NULL OR material IN (
    'hard_plastic', 'soft_vinyl', 'padded_vinyl', 'leather_wrapped',
    'wood_veneer', 'carbon_fiber', 'fiberglass', 'other'
  ));
ALTER TABLE dash_assemblies ADD CONSTRAINT chk_dash_pad_type
  CHECK (pad_type IS NULL OR pad_type IN ('hard', 'soft', 'foam', 'other'));
ALTER TABLE dash_assemblies ADD CONSTRAINT chk_dash_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE dash_assemblies ADD CONSTRAINT chk_dash_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE dash_assemblies ADD CONSTRAINT chk_dash_glove_cond
  CHECK (glovebox_condition IS NULL OR glovebox_condition IN (
    'excellent', 'good', 'fair', 'poor', 'missing', 'unknown'
  ));

CREATE INDEX idx_dash_assemblies_vehicle ON dash_assemblies(vehicle_id);

COMMENT ON TABLE dash_assemblies IS 'Dashboard/instrument panel specifications and condition. One row per vehicle (or per dash section for two-piece designs).';
COMMENT ON COLUMN dash_assemblies.id IS 'Primary key.';
COMMENT ON COLUMN dash_assemblies.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN dash_assemblies.material IS 'Primary dash surface material: hard_plastic, soft_vinyl, padded_vinyl, leather_wrapped, wood_veneer, carbon_fiber, fiberglass, other.';
COMMENT ON COLUMN dash_assemblies.color IS 'Dash color as observed, e.g. black, tan, ivory.';
COMMENT ON COLUMN dash_assemblies.pad_type IS 'Dashboard pad construction: hard, soft, foam, other.';
COMMENT ON COLUMN dash_assemblies.gauge_cluster_type IS 'Instrument cluster type, e.g. factory_round, factory_rectangular, aftermarket, digital, custom.';
COMMENT ON COLUMN dash_assemblies.vent_style IS 'A/C-heater vent style, e.g. round_louver, rectangular_louver, integrated, center_stack.';
COMMENT ON COLUMN dash_assemblies.crack_locations_jsonb IS 'JSON array of crack location descriptions, e.g. ["top_center", "left_of_cluster"]. Empty array if no cracks.';
COMMENT ON COLUMN dash_assemblies.defroster_duct_condition IS 'Defroster duct condition, e.g. intact, cracked, missing.';
COMMENT ON COLUMN dash_assemblies.glovebox_condition IS 'Glovebox door/box condition: excellent, good, fair, poor, missing, unknown.';
COMMENT ON COLUMN dash_assemblies.ashtray_present IS 'True if the factory ashtray is present.';
COMMENT ON COLUMN dash_assemblies.is_original IS 'True if this is the factory dash for the vehicle.';
COMMENT ON COLUMN dash_assemblies.condition_grade IS 'Overall condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN dash_assemblies.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN dash_assemblies.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN dash_assemblies.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN dash_assemblies.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN dash_assemblies.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 3. STEERING_WHEELS — wheel, column cover, horn button
-- ============================================================

CREATE TABLE steering_wheels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Factory specification
  material TEXT,
  diameter_inches NUMERIC(4,1),
  wheel_type TEXT,
  horn_button_type TEXT,

  -- Physical condition
  wrap_condition TEXT,
  column_cover_condition TEXT,

  -- Provenance and grade
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE steering_wheels ADD CONSTRAINT chk_sw_material
  CHECK (material IS NULL OR material IN (
    'hard_plastic', 'foam', 'leather', 'wood', 'alcantara',
    'carbon_fiber', 'bakelite', 'other'
  ));
ALTER TABLE steering_wheels ADD CONSTRAINT chk_sw_type
  CHECK (wheel_type IS NULL OR wheel_type IN (
    'two_spoke', 'three_spoke', 'four_spoke', 'sport',
    'deep_dish', 'banjo', 'other'
  ));
ALTER TABLE steering_wheels ADD CONSTRAINT chk_sw_diameter
  CHECK (diameter_inches IS NULL OR (diameter_inches >= 10 AND diameter_inches <= 24));
ALTER TABLE steering_wheels ADD CONSTRAINT chk_sw_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE steering_wheels ADD CONSTRAINT chk_sw_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_steering_wheels_vehicle ON steering_wheels(vehicle_id);

COMMENT ON TABLE steering_wheels IS 'Steering wheel and column cover specifications and condition.';
COMMENT ON COLUMN steering_wheels.id IS 'Primary key.';
COMMENT ON COLUMN steering_wheels.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN steering_wheels.material IS 'Rim grip material: hard_plastic, foam, leather, wood, alcantara, carbon_fiber, bakelite, other.';
COMMENT ON COLUMN steering_wheels.diameter_inches IS 'Outer diameter in inches, typically 14-17 for factory wheels.';
COMMENT ON COLUMN steering_wheels.wheel_type IS 'Spoke configuration: two_spoke, three_spoke, four_spoke, sport, deep_dish, banjo, other.';
COMMENT ON COLUMN steering_wheels.horn_button_type IS 'Horn button style, e.g. factory_emblem, sport_ring, full_pad, aftermarket.';
COMMENT ON COLUMN steering_wheels.wrap_condition IS 'Condition of rim material/wrap, e.g. excellent, cracked, worn, retrimmed.';
COMMENT ON COLUMN steering_wheels.column_cover_condition IS 'Steering column shroud/cover condition, e.g. excellent, cracked, missing.';
COMMENT ON COLUMN steering_wheels.is_original IS 'True if factory-installed steering wheel.';
COMMENT ON COLUMN steering_wheels.condition_grade IS 'Overall condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN steering_wheels.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN steering_wheels.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN steering_wheels.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN steering_wheels.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN steering_wheels.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 4. CARPETING — floor, trunk, and sound deadening substrate
-- ============================================================

CREATE TABLE carpeting (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Factory specification
  material TEXT,
  color TEXT,
  underlay_type TEXT,
  sound_deadening_type TEXT,
  floor_mat_type TEXT,

  -- Physical condition
  trunk_carpet_condition TEXT,

  -- Provenance and grade
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE carpeting ADD CONSTRAINT chk_carpet_material
  CHECK (material IS NULL OR material IN (
    'loop', 'cut_pile', 'rubber', 'vinyl', 'other'
  ));
ALTER TABLE carpeting ADD CONSTRAINT chk_carpet_underlay
  CHECK (underlay_type IS NULL OR underlay_type IN (
    'jute', 'felt', 'foam', 'mass_loaded', 'none', 'other'
  ));
ALTER TABLE carpeting ADD CONSTRAINT chk_carpet_sound_dead
  CHECK (sound_deadening_type IS NULL OR sound_deadening_type IN (
    'none', 'factory_tar', 'dynamat', 'second_skin', 'spray',
    'mass_loaded_vinyl', 'other'
  ));
ALTER TABLE carpeting ADD CONSTRAINT chk_carpet_mat_type
  CHECK (floor_mat_type IS NULL OR floor_mat_type IN (
    'none', 'loop', 'cut_pile', 'rubber', 'all_weather', 'other'
  ));
ALTER TABLE carpeting ADD CONSTRAINT chk_carpet_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE carpeting ADD CONSTRAINT chk_carpet_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE carpeting ADD CONSTRAINT chk_carpet_trunk_cond
  CHECK (trunk_carpet_condition IS NULL OR trunk_carpet_condition IN (
    'excellent', 'good', 'fair', 'poor', 'missing', 'unknown'
  ));

CREATE INDEX idx_carpeting_vehicle ON carpeting(vehicle_id);

COMMENT ON TABLE carpeting IS 'Floor carpeting, trunk carpet, underlay, and sound deadening substrate specifications.';
COMMENT ON COLUMN carpeting.id IS 'Primary key.';
COMMENT ON COLUMN carpeting.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN carpeting.material IS 'Carpet weave type: loop, cut_pile, rubber, vinyl, other.';
COMMENT ON COLUMN carpeting.color IS 'Carpet color as described or observed.';
COMMENT ON COLUMN carpeting.underlay_type IS 'Carpet backing/underlay material: jute, felt, foam, mass_loaded, none, other.';
COMMENT ON COLUMN carpeting.sound_deadening_type IS 'Sound deadening layer under carpet: none, factory_tar, dynamat, second_skin, spray, mass_loaded_vinyl, other.';
COMMENT ON COLUMN carpeting.floor_mat_type IS 'Removable floor mat type: none, loop, cut_pile, rubber, all_weather, other.';
COMMENT ON COLUMN carpeting.trunk_carpet_condition IS 'Trunk/cargo area carpet condition: excellent, good, fair, poor, missing, unknown.';
COMMENT ON COLUMN carpeting.is_original IS 'True if factory-original carpet set.';
COMMENT ON COLUMN carpeting.condition_grade IS 'Overall floor carpet condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN carpeting.condition_notes IS 'Freeform condition details, e.g. stains, burns, moth damage.';
COMMENT ON COLUMN carpeting.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN carpeting.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN carpeting.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN carpeting.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 5. HEADLINERS — roof interior panel
-- ============================================================

CREATE TABLE headliners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Factory specification
  material TEXT,
  color TEXT,
  attachment_type TEXT,
  dome_light_condition TEXT,

  -- Physical condition
  sagging_yn BOOLEAN DEFAULT FALSE,
  stain_locations_jsonb JSONB DEFAULT '[]',

  -- Provenance and grade
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE headliners ADD CONSTRAINT chk_hl_material
  CHECK (material IS NULL OR material IN (
    'cloth', 'vinyl', 'perforated_vinyl', 'suede', 'cardboard_backed',
    'molded_abs', 'other'
  ));
ALTER TABLE headliners ADD CONSTRAINT chk_hl_attachment
  CHECK (attachment_type IS NULL OR attachment_type IN (
    'bow', 'glue', 'snap', 'molded', 'other'
  ));
ALTER TABLE headliners ADD CONSTRAINT chk_hl_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE headliners ADD CONSTRAINT chk_hl_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE headliners ADD CONSTRAINT chk_hl_dome_cond
  CHECK (dome_light_condition IS NULL OR dome_light_condition IN (
    'functional', 'inoperative', 'missing', 'not_equipped', 'unknown'
  ));

CREATE INDEX idx_headliners_vehicle ON headliners(vehicle_id);

COMMENT ON TABLE headliners IS 'Headliner material, attachment, and condition. One row per vehicle.';
COMMENT ON COLUMN headliners.id IS 'Primary key.';
COMMENT ON COLUMN headliners.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN headliners.material IS 'Headliner surface material: cloth, vinyl, perforated_vinyl, suede, cardboard_backed, molded_abs, other.';
COMMENT ON COLUMN headliners.color IS 'Headliner color as observed.';
COMMENT ON COLUMN headliners.attachment_type IS 'How headliner is retained: bow (wire bows), glue, snap, molded, other.';
COMMENT ON COLUMN headliners.dome_light_condition IS 'Dome/interior light condition: functional, inoperative, missing, not_equipped, unknown.';
COMMENT ON COLUMN headliners.sagging_yn IS 'True if headliner is sagging or delaminating from substrate.';
COMMENT ON COLUMN headliners.stain_locations_jsonb IS 'JSON array of stain location descriptions, e.g. ["front_center", "rear_left"]. Empty array if clean.';
COMMENT ON COLUMN headliners.is_original IS 'True if factory-original headliner.';
COMMENT ON COLUMN headliners.condition_grade IS 'Overall condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN headliners.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN headliners.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN headliners.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN headliners.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN headliners.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 6. DOOR_PANELS — per-door interior trim panel
--    Positions: front_left, front_right, rear_left, rear_right,
--               liftgate, tailgate.
-- ============================================================

CREATE TABLE door_panels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Position identity
  position TEXT NOT NULL,

  -- Factory specification
  material TEXT,
  color TEXT,
  window_crank_or_switch TEXT,
  armrest_type TEXT,
  speaker_location TEXT,
  map_pocket BOOLEAN DEFAULT FALSE,
  reflector BOOLEAN DEFAULT FALSE,
  courtesy_light BOOLEAN DEFAULT FALSE,

  -- Physical condition
  armrest_condition TEXT,

  -- Provenance and grade
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE door_panels ADD CONSTRAINT chk_dp_position
  CHECK (position IN (
    'front_left', 'front_right', 'rear_left', 'rear_right',
    'liftgate', 'tailgate'
  ));
ALTER TABLE door_panels ADD CONSTRAINT chk_dp_material
  CHECK (material IS NULL OR material IN (
    'hard_plastic', 'vinyl', 'cloth', 'leather', 'cardboard_backed',
    'fiberglass', 'other'
  ));
ALTER TABLE door_panels ADD CONSTRAINT chk_dp_window
  CHECK (window_crank_or_switch IS NULL OR window_crank_or_switch IN (
    'manual_crank', 'power_switch', 'none', 'other'
  ));
ALTER TABLE door_panels ADD CONSTRAINT chk_dp_armrest_type
  CHECK (armrest_type IS NULL OR armrest_type IN (
    'integrated', 'separate_padded', 'pull_strap', 'none', 'other'
  ));
ALTER TABLE door_panels ADD CONSTRAINT chk_dp_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE door_panels ADD CONSTRAINT chk_dp_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE door_panels ADD CONSTRAINT chk_dp_armrest_cond
  CHECK (armrest_condition IS NULL OR armrest_condition IN (
    'excellent', 'good', 'fair', 'poor', 'missing', 'unknown'
  ));

CREATE INDEX idx_door_panels_vehicle ON door_panels(vehicle_id);

COMMENT ON TABLE door_panels IS 'Per-door interior trim panel specifications and condition.';
COMMENT ON COLUMN door_panels.id IS 'Primary key.';
COMMENT ON COLUMN door_panels.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN door_panels.position IS 'Door position: front_left, front_right, rear_left, rear_right, liftgate, tailgate.';
COMMENT ON COLUMN door_panels.material IS 'Panel surface material: hard_plastic, vinyl, cloth, leather, cardboard_backed, fiberglass, other.';
COMMENT ON COLUMN door_panels.color IS 'Panel color as observed.';
COMMENT ON COLUMN door_panels.window_crank_or_switch IS 'Window operation: manual_crank, power_switch, none, other.';
COMMENT ON COLUMN door_panels.armrest_type IS 'Armrest style: integrated (molded into panel), separate_padded, pull_strap, none, other.';
COMMENT ON COLUMN door_panels.speaker_location IS 'Speaker mounting location on panel, e.g. lower_front, upper_corner, none.';
COMMENT ON COLUMN door_panels.map_pocket IS 'True if panel has a map/storage pocket.';
COMMENT ON COLUMN door_panels.reflector IS 'True if door edge reflector is present.';
COMMENT ON COLUMN door_panels.courtesy_light IS 'True if panel has a courtesy/door-ajar light.';
COMMENT ON COLUMN door_panels.armrest_condition IS 'Armrest surface condition: excellent, good, fair, poor, missing, unknown.';
COMMENT ON COLUMN door_panels.is_original IS 'True if factory-original door panel.';
COMMENT ON COLUMN door_panels.condition_grade IS 'Overall panel condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN door_panels.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN door_panels.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN door_panels.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN door_panels.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN door_panels.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 7. CONSOLES — floor, overhead, or absent center console
-- ============================================================

CREATE TABLE consoles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Factory specification
  console_type TEXT NOT NULL DEFAULT 'none',
  material TEXT,
  color TEXT,
  features_jsonb JSONB DEFAULT '[]',

  -- Physical condition
  lid_condition TEXT,

  -- Provenance and grade
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE consoles ADD CONSTRAINT chk_con_type
  CHECK (console_type IN ('floor', 'overhead', 'none', 'other'));
ALTER TABLE consoles ADD CONSTRAINT chk_con_material
  CHECK (material IS NULL OR material IN (
    'hard_plastic', 'vinyl', 'leather', 'wood', 'carbon_fiber', 'other'
  ));
ALTER TABLE consoles ADD CONSTRAINT chk_con_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE consoles ADD CONSTRAINT chk_con_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE consoles ADD CONSTRAINT chk_con_lid_cond
  CHECK (lid_condition IS NULL OR lid_condition IN (
    'excellent', 'good', 'fair', 'poor', 'missing', 'not_equipped', 'unknown'
  ));

CREATE INDEX idx_consoles_vehicle ON consoles(vehicle_id);

COMMENT ON TABLE consoles IS 'Center or overhead console specifications and condition. One row per vehicle.';
COMMENT ON COLUMN consoles.id IS 'Primary key.';
COMMENT ON COLUMN consoles.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN consoles.console_type IS 'Console location: floor, overhead, none, other.';
COMMENT ON COLUMN consoles.material IS 'Primary surface material: hard_plastic, vinyl, leather, wood, carbon_fiber, other.';
COMMENT ON COLUMN consoles.color IS 'Console color as observed.';
COMMENT ON COLUMN consoles.features_jsonb IS 'JSON array of feature tags present, e.g. ["cupholder", "storage", "armrest", "shifter_boot", "coin_holder", "usb_ports"]. Empty if no console.';
COMMENT ON COLUMN consoles.lid_condition IS 'Console lid/armrest lid condition: excellent, good, fair, poor, missing, not_equipped, unknown.';
COMMENT ON COLUMN consoles.is_original IS 'True if factory-installed console.';
COMMENT ON COLUMN consoles.condition_grade IS 'Overall condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN consoles.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN consoles.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN consoles.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN consoles.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN consoles.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 8. INTERIOR_TRIM — per-piece pillar, kick panel, sill trim
--    Each row is one discrete trim piece at one location.
-- ============================================================

CREATE TABLE interior_trim (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Location identity
  location TEXT NOT NULL,

  -- Factory specification
  material TEXT,
  color TEXT,

  -- Provenance and grade
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE interior_trim ADD CONSTRAINT chk_it_location
  CHECK (location IN (
    'a_pillar_lf', 'a_pillar_rf',
    'b_pillar_lf', 'b_pillar_rf',
    'c_pillar_lf', 'c_pillar_rf',
    'kick_panel_lf', 'kick_panel_rf',
    'sill_plate_lf', 'sill_plate_rf',
    'sail_panel_lf', 'sail_panel_rf',
    'package_tray', 'other'
  ));
ALTER TABLE interior_trim ADD CONSTRAINT chk_it_material
  CHECK (material IS NULL OR material IN (
    'hard_plastic', 'vinyl', 'cloth', 'cardboard_backed',
    'fiberglass', 'carpet', 'other'
  ));
ALTER TABLE interior_trim ADD CONSTRAINT chk_it_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE interior_trim ADD CONSTRAINT chk_it_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_interior_trim_vehicle ON interior_trim(vehicle_id);

COMMENT ON TABLE interior_trim IS 'Per-piece interior trim specifications. One row per discrete trim piece location.';
COMMENT ON COLUMN interior_trim.id IS 'Primary key.';
COMMENT ON COLUMN interior_trim.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN interior_trim.location IS 'Trim piece location: a_pillar_lf, a_pillar_rf, b_pillar_lf, b_pillar_rf, c_pillar_lf, c_pillar_rf, kick_panel_lf, kick_panel_rf, sill_plate_lf, sill_plate_rf, sail_panel_lf, sail_panel_rf, package_tray, other.';
COMMENT ON COLUMN interior_trim.material IS 'Trim material: hard_plastic, vinyl, cloth, cardboard_backed, fiberglass, carpet, other.';
COMMENT ON COLUMN interior_trim.color IS 'Trim color as observed.';
COMMENT ON COLUMN interior_trim.is_original IS 'True if factory-original trim piece.';
COMMENT ON COLUMN interior_trim.condition_grade IS 'Condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN interior_trim.condition_notes IS 'Freeform condition details, e.g. crack at mounting tab, repainted.';
COMMENT ON COLUMN interior_trim.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN interior_trim.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN interior_trim.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN interior_trim.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 9. REAR_CARGO_AREAS — SUV, wagon, truck cargo space
--    NULL vehicle_id rows are not permitted; skip this table
--    for vehicles with no cargo area (e.g. coupes without trunk).
-- ============================================================

CREATE TABLE rear_cargo_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Factory specification
  cargo_material TEXT,
  spare_tire_location TEXT,
  cargo_mat TEXT,
  tie_downs TEXT,
  cargo_cover_type TEXT,

  -- Present/absent flags
  spare_present_yn BOOLEAN,
  jack_present_yn BOOLEAN,
  tools_present_yn BOOLEAN,
  third_seat_yn BOOLEAN DEFAULT FALSE,

  -- Provenance and grade
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rear_cargo_areas ADD CONSTRAINT chk_rca_cargo_mat
  CHECK (cargo_material IS NULL OR cargo_material IN (
    'carpet', 'rubber', 'vinyl', 'bare_metal', 'spray_liner',
    'drop_in_liner', 'wood', 'other'
  ));
ALTER TABLE rear_cargo_areas ADD CONSTRAINT chk_rca_spare_loc
  CHECK (spare_tire_location IS NULL OR spare_tire_location IN (
    'underbody', 'inside_cargo', 'bumper_mount', 'roof_rack',
    'absent', 'not_applicable', 'other'
  ));
ALTER TABLE rear_cargo_areas ADD CONSTRAINT chk_rca_cargo_cover
  CHECK (cargo_cover_type IS NULL OR cargo_cover_type IN (
    'rigid_panel', 'roll_up', 'soft_tonneau', 'hard_tonneau',
    'none', 'other'
  ));
ALTER TABLE rear_cargo_areas ADD CONSTRAINT chk_rca_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE rear_cargo_areas ADD CONSTRAINT chk_rca_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_rear_cargo_areas_vehicle ON rear_cargo_areas(vehicle_id);

COMMENT ON TABLE rear_cargo_areas IS 'Rear cargo area specifications for SUVs, wagons, and trucks. One row per vehicle.';
COMMENT ON COLUMN rear_cargo_areas.id IS 'Primary key.';
COMMENT ON COLUMN rear_cargo_areas.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN rear_cargo_areas.cargo_material IS 'Cargo floor surface: carpet, rubber, vinyl, bare_metal, spray_liner, drop_in_liner, wood, other.';
COMMENT ON COLUMN rear_cargo_areas.spare_tire_location IS 'Spare tire storage location: underbody, inside_cargo, bumper_mount, roof_rack, absent, not_applicable, other.';
COMMENT ON COLUMN rear_cargo_areas.cargo_mat IS 'Cargo mat description, e.g. factory_rubber, aftermarket_all_weather, none.';
COMMENT ON COLUMN rear_cargo_areas.tie_downs IS 'Tie-down hardware description, e.g. factory_d_rings, aftermarket_cleats, none.';
COMMENT ON COLUMN rear_cargo_areas.cargo_cover_type IS 'Cargo cover type: rigid_panel, roll_up, soft_tonneau, hard_tonneau, none, other.';
COMMENT ON COLUMN rear_cargo_areas.spare_present_yn IS 'True if spare tire is present.';
COMMENT ON COLUMN rear_cargo_areas.jack_present_yn IS 'True if factory or supplemental jack is present.';
COMMENT ON COLUMN rear_cargo_areas.tools_present_yn IS 'True if factory tool kit (lug wrench, etc.) is present.';
COMMENT ON COLUMN rear_cargo_areas.third_seat_yn IS 'True if a third-row/rumble seat is installed in this cargo area.';
COMMENT ON COLUMN rear_cargo_areas.is_original IS 'True if cargo area is in factory-original configuration.';
COMMENT ON COLUMN rear_cargo_areas.condition_grade IS 'Overall cargo area condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN rear_cargo_areas.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN rear_cargo_areas.provenance IS 'Configuration origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN rear_cargo_areas.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN rear_cargo_areas.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN rear_cargo_areas.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 10. SOUND_DEADENING — dedicated acoustic/thermal treatment
--     Distinct from carpeting.sound_deadening_type which only
--     tracks the layer directly under the carpet.  This table
--     captures full-panel or targeted treatments applied
--     independently of the carpet system.
-- ============================================================

CREATE TABLE sound_deadening (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Specification
  deadening_type TEXT NOT NULL DEFAULT 'none',
  locations_jsonb JSONB DEFAULT '[]',
  weight_added_lbs NUMERIC(5,1),
  coverage_pct NUMERIC(5,1),

  -- Physical condition
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,

  -- Provenance (no is_original here — aftermarket deadening is
  -- the dominant case; factory treatments use deadening_type='factory')
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sound_deadening ADD CONSTRAINT chk_sd_type
  CHECK (deadening_type IN (
    'factory', 'dynamat', 'second_skin', 'spray', 'mass_loaded_vinyl', 'none', 'other'
  ));
ALTER TABLE sound_deadening ADD CONSTRAINT chk_sd_coverage
  CHECK (coverage_pct IS NULL OR (coverage_pct >= 0 AND coverage_pct <= 100));
ALTER TABLE sound_deadening ADD CONSTRAINT chk_sd_weight
  CHECK (weight_added_lbs IS NULL OR weight_added_lbs >= 0);
ALTER TABLE sound_deadening ADD CONSTRAINT chk_sd_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE sound_deadening ADD CONSTRAINT chk_sd_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_sound_deadening_vehicle ON sound_deadening(vehicle_id);

COMMENT ON TABLE sound_deadening IS 'Sound and thermal deadening treatment specifications. One row per treatment layer per vehicle.';
COMMENT ON COLUMN sound_deadening.id IS 'Primary key.';
COMMENT ON COLUMN sound_deadening.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN sound_deadening.deadening_type IS 'Material brand/type: factory, dynamat, second_skin, spray, mass_loaded_vinyl, none, other.';
COMMENT ON COLUMN sound_deadening.locations_jsonb IS 'JSON array of application locations, e.g. ["floor_pan", "firewall", "doors", "roof"]. Empty array if none.';
COMMENT ON COLUMN sound_deadening.weight_added_lbs IS 'Estimated weight added by treatment in pounds.';
COMMENT ON COLUMN sound_deadening.coverage_pct IS 'Estimated percentage of interior surface covered, 0-100.';
COMMENT ON COLUMN sound_deadening.condition_grade IS 'Condition of the deadening material: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN sound_deadening.condition_notes IS 'Freeform condition details, e.g. peeling in footwells, dried out.';
COMMENT ON COLUMN sound_deadening.provenance IS 'Treatment origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN sound_deadening.provenance_detail IS 'Detailed provenance info: installer, date, product batch.';
COMMENT ON COLUMN sound_deadening.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN sound_deadening.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- UPDATED_AT TRIGGERS
-- Uses the shared function digital_twin_set_updated_at()
-- defined in digital_twin_engine_subsystem.sql.
-- DO NOT recreate that function here.
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'seats',
    'dash_assemblies',
    'steering_wheels',
    'carpeting',
    'headliners',
    'door_panels',
    'consoles',
    'interior_trim',
    'rear_cargo_areas',
    'sound_deadening'
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
-- Same pattern: public read, service role write.
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'seats',
    'dash_assemblies',
    'steering_wheels',
    'carpeting',
    'headliners',
    'door_panels',
    'consoles',
    'interior_trim',
    'rear_cargo_areas',
    'sound_deadening'
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
