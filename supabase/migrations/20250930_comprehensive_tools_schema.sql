-- Comprehensive Professional Tools Database Schema
-- Designed to capture all transaction data from receipts plus extensive product information

-- Drop existing simplified tables to rebuild properly
DROP TABLE IF EXISTS tool_verification CASCADE;
DROP TABLE IF EXISTS user_tool_skills CASCADE;
DROP TABLE IF EXISTS tool_supplier_accounts CASCADE;
DROP TABLE IF EXISTS user_tools CASCADE;
DROP TABLE IF EXISTS tool_categories CASCADE;
DROP TABLE IF EXISTS tool_suppliers CASCADE;

-- =====================================================
-- CORE REFERENCE TABLES
-- =====================================================

-- Tool brands/manufacturers
CREATE TABLE tool_brands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    logo_url TEXT,
    website TEXT,
    support_phone TEXT,
    support_email TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tool categories with hierarchy
CREATE TABLE tool_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    parent_category_id UUID REFERENCES tool_categories(id),
    description TEXT,
    icon TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Franchisors (Snap-on, Mac Tools, etc.)
CREATE TABLE tool_franchisors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    brand_id UUID REFERENCES tool_brands(id),
    corporate_website TEXT,
    dealer_portal_url TEXT,
    api_endpoint TEXT,
    integration_available BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Franchise operators (individual tool truck owners)
CREATE TABLE franchise_operators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    franchisor_id UUID REFERENCES tool_franchisors(id),
    operator_name TEXT NOT NULL,
    business_name TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    route_days TEXT, -- JSON array of days/locations
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- PRODUCT CATALOG (Master product database)
-- =====================================================

CREATE TABLE tool_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Product identification
    brand_id UUID REFERENCES tool_brands(id),
    part_number TEXT NOT NULL,
    model_number TEXT,
    upc_code TEXT,
    sku TEXT,
    
    -- Product details
    name TEXT NOT NULL,
    description TEXT,
    long_description TEXT,
    category_id UUID REFERENCES tool_categories(id),
    
    -- Specifications (flexible JSONB for any specs)
    specifications JSONB, -- torque specs, dimensions, weight, materials, etc.
    
    -- Pricing
    msrp DECIMAL(10, 2),
    map_price DECIMAL(10, 2), -- Minimum advertised price
    dealer_cost DECIMAL(10, 2),
    
    -- Product URLs and media
    product_url TEXT,
    manual_url TEXT,
    spec_sheet_url TEXT,
    video_url TEXT,
    
    -- Product status
    is_active BOOLEAN DEFAULT TRUE,
    is_discontinued BOOLEAN DEFAULT FALSE,
    replacement_part_number TEXT,
    
    -- Metadata
    release_date DATE,
    discontinue_date DATE,
    country_of_origin TEXT,
    warranty_months INTEGER,
    
    -- Flexible additional data
    metadata JSONB,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(brand_id, part_number)
);

-- Product images (multiple per product)
CREATE TABLE tool_catalog_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    catalog_id UUID REFERENCES tool_catalog(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    image_type TEXT CHECK (image_type IN ('primary', 'gallery', 'lifestyle', 'dimension', 'packaging')),
    caption TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- TRANSACTIONS (Purchase history from receipts)
-- =====================================================

CREATE TABLE tool_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Transaction identification
    transaction_number TEXT NOT NULL,
    transaction_date DATE NOT NULL,
    transaction_type TEXT CHECK (transaction_type IN ('Sale', 'RA', 'EC', 'Warranty', 'Return', 'Exchange')),
    
    -- Parties involved
    user_id UUID REFERENCES profiles(id),
    franchise_operator_id UUID REFERENCES franchise_operators(id),
    
    -- Financial totals
    subtotal DECIMAL(10, 2),
    discount_total DECIMAL(10, 2),
    tax_amount DECIMAL(10, 2),
    total_amount DECIMAL(10, 2),
    
    -- Payment info
    payment_type TEXT,
    payment_amount DECIMAL(10, 2),
    payment_reference TEXT,
    
    -- Receipt data
    receipt_url TEXT, -- Scanned receipt storage
    receipt_text TEXT, -- OCR extracted text
    raw_data JSONB, -- Complete parsed receipt data
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(franchise_operator_id, transaction_number)
);

