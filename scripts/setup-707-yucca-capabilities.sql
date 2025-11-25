-- ==========================================================================
-- SETUP ORGANIZATION CAPABILITIES FOR 707 YUCCA
-- ==========================================================================
-- This script sets up capabilities for organizations at 707 Yucca
-- Based on business types and known specialties
-- ==========================================================================

-- Ernies Upholstery - Upholstery specialist
INSERT INTO organization_capabilities (
  organization_id,
  capability_type,
  capability_name,
  description,
  proficiency_level,
  is_active,
  verified
) VALUES (
  'e796ca48-f3af-41b5-be13-5335bb422b41', -- Ernies Upholstery
  'upholstery',
  'Interior Upholstery',
  'Full interior restoration including seats, door panels, headliners, and carpet',
  'expert',
  true,
  true
)
ON CONFLICT (organization_id, capability_type) 
DO UPDATE SET
  capability_name = EXCLUDED.capability_name,
  description = EXCLUDED.description,
  proficiency_level = EXCLUDED.proficiency_level,
  is_active = true,
  updated_at = NOW();

-- Taylor Customs - Paint specialist
INSERT INTO organization_capabilities (
  organization_id,
  capability_type,
  capability_name,
  description,
  proficiency_level,
  is_active,
  verified
) VALUES (
  '66352790-b70e-4de8-bfb1-006b91fa556f', -- Taylor Customs
  'paint',
  'Custom Paint & Body Work',
  'Custom paint, body work, and fabrication',
  'expert',
  true,
  true
)
ON CONFLICT (organization_id, capability_type) 
DO UPDATE SET
  capability_name = EXCLUDED.capability_name,
  description = EXCLUDED.description,
  proficiency_level = EXCLUDED.proficiency_level,
  is_active = true,
  updated_at = NOW();

-- Taylor Customs - Also does body work
INSERT INTO organization_capabilities (
  organization_id,
  capability_type,
  capability_name,
  description,
  proficiency_level,
  is_active,
  verified
) VALUES (
  '66352790-b70e-4de8-bfb1-006b91fa556f', -- Taylor Customs
  'body_work',
  'Body Work & Fabrication',
  'Body repair, panel replacement, and custom fabrication',
  'expert',
  true,
  true
)
ON CONFLICT (organization_id, capability_type) 
DO UPDATE SET
  capability_name = EXCLUDED.capability_name,
  description = EXCLUDED.description,
  proficiency_level = EXCLUDED.proficiency_level,
  is_active = true,
  updated_at = NOW();

-- Viva! Las Vegas Autos - General automotive services
INSERT INTO organization_capabilities (
  organization_id,
  capability_type,
  capability_name,
  description,
  proficiency_level,
  is_active,
  verified
) VALUES 
  (
    'c433d27e-2159-4f8c-b4ae-32a5e44a77cf', -- Viva! Las Vegas Autos
    'engine',
    'Engine Work',
    'Engine repair, rebuild, and maintenance',
    'expert',
    true,
    true
  ),
  (
    'c433d27e-2159-4f8c-b4ae-32a5e44a77cf',
    'transmission',
    'Transmission Work',
    'Transmission repair and rebuild',
    'advanced',
    true,
    true
  ),
  (
    'c433d27e-2159-4f8c-b4ae-32a5e44a77cf',
    'body_work',
    'Body Work',
    'Body repair and restoration',
    'advanced',
    true,
    true
  )
ON CONFLICT (organization_id, capability_type) 
DO UPDATE SET
  capability_name = EXCLUDED.capability_name,
  description = EXCLUDED.description,
  proficiency_level = EXCLUDED.proficiency_level,
  is_active = true,
  updated_at = NOW();

-- Verify capabilities were created
SELECT 
  b.business_name,
  oc.capability_type,
  oc.capability_name,
  oc.proficiency_level,
  oc.verified
FROM organization_capabilities oc
JOIN businesses b ON b.id = oc.organization_id
WHERE oc.organization_id IN (
  'e796ca48-f3af-41b5-be13-5335bb422b41', -- Ernies
  '66352790-b70e-4de8-bfb1-006b91fa556f', -- Taylor
  'c433d27e-2159-4f8c-b4ae-32a5e44a77cf'  -- Viva
)
ORDER BY b.business_name, oc.capability_type;

