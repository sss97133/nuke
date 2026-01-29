-- Fix vehicle 992fb704-85d4-4358-9631-8f11fe9b5f47: wrong lead image + missing VIN
-- Run in Supabase SQL Editor. For VIN backfill you must re-run bat-simple-extract (see step 2).

-- Step 1: Repair BaT gallery (clears wrong primary, marks UI assets as duplicate, sets primary to first canonical image)
SELECT repair_bat_vehicle_gallery_images('992fb704-85d4-4358-9631-8f11fe9b5f47'::uuid, false);

-- Step 1b: Sync vehicles.primary_image_url from the image that is now is_primary
UPDATE vehicles v
SET
  primary_image_url = (
    SELECT vi.image_url
    FROM vehicle_images vi
    WHERE vi.vehicle_id = v.id
      AND COALESCE(vi.is_document, false) = false
      AND COALESCE(vi.is_duplicate, false) = false
      AND vi.is_primary = true
    LIMIT 1
  ),
  updated_at = NOW()
WHERE v.id = '992fb704-85d4-4358-9631-8f11fe9b5f47'
  AND EXISTS (
    SELECT 1 FROM vehicle_images vi
    WHERE vi.vehicle_id = v.id
      AND COALESCE(vi.is_document, false) = false
      AND COALESCE(vi.is_duplicate, false) = false
      AND vi.is_primary = true
  );

-- Step 2: VIN backfill
-- If origin_metadata has vin (from a previous extraction), use it:
UPDATE vehicles
SET
  vin = NULLIF(TRIM(origin_metadata->>'vin'), ''),
  updated_at = NOW()
WHERE id = '992fb704-85d4-4358-9631-8f11fe9b5f47'
  AND (vin IS NULL OR TRIM(vin) = '')
  AND origin_metadata->>'vin' IS NOT NULL
  AND TRIM(origin_metadata->>'vin') <> '';

-- If still no VIN: re-run BaT extraction with vehicle_id + discovery_url so VIN gets written.
-- Get discovery_url:
--   SELECT discovery_url, bat_auction_url FROM vehicles WHERE id = '992fb704-85d4-4358-9631-8f11fe9b5f47';
-- Then invoke bat-simple-extract with body: { "url": "<discovery_url>", "vehicle_id": "992fb704-85d4-4358-9631-8f11fe9b5f47" }
