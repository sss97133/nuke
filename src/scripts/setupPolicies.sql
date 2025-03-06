-- Enable RLS on the vehicle_images table
ALTER TABLE vehicle_images ENABLE ROW LEVEL SECURITY;

-- Create policy for inserting images
CREATE POLICY "Allow authenticated users to insert images"
ON vehicle_images
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Create policy for selecting images
CREATE POLICY "Allow authenticated users to view images"
ON vehicle_images
FOR SELECT
TO authenticated
USING (true);

-- Create policy for updating images
CREATE POLICY "Allow users to update their own images"
ON vehicle_images
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Create policy for deleting images
CREATE POLICY "Allow users to delete their own images"
ON vehicle_images
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Set up storage bucket policies
CREATE POLICY "Allow authenticated users to upload images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'vehicle-images' AND
  auth.role() = 'authenticated'
);

CREATE POLICY "Allow authenticated users to read images"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'vehicle-images');

CREATE POLICY "Allow users to update their own images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'vehicle-images' AND
  auth.uid() = (storage.foldername(name))[1]::uuid
)
WITH CHECK (
  bucket_id = 'vehicle-images' AND
  auth.uid() = (storage.foldername(name))[1]::uuid
);

CREATE POLICY "Allow users to delete their own images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'vehicle-images' AND
  auth.uid() = (storage.foldername(name))[1]::uuid
); 