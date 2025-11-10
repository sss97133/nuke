-- Vehicle Build Management System
-- Comprehensive tracking for restoration projects, parts, invoices, and suppliers

-- Suppliers table (vendors, shops, marketplaces)
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('vendor', 'marketplace', 'shop', 'labor', 'individual')),
  website TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  UNIQUE(name, user_id)
);

-- Build projects (overall restoration/build tracking)
CREATE TABLE IF NOT EXISTS vehicle_builds (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  name TEXT NOT NULL, -- e.g., "Frame-off Restoration", "LS3 Swap"
  description TEXT,
  start_date DATE,
  target_completion_date DATE,
  actual_completion_date DATE,
  status TEXT DEFAULT 'planning' CHECK (status IN ('planning', 'in_progress', 'on_hold', 'completed', 'cancelled')),
  total_budget DECIMAL(10,2),
  total_spent DECIMAL(10,2) DEFAULT 0,
  total_hours_estimated INTEGER,
  total_hours_actual INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Build phases/invoices (payment phases, invoice groupings)
CREATE TABLE IF NOT EXISTS build_phases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  build_id UUID REFERENCES vehicle_builds(id) ON DELETE CASCADE,
  phase_number INTEGER NOT NULL,
  name TEXT NOT NULL, -- e.g., "Invoice 1", "Phase 2: Engine Build"
  description TEXT,
  start_date DATE,
  end_date DATE,
  invoice_number TEXT,
  payment_method TEXT,
  payment_date DATE,
  subtotal DECIMAL(10,2) DEFAULT 0,
  tax DECIMAL(10,2) DEFAULT 0,
  total DECIMAL(10,2) DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'paid', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Parts categories for organization
CREATE TABLE IF NOT EXISTS part_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE, -- engine, transmission, suspension, body, interior, etc.
  parent_category_id UUID REFERENCES part_categories(id),
  description TEXT,
  icon TEXT,
  sort_order INTEGER DEFAULT 0
);

-- Build line items (individual parts, labor, services)
CREATE TABLE IF NOT EXISTS build_line_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  build_id UUID REFERENCES vehicle_builds(id) ON DELETE CASCADE,
  phase_id UUID REFERENCES build_phases(id) ON DELETE SET NULL,
  category_id UUID REFERENCES part_categories(id),
  supplier_id UUID REFERENCES suppliers(id),
  
  -- Item details
  part_number TEXT,
  name TEXT NOT NULL,
  description TEXT,
  quantity INTEGER DEFAULT 1,
  unit_price DECIMAL(10,2),
  total_price DECIMAL(10,2),
  
  -- Timeline
  days_to_install INTEGER DEFAULT 0, -- Your "Time" column
  date_ordered DATE,
  date_received DATE,
  date_installed DATE,
  
  -- Status tracking
  status TEXT DEFAULT 'planning' CHECK (status IN (
    'planning', 'ordered', 'backordered', 'received', 
    'in_progress', 'installed', 'completed', 'returned', 'cancelled'
  )),
  
  -- Metadata
  condition TEXT CHECK (condition IN ('new', 'used', 'rebuilt', 'refurbished')),
  warranty_months INTEGER,
  notes TEXT,
  
  -- Flags
  is_labor BOOLEAN DEFAULT FALSE,
  is_core_exchange BOOLEAN DEFAULT FALSE,
  is_sponsor_provided BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Documents (receipts, invoices, quotes)
