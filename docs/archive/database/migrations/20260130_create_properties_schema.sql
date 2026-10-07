-- Properties Schema
-- Supports villas, garages, workspaces, and hybrid spaces
-- Designed for availability tracking, bookings, and dynamic pricing

-- ============================================
-- PROPERTY TYPES & CATEGORIES
-- ============================================

CREATE TABLE IF NOT EXISTS property_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,  -- 'villa', 'garage', 'workspace', 'storage', 'hybrid'
  name TEXT NOT NULL,
  description TEXT,
  parent_type_id UUID REFERENCES property_types(id),  -- For subtypes (luxury_villa -> villa)

  -- Default amenity categories for this type
  default_amenities JSONB DEFAULT '[]'::jsonb,

  -- Schema hints for UI
  required_fields TEXT[] DEFAULT ARRAY[]::TEXT[],
  optional_fields TEXT[] DEFAULT ARRAY[]::TEXT[],

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed base types
INSERT INTO property_types (slug, name, description, required_fields, optional_fields) VALUES
  ('villa', 'Villa', 'Luxury vacation rental property',
   ARRAY['bedrooms', 'bathrooms', 'max_guests'],
   ARRAY['pool', 'view_type', 'beach_access']),
  ('garage', 'Garage Space', 'Vehicle storage or workshop space',
   ARRAY['vehicle_capacity', 'ceiling_height'],
   ARRAY['lift_capacity', 'climate_controlled', 'power_outlets']),
  ('workspace', 'Workspace', 'Office or creative workspace',
   ARRAY['workstations', 'sqft'],
   ARRAY['meeting_rooms', 'kitchen', 'parking_spots']),
  ('storage', 'Storage Unit', 'General storage space',
   ARRAY['sqft'],
   ARRAY['climate_controlled', 'drive_up_access']),
  ('hybrid', 'Hybrid Space', 'Multi-use property (e.g., villa with garage)',
   ARRAY['primary_use'],
   ARRAY['secondary_uses'])
ON CONFLICT (slug) DO NOTHING;

-- ============================================
-- AMENITIES SYSTEM
-- ============================================

CREATE TABLE IF NOT EXISTS amenity_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,  -- 'comfort', 'utility', 'entertainment', 'safety', 'outdoor', 'vehicle'
  icon TEXT,  -- Icon name for UI

  -- Which property types this amenity applies to
  applicable_to TEXT[] DEFAULT ARRAY['villa', 'garage', 'workspace', 'storage', 'hybrid'],

  -- For quantifiable amenities
  is_quantifiable BOOLEAN DEFAULT false,
  unit TEXT,  -- 'count', 'sqft', 'tons', 'amps', etc.

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed common amenities
INSERT INTO amenity_definitions (slug, name, category, applicable_to, is_quantifiable, unit) VALUES
  -- Villa amenities
  ('pool', 'Pool', 'outdoor', ARRAY['villa', 'hybrid'], false, NULL),
  ('private_pool', 'Private Pool', 'outdoor', ARRAY['villa', 'hybrid'], false, NULL),
  ('heated_pool', 'Heated Pool', 'outdoor', ARRAY['villa', 'hybrid'], false, NULL),
  ('ocean_view', 'Ocean View', 'comfort', ARRAY['villa', 'hybrid'], false, NULL),
  ('sunset_view', 'Sunset View', 'comfort', ARRAY['villa', 'hybrid'], false, NULL),
  ('beach_access', 'Beach Access', 'outdoor', ARRAY['villa', 'hybrid'], false, NULL),
  ('ac', 'Air Conditioning', 'comfort', ARRAY['villa', 'workspace', 'hybrid'], false, NULL),
  ('wifi', 'WiFi', 'utility', ARRAY['villa', 'workspace', 'garage', 'hybrid'], false, NULL),
  ('chef_kitchen', 'Chef Kitchen', 'comfort', ARRAY['villa', 'hybrid'], false, NULL),
  ('gym', 'Gym', 'entertainment', ARRAY['villa', 'hybrid'], false, NULL),
  ('spa', 'Spa', 'comfort', ARRAY['villa', 'hybrid'], false, NULL),
  ('concierge', 'Concierge Service', 'comfort', ARRAY['villa', 'hybrid'], false, NULL),

  -- Garage amenities
  ('vehicle_lift', 'Vehicle Lift', 'vehicle', ARRAY['garage', 'hybrid'], true, 'tons'),
  ('climate_control', 'Climate Controlled', 'utility', ARRAY['garage', 'storage', 'hybrid'], false, NULL),
  ('ev_charging', 'EV Charging', 'vehicle', ARRAY['garage', 'hybrid'], true, 'count'),
  ('tool_storage', 'Tool Storage', 'utility', ARRAY['garage', 'workspace'], false, NULL),
  ('compressed_air', 'Compressed Air', 'utility', ARRAY['garage'], false, NULL),
  ('drain', 'Floor Drain', 'utility', ARRAY['garage'], false, NULL),
  ('high_power', 'High Power (240V+)', 'utility', ARRAY['garage', 'workspace'], true, 'amps'),
  ('ceiling_height', 'High Ceiling', 'utility', ARRAY['garage', 'storage'], true, 'feet'),

  -- Workspace amenities
  ('meeting_room', 'Meeting Room', 'utility', ARRAY['workspace', 'hybrid'], true, 'count'),
  ('phone_booth', 'Phone Booth', 'utility', ARRAY['workspace'], true, 'count'),
  ('reception', 'Reception/Lobby', 'utility', ARRAY['workspace'], false, NULL),
  ('mail_handling', 'Mail Handling', 'utility', ARRAY['workspace'], false, NULL),
  ('24_7_access', '24/7 Access', 'utility', ARRAY['workspace', 'garage', 'storage'], false, NULL),

  -- Shared amenities
  ('parking', 'Parking', 'utility', ARRAY['villa', 'workspace', 'garage', 'hybrid'], true, 'spots'),
  ('security', 'Security System', 'safety', ARRAY['villa', 'garage', 'workspace', 'storage', 'hybrid'], false, NULL),
  ('gated', 'Gated Entry', 'safety', ARRAY['villa', 'garage', 'storage', 'hybrid'], false, NULL)
