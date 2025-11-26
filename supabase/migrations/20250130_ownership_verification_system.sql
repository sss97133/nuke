-- Vehicle Ownership Verification System
-- Critical security infrastructure for VC compliance

-- Ownership verification workflow table
CREATE TABLE ownership_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Verification status workflow
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'documents_uploaded', 'ai_processing', 'human_review', 
    'approved', 'rejected', 'expired'
  )),
  
  -- Required documents (encrypted storage URLs)
  title_document_url TEXT NOT NULL,
  drivers_license_url TEXT NOT NULL,
  face_scan_url TEXT, -- Optional biometric verification
  insurance_document_url TEXT, -- Optional additional proof
  
  -- Extracted data from OCR/AI processing
  extracted_data JSONB DEFAULT '{}',
  title_owner_name TEXT,
  license_holder_name TEXT,
  vehicle_vin_from_title TEXT,
  
  -- AI processing results
  ai_confidence_score DECIMAL(3,2), -- 0.00 to 1.00
  ai_processing_results JSONB DEFAULT '{}',
  name_match_score DECIMAL(3,2),
  vin_match_confirmed BOOLEAN,
  document_authenticity_score DECIMAL(3,2),
  
  -- Human review data
  human_reviewer_id UUID REFERENCES auth.users(id),
  human_review_notes TEXT,
  rejection_reason TEXT,
  requires_supervisor_review BOOLEAN DEFAULT false,
  
  -- Audit trail timestamps
  submitted_at TIMESTAMP DEFAULT NOW(),
  ai_processed_at TIMESTAMP,
  human_reviewed_at TIMESTAMP,
  approved_at TIMESTAMP,
  rejected_at TIMESTAMP,
  expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '90 days'),
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(user_id, vehicle_id), -- One verification per user-vehicle pair
  CHECK (ai_confidence_score >= 0.00 AND ai_confidence_score <= 1.00),
  CHECK (name_match_score >= 0.00 AND name_match_score <= 1.00),
  CHECK (document_authenticity_score >= 0.00 AND document_authenticity_score <= 1.00)
);

-- Document security and access audit log
CREATE TABLE verification_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id UUID REFERENCES ownership_verifications(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN (
    'submitted', 'document_uploaded', 'ai_processing_started', 'ai_processing_completed',
    'human_review_assigned', 'human_review_completed', 'approved', 'rejected',
    'document_accessed', 'document_deleted', 'escalated_to_supervisor'
  )),
  actor_id UUID REFERENCES auth.users(id),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system', 'reviewer', 'supervisor', 'admin')),
  details JSONB DEFAULT '{}',
  
  -- Security metadata
  ip_address INET,
  user_agent TEXT,
  session_id TEXT,
  
  created_at TIMESTAMP DEFAULT NOW()
);

-- Back-office verification reviewers
CREATE TABLE verification_reviewers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) UNIQUE,
  reviewer_level TEXT NOT NULL DEFAULT 'junior' CHECK (reviewer_level IN ('junior', 'senior', 'supervisor')),
  
  -- Permissions and limits
  can_approve_high_risk BOOLEAN DEFAULT false,
  can_approve_without_supervisor BOOLEAN DEFAULT false,
  max_daily_reviews INTEGER DEFAULT 50,
  specializations TEXT[] DEFAULT '{}', -- e.g., ['luxury_vehicles', 'commercial_vehicles']
  
  -- Performance tracking
  total_reviews_completed INTEGER DEFAULT 0,
  approval_rate DECIMAL(3,2),
  average_review_time_minutes INTEGER,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  last_active_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Verification queue management
CREATE TABLE verification_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id UUID REFERENCES ownership_verifications(id) ON DELETE CASCADE,
  assigned_reviewer_id UUID REFERENCES verification_reviewers(id),
  
  -- Queue metadata
  priority_score INTEGER DEFAULT 0, -- Higher = more urgent
  risk_level TEXT DEFAULT 'standard' CHECK (risk_level IN ('low', 'standard', 'high', 'critical')),
  estimated_review_time_minutes INTEGER DEFAULT 15,
  
  -- Queue status
  queue_status TEXT DEFAULT 'pending' CHECK (queue_status IN ('pending', 'assigned', 'in_review', 'completed', 'escalated')),
  assigned_at TIMESTAMP,
  started_review_at TIMESTAMP,
  completed_at TIMESTAMP,
  
  created_at TIMESTAMP DEFAULT NOW()
);

