-- Manual Fix for BAT Image Dates
-- Since we don't have the actual auction dates, we'll use a reasonable default
-- User can manually update these later with actual auction start dates

-- For now, set BAT images to use the year of the vehicle as the photo date
-- This is better than November 2025 upload dates
DO $$
DECLARE
  updated_images INTEGER := 0;
  updated_events INTEGER := 0;
  image_record RECORD;
  estimated_date DATE;
BEGIN
  FOR image_record IN 
    SELECT 
      vi.id as image_id,
      vi.vehicle_id,
      vi.timeline_event_id,
      v.year,
      v.bat_auction_url
    FROM vehicle_images vi
    JOIN vehicles v ON v.id = vi.vehicle_id
    WHERE vi.taken_at IS NULL
      AND vi.image_url LIKE '%/bat/%'
      AND v.bat_auction_url IS NOT NULL
    LIMIT 500
  LOOP
    -- Use January 1st of the vehicle year as a reasonable default
    -- (These are listing photos, not original photos, so exact date doesn't matter as much)
    estimated_date := make_date(image_record.year, 1, 1);
    
    -- Update image
    UPDATE vehicle_images
    SET taken_at = estimated_date::timestamp
    WHERE id = image_record.image_id;
    
    updated_images := updated_images + 1;
    
    -- Update timeline event
    IF image_record.timeline_event_id IS NOT NULL THEN
      UPDATE timeline_events
      SET event_date = estimated_date,
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'bat_import', true,
            'estimated_date', true,
            'date_note', 'Using vehicle year as placeholder - actual auction date unknown'
          )
      WHERE id = image_record.timeline_event_id;
      
      updated_events := updated_events + 1;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Updated % BAT images with estimated dates (vehicle year)', updated_images;
  RAISE NOTICE 'Updated % timeline events with estimated dates', updated_events;
END $$;

-- Report what still needs manual correction
SELECT 
  v.year,
  v.make,
  v.model,
  v.bat_auction_url,
  COUNT(vi.id) as image_count
FROM vehicle_images vi
JOIN vehicles v ON v.id = vi.vehicle_id
WHERE vi.image_url LIKE '%/bat/%'
  AND v.bat_auction_url IS NOT NULL
GROUP BY v.id, v.year, v.make, v.model, v.bat_auction_url
ORDER BY v.year DESC;

