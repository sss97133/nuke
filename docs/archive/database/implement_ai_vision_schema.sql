-- IMPLEMENT AI VISION DATA SCHEMA
-- This creates the production-ready schema for storing AI component detection data

-- =====================================================
-- PHASE 1: ENHANCE EXISTING vehicle_images TABLE
-- =====================================================

-- Add AI metadata columns to existing table for immediate use
ALTER TABLE vehicle_images
ADD COLUMN IF NOT EXISTS ai_scan_metadata JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS ai_last_scanned TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS ai_component_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS ai_avg_confidence DECIMAL(3,2);

-- Update existing data with metadata
UPDATE vehicle_images
SET
    ai_component_count = COALESCE(array_length(labels, 1), 0),
    ai_avg_confidence = (
        SELECT AVG((st->>'confidence')::DECIMAL)
        FROM unnest(spatial_tags) AS st
        WHERE st ? 'confidence'
    ),
    ai_last_scanned = updated_at
WHERE labels IS NOT NULL OR spatial_tags IS NOT NULL;

-- =====================================================
-- PHASE 2: CREATE STRUCTURED AI VISION TABLES
-- =====================================================

-- A) AI Component Detections - Core detection data
CREATE TABLE IF NOT EXISTS ai_component_detections (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_image_id UUID REFERENCES vehicle_images(id) ON DELETE CASCADE,

    -- AI Detection Metadata
    ai_model VARCHAR(50) NOT NULL DEFAULT 'gpt-4o',
    detection_timestamp TIMESTAMPTZ DEFAULT NOW(),
    api_response_time_ms INTEGER,

    -- Component Information
    component_name VARCHAR(255) NOT NULL,
    component_category VARCHAR(100),

    -- AI Analysis
    confidence_score DECIMAL(3,2) CHECK (confidence_score >= 0 AND confidence_score <= 1),
    ai_reasoning TEXT,

    -- Spatial Information
    quadrant VARCHAR(20) CHECK (quadrant IN ('top_left', 'top_right', 'bottom_left', 'bottom_right', 'center', 'full_image')),
    bounding_box JSONB, -- Future: {"x": 100, "y": 200, "width": 300, "height": 150}

    -- Build Integration
    build_line_item_id UUID REFERENCES build_line_items(id),

    -- Quality Control
    human_verified BOOLEAN DEFAULT FALSE,
    verification_notes TEXT,
    false_positive BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- B) AI Scan Sessions - Track batch processing
CREATE TABLE IF NOT EXISTS ai_scan_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,

    -- Session Info
    session_start TIMESTAMPTZ DEFAULT NOW(),
    session_end TIMESTAMPTZ,
    ai_model VARCHAR(50) NOT NULL DEFAULT 'gpt-4o',

    -- Processing Stats
    total_images_processed INTEGER DEFAULT 0,
    successful_scans INTEGER DEFAULT 0,
    failed_scans INTEGER DEFAULT 0,
    total_components_detected INTEGER DEFAULT 0,

    -- Performance & Cost
    total_api_cost_usd DECIMAL(10,4),
    avg_processing_time_ms INTEGER,

    -- Status
    status VARCHAR(20) DEFAULT 'in_progress'
        CHECK (status IN ('in_progress', 'completed', 'failed', 'cancelled')),
    error_message TEXT,

    -- Session metadata
    batch_size INTEGER,
    user_initiated BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- C) Component Categories - For UI organization
CREATE TABLE IF NOT EXISTS ai_component_categories (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    category_name VARCHAR(100) UNIQUE NOT NULL,
    display_name VARCHAR(150) NOT NULL,
    description TEXT,
    icon_name VARCHAR(50), -- For UI
    color_hex VARCHAR(7), -- For UI theming
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- PERFORMANCE INDEXES
-- =====================================================

-- Primary access patterns
CREATE INDEX IF NOT EXISTS idx_ai_detections_vehicle_image
    ON ai_component_detections(vehicle_image_id);

CREATE INDEX IF NOT EXISTS idx_ai_detections_component_name
    ON ai_component_detections(component_name);

CREATE INDEX IF NOT EXISTS idx_ai_detections_category
    ON ai_component_detections(component_category);

CREATE INDEX IF NOT EXISTS idx_ai_detections_confidence
    ON ai_component_detections(confidence_score);

-- Composite indexes for common UI queries
CREATE INDEX IF NOT EXISTS idx_ai_detections_vehicle_component
    ON ai_component_detections(vehicle_image_id, component_name);

CREATE INDEX IF NOT EXISTS idx_ai_detections_verified
    ON ai_component_detections(human_verified, confidence_score);

-- Build integration
CREATE INDEX IF NOT EXISTS idx_ai_detections_build_link
    ON ai_component_detections(build_line_item_id)
    WHERE build_line_item_id IS NOT NULL;

-- Session tracking
CREATE INDEX IF NOT EXISTS idx_ai_sessions_vehicle
    ON ai_scan_sessions(vehicle_id, created_at);

-- Spatial queries (when bounding boxes added)
CREATE INDEX IF NOT EXISTS idx_ai_detections_spatial
    ON ai_component_detections USING GIN(bounding_box)
    WHERE bounding_box IS NOT NULL;

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE ai_component_detections ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_scan_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_component_categories ENABLE ROW LEVEL SECURITY;

-- Owners can see all their vehicle's AI data
CREATE POLICY ai_detections_owner_policy ON ai_component_detections
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM vehicle_images vi
            JOIN vehicles v ON v.id = vi.vehicle_id
            WHERE vi.id = vehicle_image_id AND v.uploaded_by = auth.uid()
        )
    );

