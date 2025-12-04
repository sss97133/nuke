-- 🚨 URGENT: Fix False Ownership Claims
-- 
-- BUG: Dropbox imports auto-assigned as "owner" without verification
-- FIX: Change to "storage" or "work_location" (not "owner")
-- 
-- Organizations should NEVER be auto-assigned as "owner"
-- Ownership requires PROOF (title document, ownership verification)

BEGIN;

-- 1. FIX: Change all auto-tagged "owner" relationships to "work_location"
--    (Organizations can work on vehicles without owning them)
UPDATE organization_vehicles
SET 
  relationship_type = 'work_location',
  updated_at = NOW()
WHERE relationship_type = 'owner'
  AND auto_tagged = true  -- Only auto-tagged (not manually verified)
  AND NOT EXISTS (
    -- Keep it if there's actual ownership verification
    SELECT 1 FROM ownership_verifications ov
    WHERE ov.vehicle_id = organization_vehicles.vehicle_id
      AND ov.verified_entity_id::text = organization_vehicles.organization_id::text
      AND ov.status = 'approved'
  );

-- 2. FIX: Update the trigger to NEVER assign "owner" automatically
DROP FUNCTION IF EXISTS auto_link_vehicle_to_origin_org() CASCADE;
CREATE OR REPLACE FUNCTION auto_link_vehicle_to_origin_org()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.origin_organization_id IS NOT NULL THEN
    INSERT INTO organization_vehicles (
      organization_id,
      vehicle_id,
      relationship_type,
      status,
      auto_tagged,
      linked_by_user_id
    )
    SELECT 
      NEW.origin_organization_id,
      NEW.id,
      CASE 
        -- BAT imports = consigner (they listed it)
        WHEN NEW.profile_origin = 'bat_import' THEN 'consigner'
        -- Dropbox = work_location (NOT owner!)
        WHEN NEW.profile_origin = 'dropbox_import' THEN 'work_location'
        -- Scraped = collaborator (data source)
        WHEN NEW.profile_origin ILIKE '%scrape%' THEN 'collaborator'
        -- Default = storage (safest assumption)
        ELSE 'storage'
      END,
      'active',
      true,
      NEW.uploaded_by
    WHERE NOT EXISTS (
      SELECT 1 FROM organization_vehicles 
      WHERE organization_id = NEW.origin_organization_id 
        AND vehicle_id = NEW.id
        AND status = 'active'
    )
    ON CONFLICT DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Re-create trigger
DROP TRIGGER IF EXISTS trigger_auto_link_origin_org ON vehicles;
CREATE TRIGGER trigger_auto_link_origin_org
  AFTER INSERT OR UPDATE OF origin_organization_id ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION auto_link_vehicle_to_origin_org();

-- 3. FIX: Update auto_tag_organization_from_receipt to use service_provider
--    Receipts prove SERVICE, not ownership
DROP FUNCTION IF EXISTS auto_tag_organization_from_receipt() CASCADE;
CREATE OR REPLACE FUNCTION auto_tag_organization_from_receipt()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  matched_org RECORD;
  similarity_score NUMERIC;
BEGIN
  IF NEW.vendor_name IS NOT NULL AND LENGTH(NEW.vendor_name) > 3 THEN
    
    SELECT 
      id,
      business_name,
      similarity(LOWER(business_name), LOWER(NEW.vendor_name)) AS sim_score
    INTO matched_org
    FROM businesses
    WHERE similarity(LOWER(business_name), LOWER(NEW.vendor_name)) > 0.5
    ORDER BY sim_score DESC
    LIMIT 1;
    
    IF matched_org.id IS NOT NULL THEN
      INSERT INTO organization_vehicles (
        organization_id,
        vehicle_id,
        relationship_type,  -- ← FIXED: service_provider, NOT owner
        auto_tagged,
        receipt_match_count,
        linked_by_user_id
      )
      VALUES (
        matched_org.id,
        NEW.vehicle_id,
        'service_provider',  -- ✅ CORRECT: They serviced it, didn't own it
        true,
        1,
        NEW.uploaded_by
      )
      ON CONFLICT (organization_id, vehicle_id, relationship_type)
      DO UPDATE SET
        receipt_match_count = organization_vehicles.receipt_match_count + 1,
        auto_tagged = true,
        updated_at = NOW();
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Re-create triggers
DROP TRIGGER IF EXISTS trg_auto_tag_org_from_receipt ON vehicle_documents;
CREATE TRIGGER trg_auto_tag_org_from_receipt
  AFTER INSERT OR UPDATE OF vendor_name
  ON vehicle_documents
  FOR EACH ROW
  EXECUTE FUNCTION auto_tag_organization_from_receipt();

-- 4. AUDIT: Log all changes made
INSERT INTO audit_actions (
  action_type,
  description,
  result,
  executed_at
) VALUES (
  'fix_validation',
  'Fixed false ownership claims - changed auto-tagged owners to work_location',
  jsonb_build_object(
    'fixed_count', (SELECT COUNT(*) FROM organization_vehicles WHERE relationship_type = 'work_location' AND auto_tagged = true),
    'reason', 'Organizations cannot be auto-assigned as owners without ownership verification'
  ),
  NOW()
);

COMMIT;

COMMENT ON FUNCTION auto_link_vehicle_to_origin_org IS 'Auto-links vehicles to origin organizations. NEVER assigns owner without verification.';
COMMENT ON FUNCTION auto_tag_organization_from_receipt IS 'Auto-links receipts to service providers. Receipts prove service, NOT ownership.';

