-- Quick fix for image upload RLS - run this in Supabase SQL Editor
-- Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql/new

-- Drop all existing restrictive policies
DROP POLICY IF EXISTS "Vehicle owners and contributors can insert images" ON vehicle_images;
DROP POLICY IF EXISTS "Vehicle owners and contributors can update images" ON vehicle_images;
DROP POLICY IF EXISTS "Vehicle owners and contributors can delete images" ON vehicle_images;
DROP POLICY IF EXISTS "Users can insert images for their own vehicles" ON vehicle_images;
DROP POLICY IF EXISTS "Users can update images for their own vehicles" ON vehicle_images;
DROP POLICY IF EXISTS "Users can delete images for their own vehicles" ON vehicle_images;
DROP POLICY IF EXISTS "Allow vehicle owners and contributors to insert images" ON vehicle_images;
DROP POLICY IF EXISTS "Allow vehicle owners to update images" ON vehicle_images;
DROP POLICY IF EXISTS "Allow vehicle owners to delete images" ON vehicle_images;

-- Create permissive INSERT policy - allow authenticated users who own the vehicle
CREATE POLICY "Authenticated users can insert images for vehicles they own" 
ON vehicle_images FOR INSERT 
WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
        -- User is setting themselves as the uploader
        auth.uid() = user_id
        AND
        -- AND they own the vehicle
        EXISTS (
            SELECT 1 FROM vehicles v
            WHERE v.id = vehicle_id
            AND (v.user_id = auth.uid() OR v.uploaded_by = auth.uid())
        )
    )
);

-- Allow UPDATE for image owner or vehicle owner
CREATE POLICY "Users can update their own images or vehicle images" 
ON vehicle_images FOR UPDATE 
USING (
    auth.uid() IS NOT NULL
    AND (
        auth.uid() = user_id
        OR EXISTS (
            SELECT 1 FROM vehicles v
            WHERE v.id = vehicle_id
            AND (v.user_id = auth.uid() OR v.uploaded_by = auth.uid())
        )
    )
);

-- Allow DELETE for image owner or vehicle owner  
CREATE POLICY "Users can delete their own images or vehicle images"
ON vehicle_images FOR DELETE
USING (
    auth.uid() IS NOT NULL
    AND (
        auth.uid() = user_id
        OR EXISTS (
            SELECT 1 FROM vehicles v
            WHERE v.id = vehicle_id
            AND (v.user_id = auth.uid() OR v.uploaded_by = auth.uid())
        )
    )
);

-- Verify policies were created
SELECT 
    schemaname,
    tablename,
    policyname,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'vehicle_images'
ORDER BY policyname;

