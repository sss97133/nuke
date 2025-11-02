-- Work Order Origination & Multi-Org Collaboration System
-- Tracks who originated work orders and who collaborated

-- ============================================================================
-- WORK ORDER COLLABORATORS
-- ============================================================================

CREATE TABLE IF NOT EXISTS work_order_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timeline_event_id UUID REFERENCES business_timeline_events(id) ON DELETE CASCADE NOT NULL,
  organization_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL CHECK (role IN (
    'originator',      -- Who created/sold the work order (gets revenue)
    'location',        -- Where work was performed (hosting)
    'performer',       -- Who did the actual work (specialist)
    'parts_supplier',  -- Who provided parts
    'subcontractor',   -- Specialist brought in by primary
    'collaborator'     -- General collaboration
  )),
  revenue_attribution DECIMAL(10,2), -- Dollar amount attributed to this org
  revenue_percentage DECIMAL(5,2),   -- Percentage of total (0-100)
  attribution_source TEXT CHECK (attribution_source IN (
    'work_order',     -- From work_orders table (originator)
    'gps',            -- GPS location data
    'receipt',        -- Receipt/invoice OCR
    'user_input',     -- Manual user selection
    'ai_vision',      -- AI detected from photos
    'relationship'    -- Inferred from org relationships
  )),
  confidence DECIMAL(3,2) DEFAULT 1.0, -- 0.0-1.0 for AI-based attribution
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(timeline_event_id, organization_id, role)
);

CREATE INDEX idx_work_order_collaborators_event ON work_order_collaborators(timeline_event_id);
CREATE INDEX idx_work_order_collaborators_org ON work_order_collaborators(organization_id);
CREATE INDEX idx_work_order_collaborators_role ON work_order_collaborators(role);

-- RLS
ALTER TABLE work_order_collaborators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view collaborators" ON work_order_collaborators;
CREATE POLICY "Public can view collaborators" ON work_order_collaborators
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert collaborators" ON work_order_collaborators;
CREATE POLICY "Authenticated users can insert collaborators" ON work_order_collaborators
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Organization members can update collaborators" ON work_order_collaborators;
CREATE POLICY "Organization members can update collaborators" ON work_order_collaborators
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM business_user_roles
      WHERE business_id = organization_id
        AND user_id = auth.uid()
    )
  );

-- ============================================================================
-- ADD ORIGINATOR TO WORK ORDERS TABLE
-- ============================================================================

-- Add originator_organization_id to existing work_orders table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'work_orders' 
      AND column_name = 'originator_organization_id'
  ) THEN
    ALTER TABLE work_orders
    ADD COLUMN originator_organization_id UUID REFERENCES businesses(id);
  END IF;
END $$;

-- ============================================================================
-- HELPER FUNCTIONS FOR REVENUE ATTRIBUTION
-- ============================================================================

-- Get total revenue for an organization (originator only)
CREATE OR REPLACE FUNCTION get_organization_revenue(org_id UUID, start_date DATE DEFAULT NULL, end_date DATE DEFAULT NULL)
RETURNS TABLE (
  total_revenue DECIMAL(10,2),
  work_order_count INTEGER,
  avg_order_value DECIMAL(10,2)
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(woc.revenue_attribution), 0)::DECIMAL(10,2) as total_revenue,
    COUNT(DISTINCT woc.timeline_event_id)::INTEGER as work_order_count,
    COALESCE(AVG(woc.revenue_attribution), 0)::DECIMAL(10,2) as avg_order_value
  FROM work_order_collaborators woc
  JOIN business_timeline_events bte ON bte.id = woc.timeline_event_id
  WHERE woc.organization_id = org_id
    AND woc.role = 'originator'
    AND (start_date IS NULL OR bte.event_date >= start_date)
    AND (end_date IS NULL OR bte.event_date <= end_date);
END;
$$;

