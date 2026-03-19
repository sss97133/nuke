-- ============================================================
-- DIGITAL TWIN: Body Exterior Subsystem DDL
--
-- Architecture:
--   12 tables covering every exterior body component.
--   Follows the exact pattern from digital_twin_engine_subsystem.sql:
--   vehicle_id FK ON DELETE CASCADE, is_original, condition_grade,
--   provenance, COMMENT ON COLUMN for every column, CHECK constraints,
--   RLS (public read / service role write), updated_at trigger via
--   digital_twin_set_updated_at().
--
-- Prerequisites:
--   - digital_twin_engine_subsystem.sql must have been applied first
--     (creates actors, component_events, digital_twin_set_updated_at).
--
-- Tables in this migration:
--   1.  body_panels
--   2.  paint_systems
--   3.  body_glass
--   4.  body_trim_chrome
--   5.  body_weatherstripping
--   6.  body_bumpers
--   7.  body_lighting
--   8.  body_mirrors
--   9.  body_emblems_badges
--   10. body_convertible_tops
--   11. truck_beds
--   12. body_structure
-- ============================================================

BEGIN;


-- ============================================================
-- 1. BODY_PANELS — one row per panel, per vehicle
-- ============================================================

CREATE TABLE body_panels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Panel identity
  panel_name TEXT NOT NULL,
  material TEXT,

  -- Condition
  rust_grade TEXT DEFAULT 'none',
  paint_match_yn BOOLEAN,
  filler_detected_yn BOOLEAN,

  -- Standard state columns
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE body_panels ADD CONSTRAINT chk_bp_panel_name
  CHECK (panel_name IN (
    'fender_lf', 'fender_rf',
    'door_lf', 'door_rf', 'door_lr', 'door_rr',
    'quarter_lf', 'quarter_rf',
    'hood', 'trunk_tailgate', 'roof',
    'rocker_lf', 'rocker_rf',
    'cab_corner_lf', 'cab_corner_rf',
    'bedside_lf', 'bedside_rf'
  ));

ALTER TABLE body_panels ADD CONSTRAINT chk_bp_material
  CHECK (material IS NULL OR material IN (
    'steel', 'aluminum', 'fiberglass', 'carbon_fiber', 'smc'
  ));

ALTER TABLE body_panels ADD CONSTRAINT chk_bp_rust_grade
  CHECK (rust_grade IN ('none', 'surface', 'bubbling', 'perforation', 'structural'));

ALTER TABLE body_panels ADD CONSTRAINT chk_bp_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));

ALTER TABLE body_panels ADD CONSTRAINT chk_bp_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_body_panels_vehicle ON body_panels(vehicle_id);
CREATE INDEX idx_body_panels_name ON body_panels(vehicle_id, panel_name);

COMMENT ON TABLE body_panels IS 'One row per exterior panel per vehicle. Tracks material, rust grade, paint match, and filler presence at the per-panel level.';
COMMENT ON COLUMN body_panels.id IS 'Primary key.';
COMMENT ON COLUMN body_panels.vehicle_id IS 'FK to vehicles(id). ON DELETE CASCADE.';
COMMENT ON COLUMN body_panels.panel_name IS 'Panel location: fender_lf, fender_rf, door_lf, door_rf, door_lr, door_rr, quarter_lf, quarter_rf, hood, trunk_tailgate, roof, rocker_lf, rocker_rf, cab_corner_lf, cab_corner_rf, bedside_lf, bedside_rf.';
COMMENT ON COLUMN body_panels.material IS 'Panel material: steel, aluminum, fiberglass, carbon_fiber, smc. NULL if unknown.';
COMMENT ON COLUMN body_panels.rust_grade IS 'Rust severity: none, surface (light oxidation), bubbling (under paint), perforation (holes through), structural (affects rigidity).';
COMMENT ON COLUMN body_panels.paint_match_yn IS 'True if panel paint matches the rest of the vehicle. False indicates repaint or replacement.';
COMMENT ON COLUMN body_panels.filler_detected_yn IS 'True if body filler (Bondo or similar) has been detected in this panel via magnet or inspection.';
COMMENT ON COLUMN body_panels.is_original IS 'True if this is the factory-installed panel for this vehicle.';
COMMENT ON COLUMN body_panels.condition_grade IS 'Overall condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN body_panels.condition_notes IS 'Freeform condition details, e.g. small dent at leading edge, professional repair visible.';
COMMENT ON COLUMN body_panels.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN body_panels.provenance_detail IS 'Detailed provenance info: manufacturer, part number, date acquired.';
COMMENT ON COLUMN body_panels.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN body_panels.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 2. PAINT_SYSTEMS — paint documentation for the vehicle
-- ============================================================

CREATE TABLE paint_systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Color identity
  paint_code TEXT,
  paint_name TEXT,
  base_color TEXT,

  -- System characteristics
  paint_type TEXT,
  metallic_yn BOOLEAN,
  pearl_yn BOOLEAN,
  original_color_yn BOOLEAN,
  respray_count INTEGER DEFAULT 0,

  -- Current state
  clear_coat_condition TEXT,
  paint_thickness_mils NUMERIC(5,2),
  color_match_quality TEXT,

  -- Standard state columns
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE paint_systems ADD CONSTRAINT chk_ps_paint_type
  CHECK (paint_type IS NULL OR paint_type IN (
    'lacquer', 'enamel', 'urethane', 'basecoat_clearcoat', 'single_stage'
  ));

