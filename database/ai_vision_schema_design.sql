-- AI VISION DATA SCHEMA DESIGN
-- Comprehensive schema for storing AI-detected automotive component data
-- Designed for extreme scalability and long-term data structure needs

-- =====================================================
-- CURRENT DATA STORAGE (already working)
-- =====================================================

-- 1. SIMPLE APPROACH: Using existing vehicle_images table
-- PROS: Already implemented, working now
-- CONS: Limited structure, hard to query complex relationships

-- Current storage in vehicle_images:
-- labels ARRAY: ['LS3 engine block', 'Paint work round 1', 'Wheels']
-- spatial_tags JSONB[]: [{"component": "LS3 engine block", "quadrant": "center", "confidence": 0.92}]

-- =====================================================
-- PROPOSED ENHANCED SCHEMA (for long-term scalability)
-- =====================================================

-- 2. STRUCTURED APPROACH: Dedicated AI vision tables
-- PROS: Extreme scalability, complex queries, analytics, ML training data
-- CONS: More complex, requires migration

-- A) Component Detection Results Table
CREATE TABLE IF NOT EXISTS ai_component_detections (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_image_id UUID REFERENCES vehicle_images(id) ON DELETE CASCADE,

    -- AI Detection Metadata
    ai_model VARCHAR(50) NOT NULL DEFAULT 'gpt-4o',  -- Track which AI model was used
    detection_timestamp TIMESTAMPTZ DEFAULT NOW(),
    api_response_time_ms INTEGER,  -- Track performance

    -- Component Information
    component_name VARCHAR(255) NOT NULL,  -- 'LS3 engine block', 'Paint work round 1'
    component_category VARCHAR(100),  -- 'engine', 'body_work', 'suspension'

    -- AI Confidence & Analysis
    confidence_score DECIMAL(3,2) CHECK (confidence_score >= 0 AND confidence_score <= 1),
    ai_reasoning TEXT,  -- Why the AI detected this component

    -- Spatial Information
    quadrant VARCHAR(20),  -- 'top_left', 'center', 'full_image'
    bounding_box JSONB,  -- Future: exact pixel coordinates {"x": 100, "y": 200, "width": 300, "height": 150}

    -- Component Relationship to Build
    build_line_item_id UUID REFERENCES build_line_items(id),  -- Link to actual build parts

    -- Quality Control
    human_verified BOOLEAN DEFAULT FALSE,  -- Manual verification flag
    false_positive BOOLEAN DEFAULT FALSE,  -- Mark incorrect detections

    -- Indexing for performance
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- B) AI Scan Sessions Table (track batch processing)
CREATE TABLE IF NOT EXISTS ai_scan_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,

    -- Session Metadata
    session_start TIMESTAMPTZ DEFAULT NOW(),
    session_end TIMESTAMPTZ,
    ai_model VARCHAR(50) NOT NULL DEFAULT 'gpt-4o',

    -- Batch Processing Info
    total_images_processed INTEGER DEFAULT 0,
    successful_scans INTEGER DEFAULT 0,
    failed_scans INTEGER DEFAULT 0,
    total_components_detected INTEGER DEFAULT 0,

    -- Performance Tracking
    total_api_cost_usd DECIMAL(10,4),  -- Track OpenAI API costs
    avg_processing_time_ms INTEGER,

    -- Processing Status
    status VARCHAR(20) DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'failed', 'cancelled')),
    error_message TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- C) Component Categories Lookup Table
CREATE TABLE IF NOT EXISTS ai_component_categories (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    category_name VARCHAR(100) UNIQUE NOT NULL,  -- 'engine', 'transmission', 'body_work'
    display_name VARCHAR(150),  -- 'Engine Components', 'Body Work & Paint'
    description TEXT,
    icon_name VARCHAR(50),  -- For UI icons
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- D) Component Detection History (for ML improvement)
CREATE TABLE IF NOT EXISTS ai_detection_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    component_detection_id UUID REFERENCES ai_component_detections(id) ON DELETE CASCADE,

    -- Change tracking
    change_type VARCHAR(20) CHECK (change_type IN ('created', 'verified', 'corrected', 'flagged')),
    old_confidence DECIMAL(3,2),
    new_confidence DECIMAL(3,2),
    old_component_name VARCHAR(255),
    new_component_name VARCHAR(255),

    -- Who made the change
    changed_by_user_id UUID REFERENCES auth.users(id),
    change_reason TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- INDEXES FOR PERFORMANCE (essential for 752+ images)
