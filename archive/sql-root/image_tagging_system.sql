-- Image Tagging System
-- Manual and automated tagging for images across all sources

-- Create tag types enum
DO $$ BEGIN
    CREATE TYPE tag_type AS ENUM ('part', 'tool', 'brand', 'process', 'issue', 'custom');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Image tags table - works for any image source
CREATE TABLE IF NOT EXISTS image_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Image identification (one of these must be provided)
    image_id UUID, -- For standalone images from vehicle_images table
    timeline_event_id UUID REFERENCES timeline_events(id) ON DELETE CASCADE,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL, -- Always store the image URL for reference

    -- Tag information
    tag_name TEXT NOT NULL,
    tag_type tag_type NOT NULL DEFAULT 'custom',

    -- Position and size (as percentages of image dimensions)
    x_position DECIMAL(5,2) NOT NULL CHECK (x_position >= 0 AND x_position <= 100),
    y_position DECIMAL(5,2) NOT NULL CHECK (y_position >= 0 AND y_position <= 100),
    width DECIMAL(5,2) NOT NULL CHECK (width > 0 AND width <= 100),
    height DECIMAL(5,2) NOT NULL CHECK (height > 0 AND height <= 100),

    -- Tag metadata
    confidence INTEGER DEFAULT 100 CHECK (confidence >= 0 AND confidence <= 100),
    created_by UUID NOT NULL REFERENCES auth.users(id),
    verified BOOLEAN DEFAULT TRUE, -- Manual tags are verified, AI tags need verification

    -- Additional data for AI tags
    ai_detection_data JSONB DEFAULT '{}',
    manual_override BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure we have at least one image reference
    CONSTRAINT image_reference_check CHECK (
        image_id IS NOT NULL OR
        timeline_event_id IS NOT NULL
    )
);

