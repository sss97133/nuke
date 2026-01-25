-- Compliance Audit Trail
-- Immutable audit log for SEC examination
-- Part of Phase 4: Institutional-Grade Financial Infrastructure

-- Create function to prevent modifications first
CREATE OR REPLACE FUNCTION prevent_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Modifications to audit log are not permitted. This table is immutable for regulatory compliance.';
  RETURN NULL;
END;
$$;

-- Compliance audit log - immutable record of all compliance-related actions
CREATE TABLE IF NOT EXISTS compliance_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Action details
  action_type TEXT NOT NULL CHECK (action_type IN (
    -- Subscription lifecycle
    'subscription_initiated',
    'subscription_signed',
    'subscription_funded',
    'subscription_accepted',
    'subscription_rejected',
    'subscription_cancelled',
    'shares_issued',

    -- KYC/AML
    'kyc_started',
    'kyc_document_uploaded',
    'kyc_approved',
    'kyc_rejected',
    'aml_check_started',
    'aml_check_passed',
    'aml_check_failed',
    'aml_review_required',

    -- Accreditation
    'accreditation_submitted',
    'accreditation_verified',
    'accreditation_expired',
    'accreditation_revoked',

    -- Disclosures
    'disclosure_acknowledged',
    'disclosure_version_updated',

    -- Offering lifecycle
    'offering_created',
    'offering_submitted_to_sec',
    'offering_qualified',
    'offering_opened',
    'offering_closed',
    'offering_suspended',

    -- Entity management
    'entity_created',
    'entity_status_changed',
    'entity_dissolved',

    -- Trading
    'trade_executed',
    'trade_cancelled',
    'dividend_declared',
    'dividend_paid',

    -- Administrative
    'user_role_changed',
    'config_changed',
    'manual_override',
    'compliance_review',
    'suspicious_activity_flagged'
  )),

  -- Who performed the action
  user_id UUID REFERENCES auth.users(id),
  performed_by_user_id UUID REFERENCES auth.users(id), -- For admin actions on behalf of user

  -- What was affected
  entity_type TEXT CHECK (entity_type IN (
    'subscription', 'offering', 'user', 'entity', 'accreditation',
    'disclosure', 'trade', 'kyc', 'aml', 'config'
  )),
  entity_id UUID,
  offering_id UUID REFERENCES reg_a_offerings(id),

  -- State change
  previous_state JSONB,
  new_state JSONB,
  action_description TEXT,

  -- Additional context
  related_document_url TEXT,
  related_transaction_id UUID,

  -- Request context
  ip_address INET,
  user_agent TEXT,
  session_id TEXT,
  request_id TEXT,

  -- Checksum for tamper detection (SHA-256)
  checksum TEXT NOT NULL,
  previous_log_checksum TEXT, -- Chain to previous entry

  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Additional metadata
  metadata JSONB DEFAULT '{}'
);

-- Indexes for audit log queries
CREATE INDEX IF NOT EXISTS idx_audit_log_action_type ON compliance_audit_log(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON compliance_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON compliance_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_offering ON compliance_audit_log(offering_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON compliance_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_checksum ON compliance_audit_log(checksum);

-- Prevent updates to audit log
DROP TRIGGER IF EXISTS prevent_audit_update ON compliance_audit_log;
CREATE TRIGGER prevent_audit_update
  BEFORE UPDATE ON compliance_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_modification();

-- Prevent deletes from audit log
DROP TRIGGER IF EXISTS prevent_audit_delete ON compliance_audit_log;
CREATE TRIGGER prevent_audit_delete
  BEFORE DELETE ON compliance_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_modification();

-- RLS - only admins can read, system can insert
ALTER TABLE compliance_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_log_admin_read" ON compliance_audit_log
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND user_type = 'admin')
  );

