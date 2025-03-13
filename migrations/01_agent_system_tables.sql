-- Agent System Database Schema
-- This migration adds the necessary tables and relationships to support the Nuke agent system

-- Document Storage
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id),
  vehicle_id UUID REFERENCES vehicles(id),
  shop_id UUID REFERENCES shops(id),
  document_type TEXT NOT NULL, -- receipt, maintenance_record, registration, etc.
  file_path TEXT NOT NULL,
  original_filename TEXT,
  mime_type TEXT,
  file_size INTEGER,
  extracted_data JSONB,
  confidence_score FLOAT,
  status TEXT DEFAULT 'pending', -- pending, processing, processed, failed
  error_message TEXT,
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Document Data Points
CREATE TABLE IF NOT EXISTS document_data_points (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID REFERENCES documents(id),
  field_name TEXT NOT NULL,
  field_value TEXT,
  confidence_score FLOAT,
  verified BOOLEAN DEFAULT FALSE,
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Agent Run Tracking
CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  vehicle_id UUID REFERENCES vehicles(id),
  document_id UUID REFERENCES documents(id),
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL, -- started, completed, failed
  result JSONB,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Agent Memory Storage
CREATE TABLE IF NOT EXISTS agent_memory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Google Document Links
CREATE TABLE IF NOT EXISTS google_document_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID REFERENCES documents(id),
  google_doc_id TEXT NOT NULL,
  google_drive_url TEXT,
  last_synced_at TIMESTAMP WITH TIME ZONE,
  sync_status TEXT DEFAULT 'pending', -- pending, synced, failed
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT unique_google_doc_id UNIQUE (google_doc_id)
);

-- Maintenance Records (enhanced for agent integration)
CREATE TABLE IF NOT EXISTS maintenance_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_id UUID REFERENCES vehicles(id) NOT NULL,
  service_date DATE NOT NULL,
  mileage INTEGER,
  service_type TEXT,
  description TEXT,
  vendor TEXT,
  technician TEXT,
  cost DECIMAL(10,2),
  document_id UUID REFERENCES documents(id),
  source TEXT, -- user_input, document_extraction, etc.
  source_confidence FLOAT,
  reviewed BOOLEAN DEFAULT FALSE,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Service Items (for detailed maintenance record items)
CREATE TABLE IF NOT EXISTS service_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  maintenance_record_id UUID REFERENCES maintenance_records(id) NOT NULL,
  item_type TEXT NOT NULL, -- part, labor, fee, tax
  part_number TEXT,
  description TEXT NOT NULL,
  quantity DECIMAL(10,2) DEFAULT 1,
  unit_price DECIMAL(10,2),
  total_price DECIMAL(10,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Shop Information
CREATE TABLE IF NOT EXISTS shops (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT DEFAULT 'US',
  phone TEXT,
  email TEXT,
  website TEXT,
  tax_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Shop-Vehicle Relationships
CREATE TABLE IF NOT EXISTS shop_vehicles (
  shop_id UUID REFERENCES shops(id),
  vehicle_id UUID REFERENCES vehicles(id),
  relationship_type TEXT, -- customer, inventory, etc.
  customer_number TEXT, -- shop's internal identifier
  first_service_date DATE,
  last_service_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (shop_id, vehicle_id)
);

-- User Agent Preferences
CREATE TABLE IF NOT EXISTS user_agent_preferences (
  user_id UUID REFERENCES auth.users(id) PRIMARY KEY,
  automation_level TEXT DEFAULT 'medium', -- high, medium, low
  confidence_threshold FLOAT DEFAULT 0.7,
  notification_channels TEXT[] DEFAULT ARRAY['in-app'],
  focus_maintenance INTEGER DEFAULT 5,
  focus_investment INTEGER DEFAULT 5,
  focus_history INTEGER DEFAULT 5,
  allow_external_lookup BOOLEAN DEFAULT TRUE,
  share_with_manufacturers BOOLEAN DEFAULT FALSE,
  data_retention_period INTEGER DEFAULT 365, -- days
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indices for performance
CREATE INDEX IF NOT EXISTS idx_documents_vehicle_id ON documents(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_documents_shop_id ON documents(shop_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_document_data_points_document_id ON document_data_points(document_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_records_vehicle_id ON maintenance_records(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_records_document_id ON maintenance_records(document_id);
CREATE INDEX IF NOT EXISTS idx_service_items_maintenance_record_id ON service_items(maintenance_record_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_document_id ON agent_runs(document_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_vehicle_id ON agent_runs(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_id ON agent_memory(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_key ON agent_memory(memory_key);

-- Add fields to existing vehicles table
ALTER TABLE vehicles 
ADD COLUMN IF NOT EXISTS data_confidence FLOAT,
ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS validation_source TEXT,
ADD COLUMN IF NOT EXISTS completeness_score FLOAT,
ADD COLUMN IF NOT EXISTS last_document_processed_at TIMESTAMP WITH TIME ZONE;

-- RLS Policies for Security

-- Documents table policies
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own documents"
  ON documents FOR SELECT
  USING (auth.uid() = user_id);
  
CREATE POLICY "Users can insert their own documents"
  ON documents FOR INSERT
  WITH CHECK (auth.uid() = user_id);
  
CREATE POLICY "Users can update their own documents"
  ON documents FOR UPDATE
  USING (auth.uid() = user_id);

-- Agent memory policies
ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "System can access agent memory"
  ON agent_memory FOR ALL
  USING (true);

-- Allow service roles full access for agent operations
CREATE POLICY "Service role can access all documents"
  ON documents FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');
