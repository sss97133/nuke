-- Fix critical bug in ownership verification approval function
-- The function was updating the wrong field and overwriting the uploader information

DROP FUNCTION IF EXISTS approve_ownership_verification(UUID, UUID, TEXT);

-- Updated approve_ownership_verification function that doesn't touch the vehicles table
CREATE OR REPLACE FUNCTION approve_ownership_verification(
  p_verification_id UUID,
  p_reviewer_id UUID,
  p_review_notes TEXT DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  verification_record ownership_verifications%ROWTYPE;
BEGIN
  -- Get verification record
  SELECT * INTO verification_record
  FROM ownership_verifications
  WHERE id = p_verification_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification not found';
  END IF;

  -- Update verification status only - DO NOT modify vehicles table
  UPDATE ownership_verifications
  SET
    status = 'approved',
    human_reviewer_id = p_reviewer_id,
    human_review_notes = p_review_notes,
    human_reviewed_at = NOW(),
    approved_at = NOW(),
    updated_at = NOW()
  WHERE id = p_verification_id;

  -- Log the approval
  INSERT INTO verification_audit_log (
    verification_id, action, actor_id, actor_type, details
  ) VALUES (
    p_verification_id, 'approved', p_reviewer_id, 'reviewer',
    jsonb_build_object('review_notes', p_review_notes)
  );

  -- Update queue status
  UPDATE verification_queue
  SET queue_status = 'completed', completed_at = NOW()
  WHERE verification_id = p_verification_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Comment explaining the fix
COMMENT ON FUNCTION approve_ownership_verification IS 'Fixed: Approves ownership verification without modifying vehicle uploader information. Ownership is determined by approved ownership_verifications records, not vehicle.user_id field.';