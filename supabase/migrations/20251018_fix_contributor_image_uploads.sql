-- Fix RLS policies to allow contributors to upload images
-- Issue: Previous owners and contributors can't upload images even with permissions

-- Drop old restrictive policies
DROP POLICY IF EXISTS "Users can insert images for their own vehicles" ON vehicle_images;
DROP POLICY IF EXISTS "Users can update images for their own vehicles" ON vehicle_images;
DROP POLICY IF EXISTS "Users can delete images for their own vehicles" ON vehicle_images;

-- Create new policies that respect vehicle_user_permissions
-- Allow INSERT for vehicle owners OR contributors with permission
CREATE POLICY "Vehicle owners and contributors can insert images" ON vehicle_images
    FOR INSERT WITH CHECK (
        auth.uid() = user_id  -- Must be uploading as themselves
        AND (
            -- Vehicle owner
            EXISTS (
                SELECT 1 FROM vehicles 
                WHERE vehicles.id = vehicle_images.vehicle_id 
                AND vehicles.user_id = auth.uid()
            )
            OR
            -- OR contributor with active permission
            EXISTS (
                SELECT 1 FROM vehicle_user_permissions vup
                WHERE vup.vehicle_id = vehicle_images.vehicle_id
                AND vup.user_id = auth.uid()
                AND vup.status = 'active'
                AND vup.can_edit = true  -- Need edit permission to upload
            )
        )
    );

-- Allow UPDATE for vehicle owners OR contributors with permission
CREATE POLICY "Vehicle owners and contributors can update images" ON vehicle_images
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM vehicles 
            WHERE vehicles.id = vehicle_images.vehicle_id 
            AND vehicles.user_id = auth.uid()
        )
        OR
        EXISTS (
            SELECT 1 FROM vehicle_user_permissions vup
            WHERE vup.vehicle_id = vehicle_images.vehicle_id
            AND vup.user_id = auth.uid()
            AND vup.status = 'active'
            AND vup.can_edit = true
        )
        OR
        -- Can always update your own uploads
        auth.uid() = vehicle_images.user_id
    );

-- Allow DELETE for vehicle owners OR contributors OR own uploads
CREATE POLICY "Vehicle owners and contributors can delete images" ON vehicle_images
    FOR DELETE USING (
        -- Vehicle owner
        EXISTS (
            SELECT 1 FROM vehicles 
            WHERE vehicles.id = vehicle_images.vehicle_id 
            AND vehicles.user_id = auth.uid()
        )
        OR
        -- Contributor with edit permission
        EXISTS (
            SELECT 1 FROM vehicle_user_permissions vup
            WHERE vup.vehicle_id = vehicle_images.vehicle_id
            AND vup.user_id = auth.uid()
            AND vup.status = 'active'
            AND vup.can_edit = true
        )
        OR
        -- Can delete your own uploads
        auth.uid() = vehicle_images.user_id
    );

-- Also update storage bucket policies
-- Drop old storage policies
DROP POLICY IF EXISTS "allow_authenticated_uploads_vehicle_images" ON storage.objects;

-- Create new storage policy that checks vehicle_user_permissions
CREATE POLICY "Vehicle owners and contributors can upload to storage" 
ON storage.objects FOR INSERT 
WITH CHECK (
    bucket_id = 'vehicle-images'
    AND auth.role() = 'authenticated'
    AND (
        -- Extract vehicle_id from path (format: vehicles/{vehicle_id}/...)
        (string_to_array(name, '/'))[2] IN (
            -- User owns the vehicle
            SELECT id::text FROM vehicles WHERE user_id = auth.uid()
            UNION
            -- OR user is a contributor with edit permission
            SELECT vehicle_id::text FROM vehicle_user_permissions 
            WHERE user_id = auth.uid() 
            AND status = 'active' 
            AND can_edit = true
        )
    )
);

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'RLS policies updated! Contributors can now upload images.';
END$$;

