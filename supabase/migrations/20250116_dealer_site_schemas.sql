-- Dealer Site Schema Catalog
-- Stores structure/catalog of dealer sites to enable structure-first extraction

CREATE TABLE IF NOT EXISTS dealer_site_schemas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Site Identity
  domain TEXT NOT NULL, -- 'classic.com', '111motorcars.com'
  site_name TEXT, -- Human-readable name
  site_type TEXT CHECK (site_type IN ('directory', 'dealer_website', 'auction_house', 'marketplace')),
  
  -- Structure Catalog (JSONB schema mapping)
  schema_data JSONB NOT NULL DEFAULT '{}',
  
  -- Schema structure example:
  -- {
  --   "page_types": {
  --     "dealer_profile": {
  --       "url_pattern": "/s/[^/]+/",
  --       "fields": {
  --         "name": {
  --           "selectors": ["h1", ".dealer-title"],
  --           "patterns": ["/([^-]+)\\s*-\\s*Classic.com/i"],
  --           "required": true,
  --           "extraction_method": "dom_selector"
  --         },
  --         "logo": {
  --           "selectors": ["img[src*='uploads/dealer']"],
  --           "patterns": ["https://images.classic.com/uploads/dealer/[^\"']+\\.(png|jpg|svg)"],
  --           "required": true,
  --           "extraction_method": "regex"
  --         }
  --       }
  --     },
  --     "inventory_page": {
  --       "url_pattern": "/inventory",
  --       "fields": { ... }
  --     }
  --   },
  --   "available_fields": ["name", "logo", "website", "license"],
  --   "required_fields": ["name", "logo", "license"],
  --   "extraction_confidence": 0.95
  -- }
  
  -- Validation
  cataloged_at TIMESTAMPTZ DEFAULT NOW(),
  last_verified_at TIMESTAMPTZ,
  is_valid BOOLEAN DEFAULT true,
  extraction_confidence DECIMAL(3,2), -- Overall confidence in schema accuracy
  
  -- Metadata
  notes TEXT,
  cataloged_by TEXT DEFAULT 'system', -- 'system', 'manual', 'ai'
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(domain)
);

CREATE INDEX IF NOT EXISTS idx_dealer_site_schemas_domain ON dealer_site_schemas(domain);
CREATE INDEX IF NOT EXISTS idx_dealer_site_schemas_type ON dealer_site_schemas(site_type);
CREATE INDEX IF NOT EXISTS idx_dealer_site_schemas_valid ON dealer_site_schemas(is_valid) WHERE is_valid = true;

COMMENT ON TABLE dealer_site_schemas IS 'Catalog of dealer/auction site structures for structure-first extraction';
COMMENT ON COLUMN dealer_site_schemas.schema_data IS 'JSONB structure mapping field locations and extraction patterns';

