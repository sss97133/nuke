-- Enhance sensitive image detection to auto-detect cash payment photos
-- Auto-labels images containing cash/money as sensitive financial documents

-- ============================================================================
-- 1. ENHANCE AUTO-DETECT FUNCTION FOR CASH PAYMENTS
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_detect_sensitive_images()
RETURNS TRIGGER AS $$
BEGIN
  -- Auto-detect if caption suggests work order, invoice, or cash payment
  IF NEW.caption IS NOT NULL THEN
    -- Check for financial documents
    IF NEW.caption ~* '(invoice|receipt|work.*order|estimate|quote|bill|payment|paid)' THEN
      NEW.is_sensitive := TRUE;
      NEW.sensitivity_type := 'financial';
      NEW.visibility_level := 'internal_only';
      NEW.blur_preview := TRUE;
      NEW.contains_financial_data := TRUE;
    END IF;
    
    -- Check for cash payment keywords
    IF NEW.caption ~* '(cash|money|stack|payment.*cash|paying.*cash|contractor.*payment|labor.*payment|paid.*cash)' THEN
      NEW.is_sensitive := TRUE;
      NEW.sensitivity_type := 'financial';
      NEW.visibility_level := 'owner_only'; -- Cash payments are most sensitive
      NEW.blur_preview := TRUE;
      NEW.contains_financial_data := TRUE;
    END IF;
  END IF;
  
  -- Check document classification for cash/money keywords
  IF NEW.document_classification IS NOT NULL THEN
    DECLARE
      doc_class_text TEXT;
    BEGIN
      doc_class_text := NEW.document_classification::text;
      IF doc_class_text ~* '(cash|money|payment|contractor|labor.*payment)' THEN
        NEW.is_sensitive := TRUE;
        NEW.sensitivity_type := 'financial';
        NEW.visibility_level := 'owner_only';
        NEW.blur_preview := TRUE;
        NEW.contains_financial_data := TRUE;
      END IF;
    END;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update trigger
DROP TRIGGER IF EXISTS trg_auto_detect_sensitive ON vehicle_images;
CREATE TRIGGER trg_auto_detect_sensitive
  BEFORE INSERT ON vehicle_images
  FOR EACH ROW
  EXECUTE FUNCTION auto_detect_sensitive_images();

-- Also update organization_images trigger
DROP TRIGGER IF EXISTS trg_auto_detect_sensitive ON organization_images;
CREATE TRIGGER trg_auto_detect_sensitive
  BEFORE INSERT ON organization_images
  FOR EACH ROW
  EXECUTE FUNCTION auto_detect_sensitive_images();

-- ============================================================================
-- 2. ADD CASH PAYMENT DETECTION TO DOCUMENT CLASSIFICATION
-- ============================================================================

-- Add function to detect cash in image metadata
CREATE OR REPLACE FUNCTION detect_cash_payment_in_metadata()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if AI analysis detected cash/money
  IF NEW.ai_analysis IS NOT NULL THEN
    DECLARE
      ai_text TEXT;
    BEGIN
      ai_text := NEW.ai_analysis::text;
      IF ai_text ~* '(cash|money|dollar|bill|stack.*money|payment.*cash|paying.*contractor)' THEN
        NEW.is_sensitive := TRUE;
        NEW.sensitivity_type := 'financial';
        NEW.visibility_level := 'owner_only';
        NEW.blur_preview := TRUE;
        NEW.contains_financial_data := TRUE;
        
        -- Also mark as document if not already
        IF NEW.is_document IS NULL OR NEW.is_document = FALSE THEN
          NEW.is_document := TRUE;
          NEW.document_category := 'payment';
        END IF;
      END IF;
    END;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger for AI analysis updates
DROP TRIGGER IF EXISTS trg_detect_cash_in_metadata ON vehicle_images;
CREATE TRIGGER trg_detect_cash_in_metadata
  BEFORE INSERT OR UPDATE OF ai_analysis ON vehicle_images
  FOR EACH ROW
  EXECUTE FUNCTION detect_cash_payment_in_metadata();

-- ============================================================================
-- 3. ADD PARKING RATE TO ORGANIZATIONS
-- ============================================================================

ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS parking_rate_per_day DECIMAL(10,2) DEFAULT 0;

COMMENT ON COLUMN businesses.parking_rate_per_day IS 'Daily parking/storage rate for vehicles at this location';

-- ============================================================================
-- 4. ADD OWNER OPERATOR TRACKING TO TIMELINE EVENTS
-- ============================================================================

-- Add metadata field to track owner operator work
-- This is already in timeline_events.metadata, but we'll add a helper function

CREATE OR REPLACE FUNCTION mark_owner_operator_work()
RETURNS TRIGGER AS $$
BEGIN
  -- If user_id matches vehicle owner or organization owner, mark as owner operator
  IF NEW.metadata IS NULL THEN
    NEW.metadata := '{}'::jsonb;
  END IF;
  
  -- Check if this is owner operator work (user doing work themselves)
  DECLARE
    is_vehicle_owner BOOLEAN;
    is_org_owner BOOLEAN;
  BEGIN
    -- Check if user owns the vehicle
    SELECT EXISTS(
      SELECT 1 FROM vehicles 
      WHERE id = NEW.vehicle_id 
      AND (uploaded_by = NEW.user_id OR user_id = NEW.user_id)
    ) INTO is_vehicle_owner;
    
    -- Check if user owns the organization
    IF NEW.organization_id IS NOT NULL THEN
      SELECT EXISTS(
        SELECT 1 FROM business_ownership
        WHERE business_id = NEW.organization_id
        AND owner_id = NEW.user_id
        AND status = 'active'
      ) INTO is_org_owner;
    END IF;
    
    -- Mark as owner operator if user owns vehicle or organization
    IF is_vehicle_owner OR is_org_owner THEN
      NEW.metadata := NEW.metadata || jsonb_build_object(
        'owner_operator', true,
        'owner_operator_type', CASE 
          WHEN is_vehicle_owner AND is_org_owner THEN 'both'
          WHEN is_vehicle_owner THEN 'vehicle_owner'
          WHEN is_org_owner THEN 'org_owner'
          ELSE 'unknown'
        END
      );
    END IF;
  END;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger to auto-mark owner operator work
DROP TRIGGER IF EXISTS trg_mark_owner_operator ON timeline_events;
CREATE TRIGGER trg_mark_owner_operator
  BEFORE INSERT OR UPDATE ON timeline_events
  FOR EACH ROW
  WHEN (NEW.event_type IN ('repair', 'modification', 'maintenance'))
  EXECUTE FUNCTION mark_owner_operator_work();

COMMENT ON FUNCTION mark_owner_operator_work IS 'Automatically marks timeline events as owner operator work when user owns the vehicle or organization';


