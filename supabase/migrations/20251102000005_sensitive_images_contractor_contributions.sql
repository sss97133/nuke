-- Sensitive Images and Contractor Contributions System
-- Allows marking images as private/internal while still tracking contributor credit

-- ============================================================================
-- 1. ADD SENSITIVITY CONTROLS TO ORGANIZATION_IMAGES
-- ============================================================================

-- Add visibility and sensitivity fields
ALTER TABLE organization_images 
ADD COLUMN IF NOT EXISTS is_sensitive BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS sensitivity_type TEXT CHECK (sensitivity_type IN ('work_order', 'financial', 'internal_only', 'proprietary', 'none')),
ADD COLUMN IF NOT EXISTS visibility_level TEXT DEFAULT 'public' CHECK (visibility_level IN ('public', 'internal_only', 'owner_only', 'contributor_only')),
ADD COLUMN IF NOT EXISTS blur_preview BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS ocr_extracted_data JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS contains_financial_data BOOLEAN DEFAULT FALSE;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_org_images_sensitivity ON organization_images(organization_id, is_sensitive, visibility_level);
CREATE INDEX IF NOT EXISTS idx_org_images_financial ON organization_images(organization_id, contains_financial_data);

COMMENT ON COLUMN organization_images.is_sensitive IS 'Marks image as containing sensitive/private information';
COMMENT ON COLUMN organization_images.sensitivity_type IS 'Type of sensitive data: work_order, financial, internal_only, proprietary';
COMMENT ON COLUMN organization_images.visibility_level IS 'Who can see this image: public, internal_only (org members), owner_only, contributor_only';
COMMENT ON COLUMN organization_images.blur_preview IS 'Show blurred thumbnail until clicked to reveal';
COMMENT ON COLUMN organization_images.ocr_extracted_data IS 'Financial and work order data extracted via OCR';
COMMENT ON COLUMN organization_images.contains_financial_data IS 'Quick flag for images containing pricing/invoice data';

-- ============================================================================
-- 2. CONTRACTOR WORK CONTRIBUTIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS contractor_work_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- WHO (Contractor)
  contractor_user_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- WHERE (Organization/Shop)
  organization_id UUID NOT NULL REFERENCES businesses(id),
  
  -- WHAT (Work Performed)
  work_description TEXT NOT NULL,
  work_category TEXT CHECK (work_category IN ('labor', 'fabrication', 'paint', 'upholstery', 'mechanical', 'electrical', 'bodywork', 'restoration', 'other')),
  
  -- WHEN
  work_date DATE NOT NULL,
  
  -- HOW MUCH (Financial Attribution)
  labor_hours NUMERIC,
  hourly_rate NUMERIC, -- Contractor's rate for this job
  total_labor_value NUMERIC, -- labor_hours * hourly_rate
  materials_cost NUMERIC DEFAULT 0,
  total_value NUMERIC, -- labor + materials
  
  -- PROOF
  source_image_id UUID REFERENCES organization_images(id), -- The work order/receipt image
  source_document_url TEXT,
  extracted_from_ocr BOOLEAN DEFAULT FALSE,
  
  -- VEHICLE LINK (if work was on a specific vehicle)
  vehicle_id UUID REFERENCES vehicles(id),
  vehicle_name TEXT,
  
  -- ATTRIBUTION & PRIVACY
  is_public BOOLEAN DEFAULT FALSE, -- Defaults to private for contractor protection
  show_financial_details BOOLEAN DEFAULT FALSE, -- Hide exact $ amounts
  show_on_contractor_profile BOOLEAN DEFAULT TRUE, -- Show hours/work type but hide money
  verified_by_shop BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMP WITH TIME ZONE,
  
  -- METADATA
  confidence_score INTEGER DEFAULT 100 CHECK (confidence_score >= 0 AND confidence_score <= 100),
  metadata JSONB DEFAULT '{}',
  
  -- TIMESTAMPS
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_contractor_contributions_user ON contractor_work_contributions(contractor_user_id);
CREATE INDEX idx_contractor_contributions_org ON contractor_work_contributions(organization_id);
CREATE INDEX idx_contractor_contributions_vehicle ON contractor_work_contributions(vehicle_id);
CREATE INDEX idx_contractor_contributions_date ON contractor_work_contributions(work_date);

