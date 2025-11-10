-- Organization System Overhaul: Collaborative orgs with tradable stocks/ETFs
-- Mirrors vehicle system: any user contributes/discovers, ownership requires verification, trading enabled
-- HARDENED: idempotent drops, SECURITY DEFINER functions, strict RLS

-- ==========================
-- 1) UNIFIED ORGANIZATIONS TABLE
-- ==========================

-- Add missing fields to businesses table (now the canonical org table)
DO $$ 
BEGIN
  ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 8),
    ADD COLUMN IF NOT EXISTS longitude NUMERIC(11, 8),
    ADD COLUMN IF NOT EXISTS discovered_by UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS logo_url TEXT,
    ADD COLUMN IF NOT EXISTS banner_url TEXT,
    ADD COLUMN IF NOT EXISTS total_vehicles INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_images INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_events INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS current_value NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS is_tradable BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES auth.users(id);
    
  -- stock_symbol needs special handling for UNIQUE constraint
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'stock_symbol'
  ) THEN
    ALTER TABLE businesses ADD COLUMN stock_symbol TEXT;
    CREATE UNIQUE INDEX idx_businesses_stock_symbol_unique ON businesses(stock_symbol) WHERE stock_symbol IS NOT NULL;
  END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_businesses_lat_lng ON businesses(latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_businesses_discovered_by ON businesses(discovered_by);
CREATE INDEX IF NOT EXISTS idx_businesses_stock_symbol ON businesses(stock_symbol) WHERE stock_symbol IS NOT NULL;

COMMENT ON COLUMN businesses.discovered_by IS 'User who discovered/created this org profile (like vehicles)';
COMMENT ON COLUMN businesses.uploaded_by IS 'Alias for discovered_by for consistency with vehicles table';
COMMENT ON COLUMN businesses.latitude IS 'Primary location latitude for GPS-based image tagging';
COMMENT ON COLUMN businesses.longitude IS 'Primary location longitude for GPS-based image tagging';
COMMENT ON COLUMN businesses.is_tradable IS 'Whether org stocks can be traded on platform';
COMMENT ON COLUMN businesses.stock_symbol IS 'Trading symbol (e.g. VIVA, RESTOMOD)';

-- ==========================
-- 2) ORGANIZATION CONTRIBUTORS
-- ==========================

CREATE TABLE IF NOT EXISTS organization_contributors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN (
    'owner', 'co_founder', 'board_member', 'manager', 'employee', 
    'technician', 'moderator', 'contributor', 'photographer', 'historian'
  )),
  start_date DATE DEFAULT CURRENT_DATE,
  end_date DATE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
  contribution_count INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Guarded unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'organization_contributors_organization_id_user_id_key'
  ) THEN
    ALTER TABLE organization_contributors ADD CONSTRAINT organization_contributors_organization_id_user_id_key UNIQUE (organization_id, user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_org_contributors_org ON organization_contributors(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_contributors_user ON organization_contributors(user_id);

COMMENT ON TABLE organization_contributors IS 'Like vehicle_contributors: tracks all users who contribute to an org profile';

-- ==========================
-- 3) ORGANIZATION OWNERSHIP VERIFICATION
-- ==========================

CREATE TABLE IF NOT EXISTS organization_ownership_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  verification_type TEXT NOT NULL CHECK (verification_type IN (
    'business_license', 'tax_id', 'articles_incorporation', 
    'dba_certificate', 'lease_agreement', 'utility_bill'
  )),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'documents_uploaded', 'ai_processing', 'human_review', 
    'approved', 'rejected', 'expired'
  )),
  document_url TEXT NOT NULL,
  supporting_documents JSONB DEFAULT '[]'::JSONB,
  extracted_data JSONB DEFAULT '{}'::JSONB,
  ai_confidence_score NUMERIC(4,2) CHECK (ai_confidence_score >= 0.00 AND ai_confidence_score <= 1.00),
  human_reviewer_id UUID REFERENCES auth.users(id),
  human_review_notes TEXT,
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  ai_processed_at TIMESTAMPTZ,
  human_reviewed_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '90 days'),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Partial unique index for one active verification per user/org
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_org_ownership_unique_active') THEN
    CREATE UNIQUE INDEX idx_org_ownership_unique_active 
      ON organization_ownership_verifications(user_id, organization_id, status)
      WHERE status IN ('pending', 'approved');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_org_ownership_org ON organization_ownership_verifications(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_ownership_user ON organization_ownership_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_org_ownership_status ON organization_ownership_verifications(status) WHERE status IN ('pending', 'human_review');

COMMENT ON TABLE organization_ownership_verifications IS 'Like ownership_verifications for vehicles: doc-based org ownership claims';

-- ==========================
-- 4) ORGANIZATION TIMELINE EVENTS
-- ==========================

