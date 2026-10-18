-- ============================================================
-- DIGITAL TWIN: Engine Subsystem DDL
-- First implementation of Entity-Attribute-Value at Total Resolution
--
-- Architecture:
--   Every component gets a spec table with factory specification,
--   condition grade, provenance, and originality tracking.
--   Work events are logged via component_events referencing actors.
--   Evidence linking uses the existing field_evidence table.
--
-- Pattern: This migration establishes the reference implementation
-- that will be replicated for transmission, suspension, brakes, etc.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. ACTORS — people and organizations who do work
--    Shared across ALL subsystems (engine, trans, suspension, etc.)
-- ============================================================

CREATE TABLE actors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type TEXT NOT NULL,
  name TEXT NOT NULL,
  organization_name TEXT,
  parent_actor_id UUID REFERENCES actors(id),
  location TEXT,
  city TEXT,
  state TEXT,
  country TEXT DEFAULT 'US',
  specialties TEXT[],
  certifications TEXT[],
  trust_score INTEGER,
  website TEXT,
  phone TEXT,
  email TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE actors ADD CONSTRAINT chk_actor_type
  CHECK (actor_type IN (
    'individual', 'shop', 'dealer', 'factory', 'inspector',
    'auction_house', 'parts_supplier', 'machine_shop', 'owner'
  ));

ALTER TABLE actors ADD CONSTRAINT chk_actor_trust_score
  CHECK (trust_score IS NULL OR (trust_score >= 0 AND trust_score <= 100));

COMMENT ON TABLE actors IS 'People and organizations who perform work on vehicles. Shared across all digital twin subsystems.';
COMMENT ON COLUMN actors.id IS 'Primary key.';
COMMENT ON COLUMN actors.actor_type IS 'Category: individual, shop, dealer, factory, inspector, auction_house, parts_supplier, machine_shop, owner.';
COMMENT ON COLUMN actors.name IS 'Display name of the actor (person or business).';
COMMENT ON COLUMN actors.organization_name IS 'Legal or trade name of the organization, if different from name.';
COMMENT ON COLUMN actors.parent_actor_id IS 'Self-referencing FK for employee-of or franchise-of relationships.';
COMMENT ON COLUMN actors.location IS 'Freeform location string (address or description).';
COMMENT ON COLUMN actors.city IS 'City for structured location queries.';
COMMENT ON COLUMN actors.state IS 'State/province for structured location queries.';
COMMENT ON COLUMN actors.country IS 'ISO country code, defaults to US.';
COMMENT ON COLUMN actors.specialties IS 'Array of specialization tags, e.g. {small_block_chevy, concours_restoration}.';
COMMENT ON COLUMN actors.certifications IS 'Array of certifications, e.g. {ase_master, ncrs_judge}.';
COMMENT ON COLUMN actors.trust_score IS 'Platform trust rating 0-100. NULL means unrated.';
COMMENT ON COLUMN actors.website IS 'Actor website URL.';
COMMENT ON COLUMN actors.phone IS 'Contact phone number.';
COMMENT ON COLUMN actors.email IS 'Contact email address.';
COMMENT ON COLUMN actors.notes IS 'Freeform notes about this actor.';
COMMENT ON COLUMN actors.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN actors.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 2. COMPONENT_EVENTS — universal work log
--    Every install, removal, rebuild, inspection gets logged here.
--    Shared across ALL subsystems.
-- ============================================================

CREATE TABLE component_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  component_table TEXT NOT NULL,
  component_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  actor_id UUID REFERENCES actors(id),
  event_date DATE,
  event_date_approximate BOOLEAN DEFAULT FALSE,
  mileage_at_event INTEGER,
  location TEXT,
  description TEXT,
  cost_cents INTEGER,
  currency TEXT DEFAULT 'USD',
  invoice_reference TEXT,
  evidence_ids UUID[],
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE component_events ADD CONSTRAINT chk_event_type
  CHECK (event_type IN (
    'installed', 'removed', 'rebuilt', 'inspected', 'modified',
    'repaired', 'replaced', 'cleaned', 'painted', 'tested',
    'measured', 'adjusted', 'condemned', 'sourced', 'purchased'
  ));

ALTER TABLE component_events ADD CONSTRAINT chk_event_mileage
  CHECK (mileage_at_event IS NULL OR mileage_at_event >= 0);

ALTER TABLE component_events ADD CONSTRAINT chk_event_cost
  CHECK (cost_cents IS NULL OR cost_cents >= 0);

CREATE INDEX idx_component_events_vehicle ON component_events(vehicle_id);
CREATE INDEX idx_component_events_component ON component_events(component_table, component_id);

COMMENT ON TABLE component_events IS 'Universal work log for all component operations. Every install, removal, rebuild, inspection is recorded here.';
COMMENT ON COLUMN component_events.id IS 'Primary key.';
COMMENT ON COLUMN component_events.vehicle_id IS 'FK to vehicles(id). The vehicle this event pertains to.';
COMMENT ON COLUMN component_events.component_table IS 'Name of the component table, e.g. engine_blocks, engine_heads.';
COMMENT ON COLUMN component_events.component_id IS 'PK of the row in the component table this event references.';
COMMENT ON COLUMN component_events.event_type IS 'What happened: installed, removed, rebuilt, inspected, modified, repaired, replaced, cleaned, painted, tested, measured, adjusted, condemned, sourced, purchased.';
COMMENT ON COLUMN component_events.actor_id IS 'FK to actors(id). Who performed this work.';
COMMENT ON COLUMN component_events.event_date IS 'When the event occurred. Use event_date_approximate if unsure.';
COMMENT ON COLUMN component_events.event_date_approximate IS 'True if event_date is estimated rather than exact.';
COMMENT ON COLUMN component_events.mileage_at_event IS 'Odometer reading at time of event, if known.';
COMMENT ON COLUMN component_events.location IS 'Where the work was performed.';
COMMENT ON COLUMN component_events.description IS 'Freeform description of the work performed.';
COMMENT ON COLUMN component_events.cost_cents IS 'Cost in cents to avoid floating point. 150000 = $1,500.00.';
COMMENT ON COLUMN component_events.currency IS 'ISO 4217 currency code, defaults to USD.';
COMMENT ON COLUMN component_events.invoice_reference IS 'Invoice or receipt number for traceability.';
COMMENT ON COLUMN component_events.evidence_ids IS 'Array of field_evidence.id UUIDs that support this event.';
COMMENT ON COLUMN component_events.metadata IS 'Extensible JSON for event-specific data not covered by columns.';
COMMENT ON COLUMN component_events.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN component_events.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 3. ENGINE_BLOCKS — the core casting
-- ============================================================

CREATE TABLE engine_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Factory specification
  casting_number TEXT,
  casting_date_code TEXT,
  block_suffix TEXT,
  partial_vin TEXT,
  material TEXT,
  cylinder_count INTEGER,
  cylinder_configuration TEXT,
  bore_mm NUMERIC(6,3),
  stroke_mm NUMERIC(6,3),
  displacement_cc NUMERIC(8,1),
  displacement_ci NUMERIC(6,1),
  deck_height_mm NUMERIC(7,3),
  main_bearing_count INTEGER,
  main_cap_material TEXT,
  oiling_system TEXT,
  factory_hp INTEGER,
  factory_torque_lb_ft INTEGER,
  factory_compression_ratio NUMERIC(4,2),
  factory_rpm_rating INTEGER,

  -- Dimensional state
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE engine_blocks ADD CONSTRAINT chk_eb_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE engine_blocks ADD CONSTRAINT chk_eb_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE engine_blocks ADD CONSTRAINT chk_eb_material
  CHECK (material IS NULL OR material IN ('cast_iron', 'aluminum', 'billet_aluminum', 'other'));
ALTER TABLE engine_blocks ADD CONSTRAINT chk_eb_cylinder_config
  CHECK (cylinder_configuration IS NULL OR cylinder_configuration IN ('inline', 'v', 'flat', 'w', 'rotary'));
ALTER TABLE engine_blocks ADD CONSTRAINT chk_eb_cylinder_count
  CHECK (cylinder_count IS NULL OR (cylinder_count >= 1 AND cylinder_count <= 16));

CREATE INDEX idx_engine_blocks_vehicle ON engine_blocks(vehicle_id);

COMMENT ON TABLE engine_blocks IS 'Engine block casting specifications and current state. One row per block installed in a vehicle (current or historical).';
COMMENT ON COLUMN engine_blocks.id IS 'Primary key.';
COMMENT ON COLUMN engine_blocks.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN engine_blocks.casting_number IS 'Foundry casting number stamped on the block, e.g. 3970010 for SBC.';
COMMENT ON COLUMN engine_blocks.casting_date_code IS 'Date code on the casting, e.g. K157 = Nov 15 1967.';
COMMENT ON COLUMN engine_blocks.block_suffix IS 'Assembly suffix code indicating application, e.g. DZ for 302.';
COMMENT ON COLUMN engine_blocks.partial_vin IS 'Partial VIN stamp on block pad for matching to vehicle.';
COMMENT ON COLUMN engine_blocks.material IS 'Block material: cast_iron, aluminum, billet_aluminum, other.';
COMMENT ON COLUMN engine_blocks.cylinder_count IS 'Number of cylinders, 1-16.';
COMMENT ON COLUMN engine_blocks.cylinder_configuration IS 'Cylinder layout: inline, v, flat, w, rotary.';
COMMENT ON COLUMN engine_blocks.bore_mm IS 'Factory bore diameter in millimeters.';
COMMENT ON COLUMN engine_blocks.stroke_mm IS 'Factory stroke in millimeters.';
COMMENT ON COLUMN engine_blocks.displacement_cc IS 'Displacement in cubic centimeters.';
COMMENT ON COLUMN engine_blocks.displacement_ci IS 'Displacement in cubic inches.';
COMMENT ON COLUMN engine_blocks.deck_height_mm IS 'Block deck height in millimeters.';
COMMENT ON COLUMN engine_blocks.main_bearing_count IS 'Number of main bearings.';
COMMENT ON COLUMN engine_blocks.main_cap_material IS 'Main cap material, e.g. cast_iron, steel, billet.';
COMMENT ON COLUMN engine_blocks.oiling_system IS 'Oiling system description, e.g. full_pressure, splash.';
COMMENT ON COLUMN engine_blocks.factory_hp IS 'Factory rated horsepower.';
COMMENT ON COLUMN engine_blocks.factory_torque_lb_ft IS 'Factory rated torque in lb-ft.';
COMMENT ON COLUMN engine_blocks.factory_compression_ratio IS 'Factory compression ratio, e.g. 10.50.';
COMMENT ON COLUMN engine_blocks.factory_rpm_rating IS 'Factory rated RPM for peak HP.';
COMMENT ON COLUMN engine_blocks.is_original IS 'True if this is the factory-installed block for this vehicle.';
COMMENT ON COLUMN engine_blocks.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN engine_blocks.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN engine_blocks.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN engine_blocks.provenance_detail IS 'Detailed provenance info: manufacturer, part number, date acquired.';
COMMENT ON COLUMN engine_blocks.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN engine_blocks.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 4. ENGINE_CYLINDER_MEASUREMENTS — per-cylinder bore specs
-- ============================================================

