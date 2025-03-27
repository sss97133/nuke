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

-- Vehicles table - central hub for all vehicle data
CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vin TEXT UNIQUE NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER NOT NULL,
  trim TEXT,
  color TEXT,
  mileage INTEGER,
  fuel_type TEXT,
  engine_size TEXT,
  transmission_type TEXT,
  drivetrain_type TEXT,
  body_style TEXT,
  license_plate TEXT,
  registration_state TEXT,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  data_source TEXT,
  confidence REAL DEFAULT 1.0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Extensible fields stored as JSONB for future expansion
  additional_details JSONB DEFAULT '{}'::jsonb,
  
  -- Full text search vector
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(make, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(model, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(vin, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(trim, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(color, '')), 'D')
  ) STORED
);

-- Service history records
CREATE TABLE IF NOT EXISTS service_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  service_date TIMESTAMP WITH TIME ZONE NOT NULL,
  mileage INTEGER,
  service_type TEXT,
  description TEXT,
  cost DECIMAL(10, 2),
  provider TEXT,
  data_source TEXT,
  confidence REAL DEFAULT 1.0,
  additional_details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Parts used in service
CREATE TABLE IF NOT EXISTS parts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_record_id UUID REFERENCES service_records(id) ON DELETE CASCADE,
  part_number TEXT,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_cost DECIMAL(10, 2),
  condition TEXT CHECK (condition IN ('new', 'used', 'refurbished', 'unknown')),
  additional_details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ownership records
CREATE TABLE IF NOT EXISTS ownership_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  start_date TIMESTAMP WITH TIME ZONE NOT NULL,
  end_date TIMESTAMP WITH TIME ZONE,
  owner_type TEXT CHECK (owner_type IN ('individual', 'business', 'government', 'unknown')),
  owner_name TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  postal_code TEXT,
  latitude REAL,
  longitude REAL,
  data_source TEXT,
  confidence REAL DEFAULT 1.0,
  additional_details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Vehicle sensor data
CREATE TABLE IF NOT EXISTS vehicle_sensor_data (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  sensor_type TEXT NOT NULL,
  value JSONB NOT NULL,
  unit TEXT,
  confidence REAL DEFAULT 1.0,
  additional_details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Vehicle images
CREATE TABLE IF NOT EXISTS vehicle_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  image_type TEXT CHECK (image_type IN ('exterior', 'interior', 'damage', 'part', 'other')),
  angle TEXT,
  confidence REAL DEFAULT 1.0,
  labels JSONB, -- AI-generated labels
  additional_details JSONB DEFAULT '{}'::jsonb,
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
CREATE INDEX IF NOT EXISTS idx_vehicles_vin ON vehicles(vin);
CREATE INDEX IF NOT EXISTS idx_vehicles_make_model_year ON vehicles(make, model, year);
CREATE INDEX IF NOT EXISTS idx_service_records_vehicle_id ON service_records(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_service_records_date ON service_records(service_date);
CREATE INDEX IF NOT EXISTS idx_ownership_records_vehicle_id ON ownership_records(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_ownership_records_dates ON ownership_records(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_vehicle_sensor_data_vehicle_id ON vehicle_sensor_data(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_sensor_data_timestamp ON vehicle_sensor_data(timestamp);
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
ALTER TABLE service_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ownership_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_sensor_data ENABLE ROW LEVEL SECURITY;
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
