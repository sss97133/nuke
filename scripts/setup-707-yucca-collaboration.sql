-- ==========================================================================
-- SETUP 707 YUCCA ST COLLABORATION
-- ==========================================================================
-- This script sets up location-based collaboration for organizations at 707 Yucca St
-- Organizations: Viva! Las Vegas Autos, Taylor Customs, Ernies Upholstery
-- ==========================================================================

-- Step 1: Register all organizations at 707 Yucca location
INSERT INTO location_collaborations (
  location_address,
  location_name,
  organization_id,
  can_view_vehicles,
  can_add_work,
  can_view_work_history,
  can_upload_images,
  status
) VALUES 
  -- Viva! Las Vegas Autos
  (
    '707 yucca st',
    '707 Yucca St HQ',
    'c433d27e-2159-4f8c-b4ae-32a5e44a77cf',
    true,  -- Can see other orgs' vehicles
    true,  -- Can add work to other orgs' vehicles
    true,  -- Can see work history
    false, -- Cannot upload images (restricted)
    'active'
  ),
  -- Taylor Customs
  (
    '707 yucca st',
    '707 Yucca St HQ',
    '66352790-b70e-4de8-bfb1-006b91fa556f',
    true,
    true,
    true,
    false,
    'active'
  ),
  -- Ernies Upholstery
  (
    '707 Yucca Street',
    '707 Yucca St HQ',
    'e796ca48-f3af-41b5-be13-5335bb422b41',
    true,
    true,
    true,
    false,
    'active'
  )
ON CONFLICT (organization_id, location_address) 
DO UPDATE SET
  can_view_vehicles = EXCLUDED.can_view_vehicles,
  can_add_work = EXCLUDED.can_add_work,
  can_view_work_history = EXCLUDED.can_view_work_history,
  can_upload_images = EXCLUDED.can_upload_images,
  status = 'active',
  updated_at = NOW();

-- Step 2: Verify collaboration setup
SELECT 
  b.business_name,
  lc.location_address,
  lc.can_view_vehicles,
  lc.can_add_work,
  lc.can_view_work_history,
  lc.status
FROM location_collaborations lc
JOIN businesses b ON b.id = lc.organization_id
WHERE lc.location_address ILIKE '%707%yucca%'
ORDER BY b.business_name;

-- Step 3: Example - Get all vehicles accessible to Viva! Las Vegas Autos
-- (This would show vehicles from all 3 organizations at 707 Yucca)
SELECT * FROM get_collaborative_vehicles(
  'c433d27e-2159-4f8c-b4ae-32a5e44a77cf',  -- Viva! Las Vegas Autos
  '707 yucca st'
);

-- Step 4: Example - Get all collaborators at 707 Yucca
SELECT * FROM get_location_collaborators('707 yucca st');

-- This script sets up location-based collaboration for organizations at 707 Yucca St
-- Run this after the migration to enable multi-org collaboration