-- Document fraud detection patterns
CREATE TABLE fraud_detection_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type TEXT NOT NULL CHECK (pattern_type IN (
    'duplicate_document', 'tampered_document', 'suspicious_user_pattern', 
    'known_fraudulent_document', 'blacklisted_document_hash'
  )),
  pattern_data JSONB NOT NULL,
  confidence_level DECIMAL(3,2) NOT NULL,
  
  -- Pattern metadata
  first_detected_at TIMESTAMP DEFAULT NOW(),
  last_seen_at TIMESTAMP DEFAULT NOW(),
  occurrence_count INTEGER DEFAULT 1,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  reviewed_by_human BOOLEAN DEFAULT false,
  
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add ownership verification status to vehicles table
ALTER TABLE vehicles 
ADD COLUMN IF NOT EXISTS ownership_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS ownership_verified_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS ownership_verification_id UUID REFERENCES ownership_verifications(id);

-- Create indexes for performance
CREATE INDEX idx_ownership_verifications_user_id ON ownership_verifications(user_id);
CREATE INDEX idx_ownership_verifications_vehicle_id ON ownership_verifications(vehicle_id);
CREATE INDEX idx_ownership_verifications_status ON ownership_verifications(status);
CREATE INDEX idx_ownership_verifications_submitted_at ON ownership_verifications(submitted_at);

CREATE INDEX idx_verification_audit_log_verification_id ON verification_audit_log(verification_id);
CREATE INDEX idx_verification_audit_log_created_at ON verification_audit_log(created_at);

CREATE INDEX idx_verification_queue_status ON verification_queue(queue_status);
CREATE INDEX idx_verification_queue_priority ON verification_queue(priority_score DESC);
CREATE INDEX idx_verification_queue_assigned_reviewer ON verification_queue(assigned_reviewer_id);

-- Row Level Security (RLS) Policies

-- Users can only see their own verification requests
ALTER TABLE ownership_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own verifications" ON ownership_verifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own verifications" ON ownership_verifications
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Reviewers can see assigned verifications
CREATE POLICY "Reviewers can view assigned verifications" ON ownership_verifications
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM verification_reviewers vr
      WHERE vr.user_id = auth.uid() AND vr.is_active = true
    )
  );

-- Audit log access for reviewers and admins
ALTER TABLE verification_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Reviewers can view audit logs" ON verification_audit_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM verification_reviewers vr
      WHERE vr.user_id = auth.uid() AND vr.is_active = true
    )
  );

-- Queue access for reviewers
ALTER TABLE verification_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Reviewers can view queue" ON verification_queue
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM verification_reviewers vr
      WHERE vr.user_id = auth.uid() AND vr.is_active = true
    )
  );

-- Functions for verification workflow

-- Function to calculate verification priority score
CREATE OR REPLACE FUNCTION calculate_verification_priority(
  verification_id UUID
) RETURNS INTEGER AS $$
DECLARE
  priority_score INTEGER := 0;
  verification_record ownership_verifications%ROWTYPE;
BEGIN
  SELECT * INTO verification_record 
  FROM ownership_verifications 
  WHERE id = verification_id;
  
  -- Base priority
  priority_score := 100;
  
  -- Higher priority for high-value vehicles (if we have value data)
  -- Higher priority for low AI confidence (needs human attention)
  IF verification_record.ai_confidence_score < 0.7 THEN
    priority_score := priority_score + 50;
  END IF;
  
  -- Higher priority for older submissions
  priority_score := priority_score + EXTRACT(HOURS FROM (NOW() - verification_record.submitted_at))::INTEGER;
  
  -- Higher priority for users with good history (future enhancement)
  
  RETURN priority_score;
END;
$$ LANGUAGE plpgsql;

-- Function to auto-assign verifications to reviewers
CREATE OR REPLACE FUNCTION assign_verification_to_reviewer(
  verification_id UUID
) RETURNS UUID AS $$
DECLARE
  selected_reviewer_id UUID;
  queue_record_id UUID;
BEGIN
  -- Find available reviewer with lowest current workload
  SELECT vr.user_id INTO selected_reviewer_id
  FROM verification_reviewers vr
  LEFT JOIN verification_queue vq ON vq.assigned_reviewer_id = vr.id 
    AND vq.queue_status IN ('assigned', 'in_review')
  WHERE vr.is_active = true
  GROUP BY vr.user_id, vr.max_daily_reviews
  HAVING COUNT(vq.id) < vr.max_daily_reviews
  ORDER BY COUNT(vq.id) ASC
  LIMIT 1;
  
  IF selected_reviewer_id IS NOT NULL THEN
    -- Create queue entry
    INSERT INTO verification_queue (
      verification_id, 
      assigned_reviewer_id, 
      priority_score,
      queue_status,
      assigned_at
    ) VALUES (
      verification_id,
      (SELECT id FROM verification_reviewers WHERE user_id = selected_reviewer_id),
      calculate_verification_priority(verification_id),
      'assigned',
      NOW()
    ) RETURNING id INTO queue_record_id;
    
    -- Log the assignment
    INSERT INTO verification_audit_log (
      verification_id, action, actor_type, details
    ) VALUES (
      verification_id, 'human_review_assigned', 'system',
      jsonb_build_object('reviewer_id', selected_reviewer_id, 'queue_id', queue_record_id)
    );
  END IF;
  
  RETURN selected_reviewer_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-assign verifications when AI processing completes
