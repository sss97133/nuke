-- Minimal setup for vehicle profile system
-- Only essential tables needed for basic functionality

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create profiles table to link with auth.users
CREATE TABLE IF NOT EXISTS profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    email TEXT,
    full_name TEXT,
    avatar_url TEXT,
    bio TEXT,
    location TEXT,
    website TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create vehicles table
CREATE TABLE IF NOT EXISTS vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    year INTEGER,
    vin TEXT UNIQUE,
    license_plate TEXT,
    color TEXT,
    mileage INTEGER,
    fuel_type TEXT,
    transmission TEXT,
    engine_size TEXT,
    horsepower INTEGER,
    torque INTEGER,
    drivetrain TEXT,
    body_style TEXT,
    doors INTEGER,
    seats INTEGER,
    weight_lbs INTEGER,
    length_inches INTEGER,
    width_inches INTEGER,
    height_inches INTEGER,
    wheelbase_inches INTEGER,
    fuel_capacity_gallons DECIMAL(5,2),
    mpg_city INTEGER,
    mpg_highway INTEGER,
    mpg_combined INTEGER,
    msrp DECIMAL(10,2),
    current_value DECIMAL(10,2),
    purchase_price DECIMAL(10,2),
    purchase_date DATE,
    purchase_location TEXT,
    previous_owners INTEGER DEFAULT 0,
    is_modified BOOLEAN DEFAULT FALSE,
    modification_details TEXT,
    condition_rating INTEGER CHECK (condition_rating >= 1 AND condition_rating <= 10),
    maintenance_notes TEXT,
    insurance_company TEXT,
    insurance_policy_number TEXT,
    registration_state TEXT,
    registration_expiry DATE,
    inspection_expiry DATE,
    is_public BOOLEAN DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;

-- Create policies for profiles
CREATE POLICY "Public profiles are viewable by everyone" ON profiles
    FOR SELECT USING (true);

CREATE POLICY "Users can insert their own profile" ON profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON profiles
    FOR UPDATE USING (auth.uid() = id);

-- Create policies for vehicles
CREATE POLICY "Users can view their own vehicles" ON vehicles
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own vehicles" ON vehicles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own vehicles" ON vehicles
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own vehicles" ON vehicles
    FOR DELETE USING (auth.uid() = user_id);

-- Public vehicles are viewable by everyone
CREATE POLICY "Public vehicles are viewable by everyone" ON vehicles
    FOR SELECT USING (is_public = true);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_vehicles_user_id ON vehicles(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_make_model ON vehicles(make, model);
CREATE INDEX IF NOT EXISTS idx_vehicles_year ON vehicles(year);
CREATE INDEX IF NOT EXISTS idx_vehicles_vin ON vehicles(vin);
CREATE INDEX IF NOT EXISTS idx_vehicles_public ON vehicles(is_public);
CREATE INDEX IF NOT EXISTS idx_vehicles_created_at ON vehicles(created_at);

-- Create function to handle new user registration
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'avatar_url'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically create profile on user signup
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers to automatically update updated_at
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vehicles_updated_at
    BEFORE UPDATE ON vehicles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
