-- Fix Personal Albums Schema
-- Ensures image_sets table supports personal albums (no vehicle_id required)

BEGIN;

-- Make vehicle_id nullable if not already
ALTER TABLE image_sets
ALTER COLUMN vehicle_id DROP NOT NULL;

-- Add is_personal column if not exists
ALTER TABLE image_sets
ADD COLUMN IF NOT EXISTS is_personal BOOLEAN DEFAULT false;

-- Add user_id column if not exists (for personal albums)
ALTER TABLE image_sets
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Create index for personal albums lookup
CREATE INDEX IF NOT EXISTS idx_image_sets_personal_user 
ON image_sets(user_id, is_personal) 
WHERE is_personal = true;

-- Update RLS policy to allow personal album creation
DROP POLICY IF EXISTS "image_sets_insert_policy" ON image_sets;

CREATE POLICY "image_sets_insert_policy" ON image_sets
FOR INSERT WITH CHECK (
  auth.uid() IS NOT NULL
  AND (
    -- Personal album (no vehicle, user_id matches)
    (is_personal = true AND user_id = auth.uid() AND vehicle_id IS NULL)
    OR
    -- Vehicle album (user has access to vehicle)
    (vehicle_id IS NOT NULL AND (
      vehicle_id IN (
        SELECT vehicle_id FROM user_vehicle_roles 
        WHERE user_id = auth.uid()
      )
      OR
      vehicle_id IN (
        SELECT id FROM vehicles WHERE created_by = auth.uid()
      )
    ))
  )
  AND created_by = auth.uid() -- Must match current user
);

-- Ensure created_by can be set to user ID (profiles.id = auth.users.id)
-- No constraint change needed since profiles.id references auth.users(id)

COMMIT;

