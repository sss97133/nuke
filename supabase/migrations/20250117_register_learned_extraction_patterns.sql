-- Register learned extraction patterns from recent discoveries
-- This ensures patterns we've learned stay with us for future extractions

-- Pattern 1: Sidebar structure (Classic.com, Hagerty, etc.)
INSERT INTO source_site_schemas (domain, site_name, site_type, schema_data, notes, cataloged_by)
VALUES (
  'classic.com',
  'Classic.com',
  'marketplace',
  '{
    "page_types": {
      "vehicle_listing": {
        "url_pattern": "/veh/",
        "fields": {
          "price": {
            "selectors": [".sidebar .price .price-amount", ".price .price-amount"],
            "extraction_method": "dom_selector",
            "pattern": "/([\\d,]+)\\.?\\d*/",
            "required": false
          },
          "condition": {
            "selectors": [".sidebar .price .condition", ".price .condition"],
            "extraction_method": "dom_selector",
            "required": false
          },
          "mileage": {
            "selectors": [".sidebar .at-a-glance .odomoter", ".at-a-glance .odomoter"],
            "extraction_method": "dom_selector",
            "pattern": "/([\\d,]+)\\s*(?:mi|miles|mile)/i",
            "required": false
          },
          "transmission": {
            "selectors": [".sidebar .at-a-glance .transmission", ".at-a-glance .transmission"],
            "extraction_method": "dom_selector",
            "cleanup_pattern": "/^[^\\w]*/",
            "required": false
          }
        },
        "extraction_confidence": 0.9
      }
    },
    "available_fields": ["price", "condition", "mileage", "transmission"],
    "extraction_confidence": 0.9
  }'::jsonb,
  'Learned from sidebar structure discovery - handles .sidebar .price .price-amount, .condition, .at-a-glance .odomoter (note typo), .transmission',
  'system'
)
ON CONFLICT (domain) DO UPDATE
SET 
  schema_data = EXCLUDED.schema_data,
  notes = EXCLUDED.notes,
  updated_at = NOW(),
  last_verified_at = NOW();

-- Pattern 2: Table-based structure (Cantech Automotive, etc.)
INSERT INTO source_site_schemas (domain, site_name, site_type, schema_data, notes, cataloged_by)
VALUES (
  'cantechautomotive.com',
  'Cantech Automotive',
  'dealer_website',
  '{
    "page_types": {
      "vehicle_listing": {
        "url_pattern": "/listing/",
        "fields": {
          "price": {
            "selectors": [".table.table-striped tbody tr th:contains(\"Price\") + td .price-amount", ".table.table-striped tbody tr th:contains(\"Price\") + td"],
            "extraction_method": "table_cell",
            "pattern": "/([\\d,]+)\\.?\\d*/",
            "table_header": "Price",
            "required": false
          },
          "mileage": {
            "selectors": [".table.table-striped tbody tr th:contains(\"Miles\") + td", ".table.table-striped tbody tr th:contains(\"Mileage\") + td"],
            "extraction_method": "table_cell",
            "pattern": "/([\\d,]+)\\s*(?:mi|miles|mile)?/i",
            "table_header": "Miles",
            "required": false
          },
          "transmission": {
            "selectors": [".table.table-striped tbody tr th:contains(\"Transmission\") + td"],
            "extraction_method": "table_cell",
            "table_header": "Transmission",
            "required": false
          },
          "drive_type": {
            "selectors": [".table.table-striped tbody tr th:contains(\"Drive Type\") + td"],
            "extraction_method": "table_cell",
            "table_header": "Drive Type",
            "required": false
          },
          "year": {
            "selectors": [".table.table-striped tbody tr th:contains(\"Year\") + td"],
            "extraction_method": "table_cell",
            "table_header": "Year",
            "required": false
          },
          "make": {
            "selectors": [".table.table-striped tbody tr th:contains(\"Make\") + td"],
            "extraction_method": "table_cell",
            "table_header": "Make",
            "required": false
          },
          "model": {
            "selectors": [".table.table-striped tbody tr th:contains(\"Model\") + td"],
            "extraction_method": "table_cell",
            "table_header": "Model",
            "required": false
          },
          "seats": {
            "selectors": [".table.table-striped tbody tr th:contains(\"Seats\") + td"],
            "extraction_method": "table_cell",
            "table_header": "Seats",
            "required": false
          },
          "doors": {
            "selectors": [".table.table-striped tbody tr th:contains(\"Doors\") + td"],
            "extraction_method": "table_cell",
            "table_header": "Doors",
            "required": false
          },
          "fuel_type": {
            "selectors": [".table.table-striped tbody tr th:contains(\"Fuel Type\") + td"],
            "extraction_method": "table_cell",
            "table_header": "Fuel Type",
            "required": false
          }
        },
        "extraction_confidence": 0.95
      }
    },
    "available_fields": ["price", "mileage", "transmission", "drive_type", "year", "make", "model", "seats", "doors", "fuel_type"],
    "extraction_confidence": 0.95
  }'::jsonb,
  'Learned from Cantech Automotive listing - handles .table.table-striped structure with Details and Specifications tabs',
  'system'
)
ON CONFLICT (domain) DO UPDATE
SET 
  schema_data = EXCLUDED.schema_data,
  notes = EXCLUDED.notes,
  updated_at = NOW(),
  last_verified_at = NOW();

