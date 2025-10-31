-- =====================================================
-- RUN THIS IN SUPABASE SQL EDITOR
-- =====================================================
-- Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql
-- Copy and paste this entire file
-- Click "RUN" to apply all fixes
-- =====================================================

-- =====================================================
-- PART 1: SIMPLE VEHICLE RLS POLICIES
-- =====================================================

-- Drop all existing complex vehicle policies
DROP POLICY IF EXISTS "Public can view all vehicles" ON vehicles;
DROP POLICY IF EXISTS "Authenticated users can create vehicles" ON vehicles;
DROP POLICY IF EXISTS "Users can update their own vehicles" ON vehicles;
DROP POLICY IF EXISTS "Users can delete their own vehicles" ON vehicles;
DROP POLICY IF EXISTS "Owners can update vehicles" ON vehicles;
DROP POLICY IF EXISTS "Contributors can update vehicles" ON vehicles;
DROP POLICY IF EXISTS "Owners can delete vehicles" ON vehicles;
DROP POLICY IF EXISTS "Users can view their own vehicles" ON vehicles;
DROP POLICY IF EXISTS "Users can insert their own vehicles" ON vehicles;
DROP POLICY IF EXISTS "Users can view all vehicles" ON vehicles;

-- Create simple Wikipedia-model policies
CREATE POLICY "Anyone can view vehicles"
  ON vehicles
  FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can create vehicles"
  ON vehicles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Any authenticated user can edit vehicles"
  ON vehicles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Vehicle creators can delete"
  ON vehicles
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id 
    OR auth.uid() = uploaded_by
    OR EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.is_admin = true
    )
  );

ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- FIX: VEHICLE IMAGES RLS (Allow public read)
-- =====================================================

-- Drop restrictive image policies
DROP POLICY IF EXISTS "Users can view their own vehicle images" ON vehicle_images;
DROP POLICY IF EXISTS "Users can insert images for their own vehicles" ON vehicle_images;
DROP POLICY IF EXISTS "Vehicle owners and contributors can insert images" ON vehicle_images;

-- Create simple public read policy
CREATE POLICY "Anyone can view vehicle images"
  ON vehicle_images
  FOR SELECT
  USING (true);

-- Allow authenticated users to upload images
CREATE POLICY "Authenticated users can upload images"
  ON vehicle_images
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Allow image owners to update/delete
CREATE POLICY "Image owners can manage their images"
  ON vehicle_images
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id);

ALTER TABLE vehicle_images ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- PART 2: VEHICLE EDIT AUDIT LOG
-- =====================================================

-- Create audit log table
CREATE TABLE IF NOT EXISTS vehicle_edit_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  editor_id UUID NOT NULL REFERENCES auth.users(id),
  
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  change_type TEXT NOT NULL CHECK (change_type IN ('create', 'update', 'delete')),
  
  edit_reason TEXT,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_vehicle_edit_audit_vehicle ON vehicle_edit_audit(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_edit_audit_editor ON vehicle_edit_audit(editor_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_edit_audit_created ON vehicle_edit_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_edit_audit_field ON vehicle_edit_audit(field_name);

ALTER TABLE vehicle_edit_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view edit history"
  ON vehicle_edit_audit
  FOR SELECT
  USING (true);

CREATE POLICY "System can insert audit records"
  ON vehicle_edit_audit
  FOR INSERT
  WITH CHECK (true);

-- Create trigger to log changes
CREATE OR REPLACE FUNCTION log_vehicle_edit()
RETURNS TRIGGER AS $$
DECLARE
  col TEXT;
  old_val TEXT;
  new_val TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    FOR col IN 
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'vehicles' 
      AND column_name NOT IN ('updated_at', 'id', 'created_at')
    LOOP
      EXECUTE format('SELECT ($1).%I::TEXT, ($2).%I::TEXT', col, col)
        INTO old_val, new_val
        USING OLD, NEW;
      
      IF old_val IS DISTINCT FROM new_val THEN
        INSERT INTO vehicle_edit_audit (
          vehicle_id, editor_id, field_name, old_value, new_value, change_type
        ) VALUES (
          NEW.id, auth.uid(), col, old_val, new_val, 'update'
        );
      END IF;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS vehicle_edit_audit_trigger ON vehicles;
CREATE TRIGGER vehicle_edit_audit_trigger
  AFTER UPDATE ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION log_vehicle_edit();

-- =====================================================
-- PART 3: VEHICLE FUNDS (ETF) SYSTEM
-- =====================================================

-- Fund Definition
CREATE TABLE IF NOT EXISTS vehicle_funds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  symbol TEXT UNIQUE NOT NULL CHECK (LENGTH(symbol) >= 2 AND LENGTH(symbol) <= 6),
  description TEXT,
  fund_rules JSONB DEFAULT '{}',
  created_by UUID NOT NULL REFERENCES auth.users(id),
  manager_id UUID REFERENCES auth.users(id),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'closed', 'liquidating', 'liquidated')),
  total_shares INTEGER NOT NULL DEFAULT 1000000 CHECK (total_shares > 0),
  shares_outstanding INTEGER DEFAULT 0,
  initial_share_price_cents INTEGER NOT NULL CHECK (initial_share_price_cents > 0),
  current_nav_cents BIGINT DEFAULT 0,
  total_vehicles INTEGER DEFAULT 0,
  inception_date TIMESTAMPTZ DEFAULT NOW(),
  is_public BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_funds_symbol ON vehicle_funds(symbol);
