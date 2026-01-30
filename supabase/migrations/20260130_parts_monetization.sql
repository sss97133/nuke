-- =====================================================
-- PARTS MONETIZATION SYSTEM
-- Affiliate programs, click tracking, sponsored placements
-- =====================================================

-- 1. AFFILIATE PROGRAMS - Configuration per source
CREATE TABLE IF NOT EXISTS affiliate_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name TEXT NOT NULL UNIQUE,
  affiliate_id TEXT,
  campaign_id TEXT,
  commission_rate DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  url_template TEXT NOT NULL,
  api_endpoint TEXT,
  api_key_encrypted TEXT,
  is_active BOOLEAN DEFAULT true,
  cookie_duration_days INTEGER DEFAULT 30,
  min_payout_cents INTEGER DEFAULT 5000,
  payment_terms TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE affiliate_programs IS 'Affiliate program configuration for each parts source';
COMMENT ON COLUMN affiliate_programs.url_template IS 'URL template with placeholders: {url}, {affiliate_id}, {campaign_id}';

-- 2. AFFILIATE CLICKS - Track clicks for attribution
CREATE TABLE IF NOT EXISTS affiliate_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  part_id UUID,  -- References part_catalog if applicable
  source_id UUID REFERENCES affiliate_programs(id) ON DELETE SET NULL,
  issue_pattern TEXT,
  sponsored_placement_id UUID,

  -- Click details
  destination_url TEXT NOT NULL,
  affiliate_url TEXT NOT NULL,
  referrer_url TEXT,

  -- Session tracking
  session_id TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  device_type TEXT CHECK (device_type IN ('desktop', 'mobile', 'tablet', 'unknown')),

  -- Conversion tracking
  click_id TEXT UNIQUE,
  converted BOOLEAN DEFAULT false,
  conversion_value_cents INTEGER,
  conversion_at TIMESTAMPTZ,
  commission_cents INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_affiliate_clicks_user ON affiliate_clicks(user_id, created_at DESC);
CREATE INDEX idx_affiliate_clicks_source ON affiliate_clicks(source_id, created_at DESC);
CREATE INDEX idx_affiliate_clicks_sponsored ON affiliate_clicks(sponsored_placement_id) WHERE sponsored_placement_id IS NOT NULL;
CREATE INDEX idx_affiliate_clicks_click_id ON affiliate_clicks(click_id);
CREATE INDEX idx_affiliate_clicks_conversion ON affiliate_clicks(converted, conversion_at) WHERE converted = true;

COMMENT ON TABLE affiliate_clicks IS 'Track affiliate link clicks for attribution and conversion tracking';
COMMENT ON COLUMN affiliate_clicks.ip_hash IS 'SHA256 hash of IP for privacy-compliant tracking';

-- 3. SPONSORED PLACEMENTS - Suppliers pay to appear for issues
CREATE TABLE IF NOT EXISTS sponsored_placements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_name TEXT NOT NULL,
  sponsor_logo_url TEXT,
  sponsor_url TEXT NOT NULL,

  -- Targeting
  issue_patterns TEXT[] NOT NULL,
  makes TEXT[],
  models TEXT[],
  year_min INTEGER,
  year_max INTEGER,

  -- Bidding & Budget
  bid_amount_cents INTEGER NOT NULL DEFAULT 100,
  daily_budget_cents INTEGER,
  monthly_budget_cents INTEGER,
  bid_type TEXT CHECK (bid_type IN ('cpm', 'cpc', 'cpa')) DEFAULT 'cpc',

  -- Metrics
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  spend_cents INTEGER DEFAULT 0,

  -- Scheduling
  is_active BOOLEAN DEFAULT true,
  start_date DATE,
  end_date DATE,

  -- Creative
  headline TEXT NOT NULL,
  description TEXT,
  cta_text TEXT DEFAULT 'Shop Now',
  destination_url TEXT NOT NULL,

  -- Tracking
  tracking_pixel_url TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sponsored_placements_active ON sponsored_placements(is_active, bid_amount_cents DESC) WHERE is_active = true;
CREATE INDEX idx_sponsored_placements_patterns ON sponsored_placements USING GIN (issue_patterns);
CREATE INDEX idx_sponsored_placements_makes ON sponsored_placements USING GIN (makes);

