-- Enable RLS on the vehicle_images table
ALTER TABLE vehicle_images ENABLE ROW LEVEL SECURITY;

-- Create policy for inserting images
CREATE POLICY "Allow authenticated users to insert images"
ON vehicle_images
FOR INSERT
TO authenticated
WITH CHECK (true);  -- Any authenticated user can insert

-- Create policy for selecting images
CREATE POLICY "Allow authenticated users to view images"
ON vehicle_images
FOR SELECT
TO authenticated
USING (true);  -- All authenticated users can view

-- Create policy for updating images (only vehicle owner)
CREATE POLICY "Allow vehicle owners to update images"
ON vehicle_images
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM vehicles
    WHERE vehicles.id = vehicle_images.car_id
    AND vehicles.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM vehicles
    WHERE vehicles.id = vehicle_images.car_id
    AND vehicles.user_id = auth.uid()
  )
);

-- Create policy for deleting images (only vehicle owner)
CREATE POLICY "Allow vehicle owners to delete images"
ON vehicle_images
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM vehicles
    WHERE vehicles.id = vehicle_images.car_id
    AND vehicles.user_id = auth.uid()
  )
);

-- Set up storage bucket policies
CREATE POLICY "Allow authenticated users to upload images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'vehicle-images' AND
  auth.role() = 'authenticated' AND
  (storage.foldername(name))[1] = 'vehicles'  -- Just ensure it's in the vehicles folder
);

CREATE POLICY "Allow authenticated users to read images"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'vehicle-images');

CREATE POLICY "Allow vehicle owners to update images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'vehicle-images' AND
  EXISTS (
    SELECT 1 FROM vehicles
    WHERE id = (storage.foldername(name))[2]::uuid
    AND user_id = auth.uid()
  )
)
WITH CHECK (
  bucket_id = 'vehicle-images' AND
  EXISTS (
    SELECT 1 FROM vehicles
    WHERE id = (storage.foldername(name))[2]::uuid
    AND user_id = auth.uid()
  )
);

CREATE POLICY "Allow vehicle owners to delete images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'vehicle-images' AND
  EXISTS (
    SELECT 1 FROM vehicles
    WHERE id = (storage.foldername(name))[2]::uuid
    AND user_id = auth.uid()
  )
); 