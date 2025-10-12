-- Create storage buckets and policies for remote Supabase
-- Run this in Supabase Dashboard SQL Editor

-- Create buckets if missing
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE name = 'vehicle-images') THEN
    PERFORM storage.create_bucket('vehicle-images', public := true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE name = 'vehicle-data') THEN
    PERFORM storage.create_bucket('vehicle-data', public := true);
  END IF;
END $$;

-- Allow authenticated users to upload into these buckets
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'allow_authenticated_uploads_vehicle_images'
  ) THEN
    CREATE POLICY "allow_authenticated_uploads_vehicle_images"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'vehicle-images');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'allow_authenticated_uploads_vehicle_data'
  ) THEN
    CREATE POLICY "allow_authenticated_uploads_vehicle_data"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'vehicle-data');
  END IF;
END $$;

-- Allow public read access to uploaded objects
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'allow_public_read_vehicle_images'
  ) THEN
    CREATE POLICY "allow_public_read_vehicle_images"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'vehicle-images');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'allow_public_read_vehicle_data'
  ) THEN
    CREATE POLICY "allow_public_read_vehicle_data"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'vehicle-data');
  END IF;
END $$;
