-- ============================================================
-- DIGITAL TWIN: Actor & Organization Ontology
-- The human/institutional capital layer of the vehicle digital twin.
--
-- Architecture:
--   This migration EXTENDS the actors table created in
--   digital_twin_engine_subsystem.sql with full-resolution identity,
--   credential, and capacity tracking. It adds organizations as
--   first-class entities (not a flag on actors), links actors to orgs
--   via memberships, and introduces work_orders as the master join
--   between vehicles, actors, and organizations.
--
--   The same evidence chain that proves a vehicle spec also proves
--   the actor's skill and the org's capability. A component_event row
--   that says "block machined to 4.030 +/- 0.001" simultaneously:
--     - Proves the engine spec (vehicle layer)
--     - Proves the machinist can hold tolerance (actor layer)
--     - Proves the shop has CNC capability (org layer)
--
--   Capabilities (actor_capabilities, org_capabilities) are DERIVED
--   from component_events. They are NEVER self-reported. Trust scores
--   are COMPUTED from evidence chains — never written directly by
--   application code.
--
-- Depends on:
--   - vehicles(id) — core vehicle table
--   - actors(id) — created in digital_twin_engine_subsystem.sql
--   - component_events(id) — created in digital_twin_engine_subsystem.sql
--   - digital_twin_set_updated_at() — trigger function from engine subsystem
-- ============================================================

BEGIN;


-- ============================================================
-- 1. EXTEND ACTORS — add full-resolution columns to existing table
--    The engine subsystem created actors with: id, actor_type, name,
--    organization_name, parent_actor_id, location, city, state, country,
--    specialties, certifications, trust_score, website, phone, email,
--    notes, created_at, updated_at.
--
--    We add: bio, profile_image_url, licenses, training,
--    years_experience, specialty_makes, specialty_eras,
--    current_workload, max_concurrent_projects,
--    typical_turnaround_days, total_documented_jobs,
--    total_components_touched.
--
--    We also expand actor_type CHECK to include the full taxonomy.
-- ============================================================

-- Add new columns to actors
ALTER TABLE actors ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE actors ADD COLUMN IF NOT EXISTS profile_image_url TEXT;
ALTER TABLE actors ADD COLUMN IF NOT EXISTS licenses TEXT[];
ALTER TABLE actors ADD COLUMN IF NOT EXISTS training TEXT[];
ALTER TABLE actors ADD COLUMN IF NOT EXISTS years_experience INTEGER;
ALTER TABLE actors ADD COLUMN IF NOT EXISTS specialty_makes TEXT[];
ALTER TABLE actors ADD COLUMN IF NOT EXISTS specialty_eras TEXT[];
ALTER TABLE actors ADD COLUMN IF NOT EXISTS current_workload INTEGER DEFAULT 0;
ALTER TABLE actors ADD COLUMN IF NOT EXISTS max_concurrent_projects INTEGER;
ALTER TABLE actors ADD COLUMN IF NOT EXISTS typical_turnaround_days INTEGER;
ALTER TABLE actors ADD COLUMN IF NOT EXISTS total_documented_jobs INTEGER DEFAULT 0;
ALTER TABLE actors ADD COLUMN IF NOT EXISTS total_components_touched INTEGER DEFAULT 0;

-- Replace the actor_type CHECK to include the full taxonomy.
-- Drop old constraint, add expanded one.
ALTER TABLE actors DROP CONSTRAINT IF EXISTS chk_actor_type;
ALTER TABLE actors ADD CONSTRAINT chk_actor_type
  CHECK (actor_type IN (
    'individual', 'shop', 'dealer', 'factory', 'inspector',
    'auction_house', 'parts_supplier', 'machine_shop', 'owner',
    'builder', 'mechanic', 'painter', 'upholsterer', 'machinist',
    'fabricator', 'electrician', 'appraiser', 'broker', 'auctioneer',
    'driver', 'restorer', 'detailer', 'welder', 'body_shop'
  ));

-- Add CHECK constraints on new columns
ALTER TABLE actors ADD CONSTRAINT chk_actor_years_exp
  CHECK (years_experience IS NULL OR (years_experience >= 0 AND years_experience <= 80));
ALTER TABLE actors ADD CONSTRAINT chk_actor_current_workload
  CHECK (current_workload IS NULL OR current_workload >= 0);
ALTER TABLE actors ADD CONSTRAINT chk_actor_max_concurrent
  CHECK (max_concurrent_projects IS NULL OR max_concurrent_projects >= 0);
ALTER TABLE actors ADD CONSTRAINT chk_actor_turnaround
  CHECK (typical_turnaround_days IS NULL OR typical_turnaround_days >= 0);
ALTER TABLE actors ADD CONSTRAINT chk_actor_documented_jobs
  CHECK (total_documented_jobs IS NULL OR total_documented_jobs >= 0);
ALTER TABLE actors ADD CONSTRAINT chk_actor_components_touched
  CHECK (total_components_touched IS NULL OR total_components_touched >= 0);

-- Specialty era CHECK (validated at array element level via trigger below)
-- Valid eras documented in comments for application-level validation.

-- Add comments on new columns
COMMENT ON COLUMN actors.bio IS 'Short biography or description of the actor. May be extracted from forum profiles, shop websites, or entered manually.';
COMMENT ON COLUMN actors.profile_image_url IS 'URL to a profile photo or logo in the vehicle-photos bucket.';
COMMENT ON COLUMN actors.licenses IS 'Array of professional licenses, e.g. {smog_technician, contractors_license_B}. NOT self-reported — verified from evidence.';
COMMENT ON COLUMN actors.training IS 'Array of training programs completed, e.g. {gm_training_center_1985, mig_welding_cert_aws}. Verified from evidence.';
COMMENT ON COLUMN actors.years_experience IS 'Total years of experience in their specialty. Computed from first_demonstrated in actor_capabilities when possible.';
COMMENT ON COLUMN actors.specialty_makes IS 'Array of vehicle makes this actor specializes in, e.g. {chevrolet, pontiac, oldsmobile}. Derived from component_events distribution.';
COMMENT ON COLUMN actors.specialty_eras IS 'Array of era tags: pre_war, brass_era, classic, post_war, muscle_era, malaise_era, classic_european, japanese_classic, modern_performance, contemporary.';
COMMENT ON COLUMN actors.current_workload IS 'Number of active projects this actor is currently working on. Updated by work_order status changes.';
COMMENT ON COLUMN actors.max_concurrent_projects IS 'Maximum projects this actor can handle simultaneously. Self-reported but calibrated against actual throughput.';
COMMENT ON COLUMN actors.typical_turnaround_days IS 'Typical project duration in days. Computed from work_order completion times.';
COMMENT ON COLUMN actors.total_documented_jobs IS 'COMPUTED: Count of component_events where this actor is referenced. Never written directly.';
COMMENT ON COLUMN actors.total_components_touched IS 'COMPUTED: Count of distinct component_id values in component_events for this actor. Never written directly.';

-- Index for specialty-based lookups
CREATE INDEX IF NOT EXISTS idx_actors_specialty_makes ON actors USING GIN (specialty_makes);
CREATE INDEX IF NOT EXISTS idx_actors_specialty_eras ON actors USING GIN (specialty_eras);
CREATE INDEX IF NOT EXISTS idx_actors_specialties ON actors USING GIN (specialties);
CREATE INDEX IF NOT EXISTS idx_actors_actor_type ON actors (actor_type);