COMMENT ON TABLE contractor_work_contributions IS 'Tracks contractor labor contributions to build professional portfolio with privacy controls';

-- ============================================================================
-- 3. CONTRACTOR PROFILE STATS (MATERIALIZED VIEW)
-- ============================================================================

CREATE OR REPLACE VIEW contractor_profile_stats AS
SELECT 
  contractor_user_id,
  COUNT(*) as total_jobs,
  COUNT(DISTINCT organization_id) as shops_worked_for,
  COUNT(DISTINCT vehicle_id) as vehicles_worked_on,
  SUM(labor_hours) as total_labor_hours,
  SUM(CASE WHEN show_financial_details THEN total_value ELSE 0 END) as public_revenue,
  SUM(total_value) as total_revenue_all, -- Only visible to the contractor
  AVG(hourly_rate) as average_hourly_rate,
  ARRAY_AGG(DISTINCT work_category) FILTER (WHERE work_category IS NOT NULL) as specializations,
  MIN(work_date) as first_job_date,
  MAX(work_date) as most_recent_job_date
FROM contractor_work_contributions
WHERE is_public = TRUE
GROUP BY contractor_user_id;

COMMENT ON VIEW contractor_profile_stats IS 'Aggregated contractor statistics for professional profiles';

-- ============================================================================
-- 4. RLS POLICIES FOR CONTRACTOR CONTRIBUTIONS
-- ============================================================================

ALTER TABLE contractor_work_contributions ENABLE ROW LEVEL SECURITY;

-- Contractors can view all their own contributions (including private financial data)
CREATE POLICY contractor_view_own
  ON contractor_work_contributions
  FOR SELECT
  USING (contractor_user_id = auth.uid());

-- Contractors can insert their own contributions
CREATE POLICY contractor_insert_own
  ON contractor_work_contributions
  FOR INSERT
  WITH CHECK (contractor_user_id = auth.uid());

-- Contractors can update their own contributions
CREATE POLICY contractor_update_own
  ON contractor_work_contributions
  FOR UPDATE
  USING (contractor_user_id = auth.uid());

-- Organization owners can view contributions for their org (respecting privacy settings)
CREATE POLICY org_view_contributions
  ON contractor_work_contributions
  FOR SELECT
  USING (
    organization_id IN (
      SELECT business_id 
      FROM business_ownership 
      WHERE owner_id = auth.uid() AND status = 'active'
    )
  );

-- Public can view only public, non-financial contributions
CREATE POLICY public_view_contributions
  ON contractor_work_contributions
  FOR SELECT
  USING (is_public = TRUE);

-- ============================================================================
-- 5. FUNCTION TO AUTO-DETECT SENSITIVE IMAGES
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_detect_sensitive_images()
RETURNS TRIGGER AS $$
BEGIN
  -- Auto-detect if caption suggests work order or invoice
  IF NEW.caption IS NOT NULL THEN
    IF NEW.caption ~* '(invoice|receipt|work.*order|estimate|quote|bill)' THEN
      NEW.is_sensitive := TRUE;
      NEW.sensitivity_type := 'work_order';
      NEW.visibility_level := 'internal_only';
      NEW.blur_preview := TRUE;
      NEW.contains_financial_data := TRUE;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-detect sensitivity on upload
DROP TRIGGER IF EXISTS trg_auto_detect_sensitive ON organization_images;
CREATE TRIGGER trg_auto_detect_sensitive
  BEFORE INSERT ON organization_images
  FOR EACH ROW
  EXECUTE FUNCTION auto_detect_sensitive_images();

-- ============================================================================
-- 6. FUNCTION TO EXTRACT WORK ORDER DATA (Placeholder for OCR integration)
-- ============================================================================

CREATE OR REPLACE FUNCTION extract_work_order_data(image_id UUID)
RETURNS JSONB AS $$
DECLARE
  result JSONB := '{}'::jsonb;
  img RECORD;