-- =====================================================

-- Primary query patterns
CREATE INDEX IF NOT EXISTS idx_ai_detections_vehicle_image ON ai_component_detections(vehicle_image_id);
CREATE INDEX IF NOT EXISTS idx_ai_detections_component_name ON ai_component_detections(component_name);
CREATE INDEX IF NOT EXISTS idx_ai_detections_category ON ai_component_detections(component_category);
CREATE INDEX IF NOT EXISTS idx_ai_detections_confidence ON ai_component_detections(confidence_score);
CREATE INDEX IF NOT EXISTS idx_ai_detections_timestamp ON ai_component_detections(detection_timestamp);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ai_detections_vehicle_component ON ai_component_detections(vehicle_image_id, component_name);
CREATE INDEX IF NOT EXISTS idx_ai_detections_build_link ON ai_component_detections(build_line_item_id) WHERE build_line_item_id IS NOT NULL;

-- Spatial queries
CREATE INDEX IF NOT EXISTS idx_ai_detections_spatial ON ai_component_detections USING GIN(bounding_box) WHERE bounding_box IS NOT NULL;

-- =====================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================

ALTER TABLE ai_component_detections ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_scan_sessions ENABLE ROW LEVEL SECURITY;

-- Owner can see all their vehicle's AI data
CREATE POLICY ai_detections_owner_policy ON ai_component_detections
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM vehicle_images vi
            JOIN vehicles v ON v.id = vi.vehicle_id
            WHERE vi.id = vehicle_image_id AND v.uploaded_by = auth.uid()
        )
    );

-- Public can see AI data for public images
CREATE POLICY ai_detections_public_policy ON ai_component_detections
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM vehicle_images vi
            JOIN vehicles v ON v.id = vi.vehicle_id
            WHERE vi.id = vehicle_image_id
            AND v.is_public = true
            AND NOT vi.is_sensitive
        )
    );

-- =====================================================
-- EXAMPLE QUERIES (what the UI will use)
-- =====================================================

-- Query 1: Get all AI detections for a specific image
/*
SELECT
    acd.component_name,
    acd.confidence_score,
    acd.ai_reasoning,
    acd.quadrant,
    acd.human_verified,
    acc.display_name as category_display
FROM ai_component_detections acd
LEFT JOIN ai_component_categories acc ON acc.category_name = acd.component_category
WHERE acd.vehicle_image_id = 'image-uuid'
ORDER BY acd.confidence_score DESC;
*/

-- Query 2: Find all images containing a specific component
/*
SELECT DISTINCT
    vi.id,
    vi.filename,
    vi.image_url,
    acd.confidence_score,
    acd.quadrant
FROM vehicle_images vi
JOIN ai_component_detections acd ON acd.vehicle_image_id = vi.id
WHERE vi.vehicle_id = 'blazer-uuid'
AND acd.component_name = 'LS3 engine block'
AND acd.confidence_score > 0.7
ORDER BY acd.confidence_score DESC;
*/

-- Query 3: Component detection summary for a vehicle
/*
SELECT
    acd.component_name,
    acc.display_name as category,
    COUNT(*) as image_count,
    AVG(acd.confidence_score) as avg_confidence,
    MAX(acd.confidence_score) as max_confidence,
    COUNT(CASE WHEN acd.human_verified THEN 1 END) as verified_count
FROM ai_component_detections acd
LEFT JOIN ai_component_categories acc ON acc.category_name = acd.component_category
JOIN vehicle_images vi ON vi.id = acd.vehicle_image_id
WHERE vi.vehicle_id = 'blazer-uuid'
GROUP BY acd.component_name, acc.display_name
ORDER BY image_count DESC, avg_confidence DESC;
*/

-- Query 4: Build progress tracking (link AI detections to build items)
/*
SELECT
    bli.name as build_item,
    bli.status as build_status,
    COUNT(acd.id) as photos_with_component,
    AVG(acd.confidence_score) as avg_ai_confidence,
    MAX(acd.detection_timestamp) as last_detected
FROM build_line_items bli
LEFT JOIN ai_component_detections acd ON acd.build_line_item_id = bli.id
WHERE bli.build_id = 'build-uuid'
GROUP BY bli.id, bli.name, bli.status
ORDER BY photos_with_component DESC;
*/

