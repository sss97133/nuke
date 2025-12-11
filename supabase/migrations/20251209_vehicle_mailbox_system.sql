-- Vehicle Mailbox System
-- Each vehicle gets its own mailbox with relationship-based access control

-- Vehicle mailboxes table - one per vehicle
CREATE TABLE vehicle_mailboxes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id UUID NOT NULL UNIQUE,
  vin VARCHAR(17) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Mailbox access keys - defines who can access each vehicle's mailbox
CREATE TABLE mailbox_access_keys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  mailbox_id UUID NOT NULL REFERENCES vehicle_mailboxes(id) ON DELETE CASCADE,
  user_id UUID,  -- NULL for system-generated keys
  org_id UUID,   -- Organization that has access
  key_type VARCHAR(20) NOT NULL CHECK (key_type IN ('master', 'temporary', 'conditional', 'inherited', 'system')),
  permission_level VARCHAR(20) NOT NULL CHECK (permission_level IN ('read_write', 'read_only', 'write_only', 'filtered')),
  relationship_type VARCHAR(30) NOT NULL CHECK (relationship_type IN ('owner', 'dealer', 'service_provider', 'insurance', 'financing', 'family', 'trusted_party')),
  granted_by UUID, -- User who granted this key
  expires_at TIMESTAMP,
  conditions JSONB, -- Conditional access rules
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),

  CONSTRAINT unique_user_mailbox_relationship UNIQUE (mailbox_id, user_id, relationship_type),
  CONSTRAINT unique_org_mailbox_relationship UNIQUE (mailbox_id, org_id, relationship_type)
);

-- Mailbox messages - notifications and communications for each vehicle
CREATE TABLE mailbox_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  mailbox_id UUID NOT NULL REFERENCES vehicle_mailboxes(id) ON DELETE CASCADE,
  message_type VARCHAR(30) NOT NULL CHECK (message_type IN ('duplicate_detected', 'ownership_transfer', 'service_reminder', 'insurance_claim', 'recall_notice', 'registration_due', 'inspection_due', 'system_alert')),
  title VARCHAR(200) NOT NULL,
  content TEXT,
  priority VARCHAR(10) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  sender_id UUID, -- User/system that sent the message
  sender_type VARCHAR(20) DEFAULT 'system' CHECK (sender_type IN ('user', 'system', 'organization')),
  metadata JSONB, -- Message-specific data
  read_by JSONB DEFAULT '[]', -- Array of user IDs who have read this message
  resolved_at TIMESTAMP,
  resolved_by UUID,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Image forensics table for duplicate detection
CREATE TABLE IF NOT EXISTS image_forensics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id UUID,
  image_url TEXT NOT NULL,
  exif_data JSONB,
  gps_coordinates POINT,
  timestamp_taken TIMESTAMP,
  device_fingerprint TEXT,
  perceptual_hash TEXT,
  ai_features JSONB, -- AI-extracted vehicle features
  created_at TIMESTAMP DEFAULT now()
);

-- Create indexes separately for image_forensics
CREATE INDEX IF NOT EXISTS idx_gps_coordinates ON image_forensics USING GIST (gps_coordinates);
CREATE INDEX IF NOT EXISTS idx_timestamp_taken ON image_forensics(timestamp_taken);
CREATE INDEX IF NOT EXISTS idx_perceptual_hash ON image_forensics(perceptual_hash);
CREATE INDEX IF NOT EXISTS idx_device_fingerprint ON image_forensics(device_fingerprint);

-- Duplicate detection results
CREATE TABLE duplicate_detections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  original_vehicle_id UUID NOT NULL,
  duplicate_vehicle_id UUID NOT NULL,
  detection_method VARCHAR(30) NOT NULL CHECK (detection_method IN ('exif_gps', 'image_hash', 'ai_visual', 'temporal_clustering', 'manual_report')),
  confidence_score DECIMAL(3,2) NOT NULL CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
  evidence JSONB, -- Detailed evidence for the match
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected', 'merged')),
  reviewed_by UUID,
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now(),

  CONSTRAINT unique_duplicate_pair UNIQUE (original_vehicle_id, duplicate_vehicle_id)
);

-- Notification preferences per user
CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  email_enabled BOOLEAN DEFAULT true,
  push_enabled BOOLEAN DEFAULT true,
  sms_enabled BOOLEAN DEFAULT false,
  message_types JSONB DEFAULT '["duplicate_detected", "ownership_transfer", "system_alert"]', -- Which message types to receive
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- RLS Policies
ALTER TABLE vehicle_mailboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mailbox_access_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE mailbox_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_forensics ENABLE ROW LEVEL SECURITY;
ALTER TABLE duplicate_detections ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- Policies for mailbox access based on access keys
CREATE POLICY "Users can view mailboxes they have access to" ON vehicle_mailboxes
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM mailbox_access_keys
    WHERE mailbox_id = vehicle_mailboxes.id
    AND user_id = auth.uid()
    AND permission_level IN ('read_write', 'read_only', 'filtered')
    AND (expires_at IS NULL OR expires_at > now())
  )
);

CREATE POLICY "Users can view messages for accessible mailboxes" ON mailbox_messages
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM mailbox_access_keys
    WHERE mailbox_id = mailbox_messages.mailbox_id
    AND user_id = auth.uid()
    AND permission_level IN ('read_write', 'read_only', 'filtered')
    AND (expires_at IS NULL OR expires_at > now())
  )
);