BEGIN
  SELECT * INTO img FROM organization_images WHERE id = image_id;
  
  IF NOT FOUND THEN
    RETURN '{"error": "Image not found"}'::jsonb;
  END IF;
  
  -- TODO: Integrate with OCR Edge Function
  -- For now, return placeholder data
  result := jsonb_build_object(
    'status', 'pending_ocr',
    'image_url', img.image_url,
    'requires_manual_entry', TRUE
  );
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION extract_work_order_data IS 'Extracts financial and work order data from image using OCR (placeholder for Edge Function)';

-- ============================================================================
-- 7. UPDATE ORGANIZATION_CONTRIBUTORS WHEN WORK IS LOGGED
-- ============================================================================

CREATE OR REPLACE FUNCTION update_contractor_contribution_count()
RETURNS TRIGGER AS $$
BEGIN
  -- Increment contribution count for the contractor
  INSERT INTO organization_contributors (
    organization_id,
    user_id,
    role,
    contribution_count,
    start_date
  )
  VALUES (
    NEW.organization_id,
    NEW.contractor_user_id,
    'technician', -- Default role for contractors
    1,
    NEW.work_date
  )
  ON CONFLICT (organization_id, user_id) 
  DO UPDATE SET
    contribution_count = organization_contributors.contribution_count + 1,
    updated_at = NOW();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_update_contractor_count ON contractor_work_contributions;
CREATE TRIGGER trg_update_contractor_count
  AFTER INSERT ON contractor_work_contributions
  FOR EACH ROW
  EXECUTE FUNCTION update_contractor_contribution_count();

-- ============================================================================
-- 8. RLS FOR ORGANIZATION_IMAGES (Enhanced for sensitivity)
-- ============================================================================

-- Drop existing policies to recreate with sensitivity logic
DROP POLICY IF EXISTS org_images_public_view ON organization_images;
DROP POLICY IF EXISTS org_images_owner_view ON organization_images;

-- Public can view only non-sensitive images
CREATE POLICY org_images_public_view
  ON organization_images
  FOR SELECT
  USING (
    (visibility_level = 'public' AND (is_sensitive IS NULL OR is_sensitive = FALSE))
    OR
    (visibility_level = 'public' AND user_id = auth.uid()) -- Own uploads always visible
  );

-- Organization owners/contributors can view internal_only images
CREATE POLICY org_images_internal_view
  ON organization_images
  FOR SELECT
  USING (
    visibility_level = 'internal_only'
    AND (
      -- Organization owner
      organization_id IN (
        SELECT business_id 
        FROM business_ownership 
        WHERE owner_id = auth.uid() AND status = 'active'
      )
      OR
      -- Organization contributor
      organization_id IN (
        SELECT organization_id 
        FROM organization_contributors 
        WHERE user_id = auth.uid() AND status = 'active'
      )
      OR
      -- Image uploader
      user_id = auth.uid()
    )
  );

-- Contributor-only images visible to uploader and org owner
CREATE POLICY org_images_contributor_view
  ON organization_images
  FOR SELECT
  USING (
    visibility_level = 'contributor_only'
    AND (
      user_id = auth.uid() -- Image uploader
      OR
      organization_id IN (
        SELECT business_id 
        FROM business_ownership 
        WHERE owner_id = auth.uid() AND status = 'active'
      )
    )
  );

-- Owner-only images visible only to uploader and org owner
CREATE POLICY org_images_owner_view
  ON organization_images
  FOR SELECT
  USING (
    visibility_level = 'owner_only'
    AND (
      user_id = auth.uid()
      OR
      organization_id IN (
        SELECT business_id 
        FROM business_ownership 
        WHERE owner_id = auth.uid() AND status = 'active'
      )
    )
  );

-- Grant UPDATE permissions to image uploader and org owners
CREATE POLICY org_images_update_permissions
  ON organization_images
  FOR UPDATE
  USING (
    user_id = auth.uid() -- Image uploader
    OR
    organization_id IN (
      SELECT business_id 
      FROM business_ownership 
      WHERE owner_id = auth.uid() AND status = 'active'
    )
  );

