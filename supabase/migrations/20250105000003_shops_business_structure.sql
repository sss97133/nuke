-- Comprehensive business structure: Locations, Departments, Licenses, Staff

-- 1) License types enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'license_type'
  ) THEN
CREATE TYPE license_type AS ENUM (
  'dealer_license',
  'garage_license',
  'repair_facility_license',
  'body_shop_license',
  'salvage_dealer_license',
  'smog_check_license',
  'wholesale_license',
  'auction_license',
  'transport_license',
  'tow_license',
  'rental_license',
  'other'
);
  END IF;
END;
$$;

-- 2) Department types enum (prebuilt based on business type)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'department_type'
  ) THEN
CREATE TYPE department_type AS ENUM (
  'sales',
  'consignment',
  'service',
  'parts',
  'body_shop',
  'detailing',
  'showroom',
  'warehouse',
  'transport',
  'admin',
  'finance',
  'marketing',
  'custom'
);
  END IF;
END;
$$;

-- 3) Shop locations (physical addresses)
CREATE TABLE IF NOT EXISTS shop_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  
  -- Basic info
  name TEXT NOT NULL, -- e.g., "707 Yucca St HQ"
  is_headquarters BOOLEAN DEFAULT false,
  
  -- Address
  street_address TEXT,
  street_address_2 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT DEFAULT 'USA',
  
  -- Contact
  phone TEXT,
  email TEXT,
  
  -- Operational
  is_active BOOLEAN DEFAULT true,
  square_footage INTEGER,
  parking_spaces INTEGER,
  
  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE shop_locations
  ADD COLUMN IF NOT EXISTS is_headquarters BOOLEAN DEFAULT false;

-- 4) Shop licenses (tied to locations)
CREATE TABLE IF NOT EXISTS shop_licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  location_id UUID REFERENCES shop_locations(id) ON DELETE SET NULL, -- License registered at this location
  
  -- License details
  license_type license_type NOT NULL,
  license_number TEXT NOT NULL,
  issuing_authority TEXT, -- e.g., "Nevada DMV", "Clark County"
  issuing_state TEXT,
  
  -- Dates
  issue_date DATE,
  expiration_date DATE,
  renewal_date DATE,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  is_verified BOOLEAN DEFAULT false,
  
  -- Documentation
  document_url TEXT, -- Link to uploaded license doc
  storage_path TEXT,
  
  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(shop_id, license_number)
);

-- 5) Shop departments
CREATE TABLE IF NOT EXISTS shop_departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  location_id UUID REFERENCES shop_locations(id) ON DELETE SET NULL, -- Department operates at this location
  
  -- Basic info
  name TEXT NOT NULL, -- e.g., "Showroom", "Service Bay 1"
  department_type department_type NOT NULL,
  description TEXT,
  
  -- Hierarchy
  parent_department_id UUID REFERENCES shop_departments(id) ON DELETE SET NULL,
  department_head_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Operational
  is_active BOOLEAN DEFAULT true,
  capacity INTEGER, -- How many vehicles/jobs can handle
  
  -- Cost center
  budget_monthly DECIMAL(10,2),
  cost_center_code TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE shop_departments
  ADD COLUMN IF NOT EXISTS parent_department_id UUID REFERENCES shop_departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS department_head_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 6) Update shop_members to include department assignment
ALTER TABLE shop_members
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES shop_departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS job_title TEXT,
  ADD COLUMN IF NOT EXISTS hire_date DATE,
  ADD COLUMN IF NOT EXISTS hourly_rate DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS is_department_head BOOLEAN DEFAULT false;

-- 7) Department presets based on business type
CREATE TABLE IF NOT EXISTS department_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_type TEXT NOT NULL,
  department_type TEXT NOT NULL,
  preset_name TEXT NOT NULL,
  description TEXT,
  typical_roles TEXT[], -- e.g., ['manager', 'technician', 'porter']
  is_recommended BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0
);

ALTER TABLE department_presets
  ADD COLUMN IF NOT EXISTS department_name TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Insert automotive business presets if not already present (supports legacy schema)
