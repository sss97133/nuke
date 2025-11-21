-- Fix RLS policies for vehicle_image_comments
-- Allow viewing comments if:
-- 1. Vehicle is public, OR
-- 2. User is the vehicle owner/uploader, OR
-- 3. User has contributor access to the vehicle

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Anyone can view image comments" ON vehicle_image_comments;
DROP POLICY IF EXISTS "Users can view image comments" ON vehicle_image_comments;
DROP POLICY IF EXISTS "Authenticated users can create image comments" ON vehicle_image_comments;

-- Create improved SELECT policy
CREATE POLICY "Users can view image comments" ON vehicle_image_comments
  FOR SELECT USING (
    -- Vehicle is public
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = vehicle_image_comments.vehicle_id
      AND vehicles.is_public = true
    )
    OR
    -- User is vehicle owner/uploader
    EXISTS (
      SELECT 1 FROM vehicles
      WHERE vehicles.id = vehicle_image_comments.vehicle_id
      AND (
        vehicles.user_id = auth.uid()
        OR vehicles.uploaded_by = auth.uid()
      )
    )
    OR
    -- User has contributor access
    EXISTS (
      SELECT 1 FROM vehicle_contributors
      WHERE vehicle_contributors.vehicle_id = vehicle_image_comments.vehicle_id
      AND vehicle_contributors.user_id = auth.uid()
      AND vehicle_contributors.status = 'active'
    )
    OR
    -- User has ownership verification
    EXISTS (
      SELECT 1 FROM ownership_verifications
      WHERE ownership_verifications.vehicle_id = vehicle_image_comments.vehicle_id
      AND ownership_verifications.user_id = auth.uid()
      AND ownership_verifications.status = 'approved'
    )
    OR
    -- User can view via organization membership
    EXISTS (
      SELECT 1 FROM organization_vehicles ov
      JOIN organization_contributors oc ON oc.organization_id = ov.organization_id
      WHERE ov.vehicle_id = vehicle_image_comments.vehicle_id
      AND oc.user_id = auth.uid()
      AND oc.status = 'active'
      AND ov.status = 'active'
    )
  );

-- Create INSERT policy - allow authenticated users
CREATE POLICY "Authenticated users can create image comments" ON vehicle_image_comments
  FOR INSERT 
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND auth.uid() = user_id
    AND vehicle_id IS NOT NULL
    AND image_id IS NOT NULL
  );

-- Keep existing UPDATE/DELETE policies (users can manage their own comments)
COMMENT ON POLICY "Users can view image comments" ON vehicle_image_comments IS 
'Allows viewing comments if vehicle is public, user is owner, or user has contributor access';

