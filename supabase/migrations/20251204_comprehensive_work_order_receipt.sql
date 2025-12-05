-- COMPREHENSIVE WORK ORDER RECEIPT SYSTEM
-- Ensures all data needed for full forensic accounting is linked and accessible

-- ============================================================================
-- 1. ENHANCE VEHICLE_IMAGES WITH ATTRIBUTION
-- ============================================================================

-- Add columns if not exist (for tracking who documented vs who uploaded)
ALTER TABLE vehicle_images
  ADD COLUMN IF NOT EXISTS documented_by_device TEXT,
  ADD COLUMN IF NOT EXISTS documented_by_user_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS photographer_attribution TEXT;

-- ============================================================================
-- 2. TIMELINE EVENTS: ADD ATTRIBUTION FIELDS
-- ============================================================================

-- Ensure timeline_events has all the fields we need for comprehensive receipts
ALTER TABLE timeline_events
  ADD COLUMN IF NOT EXISTS documented_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS primary_technician UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS quality_rating INTEGER CHECK (quality_rating >= 1 AND quality_rating <= 10),
  ADD COLUMN IF NOT EXISTS quality_justification TEXT,
  ADD COLUMN IF NOT EXISTS value_impact DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS ai_confidence_score DECIMAL(3,2),
  ADD COLUMN IF NOT EXISTS concerns TEXT[],
  ADD COLUMN IF NOT EXISTS industry_standard_comparison JSONB;

COMMENT ON COLUMN timeline_events.documented_by IS 'User who documented/photographed the work (may differ from performer)';
COMMENT ON COLUMN timeline_events.primary_technician IS 'Primary technician who performed the work';
COMMENT ON COLUMN timeline_events.quality_rating IS 'AI or human quality assessment (1-10 scale)';
COMMENT ON COLUMN timeline_events.value_impact IS 'Estimated value added to vehicle by this work';
COMMENT ON COLUMN timeline_events.ai_confidence_score IS 'AI confidence in analysis (0.0-1.0)';
COMMENT ON COLUMN timeline_events.concerns IS 'Array of flagged concerns or issues';
COMMENT ON COLUMN timeline_events.industry_standard_comparison IS 'Comparison to Mitchell/Chilton standards';

-- ============================================================================
-- 3. WORK ORDER OVERHEAD COSTS
-- ============================================================================

-- Track overhead and facility costs
CREATE TABLE IF NOT EXISTS work_order_overhead (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timeline_event_id UUID REFERENCES timeline_events(id) ON DELETE CASCADE,
  
  -- Overhead breakdown
  facility_hours DECIMAL(6,2), -- Hours of shop space used
  facility_rate DECIMAL(8,2), -- Cost per hour of shop space
  facility_cost DECIMAL(10,2) GENERATED ALWAYS AS (COALESCE(facility_hours, 0) * COALESCE(facility_rate, 0)) STORED,
  
  utilities_cost DECIMAL(10,2) DEFAULT 0,
  insurance_allocation DECIMAL(10,2) DEFAULT 0,
  equipment_depreciation DECIMAL(10,2) DEFAULT 0,
  administrative_overhead DECIMAL(10,2) DEFAULT 0,
  
  -- Total overhead
  total_overhead DECIMAL(10,2) GENERATED ALWAYS AS (
    COALESCE(facility_hours * facility_rate, 0) +
    COALESCE(utilities_cost, 0) +
    COALESCE(insurance_allocation, 0) +
    COALESCE(equipment_depreciation, 0) +
    COALESCE(administrative_overhead, 0)
  ) STORED,
  
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(timeline_event_id)
);

CREATE INDEX idx_work_order_overhead_event ON work_order_overhead(timeline_event_id);

COMMENT ON TABLE work_order_overhead IS 'Overhead and facility costs for work orders';

-- ============================================================================
-- 4. WORK ORDER MATERIALS (separate from parts)
-- ============================================================================

-- Materials are consumables like sandpaper, tape, cleaning supplies, etc.
CREATE TABLE IF NOT EXISTS work_order_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timeline_event_id UUID REFERENCES timeline_events(id) ON DELETE CASCADE,
  
  material_name TEXT NOT NULL,
  material_category TEXT CHECK (material_category IN (
    'abrasive', 'adhesive', 'cleaning', 'masking', 'protective', 
    'welding_consumable', 'paint_consumable', 'fluid', 'other'
  )),
  
  quantity DECIMAL(10,2),
  unit TEXT, -- 'sheets', 'rolls', 'gallons', 'cans', etc.
  unit_cost DECIMAL(10,2),
  total_cost DECIMAL(10,2),
  
  supplier TEXT,
  ai_extracted BOOLEAN DEFAULT false,
  added_by UUID REFERENCES auth.users(id),
  
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_work_order_materials_event ON work_order_materials(timeline_event_id);
CREATE INDEX idx_work_order_materials_category ON work_order_materials(material_category);