WITH preset_values AS (
  SELECT * FROM (VALUES
  -- Dealer presets
  ('dealer', 'sales', 'Sales Department', 'New and used vehicle sales', ARRAY['sales_manager', 'salesperson', 'finance_manager'], true, 1),
  ('dealer', 'consignment', 'Consignment Department', 'Consignment vehicle sales', ARRAY['consignment_manager', 'salesperson'], true, 2),
  ('dealer', 'showroom', 'Showroom', 'Vehicle display and customer area', ARRAY['showroom_manager', 'porter'], true, 3),
  ('dealer', 'service', 'Service Department', 'Vehicle service and repairs', ARRAY['service_manager', 'technician', 'service_advisor'], true, 4),
  ('dealer', 'parts', 'Parts Department', 'Parts sales and inventory', ARRAY['parts_manager', 'parts_specialist'], true, 5),
  ('dealer', 'finance', 'Finance & Admin', 'Financing, titles, admin', ARRAY['finance_manager', 'admin'], true, 6),
  
  -- Shop/Garage presets
  ('shop', 'service', 'Service Bay', 'General repair and maintenance', ARRAY['shop_manager', 'mechanic', 'apprentice'], true, 1),
  ('shop', 'body_shop', 'Body Shop', 'Collision repair and paint', ARRAY['body_shop_manager', 'body_technician', 'painter'], true, 2),
  ('shop', 'detailing', 'Detailing Department', 'Cleaning and detailing', ARRAY['detail_manager', 'detailer'], true, 3),
  ('shop', 'parts', 'Parts Counter', 'Parts sales', ARRAY['parts_manager', 'counter_staff'], true, 4),
  
  -- Garage presets
  ('garage', 'service', 'Service Bay', 'Repair facility', ARRAY['lead_mechanic', 'mechanic'], true, 1),
  ('garage', 'warehouse', 'Storage', 'Vehicle and parts storage', ARRAY['warehouse_manager'], true, 2),
  
  -- Builder presets
  ('builder', 'custom', 'Custom Build Shop', 'Custom vehicle fabrication', ARRAY['master_builder', 'fabricator', 'welder'], true, 1),
  ('builder', 'body_shop', 'Paint & Body', 'Custom paint and bodywork', ARRAY['paint_manager', 'painter', 'body_man'], true, 2),
  
  -- Transporter presets
    ('transporter', 'transport', 'Transport Operations', 'Vehicle transport logistics', ARRAY['dispatcher', 'driver', 'coordinator'], true, 1)
  ) AS v(business_type, department_type, preset_label, description, typical_roles, is_recommended, sort_order)
)
INSERT INTO department_presets (
  business_type,
  department_type,
  department_name,
  description,
  typical_roles,
  is_active,
  created_at,
  is_recommended,
  preset_name,
  sort_order
)
SELECT
  pv.business_type,
  pv.department_type,
  pv.preset_label,
  pv.description,
  pv.typical_roles,
  true,
  NOW(),
  pv.is_recommended,
  pv.preset_label,
  pv.sort_order
FROM preset_values pv
WHERE NOT EXISTS (
  SELECT 1
  FROM department_presets dp
  WHERE dp.business_type = pv.business_type
    AND dp.department_type = pv.department_type
    AND COALESCE(dp.preset_name, dp.department_name) = pv.preset_label
);

-- 8) Enable RLS
ALTER TABLE shop_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_presets ENABLE ROW LEVEL SECURITY;

-- RLS Policies for shop_locations
DROP POLICY IF EXISTS "Shop members can view locations" ON shop_locations;
CREATE POLICY "Shop members can view locations"
  ON shop_locations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM shops s 
      WHERE s.id = shop_locations.shop_id 
      AND (s.owner_user_id = auth.uid() OR EXISTS (
        SELECT 1 FROM shop_members sm 
        WHERE sm.shop_id = s.id 
        AND sm.user_id = auth.uid() 
        AND sm.status = 'active'
      ))
    )
  );

