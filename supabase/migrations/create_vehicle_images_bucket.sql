
-- Create a storage bucket for vehicle images
INSERT INTO storage.buckets (id, name, public)
VALUES ('vehicles', 'vehicles', true)
ON CONFLICT (id) DO NOTHING;

-- Set up a policy to allow authenticated users to upload vehicle images
CREATE POLICY "Allow authenticated users to upload vehicle images" 
ON storage.objects 
FOR INSERT 
TO authenticated 
WITH CHECK (bucket_id = 'vehicles');

-- Set up a policy to allow public access to vehicle images
CREATE POLICY "Allow public access to vehicle images" 
ON storage.objects 
FOR SELECT 
TO public 
USING (bucket_id = 'vehicles');
