-- ============================================================================
-- IMPROVE ZERO INVENTORY EXTRACTION - THOROUGH PROFILES FOR EASY TARGETS
-- ============================================================================
-- Enhance the extraction process to prioritize thorough vehicle profiles,
-- especially for easy targets (non-JS sites, simple structure)
-- ============================================================================

-- ============================================================================
-- Function: Determine if an org website is an "easy target"
-- ============================================================================
CREATE OR REPLACE FUNCTION is_easy_extraction_target(website_url TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  -- Easy targets:
  -- - Have a website (required)
  -- - Not JavaScript-heavy (can be detected by known patterns)
  -- - Classic.com dealers (well-structured)
  -- - Simple dealer sites (HTML-based inventory)
  
  IF website_url IS NULL OR website_url = '' THEN
    RETURN FALSE;
  END IF;
  
  -- Classic.com is always an easy target (well-structured API/data)
  IF website_url ILIKE '%classic.com%' OR website_url ILIKE '%classiccars.com%' THEN
    RETURN TRUE;
  END IF;
  
  -- DealerFire sites are relatively easy (common CMS)
  IF website_url ILIKE '%dealerfire%' OR website_url ILIKE '%dealeron%' THEN
    RETURN TRUE;
  END IF;
  
  -- HTML-based sites (no SPA frameworks) are easier
  -- JavaScript-heavy sites (React, Vue, etc.) need Firecrawl
  -- We'll assume dealer sites are easier than modern JS apps
  -- This is a heuristic - could be improved with actual site scanning
  
  RETURN TRUE; -- Default: assume it's extractable (system will handle JS sites via Firecrawl)
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- View: Organizations needing investigation (prioritized)
-- ============================================================================
CREATE OR REPLACE VIEW orgs_needing_investigation AS
SELECT 
  b.id,
  b.business_name,
  b.website,
  b.business_type,
  b.created_at,
  (
    SELECT COUNT(*) 
    FROM organization_vehicles ov 
    WHERE ov.organization_id = b.id 
    AND ov.status = 'active'
  ) as current_inventory_count,
  is_easy_extraction_target(b.website) as is_easy_target,
  CASE 
    WHEN is_easy_extraction_target(b.website) THEN 1
    WHEN b.business_type = 'dealership' THEN 2
    ELSE 3
  END as priority_score,
  EXISTS (
    SELECT 1 FROM organization_inventory_sync_queue q
    WHERE q.organization_id = b.id
    AND q.run_mode = 'both'
    AND q.status IN ('pending', 'processing')
  ) as already_queued
FROM businesses b
WHERE b.is_public = true
  AND b.website IS NOT NULL
  AND b.website != ''
  AND (
    SELECT COUNT(*) 
    FROM organization_vehicles ov 
    WHERE ov.organization_id = b.id 
    AND ov.status = 'active'
  ) = 0
ORDER BY 
  priority_score ASC, -- Easy targets first
  b.created_at ASC;   -- Then oldest first

-- ============================================================================
-- Function: Get next batch of orgs to investigate (prioritized)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_next_investigation_batch(batch_size INTEGER DEFAULT 20)
RETURNS TABLE (
  organization_id UUID,
  business_name TEXT,
  website TEXT,
  business_type TEXT,
  priority_score INTEGER,
  is_easy_target BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id,
    o.business_name,
    o.website,
    o.business_type,
    o.priority_score,
    o.is_easy_target
  FROM orgs_needing_investigation o
  WHERE o.already_queued = FALSE
  ORDER BY o.priority_score ASC, o.created_at ASC
  LIMIT batch_size;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Grant permissions
-- ============================================================================
GRANT SELECT ON orgs_needing_investigation TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION is_easy_extraction_target(TEXT) TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_next_investigation_batch(INTEGER) TO postgres, anon, authenticated, service_role;

