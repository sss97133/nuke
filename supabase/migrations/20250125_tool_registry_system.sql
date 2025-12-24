-- Tool Registry System
-- Central registry for all tools (Edge Functions, scripts, services)
-- Prevents duplicate tool creation and enables AI discovery

-- ============================================
-- 1. TOOL REGISTRY TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS tool_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Identity
  tool_name TEXT NOT NULL UNIQUE, -- 'scrape-vehicle', 'process-import-queue'
  tool_type TEXT NOT NULL CHECK (tool_type IN (
    'edge_function', 
    'script', 
    'service', 
    'database_function',
    'migration',
    'api_endpoint'
  )),
  category TEXT NOT NULL, -- 'scraping', 'processing', 'analysis', 'extraction', 'ingestion'
  
  -- Location
  file_path TEXT NOT NULL, -- 'supabase/functions/scrape-vehicle/index.ts'
  entry_point TEXT, -- Function name, export name, etc.
  
  -- Capabilities (searchable)
  purpose TEXT NOT NULL, -- One-line description
  capabilities TEXT[] DEFAULT ARRAY[]::TEXT[], -- ['extract_vehicle_data', 'handle_craigslist', 'image_extraction']
  supported_sources TEXT[] DEFAULT ARRAY[]::TEXT[], -- ['craigslist.org', 'bringatrailer.com']
  input_format JSONB DEFAULT '{}'::JSONB, -- { url: 'string', options: {...} }
  output_format JSONB DEFAULT '{}'::JSONB, -- { data: {...}, errors: [...] }
  
  -- Usage
  usage_example TEXT, -- Code example
  api_endpoint TEXT, -- If edge function: '/functions/v1/scrape-vehicle'
  required_secrets TEXT[] DEFAULT ARRAY[]::TEXT[], -- ['FIRECRAWL_API_KEY', 'OPENAI_API_KEY']
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  is_deprecated BOOLEAN DEFAULT false,
  replaced_by TEXT, -- If deprecated, what replaces it
  deprecation_reason TEXT,
  last_updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Relationships
  depends_on TEXT[] DEFAULT ARRAY[]::TEXT[], -- Other tools this depends on
  used_by TEXT[] DEFAULT ARRAY[]::TEXT[], -- Tools that use this
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- 2. CAPABILITY INDEX (for fast "what can do X?" queries)
-- ============================================

CREATE TABLE IF NOT EXISTS tool_capabilities (
  capability TEXT NOT NULL, -- 'extract_vehicle_data', 'handle_duplicates'
  tool_id UUID NOT NULL REFERENCES tool_registry(id) ON DELETE CASCADE,
  confidence INTEGER DEFAULT 100 CHECK (confidence >= 0 AND confidence <= 100), -- How well this tool handles this capability
  PRIMARY KEY (capability, tool_id)
);

-- ============================================
-- 3. INDEXES FOR FAST DISCOVERY
-- ============================================

CREATE INDEX IF NOT EXISTS idx_tool_registry_category ON tool_registry(category);
CREATE INDEX IF NOT EXISTS idx_tool_registry_type ON tool_registry(tool_type);
CREATE INDEX IF NOT EXISTS idx_tool_registry_active ON tool_registry(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_tool_registry_capabilities ON tool_registry USING GIN(capabilities);
CREATE INDEX IF NOT EXISTS idx_tool_registry_sources ON tool_registry USING GIN(supported_sources);
CREATE INDEX IF NOT EXISTS idx_tool_registry_depends ON tool_registry USING GIN(depends_on);
CREATE INDEX IF NOT EXISTS idx_tool_capabilities_cap ON tool_capabilities(capability);
CREATE INDEX IF NOT EXISTS idx_tool_capabilities_tool ON tool_capabilities(tool_id);

-- ============================================
-- 4. HELPER FUNCTIONS
-- ============================================

-- Find tools by capability
CREATE OR REPLACE FUNCTION find_tools_by_capability(
  p_capability TEXT
)
RETURNS TABLE (
  tool_name TEXT,
  tool_type TEXT,
  category TEXT,
  purpose TEXT,
  confidence INTEGER,
  file_path TEXT
)
LANGUAGE sql
AS $$
  SELECT 
    tr.tool_name,
    tr.tool_type,
    tr.category,
    tr.purpose,
    tc.confidence,
    tr.file_path
  FROM tool_registry tr
  JOIN tool_capabilities tc ON tc.tool_id = tr.id
  WHERE tc.capability = p_capability
    AND tr.is_active = true
    AND tr.is_deprecated = false
  ORDER BY tc.confidence DESC, tr.tool_name;
$$;

-- Find tools by source
CREATE OR REPLACE FUNCTION find_tools_by_source(
  p_source TEXT
)
RETURNS TABLE (
  tool_name TEXT,
  tool_type TEXT,
  category TEXT,
  purpose TEXT,
  file_path TEXT
)
LANGUAGE sql
AS $$
  SELECT 
    tool_name,
    tool_type,
    category,
    purpose,
    file_path
  FROM tool_registry
  WHERE supported_sources @> ARRAY[p_source]
    AND is_active = true
    AND is_deprecated = false
  ORDER BY tool_name;
$$;

-- Find tools by category
CREATE OR REPLACE FUNCTION find_tools_by_category(
  p_category TEXT
)
RETURNS TABLE (
  tool_name TEXT,
  tool_type TEXT,
  purpose TEXT,
  capabilities TEXT[],
  file_path TEXT
)
LANGUAGE sql
AS $$
  SELECT 
    tool_name,
    tool_type,
    purpose,
    capabilities,
    file_path
  FROM tool_registry
  WHERE category = p_category
    AND is_active = true
    AND is_deprecated = false
  ORDER BY tool_name;
$$;

-- ============================================
-- 5. RLS POLICIES
-- ============================================

ALTER TABLE tool_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_capabilities ENABLE ROW LEVEL SECURITY;

-- Public read access (anyone can discover tools)
CREATE POLICY "Public read access to tool registry"
  ON tool_registry FOR SELECT
  USING (true);

CREATE POLICY "Public read access to tool capabilities"
  ON tool_capabilities FOR SELECT
  USING (true);

-- Service role can manage (for auto-discovery scripts)
CREATE POLICY "Service role can manage tool registry"
  ON tool_registry FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can manage tool capabilities"
  ON tool_capabilities FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================
-- 6. COMMENTS
-- ============================================

COMMENT ON TABLE tool_registry IS 'Central registry of all tools (Edge Functions, scripts, services) - prevents duplicate creation and enables AI discovery';
COMMENT ON TABLE tool_capabilities IS 'Index of tool capabilities for fast "what can do X?" queries';
COMMENT ON FUNCTION find_tools_by_capability IS 'Find all active tools that can perform a specific capability';
COMMENT ON FUNCTION find_tools_by_source IS 'Find all active tools that support a specific source/domain';
COMMENT ON FUNCTION find_tools_by_category IS 'Find all active tools in a specific category';

