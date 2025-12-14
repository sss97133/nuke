-- Vehicle AI cost metrics (cheap to query, no guessing).
-- Canonical: sum(vehicle_images.total_processing_cost) per vehicle.

CREATE OR REPLACE FUNCTION public.get_vehicle_ai_cost(p_vehicle_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'image_count', COUNT(*)::INTEGER,
    'images_scanned_count', COUNT(*) FILTER (
      WHERE (ai_processing_status IN ('complete', 'completed'))
    )::INTEGER,
    'total_openai_cost_usd_est', COALESCE(SUM(COALESCE(total_processing_cost, 0)), 0)::NUMERIC,
    'last_image_scanned_at', MAX(ai_processing_completed_at)
  )
  FROM public.vehicle_images
  WHERE vehicle_id = p_vehicle_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_vehicle_ai_cost(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_vehicle_ai_cost IS 'Returns estimated OpenAI cost for a vehicle, derived from vehicle_images.total_processing_cost (populated by analyze-image).';