ALTER TABLE paint_systems ADD CONSTRAINT chk_ps_clear_coat_condition
  CHECK (clear_coat_condition IS NULL OR clear_coat_condition IN (
    'excellent', 'good', 'fair', 'poor', 'failed', 'not_applicable'
  ));

ALTER TABLE paint_systems ADD CONSTRAINT chk_ps_color_match_quality
  CHECK (color_match_quality IS NULL OR color_match_quality IN (
    'factory_match', 'excellent', 'good', 'fair', 'poor', 'mismatched'
  ));

ALTER TABLE paint_systems ADD CONSTRAINT chk_ps_respray_count
  CHECK (respray_count IS NULL OR respray_count >= 0);

ALTER TABLE paint_systems ADD CONSTRAINT chk_ps_paint_thickness
  CHECK (paint_thickness_mils IS NULL OR paint_thickness_mils >= 0);

ALTER TABLE paint_systems ADD CONSTRAINT chk_ps_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));

ALTER TABLE paint_systems ADD CONSTRAINT chk_ps_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_paint_systems_vehicle ON paint_systems(vehicle_id);

COMMENT ON TABLE paint_systems IS 'Paint system documentation. One row per paint application (factory or respray). Multiple rows if layers are known.';
COMMENT ON COLUMN paint_systems.id IS 'Primary key.';
COMMENT ON COLUMN paint_systems.vehicle_id IS 'FK to vehicles(id). ON DELETE CASCADE.';
COMMENT ON COLUMN paint_systems.paint_code IS 'Factory or aftermarket paint code, e.g. L76, Hugger Orange, PPG DAU.';
COMMENT ON COLUMN paint_systems.paint_name IS 'Human-readable paint color name, e.g. Fathom Green, Moulin Rouge.';
COMMENT ON COLUMN paint_systems.base_color IS 'Simplified base color descriptor, e.g. red, blue, silver, black.';
COMMENT ON COLUMN paint_systems.paint_type IS 'Chemistry: lacquer, enamel, urethane, basecoat_clearcoat, single_stage.';
COMMENT ON COLUMN paint_systems.metallic_yn IS 'True if paint contains metallic flake.';
COMMENT ON COLUMN paint_systems.pearl_yn IS 'True if paint contains pearl pigment.';
COMMENT ON COLUMN paint_systems.original_color_yn IS 'True if this is the factory-correct color for this vehicle per trim tag or data plate.';
COMMENT ON COLUMN paint_systems.respray_count IS 'Number of complete resprays beyond the factory coat. 0 = factory paint only.';
COMMENT ON COLUMN paint_systems.clear_coat_condition IS 'Condition of the clear coat layer: excellent, good, fair, poor, failed, not_applicable (single-stage).';
COMMENT ON COLUMN paint_systems.paint_thickness_mils IS 'Average paint thickness in mils measured with paint depth gauge.';
COMMENT ON COLUMN paint_systems.color_match_quality IS 'Panel-to-panel color match quality: factory_match, excellent, good, fair, poor, mismatched.';
COMMENT ON COLUMN paint_systems.is_original IS 'True if this row describes the factory-applied paint.';
COMMENT ON COLUMN paint_systems.condition_grade IS 'Overall paint condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN paint_systems.condition_notes IS 'Freeform condition details, e.g. light orange peel on hood, overspray on trim.';
COMMENT ON COLUMN paint_systems.provenance IS 'Paint origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN paint_systems.provenance_detail IS 'Detailed provenance: shop name, date painted, product used.';
COMMENT ON COLUMN paint_systems.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN paint_systems.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 3. BODY_GLASS — per-opening glazing documentation
-- ============================================================

CREATE TABLE body_glass (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Opening identity
  location TEXT NOT NULL,
  glass_type TEXT,

  -- Glass characteristics
  tint TEXT,
  date_code TEXT,
  manufacturer_mark TEXT,

  -- Condition
  seal_condition TEXT,

  -- Standard state columns
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE body_glass ADD CONSTRAINT chk_bg_location
  CHECK (location IN (
    'windshield', 'rear_glass',
    'door_lf', 'door_rf', 'door_lr', 'door_rr',
    'quarter_lf', 'quarter_rf',
    'vent_lf', 'vent_rf'
  ));

ALTER TABLE body_glass ADD CONSTRAINT chk_bg_glass_type
  CHECK (glass_type IS NULL OR glass_type IN ('laminated', 'tempered'));

ALTER TABLE body_glass ADD CONSTRAINT chk_bg_manufacturer_mark
  CHECK (manufacturer_mark IS NULL OR manufacturer_mark IN (
    'AS1', 'AS2', 'AS3', 'AS4', 'AS5', 'AS6',
    'AS7', 'AS8', 'AS9', 'AS10', 'AS11', 'AS12', 'AS13', 'AS14'
  ));

ALTER TABLE body_glass ADD CONSTRAINT chk_bg_seal_condition
  CHECK (seal_condition IS NULL OR seal_condition IN (
    'excellent', 'good', 'fair', 'poor', 'failed', 'missing'
  ));

ALTER TABLE body_glass ADD CONSTRAINT chk_bg_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));

ALTER TABLE body_glass ADD CONSTRAINT chk_bg_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_body_glass_vehicle ON body_glass(vehicle_id);
CREATE INDEX idx_body_glass_location ON body_glass(vehicle_id, location);