CREATE POLICY "Users can create messages for accessible mailboxes" ON mailbox_messages
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM mailbox_access_keys
    WHERE mailbox_id = mailbox_messages.mailbox_id
    AND user_id = auth.uid()
    AND permission_level IN ('read_write', 'write_only')
    AND (expires_at IS NULL OR expires_at > now())
  )
);

-- Functions for duplicate detection workflow
DROP FUNCTION IF EXISTS detect_vehicle_duplicates(UUID);
CREATE OR REPLACE FUNCTION detect_vehicle_duplicates(target_vehicle_id UUID)
RETURNS TABLE (
  duplicate_id UUID,
  confidence DECIMAL(3,2),
  method VARCHAR(30),
  evidence JSONB
) LANGUAGE plpgsql AS $$
BEGIN
  -- EXIF GPS + timestamp matching (high confidence)
  RETURN QUERY
  SELECT
    i2.vehicle_id,
    0.95::decimal(3,2) as confidence,
    'exif_gps'::varchar(30) as method,
    jsonb_build_object(
      'gps_distance', ST_Distance(i1.gps_coordinates, i2.gps_coordinates),
      'time_diff', EXTRACT(EPOCH FROM (i2.timestamp_taken - i1.timestamp_taken))
    ) as evidence
  FROM image_forensics i1
  JOIN image_forensics i2 ON i1.vehicle_id = target_vehicle_id
    AND i2.vehicle_id != target_vehicle_id
    AND ST_DWithin(i1.gps_coordinates, i2.gps_coordinates, 100) -- Within 100 meters
    AND ABS(EXTRACT(EPOCH FROM (i2.timestamp_taken - i1.timestamp_taken))) < 86400 -- Within 24 hours
  WHERE i1.vehicle_id = target_vehicle_id;

  -- Perceptual hash matching (medium confidence)
  RETURN QUERY
  SELECT
    i2.vehicle_id,
    0.75::decimal(3,2) as confidence,
    'image_hash'::varchar(30) as method,
    jsonb_build_object('hash_similarity', 'high') as evidence
  FROM image_forensics i1
  JOIN image_forensics i2 ON i1.vehicle_id = target_vehicle_id
    AND i2.vehicle_id != target_vehicle_id
    AND i1.perceptual_hash = i2.perceptual_hash
  WHERE i1.vehicle_id = target_vehicle_id;
END;
$$;

-- Function to create vehicle mailbox when vehicle is created
CREATE OR REPLACE FUNCTION create_vehicle_mailbox()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO vehicle_mailboxes (vehicle_id, vin)
  VALUES (NEW.id, NEW.vin);

  -- Grant master key to vehicle owner
  IF NEW.owner_id IS NOT NULL THEN
    INSERT INTO mailbox_access_keys (
      mailbox_id, user_id, key_type, permission_level, relationship_type, granted_by
    )
    SELECT
      vm.id, NEW.owner_id, 'master', 'read_write', 'owner', NEW.owner_id
    FROM vehicle_mailboxes vm
    WHERE vm.vehicle_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- Create the trigger to automatically create mailboxes for new vehicles
CREATE TRIGGER trigger_create_vehicle_mailbox
    AFTER INSERT ON vehicles
    FOR EACH ROW
    EXECUTE FUNCTION create_vehicle_mailbox();

-- Function to send duplicate detection notification
CREATE OR REPLACE FUNCTION notify_duplicate_detection(
  original_vehicle_id UUID,
  duplicate_vehicle_id UUID,
  confidence_score DECIMAL(3,2),
  evidence_data JSONB
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  mailbox_id UUID;
  message_id UUID;
BEGIN
  -- Get mailbox for original vehicle
  SELECT id INTO mailbox_id
  FROM vehicle_mailboxes
  WHERE vehicle_id = original_vehicle_id;

  -- Create notification message
  INSERT INTO mailbox_messages (
    mailbox_id, message_type, title, content, priority, sender_type, metadata
  ) VALUES (
    mailbox_id,
    'duplicate_detected',
    'Potential Vehicle Duplicate Detected',
    format('We found a potential duplicate of your vehicle with %s%% confidence. Please review and confirm if this is the same vehicle.', (confidence_score * 100)::integer),
    CASE
      WHEN confidence_score >= 0.9 THEN 'high'
      WHEN confidence_score >= 0.7 THEN 'medium'
      ELSE 'low'
    END,
    'system',
    jsonb_build_object(
      'duplicate_vehicle_id', duplicate_vehicle_id,
      'confidence_score', confidence_score,
      'evidence', evidence_data,
      'action_required', true
    )
  ) RETURNING id INTO message_id;

  RETURN message_id;
END;
$$;

-- Indexes for performance
CREATE INDEX idx_mailbox_access_user ON mailbox_access_keys(user_id, mailbox_id);
CREATE INDEX idx_mailbox_access_org ON mailbox_access_keys(org_id, mailbox_id);
CREATE INDEX idx_messages_mailbox ON mailbox_messages(mailbox_id, created_at DESC);
CREATE INDEX idx_messages_type ON mailbox_messages(message_type, created_at DESC);
CREATE INDEX idx_duplicate_confidence ON duplicate_detections(confidence_score DESC);

-- Comments
COMMENT ON TABLE vehicle_mailboxes IS 'Each vehicle has its own mailbox for receiving notifications and communications';
COMMENT ON TABLE mailbox_access_keys IS 'Relationship-based access control for vehicle mailboxes';
COMMENT ON TABLE mailbox_messages IS 'All notifications and messages for vehicles';
COMMENT ON TABLE image_forensics IS 'EXIF and AI data extracted from vehicle images for duplicate detection';
COMMENT ON TABLE duplicate_detections IS 'Results of duplicate vehicle detection algorithms';