-- Enhance business_timeline_events if exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_timeline_events') THEN
    ALTER TABLE business_timeline_events
      ADD COLUMN IF NOT EXISTS image_urls TEXT[] DEFAULT ARRAY[]::TEXT[],
      ADD COLUMN IF NOT EXISTS labor_hours NUMERIC(6,2),
      ADD COLUMN IF NOT EXISTS confidence_score INTEGER DEFAULT 50 CHECK (confidence_score >= 0 AND confidence_score <= 100);
      
    COMMENT ON COLUMN business_timeline_events.image_urls IS 'Photo evidence for this event (like timeline_events.image_urls)';
  END IF;
END $$;

-- ==========================
-- 5) ORGANIZATION IMAGES
-- ==========================

CREATE TABLE IF NOT EXISTS organization_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  image_url TEXT NOT NULL,
  thumbnail_url TEXT,
  medium_url TEXT,
  large_url TEXT,
  taken_at TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  caption TEXT,
  is_primary BOOLEAN DEFAULT false,
  category TEXT CHECK (category IN ('facility', 'equipment', 'team', 'work', 'event', 'logo', 'general')),
  exif_data JSONB,
  latitude NUMERIC(10,8),
  longitude NUMERIC(11,8),
  location_name TEXT,
  timeline_event_id UUID, -- forward reference, constraint added later if needed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add FK constraint if business_timeline_events exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_timeline_events') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'organization_images_timeline_event_id_fkey'
    ) THEN
      ALTER TABLE organization_images 
        ADD CONSTRAINT organization_images_timeline_event_id_fkey 
        FOREIGN KEY (timeline_event_id) REFERENCES business_timeline_events(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_org_images_org ON organization_images(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_images_user ON organization_images(user_id);
CREATE INDEX IF NOT EXISTS idx_org_images_gps ON organization_images(latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

COMMENT ON TABLE organization_images IS 'Like vehicle_images: photo uploads tied to orgs with GPS for auto-tagging';

-- ==========================
-- 6) ORGANIZATION <-> VEHICLE ASSOCIATIONS
-- ==========================

CREATE TABLE IF NOT EXISTS organization_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL CHECK (relationship_type IN (
    'owner', 'consigner', 'service_provider', 'work_location', 
    'seller', 'buyer', 'parts_supplier', 'fabricator', 'painter',
    'upholstery', 'transport', 'storage', 'inspector', 'collaborator'
  )),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'past', 'pending')),
  start_date DATE,
  end_date DATE,
  linked_by_user_id UUID REFERENCES auth.users(id),
  auto_tagged BOOLEAN DEFAULT false,
  gps_match_confidence NUMERIC(4,2),
  receipt_match_count INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Guarded unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'organization_vehicles_organization_id_vehicle_id_relations_key'
  ) THEN
    ALTER TABLE organization_vehicles ADD CONSTRAINT organization_vehicles_organization_id_vehicle_id_relations_key UNIQUE (organization_id, vehicle_id, relationship_type);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_org_vehicles_org ON organization_vehicles(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_vehicles_vehicle ON organization_vehicles(vehicle_id);

COMMENT ON TABLE organization_vehicles IS 'Many-to-many: vehicles can associate with multiple orgs (owner, shop, etc.)';
COMMENT ON COLUMN organization_vehicles.auto_tagged IS 'True if linked automatically via GPS/receipt matching';

-- ==========================
-- 7) ORGANIZATION TRADING SYSTEM (Stocks/ETFs)
-- ==========================

