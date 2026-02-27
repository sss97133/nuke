-- YONO Vision Worker infrastructure
-- Adds yono_queued_at for distributed locking + claim_yono_vision_batch RPC

-- Lock column: set when claimed, cleared when analysis written
ALTER TABLE vehicle_images
  ADD COLUMN IF NOT EXISTS yono_queued_at timestamptz;

-- Index for efficient queue scan
CREATE INDEX IF NOT EXISTS idx_vehicle_images_yono_pending
  ON vehicle_images (created_at DESC)
  WHERE vision_analyzed_at IS NULL
    AND image_url IS NOT NULL;

-- Atomic claim function — uses FOR UPDATE SKIP LOCKED to prevent double-processing.
-- Stale claims (yono_queued_at older than p_stale_minutes) are re-eligible.
CREATE OR REPLACE FUNCTION claim_yono_vision_batch(
  p_batch_size     integer DEFAULT 10,
  p_stale_minutes  integer DEFAULT 10
)
RETURNS TABLE (id uuid, image_url text)
LANGUAGE sql
AS $$
  WITH eligible AS (
    SELECT vi.id
    FROM vehicle_images vi
    WHERE vi.vision_analyzed_at IS NULL
      AND vi.image_url IS NOT NULL
      AND (
        vi.yono_queued_at IS NULL
        OR vi.yono_queued_at < now() - (p_stale_minutes || ' minutes')::interval
      )
    ORDER BY vi.created_at DESC NULLS LAST
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE vehicle_images vi
    SET yono_queued_at = now()
    FROM eligible
    WHERE vi.id = eligible.id
    RETURNING vi.id, vi.image_url
  )
  SELECT id, image_url FROM claimed;
$$;
