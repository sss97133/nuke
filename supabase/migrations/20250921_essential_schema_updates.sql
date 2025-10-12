-- Essential Schema Updates - Cherry-picked from 20250913 migrations
-- Contains only the critical tables and fixes needed for current functionality

-- 1. CRITICAL: discovered_vehicles table (user interest tracking)
CREATE TABLE IF NOT EXISTS discovered_vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    discovery_source TEXT CHECK (discovery_source IN (
        'search', 'recommendation', 'social_share', 'direct_link', 
        'auction_site', 'dealer_listing', 'user_submission'
    )),
    discovery_context TEXT,
    interest_level TEXT CHECK (interest_level IN ('casual', 'moderate', 'high', 'urgent')),
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(vehicle_id, user_id)
);

-- Add missing columns to discovered_vehicles if they don't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'discovered_vehicles' 
                   AND column_name = 'is_active') THEN
        ALTER TABLE discovered_vehicles ADD COLUMN is_active BOOLEAN DEFAULT true;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'discovered_vehicles' 
                   AND column_name = 'discovery_source') THEN
        ALTER TABLE discovered_vehicles ADD COLUMN discovery_source TEXT CHECK (discovery_source IN (
            'search', 'recommendation', 'social_share', 'direct_link', 
            'auction_site', 'dealer_listing', 'user_submission'
        ));
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'discovered_vehicles' 
                   AND column_name = 'discovery_context') THEN
        ALTER TABLE discovered_vehicles ADD COLUMN discovery_context TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'discovered_vehicles' 
                   AND column_name = 'interest_level') THEN
        ALTER TABLE discovered_vehicles ADD COLUMN interest_level TEXT CHECK (interest_level IN ('casual', 'moderate', 'high', 'urgent'));
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'discovered_vehicles' 
                   AND column_name = 'notes') THEN
        ALTER TABLE discovered_vehicles ADD COLUMN notes TEXT;
    END IF;
END $$;

-- 2. CRITICAL: vehicle_user_permissions table (contributor relationships)
CREATE TABLE IF NOT EXISTS vehicle_user_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    granted_by UUID REFERENCES auth.users(id),
    role TEXT NOT NULL CHECK (role IN (
        'owner', 'co_owner', 'sales_agent', 'mechanic', 'appraiser',
        'dealer_rep', 'inspector', 'photographer', 'contributor', 'moderator'
    )),
    permissions TEXT[] DEFAULT ARRAY[]::TEXT[],
    context TEXT,
    is_active BOOLEAN DEFAULT true,
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(vehicle_id, user_id, role) DEFERRABLE INITIALLY DEFERRED
);

-- Add missing columns to vehicle_user_permissions if they don't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vehicle_user_permissions' 
                   AND column_name = 'granted_by') THEN
        ALTER TABLE vehicle_user_permissions ADD COLUMN granted_by UUID REFERENCES auth.users(id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vehicle_user_permissions' 
                   AND column_name = 'permissions') THEN
        ALTER TABLE vehicle_user_permissions ADD COLUMN permissions TEXT[] DEFAULT ARRAY[]::TEXT[];
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vehicle_user_permissions' 
                   AND column_name = 'context') THEN
        ALTER TABLE vehicle_user_permissions ADD COLUMN context TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vehicle_user_permissions' 
                   AND column_name = 'is_active') THEN
        ALTER TABLE vehicle_user_permissions ADD COLUMN is_active BOOLEAN DEFAULT true;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vehicle_user_permissions' 
                   AND column_name = 'granted_at') THEN
        ALTER TABLE vehicle_user_permissions ADD COLUMN granted_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vehicle_user_permissions' 
                   AND column_name = 'expires_at') THEN
        ALTER TABLE vehicle_user_permissions ADD COLUMN expires_at TIMESTAMPTZ;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vehicle_user_permissions' 
                   AND column_name = 'revoked_at') THEN
        ALTER TABLE vehicle_user_permissions ADD COLUMN revoked_at TIMESTAMPTZ;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vehicle_user_permissions' 
                   AND column_name = 'revoked_by') THEN
        ALTER TABLE vehicle_user_permissions ADD COLUMN revoked_by UUID REFERENCES auth.users(id);
    END IF;
