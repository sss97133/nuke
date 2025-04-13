-- Migration: Configure storage bucket and policies for vehicle uploads

-- Create the bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('vehicle-uploads', 'Vehicle Uploads', true) -- Set public based on requirements
ON CONFLICT (id) DO NOTHING;

-- Set up RLS policies for the bucket
-- Allow authenticated users to upload files to the vehicle-uploads bucket
DROP POLICY IF EXISTS "Authenticated users can upload files" ON storage.objects;
CREATE POLICY "Authenticated users can upload files"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'vehicle-uploads');

-- Allow authenticated users (or everyone, depending on needs) to view files in the vehicle-uploads bucket
DROP POLICY IF EXISTS "Users can view uploaded files" ON storage.objects;
CREATE POLICY "Users can view uploaded files"
  ON storage.objects
  FOR SELECT
-- Adjust TO clause based on whether files should be public (to anon, authenticated) or private (to authenticated)
-- Using 'authenticated' here assumes only logged-in users should see images via direct URL
  TO authenticated 
  USING (bucket_id = 'vehicle-uploads');

-- Optionally, add policies for UPDATE and DELETE if users should be able to modify/remove their uploads
-- DROP POLICY IF EXISTS "Users can update their uploaded files" ON storage.objects;
-- CREATE POLICY "Users can update their uploaded files"
--   ON storage.objects
--   FOR UPDATE
--   TO authenticated
--   USING (bucket_id = 'vehicle-uploads' AND auth.uid() = owner); -- Assumes 'owner' column exists and matches auth.uid()

-- DROP POLICY IF EXISTS "Users can delete their uploaded files" ON storage.objects;
-- CREATE POLICY "Users can delete their uploaded files"
--   ON storage.objects
--   FOR DELETE
--   TO authenticated
--   USING (bucket_id = 'vehicle-uploads' AND auth.uid() = owner); -- Assumes 'owner' column exists and matches auth.uid() 