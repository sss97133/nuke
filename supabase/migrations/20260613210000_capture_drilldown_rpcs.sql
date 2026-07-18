-- Capture-relay drilldown RPCs — backs the iOS "ANALYZED N" drill (#3) and the
-- profile sync-status panel (#4). Both are owner/capture-scoped and fast (they
-- ride idx_vehicle_images_user_created); neither needs the all-sources aggregate
-- (get_user_capture_stats) which times out on heavy libraries (Skylar = 22K imgs).
-- Drift-repair capture of SQL applied to prod 2026-06-13.

-- #3 — the analyzed capture photos + their BYOK vision atoms. Atoms live in
-- vehicle_images.labels (text[]): 'scene:x','phase:y','intent:z' facets plus
-- free component descriptions. SETOF so PostgREST returns a clean row array.
-- Owner-gated (auth.uid() = p_user_id) — these are private capture photos.
CREATE OR REPLACE FUNCTION public.get_user_analyzed_photos(
  p_user_id uuid, p_limit int DEFAULT 120, p_offset int DEFAULT 0)
RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'id', t.id, 'url', t.image_url, 'thumb', COALESCE(t.thumbnail_url, t.image_url),
    'vehicle_id', t.vehicle_id, 'taken_at', t.taken_at, 'file_name', t.file_name,
    'scene', t.scene, 'phase', t.phase, 'intent', t.intent, 'components', t.components,
    'analyzed_at', t.analyzed_at, 'analyzed_by', t.analyzed_by)
  FROM (
    SELECT vi.id, vi.image_url, vi.thumbnail_url, vi.vehicle_id, vi.taken_at, vi.file_name,
           COALESCE(vi.taken_at, vi.created_at) AS order_at,
           (SELECT substring(l from 7) FROM unnest(vi.labels) l WHERE l LIKE 'scene:%'  LIMIT 1) AS scene,
           (SELECT substring(l from 7) FROM unnest(vi.labels) l WHERE l LIKE 'phase:%'  LIMIT 1) AS phase,
           (SELECT substring(l from 8) FROM unnest(vi.labels) l WHERE l LIKE 'intent:%' LIMIT 1) AS intent,
           (SELECT jsonb_agg(l) FROM unnest(vi.labels) l
              WHERE l NOT LIKE 'scene:%' AND l NOT LIKE 'phase:%' AND l NOT LIKE 'intent:%') AS components,
           COALESCE(vi.vision_analyzed_at, (vi.ai_scan_metadata->>'processed_at')::timestamptz, vi.ai_processing_completed_at) AS analyzed_at,
           NULLIF(vi.ai_scan_metadata->>'pipeline_version','') AS analyzed_by
    FROM public.vehicle_images vi
    WHERE vi.user_id = p_user_id
      AND auth.uid() = p_user_id
      AND vi.source = 'capture_relay_ios'
      AND vi.ai_processing_status = 'analyzed'
      AND COALESCE(vi.is_duplicate, false) = false
    ORDER BY COALESCE(vi.taken_at, vi.created_at) DESC NULLS LAST
    LIMIT GREATEST(p_limit,0) OFFSET GREATEST(p_offset,0)
  ) t
  ORDER BY t.order_at DESC NULLS LAST;
$$;

-- #4 — what's actually synced + analyzed from this device. Kills the black box.
CREATE OR REPLACE FUNCTION public.get_user_sync_status(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'is_owner_view',     (auth.uid() = p_user_id),
    'synced_total',      count(*) FILTER (WHERE source='capture_relay_ios'),
    'analyzed_total',    count(*) FILTER (WHERE source='capture_relay_ios' AND ai_processing_status='analyzed'),
    'pending_total',     count(*) FILTER (WHERE source='capture_relay_ios' AND ai_processing_status IN ('pending','processing','queued')),
    'filed_total',       count(*) FILTER (WHERE source='capture_relay_ios' AND vehicle_id IS NOT NULL),
    'all_sources_total', count(*),
    'last_synced_at',    max(created_at) FILTER (WHERE source='capture_relay_ios'),
    'last_taken_at',     max(taken_at)  FILTER (WHERE source='capture_relay_ios')
  )
  FROM public.vehicle_images
  WHERE user_id = p_user_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_analyzed_photos(uuid,int,int) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_sync_status(uuid)             TO anon, authenticated, service_role;
