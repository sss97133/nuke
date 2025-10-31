-- SIMPLE PERMISSIONS FIX
-- Drop all the complex overlapping policies and create 3 simple ones

-- Clean up vehicle_images policies
DROP POLICY IF EXISTS "Anyone authenticated can insert their own vehicle image rows" ON vehicle_images;
DROP POLICY IF EXISTS "any auth user can submit images to public or permitted vehicles" ON vehicle_images;
DROP POLICY IF EXISTS "authenticated_can_insert" ON vehicle_images;
DROP POLICY IF EXISTS "insert: uploader only" ON vehicle_images;
DROP POLICY IF EXISTS "Select images when public or related to user" ON vehicle_images;
DROP POLICY IF EXISTS "Users can view images for public vehicles" ON vehicle_images;
DROP POLICY IF EXISTS "Users can view images for vehicles they own" ON vehicle_images;
DROP POLICY IF EXISTS "select: public vehicle or uploader or owner" ON vehicle_images;
DROP POLICY IF EXISTS "vehicle_images_select_access" ON vehicle_images;
DROP POLICY IF EXISTS "vehicle_images_select_public" ON vehicle_images;
DROP POLICY IF EXISTS "vehicle_images_select_sensitive" ON vehicle_images;
DROP POLICY IF EXISTS "Users can update images for their own vehicles" ON vehicle_images;
DROP POLICY IF EXISTS "vehicle_images_update_owner_or_uploader" ON vehicle_images;
DROP POLICY IF EXISTS "Users can delete images for their own vehicles" ON vehicle_images;
DROP POLICY IF EXISTS "vehicle_images_delete_owner_or_uploader" ON vehicle_images;

-- Create 3 simple, clear policies for vehicle_images
CREATE POLICY "simple_vehicle_images_insert" ON vehicle_images
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND vehicle_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM vehicles v
    WHERE v.id = vehicle_id
    AND v.uploaded_by = auth.uid()
  )
);

CREATE POLICY "simple_vehicle_images_select" ON vehicle_images
FOR SELECT TO authenticated
USING (
  -- Users can see images they uploaded
  user_id = auth.uid()
  OR
  -- Users can see images on vehicles they own
  EXISTS (
    SELECT 1 FROM vehicles v
    WHERE v.id = vehicle_id
    AND v.uploaded_by = auth.uid()
  )
  OR
  -- Anyone can see images on public vehicles
  EXISTS (
    SELECT 1 FROM vehicles v
    WHERE v.id = vehicle_id
    AND v.is_public = true
  )
);

CREATE POLICY "simple_vehicle_images_modify" ON vehicle_images
FOR ALL TO authenticated
USING (
  -- Users can modify images they uploaded on vehicles they own
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM vehicles v
    WHERE v.id = vehicle_id
    AND v.uploaded_by = auth.uid()
  )
);

-- Test the setup
SELECT 'Policies updated successfully' as result;