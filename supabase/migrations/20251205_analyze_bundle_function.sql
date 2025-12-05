-- Direct database function to analyze bundles
-- More reliable than edge function for meetings/demos

CREATE OR REPLACE FUNCTION analyze_bundle_direct(
  p_vehicle_id UUID,
  p_bundle_date DATE,
  p_device_fingerprint TEXT,
  p_organization_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_bundle_context JSONB;
  v_image_ids UUID[];
  v_image_count INT;
  v_result JSONB;
BEGIN
  -- Get bundle context
  SELECT get_bundle_context(p_vehicle_id, p_bundle_date, p_device_fingerprint)
  INTO v_bundle_context;

  IF v_bundle_context IS NULL OR v_bundle_context->'bundle'->'image_ids' IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No images found in bundle'
    );
  END IF;

  -- Extract image IDs (limit to 10)
  SELECT array_agg(id)
  INTO v_image_ids
  FROM unnest(
    ARRAY(SELECT jsonb_array_elements_text(v_bundle_context->'bundle'->'image_ids'))
  ) AS id
  LIMIT 10;

  v_image_count := array_length(v_image_ids, 1);

  IF v_image_count IS NULL OR v_image_count = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No valid image IDs found'
    );
  END IF;

  -- Return bundle info for manual analysis
  -- (The actual AI analysis needs to be done via edge function)
  RETURN jsonb_build_object(
    'success', true,
    'bundle', jsonb_build_object(
      'date', p_bundle_date,
      'device_fingerprint', p_device_fingerprint,
      'image_count', v_image_count,
      'image_ids', v_image_ids,
      'vehicle_id', p_vehicle_id,
      'organization_id', p_organization_id
    ),
    'next_step', 'Call generate-work-logs edge function with these image_ids',
    'command', format(
      'node scripts/analyze-bundle-safe.js %s %s %s %s',
      p_vehicle_id,
      p_bundle_date,
      p_device_fingerprint,
      p_organization_id
    )
  );
END;
$$;

COMMENT ON FUNCTION analyze_bundle_direct IS 'Gets bundle info for analysis - use with generate-work-logs edge function';

