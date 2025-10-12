-- Create VIN validations table for vehicle ownership verification
CREATE TABLE IF NOT EXISTS vin_validations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    vin_photo_url TEXT NOT NULL,
    extracted_vin TEXT,
    submitted_vin TEXT NOT NULL,
    validation_status TEXT CHECK (validation_status IN ('pending', 'approved', 'rejected', 'expired')) DEFAULT 'pending',
    confidence_score DECIMAL(3,2),
    validation_method TEXT CHECK (validation_method IN ('ocr', 'manual', 'ai_vision')) DEFAULT 'manual',
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '24 hours'),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE vin_validations ENABLE ROW LEVEL SECURITY;

-- Create policies for vin_validations
CREATE POLICY "Users can view their own validations" ON vin_validations
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own validations" ON vin_validations
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own validations" ON vin_validations
    FOR UPDATE USING (auth.uid() = user_id);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_vin_validations_vehicle_id ON vin_validations(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vin_validations_user_id ON vin_validations(user_id);
CREATE INDEX IF NOT EXISTS idx_vin_validations_status ON vin_validations(validation_status);
CREATE INDEX IF NOT EXISTS idx_vin_validations_expires_at ON vin_validations(expires_at);

-- Create trigger to update updated_at
CREATE TRIGGER update_vin_validations_updated_at
    BEFORE UPDATE ON vin_validations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