COMMENT ON TABLE body_glass IS 'Per-opening glass documentation. One row per glazing opening. Tracks date codes, manufacturer marks, and seal condition.';
COMMENT ON COLUMN body_glass.id IS 'Primary key.';
COMMENT ON COLUMN body_glass.vehicle_id IS 'FK to vehicles(id). ON DELETE CASCADE.';
COMMENT ON COLUMN body_glass.location IS 'Glazing opening: windshield, rear_glass, door_lf, door_rf, door_lr, door_rr, quarter_lf, quarter_rf, vent_lf, vent_rf.';
COMMENT ON COLUMN body_glass.glass_type IS 'Glass construction: laminated (windshield, shatterproof) or tempered (side/rear, shatters into pebbles).';
COMMENT ON COLUMN body_glass.tint IS 'Tint description, e.g. clear, light_tint, dark_tint, factory_privacy, aftermarket_35pct.';
COMMENT ON COLUMN body_glass.date_code IS 'Date code printed in the glass DOT stamp, e.g. 3Q67 for third quarter 1967.';
COMMENT ON COLUMN body_glass.manufacturer_mark IS 'AS rating stamped in the glass per ANSI Z26.1: AS1 (windshield clear), AS2 (side/rear clear), AS3 (privacy), through AS14.';
COMMENT ON COLUMN body_glass.seal_condition IS 'Condition of the perimeter seal/weatherstrip: excellent, good, fair, poor, failed, missing.';
COMMENT ON COLUMN body_glass.is_original IS 'True if this is the factory-installed glass for this opening.';
COMMENT ON COLUMN body_glass.condition_grade IS 'Glass condition: excellent, good, fair, poor (cracks/chips), failed (broken), unknown.';
COMMENT ON COLUMN body_glass.condition_notes IS 'Freeform notes, e.g. small chip at lower right, star crack 3 inches from center.';
COMMENT ON COLUMN body_glass.provenance IS 'Glass origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN body_glass.provenance_detail IS 'Detailed provenance: manufacturer name, replacement date.';
COMMENT ON COLUMN body_glass.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN body_glass.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 4. BODY_TRIM_CHROME — per-piece exterior trim documentation
-- ============================================================

CREATE TABLE body_trim_chrome (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Piece identity
  location TEXT NOT NULL,
  piece_type TEXT,
  description TEXT,

  -- Condition
  pitting_grade TEXT,
  original_yn BOOLEAN,

  -- Standard state columns
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE body_trim_chrome ADD CONSTRAINT chk_btc_piece_type
  CHECK (piece_type IS NULL OR piece_type IN (
    'chrome', 'stainless', 'aluminum', 'anodized', 'plastic', 'rubber'
  ));

ALTER TABLE body_trim_chrome ADD CONSTRAINT chk_btc_pitting_grade
  CHECK (pitting_grade IS NULL OR pitting_grade IN (
    'none', 'light', 'moderate', 'heavy', 'pitted_through'
  ));

ALTER TABLE body_trim_chrome ADD CONSTRAINT chk_btc_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));

ALTER TABLE body_trim_chrome ADD CONSTRAINT chk_btc_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_body_trim_vehicle ON body_trim_chrome(vehicle_id);

COMMENT ON TABLE body_trim_chrome IS 'Per-piece exterior trim and chrome documentation. One row per distinct trim piece. Tracks pitting, originality, and material.';
COMMENT ON COLUMN body_trim_chrome.id IS 'Primary key.';
COMMENT ON COLUMN body_trim_chrome.vehicle_id IS 'FK to vehicles(id). ON DELETE CASCADE.';
COMMENT ON COLUMN body_trim_chrome.location IS 'Freeform location description, e.g. windshield_surround, door_sill_lf, trunk_lid_script.';
COMMENT ON COLUMN body_trim_chrome.piece_type IS 'Material/finish type: chrome, stainless, aluminum, anodized, plastic, rubber.';
COMMENT ON COLUMN body_trim_chrome.description IS 'Part name or description, e.g. drip rail molding, belt line trim, body side molding.';
COMMENT ON COLUMN body_trim_chrome.pitting_grade IS 'Chrome/metal pitting severity: none, light, moderate, heavy, pitted_through (base metal exposed).';
COMMENT ON COLUMN body_trim_chrome.original_yn IS 'True if this specific piece is original to the vehicle (not reproduced or replacement).';
COMMENT ON COLUMN body_trim_chrome.is_original IS 'True if this trim piece was factory-installed on this vehicle.';
COMMENT ON COLUMN body_trim_chrome.condition_grade IS 'Overall condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN body_trim_chrome.condition_notes IS 'Freeform condition details, e.g. light surface rust at clip holes, polished to bright.';
COMMENT ON COLUMN body_trim_chrome.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN body_trim_chrome.provenance_detail IS 'Detailed provenance info: manufacturer, part number, replating shop.';
COMMENT ON COLUMN body_trim_chrome.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN body_trim_chrome.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 5. BODY_WEATHERSTRIPPING — per-location seals
-- ============================================================

CREATE TABLE body_weatherstripping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Location identity
  location TEXT NOT NULL,

  -- Characteristics
  manufacturer TEXT,
  material TEXT,

  -- Standard state columns
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE body_weatherstripping ADD CONSTRAINT chk_bws_location
  CHECK (location IN (
    'door_lf', 'door_rf', 'door_lr', 'door_rr',
    'windshield', 'rear_glass', 'trunk',
    'cowl',
    'roof_rail_lf', 'roof_rail_rf',
    'vent_window_lf', 'vent_window_rf'
  ));

ALTER TABLE body_weatherstripping ADD CONSTRAINT chk_bws_material
  CHECK (material IS NULL OR material IN ('rubber', 'foam', 'felt'));

ALTER TABLE body_weatherstripping ADD CONSTRAINT chk_bws_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));

