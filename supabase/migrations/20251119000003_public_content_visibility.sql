-- Public Content Visibility & Auto-Approval
-- Ensures uploads are public-first with moderator redaction controls

-- ============================================================================
-- ENUMS
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'content_approval_status') THEN
    CREATE TYPE IF NOT EXISTS content_approval_status AS ENUM ('pending','auto_approved','approved','rejected');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'content_redaction_level') THEN
    CREATE TYPE IF NOT EXISTS content_redaction_level AS ENUM ('none','details_hidden','full_blur');
  END IF;
END $$;

-- ============================================================================
-- COLUMN ADDITIONS
-- ============================================================================
ALTER TABLE vehicle_image_assets
  ADD COLUMN IF NOT EXISTS approval_status content_approval_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS redaction_level content_redaction_level NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS redacted_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS redacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS redaction_reason TEXT,
  ADD COLUMN IF NOT EXISTS safe_preview_url TEXT;

ALTER TABLE vehicle_images
  ADD COLUMN IF NOT EXISTS approval_status content_approval_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS redaction_level content_redaction_level NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS redacted_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS redacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS redaction_reason TEXT,
  ADD COLUMN IF NOT EXISTS safe_preview_url TEXT;

ALTER TABLE vehicle_documents
  ADD COLUMN IF NOT EXISTS approval_status content_approval_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS redaction_level content_redaction_level NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS redacted_by UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS redacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS redaction_reason TEXT,
  ADD COLUMN IF NOT EXISTS safe_preview_url TEXT;

-- ============================================================================
-- AUTO-APPROVAL FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION auto_approve_vehicle_content(p_vehicle_id UUID, p_user_id UUID)
RETURNS content_approval_status AS $$
DECLARE
  v_status content_approval_status := 'pending';
BEGIN
  IF p_vehicle_id IS NULL OR p_user_id IS NULL THEN
    RETURN v_status;
  END IF;

  IF EXISTS (
    SELECT 1 FROM vehicles v
    WHERE v.id = p_vehicle_id
      AND (
        v.user_id = p_user_id OR
        v.uploaded_by = p_user_id OR
        v.owner_id = p_user_id
      )
  ) THEN
    RETURN 'auto_approved';
  END IF;

  IF EXISTS (
    SELECT 1 FROM ownership_verifications ov
    WHERE ov.vehicle_id = p_vehicle_id
      AND ov.user_id = p_user_id
      AND ov.status = 'approved'
  ) THEN
    RETURN 'auto_approved';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM vehicle_user_permissions vup
    WHERE vup.vehicle_id = p_vehicle_id
      AND vup.user_id = p_user_id
      AND COALESCE(vup.is_active, true) = true
      AND vup.role IN ('owner','co_owner','moderator','consigner','restorer','board_member','mechanic','appraiser')
  ) THEN
    RETURN 'auto_approved';
  END IF;

  RETURN v_status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================================
-- TRIGGERS
-- ============================================================================
CREATE OR REPLACE FUNCTION apply_auto_approval_for_asset()
RETURNS TRIGGER AS $$
DECLARE
  v_actor UUID;
  v_status content_approval_status;
BEGIN
  v_actor := COALESCE(NEW.submitted_by, NEW.uploader_id, auth.uid());
  NEW.submitted_by := v_actor;
  v_status := auto_approve_vehicle_content(NEW.vehicle_id, v_actor);
  IF v_status = 'auto_approved' THEN
    NEW.approval_status := 'auto_approved';
    NEW.approved_by := v_actor;
    NEW.approved_at := NOW();
  ELSE
    NEW.approval_status := COALESCE(NEW.approval_status, 'pending');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION apply_auto_approval_for_image()
RETURNS TRIGGER AS $$
DECLARE
  v_actor UUID;
  v_status content_approval_status;
  v_vehicle UUID;
BEGIN
  v_actor := COALESCE(NEW.submitted_by, NEW.user_id, auth.uid());
  NEW.submitted_by := v_actor;
  SELECT vehicle_id INTO v_vehicle FROM vehicles WHERE id = NEW.vehicle_id;
  v_status := auto_approve_vehicle_content(NEW.vehicle_id, v_actor);
  IF v_status = 'auto_approved' THEN
    NEW.approval_status := 'auto_approved';
    NEW.approved_by := v_actor;
    NEW.approved_at := NOW();
  ELSE
    NEW.approval_status := COALESCE(NEW.approval_status, 'pending');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION apply_auto_approval_for_document()
