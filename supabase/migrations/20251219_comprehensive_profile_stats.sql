-- ============================================================
-- COMPREHENSIVE PROFILE STATS SYSTEM
-- BaT-style profile data: listings, bids, comments, success stories
-- ============================================================

-- ============================================
-- 1. USER PROFILE STATS (Enhanced)
-- ============================================
-- Add BaT-style stats to profiles table
DO $$
BEGIN
  -- Member since date (first activity)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'member_since'
  ) THEN
    ALTER TABLE profiles ADD COLUMN member_since TIMESTAMPTZ;
  END IF;

  -- BaT-style activity counts
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'total_listings'
  ) THEN
    ALTER TABLE profiles ADD COLUMN total_listings INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'total_bids'
  ) THEN
    ALTER TABLE profiles ADD COLUMN total_bids INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'total_comments'
  ) THEN
    ALTER TABLE profiles ADD COLUMN total_comments INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'total_auction_wins'
  ) THEN
    ALTER TABLE profiles ADD COLUMN total_auction_wins INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'profiles' AND column_name = 'total_success_stories'
  ) THEN
    ALTER TABLE profiles ADD COLUMN total_success_stories INTEGER DEFAULT 0;
  END IF;
END $$;

-- ============================================
-- 2. ORGANIZATION PROFILE STATS
-- ============================================
-- Add BaT-style stats to businesses table
DO $$
BEGIN
  -- Member since date (when org was created/discovered)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'member_since'
  ) THEN
    ALTER TABLE businesses ADD COLUMN member_since TIMESTAMPTZ;
  END IF;

  -- BaT-style activity counts
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'total_listings'
  ) THEN
    ALTER TABLE businesses ADD COLUMN total_listings INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'total_bids'
  ) THEN
    ALTER TABLE businesses ADD COLUMN total_bids INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'total_comments'
  ) THEN
    ALTER TABLE businesses ADD COLUMN total_comments INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'total_auction_wins'
  ) THEN
    ALTER TABLE businesses ADD COLUMN total_auction_wins INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'businesses' AND column_name = 'total_success_stories'
  ) THEN
    ALTER TABLE businesses ADD COLUMN total_success_stories INTEGER DEFAULT 0;
  END IF;
END $$;

-- ============================================
-- 3. ORGANIZATION SERVICES TABLE
-- ============================================
-- Map services organizations offer (from website analysis)
CREATE TABLE IF NOT EXISTS organization_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  
  -- Service Definition
  service_name TEXT NOT NULL,
  service_category TEXT CHECK (service_category IN (
    'consignment_management',
    'professional_detailing',
    'paint_correction',
    'ceramic_coating',
    'light_restoration',
    'mechanical_repair',
    'bodywork',
    'fabrication',
    'indoor_storage',
    'outdoor_storage',
    'transport_coordination',
    'photography',
    'listing_management',
    'inspection_services',
    'auction_services',
    'vehicle_preparation',
    'documentation',
    'appraisal',
    'other'
  )),
  description TEXT,
  
  -- Source tracking (where we learned about this service)
  discovered_from TEXT, -- 'website', 'bat_listing', 'manual', 'ai_analysis'
  source_url TEXT, -- URL where service was found
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Pricing (if available)
  pricing_model TEXT CHECK (pricing_model IN (
    'fixed_price',
    'hourly_rate',
    'percentage',
    'tiered',
    'custom_quote',
    'unknown'
  )),
  base_price DECIMAL(10,2),
  hourly_rate DECIMAL(10,2),
  percentage_rate DECIMAL(5,2),
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  is_verified BOOLEAN DEFAULT false, -- Verified by org owner
  confidence_score INTEGER DEFAULT 50 CHECK (confidence_score >= 0 AND confidence_score <= 100),
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_services_org ON organization_services(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_services_category ON organization_services(service_category);
CREATE INDEX IF NOT EXISTS idx_org_services_active ON organization_services(is_active) WHERE is_active = true;

-- ============================================
-- 4. ORGANIZATION WEBSITE MAPPING
-- ============================================
-- Track website structure and prevent duplicate ingestion
CREATE TABLE IF NOT EXISTS organization_website_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  
  -- Website info
  website_url TEXT NOT NULL,
  base_domain TEXT NOT NULL, -- For duplicate detection
  last_crawled_at TIMESTAMPTZ,
  crawl_status TEXT DEFAULT 'pending' CHECK (crawl_status IN (
    'pending', 'in_progress', 'completed', 'failed', 'skipped'
  )),
  
  -- Structure mapping
  inventory_page_pattern TEXT, -- URL pattern for inventory pages
  vehicle_detail_pattern TEXT, -- URL pattern for vehicle detail pages
  services_page_url TEXT,
  about_page_url TEXT,
  
  -- Duplicate prevention
  known_vehicle_urls TEXT[], -- URLs we've already ingested
  ingestion_checksum TEXT, -- Hash of last ingestion to detect changes
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(organization_id, base_domain)
);

