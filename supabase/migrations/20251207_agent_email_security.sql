-- ============================================
-- AGENT EMAIL SYSTEM SECURITY HARDENING
-- Lock down ownership verification tables with RLS
-- Add secure RPCs for submitting and approving ownership claims
-- ============================================

-- Enable RLS on ownership-related tables
ALTER TABLE ownership_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE fraud_detection_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_ownership_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_verifications ENABLE ROW LEVEL SECURITY;

-- Helper: check if current user is an active reviewer
CREATE OR REPLACE FUNCTION is_active_reviewer(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM verification_reviewers vr
    WHERE vr.user_id = p_user_id
      AND vr.is_active = TRUE
  );
$$;

-- ownership_verifications policies
DROP POLICY IF EXISTS "ov select owner or reviewer" ON ownership_verifications;
CREATE POLICY "ov select owner or reviewer" ON ownership_verifications
FOR SELECT USING (
  auth.role() = 'service_role'
  OR auth.uid() = user_id
  OR is_active_reviewer(auth.uid())
);

DROP POLICY IF EXISTS "ov insert self" ON ownership_verifications;
CREATE POLICY "ov insert self" ON ownership_verifications
FOR INSERT WITH CHECK (
  auth.role() = 'service_role'
  OR auth.uid() = user_id
);

DROP POLICY IF EXISTS "ov update self pending" ON ownership_verifications;
CREATE POLICY "ov update self pending" ON ownership_verifications
FOR UPDATE USING (
  auth.role() = 'service_role'
  OR (
    auth.uid() = user_id
    AND status IN ('pending', 'documents_uploaded')
  )
)
WITH CHECK (
  auth.role() = 'service_role'
  OR (
    auth.uid() = user_id
    AND status IN ('pending', 'documents_uploaded')
  )
);

DROP POLICY IF EXISTS "ov update reviewer" ON ownership_verifications;
CREATE POLICY "ov update reviewer" ON ownership_verifications
FOR UPDATE USING (
  auth.role() = 'service_role' OR is_active_reviewer(auth.uid())
)
WITH CHECK (
  auth.role() = 'service_role' OR is_active_reviewer(auth.uid())
);

