-- ============================================
-- PARTS PRICING SCHEMA
-- Migration: 20260129_parts_pricing_schema.sql
--
-- Enables real-time parts pricing from red flags
-- Fits into existing observation architecture
-- ============================================

-- 1. PARTS SOURCES
-- Where we get pricing data from
CREATE TABLE IF NOT EXISTS parts_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  source_type TEXT NOT NULL,  -- 'marketplace', 'retailer', 'oem', 'junkyard'
  base_url TEXT,
  search_url_template TEXT,
  extractor_function TEXT,
  trust_score DECIMAL(3,2) DEFAULT 0.8,
  supports_fitment BOOLEAN DEFAULT false,
  supports_price_history BOOLEAN DEFAULT true,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed common sources
INSERT INTO parts_sources (slug, display_name, source_type, base_url, search_url_template, supports_fitment) VALUES
  ('ebay', 'eBay', 'marketplace', 'https://www.ebay.com', 'https://www.ebay.com/sch/i.html?_nkw={query}&_sacat=6028', true),
  ('fcp-euro', 'FCP Euro', 'retailer', 'https://www.fcpeuro.com', 'https://www.fcpeuro.com/search?q={query}', true),
  ('pelican-parts', 'Pelican Parts', 'retailer', 'https://www.pelicanparts.com', 'https://www.pelicanparts.com/catalog/search.php?search={query}', true),
  ('rock-auto', 'RockAuto', 'retailer', 'https://www.rockauto.com', 'https://www.rockauto.com/en/catalog/{make},{model},{year}', true),
  ('car-part', 'Car-Part.com', 'junkyard', 'https://www.car-part.com', 'https://www.car-part.com/', false),
  ('eeuroparts', 'eEuroparts', 'retailer', 'https://www.eeuroparts.com', 'https://www.eeuroparts.com/Search/?q={query}', true)
ON CONFLICT (slug) DO NOTHING;


-- 2. PARTS (normalized part definitions)
CREATE TABLE IF NOT EXISTS parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL,
  category TEXT NOT NULL,  -- 'steering', 'engine', 'suspension', 'electrical', 'brakes', 'cooling', 'exhaust'
  subcategory TEXT,
  aliases TEXT[] DEFAULT '{}',
  oem_part_numbers TEXT[] DEFAULT '{}',
  typical_labor_hours DECIMAL(4,1),
  difficulty TEXT,  -- 'diy', 'moderate', 'shop-only'
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS parts_category ON parts(category);
CREATE INDEX IF NOT EXISTS parts_name_search ON parts USING gin(to_tsvector('english', canonical_name));


-- 3. PART FITMENT
-- Which parts fit which vehicles
CREATE TABLE IF NOT EXISTS part_fitment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID REFERENCES parts(id) ON DELETE CASCADE,
  make TEXT NOT NULL,
  model TEXT,
  year_start INT,
  year_end INT,
  trim TEXT,
  engine TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(part_id, make, model, year_start, year_end, trim, engine)
);

CREATE INDEX IF NOT EXISTS part_fitment_vehicle ON part_fitment(make, model, year_start, year_end);


-- 4. PART PRICE OBSERVATIONS
-- Raw price data from scraping
CREATE TABLE IF NOT EXISTS part_price_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID REFERENCES parts(id) ON DELETE SET NULL,
  part_name_raw TEXT NOT NULL,
  source_id UUID REFERENCES parts_sources(id),
  source_url TEXT,
  source_listing_id TEXT,
  price_cents INT NOT NULL,
  currency TEXT DEFAULT 'USD',
  condition TEXT,  -- 'new', 'remanufactured', 'used', 'core'
  shipping_cents INT,
  in_stock BOOLEAN,
  quantity_available INT,
  seller_name TEXT,
  seller_rating DECIMAL(3,2),
  claimed_fitment JSONB,
  observed_at TIMESTAMPTZ DEFAULT now(),
  listing_date TIMESTAMPTZ,
  content_hash TEXT,
  UNIQUE(source_id, source_listing_id)
);

CREATE INDEX IF NOT EXISTS part_prices_part ON part_price_observations(part_id);
CREATE INDEX IF NOT EXISTS part_prices_observed ON part_price_observations(observed_at DESC);
CREATE INDEX IF NOT EXISTS part_prices_source ON part_price_observations(source_id);
CREATE INDEX IF NOT EXISTS part_prices_condition ON part_price_observations(condition);


-- 5. PART PRICE STATS (aggregated)
CREATE TABLE IF NOT EXISTS part_price_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID REFERENCES parts(id) ON DELETE CASCADE,
  condition TEXT NOT NULL,
  price_min_cents INT,
  price_max_cents INT,
  price_avg_cents INT,
  price_median_cents INT,
  observation_count INT DEFAULT 0,
  source_count INT DEFAULT 0,
  window_days INT DEFAULT 30,
  price_trend TEXT,  -- 'rising', 'stable', 'falling'
  trend_pct DECIMAL(5,2),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(part_id, condition)
);

CREATE INDEX IF NOT EXISTS part_stats_part ON part_price_stats(part_id);