CREATE INDEX IF NOT EXISTS idx_org_website_mappings_org ON organization_website_mappings(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_website_mappings_domain ON organization_website_mappings(base_domain);

-- ============================================
-- 5. SUCCESS STORIES TABLE
-- ============================================
-- Track success stories (BaT-style: buyer/seller testimonials)
CREATE TABLE IF NOT EXISTS success_stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Story participants
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  
  -- Story content
  title TEXT NOT NULL,
  story_text TEXT NOT NULL,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  listing_id UUID, -- Can reference bat_listings or auction_events
  
  -- Story metadata
  story_type TEXT CHECK (story_type IN (
    'auction_win',
    'purchase_success',
    'restoration_complete',
    'service_satisfaction',
    'collection_milestone',
    'other'
  )),
  
  -- Source
  source_platform TEXT, -- 'bat', 'nuke', 'manual'
  source_url TEXT,
  
  -- Engagement
  is_featured BOOLEAN DEFAULT false,
  view_count INTEGER DEFAULT 0,
  
  -- Timestamps
  story_date DATE, -- When the success happened
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_success_stories_user ON success_stories(user_id);
CREATE INDEX IF NOT EXISTS idx_success_stories_org ON success_stories(organization_id);
CREATE INDEX IF NOT EXISTS idx_success_stories_vehicle ON success_stories(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_success_stories_featured ON success_stories(is_featured) WHERE is_featured = true;

-- ============================================
-- 6. FUNCTIONS: Update Profile Stats
-- ============================================

-- Function to update user profile stats from BaT data
CREATE OR REPLACE FUNCTION update_user_profile_stats(p_user_id UUID)
RETURNS void AS $$
DECLARE
  v_listings INTEGER := 0;
  v_bids INTEGER := 0;
  v_comments INTEGER := 0;
  v_wins INTEGER := 0;
  v_stories INTEGER := 0;
  v_member_since TIMESTAMPTZ;
BEGIN
  -- Count listings (from bat_listings where seller matches)
  SELECT COUNT(*) INTO v_listings
  FROM bat_listings bl
  JOIN external_identities ei ON ei.id = bl.seller_external_identity_id
  WHERE ei.claimed_by_user_id = p_user_id;
  
  -- Count bids (from auction_bids or bat_listings where buyer matches)
  SELECT COUNT(*) INTO v_bids
  FROM auction_bids ab
  WHERE ab.bidder_id = p_user_id
  UNION ALL
  SELECT COUNT(*)
  FROM bat_listings bl
  JOIN external_identities ei ON ei.id = bl.buyer_external_identity_id
  WHERE ei.claimed_by_user_id = p_user_id;
  
  -- Count comments (from bat_comments or auction_comments)
  SELECT COUNT(*) INTO v_comments
  FROM bat_comments bc
  JOIN external_identities ei ON ei.id = bc.external_identity_id
  WHERE ei.claimed_by_user_id = p_user_id
  UNION ALL
  SELECT COUNT(*)
  FROM auction_comments ac
  JOIN external_identities ei ON ei.id = ac.external_identity_id
  WHERE ei.claimed_by_user_id = p_user_id;
  
  -- Count auction wins
  SELECT COUNT(*) INTO v_wins
  FROM bat_listings bl
  JOIN external_identities ei ON ei.id = bl.buyer_external_identity_id
  WHERE ei.claimed_by_user_id = p_user_id
    AND bl.listing_status = 'sold';
  
  -- Count success stories
  SELECT COUNT(*) INTO v_stories
  FROM success_stories
  WHERE user_id = p_user_id;
  
  -- Find earliest activity (member since)
  SELECT LEAST(
    (SELECT MIN(created_at) FROM profiles WHERE id = p_user_id),
    (SELECT MIN(first_seen_at) FROM external_identities WHERE claimed_by_user_id = p_user_id),
    (SELECT MIN(created_at) FROM vehicles WHERE user_id = p_user_id)
  ) INTO v_member_since;
  
  -- Update profile
  UPDATE profiles
  SET 
    total_listings = v_listings,
    total_bids = v_bids,
    total_comments = v_comments,
    total_auction_wins = v_wins,
    total_success_stories = v_stories,
    member_since = COALESCE(v_member_since, created_at),
    updated_at = NOW()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update organization profile stats
CREATE OR REPLACE FUNCTION update_organization_profile_stats(p_org_id UUID)
RETURNS void AS $$
DECLARE
  v_listings INTEGER := 0;
  v_bids INTEGER := 0;
  v_comments INTEGER := 0;
  v_wins INTEGER := 0;
  v_stories INTEGER := 0;
  v_member_since TIMESTAMPTZ;
BEGIN
  -- Count listings (from bat_listings or auction_events)
  SELECT COUNT(*) INTO v_listings
  FROM bat_listings
  WHERE organization_id = p_org_id
  UNION ALL
  SELECT COUNT(*)
  FROM auction_events ae
  JOIN organization_vehicles ov ON ov.vehicle_id = ae.vehicle_id
  WHERE ov.organization_id = p_org_id;
  
  -- Count bids (from organization members' bids)
  SELECT COUNT(*) INTO v_bids
  FROM auction_bids ab
  JOIN organization_contributors oc ON oc.user_id = ab.bidder_id
  WHERE oc.organization_id = p_org_id;
  
  -- Count comments (from organization members' comments)
  SELECT COUNT(*) INTO v_comments
  FROM bat_comments bc
  JOIN organization_contributors oc ON oc.user_id = (
    SELECT claimed_by_user_id FROM external_identities WHERE id = bc.external_identity_id
  )
  WHERE oc.organization_id = p_org_id;
  
  -- Count auction wins
  SELECT COUNT(*) INTO v_wins
  FROM bat_listings bl
  WHERE bl.organization_id = p_org_id
    AND bl.listing_status = 'sold';
  
  -- Count success stories
  SELECT COUNT(*) INTO v_stories
  FROM success_stories
  WHERE organization_id = p_org_id;
  
  -- Find earliest activity (member since)
  SELECT LEAST(
    (SELECT MIN(created_at) FROM businesses WHERE id = p_org_id),
    (SELECT MIN(created_at) FROM organization_vehicles WHERE organization_id = p_org_id),
    (SELECT MIN(created_at) FROM bat_listings WHERE organization_id = p_org_id)
  ) INTO v_member_since;
  
  -- Update organization
  UPDATE businesses
  SET 
    total_listings = v_listings,
    total_bids = v_bids,
    total_comments = v_comments,
    total_auction_wins = v_wins,
    total_success_stories = v_stories,
    member_since = COALESCE(v_member_since, created_at),
    updated_at = NOW()
  WHERE id = p_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 7. RLS POLICIES
-- ============================================

ALTER TABLE organization_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_website_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE success_stories ENABLE ROW LEVEL SECURITY;

-- Organization services: public read, org owners can manage
CREATE POLICY "Anyone can view organization services" ON organization_services
  FOR SELECT USING (true);

CREATE POLICY "Organization owners can manage services" ON organization_services
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM business_ownership
      WHERE business_ownership.business_id = organization_services.organization_id
        AND business_ownership.owner_id = auth.uid()
        AND business_ownership.status = 'active'
    )
  );

-- Website mappings: org owners can view/manage
CREATE POLICY "Organization owners can view website mappings" ON organization_website_mappings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM business_ownership
      WHERE business_ownership.business_id = organization_website_mappings.organization_id
        AND business_ownership.owner_id = auth.uid()
        AND business_ownership.status = 'active'
    )
  );

