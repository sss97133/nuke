-- Photo Pipeline: DB trigger + schema additions for automated photo processing
-- Fires pg_net.http_post to photo-pipeline-orchestrator on vehicle_images INSERT

-- =============================================================================
-- 1. Register observation sources for photo pipeline
-- =============================================================================
INSERT INTO observation_sources (slug, display_name, category, base_trust_score, supported_observations)
VALUES
  ('photo_pipeline', 'Photo Pipeline (AI Vision)', 'internal', 0.70,
   ARRAY['media', 'condition', 'specification', 'work_record']::observation_kind[]),
  ('receipt_ocr', 'Receipt OCR', 'internal', 0.75,
   ARRAY['work_record', 'specification']::observation_kind[]),
  ('part_number_ocr', 'Part Number OCR', 'internal', 0.80,
   ARRAY['specification', 'media']::observation_kind[])
ON CONFLICT (slug) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  base_trust_score = EXCLUDED.base_trust_score,
  supported_observations = EXCLUDED.supported_observations;

-- =============================================================================
-- 2. Add source_image_id and source_type to vehicle_work_contributions
-- =============================================================================
ALTER TABLE vehicle_work_contributions
  ADD COLUMN IF NOT EXISTS source_image_id UUID REFERENCES vehicle_images(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_type TEXT CHECK (source_type IS NULL OR source_type IN (
    'photo_pipeline', 'receipt_ocr', 'part_number_ocr', 'manual'
  ));

COMMENT ON COLUMN vehicle_work_contributions.source_image_id IS 'Image that triggered this work contribution (photo pipeline provenance)';
COMMENT ON COLUMN vehicle_work_contributions.source_type IS 'How this contribution was created (photo_pipeline, receipt_ocr, etc.)';

-- =============================================================================
-- 3. Index for pending images (orchestrator query pattern)
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_vehicle_images_pending_processing
  ON vehicle_images (ai_processing_status, created_at)
  WHERE ai_processing_status = 'pending';

-- =============================================================================
-- 4. Trigger function: fire photo-pipeline-orchestrator on INSERT
-- =============================================================================
CREATE OR REPLACE FUNCTION trigger_photo_pipeline_orchestrator()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire for images that need processing
  IF NEW.ai_processing_status = 'pending' AND NEW.image_url IS NOT NULL THEN
    PERFORM net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/photo-pipeline-orchestrator',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.supabase_service_role_key')
      ),
      body := jsonb_build_object(
        'image_id', NEW.id,
        'image_url', NEW.image_url,
        'vehicle_id', NEW.vehicle_id,
        'user_id', NEW.user_id
      )
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- pg_net may not be available; log and continue (non-blocking)
  RAISE WARNING 'photo-pipeline trigger failed (pg_net?): %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 5. Create the trigger
-- =============================================================================
DROP TRIGGER IF EXISTS trigger_photo_pipeline_on_image_insert ON vehicle_images;
CREATE TRIGGER trigger_photo_pipeline_on_image_insert
  AFTER INSERT ON vehicle_images
  FOR EACH ROW
  WHEN (NEW.ai_processing_status = 'pending' AND NEW.is_duplicate IS NOT TRUE)
  EXECUTE FUNCTION trigger_photo_pipeline_orchestrator();

COMMENT ON FUNCTION trigger_photo_pipeline_orchestrator() IS
  'Fires photo-pipeline-orchestrator edge function when a new image is inserted with pending status';