-- Organization offerings (like vehicle_offerings)
CREATE TABLE IF NOT EXISTS organization_offerings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  offering_type TEXT NOT NULL DEFAULT 'stock' CHECK (offering_type IN ('stock', 'etf', 'fund')),
  issuer_id UUID NOT NULL REFERENCES auth.users(id),
  stock_symbol TEXT NOT NULL,
  total_shares INTEGER NOT NULL DEFAULT 10000,
  initial_share_price NUMERIC(12,4) NOT NULL,
  current_share_price NUMERIC(12,4) NOT NULL,
  opening_price NUMERIC(12,4),
  closing_price NUMERIC(12,4),
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'scheduled', 'active', 'trading', 'suspended', 'delisted'
  )),
  scheduled_start_time TIMESTAMPTZ,
  actual_start_time TIMESTAMPTZ,
  total_trades INTEGER DEFAULT 0,
  total_volume_shares INTEGER DEFAULT 0,
  total_volume_usd NUMERIC(12,2) DEFAULT 0,
  highest_bid NUMERIC(12,4),
  lowest_ask NUMERIC(12,4),
  bid_ask_spread NUMERIC(12,4),
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Guarded unique constraint for stock_symbol
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'organization_offerings_stock_symbol_key'
  ) THEN
    ALTER TABLE organization_offerings ADD CONSTRAINT organization_offerings_stock_symbol_key UNIQUE (stock_symbol);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_org_offerings_org ON organization_offerings(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_offerings_symbol ON organization_offerings(stock_symbol);
CREATE INDEX IF NOT EXISTS idx_org_offerings_status ON organization_offerings(status) WHERE status = 'active';

COMMENT ON TABLE organization_offerings IS 'Tradable org stocks/ETFs (like vehicle_offerings for shares)';

-- Organization share holdings
CREATE TABLE IF NOT EXISTS organization_share_holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id UUID NOT NULL REFERENCES organization_offerings(id) ON DELETE CASCADE,
  holder_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shares_owned INTEGER NOT NULL CHECK (shares_owned > 0),
  entry_price NUMERIC(12,4) NOT NULL,
  entry_date TIMESTAMPTZ DEFAULT NOW(),
  current_mark NUMERIC(12,4) NOT NULL,
  unrealized_gain_loss NUMERIC(12,2),
  unrealized_gain_loss_pct NUMERIC(6,2),
  total_bought INTEGER DEFAULT 0,
  total_sold INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'organization_share_holdings_offering_id_holder_id_key'
  ) THEN
    ALTER TABLE organization_share_holdings ADD CONSTRAINT organization_share_holdings_offering_id_holder_id_key UNIQUE (offering_id, holder_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_org_holdings_holder ON organization_share_holdings(holder_id);
CREATE INDEX IF NOT EXISTS idx_org_holdings_offering ON organization_share_holdings(offering_id);

COMMENT ON TABLE organization_share_holdings IS 'User ownership of org stocks (like share_holdings)';

-- Organization market orders
CREATE TABLE IF NOT EXISTS organization_market_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id UUID NOT NULL REFERENCES organization_offerings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_type TEXT NOT NULL CHECK (order_type IN ('buy', 'sell')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
    'pending', 'active', 'partially_filled', 'filled', 'cancelled', 'rejected'
  )),
  shares_requested INTEGER NOT NULL CHECK (shares_requested > 0),
  shares_filled INTEGER DEFAULT 0,
  price_per_share NUMERIC(12,4) NOT NULL,
  total_value NUMERIC(12,2) NOT NULL,
  time_in_force TEXT DEFAULT 'day' CHECK (time_in_force IN ('day', 'gtc', 'fok', 'ioc')),
  first_fill_time TIMESTAMPTZ,
  last_fill_time TIMESTAMPTZ,
  average_fill_price NUMERIC(12,4),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_orders_offering ON organization_market_orders(offering_id);