CREATE POLICY "Organization owners can manage website mappings" ON organization_website_mappings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM business_ownership
      WHERE business_ownership.business_id = organization_website_mappings.organization_id
        AND business_ownership.owner_id = auth.uid()
        AND business_ownership.status = 'active'
    )
  );

-- Success stories: public read, users/orgs can create their own
CREATE POLICY "Anyone can view success stories" ON success_stories
  FOR SELECT USING (true);

CREATE POLICY "Users can create their own success stories" ON success_stories
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Organizations can create their success stories" ON success_stories
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM business_ownership
      WHERE business_ownership.business_id = success_stories.organization_id
        AND business_ownership.owner_id = auth.uid()
        AND business_ownership.status = 'active'
    )
  );

-- ============================================
-- 8. COMMENTS
-- ============================================
COMMENT ON COLUMN profiles.member_since IS 'Date when user first became active (earliest activity)';
COMMENT ON COLUMN profiles.total_listings IS 'Total number of listings (BaT-style)';
COMMENT ON COLUMN profiles.total_bids IS 'Total number of bids placed';
COMMENT ON COLUMN profiles.total_comments IS 'Total number of comments made';
COMMENT ON COLUMN profiles.total_auction_wins IS 'Total number of auction wins';
COMMENT ON COLUMN profiles.total_success_stories IS 'Total number of success stories';

COMMENT ON TABLE organization_services IS 'Services offered by organizations (mapped from websites)';
COMMENT ON TABLE organization_website_mappings IS 'Website structure mapping to prevent duplicate ingestion';
COMMENT ON TABLE success_stories IS 'Success stories/testimonials (BaT-style)';

