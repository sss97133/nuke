-- Migration script to fix schema issues for vehicle-centric authentication
-- Created: 2025-05-15

-- Add missing columns to vehicles table
ALTER TABLE IF EXISTS public.vehicles
ADD COLUMN IF NOT EXISTS verification_level TEXT DEFAULT 'unverified',
ADD COLUMN IF NOT EXISTS trust_score INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS verified_by UUID,
ADD COLUMN IF NOT EXISTS verification_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS identity_hash TEXT,
ADD COLUMN IF NOT EXISTS blockchain_record_id TEXT,
ADD COLUMN IF NOT EXISTS last_verification_attempt TIMESTAMP WITH TIME ZONE;

-- Add vehicle trust thresholds table
CREATE TABLE IF NOT EXISTS public.vehicle_trust_thresholds (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    level TEXT NOT NULL,
    min_score INTEGER NOT NULL,
    description TEXT NOT NULL,
    benefits TEXT[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- Insert default trust threshold levels
INSERT INTO public.vehicle_trust_thresholds (level, min_score, description, benefits)
VALUES 
    ('unverified', 0, 'Vehicle has been registered but not verified', '{}'),
    ('basic', 10, 'Basic verification through VIN and ownership documents', '{basic_access}'),
    ('standard', 50, 'Standard verification with multiple identity proofs', '{standard_access,history_view}'),
    ('enhanced', 100, 'Enhanced verification with blockchain records', '{enhanced_access,full_history,marketplace_access}'),
    ('premium', 200, 'Premium verification with physical inspection', '{premium_access,all_features}')
ON CONFLICT DO NOTHING;

-- Enhance user_interactions table for vehicle interactions
ALTER TABLE IF EXISTS public.user_interactions
ADD COLUMN IF NOT EXISTS vehicle_id UUID,
ADD COLUMN IF NOT EXISTS interaction_context TEXT,
ADD COLUMN IF NOT EXISTS trust_impact INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS verified_by_system BOOLEAN DEFAULT false;

-- Create vehicle_verification_history table
CREATE TABLE IF NOT EXISTS public.vehicle_verification_history (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    vehicle_id UUID NOT NULL REFERENCES public.vehicles(id),
    verification_type TEXT NOT NULL,
    verification_data JSONB DEFAULT '{}',
    trust_score_change INTEGER DEFAULT 0,
    verified_by_user_id UUID REFERENCES auth.users(id),
    verification_status TEXT DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- Create vehicle_auth_sessions table to track vehicle-centric logins
CREATE TABLE IF NOT EXISTS public.vehicle_auth_sessions (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id),
    vehicle_id UUID NOT NULL REFERENCES public.vehicles(id),
    session_start TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
    session_end TIMESTAMP WITH TIME ZONE,
    device_info JSONB DEFAULT '{}',
    ip_address TEXT,
    geolocation JSONB DEFAULT '{}',
    session_activity JSONB DEFAULT '[]'
);

-- Add RLS policies for the new tables
ALTER TABLE public.vehicle_trust_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_verification_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_auth_sessions ENABLE ROW LEVEL SECURITY;

-- Create policies for vehicle_trust_thresholds (viewable by anyone)
CREATE POLICY "Enable read access for all users" ON public.vehicle_trust_thresholds
    FOR SELECT USING (true);

-- Create policies for vehicle_verification_history
CREATE POLICY "Enable insert for authenticated users" ON public.vehicle_verification_history
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');
    
CREATE POLICY "Enable read access for vehicle owners" ON public.vehicle_verification_history
    FOR SELECT USING (
        vehicle_id IN (
            SELECT id FROM public.vehicles WHERE user_id = auth.uid()
        )
    );

-- Create policies for vehicle_auth_sessions
CREATE POLICY "Enable insert for authenticated users" ON public.vehicle_auth_sessions
    FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND user_id = auth.uid());
    
CREATE POLICY "Enable read for own sessions" ON public.vehicle_auth_sessions
    FOR SELECT USING (user_id = auth.uid());

-- Add foreign key constraints
ALTER TABLE public.user_interactions
ADD CONSTRAINT fk_user_interactions_vehicle
FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);

-- Update existing rows in vehicles to have default trust scores
UPDATE public.vehicles
SET verification_level = 'unverified', 
    trust_score = 0
WHERE verification_level IS NULL;

-- Initialize profiles if empty
INSERT INTO public.profiles (id, username, onboarding_completed, onboarding_step)
SELECT id, email, false, 0
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles);
