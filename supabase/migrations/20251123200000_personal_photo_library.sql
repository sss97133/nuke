-- ============================================================================
-- PERSONAL PHOTO LIBRARY SYSTEM
-- ============================================================================
-- 
-- GOAL: Enable bulk photo uploads without requiring vehicle_id upfront
-- Users can dump thousands of photos, then organize them into vehicles/albums
-- AI suggests groupings, user confirms and links photos to vehicles
--
-- WORKFLOW:
-- 1. Bulk upload → photos go into personal library (vehicle_id = NULL)
-- 2. AI processes immediately → extracts metadata, suggests vehicle groupings  
-- 3. User reviews suggestions → confirms, edits, or rejects
-- 4. Photos get linked to vehicles → disappear from "unorganized" view
--
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Make vehicle_id NULLABLE (Breaking Change)
-- ============================================================================

-- Drop existing policies that enforce vehicle_id
DROP POLICY IF EXISTS "Users can insert images for their own vehicles" ON vehicle_images;
DROP POLICY IF EXISTS "Users can update images for their own vehicles" ON vehicle_images;
DROP POLICY IF EXISTS "Users can delete images for their own vehicles" ON vehicle_images;

-- Make vehicle_id nullable
ALTER TABLE vehicle_images 
ALTER COLUMN vehicle_id DROP NOT NULL;

-- Add index for unorganized photos query
CREATE INDEX IF NOT EXISTS idx_vehicle_images_unorganized 
ON vehicle_images(user_id, created_at DESC) 
WHERE vehicle_id IS NULL;

-- ============================================================================
-- STEP 2: Add AI Suggestions & Organization Tracking
-- ============================================================================

ALTER TABLE vehicle_images
ADD COLUMN IF NOT EXISTS ai_processing_status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'complete', 'failed'
ADD COLUMN IF NOT EXISTS ai_processing_started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS ai_processing_completed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS ai_suggestions JSONB DEFAULT '{}'::jsonb, -- AI-suggested groupings
ADD COLUMN IF NOT EXISTS organization_status TEXT DEFAULT 'unorganized', -- 'unorganized', 'organized', 'ignored'
ADD COLUMN IF NOT EXISTS organized_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS ai_detected_vehicle JSONB, -- { year, make, model, confidence }
ADD COLUMN IF NOT EXISTS ai_detected_angle TEXT, -- 'front', 'rear', 'side', 'interior', etc.
ADD COLUMN IF NOT EXISTS ai_detected_angle_confidence REAL,
ADD COLUMN IF NOT EXISTS suggested_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL;