ALTER TABLE body_weatherstripping ADD CONSTRAINT chk_bws_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_body_weather_vehicle ON body_weatherstripping(vehicle_id);
CREATE INDEX idx_body_weather_location ON body_weatherstripping(vehicle_id, location);

COMMENT ON TABLE body_weatherstripping IS 'Per-location weatherstripping documentation. One row per seal location. Tracks material, manufacturer, and condition.';
COMMENT ON COLUMN body_weatherstripping.id IS 'Primary key.';
COMMENT ON COLUMN body_weatherstripping.vehicle_id IS 'FK to vehicles(id). ON DELETE CASCADE.';
COMMENT ON COLUMN body_weatherstripping.location IS 'Seal location: door_lf, door_rf, door_lr, door_rr, windshield, rear_glass, trunk, cowl, roof_rail_lf, roof_rail_rf, vent_window_lf, vent_window_rf.';
COMMENT ON COLUMN body_weatherstripping.manufacturer IS 'Weatherstripping manufacturer, e.g. GM, Metro Molded Parts, Steele Rubber.';
COMMENT ON COLUMN body_weatherstripping.material IS 'Seal material: rubber (EPDM or natural), foam, felt.';
COMMENT ON COLUMN body_weatherstripping.is_original IS 'True if this is the factory-installed weatherstripping.';
COMMENT ON COLUMN body_weatherstripping.condition_grade IS 'Condition: excellent, good, fair, poor (hard/cracked), failed (leaking), unknown.';
COMMENT ON COLUMN body_weatherstripping.condition_notes IS 'Freeform condition notes, e.g. cracked at lower corner, leaks at highway speed.';
COMMENT ON COLUMN body_weatherstripping.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN body_weatherstripping.provenance_detail IS 'Detailed provenance: part number, date installed.';
COMMENT ON COLUMN body_weatherstripping.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN body_weatherstripping.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 6. BODY_BUMPERS — front and rear bumper assemblies
-- ============================================================

CREATE TABLE body_bumpers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Position
  position TEXT NOT NULL,

  -- Characteristics
  bumper_type TEXT,
  material TEXT,
  energy_absorber TEXT,
  brackets_condition TEXT,
  guards_overriders TEXT,

  -- Standard state columns
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE body_bumpers ADD CONSTRAINT chk_bb_position
  CHECK (position IN ('front', 'rear'));

ALTER TABLE body_bumpers ADD CONSTRAINT chk_bb_type
  CHECK (bumper_type IS NULL OR bumper_type IN (
    'chrome', 'urethane', 'painted', 'steel', 'aluminum'
  ));

ALTER TABLE body_bumpers ADD CONSTRAINT chk_bb_material
  CHECK (material IS NULL OR material IN (
    'chrome_steel', 'stainless_steel', 'aluminum', 'urethane', 'fiberglass', 'abs_plastic', 'other'
  ));

ALTER TABLE body_bumpers ADD CONSTRAINT chk_bb_brackets_condition
  CHECK (brackets_condition IS NULL OR brackets_condition IN (
    'excellent', 'good', 'fair', 'poor', 'failed', 'missing'
  ));

ALTER TABLE body_bumpers ADD CONSTRAINT chk_bb_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));

ALTER TABLE body_bumpers ADD CONSTRAINT chk_bb_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_body_bumpers_vehicle ON body_bumpers(vehicle_id);
CREATE INDEX idx_body_bumpers_position ON body_bumpers(vehicle_id, position);

COMMENT ON TABLE body_bumpers IS 'Front and rear bumper assembly documentation. One row per bumper position.';
COMMENT ON COLUMN body_bumpers.id IS 'Primary key.';
COMMENT ON COLUMN body_bumpers.vehicle_id IS 'FK to vehicles(id). ON DELETE CASCADE.';
COMMENT ON COLUMN body_bumpers.position IS 'Bumper position: front or rear.';
COMMENT ON COLUMN body_bumpers.bumper_type IS 'Bumper design type: chrome, urethane, painted, steel, aluminum.';
COMMENT ON COLUMN body_bumpers.material IS 'Bumper face material: chrome_steel, stainless_steel, aluminum, urethane, fiberglass, abs_plastic, other.';
COMMENT ON COLUMN body_bumpers.energy_absorber IS 'Energy absorber / isolator description, e.g. none, rubber_bellows, hydraulic_5mph, foam.';
COMMENT ON COLUMN body_bumpers.brackets_condition IS 'Condition of mounting brackets: excellent, good, fair, poor, failed, missing.';
COMMENT ON COLUMN body_bumpers.guards_overriders IS 'Description of guards or overriders, e.g. none, factory_rubber_guards, euro_overriders.';
COMMENT ON COLUMN body_bumpers.is_original IS 'True if factory-installed bumper.';
COMMENT ON COLUMN body_bumpers.condition_grade IS 'Overall condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN body_bumpers.condition_notes IS 'Freeform condition details, e.g. light pitting at corners, straightened impact damage.';
COMMENT ON COLUMN body_bumpers.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN body_bumpers.provenance_detail IS 'Detailed provenance: replating shop, part number, date.';
COMMENT ON COLUMN body_bumpers.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN body_bumpers.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 7. BODY_LIGHTING — per-location lighting documentation
-- ============================================================