CREATE INDEX IF NOT EXISTS idx_org_orders_user ON organization_market_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_org_orders_active ON organization_market_orders(status) WHERE status IN ('active', 'partially_filled');

-- Organization trades
CREATE TABLE IF NOT EXISTS organization_market_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_id UUID NOT NULL REFERENCES organization_offerings(id) ON DELETE CASCADE,
  buyer_id UUID NOT NULL REFERENCES auth.users(id),
  seller_id UUID NOT NULL REFERENCES auth.users(id),
  shares_traded INTEGER NOT NULL CHECK (shares_traded > 0),
  price_per_share NUMERIC(12,4) NOT NULL,
  total_value NUMERIC(12,2) NOT NULL,
  buy_order_id UUID REFERENCES organization_market_orders(id),
  sell_order_id UUID REFERENCES organization_market_orders(id),
  nuke_commission_pct NUMERIC(4,2) DEFAULT 2.0,
  nuke_commission_amount NUMERIC(12,2),
  trade_type TEXT CHECK (trade_type IN ('market', 'limit', 'opening', 'closing')),
  executed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_trades_offering ON organization_market_trades(offering_id);
CREATE INDEX IF NOT EXISTS idx_org_trades_buyer ON organization_market_trades(buyer_id);
CREATE INDEX IF NOT EXISTS idx_org_trades_seller ON organization_market_trades(seller_id);
CREATE INDEX IF NOT EXISTS idx_org_trades_time ON organization_market_trades(executed_at);

-- ==========================
-- 8) ORGANIZATION ETFs
-- ==========================

CREATE TABLE IF NOT EXISTS organization_etf_holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  etf_offering_id UUID NOT NULL REFERENCES organization_offerings(id) ON DELETE CASCADE,
  underlying_organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  allocation_pct NUMERIC(5,2) NOT NULL CHECK (allocation_pct > 0 AND allocation_pct <= 100),
  locked_shares INTEGER,
  target_weight NUMERIC(5,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'organization_etf_holdings_etf_offering_id_underlying_orga_key'
  ) THEN
    ALTER TABLE organization_etf_holdings ADD CONSTRAINT organization_etf_holdings_etf_offering_id_underlying_orga_key UNIQUE (etf_offering_id, underlying_organization_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_etf_holdings_etf ON organization_etf_holdings(etf_offering_id);

COMMENT ON TABLE organization_etf_holdings IS 'ETF composition: defines which orgs are in a basket ETF';

-- ==========================
-- 9) GPS-BASED AUTO-TAGGING
-- ==========================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS postgis;

-- Function to auto-tag org when image GPS matches org location
DROP FUNCTION IF EXISTS auto_tag_organization_from_gps() CASCADE;
CREATE OR REPLACE FUNCTION auto_tag_organization_from_gps()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  nearby_org RECORD;
  distance_km NUMERIC;
