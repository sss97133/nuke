-- Add Mechanic Upload Permissions
-- Run this to allow your shop mechanic to upload images to vehicles

-- ============================================================================
-- STEP 1: Get the mechanic's user_id
-- ============================================================================
-- They need to sign up first, then run this to find their ID:

SELECT id, email, raw_user_meta_data->>'full_name' as name
FROM auth.users
WHERE email = 'mechanic@yourshop.com';  -- Replace with mechanic's email

-- Copy the 'id' from results (looks like: 0b9f107a-d124-49be-9ab8-abc123def456)


-- ============================================================================
-- STEP 2: Add mechanic as contributor to vehicle
-- ============================================================================

INSERT INTO vehicle_user_permissions (
  vehicle_id,
  user_id,
  status,
  can_view,
  can_edit,
  can_delete,
  granted_by,
  granted_at
) VALUES (
  'YOUR-VEHICLE-ID',      -- Replace with vehicle UUID
  'MECHANIC-USER-ID',     -- Replace with mechanic's user_id from step 1
  'active',               -- Status: active
  true,                   -- Can view vehicle details
  true,                   -- Can edit/upload (KEY FOR IMAGES)
  false,                  -- Cannot delete vehicle
  auth.uid(),             -- Your user ID (granting permission)
  NOW()
);

-- ============================================================================
-- STEP 3 (Optional): Add shop context with role
-- ============================================================================

INSERT INTO vehicle_contributor_roles (
  vehicle_id,
  user_id,
  role,
  shop_id,              -- Optional: link to shop
  is_active,
  approved_by,
  approved_at
) VALUES (
  'YOUR-VEHICLE-ID',
  'MECHANIC-USER-ID',
  'mechanic',           -- Role: mechanic, photographer, appraiser, etc.
  'YOUR-SHOP-ID',       -- Optional: your shop's UUID
  true,
  auth.uid(),
  NOW()
);


-- ============================================================================
-- VERIFICATION: Check permissions were added
-- ============================================================================

-- Check vehicle_user_permissions
SELECT 
  vup.vehicle_id,
  vup.user_id,
  u.email as mechanic_email,
  vup.status,
  vup.can_edit,
  vup.granted_at
FROM vehicle_user_permissions vup
JOIN auth.users u ON u.id = vup.user_id
WHERE vup.vehicle_id = 'YOUR-VEHICLE-ID';

-- Check contributor roles (if you added them)
SELECT 
  vcr.vehicle_id,
  vcr.user_id,
  u.email,
  vcr.role,
  vcr.shop_id,
  vcr.is_active
FROM vehicle_contributor_roles vcr
JOIN auth.users u ON u.id = vcr.user_id
WHERE vcr.vehicle_id = 'YOUR-VEHICLE-ID';


-- ============================================================================
-- TEST: Verify RLS allows upload
-- ============================================================================

-- Switch to mechanic's session (in Supabase dashboard: Auth > Users > mechanic > copy JWT)
-- Then test insert:

INSERT INTO vehicle_images (
  vehicle_id,
  user_id,
  image_url,
  category
) VALUES (
  'YOUR-VEHICLE-ID',
  'MECHANIC-USER-ID',
  'https://test.com/test.jpg',
  'test'
);

-- If successful: ✅ Permissions work!
-- If error "new row violates row-level security policy": ❌ Check permissions


-- ============================================================================
-- REMOVE PERMISSIONS (if needed)
-- ============================================================================

-- Remove upload permission
DELETE FROM vehicle_user_permissions 
WHERE vehicle_id = 'YOUR-VEHICLE-ID' 
AND user_id = 'MECHANIC-USER-ID';

-- Remove contributor role
DELETE FROM vehicle_contributor_roles
WHERE vehicle_id = 'YOUR-VEHICLE-ID'
AND user_id = 'MECHANIC-USER-ID';


-- ============================================================================
-- BULK: Add mechanic to ALL your vehicles
-- ============================================================================

-- Add mechanic to all vehicles you own
INSERT INTO vehicle_user_permissions (
  vehicle_id,
  user_id,
  status,
  can_view,
  can_edit,
  can_delete,
  granted_by
)
SELECT 
  v.id as vehicle_id,
  'MECHANIC-USER-ID' as user_id,
  'active' as status,
  true as can_view,
  true as can_edit,
  false as can_delete,
  auth.uid() as granted_by
FROM vehicles v
WHERE v.owner_id = auth.uid()  -- All your vehicles
ON CONFLICT (vehicle_id, user_id) DO UPDATE
SET 
  status = 'active',
  can_edit = true,
  updated_at = NOW();

-- Verify bulk add
SELECT 
  v.year,
  v.make,
  v.model,
  vup.status,
  vup.can_edit
FROM vehicle_user_permissions vup
JOIN vehicles v ON v.id = vup.vehicle_id
WHERE vup.user_id = 'MECHANIC-USER-ID'
ORDER BY v.year DESC;


-- ============================================================================
-- SHOP-LEVEL: Add all shop employees to all shop vehicles
-- ============================================================================

-- Add ALL mechanics in your shop to ALL shop vehicles
INSERT INTO vehicle_user_permissions (
  vehicle_id,
  user_id,
  status,
  can_view,
  can_edit,
  granted_by
)
SELECT DISTINCT
  v.id as vehicle_id,
  sm.user_id,
  'active' as status,
  true as can_view,
  true as can_edit,
  auth.uid() as granted_by
FROM vehicles v
CROSS JOIN shop_members sm
WHERE v.shop_id = 'YOUR-SHOP-ID'       -- Your shop
  AND sm.shop_id = 'YOUR-SHOP-ID'      -- Same shop
  AND sm.role IN ('mechanic', 'technician', 'photographer')
  AND sm.status = 'active'
ON CONFLICT (vehicle_id, user_id) DO NOTHING;


-- ============================================================================
-- USEFUL QUERIES
-- ============================================================================

-- See who has access to a vehicle
SELECT 
  u.email,
  vup.status,
  vup.can_edit,
  vcr.role,
  vup.granted_at
FROM vehicle_user_permissions vup
JOIN auth.users u ON u.id = vup.user_id
LEFT JOIN vehicle_contributor_roles vcr ON vcr.vehicle_id = vup.vehicle_id 
  AND vcr.user_id = vup.user_id
WHERE vup.vehicle_id = 'YOUR-VEHICLE-ID'
ORDER BY vup.granted_at DESC;

-- See all vehicles a user can upload to
SELECT 
  v.year,
  v.make,
  v.model,
  vup.can_edit,
  vup.granted_at
FROM vehicle_user_permissions vup
JOIN vehicles v ON v.id = vup.vehicle_id
WHERE vup.user_id = 'MECHANIC-USER-ID'
  AND vup.status = 'active'
  AND vup.can_edit = true
ORDER BY v.year DESC;

-- See all images uploaded by a user
SELECT 
  v.year,
  v.make,
  v.model,
  vi.created_at,
  vi.category,
  vi.image_url
FROM vehicle_images vi
JOIN vehicles v ON v.id = vi.vehicle_id
WHERE vi.user_id = 'MECHANIC-USER-ID'
ORDER BY vi.created_at DESC
LIMIT 100;