CREATE TABLE body_lighting (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Light identity
  location TEXT NOT NULL,
  light_type TEXT,

  -- Condition
  housing_condition TEXT,
  lens_condition TEXT,

  -- Standard state columns
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE body_lighting ADD CONSTRAINT chk_bl_location
  CHECK (location IN (
    'headlight_lf', 'headlight_rf',
    'tail_lf', 'tail_rf',
    'turn_front_lf', 'turn_front_rf',
    'turn_rear_lf', 'turn_rear_rf',
    'marker_front_lf', 'marker_front_rf',
    'marker_rear_lf', 'marker_rear_rf',
    'reverse_lf', 'reverse_rf',
    'fog_lf', 'fog_rf',
    'third_brake',
    'license_plate'
  ));

ALTER TABLE body_lighting ADD CONSTRAINT chk_bl_light_type
  CHECK (light_type IS NULL OR light_type IN (
    'sealed_beam', 'halogen', 'hid', 'led', 'incandescent'
  ));

ALTER TABLE body_lighting ADD CONSTRAINT chk_bl_housing_condition
  CHECK (housing_condition IS NULL OR housing_condition IN (
    'excellent', 'good', 'fair', 'poor', 'failed', 'missing'
  ));

ALTER TABLE body_lighting ADD CONSTRAINT chk_bl_lens_condition
  CHECK (lens_condition IS NULL OR lens_condition IN (
    'excellent', 'good', 'fair', 'poor', 'failed', 'missing'
  ));

ALTER TABLE body_lighting ADD CONSTRAINT chk_bl_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));

ALTER TABLE body_lighting ADD CONSTRAINT chk_bl_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_body_lighting_vehicle ON body_lighting(vehicle_id);
CREATE INDEX idx_body_lighting_location ON body_lighting(vehicle_id, location);

COMMENT ON TABLE body_lighting IS 'Per-location exterior lighting documentation. One row per light position. Tracks bulb type, housing, and lens condition separately.';
COMMENT ON COLUMN body_lighting.id IS 'Primary key.';
COMMENT ON COLUMN body_lighting.vehicle_id IS 'FK to vehicles(id). ON DELETE CASCADE.';
COMMENT ON COLUMN body_lighting.location IS 'Light position: headlight_lf, headlight_rf, tail_lf, tail_rf, turn_front_lf, turn_front_rf, turn_rear_lf, turn_rear_rf, marker_front_lf, marker_front_rf, marker_rear_lf, marker_rear_rf, reverse_lf, reverse_rf, fog_lf, fog_rf, third_brake, license_plate.';
COMMENT ON COLUMN body_lighting.light_type IS 'Light source technology: sealed_beam, halogen, hid (xenon), led, incandescent.';
COMMENT ON COLUMN body_lighting.housing_condition IS 'Condition of the light housing/bucket: excellent, good, fair, poor, failed, missing.';
COMMENT ON COLUMN body_lighting.lens_condition IS 'Condition of the lens: excellent, good (light fade), fair (hazing), poor (cracked), failed (broken), missing.';
COMMENT ON COLUMN body_lighting.is_original IS 'True if factory-installed lighting assembly.';
COMMENT ON COLUMN body_lighting.condition_grade IS 'Overall condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN body_lighting.condition_notes IS 'Freeform condition notes, e.g. date-correct sealed beam, aftermarket LED retrofit.';
COMMENT ON COLUMN body_lighting.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN body_lighting.provenance_detail IS 'Detailed provenance: part number, manufacturer, date installed.';
COMMENT ON COLUMN body_lighting.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN body_lighting.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 8. BODY_MIRRORS — per-side exterior mirror documentation
-- ============================================================

CREATE TABLE body_mirrors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Mirror identity
  side TEXT NOT NULL,

  -- Characteristics
  mirror_type TEXT,
  finish TEXT,

  -- Standard state columns
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE body_mirrors ADD CONSTRAINT chk_bm_side
  CHECK (side IN ('left', 'right', 'center'));

ALTER TABLE body_mirrors ADD CONSTRAINT chk_bm_mirror_type
  CHECK (mirror_type IS NULL OR mirror_type IN (
    'manual', 'power', 'heated', 'auto_dimming'
  ));

ALTER TABLE body_mirrors ADD CONSTRAINT chk_bm_finish
  CHECK (finish IS NULL OR finish IN (
    'chrome', 'painted', 'stainless', 'black_plastic', 'body_color'
  ));

ALTER TABLE body_mirrors ADD CONSTRAINT chk_bm_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));

ALTER TABLE body_mirrors ADD CONSTRAINT chk_bm_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_body_mirrors_vehicle ON body_mirrors(vehicle_id);

COMMENT ON TABLE body_mirrors IS 'Per-side exterior mirror documentation. One row per mirror. Tracks type, finish, and condition.';
COMMENT ON COLUMN body_mirrors.id IS 'Primary key.';
COMMENT ON COLUMN body_mirrors.vehicle_id IS 'FK to vehicles(id). ON DELETE CASCADE.';
COMMENT ON COLUMN body_mirrors.side IS 'Mirror position: left (driver), right (passenger), center (rear-view if exterior).';
COMMENT ON COLUMN body_mirrors.mirror_type IS 'Adjustment mechanism: manual (remote cable or direct), power (electric motor), heated, auto_dimming.';
COMMENT ON COLUMN body_mirrors.finish IS 'Mirror housing finish: chrome, painted, stainless, black_plastic, body_color.';
COMMENT ON COLUMN body_mirrors.is_original IS 'True if factory-installed mirror.';
COMMENT ON COLUMN body_mirrors.condition_grade IS 'Overall condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN body_mirrors.condition_notes IS 'Freeform condition notes, e.g. glass cracked, housing faded, bracket bent.';
COMMENT ON COLUMN body_mirrors.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN body_mirrors.provenance_detail IS 'Detailed provenance: part number, manufacturer.';
COMMENT ON COLUMN body_mirrors.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN body_mirrors.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 9. BODY_EMBLEMS_BADGES — per-piece badges and insignia
-- ============================================================