CREATE TABLE engine_cylinder_measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  engine_block_id UUID REFERENCES engine_blocks(id) ON DELETE SET NULL,
  cylinder_number INTEGER NOT NULL,

  -- Measurements
  bore_diameter_mm NUMERIC(7,4),
  bore_taper_mm NUMERIC(6,4),
  bore_out_of_round_mm NUMERIC(6,4),
  bore_finish_ra NUMERIC(5,2),
  ring_gap_top_mm NUMERIC(5,3),
  ring_gap_second_mm NUMERIC(5,3),
  ring_gap_oil_mm NUMERIC(5,3),
  compression_psi INTEGER,
  leakdown_pct NUMERIC(4,1),
  wall_thickness_mm NUMERIC(6,3),

  -- State
  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  measured_at DATE,
  measured_by_actor_id UUID REFERENCES actors(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE engine_cylinder_measurements ADD CONSTRAINT chk_ecm_cylinder
  CHECK (cylinder_number >= 1 AND cylinder_number <= 12);
ALTER TABLE engine_cylinder_measurements ADD CONSTRAINT chk_ecm_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE engine_cylinder_measurements ADD CONSTRAINT chk_ecm_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE engine_cylinder_measurements ADD CONSTRAINT chk_ecm_leakdown
  CHECK (leakdown_pct IS NULL OR (leakdown_pct >= 0 AND leakdown_pct <= 100));

CREATE INDEX idx_engine_cyl_meas_vehicle ON engine_cylinder_measurements(vehicle_id);

COMMENT ON TABLE engine_cylinder_measurements IS 'Per-cylinder bore measurements. One row per cylinder per measurement session.';
COMMENT ON COLUMN engine_cylinder_measurements.id IS 'Primary key.';
COMMENT ON COLUMN engine_cylinder_measurements.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN engine_cylinder_measurements.engine_block_id IS 'FK to engine_blocks(id). Which block was measured.';
COMMENT ON COLUMN engine_cylinder_measurements.cylinder_number IS 'Cylinder number 1-12. Numbering per manufacturer convention.';
COMMENT ON COLUMN engine_cylinder_measurements.bore_diameter_mm IS 'Measured bore diameter in mm to ten-thousandths.';
COMMENT ON COLUMN engine_cylinder_measurements.bore_taper_mm IS 'Bore taper (top vs bottom difference) in mm.';
COMMENT ON COLUMN engine_cylinder_measurements.bore_out_of_round_mm IS 'Out-of-round measurement in mm.';
COMMENT ON COLUMN engine_cylinder_measurements.bore_finish_ra IS 'Surface finish roughness average (Ra) in microinches.';
COMMENT ON COLUMN engine_cylinder_measurements.ring_gap_top_mm IS 'Top ring end gap in mm.';
COMMENT ON COLUMN engine_cylinder_measurements.ring_gap_second_mm IS 'Second ring end gap in mm.';
COMMENT ON COLUMN engine_cylinder_measurements.ring_gap_oil_mm IS 'Oil ring end gap in mm.';
COMMENT ON COLUMN engine_cylinder_measurements.compression_psi IS 'Cranking compression test result in PSI.';
COMMENT ON COLUMN engine_cylinder_measurements.leakdown_pct IS 'Leakdown test percentage, 0-100. Lower is better.';
COMMENT ON COLUMN engine_cylinder_measurements.wall_thickness_mm IS 'Cylinder wall thickness (sonic tested) in mm.';
COMMENT ON COLUMN engine_cylinder_measurements.is_original IS 'True if cylinder is in its original un-bored state.';
COMMENT ON COLUMN engine_cylinder_measurements.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN engine_cylinder_measurements.condition_notes IS 'Freeform condition details, e.g. light scoring at 90 degrees.';
COMMENT ON COLUMN engine_cylinder_measurements.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN engine_cylinder_measurements.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN engine_cylinder_measurements.measured_at IS 'Date the measurements were taken.';
COMMENT ON COLUMN engine_cylinder_measurements.measured_by_actor_id IS 'FK to actors(id). Who performed the measurements.';
COMMENT ON COLUMN engine_cylinder_measurements.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN engine_cylinder_measurements.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 5. ENGINE_CRANKSHAFTS
-- ============================================================

CREATE TABLE engine_crankshafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  engine_block_id UUID REFERENCES engine_blocks(id) ON DELETE SET NULL,

  casting_number TEXT,
  forging_number TEXT,
  date_code TEXT,
  material TEXT,
  journal_diameter_main_mm NUMERIC(7,4),
  journal_diameter_rod_mm NUMERIC(7,4),
  stroke_mm NUMERIC(6,3),
  counterweight_count INTEGER,
  balance_type TEXT,
  flange_type TEXT,
  snout_length_mm NUMERIC(6,2),
  rear_seal_type TEXT,
  nitride_treated BOOLEAN,
  journal_finish_ra NUMERIC(5,2),

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE engine_crankshafts ADD CONSTRAINT chk_ecr_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE engine_crankshafts ADD CONSTRAINT chk_ecr_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE engine_crankshafts ADD CONSTRAINT chk_ecr_material
  CHECK (material IS NULL OR material IN ('cast_iron', 'nodular_iron', 'forged_steel', 'billet_steel', 'other'));
ALTER TABLE engine_crankshafts ADD CONSTRAINT chk_ecr_balance
  CHECK (balance_type IS NULL OR balance_type IN ('internal', 'external', 'neutral'));

CREATE INDEX idx_engine_crankshafts_vehicle ON engine_crankshafts(vehicle_id);

COMMENT ON TABLE engine_crankshafts IS 'Crankshaft specifications and condition. One row per crankshaft installed (current or historical).';
COMMENT ON COLUMN engine_crankshafts.id IS 'Primary key.';
COMMENT ON COLUMN engine_crankshafts.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN engine_crankshafts.engine_block_id IS 'FK to engine_blocks(id). Which block this crank is/was in.';
COMMENT ON COLUMN engine_crankshafts.casting_number IS 'Casting number if cast crank.';
COMMENT ON COLUMN engine_crankshafts.forging_number IS 'Forging number if forged crank.';
COMMENT ON COLUMN engine_crankshafts.date_code IS 'Date code stamped on the crank.';
COMMENT ON COLUMN engine_crankshafts.material IS 'Crank material: cast_iron, nodular_iron, forged_steel, billet_steel, other.';
COMMENT ON COLUMN engine_crankshafts.journal_diameter_main_mm IS 'Main bearing journal diameter in mm.';
COMMENT ON COLUMN engine_crankshafts.journal_diameter_rod_mm IS 'Rod bearing journal diameter in mm.';
COMMENT ON COLUMN engine_crankshafts.stroke_mm IS 'Stroke in mm. Should match block spec unless stroker.';
COMMENT ON COLUMN engine_crankshafts.counterweight_count IS 'Number of counterweights.';
COMMENT ON COLUMN engine_crankshafts.balance_type IS 'Balance type: internal, external, neutral.';
COMMENT ON COLUMN engine_crankshafts.flange_type IS 'Flywheel flange pattern description.';
COMMENT ON COLUMN engine_crankshafts.snout_length_mm IS 'Front snout length in mm for balancer fitment.';
COMMENT ON COLUMN engine_crankshafts.rear_seal_type IS 'Rear main seal type, e.g. two_piece_rope, one_piece_lip.';
COMMENT ON COLUMN engine_crankshafts.nitride_treated IS 'Whether journals are nitride-hardened.';
COMMENT ON COLUMN engine_crankshafts.journal_finish_ra IS 'Journal surface finish roughness average.';
COMMENT ON COLUMN engine_crankshafts.is_original IS 'True if factory-installed crankshaft.';
COMMENT ON COLUMN engine_crankshafts.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN engine_crankshafts.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN engine_crankshafts.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN engine_crankshafts.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN engine_crankshafts.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN engine_crankshafts.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 6. ENGINE_CONNECTING_RODS — per-rod specs
-- ============================================================

CREATE TABLE engine_connecting_rods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  engine_block_id UUID REFERENCES engine_blocks(id) ON DELETE SET NULL,
  cylinder_number INTEGER NOT NULL,

  casting_number TEXT,
  forging_number TEXT,
  material TEXT,
  center_to_center_mm NUMERIC(7,3),
  big_end_diameter_mm NUMERIC(7,4),
  small_end_diameter_mm NUMERIC(7,4),
  weight_grams NUMERIC(7,2),
  beam_type TEXT,
  bolt_type TEXT,
  is_matched_set BOOLEAN,

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE engine_connecting_rods ADD CONSTRAINT chk_erod_cylinder
  CHECK (cylinder_number >= 1 AND cylinder_number <= 12);
ALTER TABLE engine_connecting_rods ADD CONSTRAINT chk_erod_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE engine_connecting_rods ADD CONSTRAINT chk_erod_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE engine_connecting_rods ADD CONSTRAINT chk_erod_material
  CHECK (material IS NULL OR material IN ('forged_steel', 'powdered_metal', 'billet_steel', 'billet_aluminum', 'titanium', 'other'));
ALTER TABLE engine_connecting_rods ADD CONSTRAINT chk_erod_beam
  CHECK (beam_type IS NULL OR beam_type IN ('i_beam', 'h_beam', 'a_beam', 'other'));

CREATE INDEX idx_engine_rods_vehicle ON engine_connecting_rods(vehicle_id);

COMMENT ON TABLE engine_connecting_rods IS 'Per-rod connecting rod specifications. One row per rod.';
COMMENT ON COLUMN engine_connecting_rods.id IS 'Primary key.';
COMMENT ON COLUMN engine_connecting_rods.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN engine_connecting_rods.engine_block_id IS 'FK to engine_blocks(id).';
COMMENT ON COLUMN engine_connecting_rods.cylinder_number IS 'Cylinder position 1-12.';
COMMENT ON COLUMN engine_connecting_rods.casting_number IS 'Casting or forging identification number.';
COMMENT ON COLUMN engine_connecting_rods.forging_number IS 'Forging number if different from casting.';
COMMENT ON COLUMN engine_connecting_rods.material IS 'Rod material: forged_steel, powdered_metal, billet_steel, billet_aluminum, titanium, other.';
COMMENT ON COLUMN engine_connecting_rods.center_to_center_mm IS 'Center-to-center length in mm.';
COMMENT ON COLUMN engine_connecting_rods.big_end_diameter_mm IS 'Big end bore diameter in mm.';
COMMENT ON COLUMN engine_connecting_rods.small_end_diameter_mm IS 'Small end (wrist pin) bore diameter in mm.';
COMMENT ON COLUMN engine_connecting_rods.weight_grams IS 'Total rod weight in grams for balancing.';
COMMENT ON COLUMN engine_connecting_rods.beam_type IS 'Beam cross-section: i_beam, h_beam, a_beam, other.';
COMMENT ON COLUMN engine_connecting_rods.bolt_type IS 'Rod bolt type, e.g. stock_press_fit, arp_7_16, arp_3_8.';
COMMENT ON COLUMN engine_connecting_rods.is_matched_set IS 'True if rods are a weight-matched set.';
COMMENT ON COLUMN engine_connecting_rods.is_original IS 'True if factory-installed rod.';
COMMENT ON COLUMN engine_connecting_rods.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN engine_connecting_rods.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN engine_connecting_rods.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN engine_connecting_rods.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN engine_connecting_rods.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN engine_connecting_rods.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 7. ENGINE_PISTONS — per-piston specs
-- ============================================================

CREATE TABLE engine_pistons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  engine_block_id UUID REFERENCES engine_blocks(id) ON DELETE SET NULL,
  cylinder_number INTEGER NOT NULL,

  part_number TEXT,
  material TEXT,
  diameter_mm NUMERIC(7,4),
  compression_height_mm NUMERIC(6,3),
  weight_grams NUMERIC(7,2),
  dome_volume_cc NUMERIC(5,1),
  dome_type TEXT,
  ring_count INTEGER,
  wrist_pin_diameter_mm NUMERIC(6,3),
  wrist_pin_type TEXT,
  coating TEXT,
  valve_relief_count INTEGER,
  skirt_type TEXT,

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE engine_pistons ADD CONSTRAINT chk_ep_cylinder
  CHECK (cylinder_number >= 1 AND cylinder_number <= 12);
ALTER TABLE engine_pistons ADD CONSTRAINT chk_ep_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE engine_pistons ADD CONSTRAINT chk_ep_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE engine_pistons ADD CONSTRAINT chk_ep_material
  CHECK (material IS NULL OR material IN ('cast_aluminum', 'hypereutectic', 'forged_aluminum', 'billet_aluminum', 'cast_iron', 'other'));
ALTER TABLE engine_pistons ADD CONSTRAINT chk_ep_dome
  CHECK (dome_type IS NULL OR dome_type IN ('flat_top', 'dished', 'domed', 'pop_up', 'other'));
ALTER TABLE engine_pistons ADD CONSTRAINT chk_ep_pin
  CHECK (wrist_pin_type IS NULL OR wrist_pin_type IN ('pressed', 'full_floating', 'semi_floating'));

CREATE INDEX idx_engine_pistons_vehicle ON engine_pistons(vehicle_id);

COMMENT ON TABLE engine_pistons IS 'Per-piston specifications and condition. One row per piston.';
COMMENT ON COLUMN engine_pistons.id IS 'Primary key.';
COMMENT ON COLUMN engine_pistons.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN engine_pistons.engine_block_id IS 'FK to engine_blocks(id).';
COMMENT ON COLUMN engine_pistons.cylinder_number IS 'Cylinder position 1-12.';
COMMENT ON COLUMN engine_pistons.part_number IS 'Manufacturer part number.';
COMMENT ON COLUMN engine_pistons.material IS 'Piston material: cast_aluminum, hypereutectic, forged_aluminum, billet_aluminum, cast_iron, other.';
COMMENT ON COLUMN engine_pistons.diameter_mm IS 'Piston diameter in mm.';
COMMENT ON COLUMN engine_pistons.compression_height_mm IS 'Compression height (pin center to crown) in mm.';
COMMENT ON COLUMN engine_pistons.weight_grams IS 'Piston weight in grams for balancing.';
COMMENT ON COLUMN engine_pistons.dome_volume_cc IS 'Dome/dish volume in cc. Positive for dome, negative for dish.';
COMMENT ON COLUMN engine_pistons.dome_type IS 'Crown geometry: flat_top, dished, domed, pop_up, other.';
COMMENT ON COLUMN engine_pistons.ring_count IS 'Number of ring grooves.';
COMMENT ON COLUMN engine_pistons.wrist_pin_diameter_mm IS 'Wrist pin diameter in mm.';
COMMENT ON COLUMN engine_pistons.wrist_pin_type IS 'Pin retention method: pressed, full_floating, semi_floating.';
COMMENT ON COLUMN engine_pistons.coating IS 'Piston coatings applied, e.g. moly_skirt, thermal_barrier.';
COMMENT ON COLUMN engine_pistons.valve_relief_count IS 'Number of valve relief notches cut into crown.';
COMMENT ON COLUMN engine_pistons.skirt_type IS 'Skirt style, e.g. full_skirt, slipper.';
COMMENT ON COLUMN engine_pistons.is_original IS 'True if factory-installed piston.';
COMMENT ON COLUMN engine_pistons.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN engine_pistons.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN engine_pistons.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN engine_pistons.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN engine_pistons.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN engine_pistons.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 8. ENGINE_HEADS — per-head casting and port specs
-- ============================================================

CREATE TABLE engine_heads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  engine_block_id UUID REFERENCES engine_blocks(id) ON DELETE SET NULL,
  side TEXT NOT NULL,

  casting_number TEXT,
  casting_date_code TEXT,
  material TEXT,
  chamber_volume_cc NUMERIC(5,1),
  intake_port_volume_cc NUMERIC(5,1),
  exhaust_port_volume_cc NUMERIC(5,1),
  intake_valve_diameter_mm NUMERIC(6,3),
  exhaust_valve_diameter_mm NUMERIC(6,3),
  valve_count_per_cylinder INTEGER,
  valve_angle_degrees NUMERIC(4,1),
  rocker_stud_type TEXT,
  guide_type TEXT,
  seat_type TEXT,
  spring_type TEXT,
  spring_pressure_seat_lbs NUMERIC(5,1),
  spring_pressure_open_lbs NUMERIC(5,1),
  port_shape TEXT,
  combustion_chamber_shape TEXT,
  screw_in_studs BOOLEAN,
  guideplates BOOLEAN,
  hardened_seats BOOLEAN,

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE engine_heads ADD CONSTRAINT chk_eh_side
  CHECK (side IN ('left', 'right', 'center'));
ALTER TABLE engine_heads ADD CONSTRAINT chk_eh_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE engine_heads ADD CONSTRAINT chk_eh_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE engine_heads ADD CONSTRAINT chk_eh_material
  CHECK (material IS NULL OR material IN ('cast_iron', 'aluminum', 'other'));

CREATE INDEX idx_engine_heads_vehicle ON engine_heads(vehicle_id);

COMMENT ON TABLE engine_heads IS 'Cylinder head specifications. One row per head (e.g. 2 for V8, 1 for inline).';
COMMENT ON COLUMN engine_heads.id IS 'Primary key.';
COMMENT ON COLUMN engine_heads.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN engine_heads.engine_block_id IS 'FK to engine_blocks(id).';
COMMENT ON COLUMN engine_heads.side IS 'Which side: left, right, or center (for inline engines).';
COMMENT ON COLUMN engine_heads.casting_number IS 'Head casting number.';
COMMENT ON COLUMN engine_heads.casting_date_code IS 'Date code on the casting.';
COMMENT ON COLUMN engine_heads.material IS 'Head material: cast_iron, aluminum, other.';
COMMENT ON COLUMN engine_heads.chamber_volume_cc IS 'Combustion chamber volume in cc.';
COMMENT ON COLUMN engine_heads.intake_port_volume_cc IS 'Intake port volume in cc (flow bench data).';
COMMENT ON COLUMN engine_heads.exhaust_port_volume_cc IS 'Exhaust port volume in cc (flow bench data).';
COMMENT ON COLUMN engine_heads.intake_valve_diameter_mm IS 'Intake valve head diameter in mm.';
COMMENT ON COLUMN engine_heads.exhaust_valve_diameter_mm IS 'Exhaust valve head diameter in mm.';
COMMENT ON COLUMN engine_heads.valve_count_per_cylinder IS 'Number of valves per cylinder (2, 3, 4, 5).';
COMMENT ON COLUMN engine_heads.valve_angle_degrees IS 'Valve angle from deck surface in degrees.';
COMMENT ON COLUMN engine_heads.rocker_stud_type IS 'Rocker stud mounting: press_in, screw_in, pedestal, shaft.';
COMMENT ON COLUMN engine_heads.guide_type IS 'Valve guide type: integral, replaceable_bronze, replaceable_iron.';
COMMENT ON COLUMN engine_heads.seat_type IS 'Valve seat type: integral, induction_hardened, stellite, beryllium_copper.';
COMMENT ON COLUMN engine_heads.spring_type IS 'Valve spring type: single, double, beehive, triple.';
COMMENT ON COLUMN engine_heads.spring_pressure_seat_lbs IS 'Valve spring pressure at installed height in lbs.';
COMMENT ON COLUMN engine_heads.spring_pressure_open_lbs IS 'Valve spring pressure at max lift in lbs.';
COMMENT ON COLUMN engine_heads.port_shape IS 'Port shape description, e.g. cathedral, rectangular, oval, d_port.';
COMMENT ON COLUMN engine_heads.combustion_chamber_shape IS 'Chamber shape, e.g. open, closed, heart, bathtub, hemi.';
COMMENT ON COLUMN engine_heads.screw_in_studs IS 'True if head has screw-in rocker studs (vs press-in).';
COMMENT ON COLUMN engine_heads.guideplates IS 'True if head uses guideplates for pushrod alignment.';
COMMENT ON COLUMN engine_heads.hardened_seats IS 'True if valve seats are hardened for unleaded fuel.';
COMMENT ON COLUMN engine_heads.is_original IS 'True if factory-installed head.';
COMMENT ON COLUMN engine_heads.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN engine_heads.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN engine_heads.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN engine_heads.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN engine_heads.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN engine_heads.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 9. ENGINE_CAMSHAFTS
-- ============================================================

CREATE TABLE engine_camshafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  engine_block_id UUID REFERENCES engine_blocks(id) ON DELETE SET NULL,

  part_number TEXT,
  manufacturer TEXT,
  grind_number TEXT,
  cam_type TEXT,
  duration_intake_at_050 NUMERIC(5,1),
  duration_exhaust_at_050 NUMERIC(5,1),
  duration_intake_advertised NUMERIC(5,1),
  duration_exhaust_advertised NUMERIC(5,1),
  lift_intake_mm NUMERIC(6,3),
  lift_exhaust_mm NUMERIC(6,3),
  lobe_separation_angle NUMERIC(5,1),
  installed_centerline NUMERIC(5,1),
  lobe_count INTEGER,
  drive_type TEXT,
  material TEXT,
  bearing_journal_count INTEGER,

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE engine_camshafts ADD CONSTRAINT chk_ecam_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE engine_camshafts ADD CONSTRAINT chk_ecam_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE engine_camshafts ADD CONSTRAINT chk_ecam_type
  CHECK (cam_type IS NULL OR cam_type IN ('flat_tappet_hydraulic', 'flat_tappet_solid', 'roller_hydraulic', 'roller_solid', 'overhead', 'other'));
ALTER TABLE engine_camshafts ADD CONSTRAINT chk_ecam_drive
  CHECK (drive_type IS NULL OR drive_type IN ('chain', 'gear', 'belt', 'other'));

CREATE INDEX idx_engine_camshafts_vehicle ON engine_camshafts(vehicle_id);

COMMENT ON TABLE engine_camshafts IS 'Camshaft specifications. One row per camshaft installed.';
COMMENT ON COLUMN engine_camshafts.id IS 'Primary key.';
COMMENT ON COLUMN engine_camshafts.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN engine_camshafts.engine_block_id IS 'FK to engine_blocks(id).';
COMMENT ON COLUMN engine_camshafts.part_number IS 'Manufacturer part number.';
COMMENT ON COLUMN engine_camshafts.manufacturer IS 'Cam manufacturer, e.g. Comp Cams, Crane, factory.';
COMMENT ON COLUMN engine_camshafts.grind_number IS 'Cam grind identification number.';
COMMENT ON COLUMN engine_camshafts.cam_type IS 'Lifter type: flat_tappet_hydraulic, flat_tappet_solid, roller_hydraulic, roller_solid, overhead, other.';
COMMENT ON COLUMN engine_camshafts.duration_intake_at_050 IS 'Intake duration at 0.050" lift in degrees.';
COMMENT ON COLUMN engine_camshafts.duration_exhaust_at_050 IS 'Exhaust duration at 0.050" lift in degrees.';
COMMENT ON COLUMN engine_camshafts.duration_intake_advertised IS 'Intake duration at advertised check height in degrees.';
COMMENT ON COLUMN engine_camshafts.duration_exhaust_advertised IS 'Exhaust duration at advertised check height in degrees.';
COMMENT ON COLUMN engine_camshafts.lift_intake_mm IS 'Maximum intake lobe lift in mm (at the cam, not at valve).';
COMMENT ON COLUMN engine_camshafts.lift_exhaust_mm IS 'Maximum exhaust lobe lift in mm (at the cam, not at valve).';
COMMENT ON COLUMN engine_camshafts.lobe_separation_angle IS 'Lobe separation angle in degrees. Typically 108-114 for street cams.';
COMMENT ON COLUMN engine_camshafts.installed_centerline IS 'Installed intake centerline in degrees ATDC.';
COMMENT ON COLUMN engine_camshafts.lobe_count IS 'Total number of lobes on the camshaft.';
COMMENT ON COLUMN engine_camshafts.drive_type IS 'How cam is driven: chain, gear, belt, other.';
COMMENT ON COLUMN engine_camshafts.material IS 'Cam material, e.g. cast_iron, billet_steel, chilled_iron.';
COMMENT ON COLUMN engine_camshafts.bearing_journal_count IS 'Number of cam bearing journals.';
COMMENT ON COLUMN engine_camshafts.is_original IS 'True if factory-installed camshaft.';
COMMENT ON COLUMN engine_camshafts.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN engine_camshafts.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN engine_camshafts.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN engine_camshafts.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN engine_camshafts.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN engine_camshafts.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 10. ENGINE_INTAKE_MANIFOLDS
-- ============================================================

CREATE TABLE engine_intake_manifolds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  engine_block_id UUID REFERENCES engine_blocks(id) ON DELETE SET NULL,

  casting_number TEXT,
  part_number TEXT,
  manufacturer TEXT,
  material TEXT,
  runner_type TEXT,
  runner_volume_cc NUMERIC(6,1),
  runner_count INTEGER,
  plenum_volume_cc NUMERIC(7,1),
  carburetor_flange TEXT,
  carburetor_count INTEGER,
  egr_provision BOOLEAN,
  heat_crossover BOOLEAN,
  port_matching TEXT,
  date_code TEXT,

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE engine_intake_manifolds ADD CONSTRAINT chk_eim_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE engine_intake_manifolds ADD CONSTRAINT chk_eim_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE engine_intake_manifolds ADD CONSTRAINT chk_eim_material
  CHECK (material IS NULL OR material IN ('cast_iron', 'aluminum', 'composite', 'magnesium', 'other'));
ALTER TABLE engine_intake_manifolds ADD CONSTRAINT chk_eim_runner
  CHECK (runner_type IS NULL OR runner_type IN ('single_plane', 'dual_plane', 'tunnel_ram', 'individual_runner', 'log', 'other'));

CREATE INDEX idx_engine_intake_vehicle ON engine_intake_manifolds(vehicle_id);

COMMENT ON TABLE engine_intake_manifolds IS 'Intake manifold specifications. One row per manifold installed.';
COMMENT ON COLUMN engine_intake_manifolds.id IS 'Primary key.';
COMMENT ON COLUMN engine_intake_manifolds.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN engine_intake_manifolds.engine_block_id IS 'FK to engine_blocks(id).';
COMMENT ON COLUMN engine_intake_manifolds.casting_number IS 'Manifold casting number.';
COMMENT ON COLUMN engine_intake_manifolds.part_number IS 'Manufacturer part number if aftermarket.';
COMMENT ON COLUMN engine_intake_manifolds.manufacturer IS 'Manifold manufacturer, e.g. GM, Edelbrock, Weiand.';
COMMENT ON COLUMN engine_intake_manifolds.material IS 'Material: cast_iron, aluminum, composite, magnesium, other.';
COMMENT ON COLUMN engine_intake_manifolds.runner_type IS 'Runner design: single_plane, dual_plane, tunnel_ram, individual_runner, log, other.';
COMMENT ON COLUMN engine_intake_manifolds.runner_volume_cc IS 'Individual runner volume in cc.';
COMMENT ON COLUMN engine_intake_manifolds.runner_count IS 'Number of intake runners.';
COMMENT ON COLUMN engine_intake_manifolds.plenum_volume_cc IS 'Plenum volume in cc.';
COMMENT ON COLUMN engine_intake_manifolds.carburetor_flange IS 'Carb flange type, e.g. spread_bore, square_bore, 2bbl.';
COMMENT ON COLUMN engine_intake_manifolds.carburetor_count IS 'Number of carburetor mounting pads.';
COMMENT ON COLUMN engine_intake_manifolds.egr_provision IS 'True if manifold has EGR passage.';
COMMENT ON COLUMN engine_intake_manifolds.heat_crossover IS 'True if manifold has exhaust heat crossover passage.';
COMMENT ON COLUMN engine_intake_manifolds.port_matching IS 'Port matching status, e.g. stock, gasket_matched, fully_ported.';
COMMENT ON COLUMN engine_intake_manifolds.date_code IS 'Date code stamped on the casting.';
COMMENT ON COLUMN engine_intake_manifolds.is_original IS 'True if factory-installed manifold.';
COMMENT ON COLUMN engine_intake_manifolds.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN engine_intake_manifolds.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN engine_intake_manifolds.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN engine_intake_manifolds.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN engine_intake_manifolds.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN engine_intake_manifolds.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 11. ENGINE_CARBURETORS
-- ============================================================

CREATE TABLE engine_carburetors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  manufacturer TEXT,
  model TEXT,
  cfm_rating INTEGER,
  barrel_count INTEGER,
  list_number TEXT,
  date_code TEXT,
  choke_type TEXT,
  metering_type TEXT,
  primary_jet_size TEXT,
  secondary_jet_size TEXT,
  primary_metering_rod TEXT,
  power_valve_rating TEXT,
  accelerator_pump_size TEXT,
  float_type TEXT,
  fuel_inlet_type TEXT,
  vacuum_secondary BOOLEAN,
  electric_choke BOOLEAN,

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE engine_carburetors ADD CONSTRAINT chk_ecarb_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE engine_carburetors ADD CONSTRAINT chk_ecarb_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE engine_carburetors ADD CONSTRAINT chk_ecarb_choke
  CHECK (choke_type IS NULL OR choke_type IN ('manual', 'automatic_electric', 'automatic_hot_air', 'divorced', 'none'));

CREATE INDEX idx_engine_carb_vehicle ON engine_carburetors(vehicle_id);

COMMENT ON TABLE engine_carburetors IS 'Carburetor specifications. One row per carburetor installed (some setups have multiple).';
COMMENT ON COLUMN engine_carburetors.id IS 'Primary key.';
COMMENT ON COLUMN engine_carburetors.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN engine_carburetors.manufacturer IS 'Carb manufacturer: Rochester, Holley, Carter, Weber, Edelbrock, etc.';
COMMENT ON COLUMN engine_carburetors.model IS 'Carb model, e.g. Quadrajet, Double Pumper, AFB, DCOE.';
COMMENT ON COLUMN engine_carburetors.cfm_rating IS 'Airflow rating in cubic feet per minute.';
COMMENT ON COLUMN engine_carburetors.barrel_count IS 'Number of barrels/venturis.';
COMMENT ON COLUMN engine_carburetors.list_number IS 'Manufacturer list number for identification.';
COMMENT ON COLUMN engine_carburetors.date_code IS 'Date code stamped on the carb body.';
COMMENT ON COLUMN engine_carburetors.choke_type IS 'Choke mechanism: manual, automatic_electric, automatic_hot_air, divorced, none.';
COMMENT ON COLUMN engine_carburetors.metering_type IS 'Metering system description, e.g. primary_metering_rods, fixed_jet.';
COMMENT ON COLUMN engine_carburetors.primary_jet_size IS 'Primary jet size designation.';
COMMENT ON COLUMN engine_carburetors.secondary_jet_size IS 'Secondary jet size designation.';
COMMENT ON COLUMN engine_carburetors.primary_metering_rod IS 'Primary metering rod designation (Rochester/Carter).';
COMMENT ON COLUMN engine_carburetors.power_valve_rating IS 'Power valve vacuum rating, e.g. 6.5_in_hg.';
COMMENT ON COLUMN engine_carburetors.accelerator_pump_size IS 'Accelerator pump size designation.';
COMMENT ON COLUMN engine_carburetors.float_type IS 'Float material/type, e.g. brass, nitrophyl, plastic.';
COMMENT ON COLUMN engine_carburetors.fuel_inlet_type IS 'Fuel inlet configuration, e.g. center_hung, side_pivot.';
COMMENT ON COLUMN engine_carburetors.vacuum_secondary IS 'True if secondaries are vacuum-operated (vs mechanical).';
COMMENT ON COLUMN engine_carburetors.electric_choke IS 'True if choke is electrically heated.';
COMMENT ON COLUMN engine_carburetors.is_original IS 'True if factory-installed carburetor.';
COMMENT ON COLUMN engine_carburetors.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN engine_carburetors.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN engine_carburetors.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN engine_carburetors.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN engine_carburetors.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN engine_carburetors.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 12. ENGINE_FUEL_INJECTION — for EFI vehicles
-- ============================================================

CREATE TABLE engine_fuel_injection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  system_type TEXT,
  manufacturer TEXT,
  ecu_part_number TEXT,
  ecu_calibration TEXT,
  injector_count INTEGER,
  injector_size_cc NUMERIC(6,1),
  injector_manufacturer TEXT,
  injector_part_number TEXT,
  fuel_rail_type TEXT,
  fuel_pressure_bar NUMERIC(5,2),
  throttle_body_mm NUMERIC(5,1),
  throttle_body_count INTEGER,
  maf_type TEXT,
  map_sensor_type TEXT,
  o2_sensor_count INTEGER,
  o2_sensor_type TEXT,
  idle_air_control_type TEXT,
  tps_type TEXT,
  cts_type TEXT,
  iat_type TEXT,
  knock_sensor_count INTEGER,
  wideband_equipped BOOLEAN DEFAULT FALSE,

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE engine_fuel_injection ADD CONSTRAINT chk_efi_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE engine_fuel_injection ADD CONSTRAINT chk_efi_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE engine_fuel_injection ADD CONSTRAINT chk_efi_system
  CHECK (system_type IS NULL OR system_type IN (
    'tbi', 'mpfi', 'sfi', 'direct', 'mechanical_cis', 'mechanical_bosch',
    'throttle_body', 'port', 'direct_port', 'other'
  ));

CREATE INDEX idx_engine_fi_vehicle ON engine_fuel_injection(vehicle_id);

COMMENT ON TABLE engine_fuel_injection IS 'Electronic fuel injection system specifications. One row per EFI system installed.';
COMMENT ON COLUMN engine_fuel_injection.id IS 'Primary key.';
COMMENT ON COLUMN engine_fuel_injection.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN engine_fuel_injection.system_type IS 'Injection type: tbi, mpfi, sfi, direct, mechanical_cis, mechanical_bosch, throttle_body, port, direct_port, other.';
COMMENT ON COLUMN engine_fuel_injection.manufacturer IS 'System manufacturer, e.g. Bosch, GM, Holley.';
COMMENT ON COLUMN engine_fuel_injection.ecu_part_number IS 'ECU/PCM part number.';
COMMENT ON COLUMN engine_fuel_injection.ecu_calibration IS 'ECU calibration/PROM identifier.';
COMMENT ON COLUMN engine_fuel_injection.injector_count IS 'Number of fuel injectors.';
COMMENT ON COLUMN engine_fuel_injection.injector_size_cc IS 'Injector flow rate in cc/min at rated pressure.';
COMMENT ON COLUMN engine_fuel_injection.injector_manufacturer IS 'Injector manufacturer.';
COMMENT ON COLUMN engine_fuel_injection.injector_part_number IS 'Injector part number.';
COMMENT ON COLUMN engine_fuel_injection.fuel_rail_type IS 'Fuel rail type, e.g. return_style, returnless, crossover.';
COMMENT ON COLUMN engine_fuel_injection.fuel_pressure_bar IS 'Base fuel pressure in bar.';
COMMENT ON COLUMN engine_fuel_injection.throttle_body_mm IS 'Throttle body bore diameter in mm.';
COMMENT ON COLUMN engine_fuel_injection.throttle_body_count IS 'Number of throttle bodies (ITB setups may have multiple).';
COMMENT ON COLUMN engine_fuel_injection.maf_type IS 'Mass airflow sensor type, e.g. hot_wire, vane, karman_vortex, none.';
COMMENT ON COLUMN engine_fuel_injection.map_sensor_type IS 'MAP sensor type, e.g. 1_bar, 2_bar, 3_bar, none.';
COMMENT ON COLUMN engine_fuel_injection.o2_sensor_count IS 'Total number of O2 sensors.';
COMMENT ON COLUMN engine_fuel_injection.o2_sensor_type IS 'O2 sensor type, e.g. narrowband, wideband.';
COMMENT ON COLUMN engine_fuel_injection.idle_air_control_type IS 'IAC valve type.';
COMMENT ON COLUMN engine_fuel_injection.tps_type IS 'Throttle position sensor type.';
COMMENT ON COLUMN engine_fuel_injection.cts_type IS 'Coolant temperature sensor type.';
COMMENT ON COLUMN engine_fuel_injection.iat_type IS 'Intake air temperature sensor type.';
COMMENT ON COLUMN engine_fuel_injection.knock_sensor_count IS 'Number of knock sensors.';
COMMENT ON COLUMN engine_fuel_injection.wideband_equipped IS 'True if wideband O2 sensor is installed.';
COMMENT ON COLUMN engine_fuel_injection.is_original IS 'True if factory-installed EFI system.';
COMMENT ON COLUMN engine_fuel_injection.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN engine_fuel_injection.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN engine_fuel_injection.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN engine_fuel_injection.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN engine_fuel_injection.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN engine_fuel_injection.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 13. ENGINE_DISTRIBUTORS
-- ============================================================

CREATE TABLE engine_distributors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  part_number TEXT,
  manufacturer TEXT,
  ignition_type TEXT,
  advance_type TEXT,
  initial_advance_degrees NUMERIC(4,1),
  mechanical_advance_total NUMERIC(4,1),
  mechanical_advance_all_in_rpm INTEGER,
  vacuum_advance_degrees NUMERIC(4,1),
  cap_type TEXT,
  rotor_type TEXT,
  point_gap_mm NUMERIC(4,2),
  dwell_degrees NUMERIC(4,1),
  coil_type TEXT,
  coil_manufacturer TEXT,
  module_type TEXT,
  spark_plug_wire_type TEXT,
  firing_order TEXT,

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE engine_distributors ADD CONSTRAINT chk_edist_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE engine_distributors ADD CONSTRAINT chk_edist_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE engine_distributors ADD CONSTRAINT chk_edist_ignition
  CHECK (ignition_type IS NULL OR ignition_type IN (
    'points', 'electronic_hei', 'electronic_breakerless', 'electronic_pointless',
    'coil_on_plug', 'distributorless', 'magneto', 'cdi', 'other'
  ));

CREATE INDEX idx_engine_dist_vehicle ON engine_distributors(vehicle_id);

COMMENT ON TABLE engine_distributors IS 'Distributor and ignition system specifications.';
COMMENT ON COLUMN engine_distributors.id IS 'Primary key.';
COMMENT ON COLUMN engine_distributors.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN engine_distributors.part_number IS 'Distributor part number.';
COMMENT ON COLUMN engine_distributors.manufacturer IS 'Manufacturer, e.g. Delco, Mallory, MSD, Pertronix.';
COMMENT ON COLUMN engine_distributors.ignition_type IS 'Ignition system type: points, electronic_hei, electronic_breakerless, electronic_pointless, coil_on_plug, distributorless, magneto, cdi, other.';
COMMENT ON COLUMN engine_distributors.advance_type IS 'Advance mechanism description, e.g. mechanical_and_vacuum, mechanical_only, electronic.';
COMMENT ON COLUMN engine_distributors.initial_advance_degrees IS 'Initial timing advance in degrees BTDC.';
COMMENT ON COLUMN engine_distributors.mechanical_advance_total IS 'Total mechanical advance in degrees.';
COMMENT ON COLUMN engine_distributors.mechanical_advance_all_in_rpm IS 'RPM at which full mechanical advance is achieved.';
COMMENT ON COLUMN engine_distributors.vacuum_advance_degrees IS 'Maximum vacuum advance in degrees.';
COMMENT ON COLUMN engine_distributors.cap_type IS 'Distributor cap type, e.g. standard, hei_large, male_terminal.';
COMMENT ON COLUMN engine_distributors.rotor_type IS 'Rotor type description.';
COMMENT ON COLUMN engine_distributors.point_gap_mm IS 'Breaker point gap in mm (points ignition only).';
COMMENT ON COLUMN engine_distributors.dwell_degrees IS 'Point dwell angle in degrees (points ignition only).';
COMMENT ON COLUMN engine_distributors.coil_type IS 'Ignition coil type, e.g. canister, hei_internal, e_core, coil_pack.';
COMMENT ON COLUMN engine_distributors.coil_manufacturer IS 'Coil manufacturer.';
COMMENT ON COLUMN engine_distributors.module_type IS 'Ignition module type, e.g. 4_pin_hei, 7_pin_hei, msd_6al.';
COMMENT ON COLUMN engine_distributors.spark_plug_wire_type IS 'Spark plug wire type, e.g. carbon_core, spiral_wound, solid_core.';
COMMENT ON COLUMN engine_distributors.firing_order IS 'Engine firing order, e.g. 1-8-4-3-6-5-7-2 for SBC.';
COMMENT ON COLUMN engine_distributors.is_original IS 'True if factory-installed distributor.';
COMMENT ON COLUMN engine_distributors.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN engine_distributors.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN engine_distributors.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN engine_distributors.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN engine_distributors.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN engine_distributors.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 14. ENGINE_EXHAUST_MANIFOLDS — per-side
-- ============================================================

CREATE TABLE engine_exhaust_manifolds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  side TEXT NOT NULL,

  casting_number TEXT,
  part_number TEXT,
  manufacturer TEXT,
  material TEXT,
  port_count INTEGER,
  header_type TEXT,
  primary_tube_diameter_inches NUMERIC(4,2),
  primary_tube_length_inches NUMERIC(5,1),
  collector_diameter_inches NUMERIC(4,2),
  heat_riser_equipped BOOLEAN,
  heat_riser_functional BOOLEAN,
  oxygen_sensor_bung BOOLEAN,
  egr_provision BOOLEAN,
  coating TEXT,
  date_code TEXT,

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE engine_exhaust_manifolds ADD CONSTRAINT chk_exm_side
  CHECK (side IN ('left', 'right', 'center'));
ALTER TABLE engine_exhaust_manifolds ADD CONSTRAINT chk_exm_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE engine_exhaust_manifolds ADD CONSTRAINT chk_exm_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE engine_exhaust_manifolds ADD CONSTRAINT chk_exm_material
  CHECK (material IS NULL OR material IN ('cast_iron', 'stainless_steel', 'mild_steel', 'ceramic_coated', 'titanium', 'other'));
ALTER TABLE engine_exhaust_manifolds ADD CONSTRAINT chk_exm_header
  CHECK (header_type IS NULL OR header_type IN ('log', 'tubular_shorty', 'tubular_mid', 'tubular_long', 'tri_y', 'other'));

CREATE INDEX idx_engine_exh_vehicle ON engine_exhaust_manifolds(vehicle_id);

COMMENT ON TABLE engine_exhaust_manifolds IS 'Exhaust manifold or header specifications. One row per side.';
COMMENT ON COLUMN engine_exhaust_manifolds.id IS 'Primary key.';
COMMENT ON COLUMN engine_exhaust_manifolds.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN engine_exhaust_manifolds.side IS 'Which side: left, right, or center (for inline engines).';
COMMENT ON COLUMN engine_exhaust_manifolds.casting_number IS 'Casting number for factory manifolds.';
COMMENT ON COLUMN engine_exhaust_manifolds.part_number IS 'Part number for aftermarket headers.';
COMMENT ON COLUMN engine_exhaust_manifolds.manufacturer IS 'Manufacturer, e.g. GM, Hooker, Hedman, Sanderson.';
COMMENT ON COLUMN engine_exhaust_manifolds.material IS 'Material: cast_iron, stainless_steel, mild_steel, ceramic_coated, titanium, other.';
COMMENT ON COLUMN engine_exhaust_manifolds.port_count IS 'Number of exhaust ports.';
COMMENT ON COLUMN engine_exhaust_manifolds.header_type IS 'Header design: log, tubular_shorty, tubular_mid, tubular_long, tri_y, other.';
COMMENT ON COLUMN engine_exhaust_manifolds.primary_tube_diameter_inches IS 'Primary tube outer diameter in inches (headers).';
COMMENT ON COLUMN engine_exhaust_manifolds.primary_tube_length_inches IS 'Primary tube length in inches (headers).';
COMMENT ON COLUMN engine_exhaust_manifolds.collector_diameter_inches IS 'Collector outlet diameter in inches.';
COMMENT ON COLUMN engine_exhaust_manifolds.heat_riser_equipped IS 'True if factory heat riser valve is present.';
COMMENT ON COLUMN engine_exhaust_manifolds.heat_riser_functional IS 'True if heat riser valve is still operational.';
COMMENT ON COLUMN engine_exhaust_manifolds.oxygen_sensor_bung IS 'True if O2 sensor bung is welded in.';
COMMENT ON COLUMN engine_exhaust_manifolds.egr_provision IS 'True if manifold has EGR passage.';
COMMENT ON COLUMN engine_exhaust_manifolds.coating IS 'Applied coating, e.g. ceramic, high_temp_paint, raw.';
COMMENT ON COLUMN engine_exhaust_manifolds.date_code IS 'Date code on the casting.';
COMMENT ON COLUMN engine_exhaust_manifolds.is_original IS 'True if factory-installed manifold/header.';
COMMENT ON COLUMN engine_exhaust_manifolds.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN engine_exhaust_manifolds.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN engine_exhaust_manifolds.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN engine_exhaust_manifolds.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN engine_exhaust_manifolds.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN engine_exhaust_manifolds.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 15. ENGINE_OIL_SYSTEMS
-- ============================================================

CREATE TABLE engine_oil_systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  pan_type TEXT,
  pan_capacity_quarts NUMERIC(4,1),
  pan_material TEXT,
  pan_baffle_type TEXT,
  pan_windage_tray BOOLEAN,
  pump_type TEXT,
  pump_drive TEXT,
  pump_part_number TEXT,
  pump_pressure_psi_idle INTEGER,
  pump_pressure_psi_cruise INTEGER,
  filter_type TEXT,
  filter_adapter TEXT,
  filter_part_number TEXT,
  cooler_equipped BOOLEAN,
  cooler_type TEXT,
  cooler_line_size TEXT,
  accumulator_equipped BOOLEAN,
  dry_sump BOOLEAN,
  oil_spec TEXT,
  oil_weight TEXT,

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE engine_oil_systems ADD CONSTRAINT chk_eoil_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE engine_oil_systems ADD CONSTRAINT chk_eoil_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE engine_oil_systems ADD CONSTRAINT chk_eoil_pump
  CHECK (pump_type IS NULL OR pump_type IN ('standard_volume', 'high_volume', 'high_pressure', 'dry_sump_stage', 'other'));

CREATE INDEX idx_engine_oil_vehicle ON engine_oil_systems(vehicle_id);

COMMENT ON TABLE engine_oil_systems IS 'Engine oiling system components: pan, pump, filter, cooler.';
COMMENT ON COLUMN engine_oil_systems.id IS 'Primary key.';
COMMENT ON COLUMN engine_oil_systems.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN engine_oil_systems.pan_type IS 'Oil pan style, e.g. stock, road_race, drag_race, truck.';
COMMENT ON COLUMN engine_oil_systems.pan_capacity_quarts IS 'Oil pan capacity in quarts.';
COMMENT ON COLUMN engine_oil_systems.pan_material IS 'Pan material, e.g. stamped_steel, cast_aluminum, fabricated_aluminum.';
COMMENT ON COLUMN engine_oil_systems.pan_baffle_type IS 'Internal baffle type, e.g. none, crank_scraper, full_baffle.';
COMMENT ON COLUMN engine_oil_systems.pan_windage_tray IS 'True if windage tray is installed.';
COMMENT ON COLUMN engine_oil_systems.pump_type IS 'Pump type: standard_volume, high_volume, high_pressure, dry_sump_stage, other.';
COMMENT ON COLUMN engine_oil_systems.pump_drive IS 'Pump drive method, e.g. distributor_driven, crank_driven, belt_driven.';
COMMENT ON COLUMN engine_oil_systems.pump_part_number IS 'Oil pump part number.';
COMMENT ON COLUMN engine_oil_systems.pump_pressure_psi_idle IS 'Oil pressure at idle in PSI.';
COMMENT ON COLUMN engine_oil_systems.pump_pressure_psi_cruise IS 'Oil pressure at cruising RPM in PSI.';
COMMENT ON COLUMN engine_oil_systems.filter_type IS 'Filter type, e.g. spin_on, cartridge, canister, remote.';
COMMENT ON COLUMN engine_oil_systems.filter_adapter IS 'Filter adapter description if non-stock.';
COMMENT ON COLUMN engine_oil_systems.filter_part_number IS 'Current oil filter part number.';
COMMENT ON COLUMN engine_oil_systems.cooler_equipped IS 'True if oil cooler is installed.';
COMMENT ON COLUMN engine_oil_systems.cooler_type IS 'Oil cooler type, e.g. plate, tube_fin, stacked_plate.';
COMMENT ON COLUMN engine_oil_systems.cooler_line_size IS 'Oil cooler line size, e.g. -6AN, -8AN, 3/8.';
COMMENT ON COLUMN engine_oil_systems.accumulator_equipped IS 'True if oil accumulator is installed.';
COMMENT ON COLUMN engine_oil_systems.dry_sump IS 'True if dry sump oiling system.';
COMMENT ON COLUMN engine_oil_systems.oil_spec IS 'Oil specification, e.g. API_SN, ZDDP_high.';
COMMENT ON COLUMN engine_oil_systems.oil_weight IS 'Recommended oil weight, e.g. 10W-30, 20W-50.';
COMMENT ON COLUMN engine_oil_systems.is_original IS 'True if factory-original oiling system.';
COMMENT ON COLUMN engine_oil_systems.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN engine_oil_systems.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN engine_oil_systems.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN engine_oil_systems.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN engine_oil_systems.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN engine_oil_systems.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 16. ENGINE_COOLING_INTERFACES
-- ============================================================

CREATE TABLE engine_cooling_interfaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  water_pump_type TEXT,
  water_pump_part_number TEXT,
  water_pump_rotation TEXT,
  water_pump_drive TEXT,
  thermostat_temp_f INTEGER,
  thermostat_type TEXT,
  thermostat_housing_material TEXT,
  bypass_hose_type TEXT,
  heater_hose_routing TEXT,
  coolant_type TEXT,
  coolant_capacity_quarts NUMERIC(4,1),
  steam_holes_drilled BOOLEAN,
  freeze_plug_material TEXT,
  freeze_plug_count INTEGER,

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE engine_cooling_interfaces ADD CONSTRAINT chk_ecool_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE engine_cooling_interfaces ADD CONSTRAINT chk_ecool_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE engine_cooling_interfaces ADD CONSTRAINT chk_ecool_rotation
  CHECK (water_pump_rotation IS NULL OR water_pump_rotation IN ('standard', 'reverse'));

CREATE INDEX idx_engine_cool_vehicle ON engine_cooling_interfaces(vehicle_id);

COMMENT ON TABLE engine_cooling_interfaces IS 'Engine-side cooling system components: water pump, thermostat, hoses, coolant spec.';
COMMENT ON COLUMN engine_cooling_interfaces.id IS 'Primary key.';
COMMENT ON COLUMN engine_cooling_interfaces.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN engine_cooling_interfaces.water_pump_type IS 'Water pump style, e.g. short, long, electric.';
COMMENT ON COLUMN engine_cooling_interfaces.water_pump_part_number IS 'Water pump part number.';
COMMENT ON COLUMN engine_cooling_interfaces.water_pump_rotation IS 'Pump impeller rotation: standard or reverse.';
COMMENT ON COLUMN engine_cooling_interfaces.water_pump_drive IS 'Pump drive method, e.g. belt, electric, gear.';
COMMENT ON COLUMN engine_cooling_interfaces.thermostat_temp_f IS 'Thermostat opening temperature in Fahrenheit.';
COMMENT ON COLUMN engine_cooling_interfaces.thermostat_type IS 'Thermostat type, e.g. standard, high_flow, restrictor.';
COMMENT ON COLUMN engine_cooling_interfaces.thermostat_housing_material IS 'Housing material, e.g. cast_iron, aluminum, plastic.';
COMMENT ON COLUMN engine_cooling_interfaces.bypass_hose_type IS 'Bypass hose type/routing.';
COMMENT ON COLUMN engine_cooling_interfaces.heater_hose_routing IS 'Heater hose routing description.';
COMMENT ON COLUMN engine_cooling_interfaces.coolant_type IS 'Coolant type, e.g. green_iag, dexcool_oat, water_wetter, distilled_only.';
COMMENT ON COLUMN engine_cooling_interfaces.coolant_capacity_quarts IS 'System coolant capacity in quarts.';
COMMENT ON COLUMN engine_cooling_interfaces.steam_holes_drilled IS 'True if steam holes have been drilled in heads/gaskets.';
COMMENT ON COLUMN engine_cooling_interfaces.freeze_plug_material IS 'Freeze plug material, e.g. steel, brass, aluminum.';
COMMENT ON COLUMN engine_cooling_interfaces.freeze_plug_count IS 'Number of freeze/core plugs.';
COMMENT ON COLUMN engine_cooling_interfaces.is_original IS 'True if factory-original cooling components.';
COMMENT ON COLUMN engine_cooling_interfaces.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN engine_cooling_interfaces.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN engine_cooling_interfaces.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN engine_cooling_interfaces.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN engine_cooling_interfaces.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN engine_cooling_interfaces.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 17. ENGINE_ACCESSORIES — belt-driven and mounted accessories
-- ============================================================

CREATE TABLE engine_accessories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  alternator_manufacturer TEXT,
  alternator_part_number TEXT,
  alternator_amperage INTEGER,
  alternator_type TEXT,
  ac_compressor_manufacturer TEXT,
  ac_compressor_type TEXT,
  ac_compressor_part_number TEXT,
  ac_equipped BOOLEAN,
  ps_pump_manufacturer TEXT,
  ps_pump_type TEXT,
  ps_pump_part_number TEXT,
  ps_equipped BOOLEAN,
  smog_pump_equipped BOOLEAN,
  smog_pump_type TEXT,
  air_pump_equipped BOOLEAN,
  belt_system TEXT,
  belt_count INTEGER,
  belt_part_numbers TEXT[],
  idler_pulley_count INTEGER,
  tensioner_type TEXT,
  pulley_material TEXT,
  pulley_type TEXT,
  underdrive_pulleys BOOLEAN DEFAULT FALSE,

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE engine_accessories ADD CONSTRAINT chk_eacc_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE engine_accessories ADD CONSTRAINT chk_eacc_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE engine_accessories ADD CONSTRAINT chk_eacc_belt
  CHECK (belt_system IS NULL OR belt_system IN ('v_belt', 'serpentine', 'cogged', 'other'));

CREATE INDEX idx_engine_acc_vehicle ON engine_accessories(vehicle_id);

COMMENT ON TABLE engine_accessories IS 'Engine-mounted accessories: alternator, AC, power steering, belts, pulleys.';
COMMENT ON COLUMN engine_accessories.id IS 'Primary key.';
COMMENT ON COLUMN engine_accessories.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN engine_accessories.alternator_manufacturer IS 'Alternator manufacturer, e.g. Delco, Bosch, Powermaster.';
COMMENT ON COLUMN engine_accessories.alternator_part_number IS 'Alternator part number.';
COMMENT ON COLUMN engine_accessories.alternator_amperage IS 'Alternator output rating in amps.';
COMMENT ON COLUMN engine_accessories.alternator_type IS 'Alternator type, e.g. si_series, cs_series, one_wire, external_reg.';
COMMENT ON COLUMN engine_accessories.ac_compressor_manufacturer IS 'AC compressor manufacturer.';
COMMENT ON COLUMN engine_accessories.ac_compressor_type IS 'Compressor type, e.g. a6, r4, sanden, scroll.';
COMMENT ON COLUMN engine_accessories.ac_compressor_part_number IS 'AC compressor part number.';
COMMENT ON COLUMN engine_accessories.ac_equipped IS 'True if air conditioning is installed.';
COMMENT ON COLUMN engine_accessories.ps_pump_manufacturer IS 'Power steering pump manufacturer.';
COMMENT ON COLUMN engine_accessories.ps_pump_type IS 'Power steering pump type, e.g. saginaw, tc, remote_reservoir.';
COMMENT ON COLUMN engine_accessories.ps_pump_part_number IS 'Power steering pump part number.';
COMMENT ON COLUMN engine_accessories.ps_equipped IS 'True if power steering is installed.';
COMMENT ON COLUMN engine_accessories.smog_pump_equipped IS 'True if AIR/smog pump is installed.';
COMMENT ON COLUMN engine_accessories.smog_pump_type IS 'Smog pump type description.';
COMMENT ON COLUMN engine_accessories.air_pump_equipped IS 'True if air injection pump is installed (distinct from smog for some applications).';
COMMENT ON COLUMN engine_accessories.belt_system IS 'Belt drive system: v_belt, serpentine, cogged, other.';
COMMENT ON COLUMN engine_accessories.belt_count IS 'Number of drive belts.';
COMMENT ON COLUMN engine_accessories.belt_part_numbers IS 'Array of belt part numbers.';
COMMENT ON COLUMN engine_accessories.idler_pulley_count IS 'Number of idler pulleys.';
COMMENT ON COLUMN engine_accessories.tensioner_type IS 'Belt tensioner type, e.g. manual, automatic_spring, hydraulic.';
COMMENT ON COLUMN engine_accessories.pulley_material IS 'Pulley material, e.g. stamped_steel, cast_iron, billet_aluminum.';
COMMENT ON COLUMN engine_accessories.pulley_type IS 'Pulley type, e.g. stock_single_groove, stock_double_groove, billet.';
COMMENT ON COLUMN engine_accessories.underdrive_pulleys IS 'True if underdrive (smaller crank) pulleys installed.';
COMMENT ON COLUMN engine_accessories.is_original IS 'True if factory-original accessory package.';
COMMENT ON COLUMN engine_accessories.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN engine_accessories.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN engine_accessories.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN engine_accessories.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN engine_accessories.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN engine_accessories.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 18. ENGINE_HARDWARE — covers, timing, balancer, flywheel, mounts
-- ============================================================

CREATE TABLE engine_hardware (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Valve covers
  valve_cover_material TEXT,
  valve_cover_style TEXT,
  valve_cover_part_number TEXT,
  valve_cover_breather_type TEXT,
  valve_cover_pcv_equipped BOOLEAN,

  -- Timing cover
  timing_cover_material TEXT,
  timing_cover_part_number TEXT,
  timing_tab_type TEXT,
  timing_chain_type TEXT,
  timing_set_part_number TEXT,

  -- Harmonic balancer
  balancer_type TEXT,
  balancer_part_number TEXT,
  balancer_diameter_inches NUMERIC(5,2),
  balancer_sfi_rated BOOLEAN,

  -- Flywheel / flexplate
  flywheel_material TEXT,
  flywheel_weight_lbs NUMERIC(5,1),
  flywheel_tooth_count INTEGER,
  flywheel_balance TEXT,
  flywheel_sfi_rated BOOLEAN,
  flexplate BOOLEAN,

  -- Motor mounts
  motor_mount_type TEXT,
  motor_mount_material TEXT,
  motor_mount_part_number TEXT,

  -- Gaskets
  head_gasket_type TEXT,
  head_gasket_thickness_mm NUMERIC(4,2),
  intake_gasket_type TEXT,
  exhaust_gasket_type TEXT,
  rear_main_seal_type TEXT,
  front_seal_type TEXT,
  valve_cover_gasket_type TEXT,

  is_original BOOLEAN DEFAULT TRUE,
  condition_grade TEXT DEFAULT 'unknown',
  condition_notes TEXT,
  provenance TEXT DEFAULT 'unknown',
  provenance_detail TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE engine_hardware ADD CONSTRAINT chk_ehw_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));