-- Transaction line items (individual products in transaction)
CREATE TABLE tool_transaction_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID REFERENCES tool_transactions(id) ON DELETE CASCADE,
    
    -- Product reference
    catalog_id UUID REFERENCES tool_catalog(id),
    part_number TEXT NOT NULL, -- Store even if not in catalog
    description TEXT,
    
    -- Line item details
    quantity INTEGER DEFAULT 1,
    list_price DECIMAL(10, 2),
    discount_amount DECIMAL(10, 2),
    line_total DECIMAL(10, 2),
    
    -- Serial number if applicable
    serial_number TEXT,
    
    -- Line type from receipt
    line_type TEXT,
    
    -- Raw line data
    raw_data JSONB,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- USER TOOL INVENTORY (What users actually own)
-- =====================================================

CREATE TABLE user_tools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Link to catalog and transaction
    catalog_id UUID REFERENCES tool_catalog(id),
    transaction_item_id UUID REFERENCES tool_transaction_items(id),
    
    -- Tool identification (for manual entries or unmatched items)
    brand_name TEXT,
    part_number TEXT,
    serial_number TEXT,
    
    -- Tool details
    name TEXT NOT NULL,
    description TEXT,
    category_id UUID REFERENCES tool_categories(id),
    
    -- Purchase information
    purchase_date DATE,
    purchase_price DECIMAL(10, 2),
    purchase_location TEXT,
    franchise_operator_id UUID REFERENCES franchise_operators(id),
    
    -- Current status
    condition TEXT CHECK (condition IN ('new', 'excellent', 'good', 'fair', 'poor', 'broken')),
    current_value DECIMAL(10, 2),
    location TEXT, -- Where it's stored (garage, truck, etc.)
    
    -- Usage tracking
    last_used_date DATE,
    usage_count INTEGER DEFAULT 0,
    is_loaned_out BOOLEAN DEFAULT FALSE,
    loaned_to TEXT,
    loan_date DATE,
    
    -- Verification
    is_verified BOOLEAN DEFAULT FALSE,
    verification_source TEXT,
    verification_date TIMESTAMPTZ,
    verified_by UUID REFERENCES profiles(id),
    
    -- Notes and metadata
    notes TEXT,
    custom_fields JSONB, -- User-defined fields
    metadata JSONB, -- System metadata
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User tool images (photos of actual tools)
CREATE TABLE user_tool_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_tool_id UUID REFERENCES user_tools(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    thumbnail_url TEXT,
    
    image_type TEXT CHECK (image_type IN ('overview', 'serial_number', 'condition', 'damage', 'receipt', 'warranty_card')),
    caption TEXT,
    
    -- EXIF data if available
    taken_at TIMESTAMPTZ,
    camera_make TEXT,
    camera_model TEXT,
    gps_latitude DECIMAL(10, 8),
    gps_longitude DECIMAL(11, 8),
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- WARRANTIES AND SERVICE
-- =====================================================

CREATE TABLE tool_warranties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_tool_id UUID REFERENCES user_tools(id) ON DELETE CASCADE,
    
    warranty_type TEXT CHECK (warranty_type IN ('manufacturer', 'extended', 'lifetime')),
    start_date DATE,
    end_date DATE,
    is_lifetime BOOLEAN DEFAULT FALSE,
    
    registration_number TEXT,
    registration_date DATE,
    is_registered BOOLEAN DEFAULT FALSE,
    
    coverage_details TEXT,
    exclusions TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE tool_service_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_tool_id UUID REFERENCES user_tools(id) ON DELETE CASCADE,
    
    service_date DATE NOT NULL,
    service_type TEXT CHECK (service_type IN ('repair', 'calibration', 'maintenance', 'warranty_repair')),
    
    description TEXT,
    performed_by TEXT,
    cost DECIMAL(10, 2),
    
    warranty_claim_id UUID REFERENCES tool_warranties(id),
    
    invoice_number TEXT,
    invoice_url TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- PRICING HISTORY AND MARKET DATA
-- =====================================================

CREATE TABLE tool_price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    catalog_id UUID REFERENCES tool_catalog(id) ON DELETE CASCADE,
    
    price_date DATE NOT NULL,
    msrp DECIMAL(10, 2),
    street_price DECIMAL(10, 2),
    promo_price DECIMAL(10, 2),
    
    source TEXT, -- Where price was observed
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- PROFESSIONAL NETWORKING
-- =====================================================

CREATE TABLE tool_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_tool_id UUID REFERENCES user_tools(id) ON DELETE CASCADE,
    verifier_id UUID REFERENCES profiles(id),
    
    verification_type TEXT CHECK (verification_type IN ('ownership', 'condition', 'authenticity', 'value')),
    verification_status TEXT CHECK (verification_status IN ('verified', 'disputed', 'cannot_verify')),
    
    notes TEXT,
    evidence_urls TEXT[], -- Photos or documents
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_tool_id, verifier_id, verification_type)
);

