-- ============================================
-- LINK ORGANIZATIONS FROM TIMELINE EVENTS
-- ============================================
-- Problem: Timeline events have organization_id or service_provider_name
-- but organization_vehicles records don't exist
-- Solution: Create organization_vehicles from timeline events

-- ============================================
-- 1. FUNCTION: Link org from timeline event
-- ============================================
CREATE OR REPLACE FUNCTION link_org_from_timeline_event()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
  v_relationship_type TEXT;
BEGIN
  -- If event has organization_id, link it
  IF NEW.organization_id IS NOT NULL THEN
    -- Determine relationship type based on event type
    v_relationship_type := CASE
      WHEN NEW.event_type IN ('work_completed', 'service', 'repair', 'maintenance') THEN 'service_provider'
      WHEN NEW.event_type IN ('paint', 'bodywork', 'fabrication') THEN 
        CASE 
          WHEN NEW.metadata->>'work_category' ILIKE '%paint%' THEN 'painter'
          WHEN NEW.metadata->>'work_category' ILIKE '%upholstery%' OR NEW.metadata->>'work_category' ILIKE '%interior%' THEN 'upholstery'
          WHEN NEW.metadata->>'work_category' ILIKE '%fabrication%' OR NEW.metadata->>'work_category' ILIKE '%welding%' THEN 'fabricator'
          ELSE 'service_provider'
        END
      WHEN NEW.event_type = 'purchase' THEN 'seller'
      WHEN NEW.event_type = 'sale' THEN 'buyer'
      ELSE 'service_provider'
    END;
    
    -- Create or update organization_vehicles
    INSERT INTO organization_vehicles (
      organization_id,
      vehicle_id,
      relationship_type,
      status,
      auto_tagged,
      linked_by_user_id,
      start_date
    )
    VALUES (
      NEW.organization_id,
      NEW.vehicle_id,
      v_relationship_type,
      'active',
      false, -- Not auto-tagged, explicitly set via timeline event
      NEW.user_id,
      NEW.event_date
    )
    ON CONFLICT (organization_id, vehicle_id, relationship_type)
    DO UPDATE SET
      status = 'active',
      start_date = LEAST(organization_vehicles.start_date, NEW.event_date),
      updated_at = NOW();
  END IF;
  
  -- If event has service_provider_name but no organization_id, try to match
  IF NEW.service_provider_name IS NOT NULL AND NEW.organization_id IS NULL THEN
    SELECT id INTO v_org_id
    FROM businesses
    WHERE similarity(LOWER(business_name), LOWER(NEW.service_provider_name)) > 0.5
    ORDER BY similarity(LOWER(business_name), LOWER(NEW.service_provider_name)) DESC
    LIMIT 1;
    
    IF v_org_id IS NOT NULL THEN
      -- Update event with matched organization_id
      UPDATE timeline_events
      SET organization_id = v_org_id
      WHERE id = NEW.id;
      
      -- Create organization_vehicles link
      INSERT INTO organization_vehicles (
        organization_id,
        vehicle_id,
        relationship_type,
        status,
        auto_tagged,
        linked_by_user_id,
        start_date
      )
      VALUES (
        v_org_id,
        NEW.vehicle_id,
        CASE
          WHEN NEW.event_type IN ('paint', 'bodywork') AND NEW.metadata->>'work_category' ILIKE '%paint%' THEN 'painter'
          WHEN NEW.event_type IN ('paint', 'bodywork') AND (NEW.metadata->>'work_category' ILIKE '%upholstery%' OR NEW.metadata->>'work_category' ILIKE '%interior%') THEN 'upholstery'
          WHEN NEW.event_type IN ('work_completed', 'fabrication') AND (NEW.metadata->>'work_category' ILIKE '%fabrication%' OR NEW.metadata->>'work_category' ILIKE '%welding%') THEN 'fabricator'
          ELSE 'service_provider'
        END,
        'active',
        true, -- Auto-tagged from service_provider_name match
        NEW.user_id,
        NEW.event_date
      )
      ON CONFLICT (organization_id, vehicle_id, relationship_type)
      DO UPDATE SET
        status = 'active',
        start_date = LEAST(organization_vehicles.start_date, NEW.event_date),
        updated_at = NOW();
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION link_org_from_timeline_event IS 'Automatically creates organization_vehicles records when timeline events have organization_id or service_provider_name';

