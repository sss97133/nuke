-- Fix storage bucket permissions and policies

-- 1. Check current bucket policies
SELECT 
    name as bucket_name,
    public,
    file_size_limit,
    allowed_mime_types
FROM storage.buckets 
WHERE name IN ('vehicle-data', 'vehicle-images');

-- 2. Update bucket policies to allow proper access
-- Make sure vehicle-data bucket allows authenticated users to read/write
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'vehicle-data',
    'vehicle-data', 
    false,
    52428800, -- 50MB limit
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff']
) ON CONFLICT (id) DO UPDATE SET
    file_size_limit = 52428800,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff'];

-- 3. Create storage policies for vehicle-data bucket
-- Drop existing policies first
DROP POLICY IF EXISTS "Authenticated users can upload vehicle images" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for vehicle images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own vehicle images" ON storage.objects;

-- Create new policies
CREATE POLICY "Authenticated users can upload vehicle images" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'vehicle-data' 
        AND auth.role() = 'authenticated'
    );

CREATE POLICY "Public read access for vehicle images" ON storage.objects
    FOR SELECT USING (bucket_id = 'vehicle-data');

CREATE POLICY "Users can delete their own vehicle images" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'vehicle-data' 
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

-- 4. Create policy for signed URL generation
CREATE POLICY "Authenticated users can create signed URLs" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'vehicle-data' 
        AND auth.role() = 'authenticated'
    );

-- 5. Verify policies are created
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual
FROM pg_policies 
WHERE tablename = 'objects' 
AND schemaname = 'storage'
ORDER BY policyname;