-- Indexes for filtering
CREATE INDEX IF NOT EXISTS idx_vehicle_images_org_status 
ON vehicle_images(user_id, organization_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vehicle_images_ai_status 
ON vehicle_images(ai_processing_status, created_at);

CREATE INDEX IF NOT EXISTS idx_vehicle_images_suggested_vehicle 
ON vehicle_images(suggested_vehicle_id) 
WHERE suggested_vehicle_id IS NOT NULL;

-- ============================================================================
-- STEP 3: Vehicle Suggestion Groups
-- ============================================================================
-- AI creates suggested vehicle profiles from analyzing unorganized photos

CREATE TABLE IF NOT EXISTS vehicle_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- AI-detected vehicle info
  suggested_year INTEGER,
  suggested_make TEXT,
  suggested_model TEXT,
  suggested_trim TEXT,
  suggested_vin TEXT,
  confidence REAL DEFAULT 0.0, -- 0.0 - 1.0
  
  -- Grouping metadata
  image_count INTEGER DEFAULT 0,
  sample_image_ids UUID[] DEFAULT '{}', -- First 5 images for preview
  
  -- User actions
  status TEXT DEFAULT 'pending', -- 'pending', 'accepted', 'rejected', 'modified'
  accepted_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL, -- If user accepts and creates vehicle
  
  -- AI reasoning
  detection_method TEXT, -- 'visual_analysis', 'vin_detection', 'exif_clustering', 'user_pattern'
  reasoning TEXT, -- Why AI grouped these together
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX idx_vehicle_suggestions_user ON vehicle_suggestions(user_id, status);
CREATE INDEX idx_vehicle_suggestions_confidence ON vehicle_suggestions(confidence DESC);

-- ============================================================================
-- STEP 4: Update Image Sets for Personal Albums
-- ============================================================================

-- Make vehicle_id nullable in image_sets (for personal albums not tied to vehicles)
ALTER TABLE image_sets
ALTER COLUMN vehicle_id DROP NOT NULL;

-- Add personal album flag
ALTER TABLE image_sets
ADD COLUMN IF NOT EXISTS is_personal BOOLEAN DEFAULT false, -- Personal album (no vehicle)
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Update existing image_sets to set user_id from created_by
UPDATE image_sets 
SET user_id = (SELECT id FROM auth.users WHERE id = created_by)
WHERE user_id IS NULL;

-- Index for personal albums
CREATE INDEX IF NOT EXISTS idx_image_sets_personal 
ON image_sets(user_id, is_personal) 
WHERE is_personal = true;

-- ============================================================================
-- STEP 5: Views for Easy Querying
-- ============================================================================

-- View: Unorganized photos (inbox)
CREATE OR REPLACE VIEW user_photo_inbox AS
SELECT 
  vi.*,
  COALESCE(
    (SELECT COUNT(*) FROM image_set_members WHERE image_id = vi.id),
    0
  ) as album_count
FROM vehicle_images vi
WHERE 
  vi.vehicle_id IS NULL 
  AND vi.organization_status = 'unorganized';

-- View: Organized photos (linked to vehicles or in albums)
CREATE OR REPLACE VIEW user_organized_photos AS
SELECT 
  vi.*,
  v.year, v.make, v.model,
  COALESCE(
    (SELECT COUNT(*) FROM image_set_members WHERE image_id = vi.id),
    0
  ) as album_count
FROM vehicle_images vi
LEFT JOIN vehicles v ON v.id = vi.vehicle_id
WHERE 
  vi.vehicle_id IS NOT NULL 
  OR vi.organization_status = 'organized';

-- View: AI processing queue
CREATE OR REPLACE VIEW ai_processing_queue AS
SELECT 
  id,
  user_id,
  image_url,
  file_name,
  ai_processing_status,
  ai_processing_started_at,
  created_at,
  EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 as minutes_waiting
FROM vehicle_images
WHERE 
  ai_processing_status IN ('pending', 'processing')
ORDER BY created_at ASC;

-- ============================================================================
-- STEP 6: Updated RLS Policies
-- ============================================================================

-- Policy: Users can insert their own images (with or without vehicle)
CREATE POLICY "users_can_insert_own_images" ON vehicle_images
FOR INSERT WITH CHECK (
  auth.uid() = user_id
  AND (
    vehicle_id IS NULL -- Personal library
    OR
    EXISTS ( -- Or vehicle they own
      SELECT 1 FROM vehicles 
      WHERE vehicles.id = vehicle_id 
      AND vehicles.user_id = auth.uid()
    )
  )
);

-- Policy: Users can view their own unorganized images
CREATE POLICY "users_can_view_own_unorganized_images" ON vehicle_images
FOR SELECT USING (
  auth.uid() = user_id
  AND vehicle_id IS NULL
);

-- Policy: Users can update their own images
CREATE POLICY "users_can_update_own_images" ON vehicle_images
FOR UPDATE USING (
  auth.uid() = user_id
  OR
  (vehicle_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM vehicles 
    WHERE vehicles.id = vehicle_id 
    AND vehicles.user_id = auth.uid()
  ))
);

-- Policy: Users can delete their own images
CREATE POLICY "users_can_delete_own_images" ON vehicle_images
FOR DELETE USING (
  auth.uid() = user_id
  OR
  (vehicle_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM vehicles 
    WHERE vehicles.id = vehicle_id 
    AND vehicles.user_id = auth.uid()
  ))
);

-- ============================================================================
-- RLS for vehicle_suggestions
-- ============================================================================

ALTER TABLE vehicle_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_can_view_own_suggestions" ON vehicle_suggestions
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "users_can_update_own_suggestions" ON vehicle_suggestions
FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "system_can_create_suggestions" ON vehicle_suggestions
FOR INSERT WITH CHECK (true); -- Service role creates these

CREATE POLICY "users_can_delete_own_suggestions" ON vehicle_suggestions
FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- STEP 7: Helper Functions
-- ============================================================================