COMMENT ON TABLE sponsored_placements IS 'Suppliers pay to appear when their products are relevant to issues';
COMMENT ON COLUMN sponsored_placements.issue_patterns IS 'Array of patterns to match (e.g., "IMS bearing", "power steering")';

-- 4. EBAY API CACHE - Cache eBay responses (1hr TTL)
CREATE TABLE IF NOT EXISTS ebay_api_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key TEXT NOT NULL UNIQUE,
  search_query TEXT NOT NULL,
  category_id TEXT,
  filters JSONB DEFAULT '{}'::jsonb,

  -- Response data
  response_data JSONB NOT NULL,
  item_count INTEGER DEFAULT 0,

  -- TTL management
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 hour'),
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  access_count INTEGER DEFAULT 1
);

CREATE INDEX idx_ebay_cache_key ON ebay_api_cache(cache_key);
CREATE INDEX idx_ebay_cache_expires ON ebay_api_cache(expires_at);
CREATE INDEX idx_ebay_cache_query ON ebay_api_cache(search_query, category_id);

COMMENT ON TABLE ebay_api_cache IS 'Cache eBay API responses to reduce API calls and improve performance';

-- 5. ISSUE PART MAPPING - Link red flag issues to parts
CREATE TABLE IF NOT EXISTS issue_part_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_pattern TEXT NOT NULL,
  issue_keywords TEXT[] DEFAULT '{}',

  -- Part reference
  part_catalog_id UUID REFERENCES part_catalog(id) ON DELETE SET NULL,
  part_name TEXT NOT NULL,
  part_category TEXT,

  -- Fitment
  makes TEXT[],
  models TEXT[],
  year_min INTEGER,
  year_max INTEGER,

  -- Labor estimate
  labor_hours_min DECIMAL(4,1),
  labor_hours_max DECIMAL(4,1),
  labor_difficulty TEXT CHECK (labor_difficulty IN ('easy', 'moderate', 'hard', 'expert')),
  diy_possible BOOLEAN DEFAULT true,

  -- Severity
  urgency TEXT CHECK (urgency IN ('critical', 'high', 'medium', 'low')) DEFAULT 'medium',
  failure_risk TEXT,

  -- Metadata
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_issue_part_mapping_pattern ON issue_part_mapping(issue_pattern);
CREATE INDEX idx_issue_part_mapping_keywords ON issue_part_mapping USING GIN (issue_keywords);
CREATE INDEX idx_issue_part_mapping_makes ON issue_part_mapping USING GIN (makes);
CREATE INDEX idx_issue_part_mapping_active ON issue_part_mapping(is_active) WHERE is_active = true;

COMMENT ON TABLE issue_part_mapping IS 'Maps red flag issues to the parts needed to fix them';

-- 6. PART PRICE OBSERVATIONS - Track observed prices over time
CREATE TABLE IF NOT EXISTS part_price_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_catalog_id UUID REFERENCES part_catalog(id) ON DELETE CASCADE,
  source_id UUID REFERENCES affiliate_programs(id) ON DELETE SET NULL,
  source_name TEXT NOT NULL,

  -- Price data
  price_cents INTEGER NOT NULL,
  original_price_cents INTEGER,
  currency TEXT DEFAULT 'USD',

  -- Item details
  condition TEXT CHECK (condition IN ('new', 'used', 'remanufactured', 'refurbished', 'unknown')) DEFAULT 'new',
  seller_name TEXT,
  seller_rating DECIMAL(3,2),

  -- Shipping
  shipping_cents INTEGER DEFAULT 0,
  free_shipping BOOLEAN DEFAULT false,

  -- Availability
  in_stock BOOLEAN DEFAULT true,
  quantity_available INTEGER,

  -- Source URL
  source_url TEXT,
  source_item_id TEXT,

  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_price_observations_part ON part_price_observations(part_catalog_id, observed_at DESC);
CREATE INDEX idx_price_observations_source ON part_price_observations(source_name, observed_at DESC);
CREATE INDEX idx_price_observations_condition ON part_price_observations(condition);

