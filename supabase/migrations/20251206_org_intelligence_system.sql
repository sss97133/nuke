-- ============================================================================
-- ORGANIZATION INTELLIGENCE SYSTEM
-- ============================================================================
-- 
-- Data-driven UI configuration that RESPECTS explicit settings
-- Priority: Explicit UI Config > Explicit Business Type > Data-Driven
-- Never overwrites user choices, only enhances when missing
--
-- ============================================================================

-- Add intelligence fields to businesses table (ADDITIVE - doesn't break existing)
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS data_signals JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ui_config JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS intelligence_last_updated TIMESTAMPTZ;

COMMENT ON COLUMN businesses.data_signals IS 'Auto-analyzed data patterns (vehicles, receipts, timeline events)';
COMMENT ON COLUMN businesses.ui_config IS 'Explicit UI preferences set by org (overrides everything if set)';
COMMENT ON COLUMN businesses.intelligence_last_updated IS 'When data_signals were last calculated';

-- ============================================================================
-- FUNCTION: Analyze Organization Data Signals
-- ============================================================================
-- Analyzes actual data to infer org type/focus (only used if explicit missing)
CREATE OR REPLACE FUNCTION analyze_organization_data_signals(
  p_organization_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_signals JSONB;
  v_service_count INTEGER := 0;
  v_inventory_count INTEGER := 0;
  v_sold_count INTEGER := 0;
  v_receipt_data RECORD;
  v_timeline_data RECORD;
  v_image_data RECORD;
  v_inferred_type TEXT;
  v_primary_focus TEXT;
  v_confidence NUMERIC := 0.0;
BEGIN
  -- Count vehicles by relationship type
  SELECT 
    COUNT(*) FILTER (WHERE ov.relationship_type IN ('service_provider', 'work_location')) as service,
    COUNT(*) FILTER (WHERE ov.relationship_type IN ('in_stock', 'consigner', 'owner', 'current_consignment')) as inventory,
    COUNT(*) FILTER (WHERE v.sale_date IS NOT NULL OR v.sale_price IS NOT NULL) as sold,
    COUNT(*) as total
  INTO v_service_count, v_inventory_count, v_sold_count
  FROM organization_vehicles ov
  JOIN vehicles v ON v.id = ov.vehicle_id
  WHERE ov.organization_id = p_organization_id
    AND ov.status = 'active';
  
  -- Analyze receipts
  SELECT 
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM work_order_labor wol 
      WHERE wol.receipt_id = r.id
    )) as with_labor,
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM work_order_parts wop 
      WHERE wop.receipt_id = r.id
    )) as with_parts,
    COALESCE(AVG(r.total), 0) as avg_value,
    COALESCE(SUM(r.total), 0) as total_investment
  INTO v_receipt_data
  FROM receipts r
  WHERE r.scope_type = 'org' AND r.scope_id = p_organization_id;
  
  -- Analyze timeline events
  SELECT 
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE te.event_type IN ('work', 'service', 'repair', 'maintenance')) as work_events,
    COALESCE(AVG(te.duration_hours), 0) as avg_duration
  INTO v_timeline_data
  FROM timeline_events te
  JOIN organization_vehicles ov ON ov.vehicle_id = te.vehicle_id
  WHERE ov.organization_id = p_organization_id;
  
  -- Analyze images
  SELECT 
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE vi.category IN ('work_in_progress', 'service')) as work_images,
    COUNT(*) FILTER (WHERE vi.category IN ('finished_work', 'completed')) as finished_images
  INTO v_image_data
  FROM vehicle_images vi
  JOIN organization_vehicles ov ON ov.vehicle_id = vi.vehicle_id
  WHERE ov.organization_id = p_organization_id;
  
  -- Infer type based on patterns
  IF v_service_count > v_inventory_count * 2 AND v_receipt_data.with_labor > 0 THEN
    v_inferred_type := 'body_shop';
    v_primary_focus := 'service';
    v_confidence := 0.8;
  ELSIF v_inventory_count > v_service_count * 2 THEN
    v_inferred_type := 'dealer';
    v_primary_focus := 'inventory';
    v_confidence := 0.8;
  ELSIF v_service_count > 0 AND v_receipt_data.total > 0 THEN
    v_inferred_type := 'garage';
    v_primary_focus := 'service';
    v_confidence := 0.6;
  ELSIF v_inventory_count > 0 THEN
    v_inferred_type := 'dealer';
    v_primary_focus := 'inventory';
    v_confidence := 0.6;
  ELSE
    v_inferred_type := 'unknown';
    v_primary_focus := 'mixed';
    v_confidence := 0.3;
  END IF;
  
  -- Build signals object
  v_signals := jsonb_build_object(
    'vehicles', jsonb_build_object(
      'total', COALESCE(v_service_count + v_inventory_count, 0),
      'service', v_service_count,
      'inventory', v_inventory_count,
      'sold', v_sold_count
    ),
    'receipts', jsonb_build_object(
      'total', COALESCE(v_receipt_data.total, 0),
      'with_labor', COALESCE(v_receipt_data.with_labor, 0),
      'with_parts', COALESCE(v_receipt_data.with_parts, 0),
      'avg_value', COALESCE(v_receipt_data.avg_value, 0),
      'total_investment', COALESCE(v_receipt_data.total_investment, 0)
    ),
    'timeline', jsonb_build_object(
      'total_events', COALESCE(v_timeline_data.total, 0),
      'work_events', COALESCE(v_timeline_data.work_events, 0),
      'avg_duration_hours', COALESCE(v_timeline_data.avg_duration, 0)
    ),
    'images', jsonb_build_object(
      'total', COALESCE(v_image_data.total, 0),
      'work_in_progress', COALESCE(v_image_data.work_images, 0),
      'finished_work', COALESCE(v_image_data.finished_images, 0)
    ),
    'inferred_type', v_inferred_type,
    'primary_focus', v_primary_focus,
    'confidence', v_confidence,
    'analyzed_at', NOW()
  );
  
  -- Update businesses table with signals
  UPDATE businesses
  SET 
    data_signals = v_signals,
    intelligence_last_updated = NOW()
  WHERE id = p_organization_id;
  
  RETURN v_signals;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION analyze_organization_data_signals IS 
  'Analyzes org data to infer type/focus. Only used if explicit settings missing.';

