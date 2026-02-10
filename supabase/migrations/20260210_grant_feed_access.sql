-- Grant SELECT on vehicle_valuation_feed to public-facing roles
-- Without this, the anon key can only see ~4 rows instead of the full 480K+
-- This is needed for the homepage feed and API access

GRANT SELECT ON vehicle_valuation_feed TO anon;
GRANT SELECT ON vehicle_valuation_feed TO authenticated;

-- Also ensure clean_vehicle_prices is accessible (used by valuation engine)
GRANT SELECT ON clean_vehicle_prices TO anon;
GRANT SELECT ON clean_vehicle_prices TO authenticated;