CREATE TABLE tool_loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_tool_id UUID REFERENCES user_tools(id),
    
    lender_id UUID REFERENCES profiles(id),
    borrower_id UUID REFERENCES profiles(id),
    
    loan_date DATE NOT NULL,
    expected_return_date DATE,
    actual_return_date DATE,
    
    condition_out TEXT,
    condition_in TEXT,
    
    deposit_amount DECIMAL(10, 2),
    deposit_returned BOOLEAN DEFAULT FALSE,
    
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- SUPPLIER INTEGRATIONS
-- =====================================================

CREATE TABLE supplier_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    franchisor_id UUID REFERENCES tool_franchisors(id),
    
    account_number TEXT,
    account_email TEXT,
    
    is_connected BOOLEAN DEFAULT FALSE,
    connection_status TEXT,
    
    -- OAuth tokens (encrypted)
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMPTZ,
    
    -- Sync status
    last_sync_at TIMESTAMPTZ,
    sync_status TEXT,
    items_synced INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, franchisor_id)
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX idx_tool_catalog_part_number ON tool_catalog(part_number);
CREATE INDEX idx_tool_catalog_brand ON tool_catalog(brand_id);
CREATE INDEX idx_tool_transactions_user ON tool_transactions(user_id);
CREATE INDEX idx_tool_transactions_date ON tool_transactions(transaction_date);
CREATE INDEX idx_user_tools_user ON user_tools(user_id);
CREATE INDEX idx_user_tools_catalog ON user_tools(catalog_id);
CREATE INDEX idx_user_tools_serial ON user_tools(serial_number) WHERE serial_number IS NOT NULL;

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE user_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tool_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_warranties ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_service_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_connections ENABLE ROW LEVEL SECURITY;

-- Users can manage their own tools
CREATE POLICY "Users manage own tools" ON user_tools
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Public view verified tools" ON user_tools
    FOR SELECT USING (is_verified = true);

-- Users manage their tool images
CREATE POLICY "Users manage own tool images" ON user_tool_images
    FOR ALL USING (EXISTS (
        SELECT 1 FROM user_tools 
        WHERE user_tools.id = user_tool_images.user_tool_id 
        AND user_tools.user_id = auth.uid()
    ));

-- Users manage their transactions
CREATE POLICY "Users manage own transactions" ON tool_transactions
    FOR ALL USING (auth.uid() = user_id);

-- Users manage their warranties
CREATE POLICY "Users manage own warranties" ON tool_warranties
    FOR ALL USING (EXISTS (
        SELECT 1 FROM user_tools 
        WHERE user_tools.id = tool_warranties.user_tool_id 
        AND user_tools.user_id = auth.uid()
    ));

