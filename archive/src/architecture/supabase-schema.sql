-- Supabase SQL Schema for Vehicle Data Platform
-- This schema defines the core tables needed to support a flexible, 
-- future-proof data collection platform for vehicle information

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For text search
CREATE EXTENSION IF NOT EXISTS "postgis";  -- For geospatial data (optional)

-- =============================================
-- CORE TABLES
-- =============================================

-- Vehicles table - core vehicle data
CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER NOT NULL,
  vin TEXT,
  license_plate TEXT,
  color TEXT,
  trim TEXT,
  body_style TEXT,
  transmission TEXT,
  engine TEXT,
  fuel_type TEXT,
  mileage INTEGER,
  condition TEXT,
  category TEXT,
  rarity TEXT,
  significance TEXT,
  tags TEXT[],
  private_notes TEXT,
  public_notes TEXT,
  ownership_status TEXT CHECK (ownership_status IN ('owned', 'claimed', 'discovered')),
  purchase_date DATE,
  purchase_price DECIMAL(10, 2),
  purchase_location TEXT,
  claim_justification TEXT,
  discovery_date DATE,
  discovery_location TEXT,
  discovery_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Vehicle images
CREATE TABLE IF NOT EXISTS vehicle_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- DATA SOURCE MANAGEMENT
-- =============================================

-- Data sources
CREATE TABLE IF NOT EXISTS data_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  requires_authentication BOOLEAN DEFAULT FALSE,
  auth_type TEXT,
  auth_config JSONB DEFAULT '{}'::jsonb,
  rate_limit JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Data source API keys (encrypted)
CREATE TABLE IF NOT EXISTS data_source_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  credentials JSONB NOT NULL, -- Encrypted credentials
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =============================================
-- DATA HISTORY & VERSIONING
-- =============================================

-- Vehicle data history (for audit and analysis)
CREATE TABLE IF NOT EXISTS vehicle_data_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vin TEXT NOT NULL,
  data JSONB NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  source TEXT,
  change_type TEXT,
  changed_by TEXT
);

-- =============================================
-- USER INTERACTION & PREFERENCES
-- =============================================

-- User profiles
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  first_name TEXT,
  last_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User preferences for UI adaptivity
CREATE TABLE IF NOT EXISTS user_preferences (
  id TEXT PRIMARY KEY, -- 'current_user' for non-authenticated or user UUID
  preferences JSONB NOT NULL DEFAULT '{
    "theme": "system", 
    "fontSize": 1, 
    "spacing": "normal", 
    "animations": true,
    "colorAccent": "#3b82f6"
  }'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User interactions for analyzing UI usage
CREATE TABLE IF NOT EXISTS user_interactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT, -- Can be null for anonymous
  element TEXT NOT NULL,
  action TEXT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Data collection permissions
CREATE TABLE IF NOT EXISTS data_collection_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,
  data_type TEXT NOT NULL,
  is_allowed BOOLEAN DEFAULT FALSE,
  scope JSONB, -- Additional permission scoping
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, data_type)
);

-- =============================================
-- INDEXES
-- =============================================

-- Indexes for primary lookup fields
CREATE INDEX IF NOT EXISTS idx_vehicles_user_id ON vehicles(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_make_model_year ON vehicles(make, model, year);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_vehicle_id ON vehicle_images(vehicle_id);

-- Full text search index
CREATE INDEX IF NOT EXISTS idx_vehicles_search ON vehicles USING GIN (search_vector);

-- Index for JSONB fields
CREATE INDEX IF NOT EXISTS idx_vehicles_additional_details ON vehicles USING GIN (additional_details);
CREATE INDEX IF NOT EXISTS idx_user_preferences_preferences ON user_preferences USING GIN (preferences);

-- =============================================
-- FUNCTIONS
-- =============================================

-- Function to update vehicles search vector
CREATE OR REPLACE FUNCTION update_vehicles_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector = 
    setweight(to_tsvector('english', coalesce(NEW.make, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.model, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.vin, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.trim, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.color, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to record vehicle data changes to history
CREATE OR REPLACE FUNCTION record_vehicle_data_change()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO vehicle_data_history (
    vin, 
    data, 
    timestamp, 
    source,
    change_type,
    changed_by
  ) VALUES (
    NEW.vin,
    row_to_json(NEW),
    NOW(),
    coalesce(NEW.data_source, 'system'),
    TG_OP,
    coalesce(auth.uid()::text, 'system')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- TRIGGERS
-- =============================================

-- Trigger to update search vector on vehicles table changes
CREATE TRIGGER update_vehicles_search
BEFORE INSERT OR UPDATE ON vehicles
FOR EACH ROW EXECUTE FUNCTION update_vehicles_search_vector();

-- Trigger to record vehicle data changes
CREATE TRIGGER record_vehicle_data_change
AFTER INSERT OR UPDATE ON vehicles
FOR EACH ROW EXECUTE FUNCTION record_vehicle_data_change();

-- =============================================
-- INITIAL DATA
-- =============================================

-- Create a test table for connection checks
CREATE TABLE IF NOT EXISTS test_connection (
  id SERIAL PRIMARY KEY,
  test_value TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert a test record
INSERT INTO test_connection (test_value)
VALUES ('Connection successful')
ON CONFLICT DO NOTHING;

-- Default data sources
INSERT INTO data_sources (id, name, description, capabilities)
VALUES 
  ('manual_entry', 'Manual Data Entry', 'Data entered manually by users', '{"providesVehicleData": true, "providesServiceHistory": true, "providesOwnershipHistory": true, "providesSensorData": false, "providesImages": false}'::jsonb),
  ('vin_decoder', 'VIN Decoder API', 'Vehicle data from VIN decoder service', '{"providesVehicleData": true, "providesServiceHistory": false, "providesOwnershipHistory": false, "providesSensorData": false, "providesImages": false}'::jsonb),
  ('image_analysis', 'Image Analysis', 'Vehicle data extracted from images', '{"providesVehicleData": true, "providesServiceHistory": false, "providesOwnershipHistory": false, "providesSensorData": false, "providesImages": true}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- ROW LEVEL SECURITY POLICIES
-- =============================================

-- Enable RLS on all tables
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_collection_permissions ENABLE ROW LEVEL SECURITY;

-- Basic policies (these would be expanded for production)
CREATE POLICY "Public vehicles are viewable by everyone"
  ON vehicles FOR SELECT
  USING (true);

CREATE POLICY "Users can insert vehicles"
  ON vehicles FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update their own vehicles"
  ON vehicles FOR UPDATE
  USING (auth.role() = 'authenticated');

-- User profiles policies
CREATE POLICY "Users can view their own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- User preferences policies
CREATE POLICY "Users can view their own preferences"
  ON user_preferences FOR SELECT
  USING (id = 'current_user' OR id = auth.uid()::text);

CREATE POLICY "Users can update their own preferences"
  ON user_preferences FOR UPDATE
  USING (id = 'current_user' OR id = auth.uid()::text);

CREATE POLICY "Users can insert preferences"
  ON user_preferences FOR INSERT
  WITH CHECK (id = 'current_user' OR id = auth.uid()::text);

-- User interactions policies
CREATE POLICY "Users can insert interactions"
  ON user_interactions FOR INSERT
  WITH CHECK (true);  -- Allow anonymous interactions