CREATE INDEX IF NOT EXISTS idx_vehicle_funds_creator ON vehicle_funds(created_by);

-- Fund Vehicles
CREATE TABLE IF NOT EXISTS fund_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id UUID NOT NULL REFERENCES vehicle_funds(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  ownership_percentage DECIMAL(5,2) NOT NULL CHECK (ownership_percentage > 0 AND ownership_percentage <= 100),
  acquisition_price_cents BIGINT NOT NULL,
  current_value_cents BIGINT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'sold', 'removed')),
  added_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(fund_id, vehicle_id)
);

CREATE INDEX IF NOT EXISTS idx_fund_vehicles_fund ON fund_vehicles(fund_id);
CREATE INDEX IF NOT EXISTS idx_fund_vehicles_vehicle ON fund_vehicles(vehicle_id);

-- Fund Share Holdings
CREATE TABLE IF NOT EXISTS fund_share_holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id UUID NOT NULL REFERENCES vehicle_funds(id) ON DELETE CASCADE,
  holder_id UUID NOT NULL REFERENCES auth.users(id),
  shares_owned INTEGER NOT NULL CHECK (shares_owned > 0),
  average_purchase_price_cents INTEGER NOT NULL,
  total_invested_cents BIGINT NOT NULL,
  current_value_cents BIGINT,
  first_purchase_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(fund_id, holder_id)
);

CREATE INDEX IF NOT EXISTS idx_fund_share_holdings_fund ON fund_share_holdings(fund_id);
CREATE INDEX IF NOT EXISTS idx_fund_share_holdings_holder ON fund_share_holdings(holder_id);

-- RLS for funds
ALTER TABLE vehicle_funds ENABLE ROW LEVEL SECURITY;
ALTER TABLE fund_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE fund_share_holdings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view public funds" ON vehicle_funds FOR SELECT USING (is_public = true);
CREATE POLICY "Authenticated users can create funds" ON vehicle_funds FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "View fund vehicles" ON fund_vehicles FOR SELECT USING (true);
CREATE POLICY "Users view their fund holdings" ON fund_share_holdings FOR SELECT TO authenticated USING (auth.uid() = holder_id);

-- =====================================================
-- SUCCESS MESSAGE
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '✅ ALL MIGRATIONS APPLIED SUCCESSFULLY!';
  RAISE NOTICE '';
  RAISE NOTICE 'Applied:';
  RAISE NOTICE '1. Simplified Vehicle RLS (Wikipedia model)';
  RAISE NOTICE '2. Vehicle Edit Audit Log';
  RAISE NOTICE '3. Vehicle Funds (ETF) System';
  RAISE NOTICE '';
  RAISE NOTICE 'You can now edit any vehicle as an authenticated user.';
  RAISE NOTICE 'All changes are tracked in vehicle_edit_audit table.';
END$$;

