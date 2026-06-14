-- Drift repair (catch-up): commit two org-intelligence functions so the
-- migration history is self-contained and matches production.
--
-- Verified against prod 2026-06-14 (pg_get_functiondef):
--   * public.compute_and_store_primary_focus(uuid) existed in NO migration at
--     all — pure drift. Deployed, never committed.
--   * public.analyze_organization_data_signals(uuid) WAS committed (20251206,
--     20251216000010) but the committed body is STALE: prod was later
--     hand-patched (added the >500-vehicle short-circuit, dropped the
--     receipt_links labor/parts subqueries, became SECURITY DEFINER) with no
--     migration. This re-commits the current prod definition so a rebuild ends
--     in the deployed state, not the old one.
--
-- Both are SECURITY DEFINER and had search_path = <none> in prod; pinned to
-- `public, pg_temp` here (every object they touch is in public/pg_catalog, so
-- the pin is behavior-preserving) and the internal cross-call is schema-
-- qualified. CREATE OR REPLACE keeps it idempotent and preserves existing
-- prod grants. PR #258 hardened the trigger that calls these; this closes the
-- loop CodeRabbit flagged.

CREATE OR REPLACE FUNCTION public.analyze_organization_data_signals(p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_signals JSONB;
  v_service_count INTEGER := 0;
  v_inventory_count INTEGER := 0;
  v_sold_count INTEGER := 0;
  v_vehicle_total INTEGER := 0;
  v_quick_count INTEGER := 0;
  v_receipt_data RECORD;
  v_timeline_data RECORD;
  v_image_data RECORD;
  v_inferred_type TEXT;
  v_primary_focus TEXT;
  v_confidence NUMERIC := 0.0;
BEGIN
  -- FAST SIZE CHECK: cheap count without joining vehicles table
  SELECT COUNT(*) INTO v_quick_count
  FROM organization_vehicles
  WHERE organization_id = p_organization_id
  LIMIT 1;

  -- Short-circuit for large orgs (auction platforms, etc.)
  IF v_quick_count > 500 THEN
    v_signals := jsonb_build_object(
      'vehicles', jsonb_build_object('total', v_quick_count, 'service', 0, 'inventory', 0, 'sold', 0),
      'receipts', jsonb_build_object('total', 0, 'with_labor', 0, 'with_parts', 0, 'avg_value', 0, 'total_investment', 0),
      'timeline', jsonb_build_object('total_events', 0, 'work_events', 0, 'avg_duration_hours', 0),
      'images', jsonb_build_object('total', 0, 'work_in_progress', 0, 'finished_work', 0),
      'inferred_type', 'auction_platform',
      'primary_focus', 'marketplace',
      'confidence', 0.95,
      'skipped_deep_analysis', true,
      'reason', 'org_too_large_for_row_scan',
      'analyzed_at', NOW()
    );

    UPDATE businesses
    SET data_signals = v_signals, intelligence_last_updated = NOW()
    WHERE id = p_organization_id;

    RETURN v_signals;
  END IF;

  -- Count vehicles by relationship type (only for small orgs)
  SELECT
    COUNT(*) FILTER (WHERE ov.relationship_type IN ('service_provider', 'work_location')) as service,
    COUNT(*) FILTER (WHERE ov.relationship_type IN ('in_stock', 'consigner', 'owner', 'current_consignment')) as inventory,
    COUNT(*) FILTER (WHERE v.sale_date IS NOT NULL OR v.sale_price IS NOT NULL) as sold,
    COUNT(*) as total
  INTO v_service_count, v_inventory_count, v_sold_count, v_vehicle_total
  FROM organization_vehicles ov
  JOIN vehicles v ON v.id = ov.vehicle_id
  WHERE ov.organization_id = p_organization_id
    AND ov.status = 'active';

  -- Analyze receipts (receipt_links table was dropped — skip labor/parts subqueries)
  SELECT
    COUNT(*) as total,
    0 as with_labor,
    0 as with_parts,
    COALESCE(AVG(r.total), 0) as avg_value,
    COALESCE(SUM(r.total), 0) as total_investment
  INTO v_receipt_data
  FROM receipts r
  WHERE r.scope_type = 'org'
    AND r.scope_id::uuid = p_organization_id;

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
    v_inferred_type := 'body_shop'; v_primary_focus := 'service'; v_confidence := 0.8;
  ELSIF v_inventory_count > v_service_count * 2 THEN
    v_inferred_type := 'dealership'; v_primary_focus := 'inventory'; v_confidence := 0.8;
  ELSIF v_service_count > 0 AND v_receipt_data.total > 0 THEN
    v_inferred_type := 'garage'; v_primary_focus := 'service'; v_confidence := 0.6;
  ELSIF v_inventory_count > 0 THEN
    v_inferred_type := 'dealership'; v_primary_focus := 'inventory'; v_confidence := 0.6;
  ELSE
    v_inferred_type := 'unknown'; v_primary_focus := 'mixed'; v_confidence := 0.3;
  END IF;

  v_signals := jsonb_build_object(
    'vehicles', jsonb_build_object(
      'total', COALESCE(v_service_count + v_inventory_count, 0),
      'service', v_service_count, 'inventory', v_inventory_count, 'sold', v_sold_count
    ),
    'receipts', jsonb_build_object(
      'total', COALESCE(v_receipt_data.total, 0), 'with_labor', COALESCE(v_receipt_data.with_labor, 0),
      'with_parts', COALESCE(v_receipt_data.with_parts, 0), 'avg_value', COALESCE(v_receipt_data.avg_value, 0),
      'total_investment', COALESCE(v_receipt_data.total_investment, 0)
    ),
    'timeline', jsonb_build_object(
      'total_events', COALESCE(v_timeline_data.total, 0), 'work_events', COALESCE(v_timeline_data.work_events, 0),
      'avg_duration_hours', COALESCE(v_timeline_data.avg_duration, 0)
    ),
    'images', jsonb_build_object(
      'total', COALESCE(v_image_data.total, 0), 'work_in_progress', COALESCE(v_image_data.work_images, 0),
      'finished_work', COALESCE(v_image_data.finished_images, 0)
    ),
    'inferred_type', v_inferred_type, 'primary_focus', v_primary_focus,
    'confidence', v_confidence, 'analyzed_at', NOW()
  );

  UPDATE businesses SET data_signals = v_signals, intelligence_last_updated = NOW()
  WHERE id = p_organization_id;

  RETURN v_signals;
END;
$function$;

CREATE OR REPLACE FUNCTION public.compute_and_store_primary_focus(p_organization_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_org RECORD;
  v_computed_focus TEXT;
  v_config JSONB;
BEGIN
  -- Get organization with all relevant fields
  SELECT 
    id,
    business_type,
    ui_config,
    data_signals
  INTO v_org
  FROM businesses
  WHERE id = p_organization_id;
  
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  
  -- Priority 1: Explicit UI config (user manually set - respect this!)
  IF v_org.ui_config IS NOT NULL 
     AND v_org.ui_config != '{}'::jsonb 
     AND v_org.ui_config->>'primary_focus' IS NOT NULL THEN
    v_computed_focus := v_org.ui_config->>'primary_focus';
    
    -- Validate it's a valid value
    IF v_computed_focus NOT IN ('service', 'inventory', 'collection', 'auctions', 'mixed') THEN
      v_computed_focus := 'mixed';
    END IF;
    
    -- Update the column
    UPDATE businesses
    SET primary_focus = v_computed_focus
    WHERE id = p_organization_id;
    
    RETURN v_computed_focus;
  END IF;
  
  -- Priority 2: Infer from explicit business_type
  IF v_org.business_type IS NOT NULL AND v_org.business_type != 'other' THEN
    v_computed_focus := CASE
      WHEN v_org.business_type IN ('body_shop', 'garage', 'restoration_shop', 'performance_shop', 'detailing', 'mobile_service') THEN 'service'
      WHEN v_org.business_type = 'dealership' THEN 'inventory'
      WHEN v_org.business_type = 'auction_house' THEN 'auctions'
      WHEN v_org.business_type IN ('parts_supplier', 'fabrication', 'racing_team') THEN 'service'
      ELSE 'mixed'
    END;
    
    -- Update the column
    UPDATE businesses
    SET primary_focus = v_computed_focus
    WHERE id = p_organization_id;
    
    RETURN v_computed_focus;
  END IF;
  
  -- Priority 3: Data-driven analysis (analyze actual productivity)
  -- First, try to get from existing data_signals if recent
  IF v_org.data_signals IS NOT NULL 
     AND v_org.data_signals != '{}'::jsonb 
     AND v_org.data_signals->>'primary_focus' IS NOT NULL THEN
    v_computed_focus := v_org.data_signals->>'primary_focus';
    
    -- Validate it's a valid value
    IF v_computed_focus NOT IN ('service', 'inventory', 'collection', 'auctions', 'mixed') THEN
      v_computed_focus := 'mixed';
    END IF;
    
    -- Update the column
    UPDATE businesses
    SET primary_focus = v_computed_focus
    WHERE id = p_organization_id;
    
    RETURN v_computed_focus;
  END IF;
  
  -- If no data signals, try to compute them (but catch errors gracefully)
  BEGIN
    PERFORM public.analyze_organization_data_signals(p_organization_id);
    
    -- Get the updated data_signals
    SELECT data_signals INTO v_org.data_signals
    FROM businesses
    WHERE id = p_organization_id;
    
    IF v_org.data_signals IS NOT NULL 
       AND v_org.data_signals != '{}'::jsonb 
       AND v_org.data_signals->>'primary_focus' IS NOT NULL THEN
      v_computed_focus := v_org.data_signals->>'primary_focus';
      
      -- Validate it's a valid value
      IF v_computed_focus NOT IN ('service', 'inventory', 'collection', 'auctions', 'mixed') THEN
        v_computed_focus := 'mixed';
      END IF;
    ELSE
      v_computed_focus := 'mixed';
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      -- If analysis fails, default to mixed
      v_computed_focus := 'mixed';
  END;
  
  -- Update the column
  UPDATE businesses
  SET primary_focus = v_computed_focus
  WHERE id = p_organization_id;
  
  RETURN v_computed_focus;
END;
$function$;
