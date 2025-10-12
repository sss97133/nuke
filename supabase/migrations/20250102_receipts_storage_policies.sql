-- Storage policies for receipts bucket
-- These policies control who can upload, view, and delete files

-- Enable RLS on storage.objects (if not already enabled)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Anyone can view receipts" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload receipts" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own receipts" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own receipts" ON storage.objects;

-- Policy: Anyone can view receipts (public read)
CREATE POLICY "Anyone can view receipts" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'receipts');

-- Policy: Authenticated users can upload receipts to their own folder
CREATE POLICY "Authenticated users can upload receipts" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'receipts' 
    AND auth.role() = 'authenticated'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Policy: Users can delete their own receipts
CREATE POLICY "Users can delete their own receipts" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'receipts' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Policy: Users can update their own receipts
CREATE POLICY "Users can update their own receipts" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'receipts' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Also create a more permissive policy for anonymous uploads (for testing)
-- This can be removed in production if you only want authenticated uploads
CREATE POLICY "Allow anonymous test uploads" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'receipts'
    AND (storage.foldername(name))[1] = 'test'
  );

-- Grant necessary permissions
GRANT ALL ON storage.objects TO authenticated;
GRANT SELECT ON storage.objects TO anon;

-- Show confirmation
DO $$
BEGIN
  RAISE NOTICE 'Storage policies for receipts bucket have been configured';
  RAISE NOTICE 'Authenticated users can now upload to their own folders';
  RAISE NOTICE 'Public read access is enabled for all receipts';
END $$;