-- ============================================================
-- 2. ORGANIZATIONS — shops, dealerships, auction houses, etc.
--    First-class entities, NOT a flag on actors.
--    An org employs/contracts actors via org_memberships.
-- ============================================================

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  name TEXT NOT NULL,
  legal_name TEXT,
  slug TEXT UNIQUE,
  description TEXT,
  logo_url TEXT,
  website TEXT,
  phone TEXT,
  email TEXT,

  -- Location
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  country TEXT DEFAULT 'US',
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),

  -- Classification
  org_type TEXT NOT NULL,
  specialties TEXT[],
  specialty_makes TEXT[],
  specialty_eras TEXT[],

  -- Capacity
  employee_count INTEGER,
  bay_count INTEGER,
  sq_footage INTEGER,
  max_concurrent_projects INTEGER,

  -- Infrastructure booleans
  has_paint_booth BOOLEAN DEFAULT FALSE,
  has_dyno BOOLEAN DEFAULT FALSE,
  has_lift_count INTEGER DEFAULT 0,
  has_machine_shop BOOLEAN DEFAULT FALSE,
  has_fabrication BOOLEAN DEFAULT FALSE,
  has_upholstery BOOLEAN DEFAULT FALSE,
  has_climate_storage BOOLEAN DEFAULT FALSE,
  has_media_blasting BOOLEAN DEFAULT FALSE,
  has_rotisserie BOOLEAN DEFAULT FALSE,
  has_frame_jig BOOLEAN DEFAULT FALSE,
  has_alignment_rack BOOLEAN DEFAULT FALSE,

  -- Financial
  hourly_rate_cents INTEGER,
  typical_project_range_low_cents INTEGER,
  typical_project_range_high_cents INTEGER,
  currency TEXT DEFAULT 'USD',

  -- Trust (COMPUTED — never written directly)
  trust_score INTEGER,
  total_documented_jobs INTEGER DEFAULT 0,
  years_in_business INTEGER,
  founded_year INTEGER,

  -- Source tracking
  source TEXT,
  source_url TEXT,
  source_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE organizations ADD CONSTRAINT chk_org_type
  CHECK (org_type IN (
    'shop', 'dealer', 'auction_house', 'parts_supplier',
    'restoration_house', 'museum', 'club', 'insurance',
    'finance', 'transport', 'machine_shop', 'body_shop',
    'paint_shop', 'upholstery_shop', 'fabrication_shop',
    'performance_shop', 'race_shop', 'detailer', 'storage',
    'appraisal_firm', 'media', 'registry', 'salvage_yard'
  ));

ALTER TABLE organizations ADD CONSTRAINT chk_org_trust_score
  CHECK (trust_score IS NULL OR (trust_score >= 0 AND trust_score <= 100));

ALTER TABLE organizations ADD CONSTRAINT chk_org_employee_count
  CHECK (employee_count IS NULL OR employee_count >= 0);

ALTER TABLE organizations ADD CONSTRAINT chk_org_bay_count
  CHECK (bay_count IS NULL OR bay_count >= 0);

ALTER TABLE organizations ADD CONSTRAINT chk_org_sq_footage
  CHECK (sq_footage IS NULL OR sq_footage >= 0);

ALTER TABLE organizations ADD CONSTRAINT chk_org_max_concurrent
  CHECK (max_concurrent_projects IS NULL OR max_concurrent_projects >= 0);

ALTER TABLE organizations ADD CONSTRAINT chk_org_lift_count
  CHECK (has_lift_count IS NULL OR has_lift_count >= 0);

ALTER TABLE organizations ADD CONSTRAINT chk_org_hourly_rate
  CHECK (hourly_rate_cents IS NULL OR hourly_rate_cents >= 0);

ALTER TABLE organizations ADD CONSTRAINT chk_org_project_range
  CHECK (
    (typical_project_range_low_cents IS NULL AND typical_project_range_high_cents IS NULL)
    OR (typical_project_range_low_cents IS NULL)
    OR (typical_project_range_high_cents IS NULL)
    OR (typical_project_range_low_cents <= typical_project_range_high_cents)
  );

ALTER TABLE organizations ADD CONSTRAINT chk_org_documented_jobs
  CHECK (total_documented_jobs IS NULL OR total_documented_jobs >= 0);

ALTER TABLE organizations ADD CONSTRAINT chk_org_founded_year
  CHECK (founded_year IS NULL OR (founded_year >= 1800 AND founded_year <= 2100));

ALTER TABLE organizations ADD CONSTRAINT chk_org_years_in_business
  CHECK (years_in_business IS NULL OR years_in_business >= 0);

ALTER TABLE organizations ADD CONSTRAINT chk_org_latitude
  CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90));

ALTER TABLE organizations ADD CONSTRAINT chk_org_longitude
  CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180));

CREATE INDEX idx_organizations_org_type ON organizations (org_type);
CREATE INDEX idx_organizations_city_state ON organizations (state, city);
CREATE INDEX idx_organizations_location ON organizations (latitude, longitude) WHERE latitude IS NOT NULL;
CREATE INDEX idx_organizations_specialties ON organizations USING GIN (specialties);
CREATE INDEX idx_organizations_specialty_makes ON organizations USING GIN (specialty_makes);
CREATE INDEX idx_organizations_slug ON organizations (slug) WHERE slug IS NOT NULL;

