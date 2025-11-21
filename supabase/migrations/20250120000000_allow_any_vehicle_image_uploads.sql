-- Allow authenticated users to upload images to any vehicle profile
-- This supports the data entry workflow where comments with BAT links trigger scraping
-- Images are tracked with metadata for confidence scoring

-- Drop existing restrictive INSERT policies
DROP POLICY IF EXISTS "Vehicle owners and contributors can insert images" ON vehicle_images;
DROP POLICY IF EXISTS "Allow vehicle owners and contributors to insert images" ON vehicle_images;
DROP POLICY IF EXISTS "Users can upload images to vehicles" ON vehicle_images;
DROP POLICY IF EXISTS "simple_vehicle_images_insert" ON vehicle_images;
DROP POLICY IF EXISTS "authenticated_can_insert" ON vehicle_images;

-- Create permissive INSERT policy: Any authenticated user can upload to any vehicle
-- This enables the data entry workflow where users provide BAT links and images via comments
CREATE POLICY "Authenticated users can upload images to any vehicle" ON vehicle_images
    FOR INSERT 
    WITH CHECK (
        auth.uid() IS NOT NULL
        AND auth.uid() = user_id  -- Must upload as themselves
        AND vehicle_id IS NOT NULL
    );

-- Keep existing SELECT policy (anyone can view)
-- Keep existing UPDATE/DELETE policies (only owner or uploader can modify)

-- Add comment
COMMENT ON POLICY "Authenticated users can upload images to any vehicle" ON vehicle_images IS 
'Allows any authenticated user to upload images to any vehicle profile. This supports collaborative data entry where users provide images via BAT link scraping in comments. Images are tracked with metadata for confidence scoring based on user affiliation and VIN matching.';

