-- Receipt and Parts Tracking System
-- Track build expenses, parts purchases, and spending patterns

-- Create receipt status enum
DO $$ BEGIN
    CREATE TYPE receipt_status AS ENUM ('pending', 'processing', 'processed', 'failed', 'verified');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create parts category enum
DO $$ BEGIN
    CREATE TYPE parts_category AS ENUM (
        'engine', 'transmission', 'suspension', 'brakes', 'electrical',
        'interior', 'exterior', 'exhaust', 'cooling', 'fuel_system',
        'tools', 'consumables', 'hardware', 'paint', 'labor'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Receipts table - stores receipt images and metadata
CREATE TABLE IF NOT EXISTS receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
    timeline_event_id UUID REFERENCES timeline_events(id) ON DELETE SET NULL,

    -- Receipt image and data
    receipt_image_url TEXT NOT NULL,
    receipt_thumbnail_url TEXT,
    original_filename TEXT,

    -- Vendor/Store information
    vendor_name TEXT,
    vendor_address TEXT,
    vendor_phone TEXT,
    vendor_website TEXT,

    -- Purchase details
    purchase_date TIMESTAMPTZ,
    total_amount DECIMAL(10,2),
    tax_amount DECIMAL(10,2),
    currency TEXT DEFAULT 'USD',

    -- OCR and processing
    ocr_text TEXT,
    ocr_confidence DECIMAL(3,2),
    processing_status receipt_status DEFAULT 'pending',
    processing_error TEXT,
    processing_attempts INTEGER DEFAULT 0,

    -- Manual verification
    verified_by UUID REFERENCES auth.users(id),
    verified_at TIMESTAMPTZ,
    verification_notes TEXT,

    -- Receipt metadata
    receipt_number TEXT,
    payment_method TEXT, -- cash, card, check, etc.
    tags TEXT[] DEFAULT '{}',

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Receipt line items - individual parts/services from receipts
CREATE TABLE IF NOT EXISTS receipt_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,

    -- Item identification
    part_number TEXT,
    description TEXT NOT NULL,
    brand TEXT,
    category parts_category,

    -- Pricing
    quantity DECIMAL(8,2) DEFAULT 1,
    unit_price DECIMAL(10,2),
    line_total DECIMAL(10,2) NOT NULL,
    discount_amount DECIMAL(10,2) DEFAULT 0,

    -- Item metadata
    sku TEXT,
    upc TEXT,
    warranty_months INTEGER,
    core_charge DECIMAL(10,2) DEFAULT 0,

    -- OCR extraction confidence
    extraction_confidence DECIMAL(3,2),
    manually_verified BOOLEAN DEFAULT FALSE,

    -- Installation tracking
    installation_status TEXT DEFAULT 'purchased', -- purchased, received, installed, returned
    installation_date TIMESTAMPTZ,
    installed_by UUID REFERENCES auth.users(id),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Parts database - master catalog of automotive parts
CREATE TABLE IF NOT EXISTS parts_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Part identification
    part_number TEXT NOT NULL,
    oem_part_number TEXT,
    aftermarket_part_numbers TEXT[] DEFAULT '{}',

    -- Part details
    name TEXT NOT NULL,
    description TEXT,
    brand TEXT NOT NULL,
    category parts_category NOT NULL,

    -- Vehicle compatibility
    compatible_makes TEXT[] DEFAULT '{}',
    compatible_models TEXT[] DEFAULT '{}',
    compatible_years INTEGER[] DEFAULT '{}',

    -- Specifications
    specifications JSONB DEFAULT '{}',
    dimensions JSONB DEFAULT '{}',
    weight_lbs DECIMAL(8,2),

    -- Pricing data (aggregated from receipts)
    average_price DECIMAL(10,2),
    min_price DECIMAL(10,2),
    max_price DECIMAL(10,2),
    price_updated_at TIMESTAMPTZ,

    -- Usage statistics
    install_count INTEGER DEFAULT 0,
    popularity_score INTEGER DEFAULT 0,

    -- Data quality
    verified BOOLEAN DEFAULT FALSE,
    verified_by UUID REFERENCES auth.users(id),
    data_source TEXT DEFAULT 'user_contributed',

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(part_number, brand)
);

-- User spending analytics
CREATE TABLE IF NOT EXISTS spending_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,

    -- Time period
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    period_type TEXT NOT NULL, -- daily, weekly, monthly, yearly

    -- Spending breakdown
    total_spent DECIMAL(12,2) DEFAULT 0,
    parts_spent DECIMAL(12,2) DEFAULT 0,
    tools_spent DECIMAL(12,2) DEFAULT 0,
    labor_spent DECIMAL(12,2) DEFAULT 0,
    consumables_spent DECIMAL(12,2) DEFAULT 0,

    -- Category breakdown
    category_breakdown JSONB DEFAULT '{}',
    vendor_breakdown JSONB DEFAULT '{}',

    -- Statistics
    receipt_count INTEGER DEFAULT 0,
    average_receipt_amount DECIMAL(10,2) DEFAULT 0,
    largest_purchase DECIMAL(10,2) DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, vehicle_id, period_start, period_type)
);

