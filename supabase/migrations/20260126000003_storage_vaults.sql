-- ============================================================================
-- Storage Vaults Migration
-- Phase 6: Storage Vault Integration
--
-- Tables:
--   - storage_vaults: Physical storage facilities
--   - vehicle_storage: Tracking vehicle placement in vaults
--   - storage_fees: Fee calculation and billing
--
-- Functions:
--   - calculate_storage_fees: Monthly fee calculation
--   - allocate_vehicle_to_vault: Assign vehicle to storage
--   - release_vehicle_from_vault: Remove vehicle from storage
-- ============================================================================

-- ============================================================================
-- STORAGE VAULTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS storage_vaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identification
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,

  -- Classification
  facility_type TEXT NOT NULL CHECK (facility_type IN (
    'climate_controlled',
    'covered',
    'outdoor',
    'high_security',
    'museum_grade'
  )),
  security_level INTEGER NOT NULL DEFAULT 3 CHECK (security_level BETWEEN 1 AND 5),

  -- Location
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  postal_code TEXT,
  country TEXT NOT NULL DEFAULT 'USA',
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),

  -- Capacity
  capacity_vehicles INTEGER NOT NULL DEFAULT 50,
  current_occupancy INTEGER NOT NULL DEFAULT 0,

  -- Pricing (in cents)
  base_monthly_rate_cents INTEGER NOT NULL DEFAULT 30000, -- $300/month default
  premium_rate_multiplier DECIMAL(4, 2) DEFAULT 1.0,

  -- Features
  features JSONB DEFAULT '[]'::jsonb,
  -- Example: ["24/7 surveillance", "battery tenders", "detailing", "transport"]

  -- Contact
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,

  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,
  accepting_new_vehicles BOOLEAN NOT NULL DEFAULT true,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_storage_vaults_city ON storage_vaults(city, state);
CREATE INDEX idx_storage_vaults_type ON storage_vaults(facility_type);
CREATE INDEX idx_storage_vaults_active ON storage_vaults(is_active, accepting_new_vehicles);
CREATE INDEX idx_storage_vaults_capacity ON storage_vaults(current_occupancy, capacity_vehicles);

-- ============================================================================
-- VEHICLE STORAGE TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS vehicle_storage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  vault_id UUID NOT NULL REFERENCES storage_vaults(id) ON DELETE RESTRICT,
  offering_id UUID REFERENCES vehicle_offerings(id) ON DELETE SET NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,

  -- Storage Details
  storage_type TEXT NOT NULL DEFAULT 'standard' CHECK (storage_type IN (
    'standard',
    'premium',
    'long_term',
    'consignment'
  )),
  bay_number TEXT, -- Physical location within vault

  -- Dates
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE, -- NULL = ongoing
  last_inspection_date DATE,
  next_inspection_due DATE,

  -- Fees (in cents)
  monthly_rate_cents INTEGER NOT NULL,
  deposit_cents INTEGER DEFAULT 0,
  total_fees_billed_cents INTEGER NOT NULL DEFAULT 0,
  total_fees_paid_cents INTEGER NOT NULL DEFAULT 0,

  -- Vehicle State
  mileage_at_intake INTEGER,
  condition_notes TEXT,
  intake_photos JSONB DEFAULT '[]'::jsonb,

  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
    'pending_intake',
    'active',
    'suspended', -- Non-payment
    'pending_release',
    'released'
  )),

  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT unique_active_storage UNIQUE (vehicle_id, status)
    DEFERRABLE INITIALLY DEFERRED
);

-- Indexes
CREATE INDEX idx_vehicle_storage_vehicle ON vehicle_storage(vehicle_id);
CREATE INDEX idx_vehicle_storage_vault ON vehicle_storage(vault_id);
CREATE INDEX idx_vehicle_storage_owner ON vehicle_storage(owner_id);
CREATE INDEX idx_vehicle_storage_offering ON vehicle_storage(offering_id) WHERE offering_id IS NOT NULL;
CREATE INDEX idx_vehicle_storage_status ON vehicle_storage(status);
CREATE INDEX idx_vehicle_storage_dates ON vehicle_storage(start_date, end_date);

-- ============================================================================
-- STORAGE FEES TABLE
-- Tracks individual billing events
-- ============================================================================

CREATE TABLE IF NOT EXISTS storage_fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  storage_id UUID NOT NULL REFERENCES vehicle_storage(id) ON DELETE CASCADE,

  -- Billing Period
  billing_period_start DATE NOT NULL,
  billing_period_end DATE NOT NULL,

  -- Amounts (in cents)
  base_fee_cents INTEGER NOT NULL,
  adjustments_cents INTEGER DEFAULT 0,
  total_fee_cents INTEGER NOT NULL,

  -- Payment
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'invoiced',
    'paid',
    'overdue',
    'waived'
  )),
  invoice_id TEXT,
  paid_at TIMESTAMPTZ,
  payment_method TEXT,

  -- Details
  notes TEXT,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_storage_fees_storage ON storage_fees(storage_id);
