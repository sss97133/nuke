-- Create user photo album table for storing unorganized photos
CREATE TABLE IF NOT EXISTS user_photo_album (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  thumbnail_url TEXT,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  file_type TEXT,
  
  -- Dates
  upload_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  taken_date TIMESTAMP WITH TIME ZONE,
  
  -- Assignment
  assigned_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  assigned_vehicle_name TEXT, -- Denormalized for performance
  
  -- Metadata
  category TEXT DEFAULT 'general',
  tags TEXT[],
  metadata JSONB DEFAULT '{}',
  exif_data JSONB,
  
  -- AI Processing
  processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
  ai_suggestions JSONB,
  ai_processed_at TIMESTAMP WITH TIME ZONE,
  
  -- Indexes for performance
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_user_photo_album_user_id ON user_photo_album(user_id);
CREATE INDEX idx_user_photo_album_vehicle_id ON user_photo_album(assigned_vehicle_id);
CREATE INDEX idx_user_photo_album_status ON user_photo_album(processing_status);
CREATE INDEX idx_user_photo_album_upload_date ON user_photo_album(upload_date DESC);
CREATE INDEX idx_user_photo_album_taken_date ON user_photo_album(taken_date DESC);

-- RLS Policies
ALTER TABLE user_photo_album ENABLE ROW LEVEL SECURITY;

-- Users can view their own photos
CREATE POLICY "Users can view own photos" ON user_photo_album
  FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own photos
CREATE POLICY "Users can insert own photos" ON user_photo_album
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own photos
CREATE POLICY "Users can update own photos" ON user_photo_album
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own photos
CREATE POLICY "Users can delete own photos" ON user_photo_album
  FOR DELETE USING (auth.uid() = user_id);

-- Function to automatically update updated_at
CREATE OR REPLACE FUNCTION update_user_photo_album_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_photo_album_updated_at
  BEFORE UPDATE ON user_photo_album
  FOR EACH ROW
  EXECUTE FUNCTION update_user_photo_album_updated_at();

-- Function to move photo from album to vehicle
CREATE OR REPLACE FUNCTION move_photo_to_vehicle(
  p_photo_id UUID,
  p_vehicle_id UUID,
  p_category TEXT DEFAULT 'general'
)
RETURNS BOOLEAN AS $$
DECLARE
  v_photo user_photo_album%ROWTYPE;
  v_vehicle vehicles%ROWTYPE;
BEGIN
  -- Get photo details
  SELECT * INTO v_photo FROM user_photo_album WHERE id = p_photo_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  
  -- Verify user owns the photo
  IF v_photo.user_id != auth.uid() THEN
    RETURN FALSE;
  END IF;
  
  -- Get vehicle details
  SELECT * INTO v_vehicle FROM vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  
  -- Insert into vehicle_images
  INSERT INTO vehicle_images (
    vehicle_id,
    user_id,
    image_url,
    thumbnail_url,
    storage_path,
    category,
    tags,
    taken_at,
    file_name,
    file_size,
    file_type,
    exif_data,
    metadata
  ) VALUES (
    p_vehicle_id,
    v_photo.user_id,
    v_photo.image_url,
    v_photo.thumbnail_url,
    v_photo.storage_path,
    p_category,
    v_photo.tags,
    v_photo.taken_date,
    v_photo.file_name,
    v_photo.file_size,
    v_photo.file_type,
    v_photo.exif_data,
    v_photo.metadata
  );
  
  -- Update photo with assignment
  UPDATE user_photo_album
  SET 
    assigned_vehicle_id = p_vehicle_id,
    assigned_vehicle_name = v_vehicle.year || ' ' || v_vehicle.make || ' ' || v_vehicle.model,
    category = p_category,
    updated_at = NOW()
  WHERE id = p_photo_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create view for photo statistics
CREATE OR REPLACE VIEW user_photo_statistics AS
SELECT 
  user_id,
  COUNT(*) as total_photos,
  COUNT(CASE WHEN assigned_vehicle_id IS NOT NULL THEN 1 END) as assigned_photos,
  COUNT(CASE WHEN assigned_vehicle_id IS NULL THEN 1 END) as unassigned_photos,
  COUNT(CASE WHEN processing_status = 'pending' THEN 1 END) as pending_photos,
  COUNT(CASE WHEN ai_suggestions IS NOT NULL THEN 1 END) as ai_suggested_photos,
  MAX(upload_date) as last_upload_date
FROM user_photo_album
GROUP BY user_id;

-- Grant access to the view
GRANT SELECT ON user_photo_statistics TO authenticated;