-- Function to create audit log entry with checksum
CREATE OR REPLACE FUNCTION create_audit_log_entry(
  p_action_type TEXT,
  p_user_id UUID DEFAULT NULL,
  p_performed_by UUID DEFAULT NULL,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id UUID DEFAULT NULL,
  p_offering_id UUID DEFAULT NULL,
  p_previous_state JSONB DEFAULT NULL,
  p_new_state JSONB DEFAULT NULL,
  p_action_description TEXT DEFAULT NULL,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_entry_id UUID;
  v_previous_checksum TEXT;
  v_new_checksum TEXT;
  v_checksum_input TEXT;
  v_timestamp TIMESTAMPTZ := NOW();
BEGIN
  -- Get the previous entry's checksum for chaining
  SELECT checksum INTO v_previous_checksum
  FROM compliance_audit_log
  ORDER BY created_at DESC
  LIMIT 1;

  -- Create checksum input: timestamp + action + entities + previous checksum
  v_checksum_input := CONCAT(
    v_timestamp::TEXT,
    '|', p_action_type,
    '|', COALESCE(p_user_id::TEXT, 'null'),
    '|', COALESCE(p_entity_type, 'null'),
    '|', COALESCE(p_entity_id::TEXT, 'null'),
    '|', COALESCE(p_offering_id::TEXT, 'null'),
    '|', COALESCE(p_new_state::TEXT, 'null'),
    '|', COALESCE(v_previous_checksum, 'genesis')
  );

  -- Calculate SHA-256 checksum
  v_new_checksum := encode(digest(v_checksum_input, 'sha256'), 'hex');

  -- Insert the audit log entry
  INSERT INTO compliance_audit_log (
    action_type,
    user_id,
    performed_by_user_id,
    entity_type,
    entity_id,
    offering_id,
    previous_state,
    new_state,
    action_description,
    ip_address,
    user_agent,
    checksum,
    previous_log_checksum,
    metadata,
    created_at
  ) VALUES (
    p_action_type,
    p_user_id,
    COALESCE(p_performed_by, auth.uid()),
    p_entity_type,
    p_entity_id,
    p_offering_id,
    p_previous_state,
    p_new_state,
    p_action_description,
    p_ip_address,
    p_user_agent,
    v_new_checksum,
    v_previous_checksum,
    p_metadata,
    v_timestamp
  ) RETURNING id INTO v_entry_id;

  RETURN v_entry_id;
END;
$$;

-- Function to verify audit log integrity
CREATE OR REPLACE FUNCTION verify_audit_log_integrity(
  p_start_date TIMESTAMPTZ DEFAULT NULL,
  p_end_date TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  total_entries BIGINT,
  verified_entries BIGINT,
  failed_entries BIGINT,
  chain_breaks BIGINT,
  first_entry_date TIMESTAMPTZ,
  last_entry_date TIMESTAMPTZ,
  is_valid BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_entry RECORD;
  v_prev_checksum TEXT := NULL;
  v_expected_checksum TEXT;
  v_checksum_input TEXT;
  v_total BIGINT := 0;
  v_verified BIGINT := 0;
  v_failed BIGINT := 0;
  v_chain_breaks BIGINT := 0;
  v_first_date TIMESTAMPTZ;
  v_last_date TIMESTAMPTZ;
BEGIN
  FOR v_entry IN
    SELECT *
    FROM compliance_audit_log
    WHERE (p_start_date IS NULL OR created_at >= p_start_date)
    AND (p_end_date IS NULL OR created_at <= p_end_date)
    ORDER BY created_at ASC
  LOOP
    v_total := v_total + 1;

    IF v_first_date IS NULL THEN
      v_first_date := v_entry.created_at;
    END IF;
    v_last_date := v_entry.created_at;

    -- Check chain continuity
    IF v_prev_checksum IS NOT NULL AND v_entry.previous_log_checksum != v_prev_checksum THEN
      v_chain_breaks := v_chain_breaks + 1;
    END IF;

    -- Recalculate checksum
    v_checksum_input := CONCAT(
      v_entry.created_at::TEXT,
      '|', v_entry.action_type,
      '|', COALESCE(v_entry.user_id::TEXT, 'null'),
      '|', COALESCE(v_entry.entity_type, 'null'),
      '|', COALESCE(v_entry.entity_id::TEXT, 'null'),
      '|', COALESCE(v_entry.offering_id::TEXT, 'null'),
      '|', COALESCE(v_entry.new_state::TEXT, 'null'),
      '|', COALESCE(v_entry.previous_log_checksum, 'genesis')
    );

    v_expected_checksum := encode(digest(v_checksum_input, 'sha256'), 'hex');

    IF v_entry.checksum = v_expected_checksum THEN
      v_verified := v_verified + 1;
    ELSE
      v_failed := v_failed + 1;
    END IF;

    v_prev_checksum := v_entry.checksum;
  END LOOP;

  RETURN QUERY SELECT
    v_total,
    v_verified,
    v_failed,
    v_chain_breaks,
    v_first_date,
    v_last_date,
    v_failed = 0 AND v_chain_breaks = 0;
END;
$$;

-- Function to export audit log for compliance review
CREATE OR REPLACE FUNCTION export_audit_log(
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ,
  p_action_types TEXT[] DEFAULT NULL,
  p_offering_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Check admin access
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND user_type = 'admin'
  ) THEN
    RETURN jsonb_build_object('error', 'Unauthorized');
  END IF;

  SELECT jsonb_build_object(
    'export_timestamp', NOW(),
    'period_start', p_start_date,
    'period_end', p_end_date,
    'filter_action_types', p_action_types,
    'filter_offering_id', p_offering_id,
    'integrity_check', (SELECT row_to_json(v) FROM verify_audit_log_integrity(p_start_date, p_end_date) v),
    'entries', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', al.id,
          'created_at', al.created_at,
          'action_type', al.action_type,
          'user_id', al.user_id,
          'performed_by', al.performed_by_user_id,
          'entity_type', al.entity_type,
          'entity_id', al.entity_id,
          'offering_id', al.offering_id,
          'previous_state', al.previous_state,
          'new_state', al.new_state,
          'description', al.action_description,
          'ip_address', al.ip_address,
          'checksum', al.checksum,
          'previous_checksum', al.previous_log_checksum
        ) ORDER BY al.created_at
      ), '[]'::jsonb)
      FROM compliance_audit_log al
      WHERE al.created_at >= p_start_date
      AND al.created_at <= p_end_date
      AND (p_action_types IS NULL OR al.action_type = ANY(p_action_types))
      AND (p_offering_id IS NULL OR al.offering_id = p_offering_id)
    )
  ) INTO v_result;

  -- Log the export itself
  PERFORM create_audit_log_entry(
    'compliance_review',
    NULL,
    auth.uid(),
    'config',
    NULL,
    NULL,
    NULL,
    jsonb_build_object(
      'export_period', jsonb_build_object('start', p_start_date, 'end', p_end_date),
      'filters', jsonb_build_object('action_types', p_action_types, 'offering_id', p_offering_id)
    ),
    'Audit log exported for compliance review'
  );

  RETURN v_result;
