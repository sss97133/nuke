-- Vehicle Production Data and Rarity Intelligence
-- This migration adds production numbers and historical rarity data

-- Create vehicle production data table
CREATE TABLE IF NOT EXISTS vehicle_production_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    make TEXT NOT NULL,
    model TEXT NOT NULL,
    year INTEGER NOT NULL,
    body_style TEXT, -- sedan, coupe, convertible, truck, etc.
    trim_level TEXT, -- base, sport, luxury, etc.
    engine_option TEXT, -- v8, v6, turbo, etc.
    
    -- Production numbers
    total_produced INTEGER,
    us_production INTEGER,
    canadian_production INTEGER,
    mexican_production INTEGER,
    export_production INTEGER,
    
    -- Rarity classifications
    rarity_level TEXT CHECK (rarity_level IN ('ULTRA_RARE', 'RARE', 'UNCOMMON', 'COMMON', 'MASS_PRODUCTION')),
    rarity_reason TEXT, -- why it's rare (limited edition, low production, etc.)
    
    -- Market data
    msrp DECIMAL(10,2),
    current_market_value_low DECIMAL(10,2),
    current_market_value_high DECIMAL(10,2),
    collector_demand_score INTEGER CHECK (collector_demand_score >= 1 AND collector_demand_score <= 10),
    
    -- Data source and verification
    data_source TEXT, -- manufacturer, registry, auction_data, etc.
    source_url TEXT,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    verified_by TEXT, -- user who verified this data
    verification_date TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(make, model, year, body_style, trim_level, engine_option)
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_vehicle_production_make_model_year ON vehicle_production_data(make, model, year);
CREATE INDEX IF NOT EXISTS idx_vehicle_production_rarity ON vehicle_production_data(rarity_level);
CREATE INDEX IF NOT EXISTS idx_vehicle_production_total_produced ON vehicle_production_data(total_produced);

-- Enable RLS
ALTER TABLE vehicle_production_data ENABLE ROW LEVEL SECURITY;

-- Allow public read access to production data
CREATE POLICY "vehicle_production_data_read" ON vehicle_production_data
    FOR SELECT USING (true);

-- Allow authenticated users to insert/update production data
CREATE POLICY "vehicle_production_data_write" ON vehicle_production_data
    FOR ALL USING (auth.role() = 'authenticated');

-- Insert some known production data for common vehicles
INSERT INTO vehicle_production_data (make, model, year, total_produced, rarity_level, rarity_reason, data_source, msrp) VALUES
-- Common vehicles
('Toyota', 'Camry', 2020, 294348, 'MASS_PRODUCTION', 'High volume production', 'manufacturer', 24425.00),
('Honda', 'Civic', 2020, 261225, 'MASS_PRODUCTION', 'High volume production', 'manufacturer', 21020.00),
('Ford', 'F-150', 2020, 787422, 'MASS_PRODUCTION', 'Best selling truck', 'manufacturer', 28490.00),

-- Uncommon vehicles
('Porsche', '911', 2020, 35250, 'UNCOMMON', 'Luxury sports car', 'manufacturer', 101200.00),
('Ferrari', '488', 2020, 1200, 'RARE', 'Limited production supercar', 'manufacturer', 250000.00),

-- Ultra rare vehicles
('Ferrari', 'LaFerrari', 2014, 499, 'ULTRA_RARE', 'Limited edition hypercar', 'manufacturer', 1400000.00),
('McLaren', 'P1', 2014, 375, 'ULTRA_RARE', 'Limited edition hypercar', 'manufacturer', 1150000.00),

-- Classic examples
('Chevrolet', 'Corvette', 1967, 22702, 'UNCOMMON', 'Classic sports car', 'registry', 4250.00),
('Ford', 'Mustang', 1965, 559451, 'COMMON', 'High production pony car', 'registry', 2368.00),

-- Classic trucks
('Chevrolet', 'K5 Blazer', 1977, 45000, 'UNCOMMON', 'Classic SUV', 'registry', 6500.00),
('Ford', 'Bronco', 1977, 35000, 'UNCOMMON', 'Classic SUV', 'registry', 6200.00)

ON CONFLICT (make, model, year, body_style, trim_level, engine_option) DO NOTHING;

-- Create a function to get rarity data for a vehicle
CREATE OR REPLACE FUNCTION get_vehicle_rarity_data(
    p_make TEXT,
    p_model TEXT,
    p_year INTEGER,
    p_body_style TEXT DEFAULT NULL,
    p_trim_level TEXT DEFAULT NULL,
    p_engine_option TEXT DEFAULT NULL
)
RETURNS TABLE (
    total_produced INTEGER,
    rarity_level TEXT,
    rarity_reason TEXT,
    collector_demand_score INTEGER,
    market_value_low DECIMAL(10,2),
    market_value_high DECIMAL(10,2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        vpd.total_produced,
        vpd.rarity_level,
        vpd.rarity_reason,
        vpd.collector_demand_score,
        vpd.current_market_value_low,
        vpd.current_market_value_high
    FROM vehicle_production_data vpd
    WHERE vpd.make ILIKE p_make
        AND vpd.model ILIKE p_model
        AND vpd.year = p_year
        AND (p_body_style IS NULL OR vpd.body_style ILIKE p_body_style)
        AND (p_trim_level IS NULL OR vpd.trim_level ILIKE p_trim_level)
        AND (p_engine_option IS NULL OR vpd.engine_option ILIKE p_engine_option)
    ORDER BY 
        CASE WHEN p_body_style IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN p_trim_level IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN p_engine_option IS NOT NULL THEN 0 ELSE 1 END
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Create a view for easy rarity lookups
CREATE OR REPLACE VIEW vehicle_rarity_view AS
SELECT 
    vpd.make,
    vpd.model,
    vpd.year,
    vpd.body_style,
    vpd.trim_level,
    vpd.engine_option,
    vpd.total_produced,
    vpd.rarity_level,
    vpd.rarity_reason,
    vpd.collector_demand_score,
    vpd.current_market_value_low,
    vpd.current_market_value_high,
    vpd.data_source,
    vpd.last_updated
FROM vehicle_production_data vpd
ORDER BY vpd.make, vpd.model, vpd.year;