CREATE INDEX idx_storage_fees_period ON storage_fees(billing_period_start, billing_period_end);
CREATE INDEX idx_storage_fees_status ON storage_fees(status);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Calculate storage fees for a billing period
CREATE OR REPLACE FUNCTION calculate_storage_fees(
  p_storage_id UUID,
  p_period_start DATE DEFAULT NULL,
  p_period_end DATE DEFAULT NULL
)
RETURNS TABLE (
  base_fee_cents INTEGER,
  prorated_days INTEGER,
  total_days INTEGER,
  total_fee_cents INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_storage vehicle_storage%ROWTYPE;
  v_period_start DATE;
  v_period_end DATE;
  v_days_in_period INTEGER;
  v_billable_days INTEGER;
BEGIN
  -- Get storage record
  SELECT * INTO v_storage
  FROM vehicle_storage
  WHERE id = p_storage_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Storage record not found';
  END IF;

  -- Default to current month
  v_period_start := COALESCE(p_period_start, DATE_TRUNC('month', CURRENT_DATE)::DATE);
  v_period_end := COALESCE(p_period_end, (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::DATE);

  v_days_in_period := v_period_end - v_period_start + 1;

  -- Calculate billable days (prorate if started mid-period)
  v_billable_days := LEAST(
    v_period_end,
    COALESCE(v_storage.end_date, v_period_end)
  ) - GREATEST(v_period_start, v_storage.start_date) + 1;

  IF v_billable_days <= 0 THEN
    v_billable_days := 0;
  END IF;

  RETURN QUERY
  SELECT
    v_storage.monthly_rate_cents,
    v_billable_days,
    v_days_in_period,
    CASE
      WHEN v_billable_days >= v_days_in_period THEN v_storage.monthly_rate_cents
      ELSE (v_storage.monthly_rate_cents * v_billable_days / v_days_in_period)::INTEGER
    END;
END;
$$;

-- Allocate vehicle to vault
CREATE OR REPLACE FUNCTION allocate_vehicle_to_vault(
  p_vehicle_id UUID,
  p_vault_id UUID,
  p_owner_id UUID,
  p_offering_id UUID DEFAULT NULL,
  p_storage_type TEXT DEFAULT 'standard',
  p_start_date DATE DEFAULT CURRENT_DATE,
  p_mileage INTEGER DEFAULT NULL,
  p_condition_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_vault storage_vaults%ROWTYPE;
  v_existing vehicle_storage%ROWTYPE;
  v_monthly_rate INTEGER;
  v_storage_id UUID;
BEGIN
  -- Get vault
  SELECT * INTO v_vault
  FROM storage_vaults
  WHERE id = p_vault_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Vault not found or inactive'
    );
  END IF;

  -- Check capacity
  IF v_vault.current_occupancy >= v_vault.capacity_vehicles THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Vault at capacity'
    );
  END IF;

  -- Check if vehicle already stored
  SELECT * INTO v_existing
  FROM vehicle_storage
  WHERE vehicle_id = p_vehicle_id AND status IN ('pending_intake', 'active');

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Vehicle already in storage',
      'existing_storage_id', v_existing.id
    );
  END IF;

  -- Calculate rate based on type
  v_monthly_rate := CASE p_storage_type
    WHEN 'premium' THEN (v_vault.base_monthly_rate_cents * 1.5)::INTEGER
    WHEN 'long_term' THEN (v_vault.base_monthly_rate_cents * 0.85)::INTEGER
    WHEN 'consignment' THEN (v_vault.base_monthly_rate_cents * 0.5)::INTEGER
    ELSE v_vault.base_monthly_rate_cents
  END;

  -- Create storage record
  INSERT INTO vehicle_storage (
    vehicle_id,
    vault_id,
    offering_id,
    owner_id,
    storage_type,
    start_date,
    monthly_rate_cents,
    mileage_at_intake,
    condition_notes,
    status
  )
  VALUES (
    p_vehicle_id,
    p_vault_id,
    p_offering_id,
    p_owner_id,
    p_storage_type,
    p_start_date,
    v_monthly_rate,
    p_mileage,
    p_condition_notes,
    'pending_intake'
  )
  RETURNING id INTO v_storage_id;

  -- Update vault occupancy
  UPDATE storage_vaults
  SET current_occupancy = current_occupancy + 1,
      updated_at = NOW()
  WHERE id = p_vault_id;

  RETURN jsonb_build_object(
    'success', true,
    'storage_id', v_storage_id,
    'monthly_rate_cents', v_monthly_rate,
    'vault_name', v_vault.name
  );
END;
$$;

