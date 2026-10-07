-- COMPREHENSIVE IMAGE TAGGING SYSTEM FIX
-- Addresses critical schema issues and over-engineering

-- 1. CREATE SIMPLIFIED IMAGE TAGS TABLE
DROP TABLE IF EXISTS vehicle_image_tags CASCADE;

CREATE TABLE vehicle_image_tags (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    image_id UUID NOT NULL REFERENCES vehicle_images(id) ON DELETE CASCADE,
    tag_text TEXT NOT NULL,
    tag_type VARCHAR(50) DEFAULT 'general',
    x_position DECIMAL(5,4), -- For spatial tagging (0.0 to 1.0)
    y_position DECIMAL(5,4), -- For spatial tagging (0.0 to 1.0)
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure no duplicate tags on same image
    UNIQUE(image_id, tag_text, x_position, y_position)
);

-- Indexes for performance
CREATE INDEX idx_vehicle_image_tags_image_id ON vehicle_image_tags(image_id);
CREATE INDEX idx_vehicle_image_tags_text ON vehicle_image_tags(tag_text);
CREATE INDEX idx_vehicle_image_tags_type ON vehicle_image_tags(tag_type);
CREATE INDEX idx_vehicle_image_tags_spatial ON vehicle_image_tags(image_id, x_position, y_position);

-- 2. MIGRATE EXISTING TAGS FROM OVER-ENGINEERED TABLE
INSERT INTO vehicle_image_tags (image_id, tag_text, tag_type, x_position, y_position, created_by, created_at)
SELECT
    image_id,
    text as tag_text,
    COALESCE(tag_type, 'general') as tag_type,
    x_position,
    y_position,
    CASE
        WHEN created_by IS NOT NULL AND created_by ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN created_by::UUID
        ELSE NULL
    END as created_by,
    inserted_at as created_at
FROM image_tags
WHERE image_id IS NOT NULL AND text IS NOT NULL
ON CONFLICT (image_id, tag_text, x_position, y_position) DO NOTHING;

-- 3. CREATE CLEAN TAG CATEGORIES TABLE
DROP TABLE IF EXISTS tag_categories CASCADE;

CREATE TABLE tag_categories (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    color_hex CHAR(7) DEFAULT '#007bff', -- For UI theming
    icon_name VARCHAR(50), -- For UI icons
    is_system BOOLEAN DEFAULT FALSE, -- System vs user-created
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CHECK (color_hex ~ '^#[0-9A-Fa-f]{6}$')
);

-- Insert common tag categories
INSERT INTO tag_categories (name, description, color_hex, icon_name, is_system) VALUES
('general', 'General vehicle components', '#6c757d', 'tag', true),
('engine', 'Engine and powertrain', '#dc3545', 'engine', true),
('body', 'Body panels and exterior', '#007bff', 'car', true),
('interior', 'Interior components', '#28a745', 'car-seat', true),
('wheels', 'Wheels and tires', '#ffc107', 'wheel', true),
('damage', 'Damage assessment', '#fd7e14', 'alert-triangle', true),
('modification', 'Custom modifications', '#6f42c1', 'wrench', true),
('maintenance', 'Service and repair', '#20c997', 'tool', true);

-- 4. ADD TAG CATEGORY RELATIONSHIP
ALTER TABLE vehicle_image_tags
ADD COLUMN category_id UUID REFERENCES tag_categories(id),
ADD CONSTRAINT fk_tag_category FOREIGN KEY (category_id) REFERENCES tag_categories(id);

-- Update existing tags with categories
UPDATE vehicle_image_tags
SET category_id = tc.id
FROM tag_categories tc
WHERE vehicle_image_tags.tag_type = tc.name;

