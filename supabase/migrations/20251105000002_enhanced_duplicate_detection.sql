-- Enhanced Duplicate Detection with GPS + Time Analysis
-- Detects duplicates based on photos taken at same location + time

-- Function: Calculate GPS distance between two lat/lng points in meters
CREATE OR REPLACE FUNCTION calculate_gps_distance(
  lat1 DOUBLE PRECISION,
  lng1 DOUBLE PRECISION,
  lat2 DOUBLE PRECISION,
  lng2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION AS $$
DECLARE
  R CONSTANT DOUBLE PRECISION := 6371000; -- Earth radius in meters
  dLat DOUBLE PRECISION;
  dLng DOUBLE PRECISION;
  a DOUBLE PRECISION;
  c DOUBLE PRECISION;
BEGIN
  dLat := radians(lat2 - lat1);
  dLng := radians(lng2 - lng1);
  
  a := sin(dLat/2) * sin(dLat/2) +
       cos(radians(lat1)) * cos(radians(lat2)) *
       sin(dLng/2) * sin(dLng/2);
  
  c := 2 * atan2(sqrt(a), sqrt(1-a));
  
  RETURN R * c;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function: Enhanced duplicate detection with GPS + Time
CREATE OR REPLACE FUNCTION detect_duplicates_with_gps_time(
  p_vehicle_id UUID
)
RETURNS TABLE (
  duplicate_id UUID,
  match_type TEXT,
  confidence INTEGER,
  gps_overlap BOOLEAN,
  time_overlap BOOLEAN,
  avg_distance_meters DOUBLE PRECISION,
  photo_date_overlap_days INTEGER,
  reasoning JSONB
) AS $$
DECLARE
  v_vehicle RECORD;
  v_candidate RECORD;
  v_confidence INTEGER;
  v_gps_overlap BOOLEAN;
  v_time_overlap BOOLEAN;
  v_avg_distance DOUBLE PRECISION;
  v_date_overlap INTEGER;
  v_reasoning JSONB;
BEGIN
  -- Get source vehicle
  SELECT * INTO v_vehicle FROM vehicles WHERE id = p_vehicle_id;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Find candidates with same year/make/model and same owner
  FOR v_candidate IN
    SELECT * FROM vehicles
    WHERE id != p_vehicle_id
      AND year = v_vehicle.year
      AND LOWER(make) SIMILAR TO '%' || LOWER(SUBSTRING(v_vehicle.make, 1, 4)) || '%'
      AND LOWER(model) SIMILAR TO '%' || LOWER(SUBSTRING(v_vehicle.model, 1, 5)) || '%'
      AND uploaded_by = v_vehicle.uploaded_by
  LOOP
    -- Calculate GPS overlap
    SELECT 
      COUNT(*) > 0 as has_overlap,
      AVG(distance) as avg_distance
    INTO v_gps_overlap, v_avg_distance
    FROM (
      SELECT calculate_gps_distance(
        vi1.latitude, vi1.longitude,
        vi2.latitude, vi2.longitude
      ) as distance
      FROM vehicle_images vi1
      JOIN vehicle_images vi2 ON 
        vi1.vehicle_id = p_vehicle_id AND
        vi2.vehicle_id = v_candidate.id AND
        vi1.latitude IS NOT NULL AND
        vi2.latitude IS NOT NULL
      WHERE calculate_gps_distance(
        vi1.latitude, vi1.longitude,
        vi2.latitude, vi2.longitude
      ) < 400 -- Within 400 meters
    ) distances;
    
    -- Calculate time overlap (photos taken on same dates)
    SELECT 
      COUNT(DISTINCT d1.photo_date) as overlap_days
    INTO v_date_overlap
    FROM (
      SELECT DATE(taken_at) as photo_date
      FROM vehicle_images
      WHERE vehicle_id = p_vehicle_id
        AND taken_at IS NOT NULL
    ) d1
    JOIN (
      SELECT DATE(taken_at) as photo_date
      FROM vehicle_images
      WHERE vehicle_id = v_candidate.id
        AND taken_at IS NOT NULL
    ) d2 ON d1.photo_date = d2.photo_date;
    
    v_time_overlap := COALESCE(v_date_overlap, 0) > 0;
    
    -- Calculate confidence score
    v_confidence := 70; -- Base for year/make/model match
    
    IF v_gps_overlap THEN
      v_confidence := v_confidence + 20;
    END IF;
    
    IF v_time_overlap THEN
      v_confidence := v_confidence + 10;
    END IF;
    
    -- Check if one has real VIN and other has fake VIN
    IF (v_vehicle.vin IS NOT NULL AND NOT v_vehicle.vin LIKE 'VIVA-%') AND
       (v_candidate.vin LIKE 'VIVA-%' OR v_candidate.vin IS NULL) THEN
      v_confidence := v_confidence + 5;
    END IF;
    
    -- Only return if confidence > 80%
    IF v_confidence >= 80 THEN
      v_reasoning := jsonb_build_object(
        'year', v_vehicle.year,
        'make', v_vehicle.make,
        'model', v_vehicle.model,
        'same_owner', TRUE,
        'gps_overlap', v_gps_overlap,
        'avg_distance_meters', v_avg_distance,
        'time_overlap', v_time_overlap,
        'date_overlap_days', v_date_overlap,
        'vin_mismatch', (v_vehicle.vin NOT LIKE 'VIVA-%' AND v_candidate.vin LIKE 'VIVA-%')
      );
      
      RETURN QUERY SELECT
        v_candidate.id,
        'gps_time_match'::TEXT,
        v_confidence,
        v_gps_overlap,
        v_time_overlap,
        v_avg_distance,
        COALESCE(v_date_overlap, 0),
        v_reasoning;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function: Create merge proposal with user notification
CREATE OR REPLACE FUNCTION create_merge_proposal_with_notification(
  p_primary_vehicle_id UUID,
  p_duplicate_vehicle_id UUID,
  p_match_type TEXT,
  p_confidence INTEGER,
  p_reasoning JSONB
)
RETURNS UUID AS $$
DECLARE
  v_proposal_id UUID;
  v_owner_id UUID;
  v_primary RECORD;
  v_duplicate RECORD;
BEGIN
  -- Get vehicle data
  SELECT * INTO v_primary FROM vehicles WHERE id = p_primary_vehicle_id;
  SELECT * INTO v_duplicate FROM vehicles WHERE id = p_duplicate_vehicle_id;
  
  -- Create merge proposal
  INSERT INTO vehicle_merge_proposals (
    primary_vehicle_id,
    duplicate_vehicle_id,
    match_type,
    confidence_score,
    match_reasoning,
    recommended_primary,
    recommendation_reason,
    status
  ) VALUES (
    p_primary_vehicle_id,
    p_duplicate_vehicle_id,
    p_match_type,
    p_confidence,
    p_reasoning,
    p_primary_vehicle_id,
    'Primary has more data',
    'proposed'
  )
  RETURNING id INTO v_proposal_id;
  
  -- Get owner ID
  SELECT uploaded_by INTO v_owner_id FROM vehicles WHERE id = p_primary_vehicle_id;
  
  -- TODO: Create in-app notification for owner
  -- This would insert into a notifications table (to be created)
  
  RETURN v_proposal_id;
END;
$$ LANGUAGE plpgsql;

-- Notification table for duplicate alerts
CREATE TABLE IF NOT EXISTS duplicate_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  proposal_id UUID NOT NULL REFERENCES vehicle_merge_proposals(id) ON DELETE CASCADE,
  
  -- Notification content
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'acted')),
  action_taken TEXT, -- 'merged', 'dismissed', 'not_duplicate'
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  read_at TIMESTAMP WITH TIME ZONE,
  acted_at TIMESTAMP WITH TIME ZONE,
  
  UNIQUE(user_id, proposal_id)
);

CREATE INDEX idx_duplicate_notifications_user ON duplicate_notifications(user_id, status);
CREATE INDEX idx_duplicate_notifications_unread ON duplicate_notifications(status) WHERE status = 'unread';

-- RLS for notifications
ALTER TABLE duplicate_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON duplicate_notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON duplicate_notifications FOR UPDATE
  USING (auth.uid() = user_id);

COMMENT ON TABLE duplicate_notifications IS 'In-app notifications for potential duplicate vehicles requiring user confirmation';