BEGIN
  -- Only process if image has GPS
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    
    -- Find orgs within 500m (0.5km)
    FOR nearby_org IN
      SELECT 
        id,
        business_name,
        latitude,
        longitude,
        ST_Distance(
          ST_MakePoint(longitude, latitude)::geography,
          ST_MakePoint(NEW.longitude, NEW.latitude)::geography
        ) / 1000.0 AS dist_km
      FROM businesses
      WHERE latitude IS NOT NULL 
        AND longitude IS NOT NULL
        AND ST_DWithin(
          ST_MakePoint(longitude, latitude)::geography,
          ST_MakePoint(NEW.longitude, NEW.latitude)::geography,
          500  -- 500 meters
        )
      ORDER BY dist_km ASC
      LIMIT 1
    LOOP
      
      -- Create/update org-vehicle link
      INSERT INTO organization_vehicles (
        organization_id,
        vehicle_id,
        relationship_type,
        auto_tagged,
        gps_match_confidence,
        linked_by_user_id
      )
      VALUES (
        nearby_org.id,
        NEW.vehicle_id,
        'work_location',
        true,
        GREATEST(0, LEAST(100, (1 - (nearby_org.dist_km / 0.5)) * 100)),
        NEW.user_id
      )
      ON CONFLICT (organization_id, vehicle_id, relationship_type) 
      DO UPDATE SET
        gps_match_confidence = GREATEST(
          organization_vehicles.gps_match_confidence,
          GREATEST(0, LEAST(100, (1 - (nearby_org.dist_km / 0.5)) * 100))
        ),
        auto_tagged = true,
        updated_at = NOW();
      
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger on vehicle_images for GPS-based org tagging
DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_auto_tag_org_from_gps ON vehicle_images;
  CREATE TRIGGER trg_auto_tag_org_from_gps
    AFTER INSERT OR UPDATE OF latitude, longitude
    ON vehicle_images
    FOR EACH ROW
    WHEN (NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL)
    EXECUTE FUNCTION auto_tag_organization_from_gps();
END $$;

-- Also trigger on organization_images
DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_auto_tag_org_from_org_image ON organization_images;
  CREATE TRIGGER trg_auto_tag_org_from_org_image
    AFTER INSERT OR UPDATE OF latitude, longitude
    ON organization_images
    FOR EACH ROW
    WHEN (NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL)
    EXECUTE FUNCTION auto_tag_organization_from_gps();
END $$;

-- ==========================
-- 10) RECEIPT-BASED ORG TAGGING
-- ==========================

-- Function to auto-tag org when vendor name matches
DROP FUNCTION IF EXISTS auto_tag_organization_from_receipt() CASCADE;
CREATE OR REPLACE FUNCTION auto_tag_organization_from_receipt()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  matched_org RECORD;
  similarity_score NUMERIC;
BEGIN
  -- Only process if vendor_name exists
  IF NEW.vendor_name IS NOT NULL AND LENGTH(NEW.vendor_name) > 3 THEN
    
    -- Find org with matching business name (fuzzy match)
    SELECT 
      id,
      business_name,
      similarity(LOWER(business_name), LOWER(NEW.vendor_name)) AS sim_score
    INTO matched_org
    FROM businesses
    WHERE similarity(LOWER(business_name), LOWER(NEW.vendor_name)) > 0.5
    ORDER BY sim_score DESC
    LIMIT 1;
    
    IF matched_org.id IS NOT NULL THEN
      -- Link org to vehicle
      INSERT INTO organization_vehicles (
        organization_id,
        vehicle_id,
        relationship_type,
        auto_tagged,
        receipt_match_count,
        linked_by_user_id
      )
      VALUES (
        matched_org.id,
        NEW.vehicle_id,
        'service_provider',
        true,
        1,
        NEW.uploaded_by
      )
      ON CONFLICT (organization_id, vehicle_id, relationship_type)
      DO UPDATE SET
        receipt_match_count = organization_vehicles.receipt_match_count + 1,
        auto_tagged = true,
        updated_at = NOW();
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger on vehicle_documents for receipt-based org tagging
DO $$
BEGIN
  DROP TRIGGER IF EXISTS trg_auto_tag_org_from_receipt ON vehicle_documents;
  CREATE TRIGGER trg_auto_tag_org_from_receipt
    AFTER INSERT OR UPDATE OF vendor_name
    ON vehicle_documents
    FOR EACH ROW
    WHEN (NEW.vendor_name IS NOT NULL AND NEW.vehicle_id IS NOT NULL)
    EXECUTE FUNCTION auto_tag_organization_from_receipt();
