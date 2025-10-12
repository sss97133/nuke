-- Universal commenting system for vehicle data
-- Vehicle-level comments
CREATE TABLE IF NOT EXISTS vehicle_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comment_text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Timeline event comments
CREATE TABLE IF NOT EXISTS timeline_event_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comment_text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Data point comments (for specific vehicle attributes)
CREATE TABLE IF NOT EXISTS data_point_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  data_point_type VARCHAR(50) NOT NULL, -- 'make', 'model', 'year', 'vin', 'mileage', etc.
  data_point_value TEXT, -- The actual value being commented on
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comment_text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add auction results to vehicles table
ALTER TABLE vehicles 
ADD COLUMN IF NOT EXISTS sale_price INTEGER,
ADD COLUMN IF NOT EXISTS auction_end_date TEXT,
ADD COLUMN IF NOT EXISTS bid_count INTEGER,
ADD COLUMN IF NOT EXISTS view_count INTEGER,
ADD COLUMN IF NOT EXISTS auction_source TEXT;

-- Enable RLS
ALTER TABLE vehicle_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeline_event_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_point_comments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for vehicle comments
CREATE POLICY "Users can view vehicle comments" ON vehicle_comments
  FOR SELECT USING (true);

CREATE POLICY "Users can create vehicle comments" ON vehicle_comments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own vehicle comments" ON vehicle_comments
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own vehicle comments" ON vehicle_comments
  FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for timeline event comments
CREATE POLICY "Users can view timeline event comments" ON timeline_event_comments
  FOR SELECT USING (true);

CREATE POLICY "Users can create timeline event comments" ON timeline_event_comments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own timeline event comments" ON timeline_event_comments
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own timeline event comments" ON timeline_event_comments
  FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for data point comments
CREATE POLICY "Users can view data point comments" ON data_point_comments
  FOR SELECT USING (true);

CREATE POLICY "Users can create data point comments" ON data_point_comments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own data point comments" ON data_point_comments
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own data point comments" ON data_point_comments
  FOR DELETE USING (auth.uid() = user_id);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_vehicle_comments_vehicle_id ON vehicle_comments(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_comments_user_id ON vehicle_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_timeline_event_comments_event_id ON timeline_event_comments(event_id);
CREATE INDEX IF NOT EXISTS idx_timeline_event_comments_user_id ON timeline_event_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_data_point_comments_vehicle_id ON data_point_comments(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_data_point_comments_type ON data_point_comments(data_point_type);
CREATE INDEX IF NOT EXISTS idx_data_point_comments_user_id ON data_point_comments(user_id);
