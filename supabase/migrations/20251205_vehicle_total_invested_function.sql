-- ============================================
-- VEHICLE TOTAL INVESTED CALCULATION
-- ============================================
-- Calculates total investment from all work orders, parts, labor, and materials
-- This ensures the price reflects all modifications that took place

CREATE OR REPLACE FUNCTION get_vehicle_total_invested(p_vehicle_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_parts_total DECIMAL(10,2) := 0;
  v_labor_total DECIMAL(10,2) := 0;
  v_materials_total DECIMAL(10,2) := 0;
  v_overhead_total DECIMAL(10,2) := 0;
  v_tools_total DECIMAL(10,2) := 0;
  v_financial_records_total DECIMAL(10,2) := 0;
  v_total_invested DECIMAL(10,2) := 0;
  v_result JSONB;
BEGIN
  -- Sum all parts costs from work_order_parts
  SELECT COALESCE(SUM(total_price), 0)
  INTO v_parts_total
  FROM work_order_parts wop
  JOIN timeline_events te ON te.id = wop.timeline_event_id
  WHERE te.vehicle_id = p_vehicle_id;

  -- Sum all labor costs from work_order_labor
  SELECT COALESCE(SUM(total_cost), 0)
  INTO v_labor_total
  FROM work_order_labor wol
  JOIN timeline_events te ON te.id = wol.timeline_event_id
  WHERE te.vehicle_id = p_vehicle_id;

  -- Sum all materials costs from work_order_materials
  SELECT COALESCE(SUM(total_cost), 0)
  INTO v_materials_total
  FROM work_order_materials wom
  JOIN timeline_events te ON te.id = wom.timeline_event_id
  WHERE te.vehicle_id = p_vehicle_id;

  -- Sum all overhead costs from work_order_overhead
  SELECT COALESCE(SUM(total_overhead), 0)
  INTO v_overhead_total
  FROM work_order_overhead woo
  JOIN timeline_events te ON te.id = woo.timeline_event_id
  WHERE te.vehicle_id = p_vehicle_id;

  -- Sum all tool depreciation costs from event_tools_used
  SELECT COALESCE(SUM(depreciation_cost), 0)
  INTO v_tools_total
  FROM event_tools_used etu
  JOIN timeline_events te ON te.id = etu.event_id
  WHERE te.vehicle_id = p_vehicle_id;

  -- Sum all costs from event_financial_records (comprehensive financial tracking)
  SELECT COALESCE(SUM(total_cost), 0)
  INTO v_financial_records_total
  FROM event_financial_records efr
  JOIN timeline_events te ON te.id = efr.event_id
  WHERE te.vehicle_id = p_vehicle_id;

  -- Calculate total invested (use the higher of financial_records total or sum of components)
  v_total_invested := GREATEST(
    v_financial_records_total,
    v_parts_total + v_labor_total + v_materials_total + v_overhead_total + v_tools_total
  );

  -- Build result JSON
  v_result := jsonb_build_object(
    'total_invested', v_total_invested,
    'breakdown', jsonb_build_object(
      'parts', v_parts_total,
      'labor', v_labor_total,
      'materials', v_materials_total,
      'overhead', v_overhead_total,
      'tools', v_tools_total,
      'financial_records_total', v_financial_records_total
    ),
    'components_count', jsonb_build_object(
      'parts_items', (SELECT COUNT(*) FROM work_order_parts wop JOIN timeline_events te ON te.id = wop.timeline_event_id WHERE te.vehicle_id = p_vehicle_id),
      'labor_tasks', (SELECT COUNT(*) FROM work_order_labor wol JOIN timeline_events te ON te.id = wol.timeline_event_id WHERE te.vehicle_id = p_vehicle_id),
      'materials_items', (SELECT COUNT(*) FROM work_order_materials wom JOIN timeline_events te ON te.id = wom.timeline_event_id WHERE te.vehicle_id = p_vehicle_id),
      'events_with_work', (SELECT COUNT(DISTINCT te.id) FROM timeline_events te WHERE te.vehicle_id = p_vehicle_id AND EXISTS (SELECT 1 FROM work_order_parts wop WHERE wop.timeline_event_id = te.id) OR EXISTS (SELECT 1 FROM work_order_labor wol WHERE wol.timeline_event_id = te.id))
    )
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_vehicle_total_invested IS 'Calculates total investment from all work orders, parts, labor, materials, and overhead. Ensures price reflects all modifications.';

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_timeline_events_vehicle_id ON timeline_events(vehicle_id);

