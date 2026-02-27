-- YONO: add interior_quality + zone_source to vehicle_images
-- interior_quality: 1-5 scale (null for non-interior photos)
-- zone_source: tracks how vehicle_zone was determined (classifier vs heuristic)

ALTER TABLE vehicle_images
  ADD COLUMN IF NOT EXISTS interior_quality smallint
    CHECK (interior_quality IS NULL OR (interior_quality BETWEEN 1 AND 5)),
  ADD COLUMN IF NOT EXISTS zone_source text;

COMMENT ON COLUMN vehicle_images.interior_quality IS
  'Interior condition rating 1-5 (1=poor, 5=excellent). NULL for non-interior photos. Written by yono-vision-worker via Florence-2 VisionHead interior_quality_head.';

COMMENT ON COLUMN vehicle_images.zone_source IS
  'How vehicle_zone was determined: zone_classifier_v1 (ZoneClassifierHead, 72.8% val_acc), photo_type_heuristic (Florence-2 photo_type → zone mapping), or manual.';
