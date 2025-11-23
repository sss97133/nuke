-- Auto-Tag Intelligence System
-- Enables AI-powered object detection with vehicle cross-referencing

-- Add auto-tagging fields to vehicle_image_tags
ALTER TABLE vehicle_image_tags ADD COLUMN IF NOT EXISTS confidence_score DECIMAL(5,2) CHECK (confidence_score >= 0 AND confidence_score <= 100);
ALTER TABLE vehicle_image_tags ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN DEFAULT FALSE;
ALTER TABLE vehicle_image_tags ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT FALSE;
ALTER TABLE vehicle_image_tags ADD COLUMN IF NOT EXISTS linked_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL;
ALTER TABLE vehicle_image_tags ADD COLUMN IF NOT EXISTS linked_product_id UUID;
ALTER TABLE vehicle_image_tags ADD COLUMN IF NOT EXISTS object_class TEXT;
ALTER TABLE vehicle_image_tags ADD COLUMN IF NOT EXISTS detection_metadata JSONB;

-- Add indexes for auto-tag queries
CREATE INDEX IF NOT EXISTS idx_vehicle_image_tags_auto_generated ON vehicle_image_tags(auto_generated);
CREATE INDEX IF NOT EXISTS idx_vehicle_image_tags_verified ON vehicle_image_tags(verified);
CREATE INDEX IF NOT EXISTS idx_vehicle_image_tags_confidence ON vehicle_image_tags(confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_image_tags_linked_vehicle ON vehicle_image_tags(linked_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_image_tags_object_class ON vehicle_image_tags(object_class);

-- Comments for documentation
COMMENT ON COLUMN vehicle_image_tags.confidence_score IS 'AI confidence score 0-100 for auto-generated tags';
COMMENT ON COLUMN vehicle_image_tags.auto_generated IS 'True if tag was created by AI, false if manual';
COMMENT ON COLUMN vehicle_image_tags.verified IS 'True if user has verified/approved this auto-tag';
COMMENT ON COLUMN vehicle_image_tags.linked_vehicle_id IS 'Links tag to a specific vehicle profile (for cross-vehicle references)';
COMMENT ON COLUMN vehicle_image_tags.linked_product_id IS 'Links tag to a product/part (future feature)';
COMMENT ON COLUMN vehicle_image_tags.object_class IS 'Type of detected object: vehicle, trailer, clothing, logo, person, etc.';
COMMENT ON COLUMN vehicle_image_tags.detection_metadata IS 'Raw AI detection data including model, prompt, alternatives';

-- Helper function: Get vehicles owned by user at specific timestamp
CREATE OR REPLACE FUNCTION get_vehicles_at_timestamp(
  p_user_id UUID,
  p_timestamp TIMESTAMPTZ
)
RETURNS TABLE (
  vehicle_id UUID,
  year INTEGER,
  make TEXT,
  model TEXT,
  color TEXT,
  vin TEXT,
  ownership_start TIMESTAMPTZ,
  ownership_end TIMESTAMPTZ,
  is_current_owner BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    v.id,
    v.year,
    v.make,
    v.model,
    v.color,
    v.vin,
    vo.start_date,
    vo.end_date,
    vo.is_current
  FROM vehicles v
  LEFT JOIN vehicle_ownerships vo ON vo.vehicle_id = v.id
  WHERE 
    v.user_id = p_user_id
    AND (
      -- Check if owned at timestamp
      (vo.start_date IS NULL OR vo.start_date <= p_timestamp)
      AND (vo.end_date IS NULL OR vo.end_date >= p_timestamp OR vo.is_current = true)
    )
  ORDER BY vo.is_current DESC, vo.start_date DESC;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_vehicles_at_timestamp IS 'Returns all vehicles owned by user at a specific point in time';

-- Helper function: Calculate auto-tag confidence based on matches
CREATE OR REPLACE FUNCTION calculate_tag_confidence(
  p_ai_detection_confidence DECIMAL,
  p_temporal_match BOOLEAN,
  p_attribute_matches INTEGER,
  p_attribute_total INTEGER
)
RETURNS DECIMAL AS $$
DECLARE
  v_confidence DECIMAL;
BEGIN
  -- Base confidence from AI detection (0-100)
  v_confidence := p_ai_detection_confidence;
  
  -- Boost confidence if temporal match (owned vehicle at that time)
  IF p_temporal_match THEN
    v_confidence := v_confidence * 1.2;  -- 20% boost
  END IF;
  
  -- Boost confidence based on attribute matches (color, make, model)
  IF p_attribute_total > 0 THEN
    v_confidence := v_confidence * (1.0 + (p_attribute_matches::DECIMAL / p_attribute_total::DECIMAL) * 0.3);
  END IF;
  
  -- Cap at 99.99 (never 100% without human verification)
  IF v_confidence > 99.99 THEN
    v_confidence := 99.99;
  END IF;
  
  RETURN ROUND(v_confidence, 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION calculate_tag_confidence IS 'Calculates final confidence score for auto-tags based on AI + temporal + attribute matching';

-- View: High-confidence unverified tags (needs user review)
CREATE OR REPLACE VIEW unverified_auto_tags AS
SELECT 
  t.id,
  t.image_id,
  i.vehicle_id,
  t.tag_text as tag_name,
  t.object_class,
  t.confidence_score,
  t.linked_vehicle_id,
  v.year,
  v.make,
  v.model,
  i.image_url,
  i.taken_at
FROM vehicle_image_tags t
JOIN vehicle_images i ON i.id = t.image_id
LEFT JOIN vehicles v ON v.id = t.linked_vehicle_id
WHERE 
  t.auto_generated = true
  AND t.verified = false
  AND t.confidence_score >= 70  -- High confidence threshold
ORDER BY t.confidence_score DESC, t.created_at DESC;

COMMENT ON VIEW unverified_auto_tags IS 'Shows high-confidence auto-tags awaiting user verification';

