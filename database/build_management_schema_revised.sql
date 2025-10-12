-- Vehicle Build Management System - Revised with Privacy Controls
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
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
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

  -- Privacy/Visibility Controls
  is_public BOOLEAN DEFAULT FALSE,
  visibility_level TEXT DEFAULT 'private' CHECK (visibility_level IN ('private', 'friends', 'public')),
  show_costs BOOLEAN DEFAULT FALSE, -- Whether to show financial data publicly
  allow_comments BOOLEAN DEFAULT FALSE, -- Whether to allow public comments

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

  -- Privacy: inherits from build but can override
  is_cost_visible BOOLEAN DEFAULT NULL, -- NULL = inherit from build, TRUE/FALSE = override

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

  -- Privacy: individual items can be hidden while keeping build visible
  is_public BOOLEAN DEFAULT TRUE, -- Individual items visible in public builds
  hide_cost BOOLEAN DEFAULT FALSE, -- Hide cost even if build shows costs

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

  -- Privacy: documents are generally private unless explicitly shared
  is_public BOOLEAN DEFAULT FALSE,

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

  -- Privacy: inherit from build by default
  is_public BOOLEAN DEFAULT TRUE, -- Show in public builds unless specifically hidden

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

  -- Privacy: benchmarks are typically public data but may be hidden
  is_public BOOLEAN DEFAULT TRUE,

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