CREATE TABLE body_emblems_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Badge identity
  location TEXT NOT NULL,
  badge_type TEXT,
  text_content TEXT,
  original_yn BOOLEAN,

  -- Standard state columns
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE body_emblems_badges ADD CONSTRAINT chk_beb_badge_type
  CHECK (badge_type IS NULL OR badge_type IN (
    'emblem', 'nameplate', 'badge', 'stripe', 'decal', 'pinstripe'
  ));

ALTER TABLE body_emblems_badges ADD CONSTRAINT chk_beb_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));

ALTER TABLE body_emblems_badges ADD CONSTRAINT chk_beb_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_body_emblems_vehicle ON body_emblems_badges(vehicle_id);

COMMENT ON TABLE body_emblems_badges IS 'Per-piece exterior badge, emblem, stripe, and decal documentation. One row per distinct piece.';
COMMENT ON COLUMN body_emblems_badges.id IS 'Primary key.';
COMMENT ON COLUMN body_emblems_badges.vehicle_id IS 'FK to vehicles(id). ON DELETE CASCADE.';
COMMENT ON COLUMN body_emblems_badges.location IS 'Freeform location, e.g. hood_nose, front_fender_lf, trunk_lid_center, door_sill.';
COMMENT ON COLUMN body_emblems_badges.badge_type IS 'Badge category: emblem (3D plastic/metal), nameplate (flat script), badge (flat graphic), stripe (body stripe), decal (adhesive graphic), pinstripe.';
COMMENT ON COLUMN body_emblems_badges.text_content IS 'Text or model designation on the badge, e.g. SS 396, Mustang, GT350.';
COMMENT ON COLUMN body_emblems_badges.original_yn IS 'True if this specific piece is original to the vehicle, not a reproduction or aftermarket replacement.';
COMMENT ON COLUMN body_emblems_badges.is_original IS 'True if this badge was factory-installed on this vehicle.';
COMMENT ON COLUMN body_emblems_badges.condition_grade IS 'Overall condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN body_emblems_badges.condition_notes IS 'Freeform condition notes, e.g. letters intact, chrome worn at edges, one letter missing.';
COMMENT ON COLUMN body_emblems_badges.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN body_emblems_badges.provenance_detail IS 'Detailed provenance: manufacturer, part number, date acquired.';
COMMENT ON COLUMN body_emblems_badges.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN body_emblems_badges.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 10. BODY_CONVERTIBLE_TOPS — soft top and power top documentation
-- ============================================================

CREATE TABLE body_convertible_tops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Top characteristics
  top_type TEXT,
  material TEXT,
  frame_material TEXT,
  window_type TEXT,

  -- Component conditions
  frame_condition TEXT,
  hydraulic_condition TEXT,
  liner_condition TEXT,

  -- Standard state columns
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE body_convertible_tops ADD CONSTRAINT chk_bct_top_type
  CHECK (top_type IS NULL OR top_type IN ('manual', 'power'));

ALTER TABLE body_convertible_tops ADD CONSTRAINT chk_bct_material
  CHECK (material IS NULL OR material IN (
    'vinyl', 'canvas', 'cloth', 'mohair'
  ));

ALTER TABLE body_convertible_tops ADD CONSTRAINT chk_bct_frame_material
  CHECK (frame_material IS NULL OR frame_material IN (
    'steel', 'aluminum', 'composite'
  ));

ALTER TABLE body_convertible_tops ADD CONSTRAINT chk_bct_window_type
  CHECK (window_type IS NULL OR window_type IN ('glass', 'plastic'));

ALTER TABLE body_convertible_tops ADD CONSTRAINT chk_bct_frame_condition
  CHECK (frame_condition IS NULL OR frame_condition IN (
    'excellent', 'good', 'fair', 'poor', 'failed'
  ));

ALTER TABLE body_convertible_tops ADD CONSTRAINT chk_bct_hydraulic_condition
  CHECK (hydraulic_condition IS NULL OR hydraulic_condition IN (
    'excellent', 'good', 'fair', 'poor', 'failed', 'not_equipped'
  ));

ALTER TABLE body_convertible_tops ADD CONSTRAINT chk_bct_liner_condition
  CHECK (liner_condition IS NULL OR liner_condition IN (
    'excellent', 'good', 'fair', 'poor', 'failed', 'missing'
  ));

ALTER TABLE body_convertible_tops ADD CONSTRAINT chk_bct_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));

ALTER TABLE body_convertible_tops ADD CONSTRAINT chk_bct_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_body_conv_tops_vehicle ON body_convertible_tops(vehicle_id);