END $$;

-- 3. Add missing vehicle columns that other migrations expect
DO $$
BEGIN
    -- Add sale_status column if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'vehicles' AND column_name = 'sale_status'
    ) THEN
        ALTER TABLE vehicles ADD COLUMN sale_status TEXT CHECK (sale_status IN ('not_for_sale', 'for_sale', 'sold', 'pending'));
    END IF;
    
    -- Add is_public column if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'vehicles' AND column_name = 'is_public'
    ) THEN
        ALTER TABLE vehicles ADD COLUMN is_public BOOLEAN DEFAULT true;
    END IF;
    
    -- Add source column if missing (needed by feed_optimization migration)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'vehicles' AND column_name = 'source'
    ) THEN
        ALTER TABLE vehicles ADD COLUMN source TEXT DEFAULT 'User Submission';
    END IF;
    
    -- Add sale_price column if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'vehicles' AND column_name = 'sale_price'
    ) THEN
        ALTER TABLE vehicles ADD COLUMN sale_price DECIMAL(12,2);
    END IF;
    
    -- Add is_for_sale column if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'vehicles' AND column_name = 'is_for_sale'
    ) THEN
        ALTER TABLE vehicles ADD COLUMN is_for_sale BOOLEAN DEFAULT false;
    END IF;
END $$;

-- 4. CRITICAL FIX: Missing DELETE policy for timeline_events (the actual table)
DROP POLICY IF EXISTS "Allow vehicle owners to delete their timeline events" ON timeline_events;
CREATE POLICY "Allow vehicle owners to delete their timeline events"
ON timeline_events
AS PERMISSIVE
FOR DELETE
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM vehicles v
        WHERE v.id = timeline_events.vehicle_id 
        AND v.user_id = auth.uid()
    )
);

