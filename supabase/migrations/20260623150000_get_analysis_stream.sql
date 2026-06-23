-- Live pipeline stream: everything passing through image analysis, newest first.
--
-- The product surface (PipelineVisualizer) wants to SHOW the pipeline working — each frame
-- as its verdict lands, with the actual extracted intelligence (scene, components w/ part
-- numbers, OCR, build phase, state) plus the derived-stage flags (hashed / session-linked /
-- deduped / subject-matched). Not a progress bar — the data itself, streaming. Flow visible
-- == healthy + valuable in one view.
--
-- Cursor: pass p_since = the newest landed_at the client has seen; the function returns only
-- rows touched since (cheap incremental poll). p_since NULL = initial backfill (newest N).
-- Ordered by updated_at (when the pipeline last wrote the row) — the "landing" order.
-- STABLE, SECURITY DEFINER so the app calls it for the signed-in owner. No model spend.

CREATE OR REPLACE FUNCTION public.get_analysis_stream(
  p_user_id uuid,
  p_since   timestamptz DEFAULT NULL,
  p_limit   int DEFAULT 40
)
RETURNS TABLE(
  image_id      uuid,
  vehicle_id    uuid,
  vehicle       text,
  thumbnail_url text,
  image_url     text,
  landed_at     timestamptz,
  scene_type    text,
  build_phase   text,
  narrative     text,
  components    jsonb,
  text_regions  jsonb,
  state         jsonb,
  hashed        boolean,
  sessioned     boolean,
  is_duplicate  boolean,
  match_status  text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    vi.id,
    vi.vehicle_id,
    nullif(trim(concat_ws(' ', v.year, v.make, v.model, v.trim)), '') AS vehicle,
    coalesce(vi.thumbnail_url, vi.medium_url, vi.image_url) AS thumbnail_url,
    vi.image_url,
    vi.updated_at AS landed_at,
    vi.ai_scan_metadata->'byok_deep_analysis'->>'scene_type'         AS scene_type,
    vi.ai_scan_metadata->'byok_deep_analysis'->>'build_phase_guess'  AS build_phase,
    vi.ai_scan_metadata->'byok_deep_analysis'->>'narrative_one_line' AS narrative,
    vi.ai_scan_metadata->'byok_deep_analysis'->'components_seen'     AS components,
    vi.ai_scan_metadata->'byok_deep_analysis'->'text_regions'        AS text_regions,
    vi.ai_scan_metadata->'byok_deep_analysis'->'state_observations'  AS state,
    (vi.phash IS NOT NULL)                  AS hashed,
    (vi.work_session_id IS NOT NULL)        AS sessioned,
    coalesce(vi.is_duplicate, false)        AS is_duplicate,
    vi.image_vehicle_match_status           AS match_status
  FROM vehicle_images vi
  JOIN vehicles v ON v.id = vi.vehicle_id
  WHERE vi.user_id = p_user_id
    AND vi.ai_scan_metadata ? 'byok_deep_analysis'
    AND coalesce(vi.is_superseded, false) = false
    AND (p_since IS NULL OR vi.updated_at > p_since)
  ORDER BY vi.updated_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 40), 100));
$$;

COMMENT ON FUNCTION public.get_analysis_stream(uuid, timestamptz, int) IS
  'Live pipeline stream for the PipelineVisualizer: per-frame extracted payload + derived-stage '
  'flags, newest-written first. p_since = incremental cursor. Read-only, no model spend.';

GRANT EXECUTE ON FUNCTION public.get_analysis_stream(uuid, timestamptz, int) TO authenticated;
