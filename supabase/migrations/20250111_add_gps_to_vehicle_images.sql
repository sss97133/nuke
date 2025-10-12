-- Add GPS coordinates to vehicle_images table (only if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'vehicle_images') THEN
    ALTER TABLE public.vehicle_images
    ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
    ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
    ADD COLUMN IF NOT EXISTS location_name TEXT,
    ADD COLUMN IF NOT EXISTS exif_data JSONB;

    -- Create index for spatial queries
    CREATE INDEX IF NOT EXISTS idx_vehicle_images_coordinates 
    ON public.vehicle_images (latitude, longitude) 
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

    -- Update existing images with mock GPS data for testing
    -- This will be replaced with real EXIF extraction
    UPDATE public.vehicle_images
    SET 
      latitude = 33.4484 + (RANDOM() - 0.5) * 0.2,
      longitude = -112.0740 + (RANDOM() - 0.5) * 0.2
    WHERE latitude IS NULL;
  END IF;
END $$;
