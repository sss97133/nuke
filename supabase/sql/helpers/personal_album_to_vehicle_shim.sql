-- Shim: ensure convert_personal_album_to_vehicle exists for reset environments
-- Safe to run multiple times.

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
BEGIN
  -- Verify album exists, is personal, and belongs to current user
  SELECT user_id INTO v_user_id
  FROM image_sets
  WHERE id = p_image_set_id
    AND is_personal = true
    AND vehicle_id IS NULL
    AND user_id = auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Album not found or permission denied';
  END IF;

  -- Create vehicle profile
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
      AND (user_id = v_user_id OR user_id = auth.uid());
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
$$ LANGUAGE plpgsql SECURITY DEFINER;


