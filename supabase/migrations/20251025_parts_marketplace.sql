-- =====================================================
-- PARTS MARKETPLACE SYSTEM
-- Transforms image tags into shoppable parts
-- =====================================================

-- 1. ENHANCE image_tags with part marketplace data
ALTER TABLE image_tags ADD COLUMN IF NOT EXISTS
  -- Part Identification
  oem_part_number TEXT,
  aftermarket_part_numbers TEXT[],
  part_description TEXT,
  fits_vehicles TEXT[],
  
  -- Supplier/Pricing  
  suppliers JSONB DEFAULT '[]'::jsonb,
  lowest_price_cents INTEGER,
  highest_price_cents INTEGER,
  price_last_updated TIMESTAMPTZ,
  
  -- Purchase Integration
  is_shoppable BOOLEAN DEFAULT false,
  affiliate_links JSONB DEFAULT '[]'::jsonb,
  
  -- Part Metadata
  condition TEXT CHECK (condition IN ('new', 'used', 'remanufactured', 'unknown')),
  warranty_info TEXT,
  install_difficulty TEXT CHECK (install_difficulty IN ('easy', 'moderate', 'hard', 'expert')),
  estimated_install_time_minutes INTEGER;

-- 2. CREATE part_suppliers table
CREATE TABLE IF NOT EXISTS part_suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name TEXT NOT NULL UNIQUE,
  supplier_url TEXT,
  supplier_logo_url TEXT,
  api_available BOOLEAN DEFAULT false,
  api_key_encrypted TEXT,
  scrape_config JSONB,
  commission_rate DECIMAL(5,2),
  shipping_methods JSONB,
  return_policy TEXT,
  trust_score INTEGER DEFAULT 100,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. CREATE part_catalog table  
CREATE TABLE IF NOT EXISTS part_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_name TEXT NOT NULL,
  oem_part_number TEXT,
  category TEXT,
  subcategory TEXT,
  fits_makes TEXT[],
  fits_models TEXT[],
  fits_years INT4RANGE,
  description TEXT,
  install_notes TEXT,
  part_image_urls TEXT[],
  supplier_listings JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(oem_part_number)
);

-- 4. CREATE part_purchases table
CREATE TABLE IF NOT EXISTS part_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  vehicle_id UUID REFERENCES vehicles(id),
  image_tag_id UUID REFERENCES image_tags(id),
  part_catalog_id UUID REFERENCES part_catalog(id),
  supplier_id UUID REFERENCES part_suppliers(id),
  
  -- Purchase Details
  part_name TEXT NOT NULL,
  part_number TEXT,
  quantity INTEGER DEFAULT 1,
  unit_price_cents INTEGER NOT NULL,
  shipping_cents INTEGER DEFAULT 0,
  tax_cents INTEGER DEFAULT 0,
  total_cents INTEGER NOT NULL,
  
  -- Payment
  payment_method TEXT,
  payment_intent_id TEXT,
  payment_status TEXT CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded', 'cancelled')),
  
  -- Fulfillment
  order_number TEXT,
  tracking_number TEXT,
  ordered_at TIMESTAMPTZ DEFAULT NOW(),
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  
  -- Metadata
  notes TEXT,
  metadata JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. CREATE part_price_history table (track price changes)
CREATE TABLE IF NOT EXISTS part_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_catalog_id UUID REFERENCES part_catalog(id),
  supplier_id UUID REFERENCES part_suppliers(id),
  price_cents INTEGER NOT NULL,
  in_stock BOOLEAN DEFAULT true,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. RLS POLICIES

-- part_suppliers: Public read, admin write
ALTER TABLE part_suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view suppliers"
  ON part_suppliers FOR SELECT
  USING (true);

CREATE POLICY "Only admins can modify suppliers"
  ON part_suppliers FOR ALL
  USING (auth.jwt() ->> 'email' IN ('skylar@n-zero.dev')); -- Update with admin emails

-- part_catalog: Public read, authenticated contribute, admin approve
ALTER TABLE part_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view parts catalog"
  ON part_catalog FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can suggest parts"
  ON part_catalog FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can modify parts catalog"
  ON part_catalog FOR UPDATE
  USING (auth.jwt() ->> 'email' IN ('skylar@n-zero.dev'));

-- part_purchases: Users can view own purchases
ALTER TABLE part_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own purchases"
  ON part_purchases FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create purchases"
  ON part_purchases FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own pending purchases"
  ON part_purchases FOR UPDATE
  USING (auth.uid() = user_id AND payment_status = 'pending');

-- part_price_history: Public read for transparency
ALTER TABLE part_price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view price history"
  ON part_price_history FOR SELECT
  USING (true);

-- 7. SEED initial suppliers
INSERT INTO part_suppliers (supplier_name, supplier_url, commission_rate, active) VALUES
  ('LMC Truck', 'https://www.lmctruck.com', 5.00, true),
  ('RockAuto', 'https://www.rockauto.com', 3.50, true),
  ('Classic Parts', 'https://www.classicparts.com', 4.00, true),
  ('Summit Racing', 'https://www.summitracing.com', 4.50, true),
  ('Amazon', 'https://www.amazon.com', 2.00, true)
ON CONFLICT (supplier_name) DO NOTHING;

-- 8. CREATE indexes for performance
CREATE INDEX IF NOT EXISTS idx_part_catalog_oem ON part_catalog(oem_part_number);
CREATE INDEX IF NOT EXISTS idx_part_catalog_category ON part_catalog(category, subcategory);
CREATE INDEX IF NOT EXISTS idx_part_purchases_user ON part_purchases(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_part_purchases_vehicle ON part_purchases(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_image_tags_shoppable ON image_tags(is_shoppable) WHERE is_shoppable = true;
CREATE INDEX IF NOT EXISTS idx_image_tags_part_number ON image_tags(oem_part_number) WHERE oem_part_number IS NOT NULL;

-- 9. CREATE function to update price statistics
CREATE OR REPLACE FUNCTION update_part_price_stats()
RETURNS TRIGGER AS $$
BEGIN
  -- Update part_catalog with latest price range
  UPDATE part_catalog
  SET
    supplier_listings = (
      SELECT jsonb_agg(listing)
      FROM jsonb_array_elements(supplier_listings) AS listing
      WHERE (listing->>'supplier')::text = NEW.supplier_id::text
        OR listing IS NULL
    ),
    updated_at = NOW()
  WHERE id = NEW.part_catalog_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_price_stats_trigger
  AFTER INSERT ON part_price_history
  FOR EACH ROW
  EXECUTE FUNCTION update_part_price_stats();

-- 10. CREATE view for shoppable tags with full supplier info
CREATE OR REPLACE VIEW shoppable_tags_with_suppliers AS
SELECT 
  it.*,
  pc.part_name AS catalog_part_name,
  pc.description AS catalog_description,
  pc.install_notes,
  pc.supplier_listings,
  ps.supplier_name,
  ps.supplier_url,
  ps.commission_rate
FROM image_tags it
LEFT JOIN part_catalog pc ON it.oem_part_number = pc.oem_part_number
LEFT JOIN part_suppliers ps ON ps.id = ANY(
  SELECT DISTINCT (listing->>'supplier_id')::UUID 
  FROM jsonb_array_elements(pc.supplier_listings) AS listing
)
WHERE it.is_shoppable = true;

COMMENT ON VIEW shoppable_tags_with_suppliers IS 'Image tags enriched with full supplier and pricing data for marketplace display';

