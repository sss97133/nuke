-- =====================================================
-- PARTS MARKETPLACE SYSTEM
-- Run this in Supabase SQL Editor
-- =====================================================

-- 1. ENHANCE image_tags with part marketplace data (one column at a time)
ALTER TABLE image_tags ADD COLUMN IF NOT EXISTS oem_part_number TEXT;
ALTER TABLE image_tags ADD COLUMN IF NOT EXISTS aftermarket_part_numbers TEXT[];
ALTER TABLE image_tags ADD COLUMN IF NOT EXISTS part_description TEXT;
ALTER TABLE image_tags ADD COLUMN IF NOT EXISTS fits_vehicles TEXT[];
ALTER TABLE image_tags ADD COLUMN IF NOT EXISTS suppliers JSONB DEFAULT '[]'::jsonb;
ALTER TABLE image_tags ADD COLUMN IF NOT EXISTS lowest_price_cents INTEGER;
ALTER TABLE image_tags ADD COLUMN IF NOT EXISTS highest_price_cents INTEGER;
ALTER TABLE image_tags ADD COLUMN IF NOT EXISTS price_last_updated TIMESTAMPTZ;
ALTER TABLE image_tags ADD COLUMN IF NOT EXISTS is_shoppable BOOLEAN DEFAULT false;
ALTER TABLE image_tags ADD COLUMN IF NOT EXISTS affiliate_links JSONB DEFAULT '[]'::jsonb;
ALTER TABLE image_tags ADD COLUMN IF NOT EXISTS condition TEXT;
ALTER TABLE image_tags ADD COLUMN IF NOT EXISTS warranty_info TEXT;
ALTER TABLE image_tags ADD COLUMN IF NOT EXISTS install_difficulty TEXT;
ALTER TABLE image_tags ADD COLUMN IF NOT EXISTS estimated_install_time_minutes INTEGER;

-- Add constraints
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'image_tags_condition_check'
  ) THEN
    ALTER TABLE image_tags 
    ADD CONSTRAINT image_tags_condition_check 
    CHECK (condition IN ('new', 'used', 'remanufactured', 'unknown') OR condition IS NULL);
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'image_tags_install_difficulty_check'
  ) THEN
    ALTER TABLE image_tags 
    ADD CONSTRAINT image_tags_install_difficulty_check 
    CHECK (install_difficulty IN ('easy', 'moderate', 'hard', 'expert') OR install_difficulty IS NULL);
  END IF;
END $$;

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
  oem_part_number TEXT UNIQUE,
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
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. CREATE part_purchases table
CREATE TABLE IF NOT EXISTS part_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  vehicle_id UUID REFERENCES vehicles(id),
  image_tag_id UUID REFERENCES image_tags(id),
  part_catalog_id UUID REFERENCES part_catalog(id),
  supplier_id UUID REFERENCES part_suppliers(id),
  part_name TEXT NOT NULL,
  part_number TEXT,
  quantity INTEGER DEFAULT 1,
  unit_price_cents INTEGER NOT NULL,
  shipping_cents INTEGER DEFAULT 0,
  tax_cents INTEGER DEFAULT 0,
  total_cents INTEGER NOT NULL,
  payment_method TEXT,
  payment_intent_id TEXT,
  payment_status TEXT CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded', 'cancelled')),
  order_number TEXT,
  tracking_number TEXT,
  ordered_at TIMESTAMPTZ DEFAULT NOW(),
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  notes TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. CREATE part_price_history table
CREATE TABLE IF NOT EXISTS part_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_catalog_id UUID REFERENCES part_catalog(id),
  supplier_id UUID REFERENCES part_suppliers(id),
  price_cents INTEGER NOT NULL,
  in_stock BOOLEAN DEFAULT true,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. RLS POLICIES
ALTER TABLE part_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_price_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view suppliers" ON part_suppliers;
CREATE POLICY "Anyone can view suppliers" ON part_suppliers FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can view parts catalog" ON part_catalog;
CREATE POLICY "Anyone can view parts catalog" ON part_catalog FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can suggest parts" ON part_catalog;
CREATE POLICY "Authenticated users can suggest parts" ON part_catalog FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view own purchases" ON part_purchases;
CREATE POLICY "Users can view own purchases" ON part_purchases FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create purchases" ON part_purchases;
CREATE POLICY "Users can create purchases" ON part_purchases FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Anyone can view price history" ON part_price_history;
CREATE POLICY "Anyone can view price history" ON part_price_history FOR SELECT USING (true);

-- 7. SEED initial suppliers
INSERT INTO part_suppliers (supplier_name, supplier_url, commission_rate, active) VALUES
  ('LMC Truck', 'https://www.lmctruck.com', 5.00, true),
  ('RockAuto', 'https://www.rockauto.com', 3.50, true),
  ('Classic Parts', 'https://www.classicparts.com', 4.00, true),
  ('Summit Racing', 'https://www.summitracing.com', 4.50, true),
  ('Amazon', 'https://www.amazon.com', 2.00, true)
ON CONFLICT (supplier_name) DO NOTHING;

-- 8. CREATE indexes
CREATE INDEX IF NOT EXISTS idx_part_catalog_oem ON part_catalog(oem_part_number);
CREATE INDEX IF NOT EXISTS idx_part_catalog_category ON part_catalog(category, subcategory);
CREATE INDEX IF NOT EXISTS idx_part_purchases_user ON part_purchases(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_part_purchases_vehicle ON part_purchases(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_image_tags_shoppable ON image_tags(is_shoppable) WHERE is_shoppable = true;
CREATE INDEX IF NOT EXISTS idx_image_tags_part_number ON image_tags(oem_part_number) WHERE oem_part_number IS NOT NULL;
