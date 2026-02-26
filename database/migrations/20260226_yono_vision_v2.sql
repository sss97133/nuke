-- YONO Vision V2: Vehicle image condition assessment columns
-- Adds vision analysis outputs to vehicle_images table.
--
-- These fields are written by the yono-analyze edge function after Florence-2
-- inference via the local YONO sidecar. They represent what TEXT CANNOT tell you:
-- condition, damage, modifications, photo quality.
--
-- Owned by: yono-analyze edge function / VisionAnalyzer
-- Do not write directly — use yono-analyze or update via the sidecar's /analyze endpoint.

-- Add vision analysis columns to vehicle_images
ALTER TABLE vehicle_images
  ADD COLUMN IF NOT EXISTS condition_score         smallint
    CHECK (condition_score BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS damage_flags            text[]      DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS modification_flags      text[]      DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS photo_quality_score     smallint
    CHECK (photo_quality_score BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS vision_analyzed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS vision_model_version    text;

-- Index for querying by condition (useful for finding "rough" or "excellent" cars)
CREATE INDEX IF NOT EXISTS idx_vehicle_images_condition_score
  ON vehicle_images (condition_score)
  WHERE condition_score IS NOT NULL;

-- Index for damage flag queries (e.g., find all images with rust)
CREATE INDEX IF NOT EXISTS idx_vehicle_images_damage_flags
  ON vehicle_images USING gin(damage_flags)
  WHERE damage_flags IS NOT NULL AND damage_flags != '{}';

-- Index for modification flag queries
CREATE INDEX IF NOT EXISTS idx_vehicle_images_mod_flags
  ON vehicle_images USING gin(modification_flags)
  WHERE modification_flags IS NOT NULL AND modification_flags != '{}';

-- Index for finding unanalyzed images (photo_quality_score IS NULL)
CREATE INDEX IF NOT EXISTS idx_vehicle_images_pending_vision
  ON vehicle_images (id)
  WHERE vision_analyzed_at IS NULL;

-- Add column comments for pipeline registry awareness
COMMENT ON COLUMN vehicle_images.condition_score IS
  'Overall exterior condition 1-5 (1=junk, 3=driver, 5=show quality). Written by yono-analyze via Florence-2 VisionAnalyzer.';

COMMENT ON COLUMN vehicle_images.damage_flags IS
  'Detected damage types: rust, dent, crack, paint_fade, broken_glass, missing_parts, accident_damage. Written by yono-analyze.';

COMMENT ON COLUMN vehicle_images.modification_flags IS
  'Detected modifications: lift_kit, lowered, aftermarket_wheels, roll_cage, engine_swap, body_kit, exhaust_mod, suspension_mod. Written by yono-analyze.';

COMMENT ON COLUMN vehicle_images.photo_quality_score IS
  'Photo usefulness 1-5 (1=unusable/blurry, 3=adequate, 5=excellent). Written by yono-analyze. Use to filter out low-quality images.';

COMMENT ON COLUMN vehicle_images.vision_analyzed_at IS
  'Timestamp when yono-analyze last processed this image. NULL means not yet analyzed.';

COMMENT ON COLUMN vehicle_images.vision_model_version IS
  'Which model produced the analysis: finetuned_v2 (Florence-2 fine-tuned) or zeroshot_florence2 (zero-shot captioning).';

-- Register new columns in pipeline_registry (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pipeline_registry') THEN
    INSERT INTO pipeline_registry (table_name, column_name, owned_by, do_not_write_directly, write_via, description)
    VALUES
      ('vehicle_images', 'condition_score', 'yono-analyze', true, 'yono-analyze edge function or VisionAnalyzer sidecar', 'Vehicle exterior condition 1-5 from Florence-2 vision model'),
      ('vehicle_images', 'damage_flags', 'yono-analyze', true, 'yono-analyze edge function or VisionAnalyzer sidecar', 'Multi-label damage detection from vision model'),
      ('vehicle_images', 'modification_flags', 'yono-analyze', true, 'yono-analyze edge function or VisionAnalyzer sidecar', 'Multi-label modification detection from vision model'),
      ('vehicle_images', 'photo_quality_score', 'yono-analyze', true, 'yono-analyze edge function or VisionAnalyzer sidecar', 'Photo usefulness score 1-5 from vision model'),
      ('vehicle_images', 'vision_analyzed_at', 'yono-analyze', true, 'yono-analyze edge function', 'Timestamp of last vision analysis'),
      ('vehicle_images', 'vision_model_version', 'yono-analyze', true, 'yono-analyze edge function', 'Model version used for analysis (finetuned_v2 or zeroshot_florence2)')
    ON CONFLICT (table_name, column_name) DO UPDATE
      SET owned_by = EXCLUDED.owned_by,
          description = EXCLUDED.description,
          write_via = EXCLUDED.write_via;
  END IF;
END $$;