-- ============================================================================
-- FUNCTION: Get Effective Org Configuration
-- ============================================================================
-- Returns UI config respecting priority: Explicit UI Config > Business Type > Data-Driven
CREATE OR REPLACE FUNCTION get_effective_org_config(
  p_organization_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_org RECORD;
  v_ui_config JSONB;
  v_explicit_type TEXT;
  v_explicit_specializations TEXT[];
  v_data_signals JSONB;
  v_final_config JSONB;
BEGIN
  -- Get org with all relevant fields
  SELECT 
    business_type,
    specializations,
    services_offered,
    ui_config,
    data_signals
  INTO v_org
  FROM businesses
  WHERE id = p_organization_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Organization not found');
  END IF;
  
  -- Priority 1: Explicit UI config (user manually set)
  IF v_org.ui_config IS NOT NULL AND v_org.ui_config != '{}'::jsonb THEN
    RETURN jsonb_build_object(
      'source', 'explicit_ui_config',
      'config', v_org.ui_config,
      'respect_explicit', true,
      'effective_type', v_org.ui_config->>'type',
      'effective_primary_focus', v_org.ui_config->>'primary_focus'
    );
  END IF;
  
  -- Priority 2: Explicit business_type/specializations
  v_explicit_type := v_org.business_type;
  v_explicit_specializations := COALESCE(v_org.specializations, ARRAY[]::TEXT[]);
  
  IF v_explicit_type IS NOT NULL AND v_explicit_type != 'other' THEN
    -- Infer UI config from explicit business type
    v_final_config := jsonb_build_object(
      'type', v_explicit_type,
      'primary_focus', CASE
        WHEN v_explicit_type IN ('body_shop', 'garage', 'restoration_shop', 'performance_shop') THEN 'service'
        WHEN v_explicit_type = 'dealership' THEN 'inventory'
        ELSE 'mixed'
      END,
      'specializations', to_jsonb(v_explicit_specializations)
    );
    
    RETURN jsonb_build_object(
      'source', 'explicit_business_type',
      'config', v_final_config,
      'respect_explicit', true,
      'effective_type', v_explicit_type,
      'effective_primary_focus', v_final_config->>'primary_focus'
    );
  END IF;
  
  -- Priority 3: Data-driven (only if no explicit settings)
  v_data_signals := COALESCE(v_org.data_signals, '{}'::jsonb);
  
  -- If no data signals, analyze now
  IF v_data_signals = '{}'::jsonb OR v_data_signals IS NULL THEN
    v_data_signals := analyze_organization_data_signals(p_organization_id);
  END IF;
  
  IF v_data_signals != '{}'::jsonb AND v_data_signals->>'inferred_type' IS NOT NULL THEN
    v_final_config := jsonb_build_object(
      'type', v_data_signals->>'inferred_type',
      'primary_focus', v_data_signals->>'primary_focus',
      'confidence', (v_data_signals->>'confidence')::NUMERIC
    );
    
    RETURN jsonb_build_object(
      'source', 'data_driven',
      'config', v_final_config,
      'respect_explicit', false,
      'effective_type', v_data_signals->>'inferred_type',
      'effective_primary_focus', v_data_signals->>'primary_focus',
      'data_signals', v_data_signals
    );
  END IF;
  
  -- Fallback: Default config
  RETURN jsonb_build_object(
    'source', 'default',
    'config', jsonb_build_object(
      'type', 'unknown',
      'primary_focus', 'mixed'
    ),
    'respect_explicit', false,
    'effective_type', 'unknown',
    'effective_primary_focus', 'mixed'
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_effective_org_config IS 
  'Returns effective UI config respecting priority: Explicit UI Config > Business Type > Data-Driven';

-- ============================================================================
-- FUNCTION: Get Service Vehicles for Org
-- ============================================================================
-- Returns vehicles with receipt summaries for service-focused display
CREATE OR REPLACE FUNCTION get_service_vehicles_for_org(
  p_organization_id UUID
)
RETURNS TABLE (
  vehicle_id UUID,
  vehicle_info JSONB,
  receipts JSONB,
  total_investment NUMERIC,
  total_days INTEGER,
  total_labor_hours NUMERIC,
  job_count INTEGER,
  current_status TEXT,
  primary_image_url TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH service_vehicles AS (
    SELECT DISTINCT ov.vehicle_id
    FROM organization_vehicles ov
    WHERE ov.organization_id = p_organization_id
      AND ov.relationship_type IN ('service_provider', 'work_location')
      AND ov.status = 'active'
  ),
  vehicle_receipts AS (
    SELECT 
      sv.vehicle_id,
      r.id as receipt_id,
      r.receipt_date,
      r.total,
      r.status,
      COALESCE(SUM(wol.hours), 0) as labor_hours,
      COALESCE(SUM(wop.total_price), 0) as parts_cost,
      COALESCE(SUM(wol.total_cost), 0) as labor_cost,
      MAX(te.title) as work_description
    FROM service_vehicles sv
    LEFT JOIN receipts r ON r.scope_type = 'vehicle' AND r.scope_id = sv.vehicle_id
    LEFT JOIN work_order_labor wol ON wol.receipt_id = r.id
    LEFT JOIN work_order_parts wop ON wop.receipt_id = r.id
    LEFT JOIN timeline_events te ON te.id = (
      SELECT id FROM timeline_events 
      WHERE vehicle_id = sv.vehicle_id 
        AND event_date = r.receipt_date 
      LIMIT 1
    )
    GROUP BY sv.vehicle_id, r.id, r.receipt_date, r.total, r.status
  )
  SELECT 
    v.id as vehicle_id,
    jsonb_build_object(
      'year', v.year,
      'make', v.make,
      'model', v.model,
      'vin', v.vin
    ) as vehicle_info,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', vr.receipt_id,
          'date', vr.receipt_date,
          'total', vr.total,
          'status', vr.status,
          'labor_hours', vr.labor_hours,
          'parts_cost', vr.parts_cost,
          'labor_cost', vr.labor_cost,
          'work_description', vr.work_description
        )
        ORDER BY vr.receipt_date DESC
      ) FILTER (WHERE vr.receipt_id IS NOT NULL),
      '[]'::jsonb
    ) as receipts,
    COALESCE(SUM(vr.total), 0) as total_investment,
    CASE 
      WHEN MIN(vr.receipt_date) IS NOT NULL AND MAX(vr.receipt_date) IS NOT NULL
      THEN EXTRACT(DAY FROM (MAX(vr.receipt_date) - MIN(vr.receipt_date)))::INTEGER
      ELSE 0
    END as total_days,
    COALESCE(SUM(vr.labor_hours), 0) as total_labor_hours,
    COUNT(vr.receipt_id) as job_count,
    CASE 
      WHEN MAX(vr.receipt_date) > CURRENT_DATE - INTERVAL '30 days' THEN 'in_progress'
      WHEN COUNT(*) FILTER (WHERE vr.status = 'completed') = COUNT(*) AND COUNT(*) > 0 THEN 'completed'
      WHEN COUNT(*) > 0 THEN 'on_hold'
      ELSE 'pending'
    END as current_status,
    (
      SELECT image_url 
      FROM vehicle_images vi
      WHERE vi.vehicle_id = v.id
        AND (vi.category IN ('work_in_progress', 'service') OR vi.category IS NULL)
      ORDER BY vi.taken_at DESC NULLS LAST, vi.created_at DESC
      LIMIT 1
    ) as primary_image_url
  FROM service_vehicles sv
  JOIN vehicles v ON v.id = sv.vehicle_id
  LEFT JOIN vehicle_receipts vr ON vr.vehicle_id = v.id
  GROUP BY v.id, v.year, v.make, v.model, v.vin;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_service_vehicles_for_org IS 
  'Returns service vehicles with receipt summaries for service-focused org display';

-- Grant permissions
GRANT EXECUTE ON FUNCTION analyze_organization_data_signals(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_effective_org_config(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_service_vehicles_for_org(UUID) TO authenticated;