-- Functions for receipt processing

-- Function to extract parts data from OCR text
CREATE OR REPLACE FUNCTION extract_parts_from_ocr(
    receipt_id_param UUID,
    ocr_text_param TEXT
)
RETURNS INTEGER AS $$
DECLARE
    parts_found INTEGER := 0;
    line TEXT;
    part_desc TEXT;
    price_match TEXT;
    price_val DECIMAL(10,2);
BEGIN
    -- Simple pattern matching for common receipt formats
    -- This is a basic implementation - in production you'd want more sophisticated parsing

    FOR line IN SELECT unnest(string_to_array(ocr_text_param, E'\n'))
    LOOP
        -- Look for lines that contain price patterns ($XX.XX or XX.XX)
        IF line ~ '\$?[0-9]+\.[0-9]{2}' THEN
            -- Extract description (everything before the price)
            part_desc := regexp_replace(line, '\s+\$?[0-9]+\.[0-9]{2}.*$', '');

            -- Extract price
            price_match := (regexp_matches(line, '(\$?[0-9]+\.[0-9]{2})'))[1];
            price_val := CAST(regexp_replace(price_match, '\$', '') AS DECIMAL(10,2));

            -- Only insert if we have a meaningful description and reasonable price
            IF LENGTH(TRIM(part_desc)) > 3 AND price_val > 0 AND price_val < 10000 THEN
                INSERT INTO receipt_items (
                    receipt_id,
                    description,
                    line_total,
                    extraction_confidence,
                    category
                ) VALUES (
                    receipt_id_param,
                    TRIM(part_desc),
                    price_val,
                    0.7, -- Basic OCR confidence
                    CASE
                        WHEN LOWER(part_desc) ~ 'oil|filter|fluid' THEN 'consumables'
                        WHEN LOWER(part_desc) ~ 'brake|pad|rotor' THEN 'brakes'
                        WHEN LOWER(part_desc) ~ 'spark|plug|wire' THEN 'electrical'
                        WHEN LOWER(part_desc) ~ 'engine|motor|block' THEN 'engine'
                        WHEN LOWER(part_desc) ~ 'transmission|trans' THEN 'transmission'
                        WHEN LOWER(part_desc) ~ 'suspension|shock|spring' THEN 'suspension'
                        WHEN LOWER(part_desc) ~ 'paint|primer|clear' THEN 'paint'
                        WHEN LOWER(part_desc) ~ 'tool|wrench|socket' THEN 'tools'
                        ELSE 'hardware'
                    END
                );

                parts_found := parts_found + 1;
            END IF;
        END IF;
    END LOOP;

    RETURN parts_found;
END;
$$ LANGUAGE plpgsql;

-- Function to update parts catalog pricing from receipts
CREATE OR REPLACE FUNCTION update_parts_pricing()
RETURNS VOID AS $$
BEGIN
    -- Update average pricing for parts based on receipt data
    WITH part_prices AS (
        SELECT
            LOWER(TRIM(ri.description)) as part_key,
            ri.brand,
            AVG(ri.unit_price) as avg_price,
            MIN(ri.unit_price) as min_price,
            MAX(ri.unit_price) as max_price,
            COUNT(*) as sample_count
        FROM receipt_items ri
        JOIN receipts r ON ri.receipt_id = r.id
        WHERE ri.unit_price > 0
        AND r.processing_status = 'processed'
        AND ri.manually_verified = true
        GROUP BY LOWER(TRIM(ri.description)), ri.brand
        HAVING COUNT(*) >= 2 -- At least 2 data points
    )
    UPDATE parts_catalog pc
    SET
        average_price = pp.avg_price,
        min_price = pp.min_price,
        max_price = pp.max_price,
        price_updated_at = NOW()
    FROM part_prices pp
    WHERE LOWER(pc.name) = pp.part_key
    AND (pc.brand IS NULL OR LOWER(pc.brand) = LOWER(pp.brand));
END;
$$ LANGUAGE plpgsql;

-- Function to generate spending analytics
CREATE OR REPLACE FUNCTION generate_spending_analytics(
    target_user_id UUID,
    target_vehicle_id UUID DEFAULT NULL,
    start_date TIMESTAMPTZ DEFAULT NOW() - INTERVAL '1 month',
    end_date TIMESTAMPTZ DEFAULT NOW()
)
RETURNS VOID AS $$
DECLARE
    total_amount DECIMAL(12,2);
    parts_total DECIMAL(12,2);
    tools_total DECIMAL(12,2);
    labor_total DECIMAL(12,2);
    consumables_total DECIMAL(12,2);
    receipt_cnt INTEGER;
