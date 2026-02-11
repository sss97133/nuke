-- =====================================================
-- EXPAND CONTRACT STATION: Real Estate + Events
-- =====================================================
-- The flywheel: vehicles → need storage → real estate →
-- host events → generate revenue → acquire more vehicles
-- Date: February 11, 2026
-- =====================================================

-- =====================================================
-- 1. PROPERTIES TABLE (Real Estate Holdings)
-- =====================================================

CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  property_name TEXT NOT NULL,
  property_type TEXT NOT NULL CHECK (property_type IN (
    'garage',              -- Vehicle storage / workshop
    'showroom',            -- Display / retail space
    'warehouse',           -- Bulk storage
    'event_venue',         -- Track day, car show space
    'mixed_use',           -- Garage + showroom + event
    'office',              -- Administrative
    'land',                -- Undeveloped / parking
    'residential',         -- Caretaker / on-site housing
    'track',               -- Racing circuit / test track
    'other'
  )),
  description TEXT,

  -- Location
  address TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  country TEXT DEFAULT 'US',
  latitude DECIMAL(10,7),
  longitude DECIMAL(10,7),

  -- Physical
  square_feet INTEGER,
  lot_size_acres DECIMAL(10,2),
  vehicle_capacity INTEGER,          -- How many cars it can hold
  lift_count INTEGER,                -- Number of vehicle lifts
  climate_controlled BOOLEAN DEFAULT FALSE,
  security_level TEXT CHECK (security_level IN ('basic', 'monitored', 'guarded', '24_7_manned')),

  -- Financials
  purchase_price_cents BIGINT,
  current_value_cents BIGINT,
  monthly_rent_cents BIGINT,         -- If leased out
  monthly_operating_cost_cents BIGINT,
  annual_revenue_cents BIGINT,       -- From events, storage fees, etc.
  annual_noi_cents BIGINT,           -- Net Operating Income
  cap_rate_pct DECIMAL(5,2),         -- NOI / Value
  occupancy_pct DECIMAL(5,2),        -- % of capacity in use

  -- Ownership
  owner_id UUID REFERENCES auth.users(id),
  business_id UUID REFERENCES businesses(id), -- Managing business

  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'under_renovation', 'listed_for_sale', 'under_contract', 'sold', 'inactive')),
  acquisition_date DATE,

  -- Media
  primary_image_url TEXT,
  image_urls TEXT[] DEFAULT '{}',

  -- Metadata
  amenities TEXT[] DEFAULT '{}',     -- ['paint_booth', 'dyno', 'alignment_rack', 'parts_storage', 'lounge', 'kitchen']
  certifications TEXT[] DEFAULT '{}', -- ['fire_rated', 'epa_compliant', 'ada_accessible']
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_properties_type ON properties(property_type);
CREATE INDEX IF NOT EXISTS idx_properties_owner ON properties(owner_id);
CREATE INDEX IF NOT EXISTS idx_properties_business ON properties(business_id);
CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
CREATE INDEX IF NOT EXISTS idx_properties_city_state ON properties(city, state);

-- =====================================================
-- 2. EVENTS TABLE (Revenue-Generating Events)
-- =====================================================

CREATE TABLE IF NOT EXISTS community_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  event_name TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'car_show',            -- Concours, cars & coffee
    'track_day',           -- Track rental / lapping day
    'auction',             -- Live auction event
    'workshop',            -- Educational / hands-on
    'meetup',              -- Social gathering
    'rally',               -- Road rally / tour
    'exhibition',          -- Museum / gallery showing
    'sale',                -- Private sale event
    'fundraiser',          -- Charity / investment event
    'launch',              -- Vehicle / product launch
    'conference',          -- Industry conference
    'other'
  )),
  description TEXT,

  -- Schedule
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ,
  recurring TEXT CHECK (recurring IN ('once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annually')),

  -- Location
  property_id UUID REFERENCES properties(id), -- Hosted at a property
  venue_name TEXT,                              -- Or external venue
  address TEXT,
  city TEXT,
  state TEXT,
  country TEXT DEFAULT 'US',

  -- Capacity & Attendance
  max_capacity INTEGER,
  registered_count INTEGER DEFAULT 0,
  attended_count INTEGER DEFAULT 0,
  vehicle_spots INTEGER,              -- Cars on display

  -- Financials
  ticket_price_cents BIGINT DEFAULT 0,
  vip_price_cents BIGINT,
  sponsorship_revenue_cents BIGINT DEFAULT 0,
  total_revenue_cents BIGINT DEFAULT 0,
  total_cost_cents BIGINT DEFAULT 0,
  net_profit_cents BIGINT DEFAULT 0,

  -- Organizer
  organizer_id UUID REFERENCES auth.users(id),
  business_id UUID REFERENCES businesses(id),

  -- Status
  status TEXT DEFAULT 'planned' CHECK (status IN ('planned', 'announced', 'selling_tickets', 'sold_out', 'in_progress', 'completed', 'cancelled')),

  -- Media
  primary_image_url TEXT,
  image_urls TEXT[] DEFAULT '{}',

  -- Metadata
  tags TEXT[] DEFAULT '{}',
  featured_vehicles UUID[] DEFAULT '{}', -- Vehicle IDs on display
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_events_type ON community_events(event_type);
CREATE INDEX IF NOT EXISTS idx_community_events_property ON community_events(property_id);
CREATE INDEX IF NOT EXISTS idx_community_events_date ON community_events(start_date);
CREATE INDEX IF NOT EXISTS idx_community_events_status ON community_events(status);
CREATE INDEX IF NOT EXISTS idx_community_events_organizer ON community_events(organizer_id);

-- =====================================================
-- 3. EXPAND CONTRACT_ASSETS TO INCLUDE NEW TYPES
-- =====================================================

-- Add real_estate and event to contract_assets.asset_type
ALTER TABLE contract_assets DROP CONSTRAINT IF EXISTS contract_assets_asset_type_check;
ALTER TABLE contract_assets ADD CONSTRAINT contract_assets_asset_type_check
CHECK (asset_type IN (
  'vehicle',
  'organization',
  'project',
  'user',
  'bond',
  'stake',
  'listing',
  'fund',
  'real_estate',     -- NEW: Reference to properties table
  'event',           -- NEW: Reference to community_events table
  'other'
));

-- =====================================================
-- 4. EXPAND CONTRACT TYPE ENUM
-- =====================================================

ALTER TABLE custom_investment_contracts DROP CONSTRAINT IF EXISTS custom_investment_contracts_contract_type_check;
ALTER TABLE custom_investment_contracts ADD CONSTRAINT custom_investment_contracts_contract_type_check
CHECK (contract_type IN (
  'etf',
  'bond_fund',
  'equity_fund',
  'hybrid',
  'project_fund',
  'organization_fund',
  'real_estate_fund',     -- NEW
  'venue_fund',           -- NEW: Real estate + events combo
  'custom'
));

-- =====================================================
-- 5. PROPERTY-EVENT RELATIONSHIP
-- =====================================================

-- Track which events have happened at which properties (revenue attribution)
CREATE TABLE IF NOT EXISTS property_event_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES community_events(id) ON DELETE CASCADE,
  revenue_share_pct DECIMAL(5,2) DEFAULT 100, -- What % of event revenue goes to property
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(property_id, event_id)
);
