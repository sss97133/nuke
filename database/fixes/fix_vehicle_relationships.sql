-- Fix Vehicle Relationships - Add Missing Categories
-- Current system only has: owned, contributing, interested
-- Need: owned, discovered, curated, consigned, previously_owned

-- 1. Add new relationship types to discovered_vehicles table
ALTER TABLE discovered_vehicles 
ADD COLUMN IF NOT EXISTS relationship_type TEXT DEFAULT 'interested';

-- Add constraint for valid relationship types
ALTER TABLE discovered_vehicles 
DROP CONSTRAINT IF EXISTS valid_relationship_type;

ALTER TABLE discovered_vehicles 
ADD CONSTRAINT valid_relationship_type 
CHECK (relationship_type IN ('interested', 'discovered', 'curated', 'consigned', 'previously_owned'));

-- 2. Update the relationship function to handle new categories
CREATE OR REPLACE FUNCTION get_user_vehicle_relationship(p_vehicle_id UUID, p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
    relationship_type TEXT;
BEGIN
    -- Check if user owns the vehicle (current owner)
    IF EXISTS (
        SELECT 1 FROM vehicles 
        WHERE id = p_vehicle_id AND user_id = p_user_id
    ) THEN
        -- Check if they have verified ownership
        IF EXISTS (
            SELECT 1 FROM ownership_verifications 
            WHERE vehicle_id = p_vehicle_id 
            AND user_id = p_user_id 
            AND status = 'approved'
        ) THEN
            RETURN 'owned';
        ELSE
            RETURN 'contributing';
        END IF;
    END IF;
    
    -- Check if user has permissions (contributing relationship)
    IF EXISTS (
        SELECT 1 FROM vehicle_user_permissions 
        WHERE vehicle_id = p_vehicle_id 
        AND user_id = p_user_id 
        AND is_active = true
    ) THEN
        RETURN 'contributing';
    END IF;
    
    -- Check discovered_vehicles table for specific relationship types
    SELECT dv.relationship_type INTO relationship_type
    FROM discovered_vehicles dv
    WHERE dv.vehicle_id = p_vehicle_id 
    AND dv.user_id = p_user_id 
    AND dv.is_active = true;
    
    RETURN relationship_type; -- Will be NULL if no relationship found
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create function to update vehicle relationships
CREATE OR REPLACE FUNCTION update_vehicle_relationship(
    p_vehicle_id UUID, 
    p_user_id UUID, 
    p_relationship_type TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Validate relationship type
    IF p_relationship_type NOT IN ('interested', 'discovered', 'curated', 'consigned', 'previously_owned') THEN
        RAISE EXCEPTION 'Invalid relationship type: %', p_relationship_type;
    END IF;
    
    -- Insert or update the relationship
    INSERT INTO discovered_vehicles (vehicle_id, user_id, relationship_type, is_active, created_at)
    VALUES (p_vehicle_id, p_user_id, p_relationship_type, true, now())
    ON CONFLICT (vehicle_id, user_id) 
    DO UPDATE SET 
        relationship_type = p_relationship_type,
        is_active = true,
        updated_at = now();
    
    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Grant permissions
GRANT EXECUTE ON FUNCTION update_vehicle_relationship TO authenticated;

-- 5. Example fixes for your specific vehicles (replace with actual vehicle IDs)
-- You'll need to run these with the correct vehicle IDs and your user ID

-- Example: Fix 1973 VW Thing as "discovered"
-- SELECT update_vehicle_relationship('5c4972dc-072e-4349-98b2-781b44106840', auth.uid(), 'discovered');

-- Example: Fix 1931 Austin as "curated" 
-- SELECT update_vehicle_relationship('bde2f96d-115a-4b10-9272-2030048529e4', auth.uid(), 'curated');

-- Example: Fix 1939 LaSalle as "consigned"
-- SELECT update_vehicle_relationship('your-lasalle-id', auth.uid(), 'consigned');

-- Example: Fix Roadrunner as "previously_owned"
-- SELECT update_vehicle_relationship('your-roadrunner-id', auth.uid(), 'previously_owned');

COMMENT ON FUNCTION update_vehicle_relationship IS 'Updates user relationship to a vehicle (discovered/curated/consigned/previously_owned/interested)';
