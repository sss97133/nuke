-- Fix RLS policies for vehicle_image_comments
-- Allow viewing comments if:
-- 1. Vehicle is public, OR
-- 2. User is the vehicle owner/uploader, OR
-- 3. User has contributor access to the vehicle

DO $$
BEGIN
  -- This migration assumes vehicle_image_comments has a vehicle_id column.
  -- Some schema variants only have image_id and derive vehicle_id via join; in that case we skip.
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_image_comments'
      AND column_name = 'vehicle_id'
  ) THEN
    RAISE NOTICE 'Skipping 20250122000001_fix_image_comments_rls.sql because public.vehicle_image_comments.vehicle_id does not exist';
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS "Anyone can view image comments" ON vehicle_image_comments';
  EXECUTE 'DROP POLICY IF EXISTS "Users can view image comments" ON vehicle_image_comments';
  EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can create image comments" ON vehicle_image_comments';

  EXECUTE $sql$
    CREATE POLICY "Users can view image comments" ON vehicle_image_comments
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM vehicles
          WHERE vehicles.id = vehicle_image_comments.vehicle_id
          AND vehicles.is_public = true
        )
        OR
        EXISTS (
          SELECT 1 FROM vehicles
          WHERE vehicles.id = vehicle_image_comments.vehicle_id
          AND (
            vehicles.user_id = auth.uid()
            OR vehicles.uploaded_by = auth.uid()
          )
        )
        OR
        EXISTS (
          SELECT 1 FROM vehicle_contributors
          WHERE vehicle_contributors.vehicle_id = vehicle_image_comments.vehicle_id
          AND vehicle_contributors.user_id = auth.uid()
          AND vehicle_contributors.status = 'active'
        )
        OR
        EXISTS (
          SELECT 1 FROM ownership_verifications
          WHERE ownership_verifications.vehicle_id = vehicle_image_comments.vehicle_id
          AND ownership_verifications.user_id = auth.uid()
          AND ownership_verifications.status = 'approved'
        )
        OR
        EXISTS (
          SELECT 1 FROM organization_vehicles ov
          JOIN organization_contributors oc ON oc.organization_id = ov.organization_id
          WHERE ov.vehicle_id = vehicle_image_comments.vehicle_id
          AND oc.user_id = auth.uid()
          AND oc.status = 'active'
          AND ov.status = 'active'
        )
      );
  $sql$;

  EXECUTE $sql$
    CREATE POLICY "Authenticated users can create image comments" ON vehicle_image_comments
      FOR INSERT
      WITH CHECK (
        auth.uid() IS NOT NULL
        AND auth.uid() = user_id
        AND vehicle_id IS NOT NULL
        AND image_id IS NOT NULL
      );
  $sql$;

  EXECUTE $sql$
    COMMENT ON POLICY "Users can view image comments" ON vehicle_image_comments IS
    'Allows viewing comments if vehicle is public, user is owner, or user has contributor access';
  $sql$;
END $$;