-- 6. ISSUE-TO-PART MAPPING
-- Links red flags to parts needed
CREATE TABLE IF NOT EXISTS issue_part_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_pattern TEXT NOT NULL,  -- 'power steering', 'exhaust', 'rust'
  issue_category TEXT,  -- 'mechanical', 'electrical', 'cosmetic', 'structural'
  part_id UUID REFERENCES parts(id) ON DELETE CASCADE,
  likelihood DECIMAL(3,2) DEFAULT 0.8,
  labor_hours_min DECIMAL(4,1),
  labor_hours_max DECIMAL(4,1),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS issue_mapping_pattern ON issue_part_mapping USING gin(to_tsvector('english', issue_pattern));


-- 7. SEED COMMON PARTS + MAPPINGS
-- Steering
INSERT INTO parts (canonical_name, category, subcategory, aliases, difficulty, typical_labor_hours) VALUES
  ('Power Steering Rack', 'steering', 'rack', ARRAY['PS rack', 'steering rack', 'rack and pinion'], 'shop-only', 4.0),
  ('Power Steering Pump', 'steering', 'pump', ARRAY['PS pump', 'steering pump'], 'moderate', 2.0),
  ('Power Steering Hose', 'steering', 'hose', ARRAY['PS hose', 'high pressure hose'], 'diy', 1.0)
ON CONFLICT DO NOTHING;

-- Exhaust
INSERT INTO parts (canonical_name, category, subcategory, aliases, difficulty, typical_labor_hours) VALUES
  ('Catalytic Converter', 'exhaust', 'converter', ARRAY['cat', 'catalytic', 'cat converter'], 'shop-only', 2.5),
  ('Exhaust Manifold', 'exhaust', 'manifold', ARRAY['header', 'exhaust header'], 'moderate', 3.0),
  ('Muffler', 'exhaust', 'muffler', ARRAY['silencer', 'rear muffler'], 'moderate', 1.5)
ON CONFLICT DO NOTHING;

-- Cooling
INSERT INTO parts (canonical_name, category, subcategory, aliases, difficulty, typical_labor_hours) VALUES
  ('Radiator', 'cooling', 'radiator', ARRAY['rad', 'coolant radiator'], 'moderate', 2.5),
  ('Water Pump', 'cooling', 'pump', ARRAY['coolant pump'], 'shop-only', 4.0),
  ('Thermostat', 'cooling', 'thermostat', ARRAY['coolant thermostat', 'tstat'], 'diy', 1.0)
ON CONFLICT DO NOTHING;

-- Issue mappings
INSERT INTO issue_part_mapping (issue_pattern, issue_category, part_id, likelihood, labor_hours_min, labor_hours_max)
SELECT 'power steering', 'mechanical', id, 0.7, 2.0, 5.0 FROM parts WHERE canonical_name = 'Power Steering Rack'
ON CONFLICT DO NOTHING;

INSERT INTO issue_part_mapping (issue_pattern, issue_category, part_id, likelihood, labor_hours_min, labor_hours_max)
SELECT 'power steering', 'mechanical', id, 0.5, 1.5, 2.5 FROM parts WHERE canonical_name = 'Power Steering Pump'
ON CONFLICT DO NOTHING;

INSERT INTO issue_part_mapping (issue_pattern, issue_category, part_id, likelihood, labor_hours_min, labor_hours_max)
SELECT 'exhaust', 'mechanical', id, 0.6, 2.0, 4.0 FROM parts WHERE canonical_name = 'Catalytic Converter'
ON CONFLICT DO NOTHING;

INSERT INTO issue_part_mapping (issue_pattern, issue_category, part_id, likelihood, labor_hours_min, labor_hours_max)
SELECT 'exhaust', 'mechanical', id, 0.4, 2.5, 4.0 FROM parts WHERE canonical_name = 'Exhaust Manifold'
ON CONFLICT DO NOTHING;

INSERT INTO issue_part_mapping (issue_pattern, issue_category, part_id, likelihood, labor_hours_min, labor_hours_max)
SELECT 'overheating', 'mechanical', id, 0.5, 2.0, 3.0 FROM parts WHERE canonical_name = 'Radiator'
ON CONFLICT DO NOTHING;

INSERT INTO issue_part_mapping (issue_pattern, issue_category, part_id, likelihood, labor_hours_min, labor_hours_max)
SELECT 'overheating', 'mechanical', id, 0.4, 3.0, 5.0 FROM parts WHERE canonical_name = 'Water Pump'
ON CONFLICT DO NOTHING;


-- 8. RLS POLICIES
ALTER TABLE parts_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_fitment ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_price_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE part_price_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_part_mapping ENABLE ROW LEVEL SECURITY;

-- Public read for all (pricing data should be visible)
CREATE POLICY "Public read parts_sources" ON parts_sources FOR SELECT USING (true);
CREATE POLICY "Public read parts" ON parts FOR SELECT USING (true);
CREATE POLICY "Public read part_fitment" ON part_fitment FOR SELECT USING (true);
CREATE POLICY "Public read part_price_observations" ON part_price_observations FOR SELECT USING (true);
CREATE POLICY "Public read part_price_stats" ON part_price_stats FOR SELECT USING (true);
CREATE POLICY "Public read issue_part_mapping" ON issue_part_mapping FOR SELECT USING (true);

-- Service role for writes
CREATE POLICY "Service write parts_sources" ON parts_sources FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write parts" ON parts FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write part_fitment" ON part_fitment FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write part_price_observations" ON part_price_observations FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write part_price_stats" ON part_price_stats FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write issue_part_mapping" ON issue_part_mapping FOR ALL USING (auth.role() = 'service_role');
