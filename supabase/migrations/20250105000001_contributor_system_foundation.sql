-- Foundation tables for contributor system
-- These tables are required by shops_core.sql and shops_admin_integration.sql

-- 1) Vehicle Contributor Roles (extended version of vehicle_contributors)
CREATE TABLE IF NOT EXISTS vehicle_contributor_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- 'consigner', 'mechanic', 'appraiser', 'photographer', 'transporter', 'inspector', 'dealer'
  shop_id UUID REFERENCES shops(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT true,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  start_date DATE DEFAULT CURRENT_DATE,
  end_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vehicle_id, user_id, role)
);

-- 2) Contributor Documentation (proof documents for role requests)
CREATE TABLE IF NOT EXISTS contributor_documentation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_id UUID REFERENCES shops(id) ON DELETE SET NULL,
  document_type TEXT NOT NULL, -- 'email_correspondence', 'contract', 'authorization_letter', 'bill_of_sale', 'receipt', 'invoice', 'transport_documents', 'inspection_report'
  title TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_url TEXT NOT NULL,
  mime_type TEXT,
  file_size BIGINT,
  visibility_level TEXT DEFAULT 'owner_only', -- 'public', 'owner_only', 'admin_only'
  is_verified BOOLEAN DEFAULT false,
  verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) Contributor Onboarding (pending role requests)
CREATE TABLE IF NOT EXISTS contributor_onboarding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_role TEXT NOT NULL,
  role_justification TEXT NOT NULL,
  submitted_by TEXT NOT NULL DEFAULT 'individual' CHECK (submitted_by IN ('individual', 'shop')),
  shop_id UUID REFERENCES shops(id) ON DELETE SET NULL,
  uploaded_document_ids UUID[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4) Department Presets (templates for shop departments)
CREATE TABLE IF NOT EXISTS department_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_type TEXT NOT NULL, -- 'dealer', 'garage', 'builder', 'transporter'
  department_type TEXT NOT NULL,
  department_name TEXT NOT NULL,
  description TEXT,
  typical_roles TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5) Indexes