-- 7. PART PRICE STATS - Aggregated pricing statistics
CREATE TABLE IF NOT EXISTS part_price_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_catalog_id UUID REFERENCES part_catalog(id) ON DELETE CASCADE,

  -- Price aggregates
  min_price_cents INTEGER,
  max_price_cents INTEGER,
  avg_price_cents INTEGER,
  median_price_cents INTEGER,

  -- By condition
  new_min_cents INTEGER,
  new_max_cents INTEGER,
  new_avg_cents INTEGER,
  used_min_cents INTEGER,
  used_max_cents INTEGER,
  used_avg_cents INTEGER,
  reman_min_cents INTEGER,
  reman_max_cents INTEGER,
  reman_avg_cents INTEGER,

  -- Source counts
  observation_count INTEGER DEFAULT 0,
  source_count INTEGER DEFAULT 0,

  -- Trend
  price_trend TEXT CHECK (price_trend IN ('rising', 'falling', 'stable', 'unknown')) DEFAULT 'unknown',
  trend_percent DECIMAL(5,2),

  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(part_catalog_id)
);

CREATE INDEX idx_price_stats_part ON part_price_stats(part_catalog_id);

-- 8. RLS POLICIES
ALTER TABLE affiliate_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsored_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebay_api_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_part_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_price_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_price_stats ENABLE ROW LEVEL SECURITY;

-- Affiliate programs: readable by all, editable by admins
CREATE POLICY "Anyone can view affiliate programs"
  ON affiliate_programs FOR SELECT USING (true);

CREATE POLICY "Service role can manage affiliate programs"
  ON affiliate_programs FOR ALL USING (auth.role() = 'service_role');

-- Affiliate clicks: users see their own, service role sees all
CREATE POLICY "Users can view own clicks"
  ON affiliate_clicks FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all clicks"
  ON affiliate_clicks FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Authenticated users can create clicks"
  ON affiliate_clicks FOR INSERT WITH CHECK (auth.uid() IS NOT NULL OR auth.role() = 'service_role');

-- Sponsored placements: readable by all
CREATE POLICY "Anyone can view active sponsored placements"
  ON sponsored_placements FOR SELECT USING (is_active = true);

CREATE POLICY "Service role can manage sponsored placements"
  ON sponsored_placements FOR ALL USING (auth.role() = 'service_role');

-- eBay cache: service role only
CREATE POLICY "Service role can manage eBay cache"
  ON ebay_api_cache FOR ALL USING (auth.role() = 'service_role');

-- Issue part mapping: readable by all
CREATE POLICY "Anyone can view issue part mappings"
  ON issue_part_mapping FOR SELECT USING (true);

CREATE POLICY "Service role can manage issue part mappings"
  ON issue_part_mapping FOR ALL USING (auth.role() = 'service_role');

-- Price observations: readable by all
CREATE POLICY "Anyone can view price observations"
  ON part_price_observations FOR SELECT USING (true);

CREATE POLICY "Service role can manage price observations"
  ON part_price_observations FOR ALL USING (auth.role() = 'service_role');

-- Price stats: readable by all
CREATE POLICY "Anyone can view price stats"
  ON part_price_stats FOR SELECT USING (true);

CREATE POLICY "Service role can manage price stats"
  ON part_price_stats FOR ALL USING (auth.role() = 'service_role');

-- 9. SEED AFFILIATE PROGRAMS
INSERT INTO affiliate_programs (source_name, affiliate_id, campaign_id, commission_rate, url_template, notes) VALUES
  ('eBay', NULL, NULL, 3.00, '{url}?mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid={campaign_id}&toolid=10001&customid={click_id}', 'eBay Partner Network - requires campaign ID'),
  ('FCP Euro', NULL, NULL, 5.00, '{url}?aff={affiliate_id}', 'FCP Euro affiliate program'),
  ('Pelican Parts', NULL, NULL, 4.00, 'https://shareasale.com/r.cfm?b={affiliate_id}&u={campaign_id}&m=47396&urllink={encoded_url}', 'Pelican Parts via ShareASale'),
  ('RockAuto', NULL, NULL, 3.50, '{url}?a={affiliate_id}', 'RockAuto affiliate program'),
  ('Amazon', NULL, NULL, 2.00, '{url}?tag={affiliate_id}', 'Amazon Associates')
ON CONFLICT (source_name) DO UPDATE SET
  url_template = EXCLUDED.url_template,
  commission_rate = EXCLUDED.commission_rate,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- 10. SEED COMMON ISSUE-PART MAPPINGS (Porsche 911/Boxster/Cayman examples)
