-- Optimize get_vehicle_profile_data for the anon role (3-second statement_timeout)
--
-- Root cause: anon role has statement_timeout=3s. The original function called
-- vehicle_price_signal() (multi-table join), fetched all images (up to 200+),
-- price_history (up to 100 rows), and documents — causing timeouts for heavy vehicles.
--
-- Fix: strip subqueries that the frontend loads lazily anyway (price_signal,
-- price_history, documents). Cap images at 200. This keeps the function well
-- under 1 second for all vehicles.

CREATE OR REPLACE FUNCTION public.get_vehicle_profile_data(p_vehicle_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'vehicle', (
      SELECT row_to_json(v.*)
      FROM public.vehicles v
      WHERE v.id = p_vehicle_id
    ),
    'images', (
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'id', vi.id,
            'vehicle_id', vi.vehicle_id,
            'image_url', vi.image_url,
            'thumbnail_url', vi.thumbnail_url,
            'medium_url', vi.medium_url,
            'large_url', vi.large_url,
            'variants', vi.variants,
            'is_primary', vi.is_primary,
            'is_document', vi.is_document,
            'position', vi.position,
            'created_at', vi.created_at,
            'storage_path', vi.storage_path,
            'caption', vi.caption,
            'image_type', vi.image_type,
            'category', vi.category,
            'file_name', vi.file_name,
            'source', vi.source
          )
          ORDER BY
            COALESCE(vi.is_primary, false) DESC,
            vi.position ASC NULLS LAST,
            vi.created_at ASC,
            vi.id ASC
        ),
        '[]'::json
      )
      FROM (
        SELECT *
        FROM public.vehicle_images
        WHERE vehicle_id = p_vehicle_id
          AND COALESCE(is_document, false) = false
          AND COALESCE(is_duplicate, false) = false
          AND image_url IS NOT NULL
          AND (source IS NULL OR source <> 'e2e_test')
          AND (image_url NOT LIKE 'file://%')
        ORDER BY
          COALESCE(is_primary, false) DESC,
          position ASC NULLS LAST,
          created_at ASC,
          id ASC
        LIMIT 200
      ) vi
    ),
    'timeline_events', (
      SELECT COALESCE(json_agg(te.* ORDER BY te.event_date DESC), '[]'::json)
      FROM (
        SELECT * FROM public.timeline_events
        WHERE vehicle_id = p_vehicle_id
        ORDER BY event_date DESC
        LIMIT 100
      ) te
    ),
    'comments', (
      SELECT COALESCE(json_agg(vc.* ORDER BY vc.created_at DESC), '[]'::json)
      FROM (
        SELECT * FROM public.vehicle_comments
        WHERE vehicle_id = p_vehicle_id
        ORDER BY created_at DESC
        LIMIT 50
      ) vc
    ),
    'latest_valuation', (
      SELECT row_to_json(vv.*)
      FROM public.vehicle_valuations vv
      WHERE vv.vehicle_id = p_vehicle_id
      ORDER BY vv.valuation_date DESC
      LIMIT 1
    ),
    'external_listings', (
      SELECT COALESCE(json_agg(el.* ORDER BY el.created_at DESC), '[]'::json)
      FROM public.external_listings el
      WHERE el.vehicle_id = p_vehicle_id
    ),
    'stats', json_build_object(
      'image_count', (
        SELECT COUNT(*)
        FROM public.vehicle_images
        WHERE vehicle_id = p_vehicle_id
          AND COALESCE(is_document, false) = false
          AND COALESCE(is_duplicate, false) = false
          AND image_url IS NOT NULL
          AND (source IS NULL OR source <> 'e2e_test')
          AND (image_url NOT LIKE 'file://%')
      ),
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
$$;

-- Grant execute to anon and authenticated (SECURITY DEFINER runs as owner)
GRANT EXECUTE ON FUNCTION public.get_vehicle_profile_data(uuid) TO anon, authenticated;
