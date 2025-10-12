-- Fix vehicle_images table schema - add missing filename column and other fields needed by ImageDownloadService

-- First, make vehicle_id nullable to support temporary scraped images
ALTER TABLE vehicle_images ALTER COLUMN vehicle_id DROP NOT NULL;

-- Add missing columns
ALTER TABLE vehicle_images 
ADD COLUMN IF NOT EXISTS filename TEXT,
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'user_upload',
ADD COLUMN IF NOT EXISTS source_url TEXT,
ADD COLUMN IF NOT EXISTS is_external BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS file_size BIGINT,
ADD COLUMN IF NOT EXISTS mime_type TEXT,
ADD COLUMN IF NOT EXISTS temp_session_id TEXT; -- For associating scraped images before vehicle is saved

-- Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_vehicle_images_source ON vehicle_images(source);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_filename ON vehicle_images(filename);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_temp_session ON vehicle_images(temp_session_id);

-- Add comments to explain the new fields
COMMENT ON COLUMN vehicle_images.filename IS 'Original filename of the uploaded/downloaded image';
COMMENT ON COLUMN vehicle_images.source IS 'Source of the image: user_upload, bat_listing, scraped_listing, external_link';
COMMENT ON COLUMN vehicle_images.source_url IS 'Original URL if image was scraped/downloaded from external source';
COMMENT ON COLUMN vehicle_images.is_external IS 'True if image is referenced externally (not stored in our storage)';
COMMENT ON COLUMN vehicle_images.file_size IS 'File size in bytes';
COMMENT ON COLUMN vehicle_images.mime_type IS 'MIME type of the image file';
COMMENT ON COLUMN vehicle_images.temp_session_id IS 'Temporary session ID for associating scraped images before vehicle is saved';

-- Update RLS policies to handle nullable vehicle_id for temporary scraped images
DROP POLICY IF EXISTS "Users can insert images for their own vehicles" ON vehicle_images;
CREATE POLICY "Users can insert images for their own vehicles" ON vehicle_images
    FOR INSERT WITH CHECK (
        -- Allow temporary images without vehicle_id (for scraping)
        (vehicle_id IS NULL AND temp_session_id IS NOT NULL AND auth.uid() = user_id)
        OR
        -- Allow images for existing vehicles they own
        (vehicle_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM vehicles 
            WHERE vehicles.id = vehicle_images.vehicle_id 
            AND vehicles.user_id = auth.uid()
        ) AND auth.uid() = user_id)
    );

-- Add missing ownership and auction fields to vehicles table
ALTER TABLE vehicles 
ADD COLUMN IF NOT EXISTS drivetrain TEXT,
ADD COLUMN IF NOT EXISTS acting_on_behalf_of TEXT,
ADD COLUMN IF NOT EXISTS ownership_percentage DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS owner_name TEXT,
ADD COLUMN IF NOT EXISTS owner_contact TEXT,
ADD COLUMN IF NOT EXISTS relationship_notes TEXT,
ADD COLUMN IF NOT EXISTS bat_auction_url TEXT,
ADD COLUMN IF NOT EXISTS bat_sold_price DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS bat_sale_date DATE,
ADD COLUMN IF NOT EXISTS description TEXT;

-- Add indexes for new fields
CREATE INDEX IF NOT EXISTS idx_vehicles_drivetrain ON vehicles(drivetrain);
CREATE INDEX IF NOT EXISTS idx_vehicles_acting_on_behalf_of ON vehicles(acting_on_behalf_of);
CREATE INDEX IF NOT EXISTS idx_vehicles_bat_auction_url ON vehicles(bat_auction_url);
CREATE INDEX IF NOT EXISTS idx_vehicles_bat_sold_price ON vehicles(bat_sold_price);
CREATE INDEX IF NOT EXISTS idx_vehicles_bat_sale_date ON vehicles(bat_sale_date);

-- Add comments for new fields
COMMENT ON COLUMN vehicles.drivetrain IS 'Drivetrain type (4WD, AWD, FWD, RWD, etc.) - separate from trim level';
COMMENT ON COLUMN vehicles.acting_on_behalf_of IS 'Who the user is acting on behalf of (self, family, business, etc.)';
COMMENT ON COLUMN vehicles.ownership_percentage IS 'Percentage of ownership (0-100)';
COMMENT ON COLUMN vehicles.owner_name IS 'Name of the actual owner if different from user';
COMMENT ON COLUMN vehicles.owner_contact IS 'Contact information for the owner';
COMMENT ON COLUMN vehicles.relationship_notes IS 'Additional notes about ownership relationship';
COMMENT ON COLUMN vehicles.bat_auction_url IS 'Bring a Trailer auction URL if applicable';
COMMENT ON COLUMN vehicles.bat_sold_price IS 'Final sale price from BAT auction';
COMMENT ON COLUMN vehicles.bat_sale_date IS 'Date the BAT auction ended/vehicle was sold';
COMMENT ON COLUMN vehicles.description IS 'User-provided description of the vehicle';
