-- Nuke Barrett-Jackson auction venue map images from vehicles.image_url and primary_image_url.
-- These are venue/map images (palm_beach.jpg, scottsdale.jpg, etc.) incorrectly set as vehicle photos.
-- Affects ~926 vehicles. Batched per CLAUDE.md batched migration principle.

DO $$
DECLARE
  batch_size INT := 200;
  affected INT;
  total_fixed INT := 0;
BEGIN
  -- Clear image_url where it's a BJ AuctionSites map
  LOOP
    UPDATE vehicles
    SET image_url = NULL
    WHERE id IN (
      SELECT id FROM vehicles
      WHERE image_url LIKE '%/AuctionSites/%'
         OR image_url LIKE '%/auctionsites/%'
      LIMIT batch_size
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    total_fixed := total_fixed + affected;
    EXIT WHEN affected = 0;
    PERFORM pg_sleep(0.1);
  END LOOP;

  RAISE NOTICE 'Cleared % vehicles image_url with AuctionSites maps', total_fixed;

  -- Clear primary_image_url where it's a BJ AuctionSites map
  total_fixed := 0;
  LOOP
    UPDATE vehicles
    SET primary_image_url = NULL
    WHERE id IN (
      SELECT id FROM vehicles
      WHERE primary_image_url LIKE '%/AuctionSites/%'
         OR primary_image_url LIKE '%/auctionsites/%'
      LIMIT batch_size
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    total_fixed := total_fixed + affected;
    EXIT WHEN affected = 0;
    PERFORM pg_sleep(0.1);
  END LOOP;

  RAISE NOTICE 'Cleared % vehicles primary_image_url with AuctionSites maps', total_fixed;
END $$;

-- Also nuke these from vehicle_images table (they're not vehicle photos)
DO $$
DECLARE
  batch_size INT := 500;
  affected INT;
  total_deleted INT := 0;
BEGIN
  LOOP
    DELETE FROM vehicle_images
    WHERE id IN (
      SELECT id FROM vehicle_images
      WHERE image_url LIKE '%/AuctionSites/%'
         OR image_url LIKE '%/auctionsites/%'
      LIMIT batch_size
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    total_deleted := total_deleted + affected;
    EXIT WHEN affected = 0;
    PERFORM pg_sleep(0.1);
  END LOOP;

  RAISE NOTICE 'Deleted % vehicle_images rows with AuctionSites maps', total_deleted;
END $$;
