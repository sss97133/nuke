-- Organization Image Scanning System
-- AI-powered tagging and inventory extraction from images

-- Image Tags Table
CREATE TABLE IF NOT EXISTS organization_image_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  image_id UUID REFERENCES organization_images(id) ON DELETE CASCADE NOT NULL,
  tag TEXT NOT NULL,
  tagged_by UUID REFERENCES auth.users(id),
  confidence DECIMAL(3,2) DEFAULT 0.80,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(image_id, tag)
);

-- Add AI scanning fields to organization_images
ALTER TABLE organization_images 
ADD COLUMN IF NOT EXISTS ai_scanned BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS ai_scan_date TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS ai_description TEXT,
ADD COLUMN IF NOT EXISTS ai_confidence DECIMAL(3,2);

-- Add confidence score to organization_inventory (if column doesn't exist)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'organization_inventory' 
    AND column_name = 'confidence_score'
  ) THEN
    ALTER TABLE organization_inventory ADD COLUMN confidence_score DECIMAL(3,2);
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'organization_inventory' 
    AND column_name = 'ai_extracted'
  ) THEN
    ALTER TABLE organization_inventory ADD COLUMN ai_extracted BOOLEAN DEFAULT FALSE;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'organization_inventory' 
    AND column_name = 'image_id'
  ) THEN
    ALTER TABLE organization_inventory ADD COLUMN image_id UUID REFERENCES organization_images(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_org_image_tags_org ON organization_image_tags(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_image_tags_image ON organization_image_tags(image_id);
CREATE INDEX IF NOT EXISTS idx_org_image_tags_tag ON organization_image_tags(tag);
CREATE INDEX IF NOT EXISTS idx_org_images_scanned ON organization_images(ai_scanned);
CREATE INDEX IF NOT EXISTS idx_org_inventory_image ON organization_inventory(image_id);

-- RLS Policies for organization_image_tags
ALTER TABLE organization_image_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view organization image tags"
  ON organization_image_tags FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can create tags"
  ON organization_image_tags FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update their own tags"
  ON organization_image_tags FOR UPDATE
  USING (tagged_by = auth.uid());

CREATE POLICY "Users can delete their own tags"
  ON organization_image_tags FOR DELETE
  USING (tagged_by = auth.uid());

-- Service role can do anything (for AI)
CREATE POLICY "Service role full access to tags"
  ON organization_image_tags FOR ALL
  USING (auth.role() = 'service_role');

-- Function to get image tags summary
CREATE OR REPLACE FUNCTION get_image_tags_summary(img_id UUID)
RETURNS JSON AS $$
  SELECT JSON_BUILD_OBJECT(
    'tags', COALESCE(JSON_AGG(DISTINCT tag ORDER BY tag), '[]'::JSON),
    'tag_count', COUNT(DISTINCT tag),
    'ai_extracted', COUNT(*) FILTER (WHERE confidence > 0.7),
    'user_added', COUNT(*) FILTER (WHERE confidence IS NULL OR confidence <= 0.7)
  )
  FROM organization_image_tags
  WHERE image_id = img_id;
$$ LANGUAGE SQL STABLE;

-- Function to get organization inventory from images
CREATE OR REPLACE FUNCTION get_organization_inventory_from_images(org_id UUID)
RETURNS TABLE (
  item_name TEXT,
  item_type TEXT,
  brand TEXT,
  model_number TEXT,
  total_quantity INTEGER,
  image_count INTEGER,
  avg_confidence DECIMAL,
  image_ids UUID[]
) AS $$
  SELECT 
    name as item_name,
    item_type,
    brand,
    model_number,
    SUM(quantity)::INTEGER as total_quantity,
    COUNT(DISTINCT image_id)::INTEGER as image_count,
    AVG(confidence_score) as avg_confidence,
    ARRAY_AGG(DISTINCT image_id) as image_ids
  FROM organization_inventory
  WHERE organization_id = org_id
    AND ai_extracted = true
    AND image_id IS NOT NULL
  GROUP BY name, item_type, brand, model_number
  ORDER BY total_quantity DESC, avg_confidence DESC;
$$ LANGUAGE SQL STABLE;

COMMENT ON TABLE organization_image_tags IS 'AI and user-generated tags for organization images';
COMMENT ON FUNCTION get_image_tags_summary IS 'Returns tag summary for a specific image';
COMMENT ON FUNCTION get_organization_inventory_from_images IS 'Aggregates AI-extracted inventory across all org images';

