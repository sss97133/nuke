-- Incremental Schema Migration Approach
-- Date: 2025-05-15
-- This script implements a phased database migration strategy,
-- focusing first on the core vehicle data model and building outward.

--------------------------------------------------
-- PHASE 1: CORE VEHICLE IDENTITY
--------------------------------------------------

-- First, clear any existing tables that might be causing issues
-- WARNING: This will delete existing data. Comment out if not needed
-- DROP TABLE IF EXISTS public.vehicle_verification_history;
-- DROP TABLE IF EXISTS public.vehicle_auth_sessions;
-- DROP TABLE IF EXISTS public.user_interactions;
-- DROP TABLE IF EXISTS public.vehicles CASCADE;

-- Create base vehicles table with minimal required fields
CREATE TABLE IF NOT EXISTS public.vehicles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    year INTEGER NOT NULL,
    vin TEXT,
    verification_level TEXT DEFAULT 'unverified',
    trust_score INTEGER DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- Add RLS policies for the vehicles table
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

-- Vehicle policies - users can select vehicles they own
CREATE POLICY "Users can view own vehicles" ON public.vehicles
    FOR SELECT USING (user_id = auth.uid());
    
-- Users can insert vehicles with their own user_id
CREATE POLICY "Users can insert own vehicles" ON public.vehicles
    FOR INSERT WITH CHECK (user_id = auth.uid());
    
-- Users can update vehicles they own
CREATE POLICY "Users can update own vehicles" ON public.vehicles
    FOR UPDATE USING (user_id = auth.uid());

-- Create a function to insert a test vehicle for debugging
CREATE OR REPLACE FUNCTION public.add_test_vehicle(
    user_uuid UUID,
    vehicle_make TEXT DEFAULT 'Test',
    vehicle_model TEXT DEFAULT 'Model',
    vehicle_year INTEGER DEFAULT 2023
) RETURNS jsonb AS $$
DECLARE
    vehicle_id UUID;
BEGIN
    INSERT INTO public.vehicles (
        user_id,
        make,
        model,
        year,
        vin,
        notes
    ) VALUES (
        user_uuid,
        vehicle_make,
        vehicle_model,
        vehicle_year,
        'TEST' || floor(random() * 1000000)::text,
        'Test vehicle created for debugging'
    )
    RETURNING id INTO vehicle_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'vehicle_id', vehicle_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant access to the test function
GRANT EXECUTE ON FUNCTION public.add_test_vehicle TO authenticated, service_role;

-- Create a function to check if user has any vehicles
CREATE OR REPLACE FUNCTION public.has_vehicles(user_uuid UUID)
RETURNS boolean AS $$
DECLARE
    has_any boolean;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM public.vehicles 
        WHERE user_id = user_uuid
    ) INTO has_any;
    
    RETURN has_any;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant access to the function
GRANT EXECUTE ON FUNCTION public.has_vehicles TO authenticated, service_role;

-- Ensure profile table exists with minimal fields
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    username TEXT UNIQUE,
    email TEXT,
    onboarding_completed BOOLEAN DEFAULT false,
    onboarding_step INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

-- Add RLS policies for profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can view their own profile
CREATE POLICY "Users can view own profile" ON public.profiles
    FOR SELECT USING (id = auth.uid());
    
-- Users can update their own profile
CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE USING (id = auth.uid());

-- Trigger to create a profile when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, username, email)
    VALUES (NEW.id, NEW.email, NEW.email);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for new users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create a simple vehicle_events table for basic timeline
CREATE TABLE IF NOT EXISTS public.vehicle_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID REFERENCES public.vehicles(id) NOT NULL,
    event_type TEXT NOT NULL,
    event_date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
    created_by UUID REFERENCES auth.users(id) NOT NULL
);

-- Add RLS policies for vehicle events
ALTER TABLE public.vehicle_events ENABLE ROW LEVEL SECURITY;

-- Users can view events for vehicles they own
CREATE POLICY "Users can view events for own vehicles" ON public.vehicle_events
    FOR SELECT USING (
        vehicle_id IN (
            SELECT id FROM public.vehicles WHERE user_id = auth.uid()
        )
    );

-- Users can create events for vehicles they own
CREATE POLICY "Users can create events for own vehicles" ON public.vehicle_events
    FOR INSERT WITH CHECK (
        vehicle_id IN (
            SELECT id FROM public.vehicles WHERE user_id = auth.uid()
        ) AND created_by = auth.uid()
    );

-- Create a helper function to get a user's vehicles
CREATE OR REPLACE FUNCTION public.get_user_vehicles(user_uuid UUID)
RETURNS TABLE (
    id UUID,
    make TEXT,
    model TEXT,
    year INTEGER,
    vin TEXT,
    verification_level TEXT,
    trust_score INTEGER,
    created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        v.id,
        v.make,
        v.model,
        v.year,
        v.vin,
        v.verification_level,
        v.trust_score,
        v.created_at
    FROM 
        public.vehicles v
    WHERE 
        v.user_id = user_uuid
    ORDER BY 
        v.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant access to the function
GRANT EXECUTE ON FUNCTION public.get_user_vehicles TO authenticated, service_role;

-- Initialize user welcome script for onboarding
CREATE OR REPLACE FUNCTION public.initialize_user_onboarding(user_uuid UUID)
RETURNS jsonb AS $$
DECLARE
    profile_exists boolean;
    has_any_vehicles boolean;
BEGIN
    -- Check if profile exists
    SELECT EXISTS(
        SELECT 1 FROM public.profiles 
        WHERE id = user_uuid
    ) INTO profile_exists;
    
    -- If profile doesn't exist, create one
    IF NOT profile_exists THEN
        INSERT INTO public.profiles (
            id,
            username,
            email,
            onboarding_completed,
            onboarding_step
        ) 
        SELECT 
            id,
            email,
            email,
            false,
            0
        FROM 
            auth.users
        WHERE 
            id = user_uuid;
    END IF;
    
    -- Check if user has any vehicles
    SELECT public.has_vehicles(user_uuid) INTO has_any_vehicles;
    
    -- Return user's onboarding state
    RETURN jsonb_build_object(
        'profile_created', profile_exists,
        'has_vehicles', has_any_vehicles,
        'ready_for_onboarding', true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant access to the function
GRANT EXECUTE ON FUNCTION public.initialize_user_onboarding TO authenticated, service_role;