-- Function: Get unorganized photo count for user
CREATE OR REPLACE FUNCTION get_unorganized_photo_count(p_user_id UUID)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
  FROM vehicle_images
  WHERE user_id = p_user_id
  AND vehicle_id IS NULL
  AND organization_status = 'unorganized';
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- Function: Bulk link photos to vehicle
CREATE OR REPLACE FUNCTION bulk_link_photos_to_vehicle(
  p_image_ids UUID[],
  p_vehicle_id UUID
)
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER := 0;
BEGIN
  -- Verify user owns the vehicle
  IF NOT EXISTS (
    SELECT 1 FROM vehicles 
    WHERE id = p_vehicle_id 
    AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Permission denied: user does not own vehicle';
  END IF;

  -- Update images
  UPDATE vehicle_images
  SET 
    vehicle_id = p_vehicle_id,
    organization_status = 'organized',
    organized_at = NOW(),
    updated_at = NOW()
  WHERE 
    id = ANY(p_image_ids)
    AND user_id = auth.uid();
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Accept vehicle suggestion and create vehicle profile
CREATE OR REPLACE FUNCTION accept_vehicle_suggestion(
  p_suggestion_id UUID,
  p_year INTEGER,
  p_make TEXT,
  p_model TEXT,
  p_trim TEXT DEFAULT NULL,
  p_vin TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_user_id UUID;
  v_new_vehicle_id UUID;
  v_image_ids UUID[];
BEGIN
  -- Get suggestion details
  SELECT user_id INTO v_user_id
  FROM vehicle_suggestions
  WHERE id = p_suggestion_id
  AND user_id = auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Suggestion not found or permission denied';
  END IF;
  
  -- Create vehicle
  INSERT INTO vehicles (
    user_id,
    year,
    make,
    model,
    trim,
    vin,
    is_draft,
    is_private,
    created_by
  )
  VALUES (
    v_user_id,
    p_year,
    p_make,
    p_model,
    p_trim,
    p_vin,
    false,
    true,
    v_user_id
  )
  RETURNING id INTO v_new_vehicle_id;
  
  -- Get all images suggested for this vehicle
  SELECT ARRAY_AGG(id) INTO v_image_ids
  FROM vehicle_images
  WHERE suggested_vehicle_id = p_suggestion_id
  OR id = ANY((SELECT sample_image_ids FROM vehicle_suggestions WHERE id = p_suggestion_id));
  
  -- Link images to new vehicle
  IF v_image_ids IS NOT NULL THEN
    UPDATE vehicle_images
    SET 
      vehicle_id = v_new_vehicle_id,
      organization_status = 'organized',
      organized_at = NOW()
    WHERE id = ANY(v_image_ids);
  END IF;
  
  -- Mark suggestion as accepted
  UPDATE vehicle_suggestions
  SET 
    status = 'accepted',
    accepted_vehicle_id = v_new_vehicle_id,
    reviewed_at = NOW()
  WHERE id = p_suggestion_id;
  
  RETURN v_new_vehicle_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Reject vehicle suggestion
CREATE OR REPLACE FUNCTION reject_vehicle_suggestion(
  p_suggestion_id UUID
)
RETURNS VOID AS $$
BEGIN
  -- Verify ownership
  IF NOT EXISTS (
    SELECT 1 FROM vehicle_suggestions 
    WHERE id = p_suggestion_id 
    AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  
  -- Clear suggested_vehicle_id from images
  UPDATE vehicle_images
  SET suggested_vehicle_id = NULL
  WHERE suggested_vehicle_id = p_suggestion_id;
  
  -- Mark as rejected
  UPDATE vehicle_suggestions
  SET 
    status = 'rejected',
    reviewed_at = NOW()
  WHERE id = p_suggestion_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- STEP 8: Update Image Sets Policies for Personal Albums
-- ============================================================================

-- Drop old policy
DROP POLICY IF EXISTS "image_sets_insert_policy" ON image_sets;

-- New policy: Users can create personal albums OR vehicle albums they have access to
CREATE POLICY "image_sets_insert_policy" ON image_sets
FOR INSERT WITH CHECK (
  auth.uid() IS NOT NULL
  AND (
    -- Personal album (no vehicle)
    (is_personal = true AND user_id = auth.uid())
    OR
    -- Vehicle album (user has access)
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
);

COMMIT;

-- ============================================================================
-- EXAMPLE USAGE
-- ============================================================================

-- Get unorganized photo count:
-- SELECT get_unorganized_photo_count(auth.uid());

-- Bulk link photos to vehicle:
-- SELECT bulk_link_photos_to_vehicle(
--   ARRAY['img1-uuid', 'img2-uuid', 'img3-uuid'],
--   'vehicle-uuid'
-- );

-- Accept AI suggestion and create vehicle:
-- SELECT accept_vehicle_suggestion(
--   'suggestion-uuid',
--   1969, 'Ford', 'Bronco', 'Sport', 'U15GLE12345'
-- );

-- Reject AI suggestion:
-- SELECT reject_vehicle_suggestion('suggestion-uuid');

