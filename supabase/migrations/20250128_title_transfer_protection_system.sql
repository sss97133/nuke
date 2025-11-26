-- Title Transfer Protection & Auto-Generated Paperwork System
-- Purpose: Protect title ownership, auto-generate transfer documents, allow disputes

-- Table to track title transfers
CREATE TABLE IF NOT EXISTS title_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Transfer parties
  from_user_id UUID REFERENCES auth.users(id), -- Previous owner (can be NULL if unknown)
  to_user_id UUID NOT NULL REFERENCES auth.users(id), -- New owner
  
  -- Transfer status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',           -- Transfer initiated, waiting for approval
    'approved_by_seller', -- Previous owner approved
    'disputed',          -- Previous owner denied/disputed
    'completed',         -- Transfer completed, paperwork generated
    'cancelled'          -- Transfer cancelled
  )),
  
  -- Transfer documents (auto-generated)
  bill_of_sale_url TEXT,
  title_transfer_form_url TEXT,
  odometer_statement_url TEXT,
  transfer_agreement_url TEXT,
  generated_documents JSONB DEFAULT '{}',
  
  -- Transfer details
  transfer_date DATE,
  sale_price DECIMAL(10,2),
  transfer_type TEXT CHECK (transfer_type IN ('sale', 'gift', 'trade', 'inheritance', 'other')),
  transfer_notes TEXT,
  
  -- Approval/dispute
  seller_approval_required BOOLEAN DEFAULT true,
  seller_approved_at TIMESTAMPTZ,
  seller_disputed_at TIMESTAMPTZ,
  dispute_reason TEXT,
  
  -- Verification
  from_verification_id UUID REFERENCES ownership_verifications(id), -- Previous owner's verification
  to_verification_id UUID NOT NULL REFERENCES ownership_verifications(id), -- New owner's verification
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(vehicle_id, to_user_id, status) WHERE status IN ('pending', 'approved_by_seller', 'disputed')
);