CREATE TABLE IF NOT EXISTS build_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  build_id UUID REFERENCES vehicle_builds(id) ON DELETE CASCADE,
  phase_id UUID REFERENCES build_phases(id),
  line_item_id UUID REFERENCES build_line_items(id),
  supplier_id UUID REFERENCES suppliers(id),
  
  document_type TEXT CHECK (document_type IN ('receipt', 'invoice', 'quote', 'warranty', 'manual', 'spec_sheet')),
  document_number TEXT,
  document_date DATE,
  file_url TEXT,
  file_name TEXT,
  mime_type TEXT,
  file_size INTEGER,
  
  -- Parsed data from OCR
  parsed_data JSONB,
  parsed_total DECIMAL(10,2),
  parsed_items JSONB[], -- Array of parsed line items
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Build images (associate images with specific parts/work)
CREATE TABLE IF NOT EXISTS build_images (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  build_id UUID REFERENCES vehicle_builds(id) ON DELETE CASCADE,
  line_item_id UUID REFERENCES build_line_items(id),
  image_id UUID REFERENCES vehicle_images(id) ON DELETE CASCADE,
  
  caption TEXT,
  stage TEXT CHECK (stage IN ('before', 'during', 'after', 'detail', 'problem', 'completed')),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Benchmark vehicles (for value comparison)
CREATE TABLE IF NOT EXISTS build_benchmarks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  build_id UUID REFERENCES vehicle_builds(id) ON DELETE CASCADE,
  
  source TEXT, -- BAT, Barrett-Jackson, etc.
  listing_url TEXT,
  sale_price DECIMAL(10,2),
  sale_date DATE,
  
  -- Vehicle details for comparison
  year INTEGER,
  make TEXT,
  model TEXT,
  engine TEXT,
  transmission TEXT,
  modifications TEXT,
  
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Build tags for flexible categorization
CREATE TABLE IF NOT EXISTS build_tags (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  build_id UUID REFERENCES vehicle_builds(id) ON DELETE CASCADE,
  line_item_id UUID REFERENCES build_line_items(id),
  tag TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default part categories if they don't exist
INSERT INTO part_categories (name, sort_order) VALUES
  ('Engine', 1),
  ('Transmission', 2),
  ('Transfer Case', 3),
  ('Axles', 4),
  ('Suspension', 5),
  ('Steering', 6),
  ('Brakes', 7),
  ('Exhaust', 8),
  ('Fuel Delivery', 9),
  ('Cooling', 10),
  ('Electrical', 11),
  ('Body', 12),
  ('Interior', 13),
  ('Wheels & Tires', 14),
  ('AC/Heat', 15),
  ('Audio', 16),
  ('Accessories', 17),
  ('Labor', 18),
  ('Tax & Fees', 19)
ON CONFLICT (name) DO NOTHING;

-- Views for easy querying
DROP VIEW IF EXISTS build_summary;

CREATE OR REPLACE VIEW build_summary AS
SELECT 
  vb.*,
  v.year,
  v.make,
  v.model,
  v.vin,
  COUNT(DISTINCT bp.id) as phase_count,
  COUNT(DISTINCT bli.id) as item_count,
  SUM(bli.total_price) as calculated_total,
  COUNT(DISTINCT CASE WHEN bli.status = 'completed' THEN bli.id END) as completed_items,
  COUNT(DISTINCT CASE WHEN bli.status IN ('ordered', 'backordered') THEN bli.id END) as pending_items
FROM vehicle_builds vb
LEFT JOIN vehicles v ON v.id = vb.vehicle_id
LEFT JOIN build_phases bp ON bp.build_id = vb.id
LEFT JOIN build_line_items bli ON bli.build_id = vb.id
GROUP BY vb.id, v.year, v.make, v.model, v.vin;

-- RLS Policies
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_builds ENABLE ROW LEVEL SECURITY;
ALTER TABLE build_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE build_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE build_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE build_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE build_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE build_tags ENABLE ROW LEVEL SECURITY;

-- Suppliers: users can only see their own suppliers
DROP POLICY IF EXISTS suppliers_policy ON suppliers;
CREATE POLICY suppliers_policy ON suppliers
  USING (user_id = auth.uid() OR user_id IS NULL);

-- Build access based on vehicle ownership
DROP POLICY IF EXISTS builds_policy ON vehicle_builds;
CREATE POLICY builds_policy ON vehicle_builds
  USING (
    EXISTS (
      SELECT 1 FROM vehicles v 
      WHERE v.id = vehicle_id 
      AND v.user_id = auth.uid()
    )
  );

-- Cascade policies for build-related tables
DROP POLICY IF EXISTS phases_policy ON build_phases;
CREATE POLICY phases_policy ON build_phases
  USING (
    EXISTS (
      SELECT 1 FROM vehicle_builds vb
      JOIN vehicles v ON v.id = vb.vehicle_id
      WHERE vb.id = build_id
      AND v.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS items_policy ON build_line_items;
CREATE POLICY items_policy ON build_line_items
  USING (
    EXISTS (
      SELECT 1 FROM vehicle_builds vb
      JOIN vehicles v ON v.id = vb.vehicle_id
      WHERE vb.id = build_id
      AND v.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS documents_policy ON build_documents;
CREATE POLICY documents_policy ON build_documents
  USING (
    EXISTS (
      SELECT 1 FROM vehicle_builds vb
      JOIN vehicles v ON v.id = vb.vehicle_id
      WHERE vb.id = build_id
      AND v.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS images_policy ON build_images;
CREATE POLICY images_policy ON build_images
  USING (
    EXISTS (
      SELECT 1 FROM vehicle_builds vb
      JOIN vehicles v ON v.id = vb.vehicle_id
      WHERE vb.id = build_id
      AND v.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS benchmarks_policy ON build_benchmarks;
CREATE POLICY benchmarks_policy ON build_benchmarks
  USING (
    EXISTS (
      SELECT 1 FROM vehicle_builds vb
      JOIN vehicles v ON v.id = vb.vehicle_id
      WHERE vb.id = build_id
      AND v.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS tags_policy ON build_tags;
CREATE POLICY tags_policy ON build_tags
  USING (
    EXISTS (
      SELECT 1 FROM vehicle_builds vb
      JOIN vehicles v ON v.id = vb.vehicle_id
      WHERE vb.id = build_id
      AND v.user_id = auth.uid()
    )
  );

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_builds_vehicle ON vehicle_builds(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_phases_build ON build_phases(build_id);
CREATE INDEX IF NOT EXISTS idx_items_build ON build_line_items(build_id);
CREATE INDEX IF NOT EXISTS idx_items_phase ON build_line_items(phase_id);
CREATE INDEX IF NOT EXISTS idx_items_supplier ON build_line_items(supplier_id);
CREATE INDEX IF NOT EXISTS idx_items_category ON build_line_items(category_id);
CREATE INDEX IF NOT EXISTS idx_items_status ON build_line_items(status);
CREATE INDEX IF NOT EXISTS idx_documents_build ON build_documents(build_id);
CREATE INDEX IF NOT EXISTS idx_images_build ON build_images(build_id);
CREATE INDEX IF NOT EXISTS idx_images_item ON build_images(line_item_id);
CREATE INDEX IF NOT EXISTS idx_benchmarks_build ON build_benchmarks(build_id);
CREATE INDEX IF NOT EXISTS idx_tags_build ON build_tags(build_id);
CREATE INDEX IF NOT EXISTS idx_tags_item ON build_tags(line_item_id);
