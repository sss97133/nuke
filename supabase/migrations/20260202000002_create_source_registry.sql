-- Source Registry: Central tracking for all extraction sources
-- Tracks health, config, quality, and metrics for auction/marketplace sources
-- See: .claude/SOURCE_OPERATIONS_ARCHITECTURE.md

-- ============================================
-- SOURCE REGISTRY TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS source_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source Identity
  slug TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('auction', 'marketplace', 'forum', 'social', 'dealer', 'registry', 'documentation')),

  -- Health Metrics
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'degraded', 'blocked', 'archived', 'pending', 'not_started')),
  last_successful_at TIMESTAMPTZ,
  success_rate_24h FLOAT CHECK (success_rate_24h >= 0 AND success_rate_24h <= 1),
  success_rate_7d FLOAT CHECK (success_rate_7d >= 0 AND success_rate_7d <= 1),
  success_rate_30d FLOAT CHECK (success_rate_30d >= 0 AND success_rate_30d <= 1),
  avg_extraction_ms INT,

  -- Configuration
  extractor_function TEXT,  -- edge function name (e.g., 'bat-simple-extract')
  fallback_method TEXT CHECK (fallback_method IS NULL OR fallback_method IN ('playwright', 'firecrawl', 'manual', 'api')),
  requires_auth BOOLEAN DEFAULT false,
  cloudflare_protected BOOLEAN DEFAULT false,

  -- Quality
  data_quality_score FLOAT CHECK (data_quality_score IS NULL OR (data_quality_score >= 0 AND data_quality_score <= 1)),
  is_ugly_source BOOLEAN DEFAULT false,  -- High volume, low signal (eBay, Copart, etc.)
  quality_filters JSONB,  -- Source-specific filters for ugly sources

  -- Discovery
  discovery_url TEXT,  -- Where to find new listings
  discovery_method TEXT CHECK (discovery_method IS NULL OR discovery_method IN ('sitemap', 'api', 'crawl', 'rss', 'manual')),
  discovery_frequency INTERVAL DEFAULT '1 hour',

  -- Metrics
  total_extracted INT DEFAULT 0,
  total_vehicles_created INT DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_source_registry_status ON source_registry(status);
CREATE INDEX IF NOT EXISTS idx_source_registry_category ON source_registry(category);
CREATE INDEX IF NOT EXISTS idx_source_registry_last_successful ON source_registry(last_successful_at);
CREATE INDEX IF NOT EXISTS idx_source_registry_quality ON source_registry(data_quality_score);

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_source_registry_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS source_registry_updated_at ON source_registry;
CREATE TRIGGER source_registry_updated_at
  BEFORE UPDATE ON source_registry
  FOR EACH ROW
  EXECUTE FUNCTION update_source_registry_updated_at();

-- ============================================
-- SEED DATA: Known Sources
-- ============================================

INSERT INTO source_registry (
  slug, display_name, category, status, extractor_function,
  cloudflare_protected, data_quality_score, is_ugly_source, quality_filters,
  discovery_method
) VALUES
  -- Active sources
  (
    'bringatrailer',
    'Bring a Trailer',
    'auction',
    'active',
    'bat-simple-extract',
    false,
    0.95,
    false,
    NULL,
    'api'
  ),
  (
    'collecting-cars',
    'Collecting Cars',
    'auction',
    'active',
    'extract-collecting-cars',
    false,
    0.90,
    false,
    NULL,
    'api'
  ),
  (
    'craigslist',
    'Craigslist',
    'marketplace',
    'active',
    'extract-craigslist',
    false,
    0.60,
    false,
    '{"require_vin": false, "min_price": 1000}'::jsonb,
    'crawl'
  ),
  (
    'pcarmarket',
    'PCarMarket',
    'auction',
    'active',
    'import-pcarmarket-listing',
    false,
    0.90,
    false,
    NULL,
    'sitemap'
  ),
  (
    'hagerty',
    'Hagerty Marketplace',
    'auction',
    'active',
    'extract-hagerty-listing',
    false,
    0.90,
    false,
    NULL,
    'api'
  ),

  -- Blocked (Cloudflare)
  (
    'cars-and-bids',
    'Cars & Bids',
    'auction',
    'blocked',
    'extract-cars-and-bids-core',
    true,
    0.95,
    false,
    NULL,
    'api'
  ),
  (
    'mecum',
    'Mecum Auctions',
    'auction',
    'blocked',
    NULL,
    true,
    0.90,
    false,
    NULL,
    'sitemap'
  ),
  (
    'barrett-jackson',
    'Barrett-Jackson',
    'auction',
    'blocked',
    NULL,
    true,
    0.90,
    false,
    NULL,
    'sitemap'
  ),
  (
    'classic-com',
    'Classic.com',
    'auction',
    'blocked',
    NULL,
    true,
    0.85,
    false,
    NULL,
    'api'
  ),

  -- Ugly sources (not started)
  (
    'ebay-motors',
    'eBay Motors',
    'marketplace',
    'not_started',
    NULL,
    false,
    0.40,
    true,
    '{
      "skip_parts_only": true,
      "min_seller_feedback": 95,
      "min_price": 500,
      "max_price": 5000000,
      "require_real_photos": true,
      "verify_vin_matches": true
    }'::jsonb,
    'api'
  ),
  (
    'copart',
    'Copart',
    'marketplace',
    'not_started',
    NULL,
    false,
    0.30,
    true,
    '{
      "skip_certificate_of_destruction": true,
      "filter_damage_type": ["minor", "none"],
      "flag_salvage_title": true,
      "extract_pre_accident_value": true
    }'::jsonb,
    'api'
  ),

  -- Not started (normal)
  (
    'manheim',
    'Manheim',
    'dealer',
    'not_started',
    NULL,
    false,
    0.65,
    false,
    '{
      "dealer_wholesale_lower_confidence": true,
      "extract_condition_report": true,
      "cross_reference_retail": true
    }'::jsonb,
    'api'
  ),

  -- Pending
  (
    'hemmings',
    'Hemmings',
    'marketplace',
    'pending',
    NULL,
    false,
    0.85,
    false,
    NULL,
    'sitemap'
  )
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  category = EXCLUDED.category,
  status = EXCLUDED.status,
  extractor_function = EXCLUDED.extractor_function,
  cloudflare_protected = EXCLUDED.cloudflare_protected,
  data_quality_score = EXCLUDED.data_quality_score,
  is_ugly_source = EXCLUDED.is_ugly_source,
  quality_filters = EXCLUDED.quality_filters,
  discovery_method = EXCLUDED.discovery_method,
  updated_at = now();

