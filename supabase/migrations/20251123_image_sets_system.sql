-- Image Sets System - Professional Photo Album Management
-- Enables users to create albums/sets, group images, prioritize, and link to timeline events
-- Similar to Adobe Bridge / Apple Photos album functionality

BEGIN;

-- ============================================================================
-- IMAGE SETS (Albums/Collections)
-- ============================================================================
CREATE TABLE IF NOT EXISTS image_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- Set metadata
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#808080', -- Visual organization
  icon TEXT, -- Optional icon/emoji for quick identification
  
  -- Organization
  is_primary BOOLEAN DEFAULT false, -- Featured set
  display_order INTEGER DEFAULT 0, -- Manual sort order
  
  -- Timeline integration
  timeline_event_id UUID REFERENCES timeline_events(id) ON DELETE SET NULL,
  event_date TIMESTAMPTZ, -- When this set represents an event
  
  -- Metadata
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_image_sets_vehicle ON image_sets(vehicle_id);
CREATE INDEX idx_image_sets_creator ON image_sets(created_by);
CREATE INDEX idx_image_sets_timeline ON image_sets(timeline_event_id);
CREATE INDEX idx_image_sets_display_order ON image_sets(vehicle_id, display_order);

-- ============================================================================
-- IMAGE SET MEMBERS (Images in Sets)
-- ============================================================================
CREATE TABLE IF NOT EXISTS image_set_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_set_id UUID NOT NULL REFERENCES image_sets(id) ON DELETE CASCADE,
  image_id UUID NOT NULL REFERENCES vehicle_images(id) ON DELETE CASCADE,
  
  -- Manual prioritization/ordering
  priority INTEGER DEFAULT 0, -- Higher = more important
  display_order INTEGER DEFAULT 0, -- Position in set
  
  -- Member metadata
  caption TEXT, -- Set-specific caption (overrides image caption)
  notes TEXT, -- Why this image is in this set
  role TEXT, -- 'cover', 'hero', 'detail', 'comparison', etc.
  
  -- Who added it and when
  added_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(image_set_id, image_id) -- Image can only be in set once
);

CREATE INDEX idx_image_set_members_set ON image_set_members(image_set_id);
CREATE INDEX idx_image_set_members_image ON image_set_members(image_id);
CREATE INDEX idx_image_set_members_priority ON image_set_members(image_set_id, priority DESC);
CREATE INDEX idx_image_set_members_display_order ON image_set_members(image_set_id, display_order);

-- ============================================================================
-- IMAGE PRIORITIES (Global Image Prioritization)
-- ============================================================================
-- Users can manually set priority on images independent of sets
ALTER TABLE vehicle_images 
ADD COLUMN IF NOT EXISTS manual_priority INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS user_tags TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS user_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_vehicle_images_priority ON vehicle_images(vehicle_id, manual_priority DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_display_order ON vehicle_images(vehicle_id, display_order);

-- ============================================================================
-- RLS POLICIES - Image Sets
-- ============================================================================

-- Enable RLS
ALTER TABLE image_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_set_members ENABLE ROW LEVEL SECURITY;

-- Anyone can view image sets for vehicles they can view
CREATE POLICY "image_sets_select_policy" ON image_sets
  FOR SELECT
  USING (
    -- Public vehicle OR user has access
    vehicle_id IN (
      SELECT id FROM vehicles 
      WHERE is_draft = false AND is_private = false
    )
    OR
    vehicle_id IN (
      SELECT vehicle_id FROM user_vehicle_roles 
      WHERE user_id = auth.uid()
    )
    OR
    vehicle_id IN (
      SELECT id FROM vehicles WHERE created_by = auth.uid()
    )
  );

-- Users can create sets for vehicles they have access to
CREATE POLICY "image_sets_insert_policy" ON image_sets
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND
    (
      vehicle_id IN (
        SELECT vehicle_id FROM user_vehicle_roles 
        WHERE user_id = auth.uid()
      )
      OR
      vehicle_id IN (
        SELECT id FROM vehicles WHERE created_by = auth.uid()
      )
    )
  );