COMMENT ON TABLE organizations IS 'Shops, dealerships, auction houses, and other institutional entities. First-class — NOT a flag on actors. Actors link to orgs via org_memberships.';
COMMENT ON COLUMN organizations.id IS 'Primary key.';
COMMENT ON COLUMN organizations.name IS 'Display/trade name of the organization, e.g. Precision Performance Engines.';
COMMENT ON COLUMN organizations.legal_name IS 'Registered legal name if different from trade name.';
COMMENT ON COLUMN organizations.slug IS 'URL-safe unique slug for the org, e.g. precision-performance-engines.';
COMMENT ON COLUMN organizations.description IS 'Freeform description of what the org does, their history, and specialties.';
COMMENT ON COLUMN organizations.logo_url IS 'URL to org logo in the vehicle-photos bucket.';
COMMENT ON COLUMN organizations.website IS 'Organization website URL.';
COMMENT ON COLUMN organizations.phone IS 'Primary contact phone number.';
COMMENT ON COLUMN organizations.email IS 'Primary contact email address.';
COMMENT ON COLUMN organizations.address IS 'Street address.';
COMMENT ON COLUMN organizations.city IS 'City for structured location queries.';
COMMENT ON COLUMN organizations.state IS 'State/province for structured location queries.';
COMMENT ON COLUMN organizations.zip IS 'ZIP/postal code.';
COMMENT ON COLUMN organizations.country IS 'ISO country code, defaults to US.';
COMMENT ON COLUMN organizations.latitude IS 'Latitude for geo queries, WGS84.';
COMMENT ON COLUMN organizations.longitude IS 'Longitude for geo queries, WGS84.';
COMMENT ON COLUMN organizations.org_type IS 'Classification: shop, dealer, auction_house, parts_supplier, restoration_house, museum, club, insurance, finance, transport, machine_shop, body_shop, paint_shop, upholstery_shop, fabrication_shop, performance_shop, race_shop, detailer, storage, appraisal_firm, media, registry, salvage_yard.';
COMMENT ON COLUMN organizations.specialties IS 'Array of specialization tags, e.g. {engine_building, concours_restoration, rust_repair}.';
COMMENT ON COLUMN organizations.specialty_makes IS 'Array of vehicle makes this org specializes in, e.g. {porsche, ferrari, alfa_romeo}.';
COMMENT ON COLUMN organizations.specialty_eras IS 'Array of era tags: pre_war, brass_era, classic, post_war, muscle_era, malaise_era, classic_european, japanese_classic, modern_performance, contemporary.';
COMMENT ON COLUMN organizations.employee_count IS 'Current number of employees. May be estimated.';
COMMENT ON COLUMN organizations.bay_count IS 'Number of service/work bays.';
COMMENT ON COLUMN organizations.sq_footage IS 'Total shop square footage.';
COMMENT ON COLUMN organizations.max_concurrent_projects IS 'Maximum simultaneous projects the org can handle.';
COMMENT ON COLUMN organizations.has_paint_booth IS 'True if org has a dedicated paint booth.';
COMMENT ON COLUMN organizations.has_dyno IS 'True if org has a dynamometer.';
COMMENT ON COLUMN organizations.has_lift_count IS 'Number of vehicle lifts. 0 = none.';
COMMENT ON COLUMN organizations.has_machine_shop IS 'True if org has in-house machining capability (lathe, mill, hone).';
COMMENT ON COLUMN organizations.has_fabrication IS 'True if org can do metal fabrication (welding, bending, forming).';
COMMENT ON COLUMN organizations.has_upholstery IS 'True if org has in-house upholstery capability.';
COMMENT ON COLUMN organizations.has_climate_storage IS 'True if org offers climate-controlled vehicle storage.';
COMMENT ON COLUMN organizations.has_media_blasting IS 'True if org has media blasting (soda, walnut, glass bead) equipment.';
COMMENT ON COLUMN organizations.has_rotisserie IS 'True if org has a vehicle rotisserie for body/frame restoration.';
COMMENT ON COLUMN organizations.has_frame_jig IS 'True if org has a frame straightening jig.';
COMMENT ON COLUMN organizations.has_alignment_rack IS 'True if org has a wheel alignment rack/machine.';
COMMENT ON COLUMN organizations.hourly_rate_cents IS 'Standard shop hourly rate in cents. 15000 = $150/hr.';
COMMENT ON COLUMN organizations.typical_project_range_low_cents IS 'Low end of typical project cost in cents. Used for rough matching.';
COMMENT ON COLUMN organizations.typical_project_range_high_cents IS 'High end of typical project cost in cents.';
COMMENT ON COLUMN organizations.currency IS 'ISO 4217 currency code for rates, defaults to USD.';
COMMENT ON COLUMN organizations.trust_score IS 'COMPUTED: Platform trust rating 0-100. Derived from evidence chain quality across all documented jobs. Never written directly.';
COMMENT ON COLUMN organizations.total_documented_jobs IS 'COMPUTED: Count of work_orders completed by this org. Never written directly.';
COMMENT ON COLUMN organizations.years_in_business IS 'Years the org has been operating. Can be computed from founded_year or entered directly.';
COMMENT ON COLUMN organizations.founded_year IS 'Year the organization was founded/established.';
COMMENT ON COLUMN organizations.source IS 'How this org record was created: manual, extracted, discovered, imported.';
COMMENT ON COLUMN organizations.source_url IS 'URL where this org was discovered, if applicable.';
COMMENT ON COLUMN organizations.source_id IS 'External identifier from the source system.';
COMMENT ON COLUMN organizations.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN organizations.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 3. ORG_MEMBERSHIPS — Actor <-> Organization relationships
--    Tracks careers: who worked where, when, in what role.
--    End_date NULL = currently active at this org.
-- ============================================================

CREATE TABLE org_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  role TEXT NOT NULL,
  title TEXT,
  is_primary BOOLEAN DEFAULT TRUE,

  start_date DATE,
  end_date DATE,

  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE org_memberships ADD CONSTRAINT chk_om_role
  CHECK (role IN (
    'owner', 'partner', 'lead_tech', 'senior_tech', 'journeyman',
    'apprentice', 'specialist', 'contractor', 'consultant',
    'manager', 'service_writer', 'parts_manager', 'detailer'
  ));

ALTER TABLE org_memberships ADD CONSTRAINT chk_om_dates
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date);

-- Prevent exact duplicate memberships (same actor, same org, same role, overlapping dates)
CREATE UNIQUE INDEX idx_org_memberships_unique_active
  ON org_memberships (actor_id, org_id, role)
  WHERE end_date IS NULL;

CREATE INDEX idx_org_memberships_actor ON org_memberships (actor_id);
CREATE INDEX idx_org_memberships_org ON org_memberships (org_id);
CREATE INDEX idx_org_memberships_active ON org_memberships (org_id) WHERE end_date IS NULL;

COMMENT ON TABLE org_memberships IS 'Links actors to organizations with role and tenure. Tracks employment/contractor history. end_date NULL = currently active.';
COMMENT ON COLUMN org_memberships.id IS 'Primary key.';
COMMENT ON COLUMN org_memberships.actor_id IS 'FK to actors(id). The person.';
COMMENT ON COLUMN org_memberships.org_id IS 'FK to organizations(id). The organization.';
COMMENT ON COLUMN org_memberships.role IS 'Role at the org: owner, partner, lead_tech, senior_tech, journeyman, apprentice, specialist, contractor, consultant, manager, service_writer, parts_manager, detailer.';
COMMENT ON COLUMN org_memberships.title IS 'Specific job title if different from role, e.g. Head Engine Builder.';
COMMENT ON COLUMN org_memberships.is_primary IS 'True if this is the actor primary/main organization. An actor may contract at multiple orgs.';
COMMENT ON COLUMN org_memberships.start_date IS 'Date the actor started at this org. NULL if unknown.';
COMMENT ON COLUMN org_memberships.end_date IS 'Date the actor left this org. NULL = still active.';
COMMENT ON COLUMN org_memberships.notes IS 'Freeform notes about this membership, e.g. reason for leaving, specialty within the org.';
COMMENT ON COLUMN org_memberships.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN org_memberships.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 4. ACTOR_CAPABILITIES — What an actor has PROVEN they can do
--    One row per proven capability at a given complexity tier.
--    NOT self-reported. Derived from component_events.
-- ============================================================

CREATE TABLE actor_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES actors(id) ON DELETE CASCADE,

  capability_type TEXT NOT NULL,
  complexity_tier TEXT NOT NULL DEFAULT 'basic',

  -- Evidence chain
  evidence_count INTEGER NOT NULL DEFAULT 0,
  first_demonstrated DATE,
  last_demonstrated DATE,

  -- Quality signal
  best_outcome_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  best_outcome_description TEXT,
  avg_spec_compliance NUMERIC(5,2),

  -- Metadata
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE actor_capabilities ADD CONSTRAINT chk_ac_capability_type
  CHECK (capability_type IN (
    'engine_machining', 'engine_assembly', 'engine_tuning', 'engine_diagnostics',
    'transmission_rebuild', 'differential_rebuild', 'transfer_case_rebuild',
    'brake_rebuild', 'brake_fabrication', 'suspension_rebuild', 'suspension_fabrication',
    'steering_rebuild', 'steering_fabrication',
    'paint_refinish', 'paint_correction', 'paint_custom',
    'body_repair', 'body_fabrication', 'rust_repair', 'panel_replacement',
    'frame_repair', 'frame_fabrication', 'frame_reinforcement',
    'upholstery_repair', 'upholstery_full', 'convertible_top',
    'electrical_repair', 'electrical_custom', 'wiring_harness',
    'welding_mig', 'welding_tig', 'welding_stick', 'welding_gas', 'welding_brazing',
    'fabrication_sheet_metal', 'fabrication_tube', 'fabrication_exhaust',
    'glass_installation', 'glass_fabrication',
    'chrome_plating', 'powder_coating', 'anodizing',
    'machine_lathe', 'machine_mill', 'machine_cnc', 'machine_hone', 'machine_grind',
    'appraisal', 'inspection', 'documentation', 'judging',
    'transport', 'storage', 'detailing',
    'general_maintenance', 'diagnostics_obd', 'diagnostics_analog',
    'fuel_system', 'cooling_system', 'exhaust_system', 'intake_system',
    'ac_system', 'audio_system', 'hydraulics'
  ));

