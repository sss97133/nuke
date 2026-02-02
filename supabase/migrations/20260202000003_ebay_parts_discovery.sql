-- eBay Parts Discovery and Structure Learning System
--
-- This migration creates tables for:
-- 1. ebay_parts_catalog - Learned parts catalog with eBay-specific data
-- 2. vehicle_suggested_parts - Parts suggestions for specific vehicles
-- 3. ebay_category_mappings - Discovered eBay category structure
-- 4. ebay_seller_ratings - Seller quality tracking

-- ============================================
-- TABLE: ebay_parts_catalog
-- Stores discovered parts with eBay search data, pricing, and fitment
-- ============================================
CREATE TABLE IF NOT EXISTS ebay_parts_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Part identification
  part_type TEXT NOT NULL,                    -- 'brake_pads', 'alternator', etc.
  part_name TEXT NOT NULL,                    -- Human-readable name

  -- eBay-specific data (learned from scraping)
  ebay_category_id TEXT,                      -- eBay category ID
  ebay_search_terms TEXT[] DEFAULT '{}',      -- Terms that find this part

  -- Vehicle compatibility
  compatible_years INT4RANGE,                 -- Year range, e.g., [2010,2020)
  compatible_makes TEXT[] DEFAULT '{}',       -- ['Porsche', 'Audi']
  compatible_models TEXT[] DEFAULT '{}',      -- ['911', '718']

  -- Pricing intelligence
  avg_price_low NUMERIC(10,2),               -- 25th percentile price
  avg_price_high NUMERIC(10,2),              -- 75th percentile price
  price_currency TEXT DEFAULT 'USD',

  -- Quality availability
  oem_available BOOLEAN DEFAULT FALSE,
  aftermarket_available BOOLEAN DEFAULT TRUE,

  -- Seller intelligence
  discovered_sellers TEXT[] DEFAULT '{}',     -- Sellers who stock this part
  top_seller_username TEXT,                   -- Best seller for this part

  -- Sample data
  sample_listings JSONB DEFAULT '[]',         -- Recent listing examples

  -- Discovery metadata
  discovery_metadata JSONB DEFAULT '{}',      -- AI analysis, search URLs, etc.
  last_discovered_at TIMESTAMPTZ DEFAULT now(),
  discovery_count INTEGER DEFAULT 1,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Unique constraint for deduplication
  CONSTRAINT ebay_parts_catalog_unique UNIQUE (part_type, compatible_makes, compatible_models)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ebay_parts_catalog_part_type ON ebay_parts_catalog(part_type);
CREATE INDEX IF NOT EXISTS idx_ebay_parts_catalog_makes ON ebay_parts_catalog USING GIN (compatible_makes);
CREATE INDEX IF NOT EXISTS idx_ebay_parts_catalog_models ON ebay_parts_catalog USING GIN (compatible_models);
CREATE INDEX IF NOT EXISTS idx_ebay_parts_catalog_price ON ebay_parts_catalog(avg_price_low, avg_price_high);


