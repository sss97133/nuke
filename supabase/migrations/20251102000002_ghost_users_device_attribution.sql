-- Ghost Users & Device Attribution System
-- Tracks contributions by camera device before user signs up
-- When user claims their device, all contributions transfer to their profile

-- Ghost users table: Unclaimed camera devices
CREATE TABLE IF NOT EXISTS ghost_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_fingerprint TEXT NOT NULL UNIQUE, -- "Apple-iPad-iPad back camera 3.3mm f/2.4-17.5.1"
  camera_make TEXT,
  camera_model TEXT,
  lens_model TEXT,
  software_version TEXT,
  first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  total_contributions INTEGER DEFAULT 0,
  claimed_by_user_id UUID REFERENCES auth.users(id),
  claimed_at TIMESTAMP WITH TIME ZONE,
  display_name TEXT, -- e.g., "iPad User" or "iPhone 12 Photographer"
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_ghost_users_fingerprint ON ghost_users(device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_ghost_users_claimed ON ghost_users(claimed_by_user_id);

-- Device attribution table: Links images/events to devices
CREATE TABLE IF NOT EXISTS device_attributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id UUID REFERENCES vehicle_images(id) ON DELETE CASCADE,
  timeline_event_id UUID REFERENCES timeline_events(id) ON DELETE CASCADE,
  device_fingerprint TEXT NOT NULL,
  ghost_user_id UUID REFERENCES ghost_users(id),
  actual_contributor_id UUID REFERENCES auth.users(id), -- Set when ghost user is claimed
  uploaded_by_user_id UUID REFERENCES auth.users(id), -- Who uploaded (might be different)
  attribution_source TEXT DEFAULT 'exif_device', -- How we determined attribution
  confidence_score INTEGER DEFAULT 100, -- 0-100, how sure we are
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints: Must have either image_id or timeline_event_id
  CONSTRAINT attribution_target CHECK (
    (image_id IS NOT NULL) OR (timeline_event_id IS NOT NULL)
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_device_attr_image ON device_attributions(image_id);
CREATE INDEX IF NOT EXISTS idx_device_attr_event ON device_attributions(timeline_event_id);
CREATE INDEX IF NOT EXISTS idx_device_attr_fingerprint ON device_attributions(device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_device_attr_ghost ON device_attributions(ghost_user_id);
CREATE INDEX IF NOT EXISTS idx_device_attr_contributor ON device_attributions(actual_contributor_id);

-- Function: Generate device fingerprint from EXIF
CREATE OR REPLACE FUNCTION generate_device_fingerprint(exif_data JSONB)
RETURNS TEXT AS $$
DECLARE
  make TEXT;
  model TEXT;
  lens TEXT;
  software TEXT;
  fingerprint TEXT;
BEGIN
  make := COALESCE(exif_data->>'Make', 'Unknown');
  model := COALESCE(exif_data->>'Model', 'Unknown');
  lens := COALESCE(exif_data->>'LensModel', 'Unknown');
  software := COALESCE(exif_data->>'Software', 'Unknown');
  
  -- Create fingerprint: "Make-Model-Lens-Software"
  fingerprint := make || '-' || model || '-' || lens || '-' || software;
  
  RETURN fingerprint;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function: Get or create ghost user for device
CREATE OR REPLACE FUNCTION get_or_create_ghost_user(
  p_device_fingerprint TEXT,
  p_camera_make TEXT,
  p_camera_model TEXT,
  p_lens_model TEXT,
  p_software_version TEXT
)
RETURNS UUID AS $$
DECLARE
  v_ghost_user_id UUID;
  v_display_name TEXT;
BEGIN
  -- Try to find existing ghost user
  SELECT id INTO v_ghost_user_id
  FROM ghost_users
  WHERE device_fingerprint = p_device_fingerprint;
  
  IF v_ghost_user_id IS NOT NULL THEN
    -- Update last_seen and increment contributions
    UPDATE ghost_users
    SET last_seen_at = NOW(),
        total_contributions = total_contributions + 1
    WHERE id = v_ghost_user_id;
    
    RETURN v_ghost_user_id;
  END IF;
  
  -- Create display name
  v_display_name := COALESCE(p_camera_model, p_camera_make, 'Unknown') || ' User';
  
  -- Create new ghost user
  INSERT INTO ghost_users (
    device_fingerprint,
    camera_make,
    camera_model,
    lens_model,
    software_version,
    display_name,
    total_contributions
  ) VALUES (
    p_device_fingerprint,
    p_camera_make,
    p_camera_model,
    p_lens_model,
    p_software_version,
    v_display_name,
    1
  )
  RETURNING id INTO v_ghost_user_id;
  
  RETURN v_ghost_user_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Auto-create device attribution when image is uploaded
CREATE OR REPLACE FUNCTION auto_attribute_image_to_device()
RETURNS TRIGGER AS $$
DECLARE
  v_device_fingerprint TEXT;
  v_ghost_user_id UUID;
  v_camera_make TEXT;
  v_camera_model TEXT;
  v_lens_model TEXT;
  v_software TEXT;
BEGIN
  -- Only process if we have EXIF data
  IF NEW.exif_data IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Extract device info
  v_camera_make := NEW.exif_data->>'Make';
  v_camera_model := NEW.exif_data->>'Model';
  v_lens_model := NEW.exif_data->>'LensModel';
  v_software := NEW.exif_data->>'Software';
  
  -- Generate fingerprint
  v_device_fingerprint := generate_device_fingerprint(NEW.exif_data);
  
  -- Skip if no meaningful device info
  IF v_device_fingerprint = 'Unknown-Unknown-Unknown-Unknown' THEN
    RETURN NEW;
  END IF;
  
  -- Get or create ghost user
  v_ghost_user_id := get_or_create_ghost_user(
    v_device_fingerprint,
    v_camera_make,
    v_camera_model,
    v_lens_model,
    v_software
  );
  
  -- Create attribution
  INSERT INTO device_attributions (
    image_id,
    device_fingerprint,
    ghost_user_id,
    uploaded_by_user_id,
    attribution_source,
    confidence_score
  ) VALUES (
    NEW.id,
    v_device_fingerprint,
    v_ghost_user_id,
    NEW.user_id,
    'exif_device',
    100
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to vehicle_images
DROP TRIGGER IF EXISTS trg_auto_attribute_device ON vehicle_images;
CREATE TRIGGER trg_auto_attribute_device
  AFTER INSERT ON vehicle_images
  FOR EACH ROW
  EXECUTE FUNCTION auto_attribute_image_to_device();

-- Function: Claim a ghost user (when Joey signs up and verifies his device)
CREATE OR REPLACE FUNCTION claim_ghost_user(
  p_user_id UUID,
  p_device_fingerprint TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_ghost_user_id UUID;
  v_contributions_transferred INTEGER;
BEGIN
  -- Find the ghost user
  SELECT id INTO v_ghost_user_id
  FROM ghost_users
  WHERE device_fingerprint = p_device_fingerprint
    AND claimed_by_user_id IS NULL;
  
  IF v_ghost_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Ghost user not found or already claimed'
    );
  END IF;
  
  -- Claim the ghost user
  UPDATE ghost_users
  SET claimed_by_user_id = p_user_id,
      claimed_at = NOW()
  WHERE id = v_ghost_user_id;
  
  -- Update all attributions to point to real user
  UPDATE device_attributions
  SET actual_contributor_id = p_user_id
  WHERE ghost_user_id = v_ghost_user_id;
  
  GET DIAGNOSTICS v_contributions_transferred = ROW_COUNT;
  
  -- Also update vehicle_contributors table
  -- (This retroactively gives Joey credit for all his work)
  INSERT INTO vehicle_contributors (vehicle_id, user_id, role, contribution_type)
  SELECT DISTINCT 
    vi.vehicle_id,
    p_user_id,
    'photographer',
    'images'
  FROM vehicle_images vi
  JOIN device_attributions da ON da.image_id = vi.id
  WHERE da.ghost_user_id = v_ghost_user_id
  ON CONFLICT (vehicle_id, user_id) DO NOTHING;
  
  RETURN jsonb_build_object(
    'success', true,
    'ghost_user_id', v_ghost_user_id,
    'contributions_transferred', v_contributions_transferred
  );
END;
$$ LANGUAGE plpgsql;

-- View: Ghost user contributions summary
CREATE OR REPLACE VIEW ghost_user_contributions AS
SELECT 
  gu.id as ghost_user_id,
  gu.device_fingerprint,
  gu.camera_make,
  gu.camera_model,
  gu.display_name,
  gu.first_seen_at,
  gu.last_seen_at,
  gu.total_contributions,
  gu.claimed_by_user_id,
  gu.claimed_at,
  p.full_name as claimed_by_name,
  COUNT(DISTINCT da.image_id) as image_count,
  COUNT(DISTINCT vi.vehicle_id) as vehicle_count,
  MIN(vi.taken_at) as first_photo_date,
  MAX(vi.taken_at) as last_photo_date
FROM ghost_users gu
LEFT JOIN device_attributions da ON da.ghost_user_id = gu.id
LEFT JOIN vehicle_images vi ON vi.id = da.image_id
LEFT JOIN profiles p ON p.id = gu.claimed_by_user_id
GROUP BY 
  gu.id,
  gu.device_fingerprint,
  gu.camera_make,
  gu.camera_model,
  gu.display_name,
  gu.first_seen_at,
  gu.last_seen_at,
  gu.total_contributions,
  gu.claimed_by_user_id,
  gu.claimed_at,
  p.full_name;

COMMENT ON TABLE ghost_users IS 'Unclaimed camera devices - contributors who haven''t signed up yet';
COMMENT ON TABLE device_attributions IS 'Links images to the actual photographer via device EXIF, not the uploader';
COMMENT ON FUNCTION claim_ghost_user IS 'Called when a user signs up and verifies they own a device - transfers all ghost contributions';