-- Build access permissions (for friends/shared access)
CREATE TABLE IF NOT EXISTS build_permissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  build_id UUID REFERENCES vehicle_builds(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  permission_level TEXT DEFAULT 'view' CHECK (permission_level IN ('view', 'comment', 'edit')),
  granted_by UUID REFERENCES profiles(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  UNIQUE(build_id, user_id)
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
  COUNT(DISTINCT CASE WHEN bli.status IN ('ordered', 'backordered') THEN bli.id END) as pending_items,
  -- Privacy-aware aggregations
  CASE
    WHEN vb.show_costs = TRUE THEN SUM(bli.total_price)
    ELSE NULL
  END as public_total_spent,
  COUNT(DISTINCT CASE WHEN bli.is_public = TRUE THEN bli.id END) as public_item_count
FROM vehicle_builds vb
LEFT JOIN vehicles v ON v.id = vb.vehicle_id
LEFT JOIN build_phases bp ON bp.build_id = vb.id
LEFT JOIN build_line_items bli ON bli.build_id = vb.id
GROUP BY vb.id, v.year, v.make, v.model, v.vin;

-- Public view for anonymous users
CREATE OR REPLACE VIEW public_builds AS
SELECT
  vb.id,
  vb.vehicle_id,
  vb.name,
  vb.description,
  vb.status,
  vb.start_date,
  vb.target_completion_date,
  vb.actual_completion_date,
  CASE
    WHEN vb.show_costs = TRUE THEN vb.total_budget
    ELSE NULL
  END as total_budget,
  CASE
    WHEN vb.show_costs = TRUE THEN vb.total_spent
    ELSE NULL
  END as total_spent,
  vb.total_hours_estimated,
  vb.total_hours_actual,
  vb.created_at,
  v.year,
  v.make,
  v.model
FROM vehicle_builds vb
JOIN vehicles v ON v.id = vb.vehicle_id
WHERE vb.visibility_level = 'public'
  AND v.is_public = TRUE;

-- RLS Policies
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_builds ENABLE ROW LEVEL SECURITY;
ALTER TABLE build_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE build_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE build_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE build_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE build_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE build_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE build_permissions ENABLE ROW LEVEL SECURITY;

-- Suppliers: users can only see their own suppliers
CREATE POLICY suppliers_policy ON suppliers
  USING (user_id = auth.uid() OR user_id IS NULL);

-- Build access based on vehicle ownership and visibility settings
CREATE POLICY builds_policy ON vehicle_builds
  USING (
    EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.id = vehicle_id
      AND v.uploaded_by = auth.uid()
    )
    OR
    (
      -- Public builds are visible to all authenticated users
      visibility_level = 'public'
      AND EXISTS (
        SELECT 1 FROM vehicles v
        WHERE v.id = vehicle_id
        AND v.is_public = TRUE
      )
    )
    OR
    (
      -- Shared builds via permissions
      visibility_level = 'friends'
      AND EXISTS (
        SELECT 1 FROM build_permissions bp
        WHERE bp.build_id = id
        AND bp.user_id = auth.uid()
        AND (bp.expires_at IS NULL OR bp.expires_at > NOW())
      )
    )
  );

-- Cascade policies for build-related tables
CREATE POLICY phases_policy ON build_phases
  USING (
    EXISTS (
      SELECT 1 FROM vehicle_builds vb
      WHERE vb.id = build_id
      AND (
        EXISTS (
          SELECT 1 FROM vehicles v
          WHERE v.id = vb.vehicle_id
          AND v.uploaded_by = auth.uid()
        )
        OR
        (
          vb.visibility_level = 'public'
          AND EXISTS (
            SELECT 1 FROM vehicles v
            WHERE v.id = vb.vehicle_id
            AND v.is_public = TRUE
          )
        )
      )
    )
  );

CREATE POLICY items_policy ON build_line_items
  USING (
    EXISTS (
      SELECT 1 FROM vehicle_builds vb
      WHERE vb.id = build_id
      AND (
        EXISTS (
          SELECT 1 FROM vehicles v
          WHERE v.id = vb.vehicle_id
          AND v.uploaded_by = auth.uid()
        )
        OR
        (
          vb.visibility_level = 'public'
          AND is_public = TRUE
          AND EXISTS (
            SELECT 1 FROM vehicles v
            WHERE v.id = vb.vehicle_id
            AND v.is_public = TRUE
          )
        )
      )
    )
  );

CREATE POLICY documents_policy ON build_documents
  USING (
    EXISTS (
      SELECT 1 FROM vehicle_builds vb
      WHERE vb.id = build_id
      AND (
        EXISTS (
          SELECT 1 FROM vehicles v
          WHERE v.id = vb.vehicle_id
          AND v.uploaded_by = auth.uid()
        )
        OR
        (
          is_public = TRUE
          AND vb.visibility_level = 'public'
          AND EXISTS (
            SELECT 1 FROM vehicles v
            WHERE v.id = vb.vehicle_id
            AND v.is_public = TRUE
          )
        )
      )
    )
  );

CREATE POLICY images_policy ON build_images
  USING (
    EXISTS (
      SELECT 1 FROM vehicle_builds vb
      WHERE vb.id = build_id
      AND (
        EXISTS (
          SELECT 1 FROM vehicles v
          WHERE v.id = vb.vehicle_id
          AND v.uploaded_by = auth.uid()
        )
        OR
        (
          is_public = TRUE
          AND vb.visibility_level = 'public'
          AND EXISTS (
            SELECT 1 FROM vehicles v
            WHERE v.id = vb.vehicle_id
            AND v.is_public = TRUE
          )
        )
      )
    )
  );

CREATE POLICY benchmarks_policy ON build_benchmarks
  USING (
    EXISTS (
      SELECT 1 FROM vehicle_builds vb
      WHERE vb.id = build_id
      AND (
        EXISTS (
          SELECT 1 FROM vehicles v
          WHERE v.id = vb.vehicle_id
          AND v.uploaded_by = auth.uid()
        )
        OR
        (
          is_public = TRUE
          AND vb.visibility_level = 'public'
          AND EXISTS (
            SELECT 1 FROM vehicles v
            WHERE v.id = vb.vehicle_id
            AND v.is_public = TRUE
          )
        )
      )
    )
  );

CREATE POLICY tags_policy ON build_tags
  USING (
    EXISTS (
      SELECT 1 FROM vehicle_builds vb
      WHERE vb.id = build_id
      AND (
        EXISTS (
          SELECT 1 FROM vehicles v
          WHERE v.id = vb.vehicle_id
          AND v.uploaded_by = auth.uid()
        )
        OR
        (
          vb.visibility_level = 'public'
          AND EXISTS (
            SELECT 1 FROM vehicles v
            WHERE v.id = vb.vehicle_id
            AND v.is_public = TRUE
          )
        )
      )
    )
  );

CREATE POLICY permissions_policy ON build_permissions
  USING (
    user_id = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM vehicle_builds vb
      JOIN vehicles v ON v.id = vb.vehicle_id
      WHERE vb.id = build_id
      AND v.uploaded_by = auth.uid()
    )
  );

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_builds_vehicle ON vehicle_builds(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_builds_visibility ON vehicle_builds(visibility_level, is_public);
CREATE INDEX IF NOT EXISTS idx_phases_build ON build_phases(build_id);
CREATE INDEX IF NOT EXISTS idx_items_build ON build_line_items(build_id);
CREATE INDEX IF NOT EXISTS idx_items_phase ON build_line_items(phase_id);
CREATE INDEX IF NOT EXISTS idx_items_supplier ON build_line_items(supplier_id);
CREATE INDEX IF NOT EXISTS idx_items_category ON build_line_items(category_id);
CREATE INDEX IF NOT EXISTS idx_items_status ON build_line_items(status);
CREATE INDEX IF NOT EXISTS idx_items_public ON build_line_items(is_public);
CREATE INDEX IF NOT EXISTS idx_documents_build ON build_documents(build_id);
CREATE INDEX IF NOT EXISTS idx_images_build ON build_images(build_id);
CREATE INDEX IF NOT EXISTS idx_images_item ON build_images(line_item_id);
CREATE INDEX IF NOT EXISTS idx_benchmarks_build ON build_benchmarks(build_id);
CREATE INDEX IF NOT EXISTS idx_tags_build ON build_tags(build_id);
CREATE INDEX IF NOT EXISTS idx_tags_item ON build_tags(line_item_id);
CREATE INDEX IF NOT EXISTS idx_permissions_build_user ON build_permissions(build_id, user_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_user ON suppliers(user_id);