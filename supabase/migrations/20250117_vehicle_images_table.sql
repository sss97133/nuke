-- Create vehicle_images table for storing image metadata
CREATE TABLE IF NOT EXISTS vehicle_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    image_url TEXT NOT NULL,
    image_type TEXT DEFAULT 'general',
    image_category TEXT DEFAULT 'exterior',
    category TEXT DEFAULT 'general', -- For backward compatibility
    position INTEGER DEFAULT 0,
    caption TEXT,
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE vehicle_images ENABLE ROW LEVEL SECURITY;

-- Create policies for vehicle_images
DROP POLICY IF EXISTS "Users can view images for vehicles they own" ON vehicle_images;
CREATE POLICY "Users can view images for vehicles they own" ON vehicle_images
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM vehicles 
            WHERE vehicles.id = vehicle_images.vehicle_id 
            AND vehicles.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can view images for public vehicles" ON vehicle_images;
CREATE POLICY "Users can view images for public vehicles" ON vehicle_images
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM vehicles 
            WHERE vehicles.id = vehicle_images.vehicle_id 
            AND vehicles.is_public = true
        )
    );

DROP POLICY IF EXISTS "Users can insert images for their own vehicles" ON vehicle_images;
CREATE POLICY "Users can insert images for their own vehicles" ON vehicle_images
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM vehicles 
            WHERE vehicles.id = vehicle_images.vehicle_id 
            AND vehicles.user_id = auth.uid()
        )
        AND auth.uid() = user_id
    );

DROP POLICY IF EXISTS "Users can update images for their own vehicles" ON vehicle_images;
CREATE POLICY "Users can update images for their own vehicles" ON vehicle_images
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM vehicles 
            WHERE vehicles.id = vehicle_images.vehicle_id 
            AND vehicles.user_id = auth.uid()
        )
        AND auth.uid() = user_id
    );

DROP POLICY IF EXISTS "Users can delete images for their own vehicles" ON vehicle_images;
CREATE POLICY "Users can delete images for their own vehicles" ON vehicle_images
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM vehicles 
            WHERE vehicles.id = vehicle_images.vehicle_id 
            AND vehicles.user_id = auth.uid()
        )
        AND auth.uid() = user_id
    );

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_vehicle_images_vehicle_id ON vehicle_images(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_user_id ON vehicle_images(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_position ON vehicle_images(position);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_primary ON vehicle_images(is_primary);

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_vehicle_images_updated_at ON vehicle_images;
CREATE TRIGGER update_vehicle_images_updated_at
    BEFORE UPDATE ON vehicle_images
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