RETURNS TRIGGER AS $$
DECLARE
  v_actor UUID;
  v_status content_approval_status;
BEGIN
  v_actor := COALESCE(NEW.submitted_by, NEW.uploaded_by, auth.uid());
  NEW.submitted_by := v_actor;
  v_status := auto_approve_vehicle_content(NEW.vehicle_id, v_actor);
  IF v_status = 'auto_approved' THEN
    NEW.approval_status := 'auto_approved';
    NEW.approved_by := v_actor;
    NEW.approved_at := NOW();
  ELSE
    NEW.approval_status := COALESCE(NEW.approval_status, 'pending');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_auto_approve_vehicle_image_assets ON vehicle_image_assets;
CREATE TRIGGER trg_auto_approve_vehicle_image_assets
  BEFORE INSERT ON vehicle_image_assets
  FOR EACH ROW
  EXECUTE FUNCTION apply_auto_approval_for_asset();

DROP TRIGGER IF EXISTS trg_auto_approve_vehicle_images ON vehicle_images;
CREATE TRIGGER trg_auto_approve_vehicle_images
  BEFORE INSERT ON vehicle_images
  FOR EACH ROW
  EXECUTE FUNCTION apply_auto_approval_for_image();

DROP TRIGGER IF EXISTS trg_auto_approve_vehicle_documents ON vehicle_documents;
CREATE TRIGGER trg_auto_approve_vehicle_documents
  BEFORE INSERT ON vehicle_documents
  FOR EACH ROW
  EXECUTE FUNCTION apply_auto_approval_for_document();

-- ============================================================================
-- PUBLIC VIEWS
-- ============================================================================
CREATE OR REPLACE VIEW vehicle_image_assets_public_view AS
SELECT
  id,
  vehicle_id,
  COALESCE(safe_preview_url, storage_path) AS public_path,
  source_type,
  area,
  angle,
  is_primary,
  tags,
  status,
  redaction_level,
  approval_status,
  uploaded_at,
  captured_at
FROM vehicle_image_assets
WHERE approval_status IN ('auto_approved','approved');

GRANT SELECT ON vehicle_image_assets_public_view TO anon, authenticated;

CREATE OR REPLACE VIEW vehicle_documents_public_view AS
SELECT
  id,
  vehicle_id,
  document_type,
  CASE 
    WHEN redaction_level = 'none' THEN title
    ELSE '[REDACTED]'
  END AS title,
  CASE 
    WHEN redaction_level = 'none' THEN description
    ELSE 'Details hidden'
  END AS description,
  document_date,
  COALESCE(safe_preview_url, pii_redacted_url, file_url) AS public_file_url,
  vendor_name,
  amount,
  currency,
  approval_status,
  redaction_level,
  created_at
FROM vehicle_documents
WHERE approval_status IN ('auto_approved','approved');

GRANT SELECT ON vehicle_documents_public_view TO anon, authenticated;

-- ============================================================================
-- RLS UPDATES
-- ============================================================================
DROP POLICY IF EXISTS "Public can view all documents" ON vehicle_documents;
CREATE POLICY "Public can view all documents"
  ON vehicle_documents
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Public can view image assets" ON vehicle_image_assets;
CREATE POLICY "Public can view image assets"
  ON vehicle_image_assets
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Authenticated can upload image assets" ON vehicle_image_assets;
CREATE POLICY "Authenticated can upload image assets"
  ON vehicle_image_assets
  FOR INSERT
  WITH CHECK (auth.uid() = submitted_by OR (submitted_by IS NULL AND auth.uid() IS NOT NULL));

DROP POLICY IF EXISTS "Authenticated can upload documents" ON vehicle_documents;
CREATE POLICY "Authenticated can upload documents"
  ON vehicle_documents
  FOR INSERT
  WITH CHECK (auth.uid() = submitted_by OR (submitted_by IS NULL AND auth.uid() IS NOT NULL));

DROP POLICY IF EXISTS "Authenticated can upload vehicle images" ON vehicle_images;
CREATE POLICY "Authenticated can upload vehicle images"
  ON vehicle_images
  FOR INSERT
  WITH CHECK (auth.uid() = submitted_by OR (submitted_by IS NULL AND auth.uid() IS NOT NULL));

-- ============================================================================
-- NOTICE
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '✅ Public visibility + auto-approval migration applied.';
END $$;

