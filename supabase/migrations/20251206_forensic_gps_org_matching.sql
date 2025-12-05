-- Forensic GPS Organization Matching
-- Used by forensic receipt service to auto-match work sessions to businesses

CREATE OR REPLACE FUNCTION find_organizations_near_location(
  p_latitude DECIMAL,
  p_longitude DECIMAL,
  p_max_distance_meters INTEGER DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  business_name TEXT,
  distance_meters NUMERIC,
  business_type TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    b.id,
    b.business_name,
    ROUND(
      ST_Distance(
        ST_MakePoint(b.longitude, b.latitude)::geography,
        ST_MakePoint(p_longitude, p_latitude)::geography
      )::NUMERIC,
      2
    ) AS distance_meters,
    b.business_type
  FROM businesses b
  WHERE b.latitude IS NOT NULL
    AND b.longitude IS NOT NULL
    AND ST_DWithin(
      ST_MakePoint(b.longitude, b.latitude)::geography,
      ST_MakePoint(p_longitude, p_latitude)::geography,
      p_max_distance_meters
    )
  ORDER BY distance_meters ASC;
END;
$$ LANGUAGE plpgsql;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION find_organizations_near_location(DECIMAL, DECIMAL, INTEGER) TO authenticated;

-- Ensure businesses table has lat/long columns (may already exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'businesses' AND column_name = 'latitude') THEN
    ALTER TABLE businesses ADD COLUMN latitude DECIMAL(10, 8);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'businesses' AND column_name = 'longitude') THEN
    ALTER TABLE businesses ADD COLUMN longitude DECIMAL(11, 8);
  END IF;
END $$;

