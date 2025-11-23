-- Extract taken_at dates from EXIF data
-- Many images have EXIF data but taken_at is still null
-- This extracts DateTimeOriginal, DateTime, or CreateDate from EXIF JSON

DO $$
DECLARE
  image_record RECORD;
  exif_date TIMESTAMP;
  updated_count INTEGER := 0;
BEGIN
  FOR image_record IN 
    SELECT 
      id,
      exif_data,
      created_at
    FROM vehicle_images
    WHERE taken_at IS NULL
      AND vehicle_id IS NOT NULL
      AND exif_data IS NOT NULL
    LIMIT 1000
  LOOP
    -- Try to extract date from EXIF data (try multiple fields)
    exif_date := NULL;
    
    BEGIN
      IF image_record.exif_data->>'DateTimeOriginal' IS NOT NULL THEN
        exif_date := (image_record.exif_data->>'DateTimeOriginal')::timestamp;
      ELSIF image_record.exif_data->>'DateTime' IS NOT NULL THEN
        exif_date := (image_record.exif_data->>'DateTime')::timestamp;
      ELSIF image_record.exif_data->>'CreateDate' IS NOT NULL THEN
        exif_date := (image_record.exif_data->>'CreateDate')::timestamp;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Invalid date format, skip
      NULL;
    END;
    
    -- If we found a valid EXIF date, use it
    IF exif_date IS NOT NULL THEN
      UPDATE vehicle_images
      SET taken_at = exif_date
      WHERE id = image_record.id;
      
      updated_count := updated_count + 1;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Extracted EXIF dates for % images', updated_count;
END $$;

-- Report final status
SELECT 
  COUNT(*) as total_images,
  COUNT(*) FILTER (WHERE taken_at IS NOT NULL) as with_taken_at,
  COUNT(*) FILTER (WHERE taken_at IS NULL) as without_taken_at,
  ROUND(100.0 * COUNT(*) FILTER (WHERE taken_at IS NOT NULL) / COUNT(*), 2) as percent_with_dates
FROM vehicle_images
WHERE vehicle_id IS NOT NULL;

