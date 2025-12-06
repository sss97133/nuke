-- INVOICE LEARNING SYSTEM
-- Enables reverse-engineering parts knowledge from real invoices/receipts

-- 1. Add source tracking to catalog_parts
ALTER TABLE catalog_parts
  ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'catalog',
  ADD COLUMN IF NOT EXISTS brand TEXT,
  ADD COLUMN IF NOT EXISTS supplier_name TEXT;

-- Update existing parts to have source_type
UPDATE catalog_parts SET source_type = 'catalog' WHERE source_type IS NULL;

-- Add index for source_type lookups
CREATE INDEX IF NOT EXISTS idx_catalog_parts_source_type ON catalog_parts(source_type);
CREATE INDEX IF NOT EXISTS idx_catalog_parts_brand ON catalog_parts(brand);

-- 2. Track pricing learned from invoices
CREATE TABLE IF NOT EXISTS invoice_learned_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Part identification
  part_number TEXT NOT NULL,
  brand TEXT,
  part_name TEXT,
  
  -- Pricing data
  price DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  quantity INTEGER DEFAULT 1,
  unit_price DECIMAL(10,2),
  
  -- Source invoice
  source_invoice_id UUID, -- References documents table
  source_document_url TEXT,
  shop_name TEXT,
  shop_location TEXT,
  
  -- Vehicle context
  vehicle_id UUID REFERENCES vehicles(id),
  vehicle_year INTEGER,
  vehicle_make TEXT,
  vehicle_model TEXT,
  
  -- Metadata
  invoice_date DATE,
  learned_at TIMESTAMPTZ DEFAULT NOW(),
  confidence DECIMAL(3,2) DEFAULT 0.8, -- 0.0-1.0
  
  -- Link to catalog part if matched
  catalog_part_id UUID REFERENCES catalog_parts(id),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_pricing_part_number ON invoice_learned_pricing(part_number);
CREATE INDEX IF NOT EXISTS idx_invoice_pricing_brand ON invoice_learned_pricing(brand);
CREATE INDEX IF NOT EXISTS idx_invoice_pricing_vehicle ON invoice_learned_pricing(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_invoice_pricing_shop ON invoice_learned_pricing(shop_name);
CREATE INDEX IF NOT EXISTS idx_invoice_pricing_date ON invoice_learned_pricing(invoice_date DESC);

-- 3. Track system organization patterns learned from invoices
CREATE TABLE IF NOT EXISTS system_organization_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- System identification
  system_name TEXT NOT NULL, -- "Motec Engine management system"
  system_category TEXT, -- "Engine", "Transmission", "Chassis", "Electrical"
  
  -- Parts in this system
  part_numbers TEXT[] NOT NULL,
  part_names TEXT[],
  brands TEXT[],
  
  -- Source
  learned_from_invoice_id UUID, -- References documents table
  learned_from_shop TEXT,
  
  -- Vehicle context
  vehicle_id UUID REFERENCES vehicles(id),
  vehicle_year INTEGER,
  vehicle_make TEXT,
  vehicle_model TEXT,
  
  -- Metadata
  total_system_cost DECIMAL(10,2),
  learned_at TIMESTAMPTZ DEFAULT NOW(),
  confidence DECIMAL(3,2) DEFAULT 0.8,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_patterns_name ON system_organization_patterns(system_name);
CREATE INDEX IF NOT EXISTS idx_system_patterns_category ON system_organization_patterns(system_category);
CREATE INDEX IF NOT EXISTS idx_system_patterns_vehicle ON system_organization_patterns(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_system_patterns_parts ON system_organization_patterns USING GIN(part_numbers);

-- 4. Track labor patterns learned from invoices
CREATE TABLE IF NOT EXISTS labor_patterns_learned (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Work description
  work_description TEXT NOT NULL,
  work_category TEXT, -- "Installation", "Fabrication", "Programming", "Testing"
  system_category TEXT, -- "Engine", "Transmission", "Electrical", etc.
  
  -- Labor data
  labor_hours DECIMAL(5,2) NOT NULL,
  labor_rate DECIMAL(8,2),
  labor_total DECIMAL(10,2),
  
  -- Parts context
  parts_count INTEGER,
  system_complexity TEXT, -- "Simple", "Moderate", "Complex", "Custom"
  
  -- Source
  learned_from_invoice_id UUID, -- References documents table
  learned_from_shop TEXT,
  
  -- Vehicle context
  vehicle_id UUID REFERENCES vehicles(id),
  vehicle_year INTEGER,
  vehicle_make TEXT,
  vehicle_model TEXT,
  
  -- Metadata
  invoice_date DATE,
  learned_at TIMESTAMPTZ DEFAULT NOW(),
  confidence DECIMAL(3,2) DEFAULT 0.8,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_labor_patterns_category ON labor_patterns_learned(work_category);
CREATE INDEX IF NOT EXISTS idx_labor_patterns_system ON labor_patterns_learned(system_category);
CREATE INDEX IF NOT EXISTS idx_labor_patterns_vehicle ON labor_patterns_learned(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_labor_patterns_hours ON labor_patterns_learned(labor_hours);

-- 5. Track brand-to-supplier mappings learned from invoices
CREATE TABLE IF NOT EXISTS brand_supplier_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  brand_name TEXT NOT NULL,
  supplier_name TEXT NOT NULL, -- Shop/vendor that sells this brand
  supplier_type TEXT, -- "Shop", "Dealer", "Distributor", "Manufacturer"
  supplier_location TEXT,
  
  -- Learned from
  learned_from_invoice_id UUID,
  learned_from_count INTEGER DEFAULT 1, -- How many invoices we've seen this on
  
  -- Metadata
  learned_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(brand_name, supplier_name)
);

CREATE INDEX IF NOT EXISTS idx_brand_supplier_brand ON brand_supplier_mappings(brand_name);
CREATE INDEX IF NOT EXISTS idx_brand_supplier_supplier ON brand_supplier_mappings(supplier_name);

-- RLS Policies
ALTER TABLE invoice_learned_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_organization_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE labor_patterns_learned ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_supplier_mappings ENABLE ROW LEVEL SECURITY;

-- Public read for all invoice-learned data
CREATE POLICY "Public read invoice pricing" ON invoice_learned_pricing FOR SELECT USING (true);
CREATE POLICY "Public read system patterns" ON system_organization_patterns FOR SELECT USING (true);
CREATE POLICY "Public read labor patterns" ON labor_patterns_learned FOR SELECT USING (true);
CREATE POLICY "Public read brand mappings" ON brand_supplier_mappings FOR SELECT USING (true);

-- Service role can insert/update
CREATE POLICY "Service role manage invoice pricing" ON invoice_learned_pricing 
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role manage system patterns" ON system_organization_patterns 
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role manage labor patterns" ON labor_patterns_learned 
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role manage brand mappings" ON brand_supplier_mappings 
  FOR ALL USING (auth.role() = 'service_role');

