-- Create or replace get_image_scan_stats function
-- This function calculates how many images have been analyzed

CREATE OR REPLACE FUNCTION get_image_scan_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_stats JSONB;
  v_total_vehicle_images INTEGER;
  v_scanned_vehicle_images INTEGER;
  v_unscanned_vehicle_images INTEGER;
  v_total_org_images INTEGER;
  v_scanned_org_images INTEGER;
  v_unscanned_org_images INTEGER;
  v_last_scanned_at TIMESTAMPTZ;
  v_scan_percentage DECIMAL;
BEGIN
  -- Count total vehicle images (excluding documents)
  SELECT COUNT(*) INTO v_total_vehicle_images
  FROM vehicle_images
  WHERE (is_document IS NULL OR is_document = false);

  -- Count scanned vehicle images
  -- An image is considered "scanned" if it has ANY of:
  -- 1. ai_scan_metadata->appraiser->primary_label (from process-all-images-cron)
  -- 2. ai_scan_metadata->tier_1_analysis (from tiered processing)
  -- 3. ai_scan_metadata->appraiser object (any appraiser data)
  -- 4. ai_last_scanned timestamp set
  -- 5. ai_scan_metadata with scanned_at timestamp
  SELECT COUNT(*) INTO v_scanned_vehicle_images
  FROM vehicle_images
  WHERE (is_document IS NULL OR is_document = false)
    AND (
      (ai_scan_metadata->'appraiser'->>'primary_label' IS NOT NULL)
      OR (ai_scan_metadata->'tier_1_analysis' IS NOT NULL)
      OR (ai_scan_metadata->'appraiser' IS NOT NULL)
      OR (ai_last_scanned IS NOT NULL)
      OR (ai_scan_metadata->>'scanned_at' IS NOT NULL)
      OR (ai_scan_metadata->'appraiser'->>'analyzed_at' IS NOT NULL)
    );

  v_unscanned_vehicle_images := v_total_vehicle_images - v_scanned_vehicle_images;

  -- Count organization images
  SELECT COUNT(*) INTO v_total_org_images
  FROM organization_images;

  -- Count scanned organization images
  SELECT COUNT(*) INTO v_scanned_org_images
  FROM organization_images
  WHERE ai_scanned = true OR ai_scan_date IS NOT NULL;

  v_unscanned_org_images := v_total_org_images - v_scanned_org_images;

  -- Get last scan timestamp
  SELECT MAX(ai_last_scanned) INTO v_last_scanned_at
  FROM vehicle_images
  WHERE ai_last_scanned IS NOT NULL;

  -- Calculate percentage
  IF v_total_vehicle_images > 0 THEN
    v_scan_percentage := ROUND((v_scanned_vehicle_images::DECIMAL / v_total_vehicle_images::DECIMAL) * 100, 1);
  ELSE
    v_scan_percentage := 0;
  END IF;

  -- Build result
  v_stats := jsonb_build_object(
    'total_vehicle_images', v_total_vehicle_images,
    'scanned_vehicle_images', v_scanned_vehicle_images,
    'unscanned_vehicle_images', v_unscanned_vehicle_images,
    'total_org_images', v_total_org_images,
    'scanned_org_images', v_scanned_org_images,
    'unscanned_org_images', v_unscanned_org_images,
    'last_scanned_at', v_last_scanned_at,
    'scan_percentage', v_scan_percentage
  );

  RETURN v_stats;
END;
$$;

COMMENT ON FUNCTION get_image_scan_stats() IS 
  'Returns statistics about image analysis progress. An image is considered scanned if it has appraiser.primary_label, tier_1_analysis, or ai_last_scanned timestamp.';