COMMENT ON TABLE body_convertible_tops IS 'Convertible soft top documentation. One row per top assembly. Documents frame, material, window type, and hydraulic condition.';
COMMENT ON COLUMN body_convertible_tops.id IS 'Primary key.';
COMMENT ON COLUMN body_convertible_tops.vehicle_id IS 'FK to vehicles(id). ON DELETE CASCADE.';
COMMENT ON COLUMN body_convertible_tops.top_type IS 'Operation type: manual (hand-lowered) or power (hydraulic/electric).';
COMMENT ON COLUMN body_convertible_tops.material IS 'Top fabric: vinyl, canvas, cloth, mohair. Mohair is highest-grade wool cloth.';
COMMENT ON COLUMN body_convertible_tops.frame_material IS 'Folding frame material: steel, aluminum, composite.';
COMMENT ON COLUMN body_convertible_tops.window_type IS 'Rear window material: glass (hard, zips or bonded) or plastic (flexible vinyl).';
COMMENT ON COLUMN body_convertible_tops.frame_condition IS 'Condition of the folding frame mechanism: excellent, good, fair, poor, failed.';
COMMENT ON COLUMN body_convertible_tops.hydraulic_condition IS 'Condition of the hydraulic system (power tops only): excellent, good, fair, poor, failed, not_equipped.';
COMMENT ON COLUMN body_convertible_tops.liner_condition IS 'Condition of the headliner inside the top: excellent, good, fair, poor, failed, missing.';
COMMENT ON COLUMN body_convertible_tops.is_original IS 'True if this is the factory-installed top.';
COMMENT ON COLUMN body_convertible_tops.condition_grade IS 'Overall top condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN body_convertible_tops.condition_notes IS 'Freeform notes, e.g. crease at header bow, plastic window yellowed, new top installed 2022.';
COMMENT ON COLUMN body_convertible_tops.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN body_convertible_tops.provenance_detail IS 'Detailed provenance: manufacturer, installer, date.';
COMMENT ON COLUMN body_convertible_tops.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN body_convertible_tops.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 11. TRUCK_BEDS — pickup truck bed documentation
-- ============================================================

CREATE TABLE truck_beds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Bed specification
  bed_length_inches NUMERIC(5,1),
  material TEXT,

  -- Equipment
  liner_type TEXT,
  toolbox_yn BOOLEAN,
  tonneau_type TEXT,

  -- Component conditions
  bed_floor_condition TEXT,
  wheel_well_condition TEXT,
  tailgate_condition TEXT,
  stake_pocket_condition TEXT,

  -- Standard state columns
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE truck_beds ADD CONSTRAINT chk_tb_material
  CHECK (material IS NULL OR material IN ('steel', 'aluminum', 'composite'));

ALTER TABLE truck_beds ADD CONSTRAINT chk_tb_liner_type
  CHECK (liner_type IS NULL OR liner_type IN (
    'none', 'spray_in', 'drop_in', 'wood'
  ));

ALTER TABLE truck_beds ADD CONSTRAINT chk_tb_tonneau_type
  CHECK (tonneau_type IS NULL OR tonneau_type IN (
    'none', 'soft_roll_up', 'hard_fold', 'retractable', 'hinged_fiberglass', 'camper_shell'
  ));

ALTER TABLE truck_beds ADD CONSTRAINT chk_tb_bed_length
  CHECK (bed_length_inches IS NULL OR (bed_length_inches > 0 AND bed_length_inches < 200));

ALTER TABLE truck_beds ADD CONSTRAINT chk_tb_bed_floor_condition
  CHECK (bed_floor_condition IS NULL OR bed_floor_condition IN (
    'excellent', 'good', 'fair', 'poor', 'failed'
  ));

ALTER TABLE truck_beds ADD CONSTRAINT chk_tb_wheel_well_condition
  CHECK (wheel_well_condition IS NULL OR wheel_well_condition IN (
    'excellent', 'good', 'fair', 'poor', 'failed'
  ));

ALTER TABLE truck_beds ADD CONSTRAINT chk_tb_tailgate_condition
  CHECK (tailgate_condition IS NULL OR tailgate_condition IN (
    'excellent', 'good', 'fair', 'poor', 'failed', 'missing'
  ));

ALTER TABLE truck_beds ADD CONSTRAINT chk_tb_stake_pocket_condition
  CHECK (stake_pocket_condition IS NULL OR stake_pocket_condition IN (
    'excellent', 'good', 'fair', 'poor', 'damaged', 'missing'
  ));

ALTER TABLE truck_beds ADD CONSTRAINT chk_tb_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));

ALTER TABLE truck_beds ADD CONSTRAINT chk_tb_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

CREATE INDEX idx_truck_beds_vehicle ON truck_beds(vehicle_id);

COMMENT ON TABLE truck_beds IS 'Pickup truck bed documentation. One row per bed. Applicable only to trucks with a separate cargo bed.';
COMMENT ON COLUMN truck_beds.id IS 'Primary key.';
COMMENT ON COLUMN truck_beds.vehicle_id IS 'FK to vehicles(id). ON DELETE CASCADE.';
COMMENT ON COLUMN truck_beds.bed_length_inches IS 'Inside bed length in inches, e.g. 78.0 for long bed, 61.8 for short bed.';
COMMENT ON COLUMN truck_beds.material IS 'Bed material: steel, aluminum, composite.';
COMMENT ON COLUMN truck_beds.liner_type IS 'Bed liner type: none, spray_in (Rhino, Line-X), drop_in (plastic), wood (traditional planks).';
COMMENT ON COLUMN truck_beds.toolbox_yn IS 'True if a toolbox is installed.';
COMMENT ON COLUMN truck_beds.tonneau_type IS 'Cover type: none, soft_roll_up, hard_fold, retractable, hinged_fiberglass, camper_shell.';
COMMENT ON COLUMN truck_beds.bed_floor_condition IS 'Condition of the bed floor/deck: excellent, good, fair, poor, failed.';
COMMENT ON COLUMN truck_beds.wheel_well_condition IS 'Condition of the inner wheel well panels: excellent, good, fair, poor, failed.';
COMMENT ON COLUMN truck_beds.tailgate_condition IS 'Condition of the tailgate: excellent, good, fair, poor, failed, missing.';
COMMENT ON COLUMN truck_beds.stake_pocket_condition IS 'Condition of the stake pockets: excellent, good, fair, poor, damaged, missing.';
COMMENT ON COLUMN truck_beds.is_original IS 'True if factory-installed bed.';
COMMENT ON COLUMN truck_beds.condition_grade IS 'Overall bed condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN truck_beds.condition_notes IS 'Freeform notes, e.g. surface rust at drain holes, wood floor replaced, spray-in liner concealing rust.';
COMMENT ON COLUMN truck_beds.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN truck_beds.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN truck_beds.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN truck_beds.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 12. BODY_STRUCTURE — frame, unibody, and structural documentation
-- ============================================================