ALTER TABLE actor_capabilities ADD CONSTRAINT chk_ac_complexity_tier
  CHECK (complexity_tier IN ('basic', 'intermediate', 'advanced', 'expert', 'master'));

ALTER TABLE actor_capabilities ADD CONSTRAINT chk_ac_evidence_count
  CHECK (evidence_count >= 0);

ALTER TABLE actor_capabilities ADD CONSTRAINT chk_ac_spec_compliance
  CHECK (avg_spec_compliance IS NULL OR (avg_spec_compliance >= 0 AND avg_spec_compliance <= 100));

ALTER TABLE actor_capabilities ADD CONSTRAINT chk_ac_dates
  CHECK (last_demonstrated IS NULL OR first_demonstrated IS NULL OR last_demonstrated >= first_demonstrated);

-- One row per actor per capability per tier
CREATE UNIQUE INDEX idx_actor_capabilities_unique
  ON actor_capabilities (actor_id, capability_type, complexity_tier);

CREATE INDEX idx_actor_capabilities_actor ON actor_capabilities (actor_id);
CREATE INDEX idx_actor_capabilities_type ON actor_capabilities (capability_type);
CREATE INDEX idx_actor_capabilities_tier ON actor_capabilities (capability_type, complexity_tier);

COMMENT ON TABLE actor_capabilities IS 'Proven capabilities for an actor. One row per capability at each complexity tier. NEVER self-reported — derived from component_events evidence chain. evidence_count = how many documented jobs at this tier.';
COMMENT ON COLUMN actor_capabilities.id IS 'Primary key.';
COMMENT ON COLUMN actor_capabilities.actor_id IS 'FK to actors(id). The actor who demonstrated this capability.';
COMMENT ON COLUMN actor_capabilities.capability_type IS 'The specific capability proven, e.g. engine_machining, paint_refinish, brake_rebuild. Full taxonomy in CHECK constraint.';
COMMENT ON COLUMN actor_capabilities.complexity_tier IS 'Demonstrated complexity level: basic, intermediate, advanced, expert, master. Tier is evidence-based, not self-assessed.';
COMMENT ON COLUMN actor_capabilities.evidence_count IS 'Number of component_events documenting this capability at this tier. Higher = more confidence.';
COMMENT ON COLUMN actor_capabilities.first_demonstrated IS 'Earliest component_event date showing this capability at this tier.';
COMMENT ON COLUMN actor_capabilities.last_demonstrated IS 'Most recent component_event date showing this capability at this tier. Recency matters for trust.';
COMMENT ON COLUMN actor_capabilities.best_outcome_vehicle_id IS 'FK to vehicles(id). Link to the vehicle with the best documented outcome for this capability. Used for portfolio/showcase.';
COMMENT ON COLUMN actor_capabilities.best_outcome_description IS 'Short description of the best outcome, e.g. Block machined to 4.030 +/- 0.0005, all 8 cylinders within 0.0002.';
COMMENT ON COLUMN actor_capabilities.avg_spec_compliance IS 'Average percentage of spec targets met across all documented jobs for this capability. 0-100. NULL if no spec targets were defined.';
COMMENT ON COLUMN actor_capabilities.notes IS 'Freeform notes about this capability.';
COMMENT ON COLUMN actor_capabilities.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN actor_capabilities.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 5. ACTOR_TOOLS — Equipment an actor or org has access to
--    Answers: "Does this shop have the equipment for the job?"
-- ============================================================

