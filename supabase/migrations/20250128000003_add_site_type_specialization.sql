-- Add Site Type Specialization to Tool Registry
-- This allows tools to declare what types of sites they are specialized for,
-- making it easier to find the right tool for a specific site type

-- ============================================
-- 1. ADD SITE TYPE SPECIALIZATION COLUMN
-- ============================================

ALTER TABLE tool_registry
  ADD COLUMN IF NOT EXISTS site_type_specialization TEXT[] DEFAULT ARRAY[]::TEXT[];

COMMENT ON COLUMN tool_registry.site_type_specialization IS 
  'Array of site types this tool specializes in: dealer, auction, auction_house, dealer_website, marketplace, classifieds, supplier, catalog';

-- ============================================
-- 2. CREATE INDEX FOR FAST QUERIES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_tool_registry_site_type_specialization 
  ON tool_registry USING GIN(site_type_specialization);

-- ============================================
-- 3. POPULATE SITE TYPE SPECIALIZATION FOR EXISTING SCRAPING TOOLS
-- ============================================

-- scrape-multi-source: Generic multi-purpose scraper (handles multiple types)
UPDATE tool_registry
SET site_type_specialization = ARRAY['dealer', 'auction', 'auction_house', 'dealer_website', 'marketplace', 'classifieds']
WHERE tool_name = 'scrape-multi-source';

-- scrape-sbxcars: Specialized for auction sites (SBX Cars is an auction platform)
UPDATE tool_registry
SET site_type_specialization = ARRAY['auction', 'auction_house']
WHERE tool_name = 'scrape-sbxcars';

-- scrape-craigslist-search: Specialized for classifieds
UPDATE tool_registry
SET site_type_specialization = ARRAY['classifieds']
WHERE tool_name = 'scrape-craigslist-search';

-- scrape-ksl-listings: Specialized for marketplace (KSL Classifieds)
UPDATE tool_registry
SET site_type_specialization = ARRAY['marketplace', 'classifieds']
WHERE tool_name = 'scrape-ksl-listings';

-- scrape-organization-site: Specialized for dealer websites
UPDATE tool_registry
SET site_type_specialization = ARRAY['dealer_website', 'dealer']
WHERE tool_name = 'scrape-organization-site';

-- scrape-collective-auto-sold: Specialized for dealer websites with sold inventory
UPDATE tool_registry
SET site_type_specialization = ARRAY['dealer_website', 'dealer']
WHERE tool_name = 'scrape-collective-auto-sold';

-- import-bat-listing: Specialized for auction houses (BaT)
UPDATE tool_registry
SET site_type_specialization = ARRAY['auction_house', 'auction']
WHERE tool_name = 'import-bat-listing';

-- import-pcarmarket-listing: Specialized for auction houses
UPDATE tool_registry
SET site_type_specialization = ARRAY['auction_house', 'auction']
WHERE tool_name = 'import-pcarmarket-listing';

-- import-classic-auction: Specialized for auction houses
UPDATE tool_registry
SET site_type_specialization = ARRAY['auction_house', 'auction']
WHERE tool_name = 'import-classic-auction';

-- scrape-squarebody-inventory: Specialized for dealer inventory
UPDATE tool_registry
SET site_type_specialization = ARRAY['dealer', 'dealer_website']
WHERE tool_name = 'scrape-squarebody-inventory';

-- scrape-all-craigslist-squarebodies: Specialized for classifieds
UPDATE tool_registry
SET site_type_specialization = ARRAY['classifieds']
WHERE tool_name = 'scrape-all-craigslist-squarebodies';

-- scrape-all-craigslist-2000-and-older: Specialized for classifieds
UPDATE tool_registry
SET site_type_specialization = ARRAY['classifieds']
WHERE tool_name = 'scrape-all-craigslist-2000-and-older';

-- go-grinder: Specialized for auction sites (BaT scraping)
UPDATE tool_registry
SET site_type_specialization = ARRAY['auction', 'auction_house']
WHERE tool_name = 'go-grinder';

-- monitor-bat-seller: Specialized for auction houses
UPDATE tool_registry
SET site_type_specialization = ARRAY['auction_house']
WHERE tool_name = 'monitor-bat-seller';

-- comprehensive-bat-extraction: Specialized for auction houses
UPDATE tool_registry
SET site_type_specialization = ARRAY['auction_house', 'auction']
WHERE tool_name = 'comprehensive-bat-extraction';

-- extract-premium-auction: Specialized for auction houses
UPDATE tool_registry
SET site_type_specialization = ARRAY['auction_house', 'auction']
WHERE tool_name = 'extract-premium-auction';