-- Global tag vocabulary for consistency and suggestions
CREATE TABLE IF NOT EXISTS tag_vocabulary (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag_name TEXT UNIQUE NOT NULL,
    tag_type tag_type NOT NULL,
    category TEXT, -- subcategory like 'engine_parts', 'body_work', etc.

    -- Usage statistics
    usage_count INTEGER DEFAULT 0,
    created_by UUID REFERENCES auth.users(id),

    -- Synonyms and related tags
    aliases TEXT[] DEFAULT '{}',
    related_tags TEXT[] DEFAULT '{}',

    -- Approval status for consistency
    approved BOOLEAN DEFAULT FALSE,
    approved_by UUID REFERENCES auth.users(id),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tag suggestions based on image context
CREATE TABLE IF NOT EXISTS tag_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    image_url TEXT NOT NULL,
    timeline_event_id UUID REFERENCES timeline_events(id),
    vehicle_id UUID REFERENCES vehicles(id),

    -- Suggested tags from AI analysis
    suggested_tags JSONB NOT NULL, -- Array of {tag_name, confidence, bounding_box}
    ai_model TEXT DEFAULT 'rekognition', -- Which AI service generated suggestions

    -- Processing status
    processed BOOLEAN DEFAULT TRUE,
    processing_error TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Image analysis cache to avoid reprocessing
CREATE TABLE IF NOT EXISTS image_analysis_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    image_url TEXT UNIQUE NOT NULL,
    image_hash TEXT, -- Hash of image content to detect changes

    -- Analysis results from various services
    rekognition_data JSONB DEFAULT '{}',
    custom_analysis JSONB DEFAULT '{}',

    -- Cache metadata
    last_analyzed TIMESTAMPTZ DEFAULT NOW(),
    analysis_version INTEGER DEFAULT 1,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Functions for tag management

-- Function to get tag suggestions for an image
CREATE OR REPLACE FUNCTION get_tag_suggestions(target_image_url TEXT)
RETURNS TABLE (
    tag_name TEXT,
    tag_type tag_type,
    confidence INTEGER,
    category TEXT
) AS $$
BEGIN
    -- Return a combination of:
    -- 1. Popular tags from similar images
    -- 2. Tags from AI analysis
    -- 3. Common tags for the vehicle type if applicable

    RETURN QUERY
    WITH popular_tags AS (
        SELECT
            tv.tag_name,
            tv.tag_type,
            tv.usage_count as confidence,
            tv.category
        FROM tag_vocabulary tv
        WHERE tv.approved = true
        AND tv.usage_count > 5
        ORDER BY tv.usage_count DESC
        LIMIT 20
    ),
    context_tags AS (
        SELECT DISTINCT
            it.tag_name,
            it.tag_type,
            90 as confidence,
            'contextual' as category
        FROM image_tags it
        JOIN timeline_events te1 ON it.timeline_event_id = te1.id
        JOIN timeline_events te2 ON te1.vehicle_id = te2.vehicle_id
        WHERE te2.image_urls @> ARRAY[target_image_url]
        AND it.verified = true
        LIMIT 10
    )
    SELECT * FROM popular_tags
    UNION ALL
    SELECT * FROM context_tags
    ORDER BY confidence DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to update tag vocabulary usage
CREATE OR REPLACE FUNCTION update_tag_usage(tag_name_param TEXT, tag_type_param tag_type)
RETURNS VOID AS $$
BEGIN
    INSERT INTO tag_vocabulary (tag_name, tag_type, usage_count, approved)
    VALUES (tag_name_param, tag_type_param, 1, false)
    ON CONFLICT (tag_name) DO UPDATE SET
        usage_count = tag_vocabulary.usage_count + 1,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Function to find images with specific tags
CREATE OR REPLACE FUNCTION find_images_by_tags(tag_names TEXT[])
RETURNS TABLE (
    image_url TEXT,
    vehicle_id UUID,
    timeline_event_id UUID,
    tags_matched INTEGER,
    total_tags INTEGER,
    match_percentage DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        it.image_url,
        it.vehicle_id,
        it.timeline_event_id,
        COUNT(*) FILTER (WHERE it.tag_name = ANY(tag_names))::INTEGER as tags_matched,
        COUNT(*)::INTEGER as total_tags,
        (COUNT(*) FILTER (WHERE it.tag_name = ANY(tag_names))::DECIMAL / COUNT(*) * 100) as match_percentage
    FROM image_tags it
    WHERE it.verified = true
    GROUP BY it.image_url, it.vehicle_id, it.timeline_event_id
    HAVING COUNT(*) FILTER (WHERE it.tag_name = ANY(tag_names)) > 0
    ORDER BY match_percentage DESC, tags_matched DESC;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update timeline event tags when image tags change
CREATE OR REPLACE FUNCTION update_timeline_tags_trigger()
RETURNS TRIGGER AS $$
DECLARE
    event_tags TEXT[];
BEGIN
    -- Get event ID from NEW or OLD record
    IF TG_OP = 'DELETE' THEN
        IF OLD.timeline_event_id IS NOT NULL THEN
            -- Get all remaining tags for this timeline event
            SELECT ARRAY_AGG(DISTINCT tag_name) INTO event_tags
            FROM image_tags
            WHERE timeline_event_id = OLD.timeline_event_id
            AND id != OLD.id;

            -- Update timeline event
            UPDATE timeline_events
            SET manual_tags = COALESCE(event_tags, '{}'),
                updated_at = NOW()
            WHERE id = OLD.timeline_event_id;
        END IF;
        RETURN OLD;
    ELSE
        IF NEW.timeline_event_id IS NOT NULL THEN
            -- Get all tags for this timeline event
            SELECT ARRAY_AGG(DISTINCT tag_name) INTO event_tags
            FROM image_tags
            WHERE timeline_event_id = NEW.timeline_event_id;

            -- Update timeline event
            UPDATE timeline_events
            SET manual_tags = COALESCE(event_tags, '{}'),
                updated_at = NOW()
            WHERE id = NEW.timeline_event_id;
        END IF;
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DO $$ BEGIN
    CREATE TRIGGER trigger_update_timeline_tags
    AFTER INSERT OR UPDATE OR DELETE ON image_tags
    FOR EACH ROW EXECUTE FUNCTION update_timeline_tags_trigger();
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Trigger to update tag vocabulary usage
CREATE OR REPLACE FUNCTION update_vocabulary_usage_trigger()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM update_tag_usage(NEW.tag_name, NEW.tag_type);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create vocabulary trigger
DO $$ BEGIN
    CREATE TRIGGER trigger_update_vocabulary_usage
    AFTER INSERT ON image_tags
    FOR EACH ROW EXECUTE FUNCTION update_vocabulary_usage_trigger();
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_image_tags_image_id ON image_tags(image_id);
CREATE INDEX IF NOT EXISTS idx_image_tags_timeline_event ON image_tags(timeline_event_id);
CREATE INDEX IF NOT EXISTS idx_image_tags_vehicle ON image_tags(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_image_tags_url ON image_tags(image_url);
CREATE INDEX IF NOT EXISTS idx_image_tags_tag_name ON image_tags(tag_name);
CREATE INDEX IF NOT EXISTS idx_image_tags_tag_type ON image_tags(tag_type);
CREATE INDEX IF NOT EXISTS idx_image_tags_created_by ON image_tags(created_by);

CREATE INDEX IF NOT EXISTS idx_tag_vocabulary_name ON tag_vocabulary(tag_name);
CREATE INDEX IF NOT EXISTS idx_tag_vocabulary_type ON tag_vocabulary(tag_type);
CREATE INDEX IF NOT EXISTS idx_tag_vocabulary_usage ON tag_vocabulary(usage_count DESC);

CREATE INDEX IF NOT EXISTS idx_image_analysis_url ON image_analysis_cache(image_url);
CREATE INDEX IF NOT EXISTS idx_image_analysis_hash ON image_analysis_cache(image_hash);

-- RLS Policies
ALTER TABLE image_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tag_vocabulary ENABLE ROW LEVEL SECURITY;
ALTER TABLE tag_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_analysis_cache ENABLE ROW LEVEL SECURITY;

-- Image tags are publicly viewable but only editable by creator
CREATE POLICY "Image tags are publicly viewable" ON image_tags FOR SELECT USING (true);
CREATE POLICY "Users can create image tags" ON image_tags FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Users can update their own tags" ON image_tags FOR UPDATE USING (auth.uid() = created_by);
CREATE POLICY "Users can delete their own tags" ON image_tags FOR DELETE USING (auth.uid() = created_by);

-- Tag vocabulary policies
CREATE POLICY "Tag vocabulary is publicly viewable" ON tag_vocabulary FOR SELECT USING (true);
CREATE POLICY "Authenticated users can suggest tags" ON tag_vocabulary FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Tag suggestions and analysis cache are publicly viewable
CREATE POLICY "Tag suggestions are publicly viewable" ON tag_suggestions FOR SELECT USING (true);
CREATE POLICY "Image analysis is publicly viewable" ON image_analysis_cache FOR SELECT USING (true);

-- Insert some initial tag vocabulary
INSERT INTO tag_vocabulary (tag_name, tag_type, category, approved, usage_count) VALUES
-- Parts
('Engine', 'part', 'powertrain', true, 50),
('Transmission', 'part', 'powertrain', true, 30),
('Differential', 'part', 'powertrain', true, 20),
('Carburetor', 'part', 'fuel_system', true, 25),
('Headers', 'part', 'exhaust', true, 40),
('Exhaust', 'part', 'exhaust', true, 35),
('Suspension', 'part', 'chassis', true, 45),
('Brakes', 'part', 'chassis', true, 50),
('Interior', 'part', 'body', true, 30),
('Dashboard', 'part', 'body', true, 25),
('Seats', 'part', 'body', true, 20),
('Hood', 'part', 'body', true, 35),
('Fender', 'part', 'body', true, 30),
('Door', 'part', 'body', true, 25),
('Bumper', 'part', 'body', true, 40),

-- Tools
('Wrench', 'tool', 'hand_tools', true, 60),
('Screwdriver', 'tool', 'hand_tools', true, 55),
('Socket Set', 'tool', 'hand_tools', true, 50),
('Jack', 'tool', 'lifting', true, 45),
('Jack Stand', 'tool', 'lifting', true, 40),
('Lift', 'tool', 'lifting', true, 30),
('Welder', 'tool', 'fabrication', true, 35),
('Grinder', 'tool', 'fabrication', true, 40),
('Drill', 'tool', 'power_tools', true, 45),
('Air Compressor', 'tool', 'pneumatic', true, 25),

-- Brands
('Snap-On', 'brand', 'tools', true, 40),
('Mac Tools', 'brand', 'tools', true, 25),
('Craftsman', 'brand', 'tools', true, 35),
('Milwaukee', 'brand', 'power_tools', true, 30),
('DeWalt', 'brand', 'power_tools', true, 28),
('Chevrolet', 'brand', 'oem', true, 50),
('Ford', 'brand', 'oem', true, 45),
('Holley', 'brand', 'performance', true, 30),
('Edelbrock', 'brand', 'performance', true, 25),

-- Processes
('Installation', 'process', 'assembly', true, 60),
('Removal', 'process', 'disassembly', true, 55),
('Cleaning', 'process', 'maintenance', true, 50),
('Painting', 'process', 'finishing', true, 40),
('Welding', 'process', 'fabrication', true, 35),
('Testing', 'process', 'quality', true, 30),
('Alignment', 'process', 'adjustment', true, 25),

-- Issues
('Rust', 'issue', 'corrosion', true, 50),
('Damage', 'issue', 'physical', true, 45),
('Wear', 'issue', 'deterioration', true, 40),
('Leak', 'issue', 'fluid', true, 35),
('Crack', 'issue', 'structural', true, 30),
('Missing', 'issue', 'incomplete', true, 25)

ON CONFLICT (tag_name) DO UPDATE SET
    usage_count = GREATEST(tag_vocabulary.usage_count, EXCLUDED.usage_count),
    approved = EXCLUDED.approved;

COMMIT;