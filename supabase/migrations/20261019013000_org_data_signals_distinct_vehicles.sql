-- analyze_organization_data_signals() stores vehicles.total, which the organization page shows as the "Vehicles (N)" tab.
-- For organizations over 500 links it stored GREATEST(businesses.total_vehicles, link rows): Barrett-Jackson read 48,716,
-- the number of organization_vehicles rows, while 45,531 distinct vehicles are linked (2026-10-18 04:02Z; a vehicle
-- can hold several relationships to one organization). total_vehicles is counted from the links since
-- 20261019004500, so the quick count is the distinct linked vehicles. Rest of the body is unchanged from 20261018183000.
-- Revert: re-apply the function body from 20261018183000.
SET statement_timeout = '60s';
SET lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.analyze_organization_data_signals(p_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_signals JSONB;
  v_service_count INTEGER := 0;
  v_inventory_count INTEGER := 0;
  v_sold_count INTEGER := 0;
  v_vehicle_total INTEGER := 0;
  v_quick_count INTEGER := 0;
  v_org_total_vehicles INTEGER := 0;
  v_receipt_data RECORD;
  v_timeline_data RECORD;
  v_image_data RECORD;
  v_inferred_type TEXT;
  v_primary_focus TEXT;
  v_confidence NUMERIC := 0.0;
BEGIN
  SELECT COALESCE(total_vehicles, 0) INTO v_org_total_vehicles
  FROM businesses
  WHERE id = p_organization_id;

  SELECT COUNT(DISTINCT vehicle_id)::int INTO v_quick_count
  FROM organization_vehicles
  WHERE organization_id = p_organization_id;

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

  SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE te.event_type IN ('work', 'service', 'repair', 'maintenance')) as work_events,
    COALESCE(AVG(te.duration_hours), 0) as avg_duration
  INTO v_timeline_data
  FROM timeline_events te
  JOIN organization_vehicles ov ON ov.vehicle_id = te.vehicle_id
  WHERE ov.organization_id = p_organization_id;

  SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE vi.category IN ('work_in_progress', 'service')) as work_images,
    COUNT(*) FILTER (WHERE vi.category IN ('finished_work', 'completed')) as finished_images
  INTO v_image_data
  FROM vehicle_images vi
  JOIN organization_vehicles ov ON ov.vehicle_id = vi.vehicle_id
  WHERE ov.organization_id = p_organization_id;

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
      'total', GREATEST(v_org_total_vehicles, COALESCE(v_service_count + v_inventory_count, 0)),
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
