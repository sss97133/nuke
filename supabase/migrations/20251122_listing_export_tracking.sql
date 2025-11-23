-- Listing Export Tracking
-- Tracks when vehicles are prepared for and submitted to external platforms
-- Helps users manage multi-platform listings and measure conversion rates

-- =====================================================
-- LISTING EXPORTS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS listing_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Platform information
  platform TEXT NOT NULL CHECK (platform IN (
    'nzero', 'bat', 'ebay', 'craigslist', 'carscom', 'facebook', 'autotrader', 'other'
  )),
  
  -- Export details
  export_format TEXT NOT NULL CHECK (export_format IN ('json', 'csv', 'html', 'text')),
  title TEXT NOT NULL,
  description TEXT,
  asking_price_cents BIGINT,
  reserve_price_cents BIGINT,
  
  -- Image tracking
  exported_images JSONB DEFAULT '[]'::jsonb,
  image_count INTEGER DEFAULT 0,
  
  -- Status tracking
  status TEXT DEFAULT 'prepared' CHECK (status IN (
    'prepared',      -- Export package created, not yet submitted
    'submitted',     -- Submitted to platform
    'active',        -- Listing is live on platform
    'sold',          -- Vehicle sold through this platform
    'expired',       -- Listing expired without sale
    'cancelled'      -- Listing cancelled by user
  )),
  
  -- External platform data
  external_listing_url TEXT,
  external_listing_id TEXT,
  
  -- Submission tracking
  submitted_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  
  -- Sale tracking (if sold via external platform)
  sold_price_cents BIGINT,
  sold_at TIMESTAMPTZ,
  commission_cents BIGINT,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_listing_exports_vehicle ON listing_exports(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_listing_exports_user ON listing_exports(user_id);
CREATE INDEX IF NOT EXISTS idx_listing_exports_platform ON listing_exports(platform);
CREATE INDEX IF NOT EXISTS idx_listing_exports_status ON listing_exports(status);
CREATE INDEX IF NOT EXISTS idx_listing_exports_created ON listing_exports(created_at DESC);

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_listing_exports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_listing_exports_updated_at ON listing_exports;
CREATE TRIGGER update_listing_exports_updated_at
  BEFORE UPDATE ON listing_exports
  FOR EACH ROW
  EXECUTE FUNCTION update_listing_exports_updated_at();

-- =====================================================
-- PLATFORM SUBMISSION TEMPLATES TABLE
-- =====================================================
-- Stores reusable templates for different platforms

CREATE TABLE IF NOT EXISTS platform_submission_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Template details
  name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN (
    'nzero', 'bat', 'ebay', 'craigslist', 'carscom', 'facebook', 'autotrader', 'other'
  )),
  
  -- Template content
  title_template TEXT,
  description_template TEXT,
  
  -- Default settings
  default_auction_duration_days INTEGER,
  default_listing_fee_cents BIGINT,
  default_commission_percent DECIMAL(5,2),
  
  -- Image selection rules
  max_images INTEGER,
  preferred_image_tags JSONB DEFAULT '[]'::jsonb,
  
  -- Metadata
  is_public BOOLEAN DEFAULT FALSE,
  use_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(user_id, name, platform)
);

CREATE INDEX IF NOT EXISTS idx_templates_user ON platform_submission_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_templates_platform ON platform_submission_templates(platform);
CREATE INDEX IF NOT EXISTS idx_templates_public ON platform_submission_templates(is_public) WHERE is_public = TRUE;

-- =====================================================
-- RLS POLICIES
-- =====================================================

ALTER TABLE listing_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_submission_templates ENABLE ROW LEVEL SECURITY;

-- Users can view their own exports
CREATE POLICY "view_own_exports" ON listing_exports
  FOR SELECT USING (user_id = auth.uid());

-- Users can create their own exports
CREATE POLICY "create_own_exports" ON listing_exports
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Users can update their own exports
CREATE POLICY "update_own_exports" ON listing_exports
  FOR UPDATE USING (user_id = auth.uid());

-- Users can delete their own exports
CREATE POLICY "delete_own_exports" ON listing_exports
  FOR DELETE USING (user_id = auth.uid());

-- Templates policies
CREATE POLICY "view_templates" ON platform_submission_templates
  FOR SELECT USING (user_id = auth.uid() OR is_public = TRUE);

CREATE POLICY "create_own_templates" ON platform_submission_templates
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "update_own_templates" ON platform_submission_templates
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "delete_own_templates" ON platform_submission_templates
  FOR DELETE USING (user_id = auth.uid());

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Get export analytics for a user
CREATE OR REPLACE FUNCTION get_export_analytics(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_exports', COUNT(*),
    'by_platform', jsonb_object_agg(platform, platform_count),
    'by_status', jsonb_object_agg(status, status_count),
    'total_sold', SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END),
    'total_revenue_cents', SUM(CASE WHEN status = 'sold' THEN sold_price_cents ELSE 0 END),
    'total_commission_cents', SUM(CASE WHEN commission_cents IS NOT NULL THEN commission_cents ELSE 0 END),
    'conversion_rate', ROUND(
      (SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END)::DECIMAL / NULLIF(COUNT(*), 0)) * 100,
      2
    )
  )
  INTO v_result
  FROM (
    SELECT 
      platform,
      status,
      sold_price_cents,
      commission_cents,
      COUNT(*) OVER (PARTITION BY platform) as platform_count,
      COUNT(*) OVER (PARTITION BY status) as status_count
    FROM listing_exports
    WHERE user_id = p_user_id
  ) exports;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_export_analytics(UUID) TO authenticated;

-- Get vehicle's export history
CREATE OR REPLACE FUNCTION get_vehicle_export_history(p_vehicle_id UUID)
RETURNS TABLE (
  platform TEXT,
  status TEXT,
  asking_price_cents BIGINT,
  sold_price_cents BIGINT,
  external_listing_url TEXT,
  submitted_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    le.platform,
    le.status,
    le.asking_price_cents,
    le.sold_price_cents,
    le.external_listing_url,
    le.submitted_at,
    le.ended_at
  FROM listing_exports le
  WHERE le.vehicle_id = p_vehicle_id
  ORDER BY le.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_vehicle_export_history(UUID) TO authenticated;

COMMENT ON TABLE listing_exports IS 'Tracks vehicle listings prepared for and submitted to external platforms';
COMMENT ON TABLE platform_submission_templates IS 'Reusable templates for preparing listings for specific platforms';
COMMENT ON FUNCTION get_export_analytics IS 'Get export statistics and conversion rates for a user';
COMMENT ON FUNCTION get_vehicle_export_history IS 'Get all export attempts for a specific vehicle';