-- Create a generic pattern registry for reusable extraction methods
CREATE TABLE IF NOT EXISTS extraction_pattern_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Pattern identification
  pattern_name TEXT NOT NULL UNIQUE, -- 'sidebar_price_amount', 'table_striped_cell'
  pattern_type TEXT NOT NULL CHECK (pattern_type IN ('dom_selector', 'table_cell', 'regex', 'hybrid')),
  description TEXT,
  
  -- Pattern definition
  selectors JSONB, -- Array of CSS selectors
  patterns JSONB, -- Array of regex patterns
  table_config JSONB, -- For table-based extraction: {header: "Price", column_index: null}
  
  -- Usage tracking
  used_by_domains TEXT[], -- Which domains use this pattern
  success_rate DECIMAL(3,2), -- 0.0 - 1.0
  last_used_at TIMESTAMPTZ,
  usage_count INTEGER DEFAULT 0,
  
  -- Metadata
  discovered_from TEXT, -- Which site/URL this was learned from
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_extraction_pattern_registry_type ON extraction_pattern_registry(pattern_type);
CREATE INDEX IF NOT EXISTS idx_extraction_pattern_registry_domains ON extraction_pattern_registry USING GIN(used_by_domains);

-- Register reusable patterns
INSERT INTO extraction_pattern_registry (pattern_name, pattern_type, description, selectors, patterns, used_by_domains, discovered_from)
VALUES 
  (
    'sidebar_price_amount',
    'dom_selector',
    'Extract price from sidebar .price .price-amount structure',
    '["sidebar .price .price-amount", ".price .price-amount"]'::jsonb,
    '["/([\\\\d,]+)\\\\.?\\\\d*/"]'::jsonb,
    ARRAY['classic.com', 'hagerty.com'],
    'classic.com sidebar discovery'
  ),
  (
    'sidebar_at_a_glance',
    'dom_selector',
    'Extract mileage and transmission from .at-a-glance structure (handles odomoter typo)',
    '["sidebar .at-a-glance .odomoter", ".at-a-glance .odomoter", ".sidebar .at-a-glance .transmission", ".at-a-glance .transmission"]'::jsonb,
    '["/([\\\\d,]+)\\\\s*(?:mi|miles|mile)/i"]'::jsonb,
    ARRAY['classic.com'],
    'classic.com sidebar discovery'
  ),
  (
    'table_striped_cell',
    'table_cell',
    'Extract data from .table.table-striped structure by matching th/td pairs',
    '[]'::jsonb,
    '[]'::jsonb,
    ARRAY['cantechautomotive.com'],
    'cantechautomotive.com/listing/2024-porsche-911-carrera-t/'
  )
ON CONFLICT (pattern_name) DO UPDATE
SET 
  used_by_domains = (
    SELECT array_agg(DISTINCT unnest)
    FROM unnest(COALESCE(extraction_pattern_registry.used_by_domains, ARRAY[]::TEXT[]) || EXCLUDED.used_by_domains)
  ),
  updated_at = NOW(),
  last_used_at = NOW(),
  usage_count = extraction_pattern_registry.usage_count + 1;