ON CONFLICT (slug) DO NOTHING;

-- ============================================
-- PROPERTIES (Core Entity)
-- ============================================

CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  description TEXT,
  tagline TEXT,

  -- Type
  property_type_id UUID REFERENCES property_types(id),
  property_type TEXT,  -- Denormalized for quick access: 'villa', 'garage', etc.

  -- Ownership/Management
  owner_org_id UUID REFERENCES businesses(id),  -- The organization that owns/manages
  owner_user_id UUID,  -- Direct user owner if applicable

  -- Location
  address TEXT,
  city TEXT,
  region TEXT,  -- Neighborhood/area (e.g., 'Pointe Milou', 'Gustavia')
  country TEXT DEFAULT 'BL',
  postal_code TEXT,
  latitude NUMERIC(10, 8),
  longitude NUMERIC(11, 8),

  -- Physical specs (flexible JSONB for type-specific fields)
  specs JSONB DEFAULT '{}'::jsonb,
  /*
    Villa specs: {
      "bedrooms": 4,
      "bathrooms": 3,
      "max_guests": 8,
      "sqft": 3500,
      "lot_sqft": 10000,
      "floors": 2,
      "year_built": 2018
    }

    Garage specs: {
      "vehicle_capacity": 4,
      "sqft": 1200,
      "ceiling_height_ft": 14,
      "door_width_ft": 12,
      "door_height_ft": 10,
      "power_amps": 200,
      "lift_count": 2,
      "lift_capacity_tons": 12
    }
  */

  -- Pricing
  base_price NUMERIC(12, 2),
  price_currency TEXT DEFAULT 'USD',
  price_period TEXT DEFAULT 'week',  -- 'night', 'week', 'month', 'hour', 'day'
  min_booking_period INTEGER,  -- Minimum booking in periods

  -- Status
  status TEXT DEFAULT 'active',  -- 'active', 'inactive', 'maintenance', 'sold'
  listing_type TEXT DEFAULT 'rental',  -- 'rental', 'sale', 'both'
  is_public BOOLEAN DEFAULT true,
  is_featured BOOLEAN DEFAULT false,

  -- Sale info (if applicable)
  sale_price NUMERIC(14, 2),
  sale_price_currency TEXT DEFAULT 'USD',

  -- External references
  external_id TEXT,  -- ID from source system (e.g., Sibarth ID)
  source_url TEXT,
  discovered_via TEXT,

  -- Search
  search_keywords TEXT[] DEFAULT ARRAY[]::TEXT[],
  search_vector TSVECTOR,

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_properties_type ON properties(property_type);
CREATE INDEX IF NOT EXISTS idx_properties_owner_org ON properties(owner_org_id);
CREATE INDEX IF NOT EXISTS idx_properties_region ON properties(region);
CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
CREATE INDEX IF NOT EXISTS idx_properties_listing ON properties(listing_type);
CREATE INDEX IF NOT EXISTS idx_properties_location ON properties USING GIST (
  point(longitude::float, latitude::float)
) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_properties_search ON properties USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_properties_metadata ON properties USING GIN(metadata);

