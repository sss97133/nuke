-- Guardrail: enforce single primary image per vehicle at the DB level
-- Applies only to non-document, non-duplicate images.
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_images_one_primary_per_vehicle_idx
ON vehicle_images (vehicle_id)
WHERE vehicle_id IS NOT NULL
  AND is_primary = true
  AND (is_document IS NULL OR is_document = false)
  AND (is_duplicate IS NULL OR is_duplicate = false);