DROP POLICY IF EXISTS "Shop owners/admins can manage locations" ON shop_locations;
CREATE POLICY "Shop owners/admins can manage locations"
  ON shop_locations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM shops s 
      WHERE s.id = shop_locations.shop_id 
      AND (s.owner_user_id = auth.uid() OR EXISTS (
        SELECT 1 FROM shop_members sm 
        WHERE sm.shop_id = s.id 
        AND sm.user_id = auth.uid() 
        AND sm.role IN ('owner', 'admin')
        AND sm.status = 'active'
      ))
    )
  );

-- RLS Policies for shop_licenses
DROP POLICY IF EXISTS "Shop members can view licenses" ON shop_licenses;
CREATE POLICY "Shop members can view licenses"
  ON shop_licenses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM shops s 
      WHERE s.id = shop_licenses.shop_id 
      AND (s.owner_user_id = auth.uid() OR EXISTS (
        SELECT 1 FROM shop_members sm 
        WHERE sm.shop_id = s.id 
        AND sm.user_id = auth.uid() 
        AND sm.status = 'active'
      ))
    )
  );

DROP POLICY IF EXISTS "Shop owners/admins can manage licenses" ON shop_licenses;
CREATE POLICY "Shop owners/admins can manage licenses"
  ON shop_licenses FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM shops s 
      WHERE s.id = shop_licenses.shop_id 
      AND (s.owner_user_id = auth.uid() OR EXISTS (
        SELECT 1 FROM shop_members sm 
        WHERE sm.shop_id = s.id 
        AND sm.user_id = auth.uid() 
        AND sm.role IN ('owner', 'admin')
        AND sm.status = 'active'
      ))
    )
  );

-- RLS Policies for shop_departments
DROP POLICY IF EXISTS "Shop members can view departments" ON shop_departments;
CREATE POLICY "Shop members can view departments"
  ON shop_departments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM shops s 
      WHERE s.id = shop_departments.shop_id 
      AND (s.owner_user_id = auth.uid() OR EXISTS (
        SELECT 1 FROM shop_members sm 
        WHERE sm.shop_id = s.id 
        AND sm.user_id = auth.uid() 
        AND sm.status = 'active'
      ))
    )
  );

DROP POLICY IF EXISTS "Shop owners/admins can manage departments" ON shop_departments;
CREATE POLICY "Shop owners/admins can manage departments"
  ON shop_departments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM shops s 
      WHERE s.id = shop_departments.shop_id 
      AND (s.owner_user_id = auth.uid() OR EXISTS (
        SELECT 1 FROM shop_members sm 
        WHERE sm.shop_id = s.id 
        AND sm.user_id = auth.uid() 
        AND sm.role IN ('owner', 'admin')
        AND sm.status = 'active'
      ))
    )
  );

-- Department presets are public (read-only)
DROP POLICY IF EXISTS "Anyone can view department presets" ON department_presets;
CREATE POLICY "Anyone can view department presets"
  ON department_presets FOR SELECT
  USING (true);

