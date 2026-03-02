-- Backfill primary_image_url for vehicles that have images but no thumbnail
-- Runs in batches of batch_size (default 10000) to avoid long locks
CREATE OR REPLACE FUNCTION backfill_primary_image_urls(batch_size INT DEFAULT 10000)
RETURNS TABLE(updated_count BIGINT, remaining_count BIGINT) AS $$
DECLARE
  v_updated BIGINT;
  v_remaining BIGINT;
BEGIN
  -- Update a batch of vehicles that have NULL primary_image_url
  -- but DO have at least one image in vehicle_images
  WITH batch AS (
    SELECT v.id AS vehicle_id
    FROM vehicles v
    WHERE v.primary_image_url IS NULL
      AND EXISTS (
        SELECT 1 FROM vehicle_images vi WHERE vi.vehicle_id = v.id
      )
    LIMIT batch_size
  ),
  first_images AS (
    SELECT DISTINCT ON (b.vehicle_id)
      b.vehicle_id,
      vi.image_url
    FROM batch b
    JOIN vehicle_images vi ON vi.vehicle_id = b.vehicle_id
    ORDER BY b.vehicle_id, vi.created_at ASC
  ),
  do_update AS (
    UPDATE vehicles v
    SET primary_image_url = fi.image_url,
        updated_at = NOW()
    FROM first_images fi
    WHERE v.id = fi.vehicle_id
    RETURNING v.id
  )
  SELECT COUNT(*) INTO v_updated FROM do_update;

  -- Count remaining
  SELECT COUNT(*) INTO v_remaining
  FROM vehicles v
  WHERE v.primary_image_url IS NULL
    AND EXISTS (
      SELECT 1 FROM vehicle_images vi WHERE vi.vehicle_id = v.id
    );

  updated_count := v_updated;
  remaining_count := v_remaining;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;
