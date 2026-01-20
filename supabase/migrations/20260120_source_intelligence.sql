-- Source Intelligence: Document what we learn about each source
-- Turn raw discovery data into structured knowledge about each source

CREATE TABLE IF NOT EXISTS source_intelligence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID REFERENCES scrape_sources(id) ON DELETE CASCADE,

    -- Classification
    source_purpose TEXT CHECK (source_purpose IN (
        'vehicle_listings',     -- Primary vehicle data (BaT, dealers)
        'aggregator',           -- Queries other sources (SearchTempest)
        'reference',            -- Useful info but not vehicle listings
        'tool',                 -- Helps us find vehicles (query builder)
        'event_calendar',       -- Shows upcoming auctions/events
        'price_guide',          -- Valuation data
        'parts_catalog',        -- Parts and accessories
        'community'             -- Forums, social, enthusiast sites
    )),
    data_quality_tier TEXT CHECK (data_quality_tier IN (
        'premium',      -- Detailed specs, images, history (BaT, RM Sotheby's)
        'standard',     -- Good data, some gaps (most dealers)
        'basic',        -- Minimal data, needs enrichment
        'reference_only' -- No vehicle listings, but useful context
    )),
    extraction_priority INTEGER DEFAULT 50 CHECK (extraction_priority BETWEEN 1 AND 100),

    -- What this source is good for
    strengths TEXT[],           -- e.g. {"detailed specs", "price history", "high-res images"}
    weaknesses TEXT[],          -- e.g. {"no VIN", "stale listings", "requires login"}
    best_used_for TEXT,         -- Human-readable description

    -- Technical details
    requires_js_rendering BOOLEAN DEFAULT false,
    requires_auth BOOLEAN DEFAULT false,
    has_api BOOLEAN DEFAULT false,
    api_docs_url TEXT,
    rate_limit_notes TEXT,
    recommended_extraction_method TEXT, -- simple_fetch, playwright, firecrawl, api

    -- Query patterns (for aggregators like SearchTempest)
    query_template TEXT,        -- URL template: https://site.com/search?make={make}&year_min={year_min}
    supported_filters JSONB DEFAULT '{}', -- {"year_range": true, "make": true, "seller_type": true}
    example_queries JSONB DEFAULT '[]',   -- [{"description": "73-87 C10", "url": "..."}]

    -- Vehicle specialties
    vehicle_specialties TEXT[], -- {"squarebody", "porsche", "muscle_cars", "trucks"}
    year_range_focus INT4RANGE, -- [1973,1992) for squarebody
    makes_focus TEXT[],         -- {"Chevrolet", "GMC"}

    -- Learning notes from inspection
    inspection_notes TEXT,
    page_structure_notes TEXT,  -- How vehicle data is structured on page
    selector_hints JSONB,       -- CSS selectors that work for extraction
    last_inspected_at TIMESTAMPTZ,
    inspected_by TEXT,          -- 'llm', 'human', 'automated'

    -- Extraction stats (updated as we extract)
    vehicles_extracted INTEGER DEFAULT 0,
    extraction_success_rate NUMERIC(5,2),
    avg_data_completeness NUMERIC(5,2),
    last_extraction_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(source_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_source_intel_priority ON source_intelligence(extraction_priority DESC);
CREATE INDEX IF NOT EXISTS idx_source_intel_quality ON source_intelligence(data_quality_tier);
CREATE INDEX IF NOT EXISTS idx_source_intel_purpose ON source_intelligence(source_purpose);

-- Link back to scrape_sources
ALTER TABLE scrape_sources ADD COLUMN IF NOT EXISTS intelligence_id UUID REFERENCES source_intelligence(id);

-- Seed intelligence for known premium sources
INSERT INTO source_intelligence (source_id, source_purpose, data_quality_tier, extraction_priority, strengths, weaknesses, best_used_for, requires_js_rendering, recommended_extraction_method, vehicle_specialties)
SELECT
    s.id,
    'vehicle_listings',
    'premium',
    95,
    ARRAY['detailed specs', 'bid history', 'comment insights', 'high-res images', 'seller info'],
    ARRAY['auction only', 'time-limited'],
    'High-quality vehicle data with provenance, market pricing insights from bid history',
    false,
    'simple_fetch',
    ARRAY['classics', 'enthusiast', 'trucks', 'sports']
FROM scrape_sources s
WHERE s.url ILIKE '%bringatrailer.com%'
AND NOT EXISTS (SELECT 1 FROM source_intelligence si WHERE si.source_id = s.id)
LIMIT 1;

-- Cars & Bids
INSERT INTO source_intelligence (source_id, source_purpose, data_quality_tier, extraction_priority, strengths, weaknesses, best_used_for, requires_js_rendering, recommended_extraction_method)
SELECT
    s.id,
    'vehicle_listings',
    'premium',
    90,
    ARRAY['detailed specs', 'bid history', 'video walkarounds', 'comment insights'],
    ARRAY['auction only', 'newer vehicles focus'],
    'Modern enthusiast vehicles with detailed video content',
    false,
    'simple_fetch'
FROM scrape_sources s
WHERE s.url ILIKE '%carsandbids.com%'
AND NOT EXISTS (SELECT 1 FROM source_intelligence si WHERE si.source_id = s.id)
LIMIT 1;

-- SearchTempest - Document as aggregator/tool
INSERT INTO source_intelligence (source_id, source_purpose, data_quality_tier, extraction_priority, strengths, weaknesses, best_used_for, requires_js_rendering, recommended_extraction_method, query_template, supported_filters, example_queries)
SELECT
    s.id,
    'aggregator',
    'reference_only',
    30,
    ARRAY['queries multiple sites', 'finds private sellers', 'location filtering'],
    ARRAY['aggregator not source', 'links to external sites'],
    'Use query patterns to search Craigslist/FB Marketplace directly. Learn their URL structure.',
    true,
    'reference',
    'https://www.searchtempest.com/results.html?search={query}&category=5&region=usa&minPrice=&maxPrice=',
    '{"query": true, "category": true, "region": true, "price_range": true}',
    '[{"description": "73-87 Chevy C10", "craigslist_pattern": "/search/cta?query=c10&min_year=1973&max_year=1987&purveyor=owner"}]'
FROM scrape_sources s
WHERE s.name ILIKE '%searchtempest%'
AND NOT EXISTS (SELECT 1 FROM source_intelligence si WHERE si.source_id = s.id)
LIMIT 1;

-- Mecum
INSERT INTO source_intelligence (source_id, source_purpose, data_quality_tier, extraction_priority, strengths, weaknesses, best_used_for, requires_js_rendering, recommended_extraction_method, vehicle_specialties)
SELECT
    s.id,
    'vehicle_listings',
    'premium',
    85,
    ARRAY['auction results', 'lot details', 'event calendar'],
    ARRAY['requires JS', 'live auction focus'],
    'Physical auction results and upcoming lots',
    true,
    'playwright',
    ARRAY['muscle_cars', 'classics', 'trucks']
FROM scrape_sources s
WHERE s.url ILIKE '%mecum.com%'
AND NOT EXISTS (SELECT 1 FROM source_intelligence si WHERE si.source_id = s.id)
LIMIT 1;

-- Update trigger
CREATE OR REPLACE FUNCTION update_source_intelligence_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS source_intelligence_updated ON source_intelligence;
CREATE TRIGGER source_intelligence_updated
    BEFORE UPDATE ON source_intelligence
    FOR EACH ROW
    EXECUTE FUNCTION update_source_intelligence_timestamp();
