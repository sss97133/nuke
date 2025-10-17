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

-- Insert more detailed production data with breakdowns like Marti Reports
INSERT INTO vehicle_production_data (make, model, year, body_style, trim_level, engine_option, total_produced, rarity_level, rarity_reason, data_source, msrp) VALUES
-- Common vehicles with detailed breakdowns
('Toyota', 'Camry', 2020, 'sedan', 'LE', '2.5L I4', 120000, 'MASS_PRODUCTION', 'High volume sedan production', 'manufacturer', 24425.00),
('Toyota', 'Camry', 2020, 'sedan', 'XLE', '2.5L I4', 80000, 'MASS_PRODUCTION', 'High volume sedan production', 'manufacturer', 27400.00),
('Toyota', 'Camry', 2020, 'sedan', 'XSE', '3.5L V6', 45000, 'COMMON', 'Sport trim with V6 option', 'manufacturer', 30400.00),

('Honda', 'Civic', 2020, 'sedan', 'LX', '2.0L I4', 100000, 'MASS_PRODUCTION', 'High volume compact sedan', 'manufacturer', 21020.00),
('Honda', 'Civic', 2020, 'sedan', 'Sport', '1.5L Turbo', 60000, 'COMMON', 'Sport trim with turbo engine', 'manufacturer', 22520.00),
('Honda', 'Civic', 2020, 'coupe', 'Si', '1.5L Turbo', 15000, 'UNCOMMON', 'Performance coupe variant', 'manufacturer', 25020.00),

('Ford', 'F-150', 2020, 'truck', 'XL', '3.3L V6', 200000, 'MASS_PRODUCTION', 'Base work truck configuration', 'manufacturer', 28490.00),
('Ford', 'F-150', 2020, 'truck', 'XLT', '2.7L EcoBoost', 180000, 'MASS_PRODUCTION', 'Popular mid-trim configuration', 'manufacturer', 32490.00),
('Ford', 'F-150', 2020, 'truck', 'Raptor', '3.5L EcoBoost', 8000, 'RARE', 'High-performance off-road variant', 'manufacturer', 53990.00),

-- Classic examples with detailed breakdowns
('Chevrolet', 'Corvette', 1967, 'coupe', 'base', '427 V8', 15000, 'UNCOMMON', 'Classic sports car with big block', 'registry', 4250.00),
('Chevrolet', 'Corvette', 1967, 'coupe', 'L88', '427 V8', 20, 'ULTRA_RARE', 'Racing homologation special', 'registry', 6500.00),

('Ford', 'Mustang', 1965, 'coupe', 'base', '289 V8', 300000, 'MASS_PRODUCTION', 'High production pony car', 'registry', 2368.00),
('Ford', 'Mustang', 1965, 'coupe', 'GT', '289 V8', 150000, 'COMMON', 'Performance variant', 'registry', 2568.00),
('Ford', 'Mustang', 1965, 'convertible', 'GT', '289 V8', 75000, 'UNCOMMON', 'Convertible performance variant', 'registry', 2768.00),

-- Classic trucks with detailed breakdowns
('Chevrolet', 'K5 Blazer', 1977, 'SUV', 'base', '350 V8', 30000, 'UNCOMMON', 'Classic SUV with V8', 'registry', 6500.00),
('Chevrolet', 'K5 Blazer', 1977, 'SUV', 'Silverado', '350 V8', 15000, 'RARE', 'Luxury trim SUV', 'registry', 7500.00),

('Ford', 'Bronco', 1977, 'SUV', 'base', '302 V8', 25000, 'UNCOMMON', 'Classic SUV competitor', 'registry', 6200.00),
('Ford', 'Bronco', 1977, 'SUV', 'Ranger', '351 V8', 10000, 'RARE', 'High-trim SUV variant', 'registry', 7200.00),

-- Exotic examples
('Porsche', '911', 2020, 'coupe', 'base', '3.0L H6', 20000, 'UNCOMMON', 'Luxury sports car', 'manufacturer', 101200.00),
('Porsche', '911', 2020, 'coupe', 'Turbo S', '3.8L H6', 2000, 'RARE', 'High-performance variant', 'manufacturer', 203500.00),

('Ferrari', '488', 2020, 'coupe', 'base', '3.9L V8', 1000, 'RARE', 'Limited production supercar', 'manufacturer', 250000.00),
('Ferrari', '488', 2020, 'coupe', 'Pista', '3.9L V8', 200, 'ULTRA_RARE', 'Track-focused special edition', 'manufacturer', 350000.00),

('Ferrari', 'LaFerrari', 2014, 'coupe', 'base', '6.3L V12 Hybrid', 499, 'ULTRA_RARE', 'Limited edition hypercar', 'manufacturer', 1400000.00),
('McLaren', 'P1', 2014, 'coupe', 'base', '3.8L V8 Hybrid', 375, 'ULTRA_RARE', 'Limited edition hypercar', 'manufacturer', 1150000.00)

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