-- =====================================================
-- UI DATA ACCESS FUNCTIONS
-- =====================================================

-- Function: Get image AI analysis summary
CREATE OR REPLACE FUNCTION get_image_ai_summary(p_image_id UUID)
RETURNS TABLE (
    total_components INTEGER,
    avg_confidence DECIMAL,
    top_component TEXT,
    detection_timestamp TIMESTAMPTZ,
    has_verified_components BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)::INTEGER as total_components,
        AVG(confidence_score)::DECIMAL as avg_confidence,
        (SELECT component_name FROM ai_component_detections
         WHERE vehicle_image_id = p_image_id
         ORDER BY confidence_score DESC LIMIT 1) as top_component,
        MAX(detection_timestamp) as detection_timestamp,
        EXISTS(SELECT 1 FROM ai_component_detections
               WHERE vehicle_image_id = p_image_id AND human_verified = true) as has_verified_components
    FROM ai_component_detections
    WHERE vehicle_image_id = p_image_id;
END;
$$;

-- Function: Search images by component
CREATE OR REPLACE FUNCTION search_images_by_component(
    p_vehicle_id UUID,
    p_component_name TEXT,
    p_min_confidence DECIMAL DEFAULT 0.7
)
RETURNS TABLE (
    image_id UUID,
    filename TEXT,
    image_url TEXT,
    confidence_score DECIMAL,
    quadrant TEXT,
    detection_timestamp TIMESTAMPTZ
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT
        vi.id,
        vi.filename,
        vi.image_url,
        acd.confidence_score,
        acd.quadrant,
        acd.detection_timestamp
    FROM vehicle_images vi
    JOIN ai_component_detections acd ON acd.vehicle_image_id = vi.id
    WHERE vi.vehicle_id = p_vehicle_id
    AND acd.component_name ILIKE '%' || p_component_name || '%'
    AND acd.confidence_score >= p_min_confidence
    ORDER BY acd.confidence_score DESC, acd.detection_timestamp DESC;
END;
$$;

-- =====================================================
-- MIGRATION STRATEGY
-- =====================================================

-- Option 1: Keep current simple approach (vehicle_images.labels)
-- - Fastest to implement
-- - Good for immediate needs
-- - Limited long-term scalability

-- Option 2: Implement full structured schema above
-- - Best for long-term scalability
-- - Enables complex analytics
-- - Requires migration planning

-- Option 3: Hybrid approach
-- - Keep current labels for compatibility
-- - Add structured tables for new data
-- - Gradually migrate existing data

-- =====================================================
-- RECOMMENDED APPROACH
-- =====================================================

-- START WITH: Enhanced vehicle_images (immediate)
ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS ai_scan_metadata JSONB DEFAULT '{}';
ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS ai_last_scanned TIMESTAMPTZ;
ALTER TABLE vehicle_images ADD COLUMN IF NOT EXISTS ai_component_count INTEGER DEFAULT 0;

-- UPDATE ai_scan_metadata with structured data:
-- {
--   "scan_session_id": "uuid",
--   "ai_model": "gpt-4o",
--   "total_detections": 5,
--   "avg_confidence": 0.85,
--   "processing_time_ms": 1200,
--   "api_cost_usd": 0.02
-- }

-- THEN ADD: Structured tables for advanced features
-- This gives us immediate functionality while building toward long-term scalability

COMMENT ON TABLE ai_component_detections IS 'Stores individual AI component detections with full metadata for long-term analytics and ML training';
COMMENT ON TABLE ai_scan_sessions IS 'Tracks AI scanning sessions for performance monitoring and cost tracking';
COMMENT ON TABLE ai_component_categories IS 'Lookup table for component categorization and UI display';

-- This schema design provides:
-- ✅ Immediate data storage (enhanced vehicle_images)
-- ✅ Long-term scalability (dedicated tables)
-- ✅ Performance optimization (proper indexing)
-- ✅ Data integrity (RLS policies)
-- ✅ UI-friendly queries (helper functions)
-- ✅ Analytics capabilities (detection history)
-- ✅ ML training data structure
-- ✅ Cost and performance tracking