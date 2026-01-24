-- Migration to link all BaT vehicles to BaT organization
-- This disables the slow trigger, does bulk insert, then re-enables

-- Step 1: Disable the slow trigger
ALTER TABLE organization_vehicles DISABLE TRIGGER auto_update_primary_focus_on_org_vehicles;

-- Step 2: Insert all missing links
INSERT INTO organization_vehicles (organization_id, vehicle_id, relationship_type, auto_tagged)
SELECT
  '222375e1-901e-4a2c-a254-4e412f0e2a56'::uuid,
  v.id,
  'sold_by',
  true
FROM vehicles v
WHERE v.discovery_url ILIKE '%bringatrailer%'
AND NOT EXISTS (
  SELECT 1 FROM organization_vehicles ov
  WHERE ov.vehicle_id = v.id
  AND ov.organization_id = '222375e1-901e-4a2c-a254-4e412f0e2a56'::uuid
)
ON CONFLICT (organization_id, vehicle_id, relationship_type) DO NOTHING;

-- Step 3: Re-enable the trigger
ALTER TABLE organization_vehicles ENABLE TRIGGER auto_update_primary_focus_on_org_vehicles;

-- Report how many were linked
DO $$
DECLARE
  linked_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO linked_count
  FROM organization_vehicles
  WHERE organization_id = '222375e1-901e-4a2c-a254-4e412f0e2a56'::uuid;

  RAISE NOTICE 'Total BaT vehicles now linked: %', linked_count;
END $$;
