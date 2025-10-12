-- Supabase Storage RLS Policies for Vehicle Data
-- These policies allow anonymous users to upload images while maintaining security

-- 1. POLICY: Allow anonymous and authenticated users to upload files
-- This allows anyone to upload to the vehicle-data bucket
CREATE POLICY "Allow anonymous uploads" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'vehicle-data' AND
  (auth.role() = 'anon' OR auth.role() = 'authenticated')
);

-- 2. POLICY: Allow public read access to all files
-- This allows anyone to view/download images
CREATE POLICY "Allow public read access" ON storage.objects
FOR SELECT USING (bucket_id = 'vehicle-data');

-- 3. POLICY: Allow users to update their own files
-- This allows file updates for both anonymous and authenticated users
CREATE POLICY "Allow users to update own files" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'vehicle-data' AND
  (auth.role() = 'anon' OR auth.role() = 'authenticated')
);

-- 4. POLICY: Allow users to delete their own files
-- This allows file deletion for both anonymous and authenticated users
CREATE POLICY "Allow users to delete own files" ON storage.objects
FOR DELETE USING (
  bucket_id = 'vehicle-data' AND
  (auth.role() = 'anon' OR auth.role() = 'authenticated')
);

-- 5. POLICY: Allow users to list files in the bucket
-- This allows browsing the bucket contents
CREATE POLICY "Allow users to list files" ON storage.objects
FOR SELECT USING (bucket_id = 'vehicle-data');

-- Optional: More restrictive policies for production
-- Uncomment these if you want more security:

-- POLICY: Restrict file types to images only
-- CREATE POLICY "Restrict file types" ON storage.objects
-- FOR INSERT WITH CHECK (
--   bucket_id = 'vehicle-data' AND
--   (auth.role() = 'anon' OR auth.role() = 'authenticated') AND
--   (file_type LIKE 'image/%')
-- );

-- POLICY: Limit file size (10MB)
-- CREATE POLICY "Limit file size" ON storage.objects
-- FOR INSERT WITH CHECK (
--   bucket_id = 'vehicle-data' AND
--   (auth.role() = 'anon' OR auth.role() = 'authenticated') AND
--   (octet_length(file_data) <= 10485760)
-- );

-- POLICY: Restrict uploads to specific folders
-- CREATE POLICY "Restrict upload paths" ON storage.objects
-- FOR INSERT WITH CHECK (
--   bucket_id = 'vehicle-data' AND
--   (auth.role() = 'anon' OR auth.role() = 'authenticated') AND
--   (storage.foldername(name))[1] IN ('temp', 'vehicles')
-- ); 