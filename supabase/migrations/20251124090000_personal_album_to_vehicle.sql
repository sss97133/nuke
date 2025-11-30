-- Convert Personal Album To Vehicle Profile
-- 
-- Allows a user to treat a personal image_set (is_personal = true, no vehicle_id)
-- as a pre-vehicle album, and then promote it to a full vehicle profile once
-- there is enough information (typically a VIN plus year/make/model).

BEGIN;

CREATE OR REPLACE FUNCTION convert_personal_album_to_vehicle(
  p_image_set_id UUID,
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
  v_current_user_id UUID;
BEGIN
  -- Get current user ID
  v_current_user_id := auth.uid();
  
  IF v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Verify album exists, is personal, and belongs to current user
  SELECT user_id INTO v_user_id
  FROM image_sets
  WHERE id = p_image_set_id
    AND is_personal = true
    AND vehicle_id IS NULL
    AND user_id = v_current_user_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Album not found or permission denied. Album ID: %, User ID: %', p_image_set_id, v_current_user_id;
  END IF;

  -- Create vehicle profile
  -- user_id is a GENERATED column (always = uploaded_by), so we set uploaded_by instead
  INSERT INTO vehicles (
    uploaded_by,
    year,
    make,
    model,
    trim,
    vin,
    is_draft,
    status,
    is_public
  )
  VALUES (
    v_user_id,
    p_year,
    p_make,
    p_model,
    p_trim,
    p_vin,
    false,
    'active',
    false
  )
  RETURNING id INTO v_new_vehicle_id;

  -- Collect all image ids that belong to this album
  SELECT ARRAY_AGG(image_id) INTO v_image_ids
  FROM image_set_members
  WHERE image_set_id = p_image_set_id;

  -- Link images to the new vehicle and mark as organized
  IF v_image_ids IS NOT NULL THEN
    UPDATE vehicle_images
    SET
      vehicle_id = v_new_vehicle_id,
      organization_status = 'organized',
      organized_at = NOW(),
      updated_at = NOW()
    WHERE id = ANY(v_image_ids)
      AND user_id = v_user_id;
  END IF;

  -- Flip album from personal to vehicle-linked set
  UPDATE image_sets
  SET
    vehicle_id = v_new_vehicle_id,
    is_personal = false,
    updated_at = NOW()
  WHERE id = p_image_set_id;

  RETURN v_new_vehicle_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
SET row_security = off;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.convert_personal_album_to_vehicle(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_personal_album_to_vehicle(UUID, INTEGER, TEXT, TEXT, TEXT, TEXT) TO anon;

COMMENT ON FUNCTION public.convert_personal_album_to_vehicle IS 
'Converts a personal image_set album into a full vehicle profile. Creates vehicle, links all album images, and updates the album to be vehicle-linked.';

COMMIT;