CREATE TABLE actor_tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Polymorphic owner: exactly one of these must be set
  actor_id UUID REFERENCES actors(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

  tool_name TEXT NOT NULL,
  tool_category TEXT NOT NULL,
  manufacturer TEXT,
  model TEXT,
  serial_number TEXT,

  -- Precision/capability rating
  precision_rating TEXT,
  max_capacity TEXT,
  condition_grade TEXT DEFAULT 'unknown',

  -- Ownership
  is_owned BOOLEAN DEFAULT TRUE,
  acquisition_year INTEGER,
  last_calibrated DATE,

  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Exactly one owner required
ALTER TABLE actor_tools ADD CONSTRAINT chk_at_owner
  CHECK (
    (actor_id IS NOT NULL AND org_id IS NULL)
    OR (actor_id IS NULL AND org_id IS NOT NULL)
  );

ALTER TABLE actor_tools ADD CONSTRAINT chk_at_tool_category
  CHECK (tool_category IN (
    'machining', 'measuring', 'welding', 'painting', 'lifting',
    'diagnostics', 'cleaning', 'fabrication', 'finishing',
    'alignment', 'balancing', 'pressing', 'boring', 'honing',
    'grinding', 'cutting', 'bending', 'blasting', 'dyno',
    'electrical_test', 'hand_tool', 'power_tool', 'specialty',
    'storage', 'transport', 'safety', 'climate_control', 'other'
  ));

ALTER TABLE actor_tools ADD CONSTRAINT chk_at_condition
  CHECK (condition_grade IN ('excellent', 'good', 'fair', 'poor', 'failed', 'unknown'));

ALTER TABLE actor_tools ADD CONSTRAINT chk_at_acquisition_year
  CHECK (acquisition_year IS NULL OR (acquisition_year >= 1900 AND acquisition_year <= 2100));

CREATE INDEX idx_actor_tools_actor ON actor_tools (actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX idx_actor_tools_org ON actor_tools (org_id) WHERE org_id IS NOT NULL;
CREATE INDEX idx_actor_tools_category ON actor_tools (tool_category);

COMMENT ON TABLE actor_tools IS 'Equipment and tools available to an actor or organization. Answers the question: does this shop have the equipment for the job? Polymorphic: set either actor_id or org_id, not both.';
COMMENT ON COLUMN actor_tools.id IS 'Primary key.';
COMMENT ON COLUMN actor_tools.actor_id IS 'FK to actors(id). Set if tool belongs to an individual actor. Mutually exclusive with org_id.';
COMMENT ON COLUMN actor_tools.org_id IS 'FK to organizations(id). Set if tool belongs to an organization. Mutually exclusive with actor_id.';
COMMENT ON COLUMN actor_tools.tool_name IS 'Human-readable tool name, e.g. Sunnen CK-10 Cylinder Hone.';
COMMENT ON COLUMN actor_tools.tool_category IS 'Tool category: machining, measuring, welding, painting, lifting, diagnostics, cleaning, fabrication, finishing, alignment, balancing, pressing, boring, honing, grinding, cutting, bending, blasting, dyno, electrical_test, hand_tool, power_tool, specialty, storage, transport, safety, climate_control, other.';
COMMENT ON COLUMN actor_tools.manufacturer IS 'Tool manufacturer, e.g. Sunnen, Snap-on, Lincoln, SATA.';
COMMENT ON COLUMN actor_tools.model IS 'Tool model designation, e.g. CK-10, KRL1023, Power MIG 256.';
COMMENT ON COLUMN actor_tools.serial_number IS 'Serial number for high-value or calibrated equipment.';
COMMENT ON COLUMN actor_tools.precision_rating IS 'Precision capability description, e.g. +/- 0.0001 inch, 0.001mm resolution.';
COMMENT ON COLUMN actor_tools.max_capacity IS 'Maximum capacity description, e.g. 50 ton press, 6 inch bore, 5000 CFM.';
COMMENT ON COLUMN actor_tools.condition_grade IS 'Current condition: excellent, good, fair, poor, failed, unknown.';
COMMENT ON COLUMN actor_tools.is_owned IS 'True if owned, false if leased/rented/borrowed.';
COMMENT ON COLUMN actor_tools.acquisition_year IS 'Year the tool was acquired.';
COMMENT ON COLUMN actor_tools.last_calibrated IS 'Last calibration date for precision measuring equipment.';
COMMENT ON COLUMN actor_tools.notes IS 'Freeform notes about the tool.';
COMMENT ON COLUMN actor_tools.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN actor_tools.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 6. ORG_CAPABILITIES — Proven organizational capabilities
--    Same pattern as actor_capabilities but aggregated across
--    all actors who are/were members of this org.
-- ============================================================

CREATE TABLE org_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  capability_type TEXT NOT NULL,
  complexity_tier TEXT NOT NULL DEFAULT 'basic',

  -- Evidence chain (aggregated across all member actors)
  evidence_count INTEGER NOT NULL DEFAULT 0,
  contributing_actor_count INTEGER NOT NULL DEFAULT 0,
  first_demonstrated DATE,
  last_demonstrated DATE,

  -- Quality signal
  best_outcome_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  best_outcome_description TEXT,
  avg_spec_compliance NUMERIC(5,2),

  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reuse the same capability_type taxonomy as actor_capabilities
ALTER TABLE org_capabilities ADD CONSTRAINT chk_oc_capability_type
  CHECK (capability_type IN (
    'engine_machining', 'engine_assembly', 'engine_tuning', 'engine_diagnostics',
    'transmission_rebuild', 'differential_rebuild', 'transfer_case_rebuild',
    'brake_rebuild', 'brake_fabrication', 'suspension_rebuild', 'suspension_fabrication',
    'steering_rebuild', 'steering_fabrication',
    'paint_refinish', 'paint_correction', 'paint_custom',
    'body_repair', 'body_fabrication', 'rust_repair', 'panel_replacement',
    'frame_repair', 'frame_fabrication', 'frame_reinforcement',
    'upholstery_repair', 'upholstery_full', 'convertible_top',
    'electrical_repair', 'electrical_custom', 'wiring_harness',
    'welding_mig', 'welding_tig', 'welding_stick', 'welding_gas', 'welding_brazing',
    'fabrication_sheet_metal', 'fabrication_tube', 'fabrication_exhaust',
    'glass_installation', 'glass_fabrication',
    'chrome_plating', 'powder_coating', 'anodizing',
    'machine_lathe', 'machine_mill', 'machine_cnc', 'machine_hone', 'machine_grind',
    'appraisal', 'inspection', 'documentation', 'judging',
    'transport', 'storage', 'detailing',
    'general_maintenance', 'diagnostics_obd', 'diagnostics_analog',
    'fuel_system', 'cooling_system', 'exhaust_system', 'intake_system',
    'ac_system', 'audio_system', 'hydraulics'
  ));

ALTER TABLE org_capabilities ADD CONSTRAINT chk_oc_complexity_tier
  CHECK (complexity_tier IN ('basic', 'intermediate', 'advanced', 'expert', 'master'));

ALTER TABLE org_capabilities ADD CONSTRAINT chk_oc_evidence_count
  CHECK (evidence_count >= 0);

ALTER TABLE org_capabilities ADD CONSTRAINT chk_oc_contributing_actors
  CHECK (contributing_actor_count >= 0);

ALTER TABLE org_capabilities ADD CONSTRAINT chk_oc_spec_compliance
  CHECK (avg_spec_compliance IS NULL OR (avg_spec_compliance >= 0 AND avg_spec_compliance <= 100));

ALTER TABLE org_capabilities ADD CONSTRAINT chk_oc_dates
  CHECK (last_demonstrated IS NULL OR first_demonstrated IS NULL OR last_demonstrated >= first_demonstrated);

CREATE UNIQUE INDEX idx_org_capabilities_unique
  ON org_capabilities (org_id, capability_type, complexity_tier);

CREATE INDEX idx_org_capabilities_org ON org_capabilities (org_id);
CREATE INDEX idx_org_capabilities_type ON org_capabilities (capability_type);

COMMENT ON TABLE org_capabilities IS 'Proven organizational capabilities. Same structure as actor_capabilities but aggregated across all member actors. DERIVED from component_events performed by actors during their org membership tenure. Never self-reported.';
COMMENT ON COLUMN org_capabilities.id IS 'Primary key.';
COMMENT ON COLUMN org_capabilities.org_id IS 'FK to organizations(id). The org that demonstrated this capability.';
COMMENT ON COLUMN org_capabilities.capability_type IS 'The specific capability proven. Same taxonomy as actor_capabilities.';
COMMENT ON COLUMN org_capabilities.complexity_tier IS 'Demonstrated complexity level: basic, intermediate, advanced, expert, master.';
COMMENT ON COLUMN org_capabilities.evidence_count IS 'Total component_events across all member actors documenting this capability at this tier.';
COMMENT ON COLUMN org_capabilities.contributing_actor_count IS 'Number of distinct actors who contributed evidence for this capability. Higher = more institutional depth (not dependent on one person).';
COMMENT ON COLUMN org_capabilities.first_demonstrated IS 'Earliest component_event date showing this capability at this org.';
COMMENT ON COLUMN org_capabilities.last_demonstrated IS 'Most recent component_event date showing this capability at this org.';
COMMENT ON COLUMN org_capabilities.best_outcome_vehicle_id IS 'FK to vehicles(id). Link to the best documented result for this capability at this org.';
COMMENT ON COLUMN org_capabilities.best_outcome_description IS 'Short description of the best outcome.';
COMMENT ON COLUMN org_capabilities.avg_spec_compliance IS 'Average spec compliance across all documented jobs. 0-100.';
COMMENT ON COLUMN org_capabilities.notes IS 'Freeform notes.';
COMMENT ON COLUMN org_capabilities.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN org_capabilities.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 7. WORK_ORDERS — The master linking table
--    A work_order is a project: one org, one vehicle, defined scope.
--    Connects the vehicle layer to the actor/org layer.
-- ============================================================

CREATE TABLE work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  lead_actor_id UUID REFERENCES actors(id) ON DELETE SET NULL,
  requesting_actor_id UUID REFERENCES actors(id) ON DELETE SET NULL,

  -- Work order identity
  work_order_number TEXT,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'quoted',

  -- Scope
  scope_description TEXT,
  scope_category TEXT,

  -- Financial
  estimated_cost_cents INTEGER,
  actual_cost_cents INTEGER,
  deposit_cents INTEGER,
  currency TEXT DEFAULT 'USD',

  -- Timeline
  estimated_days INTEGER,
  actual_days INTEGER,
  quoted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  warranty_until DATE,

  -- Quality
  satisfaction_score INTEGER,
  satisfaction_notes TEXT,

  -- Evidence
  evidence_ids UUID[],

  -- Metadata
  notes TEXT,
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE work_orders ADD CONSTRAINT chk_wo_status
  CHECK (status IN (
    'quoted', 'approved', 'in_progress', 'on_hold', 'completed',
    'warranty', 'disputed', 'cancelled', 'rejected'
  ));

ALTER TABLE work_orders ADD CONSTRAINT chk_wo_scope_category
  CHECK (scope_category IS NULL OR scope_category IN (
    'engine', 'transmission', 'differential', 'suspension', 'brakes',
    'steering', 'body', 'paint', 'frame', 'interior', 'electrical',
    'exhaust', 'fuel_system', 'cooling', 'ac', 'glass', 'chrome',
    'wheels_tires', 'full_restoration', 'partial_restoration',
    'maintenance', 'inspection', 'appraisal', 'transport', 'storage',
    'detailing', 'documentation', 'fabrication', 'custom', 'other'
  ));

ALTER TABLE work_orders ADD CONSTRAINT chk_wo_estimated_cost
  CHECK (estimated_cost_cents IS NULL OR estimated_cost_cents >= 0);

ALTER TABLE work_orders ADD CONSTRAINT chk_wo_actual_cost
  CHECK (actual_cost_cents IS NULL OR actual_cost_cents >= 0);

ALTER TABLE work_orders ADD CONSTRAINT chk_wo_deposit
  CHECK (deposit_cents IS NULL OR deposit_cents >= 0);

ALTER TABLE work_orders ADD CONSTRAINT chk_wo_estimated_days
  CHECK (estimated_days IS NULL OR estimated_days >= 0);

ALTER TABLE work_orders ADD CONSTRAINT chk_wo_actual_days
  CHECK (actual_days IS NULL OR actual_days >= 0);

ALTER TABLE work_orders ADD CONSTRAINT chk_wo_satisfaction
  CHECK (satisfaction_score IS NULL OR (satisfaction_score >= 1 AND satisfaction_score <= 10));

CREATE INDEX idx_work_orders_vehicle ON work_orders (vehicle_id);
CREATE INDEX idx_work_orders_org ON work_orders (org_id) WHERE org_id IS NOT NULL;
CREATE INDEX idx_work_orders_lead_actor ON work_orders (lead_actor_id) WHERE lead_actor_id IS NOT NULL;
CREATE INDEX idx_work_orders_status ON work_orders (status);
CREATE INDEX idx_work_orders_scope_cat ON work_orders (scope_category) WHERE scope_category IS NOT NULL;
CREATE INDEX idx_work_orders_completed ON work_orders (completed_at) WHERE completed_at IS NOT NULL;

COMMENT ON TABLE work_orders IS 'Master linking table between vehicles, organizations, and actors. A work_order is a project: one org, one vehicle, defined scope and timeline. Contains financial, timeline, and quality data. Individual tasks within the work order go in work_order_line_items.';
COMMENT ON COLUMN work_orders.id IS 'Primary key.';
COMMENT ON COLUMN work_orders.vehicle_id IS 'FK to vehicles(id). The vehicle being worked on.';
COMMENT ON COLUMN work_orders.org_id IS 'FK to organizations(id). The shop/org performing the work. NULL if individual actor working independently.';
COMMENT ON COLUMN work_orders.lead_actor_id IS 'FK to actors(id). The primary technician/builder responsible for this work order.';
COMMENT ON COLUMN work_orders.requesting_actor_id IS 'FK to actors(id). The vehicle owner or person who requested the work.';
COMMENT ON COLUMN work_orders.work_order_number IS 'Shop-internal work order or invoice number for cross-referencing paper records.';
COMMENT ON COLUMN work_orders.title IS 'Short descriptive title, e.g. 350 SBC Rebuild, Full Respray in Code 72 Blue.';
COMMENT ON COLUMN work_orders.status IS 'Current status: quoted, approved, in_progress, on_hold, completed, warranty, disputed, cancelled, rejected.';
COMMENT ON COLUMN work_orders.scope_description IS 'Detailed description of the work scope. What was agreed upon.';
COMMENT ON COLUMN work_orders.scope_category IS 'High-level category: engine, transmission, body, paint, full_restoration, maintenance, inspection, etc.';
COMMENT ON COLUMN work_orders.estimated_cost_cents IS 'Quoted cost in cents. 500000 = $5,000.00.';
COMMENT ON COLUMN work_orders.actual_cost_cents IS 'Final actual cost in cents. May differ from estimate.';
COMMENT ON COLUMN work_orders.deposit_cents IS 'Deposit paid in cents.';
COMMENT ON COLUMN work_orders.currency IS 'ISO 4217 currency code, defaults to USD.';
COMMENT ON COLUMN work_orders.estimated_days IS 'Quoted turnaround time in calendar days.';
COMMENT ON COLUMN work_orders.actual_days IS 'Actual elapsed calendar days from start to completion.';
COMMENT ON COLUMN work_orders.quoted_at IS 'When the quote was provided.';
COMMENT ON COLUMN work_orders.approved_at IS 'When the customer approved the work.';
COMMENT ON COLUMN work_orders.started_at IS 'When work actually began.';
COMMENT ON COLUMN work_orders.completed_at IS 'When work was completed and vehicle returned/delivered.';
COMMENT ON COLUMN work_orders.warranty_until IS 'Warranty expiration date, if warranty was offered.';
COMMENT ON COLUMN work_orders.satisfaction_score IS 'Customer satisfaction 1-10. NOT the primary quality signal — spec compliance from line items is the real measure. This is subjective sentiment.';
COMMENT ON COLUMN work_orders.satisfaction_notes IS 'Customer feedback text.';
COMMENT ON COLUMN work_orders.evidence_ids IS 'Array of field_evidence.id UUIDs supporting this work order (invoices, photos, receipts).';
COMMENT ON COLUMN work_orders.notes IS 'Internal notes about this work order.';
COMMENT ON COLUMN work_orders.metadata IS 'Extensible JSON for work-order-specific data not covered by columns.';
COMMENT ON COLUMN work_orders.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN work_orders.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 8. WORK_ORDER_LINE_ITEMS — Individual tasks within a work order
--    Each line item maps to a specific component that was worked on,
--    who did the work, what spec was targeted, and what was achieved.
--    These rows DIRECTLY feed actor_capabilities and org_capabilities.
-- ============================================================

CREATE TABLE work_order_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,

  -- What was worked on (polymorphic component reference)
  component_table TEXT,
  component_id UUID,

  -- The task
  line_number INTEGER,
  task_type TEXT NOT NULL,
  task_description TEXT,

  -- Who did it
  actor_id UUID REFERENCES actors(id) ON DELETE SET NULL,

  -- Spec compliance: the real quality signal
  spec_target TEXT,
  spec_achieved TEXT,
  spec_in_tolerance BOOLEAN,

  -- Parts
  parts_used JSONB DEFAULT '[]',

  -- Labor
  hours_labor NUMERIC(6,2),
  labor_rate_cents INTEGER,

  -- Financial
  parts_cost_cents INTEGER,
  total_cost_cents INTEGER,

  -- Status
  status TEXT NOT NULL DEFAULT 'pending',

  -- Link to component_events (the evidence)
  component_event_id UUID REFERENCES component_events(id) ON DELETE SET NULL,

  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE work_order_line_items ADD CONSTRAINT chk_woli_task_type
  CHECK (task_type IN (
    'rebuild', 'replace', 'repair', 'inspect', 'fabricate',
    'refinish', 'install', 'remove', 'clean', 'test',
    'measure', 'adjust', 'machine', 'weld', 'paint',
    'plate', 'coat', 'upholster', 'wire', 'diagnose',
    'source', 'custom', 'other'
  ));

ALTER TABLE work_order_line_items ADD CONSTRAINT chk_woli_status
  CHECK (status IN ('pending', 'in_progress', 'complete', 'rework', 'skipped', 'cancelled'));

ALTER TABLE work_order_line_items ADD CONSTRAINT chk_woli_hours
  CHECK (hours_labor IS NULL OR hours_labor >= 0);

ALTER TABLE work_order_line_items ADD CONSTRAINT chk_woli_labor_rate
  CHECK (labor_rate_cents IS NULL OR labor_rate_cents >= 0);

ALTER TABLE work_order_line_items ADD CONSTRAINT chk_woli_parts_cost
  CHECK (parts_cost_cents IS NULL OR parts_cost_cents >= 0);

ALTER TABLE work_order_line_items ADD CONSTRAINT chk_woli_total_cost
  CHECK (total_cost_cents IS NULL OR total_cost_cents >= 0);

CREATE INDEX idx_woli_work_order ON work_order_line_items (work_order_id);
CREATE INDEX idx_woli_actor ON work_order_line_items (actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX idx_woli_component ON work_order_line_items (component_table, component_id)
  WHERE component_table IS NOT NULL;
CREATE INDEX idx_woli_task_type ON work_order_line_items (task_type);
CREATE INDEX idx_woli_status ON work_order_line_items (status);
CREATE INDEX idx_woli_component_event ON work_order_line_items (component_event_id)
  WHERE component_event_id IS NOT NULL;

COMMENT ON TABLE work_order_line_items IS 'Individual tasks within a work order. Each row maps to a specific component worked on, who did the work, spec target vs achieved, parts used, and labor. These rows are the atomic unit that feeds actor_capabilities and org_capabilities computation.';
COMMENT ON COLUMN work_order_line_items.id IS 'Primary key.';
COMMENT ON COLUMN work_order_line_items.work_order_id IS 'FK to work_orders(id). Parent work order.';
COMMENT ON COLUMN work_order_line_items.component_table IS 'Name of the component table, e.g. engine_blocks, engine_heads. Same convention as component_events.component_table.';
COMMENT ON COLUMN work_order_line_items.component_id IS 'PK of the row in the component table this task references.';
COMMENT ON COLUMN work_order_line_items.line_number IS 'Optional ordering within the work order. 1-based.';
COMMENT ON COLUMN work_order_line_items.task_type IS 'What was done: rebuild, replace, repair, inspect, fabricate, refinish, install, remove, clean, test, measure, adjust, machine, weld, paint, plate, coat, upholster, wire, diagnose, source, custom, other.';
COMMENT ON COLUMN work_order_line_items.task_description IS 'Detailed description of the specific task performed.';
COMMENT ON COLUMN work_order_line_items.actor_id IS 'FK to actors(id). The specific person who did THIS task. May differ from work_order.lead_actor_id — a shop owner may delegate tasks.';
COMMENT ON COLUMN work_order_line_items.spec_target IS 'The specification target, e.g. 4.030 +/- 0.001 bore, 15 ft-lb torque, Sherwin-Williams Code 72 Blue.';
COMMENT ON COLUMN work_order_line_items.spec_achieved IS 'The measured result, e.g. 4.0305, 14.8 ft-lb. This is the REAL quality signal — objective and measurable.';
COMMENT ON COLUMN work_order_line_items.spec_in_tolerance IS 'True if spec_achieved is within the tolerance defined by spec_target. COMPUTED by comparing target vs achieved.';
COMMENT ON COLUMN work_order_line_items.parts_used IS 'JSONB array of parts: [{part_number, description, manufacturer, source, quantity, unit_cost_cents}]. Detailed parts tracking.';
COMMENT ON COLUMN work_order_line_items.hours_labor IS 'Hours of labor for this specific task.';
COMMENT ON COLUMN work_order_line_items.labor_rate_cents IS 'Hourly labor rate in cents for this task. May differ from org rate for specialty work.';
COMMENT ON COLUMN work_order_line_items.parts_cost_cents IS 'Total parts cost for this line item in cents.';
COMMENT ON COLUMN work_order_line_items.total_cost_cents IS 'Total cost (parts + labor) for this line item in cents.';
COMMENT ON COLUMN work_order_line_items.status IS 'Task status: pending, in_progress, complete, rework, skipped, cancelled.';
COMMENT ON COLUMN work_order_line_items.component_event_id IS 'FK to component_events(id). Links this line item to the evidence record in the universal work log. This is the bridge between work orders and the vehicle component layer.';
COMMENT ON COLUMN work_order_line_items.notes IS 'Freeform notes about this task.';
COMMENT ON COLUMN work_order_line_items.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN work_order_line_items.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 9. GAP_ANALYSIS_RESULTS — "Am I ready?" computations
--    For an actor or org, compared against a target capability
--    and complexity tier. What is missing?
-- ============================================================

CREATE TABLE gap_analysis_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Polymorphic: actor or org
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,

  -- What are we evaluating readiness for?
  target_capability TEXT NOT NULL,
  target_complexity_tier TEXT NOT NULL,

  -- Current state
  current_evidence_count INTEGER NOT NULL DEFAULT 0,
  required_evidence_count INTEGER NOT NULL DEFAULT 0,
  current_complexity_tier TEXT,

  -- Gaps identified
  missing_tools TEXT[],
  missing_certifications TEXT[],
  missing_experience_areas TEXT[],
  missing_equipment_categories TEXT[],

  -- Recommendation
  recommendation TEXT NOT NULL,
  recommendation_detail TEXT,

  -- Validity
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE gap_analysis_results ADD CONSTRAINT chk_gar_entity_type
  CHECK (entity_type IN ('actor', 'org'));

ALTER TABLE gap_analysis_results ADD CONSTRAINT chk_gar_target_tier
  CHECK (target_complexity_tier IN ('basic', 'intermediate', 'advanced', 'expert', 'master'));

ALTER TABLE gap_analysis_results ADD CONSTRAINT chk_gar_current_tier
  CHECK (current_complexity_tier IS NULL OR current_complexity_tier IN ('basic', 'intermediate', 'advanced', 'expert', 'master', 'none'));

ALTER TABLE gap_analysis_results ADD CONSTRAINT chk_gar_recommendation
  CHECK (recommendation IN (
    'ready', 'needs_training', 'needs_equipment',
    'needs_experience', 'needs_partner', 'not_ready'
  ));

ALTER TABLE gap_analysis_results ADD CONSTRAINT chk_gar_evidence_counts
  CHECK (current_evidence_count >= 0 AND required_evidence_count >= 0);

-- Reuse the capability taxonomy
ALTER TABLE gap_analysis_results ADD CONSTRAINT chk_gar_target_capability
  CHECK (target_capability IN (
    'engine_machining', 'engine_assembly', 'engine_tuning', 'engine_diagnostics',
    'transmission_rebuild', 'differential_rebuild', 'transfer_case_rebuild',
    'brake_rebuild', 'brake_fabrication', 'suspension_rebuild', 'suspension_fabrication',
    'steering_rebuild', 'steering_fabrication',
    'paint_refinish', 'paint_correction', 'paint_custom',
    'body_repair', 'body_fabrication', 'rust_repair', 'panel_replacement',
    'frame_repair', 'frame_fabrication', 'frame_reinforcement',
    'upholstery_repair', 'upholstery_full', 'convertible_top',
    'electrical_repair', 'electrical_custom', 'wiring_harness',
    'welding_mig', 'welding_tig', 'welding_stick', 'welding_gas', 'welding_brazing',
    'fabrication_sheet_metal', 'fabrication_tube', 'fabrication_exhaust',
    'glass_installation', 'glass_fabrication',
    'chrome_plating', 'powder_coating', 'anodizing',
    'machine_lathe', 'machine_mill', 'machine_cnc', 'machine_hone', 'machine_grind',
    'appraisal', 'inspection', 'documentation', 'judging',
    'transport', 'storage', 'detailing',
    'general_maintenance', 'diagnostics_obd', 'diagnostics_analog',
    'fuel_system', 'cooling_system', 'exhaust_system', 'intake_system',
    'ac_system', 'audio_system', 'hydraulics'
  ));

CREATE INDEX idx_gar_entity ON gap_analysis_results (entity_type, entity_id);
CREATE INDEX idx_gar_target ON gap_analysis_results (target_capability, target_complexity_tier);
CREATE INDEX idx_gar_recommendation ON gap_analysis_results (recommendation);
CREATE INDEX idx_gar_computed ON gap_analysis_results (computed_at);

COMMENT ON TABLE gap_analysis_results IS 'Pre-computed readiness assessments. For a given actor or org, evaluates whether they have the evidence, tools, certifications, and experience to perform a target capability at a target complexity tier. Ephemeral — recomputed periodically. valid_until indicates when the analysis should be refreshed.';
COMMENT ON COLUMN gap_analysis_results.id IS 'Primary key.';
COMMENT ON COLUMN gap_analysis_results.entity_type IS 'Whether this analysis is for an actor or an org.';
COMMENT ON COLUMN gap_analysis_results.entity_id IS 'UUID of the actor or org being evaluated. Application-level FK — not database-enforced due to polymorphism.';
COMMENT ON COLUMN gap_analysis_results.target_capability IS 'The capability being evaluated for readiness. Same taxonomy as actor_capabilities.capability_type.';
COMMENT ON COLUMN gap_analysis_results.target_complexity_tier IS 'The tier being targeted: basic, intermediate, advanced, expert, master.';
COMMENT ON COLUMN gap_analysis_results.current_evidence_count IS 'How many component_events/work_order_line_items the entity has for this capability.';
COMMENT ON COLUMN gap_analysis_results.required_evidence_count IS 'How many are needed for the target tier. Defined by platform policy, e.g. master requires 50+ documented jobs.';
COMMENT ON COLUMN gap_analysis_results.current_complexity_tier IS 'The entity current proven tier for this capability. NULL or none if no evidence exists.';
COMMENT ON COLUMN gap_analysis_results.missing_tools IS 'Array of tools the entity lacks but needs, e.g. {cylinder_hone, surface_grinder, torque_plate}.';
COMMENT ON COLUMN gap_analysis_results.missing_certifications IS 'Array of certifications the entity lacks, e.g. {ase_engine_rebuild, ncrs_judge_level_2}.';
COMMENT ON COLUMN gap_analysis_results.missing_experience_areas IS 'Array of experience gaps, e.g. {aluminum_block_machining, efi_tuning, 4_cam_timing}.';
COMMENT ON COLUMN gap_analysis_results.missing_equipment_categories IS 'Array of equipment categories needed, e.g. {cnc_machining, dyno, flow_bench}.';
COMMENT ON COLUMN gap_analysis_results.recommendation IS 'Overall readiness: ready, needs_training, needs_equipment, needs_experience, needs_partner, not_ready.';
COMMENT ON COLUMN gap_analysis_results.recommendation_detail IS 'Human-readable explanation of the recommendation and suggested path forward.';
COMMENT ON COLUMN gap_analysis_results.computed_at IS 'When this analysis was last computed.';
COMMENT ON COLUMN gap_analysis_results.valid_until IS 'Expiration timestamp. After this, the analysis should be recomputed. NULL = no expiration set.';
COMMENT ON COLUMN gap_analysis_results.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN gap_analysis_results.updated_at IS 'Last modification timestamp.';


-- ============================================================
-- 10. ADD org_id FK TO component_events
--     The engine subsystem created component_events with actor_id
--     but no org_id. We add it so every work event can be attributed
--     to both the individual and the organization.
-- ============================================================

ALTER TABLE component_events ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE component_events ADD COLUMN IF NOT EXISTS work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_component_events_org ON component_events (org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_component_events_work_order ON component_events (work_order_id) WHERE work_order_id IS NOT NULL;

COMMENT ON COLUMN component_events.org_id IS 'FK to organizations(id). The organization where this work was performed. Added by actor_org_ontology migration.';
COMMENT ON COLUMN component_events.work_order_id IS 'FK to work_orders(id). The work order this event belongs to, if applicable. Added by actor_org_ontology migration.';


-- ============================================================
-- UPDATED_AT TRIGGERS
-- Reuse digital_twin_set_updated_at() from engine subsystem.
-- Only create triggers for NEW tables (actors trigger already exists).
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'organizations',
    'org_memberships',
    'actor_capabilities',
    'actor_tools',
    'org_capabilities',
    'work_orders',
    'work_order_line_items',
    'gap_analysis_results'
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
    'organizations',
    'org_memberships',
    'actor_capabilities',
    'actor_tools',
    'org_capabilities',
    'work_orders',
    'work_order_line_items',
    'gap_analysis_results'
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


-- ============================================================
-- VIEWS — Useful computed aggregations
-- ============================================================

-- Actor profile view: actor with their current org and top capabilities
CREATE OR REPLACE VIEW actor_profiles AS
SELECT
  a.id AS actor_id,
  a.name,
  a.actor_type,
  a.city,
  a.state,
  a.specialties,
  a.specialty_makes,
  a.trust_score,
  a.total_documented_jobs,
  a.years_experience,
  -- Current primary org
  o.id AS current_org_id,
  o.name AS current_org_name,
  om.role AS current_role,
  -- Top 3 capabilities by evidence count
  (
    SELECT jsonb_agg(cap ORDER BY cap->>'evidence_count' DESC)
    FROM (
      SELECT jsonb_build_object(
        'capability_type', ac.capability_type,
        'complexity_tier', ac.complexity_tier,
        'evidence_count', ac.evidence_count,
        'last_demonstrated', ac.last_demonstrated
      ) AS cap
      FROM actor_capabilities ac
      WHERE ac.actor_id = a.id
      ORDER BY ac.evidence_count DESC
      LIMIT 3
    ) sub
  ) AS top_capabilities
FROM actors a
LEFT JOIN org_memberships om ON om.actor_id = a.id AND om.end_date IS NULL AND om.is_primary = TRUE
LEFT JOIN organizations o ON o.id = om.org_id;

COMMENT ON VIEW actor_profiles IS 'Denormalized actor view with current org and top 3 capabilities. Useful for search results and actor cards.';


-- Org profile view: organization with capability summary
CREATE OR REPLACE VIEW org_profiles AS
SELECT
  o.id AS org_id,
  o.name,
  o.org_type,
  o.city,
  o.state,
  o.specialties,
  o.specialty_makes,
  o.trust_score,
  o.total_documented_jobs,
  o.years_in_business,
  o.has_paint_booth,
  o.has_dyno,
  o.has_machine_shop,
  o.hourly_rate_cents,
  -- Count of active members
  (SELECT count(*) FROM org_memberships om WHERE om.org_id = o.id AND om.end_date IS NULL) AS active_member_count,
  -- Active work orders
  (SELECT count(*) FROM work_orders wo WHERE wo.org_id = o.id AND wo.status = 'in_progress') AS active_projects,
  -- Top 3 capabilities by evidence count
  (
    SELECT jsonb_agg(cap ORDER BY cap->>'evidence_count' DESC)
    FROM (
      SELECT jsonb_build_object(
        'capability_type', oc.capability_type,
        'complexity_tier', oc.complexity_tier,
        'evidence_count', oc.evidence_count,
        'contributing_actor_count', oc.contributing_actor_count
      ) AS cap
      FROM org_capabilities oc
      WHERE oc.org_id = o.id
      ORDER BY oc.evidence_count DESC
      LIMIT 3
    ) sub
  ) AS top_capabilities
FROM organizations o;

COMMENT ON VIEW org_profiles IS 'Denormalized organization view with member count, active projects, and top 3 capabilities. Useful for search results and org cards.';


COMMIT;