-- Users can update their own sets OR sets for vehicles they own
CREATE POLICY "image_sets_update_policy" ON image_sets
  FOR UPDATE
  USING (
    created_by = auth.uid()
    OR
    vehicle_id IN (
      SELECT id FROM vehicles WHERE created_by = auth.uid()
    )
    OR
    vehicle_id IN (
      SELECT vehicle_id FROM user_vehicle_roles 
      WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
    )
  );

-- Users can delete their own sets OR sets for vehicles they own
CREATE POLICY "image_sets_delete_policy" ON image_sets
  FOR DELETE
  USING (
    created_by = auth.uid()
    OR
    vehicle_id IN (
      SELECT id FROM vehicles WHERE created_by = auth.uid()
    )
  );

-- ============================================================================
-- RLS POLICIES - Image Set Members
-- ============================================================================

-- Anyone can view set members for sets they can view
CREATE POLICY "image_set_members_select_policy" ON image_set_members
  FOR SELECT
  USING (
    image_set_id IN (SELECT id FROM image_sets)
  );

-- Users can add images to sets they have access to
CREATE POLICY "image_set_members_insert_policy" ON image_set_members
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND
    image_set_id IN (
      SELECT id FROM image_sets 
      WHERE created_by = auth.uid()
      OR vehicle_id IN (
        SELECT id FROM vehicles WHERE created_by = auth.uid()
      )
      OR vehicle_id IN (
        SELECT vehicle_id FROM user_vehicle_roles 
        WHERE user_id = auth.uid() AND role IN ('owner', 'editor', 'contributor')
      )
    )
  );

-- Users can update members in sets they control
CREATE POLICY "image_set_members_update_policy" ON image_set_members
  FOR UPDATE
  USING (
    added_by = auth.uid()
    OR
    image_set_id IN (
      SELECT id FROM image_sets 
      WHERE created_by = auth.uid()
      OR vehicle_id IN (
        SELECT id FROM vehicles WHERE created_by = auth.uid()
      )
    )
  );

-- Users can remove members from sets they control
CREATE POLICY "image_set_members_delete_policy" ON image_set_members
  FOR DELETE
  USING (
    added_by = auth.uid()
    OR
    image_set_id IN (
      SELECT id FROM image_sets 
      WHERE created_by = auth.uid()
      OR vehicle_id IN (
        SELECT id FROM vehicles WHERE created_by = auth.uid()
      )
    )
  );

-- ============================================================================
-- FUNCTIONS - Helper Utilities
-- ============================================================================

-- Function to get image count for a set
CREATE OR REPLACE FUNCTION get_image_set_count(set_id UUID)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER 
  FROM image_set_members 
  WHERE image_set_id = set_id;
$$ LANGUAGE SQL STABLE;

-- Function to get all sets for an image
CREATE OR REPLACE FUNCTION get_image_sets_for_image(img_id UUID)
RETURNS TABLE (
  set_id UUID,
  set_name TEXT,
  set_color TEXT,
  priority INTEGER,
  display_order INTEGER
) AS $$
  SELECT 
    s.id,
    s.name,
    s.color,
    m.priority,
    m.display_order
  FROM image_set_members m
  JOIN image_sets s ON s.id = m.image_set_id
  WHERE m.image_id = img_id
  ORDER BY m.priority DESC, m.display_order;
$$ LANGUAGE SQL STABLE;

-- Function to reorder images in a set
CREATE OR REPLACE FUNCTION reorder_image_set(
  set_id UUID,
  image_ids UUID[]
)
RETURNS VOID AS $$
DECLARE
  img_id UUID;
  idx INTEGER := 0;
