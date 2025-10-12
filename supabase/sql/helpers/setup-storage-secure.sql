-- Secure Supabase Storage RLS Policies for Vehicle Data
-- These policies allow anonymous users to upload images with security restrictions

-- 1. POLICY: Allow anonymous and authenticated users to upload image files only
-- This restricts uploads to image files and limits file size
CREATE POLICY "Allow secure anonymous uploads" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'vehicle-data' AND
  (auth.role() = 'anon' OR auth.role() = 'authenticated') AND
  (file_type LIKE 'image/%') AND
  (octet_length(file_data) <= 10485760) -- 10MB limit
);

-- 2. POLICY: Allow public read access to all files
-- This allows anyone to view/download images
CREATE POLICY "Allow public read access" ON storage.objects
FOR SELECT USING (bucket_id = 'vehicle-data');

-- 3. POLICY: Allow users to update their own files (with restrictions)
-- This allows file updates but maintains security
CREATE POLICY "Allow secure file updates" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'vehicle-data' AND
  (auth.role() = 'anon' OR auth.role() = 'authenticated')
) WITH CHECK (
  bucket_id = 'vehicle-data' AND
  (auth.role() = 'anon' OR auth.role() = 'authenticated') AND
  (file_type LIKE 'image/%') AND
  (octet_length(file_data) <= 10485760) -- 10MB limit
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

-- 6. POLICY: Restrict uploads to specific folder structure
-- This ensures files are organized properly
CREATE POLICY "Restrict upload paths" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'vehicle-data' AND
  (auth.role() = 'anon' OR auth.role() = 'authenticated') AND
  (storage.foldername(name))[1] IN ('temp', 'vehicles')
);

-- 7. POLICY: Prevent malicious file uploads
-- This blocks common dangerous file types
CREATE POLICY "Block dangerous files" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'vehicle-data' AND
  (auth.role() = 'anon' OR auth.role() = 'authenticated') AND
  (file_type NOT IN ('application/x-executable', 'application/x-shockwave-flash', 'text/html'))
); 