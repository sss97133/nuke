-- Professional Tool Management System Tables
-- Creates tables for tracking professional tools, brands, and catalogs

-- Tool Brands (Snap-on, Mac Tools, Matco, etc.)
CREATE TABLE IF NOT EXISTS tool_brands (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  website TEXT,
  logo_url TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tool Catalog (Product database)
CREATE TABLE IF NOT EXISTS tool_catalog (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id UUID REFERENCES tool_brands(id),
  part_number TEXT NOT NULL,
  description TEXT,
  category TEXT,
  list_price DECIMAL(10,2),
  product_url TEXT,
  image_url TEXT,
  specifications JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(brand_id, part_number)
);

-- User's Tools (Actual owned tools)
CREATE TABLE IF NOT EXISTS user_tools (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  catalog_id UUID REFERENCES tool_catalog(id),
  part_number TEXT NOT NULL,
  description TEXT,
  brand_name TEXT,
  transaction_number TEXT,
  transaction_date DATE,
  purchase_price DECIMAL(10,2),
  serial_number TEXT,
  condition TEXT DEFAULT 'new',
  verified_by_operator BOOLEAN DEFAULT false,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tool_catalog_brand ON tool_catalog(brand_id);
CREATE INDEX IF NOT EXISTS idx_tool_catalog_part_number ON tool_catalog(part_number);
CREATE INDEX IF NOT EXISTS idx_user_tools_user ON user_tools(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tools_catalog ON user_tools(catalog_id);

-- Enable RLS
ALTER TABLE tool_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tools ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Tool Brands: Public read, admin write
CREATE POLICY "Anyone can view tool brands"
  ON tool_brands FOR SELECT
  USING (true);

-- Tool Catalog: Public read, admin write  
CREATE POLICY "Anyone can view tool catalog"
  ON tool_catalog FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert tool catalog"
  ON tool_catalog FOR INSERT
  WITH CHECK (true);

-- User Tools: Users can manage their own tools
CREATE POLICY "Users can view their own tools"
  ON user_tools FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own tools"
  ON user_tools FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tools"
  ON user_tools FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tools"
  ON user_tools FOR DELETE
  USING (auth.uid() = user_id);

-- Insert default tool brands
INSERT INTO tool_brands (name, website) VALUES
  ('Snap-on', 'https://www.snapon.com'),
  ('Mac Tools', 'https://www.mactools.com'),
  ('Matco', 'https://www.matcotools.com'),
  ('Cornwell', 'https://www.cornwelltools.com')
ON CONFLICT (name) DO NOTHING;
