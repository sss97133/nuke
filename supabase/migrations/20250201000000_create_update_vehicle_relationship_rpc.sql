-- Create RPC function to update vehicle relationship
-- This allows users to update their relationship to a vehicle (discovered/curated/consigned/etc.)
-- Note: "owned" relationship requires ownership verification and cannot be set via this function

CREATE OR REPLACE FUNCTION update_vehicle_relationship(
  p_vehicle_id UUID,
  p_user_id UUID,
  p_relationship_type TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_valid_type BOOLEAN;
BEGIN
  -- Validate relationship type (exclude 'owned' as it requires verification)
  IF p_relationship_type NOT IN ('interested', 'discovered', 'curated', 'consigned', 'previously_owned') THEN
    RAISE EXCEPTION 'Invalid relationship type: %. Valid types: interested, discovered, curated, consigned, previously_owned', p_relationship_type;
  END IF;
  
  -- Check if discovered_vehicles table has relationship_type column
  -- If it does, use it; otherwise just set is_active
  BEGIN
    -- Try to insert/update with relationship_type
    INSERT INTO discovered_vehicles (
      vehicle_id,
      user_id,
      relationship_type,
      is_active,
      created_at,
      updated_at
    )
    VALUES (
      p_vehicle_id,
      p_user_id,
      p_relationship_type,
      true,
      NOW(),
      NOW()
    )
    ON CONFLICT (vehicle_id, user_id)
    DO UPDATE SET
      relationship_type = p_relationship_type,
      is_active = true,
      updated_at = NOW();
    
    RETURN true;
  EXCEPTION
    WHEN undefined_column THEN
      -- relationship_type column doesn't exist, update without it
      INSERT INTO discovered_vehicles (
        vehicle_id,
        user_id,
        is_active,
        created_at,
        updated_at
      )
      VALUES (
        p_vehicle_id,
        p_user_id,
        true,
        NOW(),
        NOW()
      )
      ON CONFLICT (vehicle_id, user_id)
      DO UPDATE SET
        is_active = true,
        updated_at = NOW();
      
      RETURN true;
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION update_vehicle_relationship TO authenticated;

COMMENT ON FUNCTION update_vehicle_relationship IS 
'Updates user relationship to a vehicle (discovered/curated/consigned/previously_owned/interested). Note: "owned" requires ownership verification.';

