-- Professional Tools Inventory System
-- Supports franchise operators, tool tracking, and sales validation

-- Tool brands table (Snap-on, Mac Tools, Matco, etc.)
CREATE TABLE IF NOT EXISTS tool_brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  website TEXT,
  logo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert common tool brands
INSERT INTO tool_brands (name, website) VALUES 
  ('Snap-on', 'https://shop.snapon.com'),
  ('Mac Tools', 'https://www.mactools.com'),
  ('Matco Tools', 'https://www.matcotools.com'),
  ('Cornwell Tools', 'https://www.cornwelltools.com')
ON CONFLICT (name) DO NOTHING;

-- Franchise operators (tool truck dealers)
CREATE TABLE IF NOT EXISTS franchise_operators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  brand_id UUID REFERENCES tool_brands(id),
  business_name TEXT,
  operator_name TEXT,
  phone TEXT,
  address TEXT,
  territory TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tool catalog (master list of all tools)
CREATE TABLE IF NOT EXISTS tool_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID REFERENCES tool_brands(id),
  part_number TEXT NOT NULL,
  description TEXT,
  category TEXT, -- socket, wrench, power tool, etc.
  subcategory TEXT,
  list_price DECIMAL(10,2),
  product_url TEXT,
  brochure_image_url TEXT,
  specifications JSONB,
  discontinued BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(brand_id, part_number)
);

ALTER TABLE tool_catalog
  ADD COLUMN IF NOT EXISTS subcategory TEXT,
  ADD COLUMN IF NOT EXISTS brochure_image_url TEXT,
  ADD COLUMN IF NOT EXISTS discontinued BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- User's tool inventory
CREATE TABLE IF NOT EXISTS user_tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  catalog_id UUID REFERENCES tool_catalog(id),
  transaction_number TEXT, -- from receipt
  transaction_date DATE,
  purchase_price DECIMAL(10,2),
  discount_amount DECIMAL(10,2),
  serial_number TEXT,
  condition TEXT DEFAULT 'new', -- new, used, damaged, lost
  location TEXT, -- which toolbox/truck
  notes TEXT,
  franchise_operator_id UUID REFERENCES franchise_operators(id),
  verified_by_operator BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_tools
  ADD COLUMN IF NOT EXISTS transaction_number TEXT,
  ADD COLUMN IF NOT EXISTS transaction_date DATE,
  ADD COLUMN IF NOT EXISTS purchase_price DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS serial_number TEXT,
  ADD COLUMN IF NOT EXISTS condition TEXT DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS franchise_operator_id UUID REFERENCES franchise_operators(id),
  ADD COLUMN IF NOT EXISTS verified_by_operator BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS catalog_id UUID REFERENCES tool_catalog(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Tool images (user photos of their actual tools)
CREATE TABLE IF NOT EXISTS tool_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_tool_id UUID REFERENCES user_tools(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  image_type TEXT DEFAULT 'photo', -- photo, receipt, warranty
  caption TEXT,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transaction receipts for bulk import
CREATE TABLE IF NOT EXISTS tool_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  franchise_operator_id UUID REFERENCES franchise_operators(id),
  receipt_date DATE,
  receipt_number TEXT,
  total_amount DECIMAL(10,2),
  pdf_url TEXT,
  raw_data TEXT, -- store the raw PDF text
  processed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transaction line items (parsed from receipts)
CREATE TABLE IF NOT EXISTS receipt_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID REFERENCES tool_receipts(id) ON DELETE CASCADE,
  transaction_date DATE,
  transaction_number TEXT,
  transaction_type TEXT, -- Sale, RA, Return, Warranty
  part_number TEXT,
  description TEXT,
  quantity INTEGER,
  list_price DECIMAL(10,2),
  discount DECIMAL(10,2),
  total_amount DECIMAL(10,2),
  payment_type TEXT,
  serial_number TEXT,
  matched_to_catalog BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE receipt_line_items
  ADD COLUMN IF NOT EXISTS transaction_number TEXT,
  ADD COLUMN IF NOT EXISTS transaction_date DATE;

-- Tool warranties and service records
CREATE TABLE IF NOT EXISTS tool_warranties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_tool_id UUID REFERENCES user_tools(id) ON DELETE CASCADE,
  warranty_type TEXT, -- lifetime, limited, extended
  start_date DATE,
  end_date DATE,
  service_records JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tool_catalog_part_number ON tool_catalog(part_number);
CREATE INDEX IF NOT EXISTS idx_tool_catalog_brand_part ON tool_catalog(brand_id, part_number);
CREATE INDEX IF NOT EXISTS idx_user_tools_user_id ON user_tools(user_id);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_tools' AND column_name = 'transaction_number'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_user_tools_transaction ON user_tools(transaction_number);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_receipt_line_items_part_number ON receipt_line_items(part_number);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'receipt_line_items' AND column_name = 'transaction_number'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_receipt_line_items_transaction ON receipt_line_items(transaction_number);
  END IF;
END;
$$;

-- RLS Policies
ALTER TABLE franchise_operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_warranties ENABLE ROW LEVEL SECURITY;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tool_inventory_public BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS total_tool_value DECIMAL(12,2) DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tool_count INTEGER DEFAULT 0;

DROP POLICY IF EXISTS "Tool catalog is publicly readable" ON tool_catalog;
CREATE POLICY "Tool catalog is publicly readable" ON tool_catalog
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Only admins can modify tool catalog" ON tool_catalog;
CREATE POLICY "Only admins can modify tool catalog" ON tool_catalog
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.user_id = auth.uid()
        AND au.is_active = true
        AND (
          au.admin_level IN ('admin', 'super_admin')
          OR 'approve_ownership' = ANY(au.permissions)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users au
      WHERE au.user_id = auth.uid()
        AND au.is_active = true
        AND (
          au.admin_level IN ('admin', 'super_admin')
          OR 'approve_ownership' = ANY(au.permissions)
        )
    )
  );

DROP POLICY IF EXISTS "Users can manage their own tools" ON user_tools;
CREATE POLICY "Users can manage their own tools" ON user_tools
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Public tools are viewable" ON user_tools;
CREATE POLICY "Public tools are viewable" ON user_tools
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = user_id 
      AND tool_inventory_public = true
    )
  );