-- verification_audit_log policies
DROP POLICY IF EXISTS "val select scoped" ON verification_audit_log;
CREATE POLICY "val select scoped" ON verification_audit_log
FOR SELECT USING (
  auth.role() = 'service_role'
  OR is_active_reviewer(auth.uid())
  OR EXISTS (
    SELECT 1 FROM ownership_verifications ov
    WHERE ov.id = verification_audit_log.verification_id
      AND ov.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "val insert service" ON verification_audit_log;
CREATE POLICY "val insert service" ON verification_audit_log
FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- verification_queue policies
DROP POLICY IF EXISTS "vq select assigned or service" ON verification_queue;
CREATE POLICY "vq select assigned or service" ON verification_queue
FOR SELECT USING (
  auth.role() = 'service_role'
  OR EXISTS (
    SELECT 1 FROM verification_reviewers vr
    WHERE vr.id = verification_queue.assigned_reviewer_id
      AND vr.user_id = auth.uid()
      AND vr.is_active = TRUE
  )
  OR is_active_reviewer(auth.uid())
);

DROP POLICY IF EXISTS "vq insert service" ON verification_queue;
CREATE POLICY "vq insert service" ON verification_queue
FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "vq update service" ON verification_queue;
CREATE POLICY "vq update service" ON verification_queue
FOR UPDATE USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- fraud_detection_patterns policies
DROP POLICY IF EXISTS "fdp select reviewer" ON fraud_detection_patterns;
CREATE POLICY "fdp select reviewer" ON fraud_detection_patterns
FOR SELECT USING (
  auth.role() = 'service_role' OR is_active_reviewer(auth.uid())
);

DROP POLICY IF EXISTS "fdp write service" ON fraud_detection_patterns;
CREATE POLICY "fdp write service" ON fraud_detection_patterns
FOR ALL USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- organization_ownership_verifications policies
DROP POLICY IF EXISTS "oov select requester or reviewer" ON organization_ownership_verifications;
CREATE POLICY "oov select requester or reviewer" ON organization_ownership_verifications
FOR SELECT USING (
  auth.role() = 'service_role'
  OR user_id = auth.uid()
  OR is_active_reviewer(auth.uid())
);

DROP POLICY IF EXISTS "oov insert self" ON organization_ownership_verifications;
CREATE POLICY "oov insert self" ON organization_ownership_verifications
FOR INSERT WITH CHECK (
  auth.role() = 'service_role'
  OR user_id = auth.uid()
);

DROP POLICY IF EXISTS "oov update requester pending" ON organization_ownership_verifications;
CREATE POLICY "oov update requester pending" ON organization_ownership_verifications
FOR UPDATE USING (
  auth.role() = 'service_role'
  OR (
    user_id = auth.uid()
    AND status IN ('pending', 'documents_uploaded')
  )
)
WITH CHECK (
  auth.role() = 'service_role'
  OR (
    user_id = auth.uid()
    AND status IN ('pending', 'documents_uploaded')
  )
);

DROP POLICY IF EXISTS "oov update reviewer" ON organization_ownership_verifications;
CREATE POLICY "oov update reviewer" ON organization_ownership_verifications
FOR UPDATE USING (
  auth.role() = 'service_role' OR is_active_reviewer(auth.uid())
)
WITH CHECK (
  auth.role() = 'service_role' OR is_active_reviewer(auth.uid())
);

-- user_verifications policies
DROP POLICY IF EXISTS "uv select self" ON user_verifications;
CREATE POLICY "uv select self" ON user_verifications
FOR SELECT USING (
  auth.role() = 'service_role' OR user_id = auth.uid()
);

DROP POLICY IF EXISTS "uv insert self" ON user_verifications;
CREATE POLICY "uv insert self" ON user_verifications
FOR INSERT WITH CHECK (
  auth.role() = 'service_role' OR user_id = auth.uid()
);

DROP POLICY IF EXISTS "uv update self" ON user_verifications;
CREATE POLICY "uv update self" ON user_verifications
FOR UPDATE USING (
  auth.role() = 'service_role' OR user_id = auth.uid()
)
WITH CHECK (
  auth.role() = 'service_role' OR user_id = auth.uid()
);

-- ============================================
-- RPC: Submit Ownership Claim (user-scoped)
-- ============================================
CREATE OR REPLACE FUNCTION submit_ownership_claim(
  p_vehicle_id UUID,
  p_title_document_url TEXT,
  p_drivers_license_url TEXT,
  p_vehicle_vin TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_claim_id UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Prevent duplicate approved claims
  IF EXISTS (
    SELECT 1 FROM ownership_verifications ov
    WHERE ov.vehicle_id = p_vehicle_id
      AND ov.status = 'approved'
  ) THEN
    RAISE EXCEPTION 'Vehicle already has an approved ownership verification';
  END IF;

  INSERT INTO ownership_verifications (
    user_id,
    vehicle_id,
    status,
    title_document_url,
    drivers_license_url,
    vehicle_vin_from_title,
    submitted_at
  ) VALUES (
    v_uid,
    p_vehicle_id,
    'documents_uploaded',
    p_title_document_url,
    p_drivers_license_url,
    p_vehicle_vin,
    NOW()
  ) RETURNING id INTO v_claim_id;

  INSERT INTO verification_audit_log (
    verification_id,
    action,
    actor_id,
    actor_type,
    details
  ) VALUES (
    v_claim_id,
    'submitted',
    v_uid,
    'user',
    jsonb_build_object('vehicle_id', p_vehicle_id)
  );

  RETURN v_claim_id;
END;
$$;

-- ============================================
-- RPC: Approve / Reject Ownership Claim (reviewer / service role)
-- ============================================
CREATE OR REPLACE FUNCTION approve_ownership_claim(
  p_verification_id UUID,
  p_approve BOOLEAN,
  p_rejection_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_is_reviewer BOOLEAN;
  v_verif ownership_verifications;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_is_reviewer := is_active_reviewer(v_uid);

  IF NOT (auth.role() = 'service_role' OR v_is_reviewer) THEN
    RAISE EXCEPTION 'Not authorized to approve/reject claims';
  END IF;

  SELECT * INTO v_verif FROM ownership_verifications WHERE id = p_verification_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verification not found';
  END IF;

  IF v_verif.status = 'approved' THEN
    RAISE EXCEPTION 'Claim already approved';
  END IF;

  IF p_approve THEN
    UPDATE ownership_verifications
    SET status = 'approved',
        human_reviewer_id = v_uid,
        rejection_reason = NULL,
        approved_at = NOW(),
        updated_at = NOW()
    WHERE id = p_verification_id;

    -- Assign ownership to user; rely on service role / security definer to bypass RLS
    UPDATE vehicles
    SET user_id = v_verif.user_id,
        ownership_verified = TRUE,
        ownership_verified_at = NOW()
    WHERE id = v_verif.vehicle_id;

    INSERT INTO verification_audit_log (
      verification_id,
      action,
      actor_id,
      actor_type,
      details
    ) VALUES (
      p_verification_id,
      'approved',
      v_uid,
      CASE WHEN auth.role() = 'service_role' THEN 'system' ELSE 'reviewer' END,
      jsonb_build_object('vehicle_id', v_verif.vehicle_id)
    );

    RETURN jsonb_build_object(
      'status', 'approved',
      'vehicle_id', v_verif.vehicle_id,
      'user_id', v_verif.user_id
    );
  ELSE
    UPDATE ownership_verifications
    SET status = 'rejected',
        human_reviewer_id = v_uid,
        rejection_reason = COALESCE(p_rejection_reason, 'Rejected'),
        rejected_at = NOW(),
        updated_at = NOW()
    WHERE id = p_verification_id;

    INSERT INTO verification_audit_log (
      verification_id,
      action,
      actor_id,
      actor_type,
      details
    ) VALUES (
      p_verification_id,
      'rejected',
      v_uid,
      CASE WHEN auth.role() = 'service_role' THEN 'system' ELSE 'reviewer' END,
      jsonb_build_object(
        'vehicle_id', v_verif.vehicle_id,
        'reason', p_rejection_reason
      )
    );

    RETURN jsonb_build_object(
      'status', 'rejected',
      'vehicle_id', v_verif.vehicle_id,
      'user_id', v_verif.user_id,
      'reason', p_rejection_reason
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION submit_ownership_claim IS 'User-scoped submission of an ownership verification claim with required documents.';
COMMENT ON FUNCTION approve_ownership_claim IS 'Reviewer/service role approval or rejection of an ownership verification; assigns vehicle ownership on approval.';