INSERT INTO issue_part_mapping (issue_pattern, issue_keywords, part_name, part_category, makes, models, year_min, year_max, labor_hours_min, labor_hours_max, labor_difficulty, urgency, failure_risk) VALUES
  ('IMS bearing', ARRAY['ims', 'intermediate shaft', 'bearing failure'], 'IMS Bearing Upgrade Kit', 'Engine', ARRAY['Porsche'], ARRAY['911', 'Boxster', 'Cayman'], 1997, 2008, 8.0, 12.0, 'expert', 'critical', 'Catastrophic engine failure if bearing fails'),
  ('power steering', ARRAY['power steering', 'steering pump', 'ps leak', 'steering groan'], 'Power Steering Pump', 'Steering', NULL, NULL, NULL, NULL, 2.0, 4.0, 'moderate', 'medium', 'Loss of power assist, fluid leaks'),
  ('power steering', ARRAY['power steering', 'steering rack', 'ps rack'], 'Power Steering Rack', 'Steering', NULL, NULL, NULL, NULL, 4.0, 8.0, 'hard', 'medium', 'Loss of power assist, uneven tire wear'),
  ('coolant leak', ARRAY['coolant', 'radiator', 'overheating', 'water pump'], 'Water Pump', 'Cooling', NULL, NULL, NULL, NULL, 2.0, 5.0, 'moderate', 'high', 'Engine overheating, head gasket damage'),
  ('coolant leak', ARRAY['coolant', 'radiator', 'overheating'], 'Radiator', 'Cooling', NULL, NULL, NULL, NULL, 1.5, 3.0, 'moderate', 'high', 'Engine overheating'),
  ('brake squeal', ARRAY['brake', 'squeal', 'grinding', 'brake noise'], 'Brake Pad Set', 'Brakes', NULL, NULL, NULL, NULL, 0.5, 1.5, 'easy', 'medium', 'Reduced braking performance, rotor damage'),
  ('oil leak', ARRAY['oil leak', 'valve cover', 'gasket'], 'Valve Cover Gasket Set', 'Engine', NULL, NULL, NULL, NULL, 1.0, 3.0, 'moderate', 'low', 'Oil consumption, smoke, mess'),
  ('suspension noise', ARRAY['suspension', 'clunk', 'rattle', 'control arm'], 'Control Arm Bushing Kit', 'Suspension', NULL, NULL, NULL, NULL, 2.0, 4.0, 'moderate', 'medium', 'Uneven tire wear, poor handling'),
  ('air oil separator', ARRAY['aos', 'air oil separator', 'smoke on startup'], 'Air Oil Separator', 'Engine', ARRAY['Porsche'], ARRAY['911', 'Boxster', 'Cayman'], 1997, 2012, 3.0, 5.0, 'hard', 'medium', 'Oil consumption, smoke, rough idle'),
  ('rear main seal', ARRAY['rms', 'rear main seal', 'oil leak transmission'], 'Rear Main Seal', 'Engine', NULL, NULL, NULL, NULL, 6.0, 10.0, 'expert', 'low', 'Oil leak at transmission bell housing')
ON CONFLICT DO NOTHING;

-- 11. FUNCTION: Update price stats from observations
CREATE OR REPLACE FUNCTION update_part_price_stats_from_observations()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO part_price_stats (
    part_catalog_id,
    min_price_cents,
    max_price_cents,
    avg_price_cents,
    new_min_cents,
    new_max_cents,
    new_avg_cents,
    used_min_cents,
    used_max_cents,
    used_avg_cents,
    reman_min_cents,
    reman_max_cents,
    reman_avg_cents,
    observation_count,
    source_count,
    last_updated
  )
  SELECT
    NEW.part_catalog_id,
    MIN(price_cents),
    MAX(price_cents),
    AVG(price_cents)::INTEGER,
    MIN(CASE WHEN condition = 'new' THEN price_cents END),
    MAX(CASE WHEN condition = 'new' THEN price_cents END),
    AVG(CASE WHEN condition = 'new' THEN price_cents END)::INTEGER,
    MIN(CASE WHEN condition = 'used' THEN price_cents END),
    MAX(CASE WHEN condition = 'used' THEN price_cents END),
    AVG(CASE WHEN condition = 'used' THEN price_cents END)::INTEGER,
    MIN(CASE WHEN condition = 'remanufactured' THEN price_cents END),
    MAX(CASE WHEN condition = 'remanufactured' THEN price_cents END),
    AVG(CASE WHEN condition = 'remanufactured' THEN price_cents END)::INTEGER,
    COUNT(*),
    COUNT(DISTINCT source_name),
    NOW()
  FROM part_price_observations
  WHERE part_catalog_id = NEW.part_catalog_id
    AND observed_at > NOW() - INTERVAL '7 days'
  GROUP BY part_catalog_id
  ON CONFLICT (part_catalog_id) DO UPDATE SET
    min_price_cents = EXCLUDED.min_price_cents,
    max_price_cents = EXCLUDED.max_price_cents,
    avg_price_cents = EXCLUDED.avg_price_cents,
    new_min_cents = EXCLUDED.new_min_cents,
    new_max_cents = EXCLUDED.new_max_cents,
    new_avg_cents = EXCLUDED.new_avg_cents,
    used_min_cents = EXCLUDED.used_min_cents,
    used_max_cents = EXCLUDED.used_max_cents,
    used_avg_cents = EXCLUDED.used_avg_cents,
    reman_min_cents = EXCLUDED.reman_min_cents,
    reman_max_cents = EXCLUDED.reman_max_cents,
    reman_avg_cents = EXCLUDED.reman_avg_cents,
    observation_count = EXCLUDED.observation_count,
    source_count = EXCLUDED.source_count,
    last_updated = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_update_price_stats ON part_price_observations;
