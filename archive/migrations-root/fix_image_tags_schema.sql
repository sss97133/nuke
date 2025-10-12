-- Fix Image Tags Table for Proper AI/Human Tag Tracking
-- This migration adds missing columns and improves the tag tracking system

-- Add missing columns for proper AI/human tag tracking
ALTER TABLE image_tags ADD COLUMN IF NOT EXISTS ai_detection_data JSONB DEFAULT '{}';
ALTER TABLE image_tags ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false;
ALTER TABLE image_tags ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE image_tags ADD COLUMN IF NOT EXISTS manual_override BOOLEAN DEFAULT false;
ALTER TABLE image_tags ADD COLUMN IF NOT EXISTS training_feedback JSONB DEFAULT '{}';
ALTER TABLE image_tags ADD COLUMN IF NOT EXISTS parent_tag_id UUID REFERENCES image_tags(id);
ALTER TABLE image_tags ADD COLUMN IF NOT EXISTS validation_status TEXT DEFAULT 'pending' CHECK (validation_status IN ('pending', 'approved', 'rejected', 'disputed', 'expert_validated'));

-- Improve existing columns
ALTER TABLE image_tags ALTER COLUMN source_type TYPE TEXT;
ALTER TABLE image_tags ALTER COLUMN source_type SET DEFAULT 'manual';
ALTER TABLE image_tags ADD CONSTRAINT source_type_check CHECK (source_type IN ('manual', 'ai', 'hybrid', 'expert', 'community'));

-- Add proper indexing for tag queries
CREATE INDEX IF NOT EXISTS idx_image_tags_source_type ON image_tags(source_type);
CREATE INDEX IF NOT EXISTS idx_image_tags_verified ON image_tags(verified);
CREATE INDEX IF NOT EXISTS idx_image_tags_validation_status ON image_tags(validation_status);
CREATE INDEX IF NOT EXISTS idx_image_tags_vehicle_source ON image_tags(vehicle_id, source_type);
CREATE INDEX IF NOT EXISTS idx_image_tags_confidence ON image_tags(automated_confidence) WHERE automated_confidence IS NOT NULL;

-- Add trigger to automatically set verification timestamps
CREATE OR REPLACE FUNCTION update_tag_verification_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.verified = true AND OLD.verified = false THEN
    NEW.verified_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_tag_verification_timestamp ON image_tags;
CREATE TRIGGER trigger_tag_verification_timestamp
  BEFORE UPDATE ON image_tags
  FOR EACH ROW
  EXECUTE FUNCTION update_tag_verification_timestamp();

-- Create a view for easy tag analysis
CREATE OR REPLACE VIEW tag_analysis_view AS
SELECT
  it.id,
  it.vehicle_id,
  it.image_url,
  it.tag_name,
  it.tag_type,
  it.source_type,
  it.confidence,
  it.automated_confidence,
  it.verified,
  it.validation_status,
  it.created_by,
  it.verified_at,
  it.manual_override,
  it.x_position,
  it.y_position,
  it.width,
  it.height,
  it.ai_detection_data,
  it.training_feedback,
  it.parent_tag_id,
  -- Check if this is an AI tag that was manually confirmed
  CASE
    WHEN it.source_type = 'ai' AND it.verified = true THEN 'ai_confirmed'
    WHEN it.source_type = 'ai' AND it.verified = false THEN 'ai_unverified'
    WHEN it.source_type = 'manual' THEN 'human_created'
    WHEN it.parent_tag_id IS NOT NULL THEN 'human_correction'
    ELSE it.source_type
  END as tag_origin_type,
  -- Calculate tag reliability score
  CASE
    WHEN it.source_type = 'expert' THEN 100
    WHEN it.source_type = 'manual' AND it.verified = true THEN 95
    WHEN it.source_type = 'ai' AND it.verified = true THEN 90
    WHEN it.source_type = 'ai' AND it.automated_confidence > 80 THEN 80
    WHEN it.source_type = 'manual' THEN 75
    ELSE COALESCE(it.automated_confidence, 50)
  END as reliability_score
FROM image_tags it;