COMMENT ON TABLE work_order_materials IS 'Consumable materials used in work (separate from parts)';

-- ============================================================================
-- 5. COMPREHENSIVE RECEIPT VIEW
-- ============================================================================

-- This view pulls together EVERYTHING for a complete receipt
CREATE OR REPLACE VIEW work_order_comprehensive_receipt AS
SELECT 
  te.id as event_id,
  te.vehicle_id,
  te.event_date,
  te.title,
  te.description,
  te.duration_hours,
  te.cost_amount,
  
  -- Attribution
  te.user_id as created_by,
  te.documented_by,
  te.primary_technician,
  te.service_provider_name,
  te.service_provider_type,
  
  -- Quality
  te.quality_rating,
  te.quality_justification,
  te.value_impact,
  te.ai_confidence_score,
  te.concerns,
  te.industry_standard_comparison,
  
  -- Participant count
  (SELECT COUNT(*) FROM event_participants WHERE event_id = te.id) as participant_count,
  
  -- Parts summary
  (SELECT COALESCE(SUM(total_price), 0) FROM work_order_parts WHERE timeline_event_id = te.id) as parts_total,
  (SELECT COUNT(*) FROM work_order_parts WHERE timeline_event_id = te.id) as parts_count,
  
  -- Labor summary
  (SELECT COALESCE(SUM(total_cost), 0) FROM work_order_labor WHERE timeline_event_id = te.id) as labor_total,
  (SELECT COALESCE(SUM(hours), 0) FROM work_order_labor WHERE timeline_event_id = te.id) as labor_hours_total,
  (SELECT COUNT(*) FROM work_order_labor WHERE timeline_event_id = te.id) as labor_tasks_count,
  
  -- Materials summary
  (SELECT COALESCE(SUM(total_cost), 0) FROM work_order_materials WHERE timeline_event_id = te.id) as materials_total,
  (SELECT COUNT(*) FROM work_order_materials WHERE timeline_event_id = te.id) as materials_count,
  
  -- Tools summary
  (SELECT COALESCE(SUM(depreciation_cost), 0) FROM event_tools_used WHERE event_id = te.id) as tools_total,
  (SELECT COUNT(*) FROM event_tools_used WHERE event_id = te.id) as tools_count,
  
  -- Overhead summary
  (SELECT total_overhead FROM work_order_overhead WHERE timeline_event_id = te.id LIMIT 1) as overhead_total,
  
  -- Evidence count
  (SELECT COUNT(*) 
   FROM vehicle_images 
   WHERE vehicle_id = te.vehicle_id 
   AND DATE(taken_at) = te.event_date) as evidence_count,
  
  -- Calculated total
  COALESCE((SELECT SUM(total_price) FROM work_order_parts WHERE timeline_event_id = te.id), 0) +
  COALESCE((SELECT SUM(total_cost) FROM work_order_labor WHERE timeline_event_id = te.id), 0) +
  COALESCE((SELECT SUM(total_cost) FROM work_order_materials WHERE timeline_event_id = te.id), 0) +
  COALESCE((SELECT SUM(depreciation_cost) FROM event_tools_used WHERE event_id = te.id), 0) +
  COALESCE((SELECT total_overhead FROM work_order_overhead WHERE timeline_event_id = te.id LIMIT 1), 0) as calculated_total

FROM timeline_events te;

COMMENT ON VIEW work_order_comprehensive_receipt IS 'Complete work order receipt with all costs and attribution';

-- ============================================================================
-- 6. HELPER FUNCTIONS FOR RECEIPT GENERATION
-- ============================================================================

-- Get all participants for an event
CREATE OR REPLACE FUNCTION get_event_participants_detailed(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', id,
        'role', role,
        'name', name,
        'user_id', user_id,
        'company', company
      )
    ), '[]'::jsonb)
    FROM event_participants
    WHERE event_id = p_event_id
  );
END;
$$;

-- Get device attribution for images in an event
CREATE OR REPLACE FUNCTION get_event_device_attribution(p_vehicle_id UUID, p_event_date DATE)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(jsonb_agg(DISTINCT
      jsonb_build_object(
        'device_fingerprint', da.device_fingerprint,
        'uploaded_by', da.uploaded_by_user_id,
        'contributor', da.actual_contributor_id,
        'ghost_user_id', da.ghost_user_id
      )
    ), '[]'::jsonb)
    FROM vehicle_images vi
    LEFT JOIN device_attributions da ON da.image_id = vi.id
    WHERE vi.vehicle_id = p_vehicle_id
    AND DATE(vi.taken_at) = p_event_date
    AND da.id IS NOT NULL
  );
END;
$$;

