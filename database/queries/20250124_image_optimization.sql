-- Migration: Add image variant URLs to vehicle_images table
-- Purpose: Store thumbnail, medium, and large variants for performance optimization

-- Add columns for image variants
ALTER TABLE vehicle_images 
ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
ADD COLUMN IF NOT EXISTS medium_url TEXT,
ADD COLUMN IF NOT EXISTS large_url TEXT,
ADD COLUMN IF NOT EXISTS optimization_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS optimized_at TIMESTAMP;

-- Create index for optimization status to quickly find unoptimized images
CREATE INDEX IF NOT EXISTS idx_vehicle_images_optimization_status 
ON vehicle_images(optimization_status) 
WHERE optimization_status = 'pending';

-- Create function to track optimization progress
CREATE OR REPLACE FUNCTION update_image_optimization_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.thumbnail_url IS NOT NULL AND 
     NEW.medium_url IS NOT NULL AND 
     NEW.large_url IS NOT NULL THEN
    NEW.optimization_status = 'completed';
    NEW.optimized_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update optimization status
DROP TRIGGER IF EXISTS trigger_update_optimization_status ON vehicle_images;
CREATE TRIGGER trigger_update_optimization_status
  BEFORE UPDATE ON vehicle_images
  FOR EACH ROW
  EXECUTE FUNCTION update_image_optimization_status();

-- Add comment explaining the optimization strategy
COMMENT ON COLUMN vehicle_images.thumbnail_url IS 'URL to 150px wide thumbnail for grid views';
COMMENT ON COLUMN vehicle_images.medium_url IS 'URL to 400px wide image for card views';
COMMENT ON COLUMN vehicle_images.large_url IS 'URL to 800px wide image for lightbox views';
COMMENT ON COLUMN vehicle_images.optimization_status IS 'Status of image optimization: pending, processing, completed, failed';
COMMENT ON COLUMN vehicle_images.optimized_at IS 'Timestamp when optimization was completed';