-- ============================================
-- PROPERTY AMENITIES (Junction)
-- ============================================

CREATE TABLE IF NOT EXISTS property_amenities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  amenity_id UUID NOT NULL REFERENCES amenity_definitions(id),

  -- For quantifiable amenities
  quantity INTEGER,
  unit TEXT,

  -- Additional notes
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(property_id, amenity_id)
);

CREATE INDEX IF NOT EXISTS idx_property_amenities_property ON property_amenities(property_id);

-- ============================================
-- PROPERTY IMAGES
-- ============================================

CREATE TABLE IF NOT EXISTS property_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  url TEXT NOT NULL,
  thumbnail_url TEXT,

  caption TEXT,
  category TEXT,  -- 'exterior', 'interior', 'bedroom', 'bathroom', 'pool', 'view', 'garage', etc.
  sort_order INTEGER DEFAULT 0,
  is_primary BOOLEAN DEFAULT false,

  -- Image metadata
  width INTEGER,
  height INTEGER,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_images_property ON property_images(property_id);

-- ============================================
-- AVAILABILITY CALENDAR
-- ============================================

CREATE TABLE IF NOT EXISTS property_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',  -- 'available', 'booked', 'blocked', 'maintenance'

  -- Pricing overrides for this date
  price_override NUMERIC(12, 2),
  min_stay_override INTEGER,

  -- For blocked dates
  blocked_reason TEXT,

  -- Source tracking
  source TEXT,  -- 'manual', 'ical', 'api', 'booking'
  external_booking_id TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(property_id, date)
);

CREATE INDEX IF NOT EXISTS idx_property_availability_property_date ON property_availability(property_id, date);
CREATE INDEX IF NOT EXISTS idx_property_availability_status ON property_availability(status);

-- ============================================
-- SEASONAL PRICING
-- ============================================

CREATE TABLE IF NOT EXISTS property_pricing_seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  name TEXT NOT NULL,  -- 'High Season', 'Low Season', 'Holiday', etc.
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,

  price NUMERIC(12, 2) NOT NULL,
  min_stay INTEGER,

  -- Recurring yearly
  is_recurring BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_pricing_property ON property_pricing_seasons(property_id);

-- ============================================
-- BOOKINGS
-- ============================================

CREATE TABLE IF NOT EXISTS property_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  -- Dates
  check_in DATE NOT NULL,
  check_out DATE NOT NULL,

  -- Guest info
  guest_name TEXT,
  guest_email TEXT,
  guest_phone TEXT,
  guest_count INTEGER,

  -- Pricing
  total_price NUMERIC(12, 2),
  currency TEXT DEFAULT 'USD',
  deposit_amount NUMERIC(12, 2),
  deposit_paid BOOLEAN DEFAULT false,

  -- Status
  status TEXT DEFAULT 'pending',  -- 'pending', 'confirmed', 'cancelled', 'completed'

  -- Notes
  special_requests TEXT,
  internal_notes TEXT,

  -- Source
  booking_source TEXT,  -- 'direct', 'airbnb', 'vrbo', 'agency', etc.
  external_booking_id TEXT,

  -- Contact/Agent
  agent_org_id UUID REFERENCES businesses(id),
  agent_contact TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_bookings_property ON property_bookings(property_id);