-- 9) Indexes
CREATE INDEX IF NOT EXISTS idx_shop_locations_shop ON shop_locations(shop_id);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shop_locations' AND column_name = 'is_headquarters'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shop_locations_hq ON shop_locations(shop_id, is_headquarters) WHERE is_headquarters = true';
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS idx_shop_licenses_shop ON shop_licenses(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_licenses_location ON shop_licenses(location_id);
CREATE INDEX IF NOT EXISTS idx_shop_licenses_expiration ON shop_licenses(expiration_date) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_shop_departments_shop ON shop_departments(shop_id);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shop_departments' AND column_name = 'location_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shop_departments_location ON shop_departments(location_id)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'shop_departments' AND column_name = 'parent_department_id'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_shop_departments_parent ON shop_departments(parent_department_id)';
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS idx_shop_members_department ON shop_members(department_id);
CREATE INDEX IF NOT EXISTS idx_department_presets_business_type ON department_presets(business_type);

-- 10) Helper function to get shop org chart
CREATE OR REPLACE FUNCTION get_shop_org_chart(p_shop_id UUID)
RETURNS TABLE (
  location_name TEXT,
  location_id UUID,
  department_name TEXT,
  department_id UUID,
  department_type department_type,
  department_head_name TEXT,
  member_count BIGINT,
  licenses TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sl.name AS location_name,
    sl.id AS location_id,
    sd.name AS department_name,
    sd.id AS department_id,
    sd.department_type,
    u.email AS department_head_name,
    COUNT(DISTINCT sm.id) AS member_count,
    ARRAY_AGG(DISTINCT lic.license_type::TEXT) FILTER (WHERE lic.id IS NOT NULL) AS licenses
  FROM shop_locations sl
  LEFT JOIN shop_departments sd ON sd.location_id = sl.id
  LEFT JOIN auth.users u ON sd.department_head_user_id = u.id
  LEFT JOIN shop_members sm ON sm.department_id = sd.id AND sm.status = 'active'
  LEFT JOIN shop_licenses lic ON lic.location_id = sl.id AND lic.is_active = true
  WHERE sl.shop_id = p_shop_id
  GROUP BY sl.name, sl.id, sd.name, sd.id, sd.department_type, u.email
  ORDER BY sl.is_headquarters DESC, sl.name, sd.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 11) Function to create default departments for a shop
DROP FUNCTION IF EXISTS create_default_departments(UUID, UUID, org_type);
DROP FUNCTION IF EXISTS create_default_departments(UUID, UUID, TEXT);
CREATE OR REPLACE FUNCTION create_default_departments(
  p_shop_id UUID,
  p_location_id UUID,
  p_business_type TEXT
)
RETURNS SETOF shop_departments AS $$
DECLARE
  preset RECORD;
  new_dept shop_departments;
BEGIN
  FOR preset IN 
    SELECT * FROM department_presets 
    WHERE business_type = p_business_type 
    AND is_recommended = true
    ORDER BY sort_order
  LOOP
    INSERT INTO shop_departments (
      shop_id,
      location_id,
      name,
      department_type,
      description
    ) VALUES (
      p_shop_id,
      p_location_id,
      preset.preset_name,
      preset.department_type,
      preset.description
    ) RETURNING * INTO new_dept;
    
    RETURN NEXT new_dept;
  END LOOP;
  
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 12) Trigger to update shop.updated_at when related entities change
CREATE OR REPLACE FUNCTION update_shop_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE shops SET updated_at = NOW() WHERE id = NEW.shop_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shop_locations_update_shop_timestamp ON shop_locations;
CREATE TRIGGER shop_locations_update_shop_timestamp
  AFTER INSERT OR UPDATE ON shop_locations
  FOR EACH ROW EXECUTE FUNCTION update_shop_timestamp();

DROP TRIGGER IF EXISTS shop_licenses_update_shop_timestamp ON shop_licenses;
CREATE TRIGGER shop_licenses_update_shop_timestamp
  AFTER INSERT OR UPDATE ON shop_licenses
  FOR EACH ROW EXECUTE FUNCTION update_shop_timestamp();

DROP TRIGGER IF EXISTS shop_departments_update_shop_timestamp ON shop_departments;
CREATE TRIGGER shop_departments_update_shop_timestamp
  AFTER INSERT OR UPDATE ON shop_departments
  FOR EACH ROW EXECUTE FUNCTION update_shop_timestamp();

-- 13) View for expiring licenses (for alerts)
CREATE OR REPLACE VIEW expiring_licenses AS
SELECT 
  sl.id AS license_id,
  sl.license_type,
  sl.license_number,
  sl.expiration_date,
  sl.shop_id,
  s.name AS shop_name,
  s.owner_user_id,
  loc.name AS location_name,
  COALESCE(sl.expiration_date - CURRENT_DATE, 0) AS days_until_expiration
FROM shop_licenses sl
JOIN shops s ON sl.shop_id = s.id
LEFT JOIN shop_locations loc ON sl.location_id = loc.id
WHERE sl.is_active = true
AND sl.expiration_date IS NOT NULL
AND sl.expiration_date <= CURRENT_DATE + INTERVAL '90 days'
ORDER BY sl.expiration_date ASC;