-- Get comprehensive cost breakdown for an event
CREATE OR REPLACE FUNCTION get_event_cost_breakdown(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'parts', jsonb_build_object(
      'items', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'id', id,
            'name', part_name,
            'brand', brand,
            'part_number', part_number,
            'quantity', quantity,
            'unit_price', unit_price,
            'total_price', total_price,
            'supplier', supplier,
            'ai_extracted', ai_extracted
          )
        ), '[]'::jsonb)
        FROM work_order_parts
        WHERE timeline_event_id = p_event_id
      ),
      'total', COALESCE((SELECT SUM(total_price) FROM work_order_parts WHERE timeline_event_id = p_event_id), 0)
    ),
    'labor', jsonb_build_object(
      'tasks', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'id', id,
            'task', task_name,
            'category', task_category,
            'hours', hours,
            'rate', hourly_rate,
            'total', total_cost,
            'difficulty', difficulty_rating,
            'industry_standard', industry_standard_hours,
            'ai_estimated', ai_estimated
          )
        ), '[]'::jsonb)
        FROM work_order_labor
        WHERE timeline_event_id = p_event_id
      ),
      'total', COALESCE((SELECT SUM(total_cost) FROM work_order_labor WHERE timeline_event_id = p_event_id), 0),
      'hours', COALESCE((SELECT SUM(hours) FROM work_order_labor WHERE timeline_event_id = p_event_id), 0)
    ),
    'materials', jsonb_build_object(
      'items', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'id', id,
            'name', material_name,
            'category', material_category,
            'quantity', quantity,
            'unit', unit,
            'unit_cost', unit_cost,
            'total_cost', total_cost
          )
        ), '[]'::jsonb)
        FROM work_order_materials
        WHERE timeline_event_id = p_event_id
      ),
      'total', COALESCE((SELECT SUM(total_cost) FROM work_order_materials WHERE timeline_event_id = p_event_id), 0)
    ),
    'tools', jsonb_build_object(
      'items', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'id', id,
            'tool_id', tool_id,
            'duration_minutes', duration_minutes,
            'depreciation_cost', depreciation_cost,
            'usage_context', usage_context
          )
        ), '[]'::jsonb)
        FROM event_tools_used
        WHERE event_id = p_event_id
      ),
      'total', COALESCE((SELECT SUM(depreciation_cost) FROM event_tools_used WHERE event_id = p_event_id), 0)
    ),
    'overhead', (
      SELECT jsonb_build_object(
        'facility_hours', facility_hours,
        'facility_rate', facility_rate,
        'facility_cost', facility_cost,
        'utilities_cost', utilities_cost,
        'total_overhead', total_overhead
      )
      FROM work_order_overhead
      WHERE timeline_event_id = p_event_id
      LIMIT 1
    )
  ) INTO v_result;
  
  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- ============================================================================
-- 7. RLS POLICIES
-- ============================================================================

-- Enable RLS
ALTER TABLE work_order_overhead ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_materials ENABLE ROW LEVEL SECURITY;

-- Public can view (matches work_order_parts/labor policies)
DROP POLICY IF EXISTS "Public can view work order overhead" ON work_order_overhead;
CREATE POLICY "Public can view work order overhead" ON work_order_overhead
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public can view work order materials" ON work_order_materials;
CREATE POLICY "Public can view work order materials" ON work_order_materials
  FOR SELECT USING (true);

-- Authenticated users can insert (their own)
DROP POLICY IF EXISTS "Authenticated users can insert overhead" ON work_order_overhead;
CREATE POLICY "Authenticated users can insert overhead" ON work_order_overhead
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can insert materials" ON work_order_materials;
CREATE POLICY "Authenticated users can insert materials" ON work_order_materials
  FOR INSERT WITH CHECK (auth.uid() = added_by);

-- Users can update own entries
DROP POLICY IF EXISTS "Users can update own overhead" ON work_order_overhead;
CREATE POLICY "Users can update own overhead" ON work_order_overhead
  FOR UPDATE USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users can update own materials" ON work_order_materials;
CREATE POLICY "Users can update own materials" ON work_order_materials
  FOR UPDATE USING (auth.uid() = added_by);

-- ============================================================================
-- 8. INDEXES FOR PERFORMANCE
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_timeline_events_documented_by ON timeline_events(documented_by);
CREATE INDEX IF NOT EXISTS idx_timeline_events_primary_tech ON timeline_events(primary_technician);
CREATE INDEX IF NOT EXISTS idx_timeline_events_quality ON timeline_events(quality_rating);
CREATE INDEX IF NOT EXISTS idx_vehicle_images_documented_by ON vehicle_images(documented_by_user_id);

COMMENT ON FUNCTION get_event_participants_detailed IS 'Returns all participants for an event as JSON';
COMMENT ON FUNCTION get_event_device_attribution IS 'Returns device attribution for images on a given date';
COMMENT ON FUNCTION get_event_cost_breakdown IS 'Returns complete cost breakdown with parts, labor, materials, tools, overhead';

