-- Extend shops with business verification fields and tables

-- 1) Extend documentation_type enum with business documents
ALTER TYPE documentation_type ADD VALUE IF NOT EXISTS 'ein_assignment_notice';
ALTER TYPE documentation_type ADD VALUE IF NOT EXISTS 'state_business_license';
ALTER TYPE documentation_type ADD VALUE IF NOT EXISTS 'articles_of_organization';
ALTER TYPE documentation_type ADD VALUE IF NOT EXISTS 'operating_agreement';
ALTER TYPE documentation_type ADD VALUE IF NOT EXISTS 'business_bank_statement';
ALTER TYPE documentation_type ADD VALUE IF NOT EXISTS 'dba_certificate';

-- 2) Add business types enum
CREATE TYPE business_entity_type AS ENUM (
  'sole_proprietorship',
  'llc',
  'corporation',
  's_corporation',
  'partnership',
  'nonprofit',
  'other'
);

-- 3) Add organization types enum (how they present publicly)
CREATE TYPE org_type AS ENUM (
  'shop',
  'dealer',
  'garage',
  'workshop',
  'builder',
  'detailer',
  'transporter',
  'photographer',
  'appraiser',
  'media',
  'club',
  'team',
  'operation',
  'custom'
);

-- 4) Add verification status enum
CREATE TYPE verification_status AS ENUM (
  'unverified',
  'pending',
  'verified',
  'rejected',
  'expired'
);

-- 5) Extend shops table with legal/verification fields
ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS display_name TEXT, -- How they want to be known publicly
  ADD COLUMN IF NOT EXISTS org_type org_type DEFAULT 'shop',
  ADD COLUMN IF NOT EXISTS legal_name TEXT,
  ADD COLUMN IF NOT EXISTS business_entity_type business_entity_type,
  ADD COLUMN IF NOT EXISTS verification_status verification_status DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS ein_last4 TEXT CHECK (ein_last4 IS NULL OR length(ein_last4) = 4),
  ADD COLUMN IF NOT EXISTS state_business_id TEXT,
  ADD COLUMN IF NOT EXISTS license_expiration_date DATE,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS services TEXT[], -- Array of service tags
  ADD COLUMN IF NOT EXISTS specialties TEXT[], -- Array of specialty tags
  ADD COLUMN IF NOT EXISTS service_regions TEXT[]; -- Array of regions they serve

-- 6) Shop verification requests table
CREATE TABLE IF NOT EXISTS shop_verification_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id),
  
  -- Submitted data
  legal_name TEXT NOT NULL,
  business_entity_type business_entity_type NOT NULL,
  ein_last4 TEXT CHECK (length(ein_last4) = 4),
  state_business_id TEXT,
  license_expiration_date DATE,
  
  -- Documentation
  document_ids UUID[] DEFAULT '{}',
  extracted_data JSONB, -- OCR/parsed data from documents
  
  -- Review process
  status verification_status NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7) Shop capabilities (derived from actions)
CREATE TABLE IF NOT EXISTS shop_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  capability_tag TEXT NOT NULL, -- e.g., 'transport.pickup', 'photo.gallery360'
  
  -- Metrics
  action_count INTEGER DEFAULT 0,
  last_action_at TIMESTAMPTZ,
  verified_count INTEGER DEFAULT 0, -- Actions that were verified
  
  -- Time windows
  actions_30d INTEGER DEFAULT 0,
  actions_90d INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(shop_id, capability_tag)
);

-- 8) Add shop_id to event tracking (for action attribution)
ALTER TABLE vehicle_timeline_events
  ADD COLUMN IF NOT EXISTS shop_id UUID REFERENCES shops(id);

ALTER TABLE user_contributions
  ADD COLUMN IF NOT EXISTS shop_id UUID REFERENCES shops(id);

-- 9) Business document storage table
CREATE TABLE IF NOT EXISTS shop_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  verification_request_id UUID REFERENCES shop_verification_requests(id),
  
  document_type documentation_type NOT NULL,
  title TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_url TEXT NOT NULL,
  mime_type TEXT,
  file_size BIGINT,
  
  -- Extracted/parsed data
  extracted_data JSONB,
  extraction_method TEXT, -- 'manual', 'ocr_client', 'ocr_server'
  
  -- Security
  is_sensitive BOOLEAN DEFAULT true,
  visibility TEXT DEFAULT 'admin_only' CHECK (visibility IN ('admin_only', 'shop_members', 'public')),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10) Enable RLS
ALTER TABLE shop_verification_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_documents ENABLE ROW LEVEL SECURITY;

-- RLS Policies for shop_verification_requests
CREATE POLICY "Shop owners can view their verification requests"
  ON shop_verification_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM shops s 
      WHERE s.id = shop_verification_requests.shop_id 
      AND s.owner_user_id = auth.uid()
    )
  );

