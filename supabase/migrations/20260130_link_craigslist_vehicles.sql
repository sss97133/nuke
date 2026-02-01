-- Migration to link all Craigslist-sourced vehicles to Craigslist organization
-- Follows same pattern as 20260124_link_bat_vehicles.sql

-- Step 1: Disable the slow trigger
ALTER TABLE organization_vehicles DISABLE TRIGGER auto_update_primary_focus_on_org_vehicles;

-- Step 2: Insert all missing links for craigslist_archive sourced vehicles
INSERT INTO organization_vehicles (organization_id, vehicle_id, relationship_type, auto_tagged, notes)
SELECT
  '624b7f80-c4c7-455d-8f0a-f7ae7ff67a42'::uuid,  -- Craigslist org
  v.id,
  'sold_by',
  true,
  'Historical CL listing'
FROM vehicles v
WHERE v.discovery_source ILIKE '%craigslist%'
AND NOT EXISTS (
  SELECT 1 FROM organization_vehicles ov
  WHERE ov.vehicle_id = v.id
  AND ov.organization_id = '624b7f80-c4c7-455d-8f0a-f7ae7ff67a42'::uuid
)
ON CONFLICT (organization_id, vehicle_id, relationship_type) DO NOTHING;

-- Step 3: Re-enable the trigger
ALTER TABLE organization_vehicles ENABLE TRIGGER auto_update_primary_focus_on_org_vehicles;

-- Step 4: Update org vehicle count
UPDATE businesses
SET total_vehicles = (
  SELECT COUNT(DISTINCT vehicle_id)
  FROM organization_vehicles
  WHERE organization_id = '624b7f80-c4c7-455d-8f0a-f7ae7ff67a42'::uuid
)
WHERE id = '624b7f80-c4c7-455d-8f0a-f7ae7ff67a42'::uuid;

-- Report
DO $$
DECLARE
  linked_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO linked_count
  FROM organization_vehicles
  WHERE organization_id = '624b7f80-c4c7-455d-8f0a-f7ae7ff67a42'::uuid;

  RAISE NOTICE 'Total Craigslist vehicles now linked: %', linked_count;
END $$;