CREATE INDEX IF NOT EXISTS idx_title_transfers_vehicle ON title_transfers(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_title_transfers_from_user ON title_transfers(from_user_id);
CREATE INDEX IF NOT EXISTS idx_title_transfers_to_user ON title_transfers(to_user_id);
CREATE INDEX IF NOT EXISTS idx_title_transfers_status ON title_transfers(status);

-- Table to track title ownership disputes
CREATE TABLE IF NOT EXISTS title_ownership_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  
  -- Dispute parties
  current_owner_id UUID REFERENCES auth.users(id), -- Person who currently has title
  claimant_id UUID NOT NULL REFERENCES auth.users(id), -- Person claiming title
  
  -- Dispute details
  dispute_type TEXT NOT NULL CHECK (dispute_type IN (
    'fraudulent_claim',      -- Current owner says claim is fraudulent
    'duplicate_title',        -- Multiple people claim ownership
    'stolen_vehicle',         -- Vehicle reported stolen
    'title_error',            -- Title document error
    'other'
  )),
  dispute_reason TEXT NOT NULL,
  supporting_evidence JSONB DEFAULT '{}',
  
  -- Dispute status
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open',           -- Dispute filed, under review
    'under_review',   -- Admin/reviewer investigating
    'resolved',       -- Dispute resolved
    'dismissed'       -- Dispute dismissed
  )),
  
  -- Resolution
  resolved_by_user_id UUID REFERENCES auth.users(id),
  resolution_notes TEXT,
  resolution_date TIMESTAMPTZ,
  
  -- Related verifications
  current_owner_verification_id UUID REFERENCES ownership_verifications(id),
  claimant_verification_id UUID REFERENCES ownership_verifications(id),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_title_disputes_vehicle ON title_ownership_disputes(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_title_disputes_status ON title_ownership_disputes(status);

-- Function to detect title ownership change and create transfer
CREATE OR REPLACE FUNCTION detect_and_create_title_transfer(
  p_vehicle_id UUID,
  p_new_owner_id UUID,
  p_new_verification_id UUID
)
RETURNS UUID AS $$
DECLARE
  v_previous_owner_id UUID;
  v_previous_verification_id UUID;
  v_transfer_id UUID;
BEGIN
  -- Find previous owner (most recent approved verification)
  SELECT user_id, id INTO v_previous_owner_id, v_previous_verification_id
  FROM ownership_verifications
  WHERE vehicle_id = p_vehicle_id
    AND user_id != p_new_owner_id
    AND status = 'approved'
  ORDER BY approved_at DESC
  LIMIT 1;
  
  -- If previous owner exists, create transfer record
  IF v_previous_owner_id IS NOT NULL THEN
    INSERT INTO title_transfers (
      vehicle_id,
      from_user_id,
      to_user_id,
      from_verification_id,
      to_verification_id,
      status,
      seller_approval_required,
      transfer_date
    ) VALUES (
      p_vehicle_id,
      v_previous_owner_id,
      p_new_owner_id,
      v_previous_verification_id,
      p_new_verification_id,
      'pending',
      true,
      CURRENT_DATE
    ) RETURNING id INTO v_transfer_id;
    
    -- Notify previous owner (via notification system if exists)
    -- This would trigger a notification to the previous owner
    
    RETURN v_transfer_id;
  END IF;
  
  -- No previous owner, transfer is automatic
  INSERT INTO title_transfers (
    vehicle_id,
    from_user_id,
    to_user_id,
    to_verification_id,
    status,
    seller_approval_required,
    transfer_date
  ) VALUES (
    p_vehicle_id,
    NULL,
    p_new_owner_id,
    p_new_verification_id,
    'completed',
    false,
    CURRENT_DATE
  ) RETURNING id INTO v_transfer_id;
  
  -- Auto-generate paperwork since no approval needed
  PERFORM generate_transfer_paperwork(v_transfer_id);
  
  RETURN v_transfer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- Function to generate transfer paperwork
CREATE OR REPLACE FUNCTION generate_transfer_paperwork(p_transfer_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_transfer RECORD;
  v_vehicle RECORD;
  v_from_user RECORD;
  v_to_user RECORD;
  v_documents JSONB;
BEGIN
  -- Get transfer details
  SELECT * INTO v_transfer FROM title_transfers WHERE id = p_transfer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer not found';
  END IF;
  
  -- Get vehicle details
  SELECT * INTO v_vehicle FROM vehicles WHERE id = v_transfer.vehicle_id;
  
  -- Get user details
  SELECT * INTO v_from_user FROM profiles WHERE id = v_transfer.from_user_id;
  SELECT * INTO v_to_user FROM profiles WHERE id = v_transfer.to_user_id;
  
  -- Generate documents (this would call a document generation service)
  -- For now, we'll create placeholder document records
  v_documents := jsonb_build_object(
    'bill_of_sale', jsonb_build_object(
      'document_type', 'bill_of_sale',
      'vehicle_vin', v_vehicle.vin,
      'vehicle_year', v_vehicle.year,
      'vehicle_make', v_vehicle.make,
      'vehicle_model', v_vehicle.model,
      'seller_name', COALESCE(v_from_user.full_name, 'Unknown'),
      'buyer_name', v_to_user.full_name,
      'transfer_date', v_transfer.transfer_date,
      'sale_price', v_transfer.sale_price,
      'generated_at', NOW()
    ),
    'title_transfer_form', jsonb_build_object(
      'document_type', 'title_transfer_form',
      'vehicle_vin', v_vehicle.vin,
      'from_owner', COALESCE(v_from_user.full_name, 'Unknown'),
      'to_owner', v_to_user.full_name,
      'transfer_date', v_transfer.transfer_date,
      'odometer_reading', v_vehicle.mileage,
      'generated_at', NOW()
    ),
    'odometer_statement', jsonb_build_object(
      'document_type', 'odometer_statement',
      'vehicle_vin', v_vehicle.vin,
      'odometer_reading', v_vehicle.mileage,
      'statement_date', v_transfer.transfer_date,
      'generated_at', NOW()
    )
  );
  
  -- Update transfer with generated documents
  UPDATE title_transfers
  SET 
    generated_documents = v_documents,
    updated_at = NOW()
  WHERE id = p_transfer_id;
  
  RETURN v_documents;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- Function for previous owner to approve transfer
CREATE OR REPLACE FUNCTION approve_title_transfer(
  p_transfer_id UUID,
  p_seller_user_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_transfer RECORD;
BEGIN
  -- Get transfer
  SELECT * INTO v_transfer FROM title_transfers WHERE id = p_transfer_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Transfer not found');
  END IF;
  
  -- Verify seller is the from_user
  IF v_transfer.from_user_id != p_seller_user_id THEN
    RETURN jsonb_build_object('error', 'Unauthorized - you are not the seller');
  END IF;
  
  -- Update transfer status
  UPDATE title_transfers
  SET 
    status = 'approved_by_seller',
    seller_approved_at = NOW(),
    updated_at = NOW()
  WHERE id = p_transfer_id;
  
  -- Generate paperwork now that approved
  PERFORM generate_transfer_paperwork(p_transfer_id);
  
  -- Update transfer to completed
  UPDATE title_transfers
  SET status = 'completed'
  WHERE id = p_transfer_id;
  
  -- Now approve the new owner's verification
  UPDATE ownership_verifications
  SET 
    status = 'approved',
    approved_at = NOW(),
    human_review_notes = format('Approved via title transfer (transfer_id: %s)', p_transfer_id),
    updated_at = NOW()
  WHERE id = v_transfer.to_verification_id;
  
  -- Update vehicle ownership to new owner
  UPDATE vehicles
  SET 
    user_id = v_transfer.to_user_id,
    ownership_verified = true,
    ownership_verified_at = NOW(),
    ownership_verification_id = v_transfer.to_verification_id
  WHERE id = v_transfer.vehicle_id;
  
  RETURN jsonb_build_object('success', true, 'transfer_id', p_transfer_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- Function for previous owner to dispute/deny transfer
CREATE OR REPLACE FUNCTION dispute_title_transfer(
  p_transfer_id UUID,
  p_seller_user_id UUID,
  p_dispute_reason TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_transfer RECORD;
  v_dispute_id UUID;
BEGIN
  -- Get transfer
  SELECT * INTO v_transfer FROM title_transfers WHERE id = p_transfer_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Transfer not found');
  END IF;
  
  -- Verify seller is the from_user
  IF v_transfer.from_user_id != p_seller_user_id THEN
    RETURN jsonb_build_object('error', 'Unauthorized - you are not the seller');
  END IF;
  
  -- Update transfer status
  UPDATE title_transfers
  SET 
    status = 'disputed',
    seller_disputed_at = NOW(),
    dispute_reason = p_dispute_reason,
    updated_at = NOW()
  WHERE id = p_transfer_id;
  
  -- Create dispute record
  INSERT INTO title_ownership_disputes (
    vehicle_id,
    current_owner_id,
    claimant_id,
    dispute_type,
    dispute_reason,
    current_owner_verification_id,
    claimant_verification_id,
    status
  ) VALUES (
    v_transfer.vehicle_id,
    v_transfer.from_user_id,
    v_transfer.to_user_id,
    'fraudulent_claim',
    p_dispute_reason,
    v_transfer.from_verification_id,
    v_transfer.to_verification_id,
    'open'
  ) RETURNING id INTO v_dispute_id;
  
  -- Reject the new owner's verification
  UPDATE ownership_verifications
  SET 
    status = 'rejected',
    rejection_reason = format('Disputed by previous owner: %s', p_dispute_reason),
    reviewed_at = NOW()
  WHERE id = v_transfer.to_verification_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'transfer_id', p_transfer_id,
    'dispute_id', v_dispute_id,
    'message', 'Transfer disputed. The claim has been rejected and requires review.'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- Trigger to detect new title ownership and create transfer
CREATE OR REPLACE FUNCTION trigger_detect_title_transfer()
RETURNS TRIGGER AS $$
BEGIN
  -- When a new ownership verification is approved
  IF NEW.status = 'approved' AND (OLD.status IS NULL OR OLD.status != 'approved') THEN
    -- Check if there's a previous owner
    IF EXISTS (
      SELECT 1 FROM ownership_verifications
      WHERE vehicle_id = NEW.vehicle_id
        AND user_id != NEW.user_id
        AND status = 'approved'
        AND id != NEW.id
    ) THEN
      -- Create transfer record
      PERFORM detect_and_create_title_transfer(NEW.vehicle_id, NEW.user_id, NEW.id);
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER detect_title_transfer_trigger
  AFTER INSERT OR UPDATE ON ownership_verifications
  FOR EACH ROW
  WHEN (NEW.status = 'approved')
  EXECUTE FUNCTION trigger_detect_title_transfer();

-- RLS Policies
ALTER TABLE title_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view transfers they're involved in"
  ON title_transfers
  FOR SELECT
  USING (from_user_id = auth.uid() OR to_user_id = auth.uid());

CREATE POLICY "Users can approve their own transfers"
  ON title_transfers
  FOR UPDATE
  USING (from_user_id = auth.uid())
  WITH CHECK (from_user_id = auth.uid());

ALTER TABLE title_ownership_disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view disputes they're involved in"
  ON title_ownership_disputes
  FOR SELECT
  USING (current_owner_id = auth.uid() OR claimant_id = auth.uid());

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION detect_and_create_title_transfer(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION generate_transfer_paperwork(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_title_transfer(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION dispute_title_transfer(UUID, UUID, TEXT) TO authenticated;

COMMENT ON TABLE title_transfers IS 'Tracks title ownership transfers with auto-generated paperwork and seller approval';
COMMENT ON TABLE title_ownership_disputes IS 'Tracks disputes when someone claims title ownership of a vehicle already owned by someone else';
COMMENT ON FUNCTION detect_and_create_title_transfer IS 'Detects when title ownership changes and creates transfer record requiring seller approval';
COMMENT ON FUNCTION generate_transfer_paperwork IS 'Auto-generates all necessary transfer documents (bill of sale, title transfer form, odometer statement)';
COMMENT ON FUNCTION approve_title_transfer IS 'Allows previous owner to approve title transfer';
COMMENT ON FUNCTION dispute_title_transfer IS 'Allows previous owner to dispute/deny fraudulent title claims';