CREATE INDEX IF NOT EXISTS idx_property_bookings_dates ON property_bookings(check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_property_bookings_status ON property_bookings(status);

-- ============================================
-- ICAL SYNC SOURCES
-- ============================================

CREATE TABLE IF NOT EXISTS property_calendar_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  name TEXT NOT NULL,  -- 'Airbnb', 'VRBO', 'Booking.com', 'Owner Calendar'
  ical_url TEXT NOT NULL,

  -- Sync settings
  sync_enabled BOOLEAN DEFAULT true,
  sync_interval_minutes INTEGER DEFAULT 60,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_events INTEGER,

  -- Auth (if needed)
  auth_type TEXT,  -- 'none', 'basic', 'bearer'
  auth_token TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_calendar_sources_property ON property_calendar_sources(property_id);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Update search vector on property changes
CREATE OR REPLACE FUNCTION update_property_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    COALESCE(NEW.name, '') || ' ' ||
    COALESCE(NEW.description, '') || ' ' ||
    COALESCE(NEW.tagline, '') || ' ' ||
    COALESCE(NEW.region, '') || ' ' ||
    COALESCE(NEW.city, '') || ' ' ||
    COALESCE(array_to_string(NEW.search_keywords, ' '), '')
  );
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_property_search_vector ON properties;
CREATE TRIGGER trigger_property_search_vector
  BEFORE INSERT OR UPDATE ON properties
  FOR EACH ROW
  EXECUTE FUNCTION update_property_search_vector();

-- Check availability for a date range
CREATE OR REPLACE FUNCTION check_property_availability(
  p_property_id UUID,
  p_check_in DATE,
  p_check_out DATE
)
RETURNS TABLE (
  is_available BOOLEAN,
  blocked_dates DATE[],
  booked_dates DATE[]
) AS $$
DECLARE
  blocked DATE[];
  booked DATE[];
BEGIN
  -- Get blocked dates in range
  SELECT ARRAY_AGG(date) INTO blocked
  FROM property_availability
  WHERE property_id = p_property_id
    AND date >= p_check_in
    AND date < p_check_out
    AND status = 'blocked';

  -- Get booked dates in range
  SELECT ARRAY_AGG(date) INTO booked
  FROM property_availability
  WHERE property_id = p_property_id
    AND date >= p_check_in
    AND date < p_check_out
    AND status = 'booked';

  RETURN QUERY SELECT
    (blocked IS NULL AND booked IS NULL) AS is_available,
    COALESCE(blocked, ARRAY[]::DATE[]) AS blocked_dates,
    COALESCE(booked, ARRAY[]::DATE[]) AS booked_dates;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VIEWS
-- ============================================

-- Properties with amenity lists
CREATE OR REPLACE VIEW properties_with_amenities AS
SELECT
  p.*,
  COALESCE(
    ARRAY_AGG(ad.slug) FILTER (WHERE ad.slug IS NOT NULL),
    ARRAY[]::TEXT[]
  ) AS amenity_slugs,
  COALESCE(
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'slug', ad.slug,
        'name', ad.name,
        'quantity', pa.quantity
      )
    ) FILTER (WHERE ad.id IS NOT NULL),
    '[]'::JSONB
  ) AS amenities
FROM properties p
LEFT JOIN property_amenities pa ON pa.property_id = p.id
LEFT JOIN amenity_definitions ad ON ad.id = pa.amenity_id
GROUP BY p.id;

-- Villa summary view (for concierge queries)
CREATE OR REPLACE VIEW villa_inventory AS
SELECT
  p.id,
  p.name,
  p.slug,
  p.tagline,
  p.region,
  p.city,
  p.base_price,
  p.price_currency,
  p.price_period,
  p.listing_type,
  p.specs->>'bedrooms' AS bedrooms,
  p.specs->>'bathrooms' AS bathrooms,
  p.specs->>'max_guests' AS max_guests,
  p.specs->>'sqft' AS sqft,
  p.latitude,
  p.longitude,
  p.source_url,
  p.is_featured,
  o.business_name AS manager_name,
  o.phone AS manager_phone,
  o.website AS manager_website,
  (SELECT url FROM property_images WHERE property_id = p.id AND is_primary = true LIMIT 1) AS primary_image
FROM properties p
LEFT JOIN businesses o ON o.id = p.owner_org_id
WHERE p.property_type = 'villa'
  AND p.status = 'active';

-- Grant access
GRANT SELECT ON property_types TO authenticated;
GRANT SELECT ON amenity_definitions TO authenticated;
GRANT SELECT ON properties TO authenticated;
GRANT SELECT ON property_amenities TO authenticated;
GRANT SELECT ON property_images TO authenticated;
GRANT SELECT ON property_availability TO authenticated;
GRANT SELECT ON property_pricing_seasons TO authenticated;
GRANT SELECT ON properties_with_amenities TO authenticated;
GRANT SELECT ON villa_inventory TO authenticated;
