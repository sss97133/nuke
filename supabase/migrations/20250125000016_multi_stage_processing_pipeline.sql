-- ==========================================================================
-- MULTI-STAGE PROCESSING PIPELINE
-- ==========================================================================
-- Purpose: Create pipeline where images flow through multiple stages
-- Stage 1: Basic work detection (existing)
-- Stage 2: Detailed component extraction (new)
-- Stage 3: Advanced analysis (future)
-- ==========================================================================

-- Add processing stage tracking to image_work_extractions
ALTER TABLE image_work_extractions
ADD COLUMN IF NOT EXISTS processing_stage TEXT DEFAULT 'stage1_basic' 
  CHECK (processing_stage IN ('stage1_basic', 'stage2_detailed', 'stage3_advanced', 'complete')),
ADD COLUMN IF NOT EXISTS stage2_processed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS stage3_processed_at TIMESTAMPTZ;

-- Update status enum to include detailed extraction
ALTER TABLE image_work_extractions
DROP CONSTRAINT IF EXISTS image_work_extractions_status_check;

ALTER TABLE image_work_extractions
ADD CONSTRAINT image_work_extractions_status_check 
  CHECK (status IN ('pending', 'extracted', 'detailed_extracted', 'matched', 'approved', 'rejected'));

-- Create function to trigger Stage 2 processing
CREATE OR REPLACE FUNCTION trigger_stage2_processing()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- When Stage 1 is complete, queue for Stage 2
  IF NEW.status = 'extracted' AND NEW.processing_stage = 'stage1_basic' THEN
    -- Mark as ready for Stage 2
    NEW.processing_stage := 'stage2_detailed';
    NEW.status := 'detailed_extracted'; -- Will be updated when Stage 2 completes
    
    -- In production, this would call the edge function
    -- For now, we'll use a queue approach
    RAISE NOTICE 'Image % ready for Stage 2 detailed extraction', NEW.image_id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger to auto-queue Stage 2
DROP TRIGGER IF EXISTS trg_stage2_processing ON image_work_extractions;
CREATE TRIGGER trg_stage2_processing
  AFTER UPDATE ON image_work_extractions
  FOR EACH ROW
  WHEN (NEW.status = 'extracted' AND OLD.status != 'extracted')
  EXECUTE FUNCTION trigger_stage2_processing();

-- Create view to see processing pipeline status
CREATE OR REPLACE VIEW processing_pipeline_status AS
SELECT 
  vi.id as image_id,
  vi.vehicle_id,
  vi.image_url,
  vi.ai_processing_status as image_status,
  iwe.id as work_extraction_id,
  iwe.detected_work_type,
  iwe.processing_stage,
  iwe.status as extraction_status,
  iwe.overall_confidence,
  (SELECT COUNT(*) FROM ai_component_detections WHERE vehicle_image_id = vi.id) as components_extracted,
  iwe.processed_at as stage1_completed,
  iwe.stage2_processed_at as stage2_completed,
  iwe.stage3_processed_at as stage3_completed
FROM vehicle_images vi
LEFT JOIN image_work_extractions iwe ON iwe.image_id = vi.id
WHERE vi.vehicle_id IS NOT NULL
ORDER BY vi.created_at DESC;

COMMENT ON VIEW processing_pipeline_status IS 
  'Shows the complete processing pipeline status for each image: Stage 1 (work detection), Stage 2 (detailed components), Stage 3 (advanced analysis)';

-- Create function to get pipeline statistics
CREATE OR REPLACE FUNCTION get_pipeline_stats()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_stats JSONB;
BEGIN
  SELECT jsonb_build_object(
    'total_images', COUNT(*) FILTER (WHERE vehicle_id IS NOT NULL),
    'stage1_complete', COUNT(*) FILTER (WHERE vehicle_id IS NOT NULL AND ai_processing_status = 'complete'),
    'stage2_ready', (
      SELECT COUNT(*) 
      FROM image_work_extractions 
      WHERE status = 'extracted' AND processing_stage = 'stage2_detailed'
    ),
    'stage2_complete', (
      SELECT COUNT(*) 
      FROM image_work_extractions 
      WHERE status = 'detailed_extracted'
    ),
    'components_extracted', (
      SELECT COUNT(*) 
      FROM ai_component_detections
    ),
    'avg_components_per_image', (
      SELECT ROUND(AVG(component_count), 2)
      FROM (
        SELECT vehicle_image_id, COUNT(*) as component_count
        FROM ai_component_detections
        GROUP BY vehicle_image_id
      ) subq
    )
  ) INTO v_stats
  FROM vehicle_images;
  
  RETURN v_stats;
END;
$$;

COMMENT ON FUNCTION get_pipeline_stats() IS 
  'Returns statistics about the multi-stage processing pipeline';