-- Release vehicle from vault
CREATE OR REPLACE FUNCTION release_vehicle_from_vault(
  p_storage_id UUID,
  p_user_id UUID,
  p_release_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_storage vehicle_storage%ROWTYPE;
  v_outstanding_fees INTEGER;
BEGIN
  -- Get storage record
  SELECT * INTO v_storage
  FROM vehicle_storage
  WHERE id = p_storage_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Storage record not found'
    );
  END IF;

  -- Check ownership
  IF v_storage.owner_id != p_user_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Not authorized'
    );
  END IF;

  -- Check status
  IF v_storage.status NOT IN ('active', 'suspended') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Vehicle not in active storage'
    );
  END IF;

  -- Check for outstanding fees
  v_outstanding_fees := v_storage.total_fees_billed_cents - v_storage.total_fees_paid_cents;

  IF v_outstanding_fees > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Outstanding fees must be paid before release',
      'outstanding_cents', v_outstanding_fees
    );
  END IF;

  -- Update storage record
  UPDATE vehicle_storage
  SET status = 'pending_release',
      end_date = p_release_date,
      updated_at = NOW()
  WHERE id = p_storage_id;

  -- Update vault occupancy
  UPDATE storage_vaults
  SET current_occupancy = GREATEST(0, current_occupancy - 1),
      updated_at = NOW()
  WHERE id = v_storage.vault_id;

  RETURN jsonb_build_object(
    'success', true,
    'release_date', p_release_date,
    'final_fees_billed', v_storage.total_fees_billed_cents
  );
END;
$$;

-- Get storage summary for a user
CREATE OR REPLACE FUNCTION get_user_storage_summary(p_user_id UUID)
RETURNS TABLE (
  total_vehicles INTEGER,
  total_monthly_fees INTEGER,
  outstanding_balance INTEGER,
  vaults_used INTEGER,
  vehicles JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::INTEGER as total_vehicles,
    SUM(vs.monthly_rate_cents)::INTEGER as total_monthly_fees,
    SUM(vs.total_fees_billed_cents - vs.total_fees_paid_cents)::INTEGER as outstanding_balance,
    COUNT(DISTINCT vs.vault_id)::INTEGER as vaults_used,
    jsonb_agg(jsonb_build_object(
      'storage_id', vs.id,
      'vehicle_id', vs.vehicle_id,
      'vault_name', sv.name,
      'vault_city', sv.city,
      'status', vs.status,
      'monthly_rate_cents', vs.monthly_rate_cents,
      'start_date', vs.start_date
    )) as vehicles
  FROM vehicle_storage vs
  JOIN storage_vaults sv ON sv.id = vs.vault_id
  WHERE vs.owner_id = p_user_id
    AND vs.status IN ('active', 'suspended', 'pending_intake');
END;
$$;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Update timestamp trigger
CREATE TRIGGER update_storage_vaults_updated_at
  BEFORE UPDATE ON storage_vaults
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vehicle_storage_updated_at
  BEFORE UPDATE ON vehicle_storage
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_storage_fees_updated_at
  BEFORE UPDATE ON storage_fees
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE storage_vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_storage ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_fees ENABLE ROW LEVEL SECURITY;

-- Vaults are publicly readable
CREATE POLICY "Vaults are publicly readable"
  ON storage_vaults FOR SELECT
  USING (is_active = true);

-- Storage records visible to owner
CREATE POLICY "Users can view own storage"
  ON vehicle_storage FOR SELECT
  USING (owner_id = auth.uid());

CREATE POLICY "Users can insert own storage"
  ON vehicle_storage FOR INSERT
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can update own storage"
  ON vehicle_storage FOR UPDATE
  USING (owner_id = auth.uid());

-- Fees visible to storage owner
CREATE POLICY "Users can view own fees"
  ON storage_fees FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM vehicle_storage vs
      WHERE vs.id = storage_fees.storage_id
        AND vs.owner_id = auth.uid()
    )
  );

-- ============================================================================
-- SEED DATA
-- ============================================================================

INSERT INTO storage_vaults (
  name, slug, facility_type, security_level,
  city, state, country,
  capacity_vehicles, base_monthly_rate_cents,
  features, is_active
) VALUES
(
  'Scottsdale Premier Storage',
  'scottsdale-premier',
  'climate_controlled',
  5,
  'Scottsdale', 'AZ', 'USA',
  100, 45000,
  '["Climate controlled", "24/7 surveillance", "Battery tenders", "Concierge service", "Transport available"]'::jsonb,
  true
),
(
  'Los Angeles Collector Vault',
  'la-collector-vault',
  'museum_grade',
  5,
  'Los Angeles', 'CA', 'USA',
  50, 75000,
  '["Museum grade climate control", "White glove service", "Insurance included", "Private viewing rooms", "Photography studio"]'::jsonb,
  true
),
(
  'Miami Exotic Storage',
  'miami-exotic',
  'high_security',
  4,
  'Miami', 'FL', 'USA',
  75, 35000,
  '["Armed security", "Hurricane rated facility", "Detailing services", "Quick access", "Airport pickup"]'::jsonb,
  true
),
(
  'Dallas Covered Storage',
  'dallas-covered',
  'covered',
  3,
  'Dallas', 'TX', 'USA',
  150, 20000,
  '["Covered parking", "Security patrol", "Monthly wash", "Affordable rates"]'::jsonb,
  true
);

COMMENT ON TABLE storage_vaults IS 'Physical storage facilities for vehicles';
COMMENT ON TABLE vehicle_storage IS 'Tracks vehicle placement in storage vaults';
COMMENT ON TABLE storage_fees IS 'Monthly storage fee billing records';