EXCEPTION
  WHEN undefined_table THEN
    -- vehicle_documents doesn't exist yet, skip trigger
    NULL;
END $$;

-- ==========================
-- 11) RLS POLICIES
-- ==========================

-- Organizations: public read, owner/contributors can edit
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Anyone views public orgs" ON businesses;
  CREATE POLICY "Anyone views public orgs" ON businesses
    FOR SELECT
    USING (is_public = true);

  DROP POLICY IF EXISTS "Users create orgs" ON businesses;
  CREATE POLICY "Users create orgs" ON businesses
    FOR INSERT
    WITH CHECK (auth.uid() = discovered_by OR auth.uid() = uploaded_by);

  DROP POLICY IF EXISTS "Owners/contributors update orgs" ON businesses;
  CREATE POLICY "Owners/contributors update orgs" ON businesses
    FOR UPDATE
    USING (
      auth.uid() = discovered_by OR 
      EXISTS (
        SELECT 1 FROM organization_contributors oc
        WHERE oc.organization_id = businesses.id 
          AND oc.user_id = auth.uid() 
          AND oc.status = 'active'
          AND oc.role IN ('owner', 'co_founder', 'board_member', 'manager')
      ) OR
      EXISTS (
        SELECT 1 FROM organization_ownership_verifications oov
        WHERE oov.organization_id = businesses.id
          AND oov.user_id = auth.uid()
          AND oov.status = 'approved'
      )
    );
END $$;

-- Contributors
ALTER TABLE organization_contributors ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Anyone views org contributors" ON organization_contributors;
  CREATE POLICY "Anyone views org contributors" ON organization_contributors
    FOR SELECT
    USING (true);

  DROP POLICY IF EXISTS "Owners manage contributors" ON organization_contributors;
  CREATE POLICY "Owners manage contributors" ON organization_contributors
    FOR ALL
    USING (
      user_id = auth.uid() OR
      EXISTS (
        SELECT 1 FROM organization_contributors oc
        WHERE oc.organization_id = organization_contributors.organization_id
          AND oc.user_id = auth.uid()
          AND oc.role IN ('owner', 'co_founder', 'board_member')
      )
    );
END $$;

-- Ownership verifications
ALTER TABLE organization_ownership_verifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Users view own org verifications" ON organization_ownership_verifications;
  CREATE POLICY "Users view own org verifications" ON organization_ownership_verifications
    FOR SELECT
    USING (user_id = auth.uid());

  DROP POLICY IF EXISTS "Users submit org ownership claims" ON organization_ownership_verifications;
  CREATE POLICY "Users submit org ownership claims" ON organization_ownership_verifications
    FOR INSERT
    WITH CHECK (user_id = auth.uid());

  DROP POLICY IF EXISTS "Service role manages org verifications" ON organization_ownership_verifications;
  CREATE POLICY "Service role manages org verifications" ON organization_ownership_verifications
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
END $$;

-- Images
ALTER TABLE organization_images ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Anyone views org images" ON organization_images;
  CREATE POLICY "Anyone views org images" ON organization_images
    FOR SELECT
    USING (true);

  DROP POLICY IF EXISTS "Users upload org images" ON organization_images;
  CREATE POLICY "Users upload org images" ON organization_images
    FOR INSERT
    WITH CHECK (user_id = auth.uid());
END $$;

-- Org-vehicle links
ALTER TABLE organization_vehicles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Anyone views org-vehicle links" ON organization_vehicles;
  CREATE POLICY "Anyone views org-vehicle links" ON organization_vehicles
    FOR SELECT
    USING (true);

  DROP POLICY IF EXISTS "Users/owners manage links" ON organization_vehicles;
  CREATE POLICY "Users/owners manage links" ON organization_vehicles
    FOR ALL
    USING (
      linked_by_user_id = auth.uid() OR
      EXISTS (
        SELECT 1 FROM vehicles v
        WHERE v.id = organization_vehicles.vehicle_id
          AND v.user_id = auth.uid()
      ) OR
      EXISTS (
        SELECT 1 FROM organization_contributors oc
        WHERE oc.organization_id = organization_vehicles.organization_id
          AND oc.user_id = auth.uid()
          AND oc.role IN ('owner', 'manager')
      )
    );