CREATE INDEX IF NOT EXISTS idx_vehicle_contributor_roles_vehicle ON vehicle_contributor_roles(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_contributor_roles_user ON vehicle_contributor_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_contributor_roles_shop ON vehicle_contributor_roles(shop_id);

CREATE INDEX IF NOT EXISTS idx_contributor_documentation_vehicle ON contributor_documentation(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_contributor_documentation_uploaded_by ON contributor_documentation(uploaded_by);

CREATE INDEX IF NOT EXISTS idx_contributor_onboarding_vehicle ON contributor_onboarding(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_contributor_onboarding_user ON contributor_onboarding(user_id);
CREATE INDEX IF NOT EXISTS idx_contributor_onboarding_status ON contributor_onboarding(status);

CREATE INDEX IF NOT EXISTS idx_department_presets_business_type ON department_presets(business_type);

-- 6) RLS Policies
ALTER TABLE vehicle_contributor_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE contributor_documentation ENABLE ROW LEVEL SECURITY;
ALTER TABLE contributor_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_presets ENABLE ROW LEVEL SECURITY;

-- Vehicle Contributor Roles: Users can see roles for vehicles they have access to
DROP POLICY IF EXISTS contributor_roles_select ON vehicle_contributor_roles;
CREATE POLICY contributor_roles_select ON vehicle_contributor_roles FOR SELECT
USING (
  user_id = auth.uid() OR
  vehicle_id IN (SELECT id FROM vehicles WHERE uploaded_by = auth.uid()) OR
  EXISTS (SELECT 1 FROM vehicle_contributors vc WHERE vc.vehicle_id = vehicle_contributor_roles.vehicle_id AND vc.user_id = auth.uid())
);

-- Contributor Documentation: Users can see their own docs or docs for vehicles they own
DROP POLICY IF EXISTS contributor_docs_select ON contributor_documentation;
CREATE POLICY contributor_docs_select ON contributor_documentation FOR SELECT
USING (
  uploaded_by = auth.uid() OR
  vehicle_id IN (SELECT id FROM vehicles WHERE uploaded_by = auth.uid())
);

DROP POLICY IF EXISTS contributor_docs_insert ON contributor_documentation;
CREATE POLICY contributor_docs_insert ON contributor_documentation FOR INSERT
WITH CHECK (uploaded_by = auth.uid());

-- Contributor Onboarding: Users can see their own requests or requests for their vehicles
DROP POLICY IF EXISTS contributor_onboarding_select ON contributor_onboarding;
CREATE POLICY contributor_onboarding_select ON contributor_onboarding FOR SELECT
USING (
  user_id = auth.uid() OR
  vehicle_id IN (SELECT id FROM vehicles WHERE uploaded_by = auth.uid())
);

DROP POLICY IF EXISTS contributor_onboarding_insert ON contributor_onboarding;
CREATE POLICY contributor_onboarding_insert ON contributor_onboarding FOR INSERT
WITH CHECK (user_id = auth.uid());

-- Department Presets: Public read access
DROP POLICY IF EXISTS department_presets_select ON department_presets;
CREATE POLICY department_presets_select ON department_presets FOR SELECT
USING (true);

-- 7) Seed Department Presets
INSERT INTO department_presets (business_type, department_type, department_name, description, typical_roles)
SELECT v.business_type, v.department_type, v.department_name, v.description, v.typical_roles
FROM (
-- Dealer presets
  SELECT 'dealer'::text, 'sales', 'Sales Department', 'Vehicle sales and customer relations', ARRAY['sales_manager', 'salesperson', 'finance_manager']
  UNION ALL SELECT 'dealer', 'consignment', 'Consignment Department', 'Consignment vehicle management', ARRAY['consignment_manager', 'salesperson']
  UNION ALL SELECT 'dealer', 'showroom', 'Showroom', 'Vehicle display and presentation', ARRAY['showroom_manager', 'porter']
  UNION ALL SELECT 'dealer', 'service', 'Service Department', 'Vehicle service and repairs', ARRAY['service_manager', 'technician', 'service_advisor']
  UNION ALL SELECT 'dealer', 'parts', 'Parts Department', 'Parts sales and inventory', ARRAY['parts_manager', 'parts_specialist']
  UNION ALL SELECT 'dealer', 'admin', 'Finance & Admin', 'Business administration', ARRAY['finance_manager', 'admin']

-- Garage/Shop presets
  UNION ALL SELECT 'garage', 'service', 'Service Bay', 'General vehicle service', ARRAY['shop_manager', 'mechanic', 'apprentice']
  UNION ALL SELECT 'garage', 'body_shop', 'Body Shop', 'Body work and collision repair', ARRAY['body_shop_manager', 'body_technician', 'painter']
  UNION ALL SELECT 'garage', 'detailing', 'Detailing', 'Vehicle detailing and cleaning', ARRAY['detail_manager', 'detailer']
  UNION ALL SELECT 'garage', 'parts', 'Parts Counter', 'Parts sales and inventory', ARRAY['parts_manager', 'counter_staff']

-- Builder presets
  UNION ALL SELECT 'builder', 'custom_build', 'Custom Build Shop', 'Custom vehicle building', ARRAY['master_builder', 'fabricator', 'welder']
  UNION ALL SELECT 'builder', 'paint_body', 'Paint & Body', 'Paint and body work', ARRAY['paint_manager', 'painter', 'body_man']

-- Transporter presets
  UNION ALL SELECT 'transporter', 'transport', 'Transport Operations', 'Vehicle transport and logistics', ARRAY['dispatcher', 'driver', 'coordinator']
) AS v(business_type, department_type, department_name, description, typical_roles)
WHERE NOT EXISTS (
  SELECT 1
  FROM department_presets dp
  WHERE dp.business_type = v.business_type
    AND dp.department_type = v.department_type
    AND dp.department_name = v.department_name
);

-- 8) Admin Action Log table (if not exists)
CREATE TABLE IF NOT EXISTS admin_action_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  target_type TEXT,
  target_id UUID,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_action_log_admin_user ON admin_action_log(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_action_log_created_at ON admin_action_log(created_at);

ALTER TABLE admin_action_log ENABLE ROW LEVEL SECURITY;

-- Admin action log: Only admins can view
DROP POLICY IF EXISTS admin_action_log_select ON admin_action_log;
CREATE POLICY admin_action_log_select ON admin_action_log FOR SELECT
USING (
  EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true)
);