-- ============================================
-- TABLE: vehicle_suggested_parts
-- Links vehicles to suggested parts based on age, mileage, common failures
-- ============================================
CREATE TABLE IF NOT EXISTS vehicle_suggested_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vehicle reference
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Part reference (optional - may not be in catalog yet)
  part_catalog_id UUID REFERENCES ebay_parts_catalog(id) ON DELETE SET NULL,
  part_type TEXT NOT NULL,                    -- 'brake_pads', 'alternator', etc.

  -- Suggestion reasoning
  reason TEXT NOT NULL,                        -- 'high_mileage', 'common_failure', 'preventive', 'routine_maintenance'
  reason_details TEXT,                         -- Additional context
  priority INTEGER DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),  -- 1=urgent, 5=nice-to-have

  -- eBay listing data (refreshed periodically)
  ebay_listing_ids TEXT[] DEFAULT '{}',       -- Current matching listing IDs
  best_price NUMERIC(10,2),                   -- Lowest price found
  best_seller TEXT,                           -- Seller with best deal
  best_listing_url TEXT,                      -- Direct link to best listing

  -- Quality preferences
  recommended_quality TEXT DEFAULT 'premium_aftermarket',  -- 'oem', 'premium_aftermarket', 'budget_aftermarket'

  -- Status tracking
  status TEXT DEFAULT 'suggested',             -- 'suggested', 'viewed', 'purchased', 'dismissed'
  last_checked_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Unique constraint
  CONSTRAINT vehicle_suggested_parts_unique UNIQUE (vehicle_id, part_type)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vehicle_suggested_parts_vehicle ON vehicle_suggested_parts(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_suggested_parts_priority ON vehicle_suggested_parts(priority);
CREATE INDEX IF NOT EXISTS idx_vehicle_suggested_parts_reason ON vehicle_suggested_parts(reason);
CREATE INDEX IF NOT EXISTS idx_vehicle_suggested_parts_status ON vehicle_suggested_parts(status);


-- ============================================
-- TABLE: ebay_category_mappings
-- Learned eBay category structure per make
-- ============================================
CREATE TABLE IF NOT EXISTS ebay_category_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Make identification
  make TEXT NOT NULL UNIQUE,

  -- Discovered categories
  categories JSONB DEFAULT '[]',              -- Array of category discoveries
  category_tree JSONB DEFAULT '{}',           -- Hierarchical category structure

  -- Search patterns
  best_search_patterns JSONB DEFAULT '{}',    -- What search terms work best

  -- Discovery metadata
  discovered_at TIMESTAMPTZ DEFAULT now(),
  last_updated_at TIMESTAMPTZ DEFAULT now(),
  discovery_count INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_ebay_category_mappings_make ON ebay_category_mappings(make);


-- ============================================
-- TABLE: ebay_seller_ratings
-- Track seller quality for parts
-- ============================================
CREATE TABLE IF NOT EXISTS ebay_seller_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Seller identification
  seller_username TEXT NOT NULL UNIQUE,

  -- eBay metrics
  feedback_score INTEGER,
  feedback_percentage NUMERIC(5,2),

  -- Our metrics
  parts_discovered INTEGER DEFAULT 0,         -- How many parts we've seen from them
  price_competitiveness NUMERIC(3,2),         -- 0-1 score
  specialties TEXT[] DEFAULT '{}',            -- Makes/models they specialize in

  -- Quality indicators
  oem_seller BOOLEAN DEFAULT FALSE,
  warranty_offered BOOLEAN DEFAULT FALSE,
  fast_shipping BOOLEAN DEFAULT FALSE,

  -- Trust score (our calculation)
  trust_score NUMERIC(3,2) DEFAULT 0.5,       -- 0-1

  -- Timestamps
  first_seen_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ebay_seller_ratings_trust ON ebay_seller_ratings(trust_score DESC);
CREATE INDEX IF NOT EXISTS idx_ebay_seller_ratings_specialties ON ebay_seller_ratings USING GIN (specialties);


-- ============================================
-- TABLE: ebay_discovery_runs
-- Track discovery operations for debugging and optimization
-- ============================================
CREATE TABLE IF NOT EXISTS ebay_discovery_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Run identification
  run_type TEXT NOT NULL,                     -- 'discover_parts', 'match_vehicle', 'learn_categories'

  -- Input parameters
  input_params JSONB NOT NULL,                -- { year, make, model, part_type, etc. }

  -- Results
  success BOOLEAN DEFAULT FALSE,
  parts_discovered INTEGER DEFAULT 0,
  listings_found INTEGER DEFAULT 0,
  errors TEXT[],

  -- Performance
  duration_ms INTEGER,
  firecrawl_calls INTEGER DEFAULT 0,
  ai_calls INTEGER DEFAULT 0,

  -- Timestamps
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ebay_discovery_runs_type ON ebay_discovery_runs(run_type);
CREATE INDEX IF NOT EXISTS idx_ebay_discovery_runs_started ON ebay_discovery_runs(started_at DESC);


-- ============================================
-- TRIGGERS: Auto-update timestamps
-- ============================================
CREATE OR REPLACE FUNCTION update_ebay_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_ebay_parts_catalog_updated ON ebay_parts_catalog;
CREATE TRIGGER trigger_ebay_parts_catalog_updated
  BEFORE UPDATE ON ebay_parts_catalog
  FOR EACH ROW EXECUTE FUNCTION update_ebay_updated_at();

DROP TRIGGER IF EXISTS trigger_vehicle_suggested_parts_updated ON vehicle_suggested_parts;
CREATE TRIGGER trigger_vehicle_suggested_parts_updated
  BEFORE UPDATE ON vehicle_suggested_parts
  FOR EACH ROW EXECUTE FUNCTION update_ebay_updated_at();


-- ============================================
-- VIEW: vehicle_parts_intelligence
-- Combines vehicle data with parts suggestions and catalog data
-- ============================================
CREATE OR REPLACE VIEW vehicle_parts_intelligence AS
SELECT
  v.id AS vehicle_id,
  v.year,
  v.make,
  v.model,
  v.mileage,
  vsp.part_type,
  vsp.reason,
  vsp.priority,
  vsp.status,
  vsp.best_price,
  vsp.best_listing_url,
  vsp.recommended_quality,
  epc.ebay_search_terms,
  epc.avg_price_low,
  epc.avg_price_high,
  epc.oem_available,
  epc.aftermarket_available,
  epc.top_seller_username,
  vsp.last_checked_at,
  CASE
    WHEN vsp.last_checked_at < now() - INTERVAL '7 days' THEN 'stale'
    WHEN vsp.last_checked_at < now() - INTERVAL '1 day' THEN 'aging'
    ELSE 'fresh'
  END AS data_freshness
FROM vehicles v
JOIN vehicle_suggested_parts vsp ON v.id = vsp.vehicle_id
LEFT JOIN ebay_parts_catalog epc ON vsp.part_catalog_id = epc.id
ORDER BY v.id, vsp.priority;


-- ============================================
-- RLS Policies
-- ============================================
ALTER TABLE ebay_parts_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_suggested_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebay_category_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebay_seller_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ebay_discovery_runs ENABLE ROW LEVEL SECURITY;

-- Catalog is publicly readable
CREATE POLICY "ebay_parts_catalog_public_read" ON ebay_parts_catalog
  FOR SELECT USING (true);

-- Suggestions are readable by vehicle owners (or public for now)
CREATE POLICY "vehicle_suggested_parts_public_read" ON vehicle_suggested_parts
  FOR SELECT USING (true);

-- Category mappings are publicly readable
CREATE POLICY "ebay_category_mappings_public_read" ON ebay_category_mappings
  FOR SELECT USING (true);

-- Seller ratings are publicly readable
CREATE POLICY "ebay_seller_ratings_public_read" ON ebay_seller_ratings
  FOR SELECT USING (true);

-- Discovery runs are readable by authenticated users
CREATE POLICY "ebay_discovery_runs_authenticated_read" ON ebay_discovery_runs
  FOR SELECT USING (auth.role() = 'authenticated');


-- ============================================
-- Insert some initial part type reference data
-- ============================================
COMMENT ON TABLE ebay_parts_catalog IS 'eBay parts catalog with learned search terms, pricing, and fitment data. Auto-populated by discover-ebay-parts function.';
COMMENT ON TABLE vehicle_suggested_parts IS 'Parts suggestions for specific vehicles based on mileage, age, and common failures.';
COMMENT ON TABLE ebay_category_mappings IS 'Discovered eBay category structure per vehicle make.';
COMMENT ON TABLE ebay_seller_ratings IS 'Quality ratings for eBay parts sellers based on our observations.';
COMMENT ON TABLE ebay_discovery_runs IS 'Audit log of discovery operations for debugging and optimization.';

COMMENT ON COLUMN ebay_parts_catalog.compatible_years IS 'PostgreSQL int4range for year compatibility, e.g., [2010,2020)';
COMMENT ON COLUMN vehicle_suggested_parts.priority IS '1=urgent (safety), 2=important (reliability), 3=recommended (maintenance), 4=optional, 5=nice-to-have';
COMMENT ON COLUMN vehicle_suggested_parts.reason IS 'Why this part is suggested: high_mileage, common_failure, preventive, routine_maintenance, age_based';
