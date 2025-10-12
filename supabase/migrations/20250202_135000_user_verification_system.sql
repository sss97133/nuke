-- User verification system for VIN validation access control
-- Requires ID upload and phone verification before accessing VIN tools

-- Create user_type enum if it doesn't exist
DO $$ BEGIN
    CREATE TYPE user_type AS ENUM ('user', 'moderator', 'admin');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add user_type column to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS user_type user_type DEFAULT 'user';

-- Add verification fields to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_verification_code TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_verification_expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS id_document_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS id_verification_status TEXT CHECK (id_verification_status IN ('pending', 'approved', 'rejected', 'expired')) DEFAULT 'pending';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS id_document_type TEXT CHECK (id_document_type IN ('drivers_license', 'passport', 'state_id', 'other'));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS verification_level TEXT CHECK (verification_level IN ('unverified', 'phone_only', 'id_only', 'fully_verified')) DEFAULT 'unverified';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS verification_notes TEXT;

-- Create user verifications table for detailed tracking
CREATE TABLE IF NOT EXISTS user_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    verification_type TEXT CHECK (verification_type IN ('phone', 'id_document', 'manual_review')) NOT NULL,
    status TEXT CHECK (status IN ('pending', 'approved', 'rejected', 'expired')) DEFAULT 'pending',
    
    -- Phone verification data
    phone_number TEXT,
    phone_verification_code TEXT,
    phone_attempts INTEGER DEFAULT 0,
    
    -- ID document data
    document_type TEXT,
    document_url TEXT,
    document_metadata JSONB,
    
    -- Review data
    reviewed_by UUID REFERENCES auth.users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    
    -- Audit trail
    ip_address INET,
    user_agent TEXT,
    submission_metadata JSONB,
    
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on user_verifications
ALTER TABLE user_verifications ENABLE ROW LEVEL SECURITY;

-- Policies for user_verifications
CREATE POLICY "users_can_view_own_verifications" ON user_verifications
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "users_can_insert_own_verifications" ON user_verifications
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "moderators_can_view_all_verifications" ON user_verifications
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.user_type = 'moderator'
        )
    );

CREATE POLICY "moderators_can_update_verifications" ON user_verifications
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE profiles.id = auth.uid() 
            AND profiles.user_type = 'moderator'
        )
    );

-- Function to update user verification level
CREATE OR REPLACE FUNCTION update_user_verification_level(user_uuid UUID)
RETURNS TEXT AS $$
DECLARE
    phone_verified BOOLEAN;
    id_verified BOOLEAN;
    new_level TEXT;
BEGIN
    -- Check phone verification
    SELECT phone_verified INTO phone_verified 
    FROM profiles 
    WHERE id = user_uuid;
    
    -- Check ID verification
    SELECT (id_verification_status = 'approved') INTO id_verified
    FROM profiles 
    WHERE id = user_uuid;
    
    -- Determine verification level
    IF phone_verified AND id_verified THEN
        new_level := 'fully_verified';
    ELSIF id_verified THEN
        new_level := 'id_only';
    ELSIF phone_verified THEN
        new_level := 'phone_only';
    ELSE
        new_level := 'unverified';
    END IF;
    
    -- Update profile
    UPDATE profiles 
    SET verification_level = new_level,
        verified_at = CASE WHEN new_level = 'fully_verified' THEN NOW() ELSE verified_at END,
        updated_at = NOW()
    WHERE id = user_uuid;
    
    RETURN new_level;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to update verification level when verifications change
CREATE OR REPLACE FUNCTION trigger_update_verification_level()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM update_user_verification_level(NEW.user_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_verification_level_trigger
    AFTER INSERT OR UPDATE ON user_verifications
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_verification_level();

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_verifications_user_id ON user_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_user_verifications_type ON user_verifications(verification_type);
CREATE INDEX IF NOT EXISTS idx_user_verifications_status ON user_verifications(status);
CREATE INDEX IF NOT EXISTS idx_profiles_verification_level ON profiles(verification_level);
CREATE INDEX IF NOT EXISTS idx_profiles_phone_verified ON profiles(phone_verified);
CREATE INDEX IF NOT EXISTS idx_profiles_id_verification_status ON profiles(id_verification_status);
