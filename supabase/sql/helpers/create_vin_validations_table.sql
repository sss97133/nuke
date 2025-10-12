-- Simple VIN validations table creation
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

-- Create basic policies
CREATE POLICY IF NOT EXISTS "vin_validations_select_policy" ON vin_validations
    FOR SELECT USING (true);

CREATE POLICY IF NOT EXISTS "vin_validations_insert_policy" ON vin_validations
    FOR INSERT WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "vin_validations_update_policy" ON vin_validations
    FOR UPDATE USING (true);
