-- Cleanup bad Cars & Bids images from failed extraction on 2025-01-22
-- These images have malformed URLs (80x80 avatars, truncated paths)

-- Delete in batches to avoid timeouts
DO $$
DECLARE
  deleted_count INT := 0;
  batch_size INT := 500;
  total_deleted INT := 0;
BEGIN
  LOOP
    DELETE FROM vehicle_images
    WHERE id IN (
      SELECT id FROM vehicle_images
      WHERE exif_data->>'imported_from' = 'Cars & Bids'
      LIMIT batch_size
    );

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    total_deleted := total_deleted + deleted_count;

    RAISE NOTICE 'Deleted % images (total: %)', deleted_count, total_deleted;

    EXIT WHEN deleted_count = 0;

    -- Small pause between batches
    PERFORM pg_sleep(0.1);
  END LOOP;

  RAISE NOTICE 'Cleanup complete. Total deleted: %', total_deleted;
END $$;
