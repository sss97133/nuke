-- Fix polluted/misordered image galleries:
-- - Normalize taken_at for non-document images
-- - Recompute stable per-vehicle `position` ordering
-- - Enforce a single primary image per vehicle (non-doc, non-duplicate)

-- 1) Normalize timestamps for stable ordering
UPDATE vehicle_images
SET taken_at = created_at
WHERE (is_document IS NULL OR is_document = false)
  AND taken_at IS NULL;

-- 2) Recompute position (0-based) for non-document, non-duplicate images
WITH ranked AS (
  SELECT
    id,
    vehicle_id,
    ROW_NUMBER() OVER (
      PARTITION BY vehicle_id
      ORDER BY
        is_primary DESC,
        taken_at DESC NULLS LAST,
        created_at DESC,
        id ASC
    ) AS rn
  FROM vehicle_images
  WHERE vehicle_id IS NOT NULL
    AND (is_document IS NULL OR is_document = false)
    AND (is_duplicate IS NULL OR is_duplicate = false)
)
UPDATE vehicle_images vi
SET position = ranked.rn - 1
FROM ranked
WHERE vi.id = ranked.id
  AND (vi.position IS DISTINCT FROM ranked.rn - 1);

-- 3) Ensure exactly one primary image per vehicle (best-ranked becomes primary)
WITH ranked AS (
  SELECT
    id,
    vehicle_id,
    ROW_NUMBER() OVER (
      PARTITION BY vehicle_id
      ORDER BY
        is_primary DESC,
        taken_at DESC NULLS LAST,
        created_at DESC,
        id ASC
    ) AS rn
  FROM vehicle_images
  WHERE vehicle_id IS NOT NULL
    AND (is_document IS NULL OR is_document = false)
    AND (is_duplicate IS NULL OR is_duplicate = false)
),
keepers AS (
  SELECT id FROM ranked WHERE rn = 1
)
UPDATE vehicle_images
SET is_primary = (id IN (SELECT id FROM keepers))
WHERE vehicle_id IS NOT NULL
  AND (is_document IS NULL OR is_document = false)
  AND (is_duplicate IS NULL OR is_duplicate = false);

-- 4) Guardrail: enforce single primary per vehicle at the DB level
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_images_one_primary_per_vehicle_idx
ON vehicle_images (vehicle_id)
WHERE vehicle_id IS NOT NULL
  AND is_primary = true
  AND (is_document IS NULL OR is_document = false)
  AND (is_duplicate IS NULL OR is_duplicate = false);