-- 5. CREATE VIEW FOR EASY TAG QUERYING
CREATE OR REPLACE VIEW vehicle_images_with_tags_view AS
SELECT
    vi.id,
    vi.vehicle_id,
    vi.image_url,
    vi.category,
    vi.file_name,
    vi.caption,
    vi.is_primary,
    vi.created_at,

    -- Aggregate tags
    COALESCE(array_agg(DISTINCT vit.tag_text) FILTER (WHERE vit.tag_text IS NOT NULL), '{}') as tags,
    COALESCE(array_agg(DISTINCT tc.name) FILTER (WHERE tc.name IS NOT NULL), '{}') as tag_categories,
    COUNT(vit.id) as tag_count,

    -- Spatial tags (for click-to-tag functionality)
    COALESCE(
        json_agg(
            json_build_object(
                'text', vit.tag_text,
                'x', vit.x_position,
                'y', vit.y_position,
                'category', tc.name,
                'color', tc.color_hex
            )
        ) FILTER (WHERE vit.x_position IS NOT NULL AND vit.y_position IS NOT NULL),
        '[]'::json
    ) as spatial_tags

FROM vehicle_images vi
LEFT JOIN vehicle_image_tags vit ON vi.id = vit.image_id
LEFT JOIN tag_categories tc ON vit.category_id = tc.id
GROUP BY vi.id, vi.vehicle_id, vi.image_url, vi.category, vi.file_name, vi.caption, vi.is_primary, vi.created_at;

-- 6. CREATE FUNCTIONS FOR TAG MANAGEMENT
CREATE OR REPLACE FUNCTION add_image_tag(
    p_image_id UUID,
    p_tag_text TEXT,
    p_tag_type VARCHAR(50) DEFAULT 'general',
    p_x_position DECIMAL DEFAULT NULL,
    p_y_position DECIMAL DEFAULT NULL,
    p_user_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    tag_id UUID;
    category_id UUID;
BEGIN
    -- Get category ID
    SELECT id INTO category_id
    FROM tag_categories
    WHERE name = p_tag_type;

    -- Insert tag
    INSERT INTO vehicle_image_tags (
        image_id,
        tag_text,
        tag_type,
        x_position,
        y_position,
        category_id,
        created_by
    ) VALUES (
        p_image_id,
        p_tag_text,
        p_tag_type,
        p_x_position,
        p_y_position,
        category_id,
        p_user_id
    )
    RETURNING id INTO tag_id;

    RETURN tag_id;
END;
$$;

-- 7. CLEANUP: Drop the over-engineered table after migration
-- DROP TABLE IF EXISTS image_tags CASCADE;

-- 8. ENABLE RLS (if needed)
ALTER TABLE vehicle_image_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tag_categories ENABLE ROW LEVEL SECURITY;

-- Basic RLS policies (adjust as needed)
CREATE POLICY "Anyone can read tags" ON vehicle_image_tags FOR SELECT USING (true);
CREATE POLICY "Authenticated users can add tags" ON vehicle_image_tags FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Users can edit their own tags" ON vehicle_image_tags FOR UPDATE USING (created_by = auth.uid());
CREATE POLICY "Users can delete their own tags" ON vehicle_image_tags FOR DELETE USING (created_by = auth.uid());

CREATE POLICY "Anyone can read tag categories" ON tag_categories FOR SELECT USING (true);
CREATE POLICY "Only admins can modify tag categories" ON tag_categories FOR ALL USING (auth.role() = 'service_role');

-- 9. GRANT PERMISSIONS
GRANT SELECT, INSERT, UPDATE, DELETE ON vehicle_image_tags TO authenticated;
GRANT SELECT ON tag_categories TO authenticated;
GRANT EXECUTE ON FUNCTION add_image_tag TO authenticated;

-- Summary query to show the improvement
SELECT
    'BEFORE (image_tags)' as table_info,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'image_tags') as column_count,
    (SELECT COUNT(*) FROM image_tags) as row_count
UNION ALL
SELECT
    'AFTER (vehicle_image_tags)' as table_info,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'vehicle_image_tags') as column_count,
    (SELECT COUNT(*) FROM vehicle_image_tags) as row_count;