END;
$$;

-- Triggers to automatically log compliance events

-- Log subscription status changes
CREATE OR REPLACE FUNCTION log_subscription_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM create_audit_log_entry(
      'subscription_initiated',
      NEW.user_id,
      NULL,
      'subscription',
      NEW.id,
      NEW.offering_id,
      NULL,
      to_jsonb(NEW),
      'Subscription initiated'
    );
  ELSIF TG_OP = 'UPDATE' AND OLD.status != NEW.status THEN
    PERFORM create_audit_log_entry(
      CASE NEW.status
        WHEN 'signed' THEN 'subscription_signed'
        WHEN 'funded' THEN 'subscription_funded'
        WHEN 'accepted' THEN 'subscription_accepted'
        WHEN 'rejected' THEN 'subscription_rejected'
        WHEN 'cancelled' THEN 'subscription_cancelled'
        WHEN 'completed' THEN 'shares_issued'
        ELSE 'subscription_initiated'
      END,
      NEW.user_id,
      NULL,
      'subscription',
      NEW.id,
      NEW.offering_id,
      to_jsonb(OLD),
      to_jsonb(NEW),
      format('Subscription status changed from %s to %s', OLD.status, NEW.status)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subscription_audit_trigger ON subscription_agreements;
CREATE TRIGGER subscription_audit_trigger
  AFTER INSERT OR UPDATE ON subscription_agreements
  FOR EACH ROW
  EXECUTE FUNCTION log_subscription_change();

-- Log accreditation changes
CREATE OR REPLACE FUNCTION log_accreditation_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM create_audit_log_entry(
      'accreditation_submitted',
      NEW.user_id,
      NULL,
      'accreditation',
      NEW.id,
      NULL,
      NULL,
      to_jsonb(NEW),
      'Accreditation submitted'
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.verified_at IS NULL AND NEW.verified_at IS NOT NULL THEN
      PERFORM create_audit_log_entry(
        'accreditation_verified',
        NEW.user_id,
        NULL,
        'accreditation',
        NEW.id,
        NULL,
        to_jsonb(OLD),
        to_jsonb(NEW),
        format('Accreditation verified as %s', NEW.accreditation_type)
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS accreditation_audit_trigger ON investor_accreditation;
CREATE TRIGGER accreditation_audit_trigger
  AFTER INSERT OR UPDATE ON investor_accreditation
  FOR EACH ROW
  EXECUTE FUNCTION log_accreditation_change();

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION create_audit_log_entry TO authenticated;
GRANT EXECUTE ON FUNCTION verify_audit_log_integrity TO authenticated;
GRANT EXECUTE ON FUNCTION export_audit_log TO authenticated;

-- Comments
COMMENT ON TABLE compliance_audit_log IS 'Immutable audit log for SEC compliance. Cannot be modified or deleted.';
COMMENT ON FUNCTION create_audit_log_entry IS 'Creates a new audit log entry with cryptographic checksum';
COMMENT ON FUNCTION verify_audit_log_integrity IS 'Verifies the integrity of the audit log chain';
COMMENT ON FUNCTION export_audit_log IS 'Exports audit log for compliance review';