ALTER TABLE engine_hardware ADD CONSTRAINT chk_ehw_provenance
  CHECK (provenance IN ('original', 'nos', 'reproduction', 'aftermarket', 'unknown'));
ALTER TABLE engine_hardware ADD CONSTRAINT chk_ehw_vc_material
  CHECK (valve_cover_material IS NULL OR valve_cover_material IN ('stamped_steel', 'cast_aluminum', 'fabricated_aluminum', 'chrome', 'cast_iron', 'other'));
ALTER TABLE engine_hardware ADD CONSTRAINT chk_ehw_flywheel_material
  CHECK (flywheel_material IS NULL OR flywheel_material IN ('cast_iron', 'billet_steel', 'aluminum', 'other'));
ALTER TABLE engine_hardware ADD CONSTRAINT chk_ehw_mount_material
  CHECK (motor_mount_material IS NULL OR motor_mount_material IN ('rubber', 'polyurethane', 'solid', 'hydraulic', 'other'));

CREATE INDEX idx_engine_hw_vehicle ON engine_hardware(vehicle_id);

COMMENT ON TABLE engine_hardware IS 'Engine hard parts: valve covers, timing cover, balancer, flywheel, motor mounts, gaskets.';
COMMENT ON COLUMN engine_hardware.id IS 'Primary key.';
COMMENT ON COLUMN engine_hardware.vehicle_id IS 'FK to vehicles(id).';
COMMENT ON COLUMN engine_hardware.valve_cover_material IS 'Valve cover material: stamped_steel, cast_aluminum, fabricated_aluminum, chrome, cast_iron, other.';
COMMENT ON COLUMN engine_hardware.valve_cover_style IS 'Valve cover style description, e.g. stock_tall, stock_short, finned, baffled.';
COMMENT ON COLUMN engine_hardware.valve_cover_part_number IS 'Valve cover part number.';
COMMENT ON COLUMN engine_hardware.valve_cover_breather_type IS 'Breather type, e.g. open, filtered, pcv_grommet, oil_cap_breather.';
COMMENT ON COLUMN engine_hardware.valve_cover_pcv_equipped IS 'True if PCV valve is installed.';
COMMENT ON COLUMN engine_hardware.timing_cover_material IS 'Timing cover material, e.g. stamped_steel, cast_aluminum, plastic.';
COMMENT ON COLUMN engine_hardware.timing_cover_part_number IS 'Timing cover part number.';
COMMENT ON COLUMN engine_hardware.timing_tab_type IS 'Timing pointer/tab type, e.g. stock, adjustable.';
COMMENT ON COLUMN engine_hardware.timing_chain_type IS 'Timing chain/gear type, e.g. stock_nylon, double_roller, gear_drive, single_roller.';
COMMENT ON COLUMN engine_hardware.timing_set_part_number IS 'Timing set part number.';
COMMENT ON COLUMN engine_hardware.balancer_type IS 'Harmonic balancer type, e.g. stock_bonded, sfi, fluid, elastomer.';
COMMENT ON COLUMN engine_hardware.balancer_part_number IS 'Harmonic balancer part number.';
COMMENT ON COLUMN engine_hardware.balancer_diameter_inches IS 'Harmonic balancer diameter in inches.';
COMMENT ON COLUMN engine_hardware.balancer_sfi_rated IS 'True if balancer is SFI certified.';
COMMENT ON COLUMN engine_hardware.flywheel_material IS 'Flywheel material: cast_iron, billet_steel, aluminum, other.';
COMMENT ON COLUMN engine_hardware.flywheel_weight_lbs IS 'Flywheel weight in pounds.';
COMMENT ON COLUMN engine_hardware.flywheel_tooth_count IS 'Ring gear tooth count for starter engagement.';
COMMENT ON COLUMN engine_hardware.flywheel_balance IS 'Flywheel balance weight, e.g. neutral, 28oz_imbalance.';
COMMENT ON COLUMN engine_hardware.flywheel_sfi_rated IS 'True if flywheel is SFI certified.';
COMMENT ON COLUMN engine_hardware.flexplate IS 'True if automatic transmission flexplate (vs manual flywheel).';
COMMENT ON COLUMN engine_hardware.motor_mount_type IS 'Motor mount type, e.g. stock, clamshell, solid, conversion.';
COMMENT ON COLUMN engine_hardware.motor_mount_material IS 'Mount material: rubber, polyurethane, solid, hydraulic, other.';
COMMENT ON COLUMN engine_hardware.motor_mount_part_number IS 'Motor mount part number.';
COMMENT ON COLUMN engine_hardware.head_gasket_type IS 'Head gasket type, e.g. composition, mls, copper.';
COMMENT ON COLUMN engine_hardware.head_gasket_thickness_mm IS 'Head gasket compressed thickness in mm.';
COMMENT ON COLUMN engine_hardware.intake_gasket_type IS 'Intake manifold gasket type.';
COMMENT ON COLUMN engine_hardware.exhaust_gasket_type IS 'Exhaust manifold gasket type.';
COMMENT ON COLUMN engine_hardware.rear_main_seal_type IS 'Rear main seal type, e.g. two_piece_rope, one_piece_lip.';
COMMENT ON COLUMN engine_hardware.front_seal_type IS 'Front timing cover seal type.';
COMMENT ON COLUMN engine_hardware.valve_cover_gasket_type IS 'Valve cover gasket type, e.g. cork, rubber, steel_core.';
COMMENT ON COLUMN engine_hardware.is_original IS 'True if factory-original hardware.';
COMMENT ON COLUMN engine_hardware.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN engine_hardware.condition_notes IS 'Freeform condition details.';
COMMENT ON COLUMN engine_hardware.provenance IS 'Part origin: original, nos, reproduction, aftermarket, unknown.';
COMMENT ON COLUMN engine_hardware.provenance_detail IS 'Detailed provenance info.';
COMMENT ON COLUMN engine_hardware.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN engine_hardware.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- UPDATED_AT TRIGGERS
-- Shared trigger function for all tables in this migration.
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
    'actors',
    'component_events',
    'engine_blocks',
    'engine_cylinder_measurements',
    'engine_crankshafts',
    'engine_connecting_rods',
    'engine_pistons',
    'engine_heads',
    'engine_camshafts',
    'engine_intake_manifolds',
    'engine_carburetors',
    'engine_fuel_injection',
    'engine_distributors',
    'engine_exhaust_manifolds',
    'engine_oil_systems',
    'engine_cooling_interfaces',
    'engine_accessories',
    'engine_hardware'
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
-- Same pattern as field_evidence: public read, service role write.
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'actors',
    'component_events',
    'engine_blocks',
    'engine_cylinder_measurements',
    'engine_crankshafts',
    'engine_connecting_rods',
    'engine_pistons',
    'engine_heads',
    'engine_camshafts',
    'engine_intake_manifolds',
    'engine_carburetors',
    'engine_fuel_injection',
    'engine_distributors',
    'engine_exhaust_manifolds',
    'engine_oil_systems',
    'engine_cooling_interfaces',
    'engine_accessories',
    'engine_hardware'
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
