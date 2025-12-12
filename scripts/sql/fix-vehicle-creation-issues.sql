-- ============================================================================
-- FIX VEHICLE CREATION ISSUES
-- Run this in Supabase SQL Editor: 
-- https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql
-- ============================================================================

-- ISSUE 1: BAT Seller Monitor Not Configured
-- This is why the BAT scraper is failing

-- Create the monitor for Viva Las Vegas Autos
INSERT INTO bat_seller_monitors (
  organization_id,
  seller_username,
  seller_url,
  is_active,
  last_checked_at
) VALUES (
  'c433d27e-2159-4f8c-b4ae-32a5e44a77cf',
  'VivaLasVegasAutos',
  'https://bringatrailer.com/member/vivalasvegasautos/',
  true,
  NOW()
) ON CONFLICT (organization_id, seller_username) 
DO UPDATE SET is_active = true, last_checked_at = NOW();

-- Verify it was created
SELECT * FROM bat_seller_monitors;

-- ============================================================================
-- ISSUE 2: Vehicles with discovery_source = 'unknown'
-- Let's identify what source they're actually from based on discovery_url
-- ============================================================================

-- Check what URLs these "unknown" source vehicles have
SELECT 
  discovery_source,
  COUNT(*) as count,
  CASE 
    WHEN discovery_url ILIKE '%bringatrailer%' THEN 'Should be: bat'
    WHEN discovery_url ILIKE '%craigslist%' THEN 'Should be: craigslist'
    WHEN discovery_url ILIKE '%ksl.com%' THEN 'Should be: ksl'
    WHEN discovery_url ILIKE '%facebook%' THEN 'Should be: facebook'
    ELSE 'Manual or unknown'
  END as should_be
FROM vehicles
WHERE discovery_source IS NULL OR discovery_source = 'unknown'
GROUP BY discovery_source, 
  CASE 
    WHEN discovery_url ILIKE '%bringatrailer%' THEN 'Should be: bat'
    WHEN discovery_url ILIKE '%craigslist%' THEN 'Should be: craigslist'
    WHEN discovery_url ILIKE '%ksl.com%' THEN 'Should be: ksl'
    WHEN discovery_url ILIKE '%facebook%' THEN 'Should be: facebook'
    ELSE 'Manual or unknown'
  END;

-- Fix discovery_source based on discovery_url
UPDATE vehicles
SET discovery_source = 'bat_listing'
WHERE (discovery_source IS NULL OR discovery_source = 'unknown')
  AND discovery_url ILIKE '%bringatrailer%';

UPDATE vehicles
SET discovery_source = 'craigslist_scrape'
WHERE (discovery_source IS NULL OR discovery_source = 'unknown')
  AND discovery_url ILIKE '%craigslist%';

UPDATE vehicles
SET discovery_source = 'ksl_automated_import'
WHERE (discovery_source IS NULL OR discovery_source = 'unknown')
  AND discovery_url ILIKE '%ksl.com%';

UPDATE vehicles
SET discovery_source = 'facebook_marketplace'
WHERE (discovery_source IS NULL OR discovery_source = 'unknown')
  AND discovery_url ILIKE '%facebook%';

-- ============================================================================
-- ISSUE 3: Check current data completeness after recent imports
-- ============================================================================

SELECT 
  'Recent 7 Days' as period,
  COUNT(*) as total,
  COUNT(CASE WHEN vin IS NOT NULL THEN 1 END) as with_vin,
  COUNT(CASE WHEN mileage IS NOT NULL THEN 1 END) as with_mileage,
  COUNT(CASE WHEN color IS NOT NULL THEN 1 END) as with_color,
  COUNT(CASE WHEN discovery_url IS NOT NULL THEN 1 END) as with_url,
  COUNT(CASE WHEN discovery_source IS NOT NULL AND discovery_source != 'unknown' THEN 1 END) as with_source
FROM vehicles
WHERE created_at > NOW() - INTERVAL '7 days';

-- ============================================================================
-- ISSUE 4: Ensure scrapers are setting discovery_source on insert
-- Create a trigger to auto-set discovery_source from discovery_url
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_set_discovery_source()
RETURNS TRIGGER AS $$
BEGIN
  -- Only set if not already set
  IF NEW.discovery_source IS NULL OR NEW.discovery_source = 'unknown' THEN
    IF NEW.discovery_url ILIKE '%bringatrailer%' THEN
      NEW.discovery_source := 'bat_listing';
    ELSIF NEW.discovery_url ILIKE '%craigslist%' THEN
      NEW.discovery_source := 'craigslist_scrape';
    ELSIF NEW.discovery_url ILIKE '%ksl.com%' THEN
      NEW.discovery_source := 'ksl_automated_import';
    ELSIF NEW.discovery_url ILIKE '%facebook%' THEN
      NEW.discovery_source := 'facebook_marketplace';
    ELSIF NEW.discovery_url ILIKE '%classiccars%' THEN
      NEW.discovery_source := 'classiccars_com';
    ELSIF NEW.discovery_url ILIKE '%hemmings%' THEN
      NEW.discovery_source := 'hemmings';
    ELSIF NEW.discovery_url IS NOT NULL THEN
      NEW.discovery_source := 'url_scraper';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists and recreate
DROP TRIGGER IF EXISTS trigger_auto_set_discovery_source ON vehicles;
CREATE TRIGGER trigger_auto_set_discovery_source
  BEFORE INSERT OR UPDATE ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION auto_set_discovery_source();

-- ============================================================================
-- VERIFICATION: Check the results
-- ============================================================================

-- After running the above, check the distribution
SELECT 
  discovery_source,
  COUNT(*) as count
FROM vehicles
GROUP BY discovery_source
ORDER BY count DESC;