CREATE POLICY "Shop owners can create verification requests"
  ON shop_verification_requests FOR INSERT
  WITH CHECK (
    requested_by = auth.uid() AND
    EXISTS (
      SELECT 1 FROM shops s 
      WHERE s.id = shop_verification_requests.shop_id 
      AND s.owner_user_id = auth.uid()
    )
  );

-- RLS Policies for shop_documents
CREATE POLICY "Shop members can view their shop documents"
  ON shop_documents FOR SELECT
  USING (
    visibility = 'public' OR
    (visibility = 'shop_members' AND EXISTS (
      SELECT 1 FROM shop_members sm 
      WHERE sm.shop_id = shop_documents.shop_id 
      AND sm.user_id = auth.uid() 
      AND sm.status = 'active'
    )) OR
    EXISTS (
      SELECT 1 FROM shops s 
      WHERE s.id = shop_documents.shop_id 
      AND s.owner_user_id = auth.uid()
    )
  );

CREATE POLICY "Shop owners can upload documents"
  ON shop_documents FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM shops s 
      WHERE s.id = shop_documents.shop_id 
      AND s.owner_user_id = auth.uid()
    )
  );

-- Admins can view all for review
CREATE POLICY "Admins can view all shop documents"
  ON shop_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM admin_users 
      WHERE user_id = auth.uid() 
      AND is_active = true
    )
  );

CREATE POLICY "Admins can view all verification requests"
  ON shop_verification_requests FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM admin_users 
      WHERE user_id = auth.uid() 
      AND is_active = true
    )
  );

-- 11) Function to approve shop verification
CREATE OR REPLACE FUNCTION approve_shop_verification(
  p_request_id UUID,
  p_admin_user_id UUID,
  p_approve BOOLEAN,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_request shop_verification_requests;
  v_shop shops;
BEGIN
  -- Check admin permissions
  IF NOT EXISTS (
    SELECT 1 FROM admin_users 
    WHERE user_id = p_admin_user_id 
      AND is_active = true 
      AND can_manage_content = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient permissions');
  END IF;

  -- Get verification request
  SELECT * INTO v_request
  FROM shop_verification_requests
  WHERE id = p_request_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found');
  END IF;

  -- Update request status
  UPDATE shop_verification_requests
  SET 
    status = CASE WHEN p_approve THEN 'verified' ELSE 'rejected' END,
    reviewed_by = p_admin_user_id,
    reviewed_at = NOW(),
    review_notes = p_notes,
    updated_at = NOW()
  WHERE id = p_request_id;

  -- If approved, update shop with verified data
  IF p_approve THEN
    UPDATE shops
    SET
      legal_name = v_request.legal_name,
      business_entity_type = v_request.business_entity_type,
      ein_last4 = v_request.ein_last4,
      state_business_id = v_request.state_business_id,
      license_expiration_date = v_request.license_expiration_date,
      verification_status = 'verified',
      verified_at = NOW(),
      verified_by = p_admin_user_id,
      updated_at = NOW()
    WHERE id = v_request.shop_id;
  END IF;

  -- Log action
  INSERT INTO admin_action_log (
    admin_user_id,
    action_type,
    target_type,
    target_id,
    details
  ) VALUES (
    p_admin_user_id,
    CASE WHEN p_approve THEN 'approve_shop_verification' ELSE 'reject_shop_verification' END,
    'shop_verification_request',
    p_request_id,
    jsonb_build_object(
      'shop_id', v_request.shop_id,
      'legal_name', v_request.legal_name,
      'notes', p_notes
    )
  );

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 12) View for pending shop verifications
CREATE OR REPLACE VIEW pending_shop_verifications AS
SELECT 
  svr.id,
  svr.shop_id,
  svr.requested_by,
  svr.legal_name,
  svr.business_entity_type,
  svr.ein_last4,
  svr.state_business_id,
  svr.license_expiration_date,
  svr.status,
  svr.created_at,
  svr.document_ids,
  s.name as shop_name,
  s.display_name,
  s.org_type,
  u.email as requester_email
FROM shop_verification_requests svr
JOIN shops s ON svr.shop_id = s.id
LEFT JOIN auth.users u ON svr.requested_by = u.id
WHERE svr.status = 'pending'
ORDER BY svr.created_at DESC;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_shop_verification_requests_shop ON shop_verification_requests(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_verification_requests_status ON shop_verification_requests(status);
CREATE INDEX IF NOT EXISTS idx_shop_capabilities_shop ON shop_capabilities(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_documents_shop ON shop_documents(shop_id);
CREATE INDEX IF NOT EXISTS idx_shop_documents_request ON shop_documents(verification_request_id);
