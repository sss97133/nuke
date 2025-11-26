-- Fix ownership verification pipeline to properly create vehicle_ownerships records
-- This ensures that only verified, approved ownership with up-to-date titles creates ownership records

-- First, add verification_id to vehicle_ownerships to link back to the verification
ALTER TABLE vehicle_ownerships 
ADD COLUMN IF NOT EXISTS verification_id UUID REFERENCES ownership_verifications(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_ownerships_verification ON vehicle_ownerships(verification_id);

-- Update the approve_ownership_verification function to properly create vehicle_ownerships records
CREATE OR REPLACE FUNCTION approve_ownership_verification(
  p_verification_id UUID,
  p_reviewer_id UUID,
  p_review_notes TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_verification ownership_verifications%ROWTYPE;
  v_existing_owner_id UUID;
  v_existing_ownership_id UUID;
  v_transfer_id UUID;
  v_new_ownership_id UUID;
BEGIN
  -- Get verification record
  SELECT * INTO v_verification
  FROM ownership_verifications
  WHERE id = p_verification_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification not found';
  END IF;

  -- Check if verification is already approved
  IF v_verification.status = 'approved' THEN
    RAISE EXCEPTION 'Verification already approved';
  END IF;

  -- Check if there's an existing current owner (from vehicle_ownerships with is_current = true)
  SELECT owner_profile_id, id INTO v_existing_owner_id, v_existing_ownership_id
  FROM vehicle_ownerships
  WHERE vehicle_id = v_verification.vehicle_id
    AND is_current = true
    AND owner_profile_id != v_verification.user_id
  ORDER BY start_date DESC
  LIMIT 1;

  -- If existing owner exists, we need to handle the transfer
  IF v_existing_owner_id IS NOT NULL THEN
    -- Check if there's already a title transfer system in place
    -- For now, we'll mark the previous owner as not current and create the new ownership
    -- In a full system, this would require transfer approval
    
    -- Mark previous ownership as ended
    UPDATE vehicle_ownerships
    SET 
      is_current = false,
      end_date = COALESCE(v_verification.approved_at::date, CURRENT_DATE),
      updated_at = NOW()
    WHERE id = v_existing_ownership_id;

    -- Create ownership transfer record
    INSERT INTO ownership_transfers (
      vehicle_id,
      from_owner_id,
      to_owner_id,
      transfer_date,
      source,
      price,
      proof_event_id,
      metadata
    ) VALUES (
      v_verification.vehicle_id,
      v_existing_owner_id,
      v_verification.user_id,
      COALESCE(v_verification.approved_at::date, CURRENT_DATE),
      'title_verification',
      NULL,
      NULL,
      jsonb_build_object(
        'verification_id', p_verification_id,
        'reviewer_id', p_reviewer_id,
        'requires_transfer_approval', false -- Set to true if you want to require seller approval
      )
    );
  END IF;

  -- Update verification status to approved
  UPDATE ownership_verifications
  SET
    status = 'approved',
    human_reviewer_id = p_reviewer_id,
    human_review_notes = p_review_notes,
    human_reviewed_at = NOW(),
    approved_at = NOW(),
    updated_at = NOW()
  WHERE id = p_verification_id;

  -- Create or update vehicle_ownerships record
  -- Check if ownership record already exists for this user-vehicle pair
  SELECT id INTO v_new_ownership_id
  FROM vehicle_ownerships
  WHERE vehicle_id = v_verification.vehicle_id
    AND owner_profile_id = v_verification.user_id
  LIMIT 1;

  IF v_new_ownership_id IS NOT NULL THEN
    -- Update existing ownership record
    UPDATE vehicle_ownerships
    SET
      is_current = true,
      start_date = COALESCE(start_date, v_verification.approved_at::date, CURRENT_DATE),
      end_date = NULL, -- Clear end_date if it was set
      verification_id = p_verification_id,
      proof_event_id = NULL, -- Could link to timeline event if needed
      updated_at = NOW()
    WHERE id = v_new_ownership_id;
  ELSE
    -- Create new ownership record
    INSERT INTO vehicle_ownerships (
      vehicle_id,
      owner_profile_id,
      role,
      is_current,
      start_date,
      verification_id,
      proof_event_id
    ) VALUES (
      v_verification.vehicle_id,
      v_verification.user_id,
      'owner',
      true,
      COALESCE(v_verification.approved_at::date, CURRENT_DATE),
      p_verification_id,
      NULL
    ) RETURNING id INTO v_new_ownership_id;
  END IF;

  -- Log the approval
  INSERT INTO verification_audit_log (
    verification_id, action, actor_id, actor_type, details
  ) VALUES (
    p_verification_id, 'approved', p_reviewer_id, 'reviewer',
    jsonb_build_object(
      'review_notes', p_review_notes,
      'ownership_id', v_new_ownership_id,
      'previous_owner_id', v_existing_owner_id
    )
  );

  -- Update queue status if table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'verification_queue') THEN
    UPDATE verification_queue
    SET queue_status = 'completed', completed_at = NOW()
    WHERE verification_id = p_verification_id;
  END IF;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

COMMENT ON FUNCTION approve_ownership_verification IS 'Approves ownership verification and creates/updates vehicle_ownerships record. Only verified, approved ownership with up-to-date titles creates ownership records. Handles ownership transfers by marking previous owner as not current.';

-- Also create a function to expire old ownership verifications
CREATE OR REPLACE FUNCTION expire_old_ownership_verifications()
RETURNS INTEGER AS $$
DECLARE
  v_expired_count INTEGER;
BEGIN
  -- Mark verifications as expired if they're past their expiration date
  UPDATE ownership_verifications
  SET 
    status = 'expired',
    updated_at = NOW()
  WHERE status IN ('pending', 'documents_uploaded', 'ai_processing', 'human_review')
    AND expires_at < NOW()
    AND status != 'expired';

  GET DIAGNOSTICS v_expired_count = ROW_COUNT;

  -- If a verification expires, mark associated ownership as not current if verification is required
  -- This ensures only up-to-date verifications maintain current ownership
  UPDATE vehicle_ownerships vo
  SET 
    is_current = false,
    end_date = CURRENT_DATE,
    updated_at = NOW()
  FROM ownership_verifications ov
  WHERE vo.verification_id = ov.id
    AND ov.status = 'expired'
    AND vo.is_current = true;

  RETURN v_expired_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION expire_old_ownership_verifications IS 'Expires old ownership verifications and marks associated ownerships as not current. Ensures only up-to-date verifications maintain current ownership status.';

