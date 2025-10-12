-- Fix critical database issues causing 400 errors

-- 1. Add missing primary_image_url column to vehicles table
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS primary_image_url TEXT;

-- 2. Create index for performance
CREATE INDEX IF NOT EXISTS idx_vehicles_primary_image_url ON vehicles(primary_image_url);

-- 3. Update vehicles with primary image URLs from vehicle_images
UPDATE vehicles 
SET primary_image_url = vi.image_url
FROM vehicle_images vi
WHERE vehicles.id = vi.vehicle_id 
AND vi.is_primary = true
AND vehicles.primary_image_url IS NULL;

-- 4. For vehicles without primary images, use the first available image
UPDATE vehicles 
SET primary_image_url = vi.image_url
FROM (
    SELECT DISTINCT ON (vehicle_id) vehicle_id, image_url
    FROM vehicle_images
    ORDER BY vehicle_id, created_at ASC
) vi
WHERE vehicles.id = vi.vehicle_id 
AND vehicles.primary_image_url IS NULL;

-- 5. Fix user_presence table if it exists but has wrong schema
DO $$
BEGIN
    -- Check if user_presence table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_presence') THEN
        -- Add missing columns if they don't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_presence' AND column_name = 'vehicle_id') THEN
            ALTER TABLE user_presence ADD COLUMN vehicle_id UUID REFERENCES vehicles(id);
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_presence' AND column_name = 'user_id') THEN
            ALTER TABLE user_presence ADD COLUMN user_id UUID REFERENCES auth.users(id);
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_presence' AND column_name = 'last_seen') THEN
            ALTER TABLE user_presence ADD COLUMN last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW();
        END IF;
        
        -- Create unique constraint
        ALTER TABLE user_presence DROP CONSTRAINT IF EXISTS user_presence_vehicle_user_unique;
        ALTER TABLE user_presence ADD CONSTRAINT user_presence_vehicle_user_unique UNIQUE (vehicle_id, user_id);
        
        -- Enable RLS
        ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;
        
        -- Drop existing policies
        DROP POLICY IF EXISTS "Users can manage their own presence" ON user_presence;
        
        -- Create RLS policy
        CREATE POLICY "Users can manage their own presence" ON user_presence
            FOR ALL USING (auth.uid() = user_id);
            
    ELSE
        -- Create user_presence table if it doesn't exist
        CREATE TABLE user_presence (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            vehicle_id UUID REFERENCES vehicles(id),
            user_id UUID REFERENCES auth.users(id),
            last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(vehicle_id, user_id)
        );
        
        -- Enable RLS
        ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;
        
        -- Create RLS policy
        CREATE POLICY "Users can manage their own presence" ON user_presence
            FOR ALL USING (auth.uid() = user_id);
    END IF;
END $$;

-- 6. Verify the fixes
SELECT 
    'Vehicles with primary_image_url' as check_type,
    COUNT(*) as count
FROM vehicles 
WHERE primary_image_url IS NOT NULL;

SELECT 
    'User presence table exists' as check_type,
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_presence') 
         THEN 'YES' 
         ELSE 'NO' 
    END as status;