-- ============================================
-- HELPER VIEWS
-- ============================================

-- Active sources ordered by quality
CREATE OR REPLACE VIEW v_active_sources AS
SELECT
  slug,
  display_name,
  category,
  status,
  extractor_function,
  data_quality_score,
  is_ugly_source,
  last_successful_at,
  success_rate_24h,
  total_extracted,
  total_vehicles_created
FROM source_registry
WHERE status = 'active'
ORDER BY data_quality_score DESC NULLS LAST;

-- Sources needing attention (degraded, blocked, or stale)
CREATE OR REPLACE VIEW v_sources_needing_attention AS
SELECT
  slug,
  display_name,
  status,
  last_successful_at,
  success_rate_24h,
  cloudflare_protected,
  CASE
    WHEN status = 'blocked' THEN 'Cloudflare/blocking detected'
    WHEN status = 'degraded' THEN 'Success rate below threshold'
    WHEN last_successful_at < now() - interval '24 hours' THEN 'Stale (>24h since success)'
    WHEN success_rate_24h < 0.8 THEN 'Low success rate'
    ELSE 'Unknown'
  END AS attention_reason
FROM source_registry
WHERE status IN ('blocked', 'degraded')
   OR last_successful_at < now() - interval '24 hours'
   OR success_rate_24h < 0.8
ORDER BY
  CASE status
    WHEN 'blocked' THEN 1
    WHEN 'degraded' THEN 2
    ELSE 3
  END,
  last_successful_at ASC NULLS FIRST;

-- Ugly sources with their filters
CREATE OR REPLACE VIEW v_ugly_sources AS
SELECT
  slug,
  display_name,
  status,
  data_quality_score,
  quality_filters,
  total_extracted,
  total_vehicles_created
FROM source_registry
WHERE is_ugly_source = true
ORDER BY data_quality_score DESC;

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE source_registry ENABLE ROW LEVEL SECURITY;

-- Read access for all authenticated users
CREATE POLICY "source_registry_read_all" ON source_registry
  FOR SELECT
  TO authenticated
  USING (true);

-- Write access for service role only
CREATE POLICY "source_registry_service_write" ON source_registry
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE source_registry IS 'Central registry of all vehicle data extraction sources (auctions, marketplaces, forums, etc.)';
COMMENT ON COLUMN source_registry.slug IS 'URL-safe unique identifier (e.g., bringatrailer, cars-and-bids)';
COMMENT ON COLUMN source_registry.category IS 'Source type: auction, marketplace, forum, social, dealer, registry, documentation';
COMMENT ON COLUMN source_registry.status IS 'Health status: active, degraded, blocked, archived, pending, not_started';
COMMENT ON COLUMN source_registry.extractor_function IS 'Name of the edge function that handles extraction for this source';
COMMENT ON COLUMN source_registry.is_ugly_source IS 'True for high-volume, low-signal sources that need aggressive filtering (eBay, Copart)';
COMMENT ON COLUMN source_registry.quality_filters IS 'JSONB config for source-specific quality filtering rules';
COMMENT ON COLUMN source_registry.discovery_method IS 'How to find new listings: sitemap, api, crawl, rss, manual';
COMMENT ON VIEW v_active_sources IS 'All active extraction sources ordered by quality score';
COMMENT ON VIEW v_sources_needing_attention IS 'Sources that need maintenance (blocked, degraded, stale)';
COMMENT ON VIEW v_ugly_sources IS 'High-volume sources that require quality filtering';