CREATE OR REPLACE FUNCTION trigger_assign_verification()
RETURNS TRIGGER AS $$
BEGIN
  -- If status changed to human_review, auto-assign to reviewer
  IF NEW.status = 'human_review' AND OLD.status != 'human_review' THEN
    PERFORM assign_verification_to_reviewer(NEW.id);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER assign_verification_trigger
  AFTER UPDATE ON ownership_verifications
  FOR EACH ROW
  EXECUTE FUNCTION trigger_assign_verification();

-- Function to approve ownership verification
-- NOW CHECKS FOR EXISTING OWNER AND REQUIRES TRANSFER APPROVAL
CREATE OR REPLACE FUNCTION approve_ownership_verification(
  verification_id UUID,
  reviewer_id UUID,
  review_notes TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  verification_record ownership_verifications%ROWTYPE;
  vehicle_record vehicles%ROWTYPE;
  v_existing_owner_id UUID;
  v_transfer_id UUID;
BEGIN
  -- Get verification record
  SELECT * INTO verification_record 
  FROM ownership_verifications 
  WHERE id = verification_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification not found';
  END IF;
  
  -- Check if there's an existing approved owner
  SELECT user_id INTO v_existing_owner_id
  FROM ownership_verifications
  WHERE vehicle_id = verification_record.vehicle_id
    AND user_id != verification_record.user_id
    AND status = 'approved'
    AND id != verification_id
  ORDER BY approved_at DESC
  LIMIT 1;
  
  -- If existing owner exists, create transfer and require approval
  IF v_existing_owner_id IS NOT NULL THEN
    -- Create transfer record (requires seller approval)
    SELECT detect_and_create_title_transfer(
      verification_record.vehicle_id,
      verification_record.user_id,
      verification_id
    ) INTO v_transfer_id;
    
    -- Set verification to pending transfer approval
    UPDATE ownership_verifications 
    SET 
      status = 'pending', -- Keep as pending until transfer approved
      human_reviewer_id = reviewer_id,
      human_review_notes = format('%s (Transfer approval required from previous owner)', COALESCE(review_notes, '')),
      human_reviewed_at = NOW(),
      updated_at = NOW()
    WHERE id = verification_id;
    
    -- Log that transfer approval is required
    INSERT INTO verification_audit_log (
      verification_id, action, actor_id, actor_type, details
    ) VALUES (
      verification_id, 'pending_transfer_approval', reviewer_id, 'system',
      jsonb_build_object(
        'review_notes', review_notes,
        'transfer_id', v_transfer_id,
        'previous_owner_id', v_existing_owner_id,
        'message', 'Approval requires transfer approval from previous owner'
      )
    );
    
    -- Don't update vehicle ownership yet - wait for transfer approval
    RETURN false; -- Not fully approved yet, waiting for transfer
  END IF;
  
  -- No existing owner, proceed with normal approval
  UPDATE ownership_verifications 
  SET 
    status = 'approved',
    human_reviewer_id = reviewer_id,
    human_review_notes = review_notes,
    human_reviewed_at = NOW(),
    approved_at = NOW(),
    updated_at = NOW()
  WHERE id = verification_id;
  
  -- Update vehicle ownership
  UPDATE vehicles 
  SET 
    user_id = verification_record.user_id,
    ownership_verified = true,
    ownership_verified_at = NOW(),
    ownership_verification_id = verification_id
  WHERE id = verification_record.vehicle_id;
  
  -- Log the approval
  INSERT INTO verification_audit_log (
    verification_id, action, actor_id, actor_type, details
  ) VALUES (
    verification_id, 'approved', reviewer_id, 'reviewer',
    jsonb_build_object('review_notes', review_notes)
  );
  
  -- Update queue status
  UPDATE verification_queue 
  SET queue_status = 'completed', completed_at = NOW()
  WHERE verification_id = verification_id;
  
  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE ownership_verifications IS 'Core table for vehicle ownership verification workflow with document upload and human review process';
COMMENT ON TABLE verification_audit_log IS 'Complete audit trail for all verification actions and document access';
COMMENT ON TABLE verification_reviewers IS 'Back-office team members authorized to review and approve ownership verifications';
COMMENT ON TABLE verification_queue IS 'Queue management system for assigning verifications to reviewers';
COMMENT ON TABLE fraud_detection_patterns IS 'AI-detected patterns for document fraud prevention';