-- =====================================================
-- SEED DATA
-- =====================================================

-- Insert tool brands
INSERT INTO tool_brands (name, website) VALUES
    ('Snap-on', 'https://www.snapon.com'),
    ('Mac Tools', 'https://www.mactools.com'),
    ('Matco Tools', 'https://www.matcotools.com'),
    ('Cornwell Tools', 'https://www.cornwelltools.com'),
    ('Milwaukee Tool', 'https://www.milwaukeetool.com'),
    ('DeWalt', 'https://www.dewalt.com'),
    ('Klein Tools', 'https://www.kleintools.com'),
    ('Fluke', 'https://www.fluke.com'),
    ('Blue Point', 'https://www.bluepoint.com'),
    ('SK Tools', 'https://www.sktools.com')
ON CONFLICT (name) DO NOTHING;

-- Insert franchisors
INSERT INTO tool_franchisors (name, brand_id, corporate_website, integration_available)
SELECT 'Snap-on Tools', id, 'https://www.snapon.com/franchising', true
FROM tool_brands WHERE name = 'Snap-on';

INSERT INTO tool_franchisors (name, brand_id, corporate_website, integration_available)
SELECT 'Mac Tools', id, 'https://www.mactools.com/franchise', true
FROM tool_brands WHERE name = 'Mac Tools';

-- Insert tool categories
INSERT INTO tool_categories (name, description, sort_order) VALUES
    ('Hand Tools', 'Wrenches, sockets, ratchets, pliers', 1),
    ('Power Tools', 'Electric and battery-powered tools', 2),
    ('Air Tools', 'Pneumatic tools and accessories', 3),
    ('Diagnostic Equipment', 'Scanners, meters, and test equipment', 4),
    ('Tool Storage', 'Tool boxes, carts, and organization', 5),
    ('Shop Equipment', 'Lifts, jacks, and shop machinery', 6),
    ('Specialty Tools', 'Make/model specific tools', 7),
    ('Safety Equipment', 'PPE and safety gear', 8),
    ('Consumables', 'Bits, blades, and wear items', 9)
ON CONFLICT DO NOTHING;

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Function to calculate total tool investment
CREATE OR REPLACE FUNCTION calculate_tool_investment(p_user_id UUID)
RETURNS TABLE(
    total_invested DECIMAL,
    total_current_value DECIMAL,
    tool_count INTEGER,
    verified_count INTEGER,
    brands_owned INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(SUM(purchase_price), 0) as total_invested,
        COALESCE(SUM(current_value), 0) as total_current_value,
        COUNT(*)::INTEGER as tool_count,
        COUNT(*) FILTER (WHERE is_verified = true)::INTEGER as verified_count,
        COUNT(DISTINCT COALESCE(catalog.brand_id, NULL))::INTEGER as brands_owned
    FROM user_tools ut
    LEFT JOIN tool_catalog catalog ON ut.catalog_id = catalog.id
    WHERE ut.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- Function to import transaction from parsed receipt
CREATE OR REPLACE FUNCTION import_tool_transaction(
    p_user_id UUID,
    p_transaction_data JSONB
) RETURNS UUID AS $$
DECLARE
    v_transaction_id UUID;
BEGIN
    -- Insert transaction header
    INSERT INTO tool_transactions (
        user_id,
        transaction_number,
        transaction_date,
        transaction_type,
        total_amount,
        raw_data
    ) VALUES (
        p_user_id,
        p_transaction_data->>'transaction_number',
        (p_transaction_data->>'transaction_date')::DATE,
        p_transaction_data->>'transaction_type',
        (p_transaction_data->>'total_amount')::DECIMAL,
        p_transaction_data
    ) RETURNING id INTO v_transaction_id;
    
    -- Process line items
    -- This would be expanded to handle the items array
    
    RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql;

GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