CREATE TABLE body_structure (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Frame specification
  frame_type TEXT,
  frame_material TEXT,

  -- Structural condition
  frame_condition TEXT,
  rust_locations_jsonb JSONB DEFAULT '[]',
  repair_history TEXT,
  reinforcements TEXT,
  subframe_connectors TEXT,
  body_mount_condition TEXT,

  -- Standard state columns
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE body_structure ADD CONSTRAINT chk_bs_frame_type
  CHECK (frame_type IS NULL OR frame_type IN (
    'unibody', 'body_on_frame', 'space_frame', 'tube_frame'
  ));

ALTER TABLE body_structure ADD CONSTRAINT chk_bs_frame_material
  CHECK (frame_material IS NULL OR frame_material IN (
    'steel', 'aluminum', 'carbon_fiber', 'chrome_moly', 'mild_steel', 'other'
  ));

ALTER TABLE body_structure ADD CONSTRAINT chk_bs_frame_condition
  CHECK (frame_condition IS NULL OR frame_condition IN (
    'excellent', 'good', 'fair', 'poor', 'failed'
  ));

ALTER TABLE body_structure ADD CONSTRAINT chk_bs_body_mount_condition
  CHECK (body_mount_condition IS NULL OR body_mount_condition IN (
    'excellent', 'good', 'fair', 'poor', 'failed', 'not_applicable'
  ));

ALTER TABLE body_structure ADD CONSTRAINT chk_bs_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));

ALTER TABLE body_structure ADD CONSTRAINT chk_bs_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));

ALTER TABLE body_structure ADD CONSTRAINT chk_bs_rust_locations_is_array
  CHECK (jsonb_typeof(rust_locations_jsonb) = 'array');

CREATE INDEX idx_body_structure_vehicle ON body_structure(vehicle_id);

COMMENT ON TABLE body_structure IS 'Vehicle structural and frame documentation. One row per vehicle. Covers frame type, rust locations, repairs, and body mounts.';
COMMENT ON COLUMN body_structure.id IS 'Primary key.';
COMMENT ON COLUMN body_structure.vehicle_id IS 'FK to vehicles(id). ON DELETE CASCADE.';
COMMENT ON COLUMN body_structure.frame_type IS 'Construction type: unibody (integrated body/frame), body_on_frame (separate), space_frame (exoskeleton), tube_frame (race/kit).';
COMMENT ON COLUMN body_structure.frame_material IS 'Primary frame material: steel, aluminum, carbon_fiber, chrome_moly, mild_steel, other.';
COMMENT ON COLUMN body_structure.frame_condition IS 'Overall structural condition: excellent, good, fair, poor, failed.';
COMMENT ON COLUMN body_structure.rust_locations_jsonb IS 'JSON array of rust location objects. Each object: {location: string, severity: none|surface|bubbling|perforation|structural, notes: string}.';
COMMENT ON COLUMN body_structure.repair_history IS 'Freeform description of known structural repairs, e.g. frame straightened 1998, welded cab corners 2010.';
COMMENT ON COLUMN body_structure.reinforcements IS 'Description of any structural reinforcements added beyond factory, e.g. roll cage, frame boxing, subframe connector weld-in.';
COMMENT ON COLUMN body_structure.subframe_connectors IS 'Subframe connector description: none, bolt_in_brand, weld_in_brand, factory. Relevant to unibody vehicles.';
COMMENT ON COLUMN body_structure.body_mount_condition IS 'Condition of body-to-frame mounts (body-on-frame only): excellent, good, fair, poor, failed, not_applicable.';
COMMENT ON COLUMN body_structure.is_original IS 'True if the structure is unmodified from factory specification.';
COMMENT ON COLUMN body_structure.condition_grade IS 'Overall structural condition grade: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN body_structure.condition_notes IS 'Freeform structural notes, e.g. factory floor pans intact, no evidence of collision repair per frame inspection.';
COMMENT ON COLUMN body_structure.provenance IS 'Structure origin (relevant if frame replaced): original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN body_structure.provenance_detail IS 'Detailed provenance if structure was replaced or significantly modified.';
COMMENT ON COLUMN body_structure.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN body_structure.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- UPDATED_AT TRIGGERS
-- Uses the shared digital_twin_set_updated_at() function
-- created by digital_twin_engine_subsystem.sql.
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'body_panels',
    'paint_systems',
    'body_glass',
    'body_trim_chrome',
    'body_weatherstripping',
    'body_bumpers',
    'body_lighting',
    'body_mirrors',
    'body_emblems_badges',
    'body_convertible_tops',
    'truck_beds',
    'body_structure'
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
    'body_panels',
    'paint_systems',
    'body_glass',
    'body_trim_chrome',
    'body_weatherstripping',
    'body_bumpers',
    'body_lighting',
    'body_mirrors',
    'body_emblems_badges',
    'body_convertible_tops',
    'truck_beds',
    'body_structure'
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