BEGIN
    -- Calculate totals
    SELECT
        COALESCE(SUM(r.total_amount), 0),
        COALESCE(SUM(CASE WHEN ri.category IN ('engine', 'transmission', 'suspension', 'brakes', 'electrical', 'exterior', 'interior') THEN ri.line_total ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN ri.category = 'tools' THEN ri.line_total ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN ri.category = 'labor' THEN ri.line_total ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN ri.category IN ('consumables', 'hardware', 'paint') THEN ri.line_total ELSE 0 END), 0),
        COUNT(DISTINCT r.id)
    INTO total_amount, parts_total, tools_total, labor_total, consumables_total, receipt_cnt
    FROM receipts r
    LEFT JOIN receipt_items ri ON r.id = ri.receipt_id
    WHERE r.user_id = target_user_id
    AND r.purchase_date >= start_date
    AND r.purchase_date <= end_date
    AND (target_vehicle_id IS NULL OR r.vehicle_id = target_vehicle_id);

    -- Insert analytics record
    INSERT INTO spending_analytics (
        user_id,
        vehicle_id,
        period_start,
        period_end,
        period_type,
        total_spent,
        parts_spent,
        tools_spent,
        labor_spent,
        consumables_spent,
        receipt_count,
        average_receipt_amount
    ) VALUES (
        target_user_id,
        target_vehicle_id,
        start_date,
        end_date,
        'custom',
        total_amount,
        parts_total,
        tools_total,
        labor_total,
        consumables_total,
        receipt_cnt,
        CASE WHEN receipt_cnt > 0 THEN total_amount / receipt_cnt ELSE 0 END
    )
    ON CONFLICT (user_id, vehicle_id, period_start, period_type) DO UPDATE SET
        total_spent = EXCLUDED.total_spent,
        parts_spent = EXCLUDED.parts_spent,
        tools_spent = EXCLUDED.tools_spent,
        labor_spent = EXCLUDED.labor_spent,
        consumables_spent = EXCLUDED.consumables_spent,
        receipt_count = EXCLUDED.receipt_count,
        average_receipt_amount = EXCLUDED.average_receipt_amount,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_receipts_user_vehicle ON receipts(user_id, vehicle_id);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(purchase_date DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_status ON receipts(processing_status);
CREATE INDEX IF NOT EXISTS idx_receipts_vendor ON receipts(vendor_name);

CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_category ON receipt_items(category);
CREATE INDEX IF NOT EXISTS idx_receipt_items_price ON receipt_items(unit_price);
CREATE INDEX IF NOT EXISTS idx_receipt_items_part_number ON receipt_items(part_number);

CREATE INDEX IF NOT EXISTS idx_parts_catalog_number ON parts_catalog(part_number);
CREATE INDEX IF NOT EXISTS idx_parts_catalog_brand ON parts_catalog(brand);
CREATE INDEX IF NOT EXISTS idx_parts_catalog_category ON parts_catalog(category);
CREATE INDEX IF NOT EXISTS idx_parts_catalog_name ON parts_catalog(name);

CREATE INDEX IF NOT EXISTS idx_spending_analytics_user ON spending_analytics(user_id, vehicle_id);
CREATE INDEX IF NOT EXISTS idx_spending_analytics_period ON spending_analytics(period_start, period_end);

-- RLS Policies
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE spending_analytics ENABLE ROW LEVEL SECURITY;

-- Receipts policies
CREATE POLICY "Users can manage their own receipts" ON receipts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Receipt items follow receipt permissions" ON receipt_items FOR ALL USING (
    receipt_id IN (SELECT id FROM receipts WHERE user_id = auth.uid())
);

-- Parts catalog is publicly viewable but only approved users can edit
CREATE POLICY "Parts catalog is publicly viewable" ON parts_catalog FOR SELECT USING (true);
CREATE POLICY "Verified users can contribute to parts catalog" ON parts_catalog FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Users can update their contributions" ON parts_catalog FOR UPDATE USING (verified_by = auth.uid() OR auth.uid() IS NOT NULL);

-- Spending analytics are private to user
CREATE POLICY "Users can view their spending analytics" ON spending_analytics FOR SELECT USING (auth.uid() = user_id);

-- Insert sample parts catalog data
INSERT INTO parts_catalog (part_number, name, brand, category, compatible_makes, average_price) VALUES
('OE-123456', 'Engine Oil Filter', 'OEM', 'consumables', ARRAY['Chevrolet', 'GMC'], 12.99),
('AC-789012', 'Air Filter', 'AC Delco', 'consumables', ARRAY['Chevrolet', 'GMC'], 24.99),
('MOB1-5W30', '5W-30 Motor Oil', 'Mobil 1', 'consumables', ARRAY['Universal'], 29.99),
('NGK-456789', 'Spark Plugs (Set)', 'NGK', 'electrical', ARRAY['Universal'], 45.99),
('BECK-789456', 'Brake Pads Front', 'Beck Arnley', 'brakes', ARRAY['Universal'], 89.99),
('MOOG-K123', 'Ball Joint', 'MOOG', 'suspension', ARRAY['Universal'], 67.99)
ON CONFLICT (part_number, brand) DO NOTHING;

COMMIT;