-- Listing photos no longer fire the photo pipeline one row at a time.
--
-- trigger_photo_pipeline_on_image_insert fired net.http_post to photo-pipeline-orchestrator for every inserted
-- vehicle_images row whose ai_processing_status was 'pending' (the column default). Listing extractors insert photos
-- with is_external = true and no status, so each photo of every Craigslist, Mecum, Bonhams, Gooding ... listing fired
-- one call. Measured by skylar-83 from the function logs: 22,182 invocations in the 24 h to 2026-10-15 04:40Z, every one
-- failing at Gemini countTokens with a 404 (cost $0 only because of that 404). Vision on a listing photo is meant to be
-- a deliberate, owner-requested pass (extract-bat-core lands its photos as 'skipped').
--
-- The trigger now also requires is_external IS NOT TRUE, so it keeps firing for owner and iOS uploads (is_external
-- false or NULL) and no longer for external listing photos, whatever their status. ingest lands its photos as
-- 'skipped' as well (same PR). Nothing is deleted or updated; rows already 'pending' stay as they are.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '8s';

CREATE OR REPLACE TRIGGER trigger_photo_pipeline_on_image_insert
  AFTER INSERT ON public.vehicle_images
  FOR EACH ROW
  WHEN (new.ai_processing_status = 'pending' AND new.is_duplicate IS NOT TRUE AND new.is_external IS NOT TRUE)
  EXECUTE FUNCTION public.trigger_photo_pipeline_orchestrator();