DROP POLICY IF EXISTS "Users manage own receipts" ON tool_receipts;
CREATE POLICY "Users manage own receipts" ON tool_receipts
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own tool images" ON tool_images;
CREATE POLICY "Users manage own tool images" ON tool_images
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_tools 
      WHERE user_tools.id = tool_images.user_tool_id 
      AND user_tools.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_tools 
      WHERE user_tools.id = tool_images.user_tool_id 
      AND user_tools.user_id = auth.uid()
    )
  );

-- Add tool inventory visibility to profiles

DROP FUNCTION IF EXISTS calculate_tool_inventory_value(UUID);

CREATE OR REPLACE FUNCTION calculate_tool_inventory_value(p_user_id UUID)
RETURNS TABLE(total_value DECIMAL, tool_count INTEGER, brand_breakdown JSONB) 
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(SUM(ut.purchase_price), 0)::DECIMAL as total_value,
    COUNT(ut.id)::INTEGER as tool_count,
    jsonb_object_agg(
      tb.name, 
      jsonb_build_object(
        'count', COUNT(ut.id),
        'value', COALESCE(SUM(ut.purchase_price), 0)
      )
    ) as brand_breakdown
  FROM user_tools ut
  LEFT JOIN tool_catalog tc ON ut.catalog_id = tc.id
  LEFT JOIN tool_brands tb ON tc.brand_id = tb.id
  WHERE ut.user_id = p_user_id
  AND ut.condition != 'lost'
  GROUP BY ut.user_id;
END;
$$;

DROP TRIGGER IF EXISTS update_tool_stats_trigger ON user_tools;

DROP FUNCTION IF EXISTS update_tool_inventory_stats();

CREATE OR REPLACE FUNCTION update_tool_inventory_stats()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE profiles
  SET 
    total_tool_value = (
      SELECT COALESCE(SUM(purchase_price), 0) 
      FROM user_tools 
      WHERE user_id = NEW.user_id 
      AND condition != 'lost'
    ),
    tool_count = (
      SELECT COUNT(*) 
      FROM user_tools 
      WHERE user_id = NEW.user_id 
      AND condition != 'lost'
    ),
    updated_at = NOW()
  WHERE id = NEW.user_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_tool_stats_trigger
AFTER INSERT OR UPDATE OR DELETE ON user_tools
FOR EACH ROW
EXECUTE FUNCTION update_tool_inventory_stats();
