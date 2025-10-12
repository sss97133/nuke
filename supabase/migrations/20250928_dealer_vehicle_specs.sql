-- Create table for dealer vehicle specifications
-- This will be populated from dealer guidebooks, manufacturer data sheets, etc.
CREATE TABLE IF NOT EXISTS public.dealer_vehicle_specs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    year INTEGER NOT NULL,
    trim TEXT,
    
    -- Engine & Performance
    engine TEXT,
    horsepower INTEGER,
    torque INTEGER,
    transmission TEXT,
    drivetrain TEXT,
    fuel_type TEXT,
    
    -- Fuel Economy
    mpg_city INTEGER,
    mpg_highway INTEGER,
    mpg_combined INTEGER,
    fuel_capacity_gallons DECIMAL(5,2),
    
    -- Dimensions
    weight_lbs INTEGER,
    length_inches DECIMAL(6,2),
    width_inches DECIMAL(6,2),
    height_inches DECIMAL(6,2),
    wheelbase_inches DECIMAL(6,2),
    ground_clearance_inches DECIMAL(4,2),
    
    -- Capacity
    seating_capacity INTEGER,
    doors INTEGER,
    cargo_volume_cubic_feet DECIMAL(6,2),
    towing_capacity_lbs INTEGER,
    payload_capacity_lbs INTEGER,
    
    -- Pricing
    msrp INTEGER,
    invoice_price INTEGER,
    
    -- Source Information
    source TEXT, -- 'manufacturer', 'dealer_guide', 'user_contributed', etc.
    source_date DATE,
    confidence_score DECIMAL(3,2), -- 0.00 to 1.00
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Create unique constraint for make/model/year/trim combination
    CONSTRAINT unique_vehicle_spec UNIQUE (make, model, year, COALESCE(trim, ''))
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_dealer_specs_make_model_year 
ON public.dealer_vehicle_specs(make, model, year);

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION update_dealer_specs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_dealer_specs_updated_at
    BEFORE UPDATE ON public.dealer_vehicle_specs
    FOR EACH ROW
    EXECUTE FUNCTION update_dealer_specs_updated_at();

-- Insert some sample data for common vehicles
INSERT INTO public.dealer_vehicle_specs (
    make, model, year, trim, engine, horsepower, torque, transmission, 
    drivetrain, fuel_type, mpg_city, mpg_highway, mpg_combined,
    weight_lbs, length_inches, width_inches, height_inches, wheelbase_inches,
    seating_capacity, doors, msrp, source, confidence_score
) VALUES 
    ('Toyota', 'Land Cruiser', 1997, 'Base', '4.5L I6', 212, 275, '4-speed automatic',
     '4WD', 'gasoline', 13, 16, 14, 5115, 189.0, 76.4, 73.4, 112.2,
     8, 4, 45320, 'manufacturer', 0.95),
     
    ('Chevrolet', 'Suburban', 1995, 'C1500', '5.7L V8', 200, 310, '4-speed automatic',
     'RWD', 'gasoline', 13, 17, 15, 4769, 219.5, 76.7, 72.0, 131.5,
     9, 4, 24995, 'dealer_guide', 0.90),
     
    ('Lexus', 'LX', 1997, '450', '4.5L I6', 212, 275, '4-speed automatic',
     '4WD', 'gasoline', 13, 16, 14, 5401, 188.5, 76.4, 73.0, 112.2,
     8, 4, 47500, 'manufacturer', 0.95);

-- Grant appropriate permissions
GRANT SELECT ON public.dealer_vehicle_specs TO anon;
GRANT ALL ON public.dealer_vehicle_specs TO authenticated;

-- Add comment for documentation
COMMENT ON TABLE public.dealer_vehicle_specs IS 'Stores vehicle specifications from dealer guidebooks, manufacturer data sheets, and verified sources for auto-population of vehicle data';
