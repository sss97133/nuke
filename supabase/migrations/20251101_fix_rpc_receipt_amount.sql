-- Fix RPC function to use correct column for documented costs
-- The receipt_amount column doesn't exist - should calculate from vehicle_documents.amount instead

DROP FUNCTION IF EXISTS get_vehicle_profile_data(UUID);

CREATE OR REPLACE FUNCTION get_vehicle_profile_data(p_vehicle_id UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  -- Build complete vehicle profile data in one query
  SELECT json_build_object(
    'vehicle', (
      SELECT row_to_json(v.*) 
      FROM vehicles v 
      WHERE v.id = p_vehicle_id
    ),
    'images', (
      SELECT COALESCE(json_agg(vi.* ORDER BY vi.position, vi.created_at), '[]'::json)
      FROM vehicle_images vi 
      WHERE vi.vehicle_id = p_vehicle_id
    ),
    'timeline_events', (
      SELECT COALESCE(json_agg(te.* ORDER BY te.event_date DESC), '[]'::json)
      FROM timeline_events te 
      WHERE te.vehicle_id = p_vehicle_id
    ),
    'comments', (
      SELECT COALESCE(json_agg(vc.* ORDER BY vc.created_at DESC), '[]'::json)
      FROM vehicle_comments vc 
      WHERE vc.vehicle_id = p_vehicle_id
    ),
    'latest_valuation', (
      SELECT row_to_json(vv.*) 
      FROM vehicle_valuations vv 
      WHERE vv.vehicle_id = p_vehicle_id 
      ORDER BY vv.valuation_date DESC 
      LIMIT 1
    ),
    'price_history', (
      SELECT COALESCE(json_agg(vph.* ORDER BY vph.created_at DESC), '[]'::json)
      FROM vehicle_price_history vph
      WHERE vph.vehicle_id = p_vehicle_id
      LIMIT 100
    ),
    'documents', (
      SELECT COALESCE(json_agg(vd.* ORDER BY vd.document_date DESC), '[]'::json)
      FROM vehicle_documents vd
      WHERE vd.vehicle_id = p_vehicle_id
      AND vd.privacy_level != 'restricted'
    ),
    -- Computed stats
    'stats', json_build_object(
      'image_count', (SELECT COUNT(*) FROM vehicle_images WHERE vehicle_id = p_vehicle_id),
      'event_count', (SELECT COUNT(*) FROM timeline_events WHERE vehicle_id = p_vehicle_id),
      'comment_count', (SELECT COUNT(*) FROM vehicle_comments WHERE vehicle_id = p_vehicle_id),
      'document_count', (SELECT COUNT(*) FROM vehicle_documents WHERE vehicle_id = p_vehicle_id),
      'last_activity', (SELECT MAX(created_at) FROM timeline_events WHERE vehicle_id = p_vehicle_id),
      -- Calculate total documented costs from vehicle_documents instead of timeline_events
      'total_documented_costs', (
        SELECT COALESCE(SUM(amount), 0) 
        FROM vehicle_documents 
        WHERE vehicle_id = p_vehicle_id 
        AND document_type IN ('receipt', 'invoice')
      )
    )
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_vehicle_profile_data(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_vehicle_profile_data(UUID) TO anon;

-- Add comment
COMMENT ON FUNCTION get_vehicle_profile_data IS 'Returns complete vehicle profile data in a single query for performance optimization';

