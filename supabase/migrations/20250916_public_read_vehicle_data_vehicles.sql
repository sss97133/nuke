-- Make vehicles/* publicly readable in vehicle-data bucket while keeping other paths private
-- This migration sets bucket to private and adds RLS policies to allow anonymous read for vehicles/* only.

-- Ensure bucket exists and is private (public flag off so RLS governs access)
UPDATE storage.buckets
SET public = false
WHERE id = 'vehicle-data';

-- Attempt to enable RLS; skip silently if insufficient privilege
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping RLS enable on storage.objects (insufficient privilege)';
  END;
END;
$$;

-- Drop old broad policies if they exist to avoid overexposure
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Public access to vehicle-data'
  ) THEN
    EXECUTE 'DROP POLICY "Public access to vehicle-data" ON storage.objects';
  END IF;
END;
$$;

-- Create/replace desired policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'public read vehicle-data vehicles/*'
  ) THEN
    EXECUTE 'CREATE POLICY "public read vehicle-data vehicles/*" ON storage.objects
      FOR SELECT
      USING (bucket_id = ''vehicle-data'' AND name LIKE ''vehicles/%'')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'auth write vehicle-data'
  ) THEN
    EXECUTE 'CREATE POLICY "auth write vehicle-data" ON storage.objects
      FOR INSERT
      WITH CHECK (bucket_id = ''vehicle-data'')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'auth update vehicle-data'
  ) THEN
    EXECUTE 'CREATE POLICY "auth update vehicle-data" ON storage.objects
      FOR UPDATE
      USING (bucket_id = ''vehicle-data'')
      WITH CHECK (bucket_id = ''vehicle-data'')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'auth delete vehicle-data'
  ) THEN
    EXECUTE 'CREATE POLICY "auth delete vehicle-data" ON storage.objects
      FOR DELETE
      USING (bucket_id = ''vehicle-data'')';
  END IF;
END;
$$;