-- ============================================
-- 2. CREATE TRIGGER
-- ============================================
DROP TRIGGER IF EXISTS trg_link_org_from_timeline_event ON timeline_events;
CREATE TRIGGER trg_link_org_from_timeline_event
  AFTER INSERT OR UPDATE OF organization_id, service_provider_name ON timeline_events
  FOR EACH ROW
  WHEN (NEW.organization_id IS NOT NULL OR NEW.service_provider_name IS NOT NULL)
  EXECUTE FUNCTION link_org_from_timeline_event();

-- ============================================
-- 3. BACKFILL: Link existing timeline events
-- ============================================
-- Create organization_vehicles for all existing timeline events that have org info
INSERT INTO organization_vehicles (
  organization_id,
  vehicle_id,
  relationship_type,
  status,
  auto_tagged,
  linked_by_user_id,
  start_date
)
SELECT DISTINCT
  te.organization_id,
  te.vehicle_id,
  CASE
    WHEN te.event_type IN ('paint', 'bodywork') AND te.metadata->>'work_category' ILIKE '%paint%' THEN 'painter'
    WHEN te.event_type IN ('paint', 'bodywork') AND (te.metadata->>'work_category' ILIKE '%upholstery%' OR te.metadata->>'work_category' ILIKE '%interior%') THEN 'upholstery'
    WHEN te.event_type IN ('work_completed', 'fabrication') AND (te.metadata->>'work_category' ILIKE '%fabrication%' OR te.metadata->>'work_category' ILIKE '%welding%') THEN 'fabricator'
    WHEN te.event_type = 'purchase' THEN 'seller'
    WHEN te.event_type = 'sale' THEN 'buyer'
    ELSE 'service_provider'
  END,
  'active',
  false,
  te.user_id,
  MIN(te.event_date) OVER (PARTITION BY te.organization_id, te.vehicle_id)
FROM timeline_events te
WHERE te.organization_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM organization_vehicles ov
    WHERE ov.organization_id = te.organization_id
      AND ov.vehicle_id = te.vehicle_id
      AND ov.status = 'active'
  )
ON CONFLICT (organization_id, vehicle_id, relationship_type) DO NOTHING;

-- Also backfill from service_provider_name matches
INSERT INTO organization_vehicles (
  organization_id,
  vehicle_id,
  relationship_type,
  status,
  auto_tagged,
  linked_by_user_id,
  start_date
)
SELECT DISTINCT
  b.id,
  te.vehicle_id,
  CASE
    WHEN te.event_type IN ('paint', 'bodywork') AND te.metadata->>'work_category' ILIKE '%paint%' THEN 'painter'
    WHEN te.event_type IN ('paint', 'bodywork') AND (te.metadata->>'work_category' ILIKE '%upholstery%' OR te.metadata->>'work_category' ILIKE '%interior%') THEN 'upholstery'
    WHEN te.event_type IN ('work_completed', 'fabrication') AND (te.metadata->>'work_category' ILIKE '%fabrication%' OR te.metadata->>'work_category' ILIKE '%welding%') THEN 'fabricator'
    ELSE 'service_provider'
  END,
  'active',
  true,
  te.user_id,
  MIN(te.event_date) OVER (PARTITION BY b.id, te.vehicle_id)
FROM timeline_events te
JOIN businesses b ON similarity(LOWER(b.business_name), LOWER(te.service_provider_name)) > 0.5
WHERE te.service_provider_name IS NOT NULL
  AND te.organization_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM organization_vehicles ov
    WHERE ov.organization_id = b.id
      AND ov.vehicle_id = te.vehicle_id
      AND ov.status = 'active'
  )
ON CONFLICT (organization_id, vehicle_id, relationship_type) DO NOTHING;