CREATE TRIGGER trigger_update_price_stats
  AFTER INSERT ON part_price_observations
  FOR EACH ROW
  WHEN (NEW.part_catalog_id IS NOT NULL)
  EXECUTE FUNCTION update_part_price_stats_from_observations();

-- 12. FUNCTION: Clean expired eBay cache
CREATE OR REPLACE FUNCTION clean_expired_ebay_cache()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM ebay_api_cache WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 13. VIEW: Parts with pricing and affiliate links
CREATE OR REPLACE VIEW parts_with_pricing AS
SELECT
  pc.id,
  pc.part_name,
  pc.oem_part_number,
  pc.category,
  pc.subcategory,
  pc.fits_makes,
  pc.fits_models,
  pc.fits_years,
  pc.description,
  pc.install_notes,
  pps.min_price_cents,
  pps.max_price_cents,
  pps.avg_price_cents,
  pps.new_avg_cents,
  pps.used_avg_cents,
  pps.reman_avg_cents,
  pps.observation_count,
  pps.source_count,
  pps.price_trend,
  pps.last_updated as prices_updated_at,
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'source', ap.source_name,
        'affiliate_id', ap.affiliate_id,
        'campaign_id', ap.campaign_id,
        'url_template', ap.url_template,
        'commission_rate', ap.commission_rate
      )
    )
    FROM affiliate_programs ap
    WHERE ap.is_active = true
  ) as affiliate_sources
FROM part_catalog pc
LEFT JOIN part_price_stats pps ON pc.id = pps.part_catalog_id;

COMMENT ON VIEW parts_with_pricing IS 'Parts catalog enriched with pricing stats and affiliate program info';

-- 14. Updated timestamps trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_affiliate_programs_updated_at ON affiliate_programs;
CREATE TRIGGER update_affiliate_programs_updated_at
  BEFORE UPDATE ON affiliate_programs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_sponsored_placements_updated_at ON sponsored_placements;
CREATE TRIGGER update_sponsored_placements_updated_at
  BEFORE UPDATE ON sponsored_placements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_issue_part_mapping_updated_at ON issue_part_mapping;
CREATE TRIGGER update_issue_part_mapping_updated_at
  BEFORE UPDATE ON issue_part_mapping
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 15. FUNCTIONS: Increment sponsored placement stats
CREATE OR REPLACE FUNCTION increment_sponsored_impressions(placement_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE sponsored_placements
  SET impressions = impressions + 1
  WHERE id = placement_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION increment_sponsored_clicks(placement_id UUID)
RETURNS void AS $$
DECLARE
  placement_record RECORD;
BEGIN
  SELECT bid_amount_cents, bid_type INTO placement_record
  FROM sponsored_placements
  WHERE id = placement_id;

  UPDATE sponsored_placements
  SET
    clicks = clicks + 1,
    spend_cents = CASE
      WHEN bid_type = 'cpc' THEN spend_cents + COALESCE(placement_record.bid_amount_cents, 0)
      ELSE spend_cents
    END
  WHERE id = placement_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 16. Grant execute permissions
GRANT EXECUTE ON FUNCTION increment_sponsored_impressions(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_sponsored_clicks(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_sponsored_impressions(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION increment_sponsored_clicks(UUID) TO service_role;
