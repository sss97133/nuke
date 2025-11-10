-- Photo Dump Support Functions
-- Functions to support bulk photo upload and AI organization

-- Function to find vehicles near a GPS location
CREATE OR REPLACE FUNCTION find_vehicles_near_gps(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_radius_meters INTEGER DEFAULT 100,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  year INTEGER,
  make TEXT,
  make TEXT,
  model TEXT,
  distance_meters DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    v.id,
    v.year,
    v.make,
    v.model,
    -- Calculate distance using Haversine formula
    (
      6371000 * acos(
        cos(radians(p_lat)) * 
        cos(radians(CAST(vte.metadata->>'gps_lat' AS DOUBLE PRECISION))) * 
        cos(radians(CAST(vte.metadata->>'gps_lng' AS DOUBLE PRECISION)) - radians(p_lng)) + 
        sin(radians(p_lat)) * 
        sin(radians(CAST(vte.metadata->>'gps_lat' AS DOUBLE PRECISION)))
      )
    ) as distance_meters
  FROM vehicles v
  INNER JOIN vehicle_timeline_events vte ON vte.vehicle_id = v.id
  WHERE 
    vte.metadata->>'gps_lat' IS NOT NULL
    AND vte.metadata->>'gps_lng' IS NOT NULL
    AND (p_user_id IS NULL OR v.owner_id = p_user_id)
    -- Pre-filter using bounding box for performance
    AND CAST(vte.metadata->>'gps_lat' AS DOUBLE PRECISION) BETWEEN p_lat - 0.001 AND p_lat + 0.001
    AND CAST(vte.metadata->>'gps_lng' AS DOUBLE PRECISION) BETWEEN p_lng - 0.001 AND p_lng + 0.001
  GROUP BY v.id, v.year, v.make, v.model, vte.metadata
  HAVING (
    6371000 * acos(
      cos(radians(p_lat)) * 
      cos(radians(CAST(vte.metadata->>'gps_lat' AS DOUBLE PRECISION))) * 
      cos(radians(CAST(vte.metadata->>'gps_lng' AS DOUBLE PRECISION)) - radians(p_lng)) + 
      sin(radians(p_lat)) * 
      sin(radians(CAST(vte.metadata->>'gps_lat' AS DOUBLE PRECISION)))
    )
  ) <= p_radius_meters
  ORDER BY distance_meters
  LIMIT 10;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Table to track AI photo review queue
CREATE TABLE IF NOT EXISTS photo_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  photo_timestamp TIMESTAMPTZ NOT NULL,
  gps_lat DOUBLE PRECISION,
  gps_lng DOUBLE PRECISION,
  location_name TEXT,
  
  -- AI analysis
  confidence_score INTEGER NOT NULL DEFAULT 0, -- 0-100
  suggested_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  reasoning JSONB, -- Array of reasons for suggestion
  
  -- Review status
  status TEXT NOT NULL DEFAULT 'pending', -- pending, reviewed, skipped
  assigned_vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  
  -- Metadata
  session_id TEXT, -- Group photos from same upload session
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_photo_review_queue_user_status ON photo_review_queue(user_id, status);
CREATE INDEX IF NOT EXISTS idx_photo_review_queue_session ON photo_review_queue(session_id);
CREATE INDEX IF NOT EXISTS idx_photo_review_queue_created ON photo_review_queue(created_at);

-- RLS Policies
ALTER TABLE photo_review_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own review queue"
  ON photo_review_queue FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert into their own review queue"
  ON photo_review_queue FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own review queue"
  ON photo_review_queue FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role has full access to review queue"
  ON photo_review_queue FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- Function to get user's pending review count
CREATE OR REPLACE FUNCTION get_pending_review_count(p_user_id UUID)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
  FROM photo_review_queue
  WHERE user_id = p_user_id
  AND status = 'pending';
$$ LANGUAGE SQL SECURITY DEFINER;

-- Function to batch accept suggested vehicles
CREATE OR REPLACE FUNCTION batch_accept_suggestions(
  p_user_id UUID,
  p_session_id TEXT
)
RETURNS INTEGER AS $$
DECLARE
  accepted_count INTEGER;
BEGIN
  -- Accept all high-confidence suggestions in this session
  UPDATE photo_review_queue
  SET 
    status = 'reviewed',
    assigned_vehicle_id = suggested_vehicle_id,
    reviewed_at = NOW()
  WHERE 
    user_id = p_user_id
    AND session_id = p_session_id
    AND status = 'pending'
    AND confidence_score >= 90
    AND suggested_vehicle_id IS NOT NULL;
  
  GET DIAGNOSTICS accepted_count = ROW_COUNT;
  
  RETURN accepted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_photo_review_queue_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER photo_review_queue_updated_at
  BEFORE UPDATE ON photo_review_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_photo_review_queue_timestamp();

COMMENT ON TABLE photo_review_queue IS 'Queue for photos that need manual review and vehicle assignment';
COMMENT ON FUNCTION find_vehicles_near_gps IS 'Find vehicles that have been worked on near a GPS location';
COMMENT ON FUNCTION get_pending_review_count IS 'Get count of photos waiting for user review';
COMMENT ON FUNCTION batch_accept_suggestions IS 'Accept all high-confidence AI suggestions for a session';