-- Public can see AI data for public vehicles/images
CREATE POLICY ai_detections_public_policy ON ai_component_detections
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM vehicle_images vi
            JOIN vehicles v ON v.id = vi.vehicle_id
            WHERE vi.id = vehicle_image_id
            AND v.is_public = true
            AND NOT COALESCE(vi.is_sensitive, false)
        )
    );

-- Session policies
CREATE POLICY ai_sessions_owner_policy ON ai_scan_sessions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM vehicles v
            WHERE v.id = vehicle_id AND v.uploaded_by = auth.uid()
        )
    );

-- Categories are public read
CREATE POLICY ai_categories_public_policy ON ai_component_categories
    FOR SELECT USING (true);

-- =====================================================
-- POPULATE COMPONENT CATEGORIES
-- =====================================================

INSERT INTO ai_component_categories (category_name, display_name, description, icon_name, color_hex, sort_order) VALUES
('engine', 'Engine Components', 'Engine block, intake, exhaust, cooling system', 'engine', '#FF6B35', 1),
('transmission', 'Transmission & Drivetrain', 'Transmission, transfer case, driveshafts, differentials', 'gears', '#F7931E', 2),
('suspension', 'Suspension & Steering', 'Shocks, springs, steering components, linkages', 'suspension', '#FFD23F', 3),
('wheels_tires', 'Wheels & Tires', 'Wheels, tires, brake components', 'wheel', '#06FFA5', 4),
('body_work', 'Body Work & Paint', 'Body panels, paint work, rust repair, trim', 'car-body', '#4ECDC4', 5),
('interior', 'Interior Components', 'Dashboard, seats, carpet, console, upholstery', 'interior', '#45B7D1', 6),
('electrical', 'Electrical System', 'Wiring, ECU, lights, electrical components', 'electrical', '#96CEB4', 7),
('fuel_exhaust', 'Fuel & Exhaust', 'Fuel system, exhaust system, lines and fittings', 'fuel', '#FFEAA7', 8),
('ac_climate', 'AC & Climate', 'Air conditioning, heating, climate control', 'ac', '#74B9FF', 9),
('tools_workspace', 'Tools & Workspace', 'Tools, equipment, work in progress shots', 'tools', '#A29BFE', 10)
ON CONFLICT (category_name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    icon_name = EXCLUDED.icon_name,
    color_hex = EXCLUDED.color_hex,
    sort_order = EXCLUDED.sort_order;

-- =====================================================
-- UI HELPER FUNCTIONS
-- =====================================================

-- Get comprehensive image AI summary
CREATE OR REPLACE FUNCTION get_image_ai_summary(p_image_id UUID)
RETURNS TABLE (
    total_components INTEGER,
    avg_confidence DECIMAL,
    max_confidence DECIMAL,
    categories TEXT[],
    last_scanned TIMESTAMPTZ,
    has_verified_components BOOLEAN,
    top_components JSONB
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(acd.id)::INTEGER,
        AVG(acd.confidence_score)::DECIMAL(3,2),
        MAX(acd.confidence_score)::DECIMAL(3,2),
        array_agg(DISTINCT acd.component_category) FILTER (WHERE acd.component_category IS NOT NULL),
        MAX(acd.detection_timestamp),
        bool_or(acd.human_verified),
        jsonb_agg(
            jsonb_build_object(
                'name', acd.component_name,
                'confidence', acd.confidence_score,
                'quadrant', acd.quadrant
            ) ORDER BY acd.confidence_score DESC
        ) FILTER (WHERE acd.confidence_score IS NOT NULL)
    FROM ai_component_detections acd
    WHERE acd.vehicle_image_id = p_image_id;
END;
$$;

-- Search images by component with filters
CREATE OR REPLACE FUNCTION search_images_by_component(
    p_vehicle_id UUID,
    p_component_name TEXT DEFAULT NULL,
    p_category VARCHAR DEFAULT NULL,
    p_min_confidence DECIMAL DEFAULT 0.5,
    p_verified_only BOOLEAN DEFAULT FALSE,
    p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
    image_id UUID,
    filename TEXT,
    image_url TEXT,
    image_category TEXT,
    component_name TEXT,
    confidence_score DECIMAL,
    quadrant TEXT,
    detection_timestamp TIMESTAMPTZ,
    human_verified BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT
        vi.id,
        vi.filename,
        vi.image_url,
        vi.image_category,
        acd.component_name,
        acd.confidence_score,
        acd.quadrant,
        acd.detection_timestamp,
        acd.human_verified
    FROM vehicle_images vi
    JOIN ai_component_detections acd ON acd.vehicle_image_id = vi.id
    WHERE vi.vehicle_id = p_vehicle_id
    AND (p_component_name IS NULL OR acd.component_name ILIKE '%' || p_component_name || '%')
    AND (p_category IS NULL OR acd.component_category = p_category)
    AND acd.confidence_score >= p_min_confidence
    AND (NOT p_verified_only OR acd.human_verified = true)
    ORDER BY acd.confidence_score DESC, acd.detection_timestamp DESC
    LIMIT p_limit;
END;
$$;

-- Get vehicle AI scan statistics
CREATE OR REPLACE FUNCTION get_vehicle_ai_stats(p_vehicle_id UUID)
RETURNS TABLE (
    total_images INTEGER,
    scanned_images INTEGER,
    total_detections INTEGER,
    avg_components_per_image DECIMAL,
    most_detected_component TEXT,
    last_scan_session TIMESTAMPTZ,
    scan_completion_percentage DECIMAL
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT
        (SELECT COUNT(*)::INTEGER FROM vehicle_images WHERE vehicle_id = p_vehicle_id),
        COUNT(DISTINCT acd.vehicle_image_id)::INTEGER,
        COUNT(acd.id)::INTEGER,
        CASE WHEN COUNT(DISTINCT acd.vehicle_image_id) > 0
            THEN (COUNT(acd.id)::DECIMAL / COUNT(DISTINCT acd.vehicle_image_id))
            ELSE 0::DECIMAL
        END,
        (SELECT acd2.component_name
         FROM ai_component_detections acd2
         JOIN vehicle_images vi2 ON vi2.id = acd2.vehicle_image_id
         WHERE vi2.vehicle_id = p_vehicle_id
         GROUP BY acd2.component_name
         ORDER BY COUNT(*) DESC
         LIMIT 1),
        (SELECT MAX(session_start)
         FROM ai_scan_sessions
         WHERE vehicle_id = p_vehicle_id),
        CASE WHEN (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = p_vehicle_id) > 0
            THEN (COUNT(DISTINCT acd.vehicle_image_id)::DECIMAL /
                  (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = p_vehicle_id) * 100)
            ELSE 0::DECIMAL
        END
    FROM ai_component_detections acd
    JOIN vehicle_images vi ON vi.id = acd.vehicle_image_id
    WHERE vi.vehicle_id = p_vehicle_id;
END;
$$;

-- =====================================================
-- MIGRATION FUNCTION: Import existing data
-- =====================================================

CREATE OR REPLACE FUNCTION migrate_existing_ai_data()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    img_record RECORD;
    label_item TEXT;
    spatial_item JSONB;
    category_name TEXT;
    migrated_count INTEGER := 0;
BEGIN
    -- Loop through images with existing AI data
    FOR img_record IN
        SELECT id, labels, spatial_tags
        FROM vehicle_images
        WHERE (labels IS NOT NULL AND array_length(labels, 1) > 0)
           OR (spatial_tags IS NOT NULL AND array_length(spatial_tags, 1) > 0)
    LOOP
        -- Migrate from labels array
        IF img_record.labels IS NOT NULL THEN
            FOREACH label_item IN ARRAY img_record.labels
            LOOP
                -- Determine category
                category_name := CASE
                    WHEN label_item ILIKE '%engine%' OR label_item ILIKE '%ls3%' OR label_item ILIKE '%motor%' THEN 'engine'
                    WHEN label_item ILIKE '%paint%' OR label_item ILIKE '%body%' OR label_item ILIKE '%rust%' THEN 'body_work'
                    WHEN label_item ILIKE '%wheel%' OR label_item ILIKE '%tire%' OR label_item ILIKE '%brake%' THEN 'wheels_tires'
                    WHEN label_item ILIKE '%transmission%' OR label_item ILIKE '%6l90%' THEN 'transmission'
                    WHEN label_item ILIKE '%interior%' OR label_item ILIKE '%dash%' OR label_item ILIKE '%seat%' THEN 'interior'
                    WHEN label_item ILIKE '%ac %' OR label_item ILIKE '%air%' THEN 'ac_climate'
                    WHEN label_item ILIKE '%suspension%' OR label_item ILIKE '%shock%' THEN 'suspension'
                    WHEN label_item ILIKE '%fuel%' OR label_item ILIKE '%exhaust%' THEN 'fuel_exhaust'
                    WHEN label_item ILIKE '%wiring%' OR label_item ILIKE '%electrical%' THEN 'electrical'
                    WHEN label_item ILIKE '%tool%' OR label_item ILIKE '%work%' THEN 'tools_workspace'
                    ELSE NULL
                END;

                INSERT INTO ai_component_detections (
                    vehicle_image_id,
                    component_name,
                    component_category,
                    confidence_score,
                    ai_reasoning,
                    detection_timestamp
                ) VALUES (
                    img_record.id,
                    label_item,
                    category_name,
                    0.8, -- Default confidence for migrated data
                    'Migrated from existing labels data',
                    NOW()
                );

                migrated_count := migrated_count + 1;
            END LOOP;
        END IF;

        -- Migrate from spatial_tags with confidence scores
        IF img_record.spatial_tags IS NOT NULL THEN
            FOREACH spatial_item IN ARRAY img_record.spatial_tags
            LOOP
                -- Update existing detection with spatial data
                UPDATE ai_component_detections
                SET
                    quadrant = spatial_item->>'quadrant',
                    confidence_score = COALESCE((spatial_item->>'confidence')::DECIMAL, confidence_score),
                    updated_at = NOW()
                WHERE vehicle_image_id = img_record.id
                AND component_name = spatial_item->>'component';
            END LOOP;
        END IF;
    END LOOP;

    RETURN 'Migration completed. Migrated ' || migrated_count || ' component detections.';
END;
$$;

-- =====================================================
-- TRIGGERS FOR DATA CONSISTENCY
-- =====================================================

-- Update vehicle_images AI metadata when detections change
CREATE OR REPLACE FUNCTION update_image_ai_metadata()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- Update the vehicle_images table with current AI stats
    UPDATE vehicle_images
    SET
        ai_component_count = (
            SELECT COUNT(*)
            FROM ai_component_detections
            WHERE vehicle_image_id = COALESCE(NEW.vehicle_image_id, OLD.vehicle_image_id)
        ),
        ai_avg_confidence = (
            SELECT AVG(confidence_score)
            FROM ai_component_detections
            WHERE vehicle_image_id = COALESCE(NEW.vehicle_image_id, OLD.vehicle_image_id)
        ),
        ai_last_scanned = NOW()
    WHERE id = COALESCE(NEW.vehicle_image_id, OLD.vehicle_image_id);

    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trigger_update_image_ai_metadata
    AFTER INSERT OR UPDATE OR DELETE ON ai_component_detections
    FOR EACH ROW
    EXECUTE FUNCTION update_image_ai_metadata();

-- Update session statistics
CREATE OR REPLACE FUNCTION update_session_stats()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE ai_scan_sessions
        SET total_components_detected = total_components_detected + 1
        WHERE id = NEW.id; -- Assuming session_id is tracked somehow
    END IF;
    RETURN NEW;
END;
$$;

-- =====================================================
-- FINAL SETUP COMMANDS
-- =====================================================

-- Update existing vehicle_images with enhanced metadata
UPDATE vehicle_images
SET ai_scan_metadata = jsonb_build_object(
    'has_labels', CASE WHEN labels IS NOT NULL AND array_length(labels, 1) > 0 THEN true ELSE false END,
    'has_spatial', CASE WHEN spatial_tags IS NOT NULL AND array_length(spatial_tags, 1) > 0 THEN true ELSE false END,
    'legacy_migration', true
)
WHERE labels IS NOT NULL OR spatial_tags IS NOT NULL;

-- Add helpful comments
COMMENT ON TABLE ai_component_detections IS 'Stores individual AI component detections with full metadata for analytics and UI display';
COMMENT ON TABLE ai_scan_sessions IS 'Tracks AI scanning sessions for performance monitoring and cost analysis';
COMMENT ON TABLE ai_component_categories IS 'Lookup table for component categorization and UI organization';

COMMENT ON COLUMN ai_component_detections.confidence_score IS 'AI confidence level from 0.00 to 1.00';
COMMENT ON COLUMN ai_component_detections.quadrant IS 'Spatial location within image: top_left, top_right, bottom_left, bottom_right, center, full_image';
COMMENT ON COLUMN ai_component_detections.bounding_box IS 'Future: exact pixel coordinates as {x, y, width, height}';

-- Success message
SELECT 'AI Vision Schema Implementation Complete!' as status,
       'Tables created: ai_component_detections, ai_scan_sessions, ai_component_categories' as tables_created,
       'Helper functions: get_image_ai_summary(), search_images_by_component(), get_vehicle_ai_stats()' as functions_created,
       'Ready for production AI vision data storage and UI integration' as next_steps;