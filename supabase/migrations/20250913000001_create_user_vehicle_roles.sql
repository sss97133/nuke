-- Create user_vehicle_roles view for vehicle access control
-- This view provides a unified interface for checking user roles and permissions

DROP VIEW IF EXISTS user_vehicle_roles;

CREATE VIEW user_vehicle_roles AS
SELECT 
    v.id as vehicle_id,
    v.user_id as owner_id,
    auth.uid() as user_id,
    CASE 
        WHEN v.user_id = auth.uid() THEN 'owner'
        ELSE 'viewer'
    END as role,
    CASE 
        WHEN v.user_id = auth.uid() THEN true
        WHEN v.is_public = true THEN true
        ELSE false
    END as is_active,
    v.created_at as vehicle_created_at,
    NOW() as granted_at,
    NULL::timestamptz as expires_at
FROM vehicles v
WHERE auth.uid() IS NOT NULL 
AND (v.is_public = true OR v.user_id = auth.uid());

-- Grant access to the view
GRANT SELECT ON user_vehicle_roles TO authenticated;
GRANT SELECT ON user_vehicle_roles TO anon;

-- Create RLS policy for the view (though views inherit from underlying tables)
ALTER VIEW user_vehicle_roles SET (security_invoker = true);
