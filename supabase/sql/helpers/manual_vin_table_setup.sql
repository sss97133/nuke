-- Run this SQL in your Supabase SQL Editor to create the VIN validations table

CREATE TABLE IF NOT EXISTS vin_validations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID,
  user_id UUID,
  vin_photo_url TEXT NOT NULL,
  extracted_vin TEXT,
  submitted_vin TEXT NOT NULL,
  validation_status TEXT DEFAULT 'pending',
  confidence_score DECIMAL(3,2),
  validation_method TEXT DEFAULT 'manual',
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE vin_validations ENABLE ROW LEVEL SECURITY;

-- Create permissive policies for testing
CREATE POLICY IF NOT EXISTS "vin_validations_public_access" ON vin_validations
  FOR ALL USING (true) WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_vin_validations_vehicle_id ON vin_validations(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vin_validations_user_id ON vin_validations(user_id);
CREATE INDEX IF NOT EXISTS idx_vin_validations_status ON vin_validations(validation_status);
