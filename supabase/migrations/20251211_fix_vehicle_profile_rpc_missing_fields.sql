-- Fix get_vehicle_profile_data RPC to include external_listings and price_signal
-- These fields are expected by the frontend but were missing from the RPC response

CREATE OR REPLACE FUNCTION public.get_vehicle_profile_data(p_vehicle_id UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  -- Build complete vehicle profile data in one query
  SELECT json_build_object(
    'vehicle', (
      SELECT row_to_json(v.*) 
      FROM public.vehicles v 
      WHERE v.id = p_vehicle_id
    ),
    'images', (
      SELECT COALESCE(json_agg(vi.* ORDER BY vi.position, vi.created_at), '[]'::json)
      FROM public.vehicle_images vi 
      WHERE vi.vehicle_id = p_vehicle_id
    ),
    'timeline_events', (
      SELECT COALESCE(json_agg(te.* ORDER BY te.event_date DESC), '[]'::json)
      FROM public.timeline_events te 
      WHERE te.vehicle_id = p_vehicle_id
    ),
    'comments', (
      SELECT COALESCE(json_agg(vc.* ORDER BY vc.created_at DESC), '[]'::json)
      FROM public.vehicle_comments vc 
      WHERE vc.vehicle_id = p_vehicle_id
    ),
    'latest_valuation', (
      SELECT row_to_json(vv.*) 
      FROM public.vehicle_valuations vv 
      WHERE vv.vehicle_id = p_vehicle_id 
      ORDER BY vv.valuation_date DESC 
      LIMIT 1
    ),
    'price_history', (
      SELECT COALESCE(json_agg(vph.* ORDER BY vph.created_at DESC), '[]'::json)
      FROM public.vehicle_price_history vph
      WHERE vph.vehicle_id = p_vehicle_id
      LIMIT 100
    ),
    'documents', (
      SELECT COALESCE(json_agg(vd.* ORDER BY vd.document_date DESC), '[]'::json)
      FROM public.vehicle_documents vd
      WHERE vd.vehicle_id = p_vehicle_id
        AND vd.privacy_level != 'restricted'
    ),
    'external_listings', (
      SELECT COALESCE(json_agg(el.* ORDER BY el.created_at DESC), '[]'::json)
      FROM public.external_listings el
      WHERE el.vehicle_id = p_vehicle_id
    ),
    'price_signal', (
      SELECT row_to_json(vps.*)
      FROM public.vehicle_price_signal_view vps
      WHERE vps.vehicle_id = p_vehicle_id
      LIMIT 1
    ),
    -- Computed stats
    'stats', json_build_object(
      'image_count', (SELECT COUNT(*) FROM public.vehicle_images WHERE vehicle_id = p_vehicle_id),
      'event_count', (SELECT COUNT(*) FROM public.timeline_events WHERE vehicle_id = p_vehicle_id),
      'comment_count', (SELECT COUNT(*) FROM public.vehicle_comments WHERE vehicle_id = p_vehicle_id),
      'document_count', (SELECT COUNT(*) FROM public.vehicle_documents WHERE vehicle_id = p_vehicle_id),
      'last_activity', (SELECT MAX(created_at) FROM public.timeline_events WHERE vehicle_id = p_vehicle_id),
      'total_documented_costs', (
        SELECT COALESCE(SUM(amount), 0) 
        FROM public.vehicle_documents 
        WHERE vehicle_id = p_vehicle_id 
          AND document_type IN ('receipt', 'invoice')
      )
    )
  ) INTO result;
  
  RETURN result;
EXCEPTION
  WHEN others THEN
    RAISE WARNING 'get_vehicle_profile_data failed for vehicle %: %', p_vehicle_id, SQLERRM;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.get_vehicle_profile_data(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_vehicle_profile_data(UUID) TO anon;

COMMENT ON FUNCTION public.get_vehicle_profile_data IS 'Returns complete vehicle profile data in a single query for performance optimization - includes external_listings and price_signal';

