-- Create RPC function to update vehicle VIN (bypasses RLS and recursive triggers)
CREATE OR REPLACE FUNCTION update_vehicle_vin_safe(
  p_vehicle_id UUID,
  p_vin TEXT
)
RETURNS TABLE(
  id UUID,
  year INTEGER,
  make TEXT,
  model TEXT,
  vin TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update VIN directly (SECURITY DEFINER bypasses RLS)
  UPDATE vehicles
  SET 
    vin = p_vin,
    updated_at = NOW()
  WHERE id = p_vehicle_id;
  
  -- Return updated vehicle
  RETURN QUERY
  SELECT 
    v.id,
    v.year,
    v.make,
    v.model,
    v.vin
  FROM vehicles v
  WHERE v.id = p_vehicle_id;
END;
$$;

COMMENT ON FUNCTION update_vehicle_vin_safe IS 
'Updates vehicle VIN safely, bypassing RLS and recursive triggers. Use with service role key.';