BEGIN
  -- Validate user has permission
  IF NOT EXISTS (
    SELECT 1 FROM image_sets 
    WHERE id = set_id 
    AND (
      created_by = auth.uid()
      OR vehicle_id IN (
        SELECT id FROM vehicles WHERE created_by = auth.uid()
      )
    )
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  
  -- Update display order for each image
  FOREACH img_id IN ARRAY image_ids
  LOOP
    UPDATE image_set_members
    SET display_order = idx,
        updated_at = NOW()
    WHERE image_set_id = set_id
    AND image_id = img_id;
    
    idx := idx + 1;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to bulk add images to a set
CREATE OR REPLACE FUNCTION bulk_add_to_image_set(
  set_id UUID,
  image_ids UUID[]
)
RETURNS INTEGER AS $$
DECLARE
  img_id UUID;
  added_count INTEGER := 0;
  next_order INTEGER;
BEGIN
  -- Validate user has permission
  IF NOT EXISTS (
    SELECT 1 FROM image_sets 
    WHERE id = set_id 
    AND (
      created_by = auth.uid()
      OR vehicle_id IN (
        SELECT id FROM vehicles WHERE created_by = auth.uid()
      )
      OR vehicle_id IN (
        SELECT vehicle_id FROM user_vehicle_roles 
        WHERE user_id = auth.uid() AND role IN ('owner', 'editor', 'contributor')
      )
    )
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  
  -- Get next display order
  SELECT COALESCE(MAX(display_order), -1) + 1 
  INTO next_order
  FROM image_set_members
  WHERE image_set_id = set_id;
  
  -- Add each image
  FOREACH img_id IN ARRAY image_ids
  LOOP
    INSERT INTO image_set_members (
      image_set_id,
      image_id,
      display_order,
      added_by
    )
    VALUES (
      set_id,
      img_id,
      next_order,
      auth.uid()
    )
    ON CONFLICT (image_set_id, image_id) DO NOTHING;
    
    IF FOUND THEN
      added_count := added_count + 1;
      next_order := next_order + 1;
    END IF;
  END LOOP;
  
  RETURN added_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update image priority
CREATE OR REPLACE FUNCTION set_image_priority(
  img_id UUID,
  new_priority INTEGER
)
RETURNS VOID AS $$
BEGIN
  -- Validate user has permission
  IF NOT EXISTS (
    SELECT 1 FROM vehicle_images vi
    WHERE vi.id = img_id
    AND (
      vi.user_id = auth.uid()
      OR vi.vehicle_id IN (
        SELECT id FROM vehicles WHERE created_by = auth.uid()
      )
      OR vi.vehicle_id IN (
        SELECT vehicle_id FROM user_vehicle_roles 
        WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
      )
    )
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  
  UPDATE vehicle_images
  SET manual_priority = new_priority
  WHERE id = img_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Update updated_at timestamp on image_sets
CREATE OR REPLACE FUNCTION update_image_sets_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_image_sets_updated_at ON image_sets;
CREATE TRIGGER tr_image_sets_updated_at
  BEFORE UPDATE ON image_sets
  FOR EACH ROW
  EXECUTE FUNCTION update_image_sets_timestamp();

-- Update updated_at timestamp on image_set_members
DROP TRIGGER IF EXISTS tr_image_set_members_updated_at ON image_set_members;
CREATE TRIGGER tr_image_set_members_updated_at
  BEFORE UPDATE ON image_set_members
  FOR EACH ROW
  EXECUTE FUNCTION update_image_sets_timestamp();

COMMIT;

-- ============================================================================
-- EXAMPLE USAGE (commented out)
-- ============================================================================

-- Create a new image set:
-- INSERT INTO image_sets (vehicle_id, created_by, name, description, color)
-- VALUES ('vehicle-uuid', auth.uid(), 'Restoration Process', 'Before and after photos', '#FF5733');

-- Add images to the set:
-- SELECT bulk_add_to_image_set('set-uuid', ARRAY['img1-uuid', 'img2-uuid', 'img3-uuid']);

-- Reorder images in set:
-- SELECT reorder_image_set('set-uuid', ARRAY['img3-uuid', 'img1-uuid', 'img2-uuid']);

-- Get all sets for an image:
-- SELECT * FROM get_image_sets_for_image('img-uuid');

-- Set image priority:
-- SELECT set_image_priority('img-uuid', 100);