-- 5. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_discovered_vehicles_user ON discovered_vehicles(user_id);
CREATE INDEX IF NOT EXISTS idx_discovered_vehicles_vehicle ON discovered_vehicles(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_discovered_vehicles_active ON discovered_vehicles(is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_vehicle_user_permissions_vehicle ON vehicle_user_permissions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_user_permissions_user ON vehicle_user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_user_permissions_role ON vehicle_user_permissions(role);
CREATE INDEX IF NOT EXISTS idx_vehicle_user_permissions_active ON vehicle_user_permissions(is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_vehicles_source ON vehicles(source);
CREATE INDEX IF NOT EXISTS idx_vehicles_public ON vehicles(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_vehicles_for_sale ON vehicles(is_for_sale) WHERE is_for_sale = true;

-- 6. Enable RLS
ALTER TABLE discovered_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_user_permissions ENABLE ROW LEVEL SECURITY;

-- 7. RLS Policies for discovered_vehicles
DROP POLICY IF EXISTS "Users can manage their own discovered vehicles" ON discovered_vehicles;
CREATE POLICY "Users can manage their own discovered vehicles" ON discovered_vehicles
    FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Public read access to discovered vehicles" ON discovered_vehicles;
CREATE POLICY "Public read access to discovered vehicles" ON discovered_vehicles
    FOR SELECT USING (true);

-- 8. RLS Policies for vehicle_user_permissions
DROP POLICY IF EXISTS "Vehicle owners can manage permissions" ON vehicle_user_permissions;
CREATE POLICY "Vehicle owners can manage permissions" ON vehicle_user_permissions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM vehicles v 
            WHERE v.id = vehicle_user_permissions.vehicle_id 
            AND v.user_id = auth.uid()
        )
        OR auth.uid() = user_id
    );

DROP POLICY IF EXISTS "Public read access to vehicle permissions" ON vehicle_user_permissions;
CREATE POLICY "Public read access to vehicle permissions" ON vehicle_user_permissions
    FOR SELECT USING (true);

-- 9. CRITICAL: Helper functions for vehicle relationships
CREATE OR REPLACE FUNCTION get_user_vehicle_relationship(p_vehicle_id UUID, p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
    relationship_type TEXT;
BEGIN
    -- Check if user owns the vehicle
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
    
    -- Check if user has discovered/is interested in the vehicle
    IF EXISTS (
        SELECT 1 FROM discovered_vehicles 
        WHERE vehicle_id = p_vehicle_id 
        AND user_id = p_user_id 
        AND is_active = true
    ) THEN
        RETURN 'interested';
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_user_vehicle_role(p_vehicle_id UUID, p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
    user_role TEXT;
BEGIN
    -- Check ownership first
    IF EXISTS (
        SELECT 1 FROM vehicles 
        WHERE id = p_vehicle_id AND user_id = p_user_id
    ) THEN
        IF EXISTS (
            SELECT 1 FROM ownership_verifications 
            WHERE vehicle_id = p_vehicle_id 
            AND user_id = p_user_id 
            AND status = 'approved'
        ) THEN
            RETURN 'Owner';
        ELSE
            RETURN 'Contributor';
        END IF;
    END IF;
    
    -- Check permissions
    SELECT role INTO user_role
    FROM vehicle_user_permissions 
    WHERE vehicle_id = p_vehicle_id 
    AND user_id = p_user_id 
    AND is_active = true
    ORDER BY granted_at DESC
    LIMIT 1;
    
    IF user_role IS NOT NULL THEN
        RETURN INITCAP(user_role);
    END IF;
    
    -- Check discovery
    IF EXISTS (
        SELECT 1 FROM discovered_vehicles 
        WHERE vehicle_id = p_vehicle_id 
        AND user_id = p_user_id 
        AND is_active = true
    ) THEN
        RETURN 'Interested';
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. Create the user_vehicle_roles view that the code expects
DROP VIEW IF EXISTS user_vehicle_roles CASCADE;
CREATE VIEW user_vehicle_roles AS
SELECT 
    vup.user_id,
    vup.vehicle_id,
    vup.role,
    vup.is_active,
    vup.granted_at,
    v.make,
    v.model,
    v.year,
    v.vin
FROM vehicle_user_permissions vup
JOIN vehicles v ON v.id = vup.vehicle_id
WHERE vup.is_active = true;

-- 11. Create user_vehicle_relationships view for LocalVehicles page
DROP VIEW IF EXISTS user_vehicle_relationships CASCADE;
CREATE VIEW user_vehicle_relationships AS
SELECT 
    v.id as vehicle_id,
    v.year,
    v.make,
    v.model,
    v.vin,
    v.color,
    v.mileage,
    v.created_at,
    v.user_id as owner_id,
    get_user_vehicle_relationship(v.id, auth.uid()) as relationship_type,
    get_user_vehicle_role(v.id, auth.uid()) as role,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM ownership_verifications 
            WHERE vehicle_id = v.id AND user_id = auth.uid() AND status = 'approved'
        ) THEN true
        ELSE false
    END as is_verified_owner
FROM vehicles v
WHERE get_user_vehicle_relationship(v.id, auth.uid()) IS NOT NULL;

-- Grant permissions
GRANT SELECT ON user_vehicle_roles TO authenticated;
GRANT SELECT ON user_vehicle_relationships TO authenticated;

-- Comments
COMMENT ON TABLE discovered_vehicles IS 'Tracks vehicles that users have discovered and are interested in';
COMMENT ON TABLE vehicle_user_permissions IS 'Manages user permissions and roles for specific vehicles';
COMMENT ON FUNCTION get_user_vehicle_relationship IS 'Determines user relationship to a vehicle (owned/contributing/interested)';
COMMENT ON FUNCTION get_user_vehicle_role IS 'Gets user role/badge for a vehicle';
COMMENT ON VIEW user_vehicle_roles IS 'View combining user permissions with vehicle details';
COMMENT ON VIEW user_vehicle_relationships IS 'View for LocalVehicles page showing all user vehicle relationships';

-- ============================================================================
-- VEHICLE IMAGES TABLE UPDATES
-- ============================================================================

-- Add missing columns to vehicle_images table for lead image functionality
DO $$ 
BEGIN
    -- Add storage_path column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vehicle_images' AND column_name = 'storage_path') THEN
        ALTER TABLE vehicle_images ADD COLUMN storage_path TEXT;
    END IF;

    -- Add filename column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vehicle_images' AND column_name = 'filename') THEN
        ALTER TABLE vehicle_images ADD COLUMN filename TEXT;
    END IF;

    -- Add mime_type column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vehicle_images' AND column_name = 'mime_type') THEN
        ALTER TABLE vehicle_images ADD COLUMN mime_type TEXT;
    END IF;

    -- Add file_size column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vehicle_images' AND column_name = 'file_size') THEN
        ALTER TABLE vehicle_images ADD COLUMN file_size BIGINT;
    END IF;

    -- Ensure is_primary column exists and has proper default
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'vehicle_images' AND column_name = 'is_primary') THEN
        ALTER TABLE vehicle_images ADD COLUMN is_primary BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Create index on is_primary for better lead image queries
CREATE INDEX IF NOT EXISTS idx_vehicle_images_is_primary ON vehicle_images(vehicle_id, is_primary) WHERE is_primary = true;

-- Create function to ensure only one primary image per vehicle
CREATE OR REPLACE FUNCTION ensure_single_primary_image()
RETURNS TRIGGER AS $$
BEGIN
    -- If setting this image as primary, clear all other primary flags for this vehicle
    IF NEW.is_primary = true THEN
        UPDATE vehicle_images 
        SET is_primary = false 
        WHERE vehicle_id = NEW.vehicle_id 
        AND id != NEW.id 
        AND is_primary = true;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to maintain single primary image constraint
DROP TRIGGER IF EXISTS trigger_ensure_single_primary_image ON vehicle_images;
CREATE TRIGGER trigger_ensure_single_primary_image
    BEFORE INSERT OR UPDATE ON vehicle_images
    FOR EACH ROW
    EXECUTE FUNCTION ensure_single_primary_image();

-- Function to set first image as primary if no primary exists
CREATE OR REPLACE FUNCTION set_first_image_as_primary_if_none()
RETURNS TRIGGER AS $$
BEGIN
    -- After insert, check if this vehicle has any primary image
    IF NOT EXISTS (
        SELECT 1 FROM vehicle_images 
        WHERE vehicle_id = NEW.vehicle_id 
        AND is_primary = true
    ) THEN
        -- Set the oldest image as primary
        UPDATE vehicle_images 
        SET is_primary = true 
        WHERE id = (
            SELECT id FROM vehicle_images 
            WHERE vehicle_id = NEW.vehicle_id 
            ORDER BY created_at ASC 
            LIMIT 1
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-set primary image
DROP TRIGGER IF EXISTS trigger_set_first_primary ON vehicle_images;
CREATE TRIGGER trigger_set_first_primary
    AFTER INSERT ON vehicle_images
    FOR EACH ROW
    EXECUTE FUNCTION set_first_image_as_primary_if_none();

-- Comments
COMMENT ON COLUMN vehicle_images.storage_path IS 'Storage path in Supabase storage bucket';
COMMENT ON COLUMN vehicle_images.filename IS 'Original filename of uploaded image';
COMMENT ON COLUMN vehicle_images.mime_type IS 'MIME type of the image file';
COMMENT ON COLUMN vehicle_images.file_size IS 'File size in bytes';
COMMENT ON COLUMN vehicle_images.is_primary IS 'Whether this is the primary/lead image for the vehicle';
COMMENT ON FUNCTION ensure_single_primary_image IS 'Ensures only one image per vehicle can be marked as primary';
COMMENT ON FUNCTION set_first_image_as_primary_if_none IS 'Automatically sets first image as primary if no primary exists';