-- Get all collaborations for an organization (excluding originator)
CREATE OR REPLACE FUNCTION get_organization_collaborations(org_id UUID)
RETURNS TABLE (
  event_id UUID,
  event_date DATE,
  event_title TEXT,
  partner_org_id UUID,
  partner_org_name TEXT,
  role TEXT,
  revenue_attributed DECIMAL(10,2)
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    bte.id as event_id,
    bte.event_date,
    bte.title as event_title,
    woc.organization_id as partner_org_id,
    b.business_name as partner_org_name,
    woc.role,
    woc.revenue_attribution as revenue_attributed
  FROM work_order_collaborators woc
  JOIN business_timeline_events bte ON bte.id = woc.timeline_event_id
  JOIN businesses b ON b.id = woc.organization_id
  WHERE woc.timeline_event_id IN (
    SELECT timeline_event_id 
    FROM work_order_collaborators 
    WHERE organization_id = org_id
  )
  AND woc.organization_id != org_id
  ORDER BY bte.event_date DESC;
END;
$$;

-- Auto-detect collaborators from GPS and assign roles
CREATE OR REPLACE FUNCTION auto_assign_collaborators(event_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_event RECORD;
  v_location_org UUID;
  v_originator_org UUID;
BEGIN
  -- Get event details
  SELECT * INTO v_event
  FROM business_timeline_events
  WHERE id = event_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- business_id is the originator (who created the event)
  v_originator_org := v_event.business_id;

  -- Insert originator role
  INSERT INTO work_order_collaborators (
    timeline_event_id,
    organization_id,
    role,
    revenue_attribution,
    revenue_percentage,
    attribution_source
  ) VALUES (
    event_id,
    v_originator_org,
    'originator',
    v_event.cost_amount,
    100.0,
    'work_order'
  )
  ON CONFLICT (timeline_event_id, organization_id, role) DO NOTHING;

  -- TODO: If images have GPS, find nearby orgs and add as 'location' collaborators
  -- This will be enhanced in Phase 2
END;
$$;

-- ============================================================================
-- TRIGGER: Auto-assign collaborators when timeline event is created
-- ============================================================================

-- Trigger function wrapper
CREATE OR REPLACE FUNCTION auto_assign_collaborators_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM auto_assign_collaborators(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_assign_collaborators_trigger ON business_timeline_events;
CREATE TRIGGER auto_assign_collaborators_trigger
  AFTER INSERT OR UPDATE ON business_timeline_events
  FOR EACH ROW
  WHEN (NEW.cost_amount IS NOT NULL AND NEW.cost_amount > 0)
  EXECUTE FUNCTION auto_assign_collaborators_trigger();

-- ============================================================================
-- VIEWS FOR REPORTING
-- ============================================================================

-- Organization revenue dashboard
CREATE OR REPLACE VIEW organization_revenue_summary AS
SELECT
  b.id as organization_id,
  b.business_name,
  COUNT(DISTINCT CASE WHEN woc.role = 'originator' THEN woc.timeline_event_id END) as work_orders_originated,
  SUM(CASE WHEN woc.role = 'originator' THEN woc.revenue_attribution ELSE 0 END) as total_revenue,
  COUNT(DISTINCT CASE WHEN woc.role = 'performer' THEN woc.timeline_event_id END) as work_performed,
  COUNT(DISTINCT CASE WHEN woc.role = 'location' THEN woc.timeline_event_id END) as work_hosted,
  COUNT(DISTINCT CASE WHEN woc.role IN ('parts_supplier', 'subcontractor', 'collaborator') THEN woc.timeline_event_id END) as collaborations
FROM businesses b
LEFT JOIN work_order_collaborators woc ON woc.organization_id = b.id
GROUP BY b.id, b.business_name;

COMMENT ON TABLE work_order_collaborators IS 'Tracks all organizations involved in each work order with roles and revenue attribution';
COMMENT ON VIEW organization_revenue_summary IS 'Dashboard view showing revenue, work orders, and collaborations per organization';

