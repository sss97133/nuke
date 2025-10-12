-- Add social features for vehicle images
-- Views tracking
CREATE TABLE IF NOT EXISTS vehicle_image_views (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  image_id UUID NOT NULL REFERENCES vehicle_images(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  viewed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(image_id, user_id)
);

-- Likes system
CREATE TABLE IF NOT EXISTS vehicle_image_likes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  image_id UUID NOT NULL REFERENCES vehicle_images(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  liked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(image_id, user_id)
);

-- Comments system
CREATE TABLE IF NOT EXISTS vehicle_image_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  image_id UUID NOT NULL REFERENCES vehicle_images(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comment_text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add EXIF data column to vehicle_images if it doesn't exist
ALTER TABLE vehicle_images 
ADD COLUMN IF NOT EXISTS exif_data JSONB;

-- Enable RLS
ALTER TABLE vehicle_image_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_image_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_image_comments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for views (allow all authenticated users to view and create)
CREATE POLICY "Users can view image views" ON vehicle_image_views
  FOR SELECT USING (true);

CREATE POLICY "Users can create image views" ON vehicle_image_views
  FOR INSERT WITH CHECK (true);

-- RLS Policies for likes
CREATE POLICY "Users can view image likes" ON vehicle_image_likes
  FOR SELECT USING (true);

CREATE POLICY "Users can manage their own likes" ON vehicle_image_likes
  FOR ALL USING (auth.uid() = user_id);

-- RLS Policies for comments
CREATE POLICY "Users can view image comments" ON vehicle_image_comments
  FOR SELECT USING (true);

CREATE POLICY "Users can create comments" ON vehicle_image_comments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own comments" ON vehicle_image_comments
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own comments" ON vehicle_image_comments
  FOR DELETE USING (auth.uid() = user_id);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_vehicle_image_views_image_id ON vehicle_image_views(image_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_image_views_user_id ON vehicle_image_views(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_image_likes_image_id ON vehicle_image_likes(image_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_image_likes_user_id ON vehicle_image_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_image_comments_image_id ON vehicle_image_comments(image_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_image_comments_user_id ON vehicle_image_comments(user_id);