-- index-classic-com-dealer: Specialized for dealer websites
UPDATE tool_registry
SET site_type_specialization = ARRAY['dealer', 'dealer_website']
WHERE tool_name = 'index-classic-com-dealer';

-- index-lartdelautomobile: Specialized for dealer websites
UPDATE tool_registry
SET site_type_specialization = ARRAY['dealer', 'dealer_website']
WHERE tool_name = 'index-lartdelautomobile';

-- scrape-lmc-complete, scrape-lmc-parts, scrape-lmc-truck: Specialized for supplier/catalog sites
UPDATE tool_registry
SET site_type_specialization = ARRAY['supplier', 'catalog']
WHERE tool_name IN ('scrape-lmc-complete', 'scrape-lmc-parts', 'scrape-lmc-truck');

-- scrape-motec-catalog, scrape-prowire-catalog, scrape-scott-drake-catalog: Supplier/catalog sites
UPDATE tool_registry
SET site_type_specialization = ARRAY['supplier', 'catalog']
WHERE tool_name IN ('scrape-motec-catalog', 'scrape-prowire-catalog', 'scrape-scott-drake-catalog');

-- scrape-holley-product: Supplier/catalog site
UPDATE tool_registry
SET site_type_specialization = ARRAY['supplier', 'catalog']
WHERE tool_name = 'scrape-holley-product';

-- ============================================
-- 4. HELPER FUNCTION: FIND TOOLS BY SITE TYPE
-- ============================================

CREATE OR REPLACE FUNCTION find_tools_by_site_type(
  p_site_type TEXT
)
RETURNS TABLE (
  tool_name TEXT,
  tool_type TEXT,
  category TEXT,
  purpose TEXT,
  site_type_specialization TEXT[],
  supported_sources TEXT[],
  file_path TEXT
)
LANGUAGE sql
AS $$
  SELECT 
    tool_name,
    tool_type,
    category,
    purpose,
    site_type_specialization,
    supported_sources,
    file_path
  FROM tool_registry
  WHERE site_type_specialization @> ARRAY[p_site_type]
    AND is_active = true
    AND is_deprecated = false
  ORDER BY tool_name;
$$;

COMMENT ON FUNCTION find_tools_by_site_type IS 
  'Find all active tools that specialize in a specific site type (dealer, auction, marketplace, etc.)';

-- ============================================
-- 5. HELPER FUNCTION: FIND BEST TOOL FOR SITE TYPE
-- ============================================

CREATE OR REPLACE FUNCTION find_best_tool_for_site_type(
  p_site_type TEXT,
  p_domain TEXT DEFAULT NULL
)
RETURNS TABLE (
  tool_name TEXT,
  tool_type TEXT,
  category TEXT,
  purpose TEXT,
  site_type_specialization TEXT[],
  supported_sources TEXT[],
  file_path TEXT,
  match_score INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH scored_tools AS (
    SELECT 
      tool_name,
      tool_type,
      category,
      purpose,
      site_type_specialization,
      supported_sources,
      file_path,
      CASE
        -- Exact domain match gets highest score (100)
        WHEN p_domain IS NOT NULL AND supported_sources @> ARRAY[p_domain] THEN 100
        -- Exact site type match in specialization (80)
        WHEN site_type_specialization @> ARRAY[p_site_type] THEN 80
        -- Partial domain match (60)
        WHEN p_domain IS NOT NULL AND EXISTS (
          SELECT 1 FROM unnest(supported_sources) AS src
          WHERE src LIKE '%' || p_domain || '%' OR p_domain LIKE '%' || src || '%'
        ) THEN 60
        -- Generic multi-purpose tool (scrape-multi-source) gets lower score (40)
        WHEN site_type_specialization && ARRAY['dealer', 'auction', 'marketplace', 'classifieds'] 
          AND array_length(site_type_specialization, 1) > 3 THEN 40
        ELSE 0
      END AS score
    FROM tool_registry
    WHERE is_active = true
      AND is_deprecated = false
      AND (
        site_type_specialization @> ARRAY[p_site_type]
        OR (p_domain IS NOT NULL AND supported_sources @> ARRAY[p_domain])
        OR tool_name = 'scrape-multi-source' -- Always include fallback
      )
  )
  SELECT 
    tool_name,
    tool_type,
    category,
    purpose,
    site_type_specialization,
    supported_sources,
    file_path,
    score::INTEGER AS match_score
  FROM scored_tools
  WHERE score > 0
  ORDER BY score DESC, tool_name
  LIMIT 10;
END;
$$;

COMMENT ON FUNCTION find_best_tool_for_site_type IS 
  'Find the best tool(s) for a specific site type, optionally filtered by domain. Returns tools ranked by match score.';

