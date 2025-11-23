-- Comprehensive Timeline Date Correction
-- Fixes timeline events that used upload dates instead of actual photo dates
-- Extracts dates from BAT URL paths and EXIF metadata

DO $$
DECLARE
  event_record RECORD;
  url_date_match TEXT;
  extracted_year INT;
  extracted_month INT;
  corrected_date DATE;
  image_taken_at TIMESTAMP;
  updated_count INTEGER := 0;
BEGIN
  FOR event_record IN 
    SELECT 
      te.id,
      te.event_date,
      te.image_urls,
      te.vehicle_id
    FROM timeline_events te
    WHERE te.event_type IN ('photo_session', 'photo_added')
      AND te.event_date >= '2025-01-01'
      AND te.image_urls IS NOT NULL
      AND array_length(te.image_urls, 1) > 0
  LOOP
    corrected_date := NULL;
    
    -- Strategy 1: Check if images are uploaded and have taken_at dates
    SELECT MIN(vi.taken_at) INTO image_taken_at
    FROM vehicle_images vi
    WHERE vi.timeline_event_id = event_record.id
      AND vi.taken_at IS NOT NULL;
    
    IF image_taken_at IS NOT NULL THEN
      corrected_date := DATE(image_taken_at);
    ELSE
      -- Strategy 2: Extract date from BAT URL path (e.g., /2024/09/ or /2025/04/)
      IF event_record.image_urls[1] LIKE '%bringatrailer.com%' THEN
        -- Extract year/month from URL path
        BEGIN
          extracted_year := (regexp_matches(event_record.image_urls[1], '/(\d{4})/(\d{2})/'))[1]::INT;
          extracted_month := (regexp_matches(event_record.image_urls[1], '/(\d{4})/(\d{2})/'))[2]::INT;
          
          IF extracted_year IS NOT NULL AND extracted_month IS NOT NULL THEN
            corrected_date := make_date(extracted_year, extracted_month, 1);
          END IF;
        EXCEPTION WHEN OTHERS THEN
          -- URL doesn't have date pattern, skip
          NULL;
        END;
      END IF;
    END IF;
    
    -- Apply correction if we found a valid date different from current
    IF corrected_date IS NOT NULL AND corrected_date != event_record.event_date THEN
      UPDATE timeline_events
      SET event_date = corrected_date,
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'date_corrected', true,
            'original_date', event_record.event_date::text,
            'correction_source', CASE 
              WHEN image_taken_at IS NOT NULL THEN 'exif_taken_at'
              ELSE 'bat_url_path'
            END,
            'corrected_at', NOW()
          )
      WHERE id = event_record.id;
      
      updated_count := updated_count + 1;
      
      RAISE NOTICE 'Event %: % -> % (from %)', 
        event_record.id, 
        event_record.event_date, 
        corrected_date,
        CASE WHEN image_taken_at IS NOT NULL THEN 'EXIF' ELSE 'URL' END;
    END IF;
  END LOOP;
  
  RAISE NOTICE '=== DATE CORRECTION COMPLETE ===';
  RAISE NOTICE 'Corrected % timeline events with proper dates', updated_count;
END $$;

-- Report results
SELECT 
  COUNT(*) as total_corrected,
  COUNT(*) FILTER (WHERE metadata->>'correction_source' = 'exif_taken_at') as from_exif,
  COUNT(*) FILTER (WHERE metadata->>'correction_source' = 'bat_url_path') as from_url
FROM timeline_events
WHERE metadata->'date_corrected' = 'true';