-- Create function to handle tag conflicts and training data
CREATE OR REPLACE FUNCTION handle_tag_validation(
  tag_id UUID,
  validation_action TEXT, -- 'approve', 'reject', 'correct'
  validator_user_id UUID,
  correction_data JSONB DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  tag_record image_tags%ROWTYPE;
  result JSONB := '{}';
BEGIN
  -- Get the tag
  SELECT * INTO tag_record FROM image_tags WHERE id = tag_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tag not found');
  END IF;

  CASE validation_action
    WHEN 'approve' THEN
      -- Approve the tag
      UPDATE image_tags
      SET
        verified = true,
        validation_status = 'approved',
        verified_at = NOW()
      WHERE id = tag_id;

      -- Add positive training feedback
      UPDATE image_tags
      SET training_feedback = training_feedback ||
          jsonb_build_object(
            'validation_' || extract(epoch from now())::text,
            jsonb_build_object(
              'action', 'approved',
              'validator', validator_user_id,
              'timestamp', now()
            )
          )
      WHERE id = tag_id;

      result = jsonb_build_object('success', true, 'action', 'approved');

    WHEN 'reject' THEN
      -- Mark as rejected but keep for training
      UPDATE image_tags
      SET
        validation_status = 'rejected',
        verified_at = NOW()
      WHERE id = tag_id;

      -- Add negative training feedback
      UPDATE image_tags
      SET training_feedback = training_feedback ||
          jsonb_build_object(
            'validation_' || extract(epoch from now())::text,
            jsonb_build_object(
              'action', 'rejected',
              'validator', validator_user_id,
              'timestamp', now(),
              'reason', 'incorrect_detection'
            )
          )
      WHERE id = tag_id;

      result = jsonb_build_object('success', true, 'action', 'rejected');

    WHEN 'correct' THEN
      -- Create corrected version
      INSERT INTO image_tags (
        vehicle_id, image_url, tag_name, tag_type, source_type,
        x_position, y_position, width, height, confidence,
        created_by, verified, validation_status, parent_tag_id,
        training_feedback
      ) VALUES (
        tag_record.vehicle_id,
        tag_record.image_url,
        COALESCE((correction_data->>'tag_name')::text, tag_record.tag_name),
        COALESCE((correction_data->>'tag_type')::text, tag_record.tag_type),
        'manual',
        COALESCE((correction_data->>'x_position')::float, tag_record.x_position),
        COALESCE((correction_data->>'y_position')::float, tag_record.y_position),
        COALESCE((correction_data->>'width')::float, tag_record.width),
        COALESCE((correction_data->>'height')::float, tag_record.height),
        100,
        validator_user_id,
        true,
        'approved',
        tag_id,
        jsonb_build_object(
          'correction_' || extract(epoch from now())::text,
          jsonb_build_object(
            'action', 'manual_correction',
            'original_tag', tag_id,
            'corrections', correction_data,
            'timestamp', now()
          )
        )
      );

      -- Mark original as corrected
      UPDATE image_tags
      SET
        validation_status = 'disputed',
        manual_override = true,
        training_feedback = training_feedback ||
          jsonb_build_object(
            'correction_' || extract(epoch from now())::text,
            jsonb_build_object(
              'action', 'corrected_by_human',
              'validator', validator_user_id,
              'timestamp', now()
            )
          )
      WHERE id = tag_id;

      result = jsonb_build_object('success', true, 'action', 'corrected');

    ELSE
      result = jsonb_build_object('success', false, 'error', 'Invalid validation action');
  END CASE;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Create function to get training data for AI improvement
CREATE OR REPLACE FUNCTION get_training_data(
  vehicle_id_param UUID DEFAULT NULL,
  limit_count INTEGER DEFAULT 1000
) RETURNS TABLE (
  tag_id UUID,
  image_url TEXT,
  tag_name TEXT,
  tag_type TEXT,
  ai_prediction JSONB,
  human_validation JSONB,
  training_value INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    it.id as tag_id,
    it.image_url,
    it.tag_name,
    it.tag_type,
    CASE
      WHEN it.source_type = 'ai' THEN
        jsonb_build_object(
          'confidence', it.automated_confidence,
          'detection_data', it.ai_detection_data,
          'position', jsonb_build_object(
            'x', it.x_position, 'y', it.y_position,
            'width', it.width, 'height', it.height
          )
        )
      ELSE NULL
    END as ai_prediction,
    CASE
      WHEN it.verified = true THEN
        jsonb_build_object('validation', 'approved', 'timestamp', it.verified_at)
      WHEN it.validation_status = 'rejected' THEN
        jsonb_build_object('validation', 'rejected', 'timestamp', it.verified_at)
      WHEN it.manual_override = true THEN
        jsonb_build_object('validation', 'corrected', 'timestamp', it.verified_at)
      ELSE NULL
    END as human_validation,
    -- Training value: higher for validated tags, corrections, and conflicts
    CASE
      WHEN it.manual_override = true THEN 100  -- Highest value: human corrections
      WHEN it.verified = true AND it.source_type = 'ai' THEN 90  -- AI confirmed by human
      WHEN it.validation_status = 'rejected' THEN 85  -- Negative examples
      WHEN it.source_type = 'manual' THEN 80  -- Human created
      ELSE 50
    END as training_value
  FROM image_tags it
  WHERE (vehicle_id_param IS NULL OR it.vehicle_id = vehicle_id_param)
    AND (it.training_feedback != '{}' OR it.verified IS NOT NULL OR it.manual_override = true)
  ORDER BY
    CASE
      WHEN it.manual_override = true THEN 1
      WHEN it.verified = true AND it.source_type = 'ai' THEN 2
      WHEN it.validation_status = 'rejected' THEN 3
      ELSE 4
    END,
    it.updated_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Add comments for documentation
COMMENT ON COLUMN image_tags.source_type IS 'Origin of the tag: manual (human), ai (automated), hybrid (AI+human), expert (professional), community (crowd-sourced)';
COMMENT ON COLUMN image_tags.verified IS 'Whether tag has been validated by a human';
COMMENT ON COLUMN image_tags.manual_override IS 'True if a human corrected an AI tag';
COMMENT ON COLUMN image_tags.ai_detection_data IS 'Raw data from AI detection system (Rekognition, etc.)';
COMMENT ON COLUMN image_tags.training_feedback IS 'Validation actions and corrections for AI training';
COMMENT ON COLUMN image_tags.parent_tag_id IS 'References original tag if this is a correction';
COMMENT ON COLUMN image_tags.validation_status IS 'Current validation state in the review workflow';

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_image_tags_training_value ON image_tags(
  CASE
    WHEN manual_override = true THEN 100
    WHEN verified = true AND source_type = 'ai' THEN 90
    WHEN validation_status = 'rejected' THEN 85
    WHEN source_type = 'manual' THEN 80
    ELSE 50
  END DESC
) WHERE training_feedback != '{}' OR verified IS NOT NULL OR manual_override = true;

COMMENT ON TABLE image_tags IS 'Stores both AI-generated and human-created image tags with full validation tracking for training data';
COMMENT ON VIEW tag_analysis_view IS 'Unified view of all tags with computed reliability scores and origin tracking';
COMMENT ON FUNCTION handle_tag_validation IS 'Processes tag validation actions and maintains training data';
COMMENT ON FUNCTION get_training_data IS 'Retrieves high-quality training data for AI model improvement';