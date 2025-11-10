-- Fix vehicle_images RLS to allow uploads by vehicle owners
-- The current policy is too restrictive or checking non-existent tables

-- Drop existing policies
DROP POLICY IF EXISTS "Vehicle owners and contributors can insert images" ON vehicle_images;
DROP POLICY IF EXISTS "Vehicle owners and contributors can update images" ON vehicle_images;
DROP POLICY IF EXISTS "Vehicle owners and contributors can delete images" ON vehicle_images;
DROP POLICY IF EXISTS "Users can insert images for their own vehicles" ON vehicle_images;
DROP POLICY IF EXISTS "Users can update images for their own vehicles" ON vehicle_images;
DROP POLICY IF EXISTS "Users can delete images for their own vehicles" ON vehicle_images;

-- Create simple, permissive INSERT policy
-- Allow if: user is vehicle owner (user_id) OR vehicle uploader (uploaded_by) OR contributor
CREATE POLICY "Allow vehicle owners and contributors to insert images" ON vehicle_images
    FOR INSERT WITH CHECK (
        auth.uid() IS NOT NULL
        AND (
            -- User is the one uploading (user_id on the image record)
            auth.uid() = user_id
            OR
            -- User owns the vehicle (vehicles.user_id)
            EXISTS (
                SELECT 1 FROM vehicles 
                WHERE vehicles.id = vehicle_images.vehicle_id 
                AND vehicles.user_id = auth.uid()
            )
            OR
            -- User uploaded the vehicle originally (vehicles.uploaded_by)
            EXISTS (
                SELECT 1 FROM vehicles 
                WHERE vehicles.id = vehicle_images.vehicle_id 
                AND vehicles.uploaded_by = auth.uid()
            )
        )
    );

-- Allow UPDATE if user owns the vehicle or uploaded the image
CREATE POLICY "Allow vehicle owners to update images" ON vehicle_images
    FOR UPDATE USING (
        auth.uid() IS NOT NULL
        AND (
            -- User uploaded this image
            auth.uid() = user_id
            OR
            -- User owns the vehicle
            EXISTS (
                SELECT 1 FROM vehicles 
                WHERE vehicles.id = vehicle_images.vehicle_id 
                AND vehicles.user_id = auth.uid()
            )
            OR
            -- User originally uploaded the vehicle
            EXISTS (
                SELECT 1 FROM vehicles 
                WHERE vehicles.id = vehicle_images.vehicle_id 
                AND vehicles.uploaded_by = auth.uid()
            )
        )
    );

-- Allow DELETE if user owns the vehicle or uploaded the image
CREATE POLICY "Allow vehicle owners to delete images" ON vehicle_images
    FOR DELETE USING (
        auth.uid() IS NOT NULL
        AND (
            -- User uploaded this image
            auth.uid() = user_id
            OR
            -- User owns the vehicle
            EXISTS (
                SELECT 1 FROM vehicles 
                WHERE vehicles.id = vehicle_images.vehicle_id 
                AND vehicles.user_id = auth.uid()
            )
            OR
            -- User originally uploaded the vehicle
            EXISTS (
                SELECT 1 FROM vehicles 
                WHERE vehicles.id = vehicle_images.vehicle_id 
                AND vehicles.uploaded_by = auth.uid()
            )
        )
    );

-- Success
DO $$
BEGIN
    RAISE NOTICE 'Image upload RLS policies fixed!';
END$$;

