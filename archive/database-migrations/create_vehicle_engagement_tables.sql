-- Create vehicle_views table for view tracking
CREATE TABLE IF NOT EXISTS vehicle_views (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  viewed_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT,
  session_id TEXT,
  
  -- Indexes for performance
  CONSTRAINT unique_user_view UNIQUE(vehicle_id, user_id, DATE(viewed_at))
);

CREATE INDEX idx_vehicle_views_vehicle ON vehicle_views(vehicle_id);
CREATE INDEX idx_vehicle_views_date ON vehicle_views(viewed_at DESC);

-- Add RLS
ALTER TABLE vehicle_views ENABLE ROW LEVEL SECURITY;

-- Anyone can record views
CREATE POLICY "Allow view recording" ON vehicle_views
  FOR INSERT TO authenticated, anon
  USING (true);

-- Users can see view counts
CREATE POLICY "Allow view reading" ON vehicle_views
  FOR SELECT TO authenticated, anon
  USING (true);

-- Create user_presence table for real-time presence
CREATE TABLE IF NOT EXISTS user_presence (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  is_anonymous BOOLEAN DEFAULT false,
  
  -- Unique constraint for user per vehicle
  CONSTRAINT unique_user_presence UNIQUE(vehicle_id, user_id)
);

CREATE INDEX idx_user_presence_vehicle ON user_presence(vehicle_id);
CREATE INDEX idx_user_presence_last_seen ON user_presence(last_seen_at DESC);

-- Add RLS
ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;

-- Anyone can update presence
CREATE POLICY "Allow presence updates" ON user_presence
  FOR ALL TO authenticated, anon
  USING (true);

-- Create image_tags table for AI-extracted tags
CREATE TABLE IF NOT EXISTS image_tags (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  vehicle_image_id UUID REFERENCES vehicle_images(id) ON DELETE CASCADE,
  tag_text TEXT NOT NULL,
  tag_type TEXT NOT NULL CHECK (tag_type IN ('product', 'damage', 'location', 'modification', 'brand', 'part', 'tool', 'fluid')),
  confidence INTEGER DEFAULT 50 CHECK (confidence >= 0 AND confidence <= 100),
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'ai_vision', 'exif')),
  metadata JSONB DEFAULT '{}',
  x_position FLOAT,
  y_position FLOAT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Indexes
  CONSTRAINT unique_image_tag UNIQUE(vehicle_image_id, tag_text, x_position, y_position)
);

CREATE INDEX idx_image_tags_vehicle ON image_tags(vehicle_id);
CREATE INDEX idx_image_tags_image ON image_tags(vehicle_image_id);
CREATE INDEX idx_image_tags_type ON image_tags(tag_type);

-- Add RLS
ALTER TABLE image_tags ENABLE ROW LEVEL SECURITY;

-- Anyone can read tags
CREATE POLICY "Public tag reading" ON image_tags
  FOR SELECT TO authenticated, anon
  USING (true);

-- Vehicle contributors can add tags
CREATE POLICY "Contributors can add tags" ON image_tags
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.id = vehicle_id
      AND (v.user_id = auth.uid() OR v.is_public = true)
    )
  );

-- Tag creators can update their own tags
CREATE POLICY "Users can update own tags" ON image_tags
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid());

-- Tag creators can delete their own tags
CREATE POLICY "Users can delete own tags" ON image_tags
  FOR DELETE TO authenticated
  USING (created_by = auth.uid());