END $$;

-- Trading tables
ALTER TABLE organization_offerings ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_share_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_market_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_market_trades ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Anyone views org offerings" ON organization_offerings;
  CREATE POLICY "Anyone views org offerings" ON organization_offerings FOR SELECT USING (true);

  DROP POLICY IF EXISTS "Users view own org holdings" ON organization_share_holdings;
  CREATE POLICY "Users view own org holdings" ON organization_share_holdings FOR SELECT USING (holder_id = auth.uid());

  DROP POLICY IF EXISTS "Users view own org orders" ON organization_market_orders;
  CREATE POLICY "Users view own org orders" ON organization_market_orders FOR SELECT USING (user_id = auth.uid());

  DROP POLICY IF EXISTS "Users insert own org orders" ON organization_market_orders;
  CREATE POLICY "Users insert own org orders" ON organization_market_orders FOR INSERT WITH CHECK (user_id = auth.uid());

  DROP POLICY IF EXISTS "Users update own org orders" ON organization_market_orders;
  CREATE POLICY "Users update own org orders" ON organization_market_orders FOR UPDATE USING (user_id = auth.uid());

  DROP POLICY IF EXISTS "Anyone views org trades" ON organization_market_trades;
  CREATE POLICY "Anyone views org trades" ON organization_market_trades FOR SELECT USING (true);
END $$;

-- ETF holdings
ALTER TABLE organization_etf_holdings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "Anyone views ETF composition" ON organization_etf_holdings;
  CREATE POLICY "Anyone views ETF composition" ON organization_etf_holdings FOR SELECT USING (true);
END $$;

-- ==========================
-- 12) UPDATE COUNTERS ON ORG PROFILE
-- ==========================

-- Trigger to update org stats when events/images/vehicles added
DROP FUNCTION IF EXISTS update_organization_stats() CASCADE;
CREATE OR REPLACE FUNCTION update_organization_stats()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE businesses
  SET
    total_events = (
      SELECT COUNT(*) FROM business_timeline_events
      WHERE business_id = COALESCE(NEW.business_id, NEW.organization_id)
    ),
    total_images = (
      SELECT COUNT(*) FROM organization_images
      WHERE organization_id = COALESCE(NEW.business_id, NEW.organization_id)
    ),
    total_vehicles = (
      SELECT COUNT(DISTINCT vehicle_id) FROM organization_vehicles
      WHERE organization_id = COALESCE(NEW.business_id, NEW.organization_id)
        AND status = 'active'
    ),
    updated_at = NOW()
  WHERE id = COALESCE(NEW.business_id, NEW.organization_id);
  
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  -- Only create triggers if business_timeline_events exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_timeline_events') THEN
    DROP TRIGGER IF EXISTS trg_update_org_stats_events ON business_timeline_events;
    CREATE TRIGGER trg_update_org_stats_events
      AFTER INSERT OR DELETE ON business_timeline_events
      FOR EACH ROW
      EXECUTE FUNCTION update_organization_stats();
  END IF;

  DROP TRIGGER IF EXISTS trg_update_org_stats_images ON organization_images;
  CREATE TRIGGER trg_update_org_stats_images
    AFTER INSERT OR DELETE ON organization_images
    FOR EACH ROW
    EXECUTE FUNCTION update_organization_stats();

  DROP TRIGGER IF EXISTS trg_update_org_stats_vehicles ON organization_vehicles;
  CREATE TRIGGER trg_update_org_stats_vehicles
    AFTER INSERT OR UPDATE OF status OR DELETE ON organization_vehicles
    FOR EACH ROW
    EXECUTE FUNCTION update_organization_stats();
END $$;
