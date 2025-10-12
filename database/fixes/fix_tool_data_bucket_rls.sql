-- Fix RLS policies for tool-data bucket to allow proper file uploads
-- This replaces the base64 workaround with proper S3 storage

-- Enable RLS on storage.objects if not already enabled
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow authenticated users to upload to tool-data" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to read tool-data" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to update their tool-data" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated users to delete their tool-data" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read access to tool-data" ON storage.objects;

-- CREATE: Allow authenticated users to upload files to their own folder in tool-data bucket
CREATE POLICY "Allow authenticated users to upload to tool-data"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'tool-data' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- READ: Allow users to read their own files in tool-data
CREATE POLICY "Allow authenticated users to read tool-data"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'tool-data' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- UPDATE: Allow users to update their own files
CREATE POLICY "Allow authenticated users to update their tool-data"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'tool-data' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- DELETE: Allow users to delete their own files
CREATE POLICY "Allow authenticated users to delete their tool-data"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'tool-data' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Optional: Allow public read access (comment out if you want files private)
-- CREATE POLICY "Allow public read access to tool-data"
-- ON storage.objects
-- FOR SELECT
-- TO public
-- USING (bucket_id = 'tool-data');

-- Verify the bucket exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'tool-data') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'tool-data',
      'tool-data',
      false, -- Set to true if you want public read access
      52428800, -- 50MB limit
      ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf', 'text/plain']
    );
  END IF;
END $$;

-- Display current policies for verification
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'objects' 
  AND schemaname = 'storage'
  AND policyname LIKE '%tool-data%'
ORDER BY policyname;
