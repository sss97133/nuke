-- Live analysis pipeline feed — the real one we agreed on.
--
-- The brief: a live, per-image journey you WATCH happen — received -> analyzing ->
-- the verdict landing with its schema fields — "like watching claude run". The first
-- cut shipped a feed of ALREADY-finished verdicts with the fields cosmetically animated
-- in; that is not the pipeline running, it's a replay. The real version needs the
-- pipeline to EMIT an event at each real moment, and the feed to read that stream.
--
-- We checked the existing event infra first (don't build a parallel system):
--   - ai_scan_progress: dead (1 row, last touched 2025-11).
--   - field_extraction_log: 4.2M rows but indexed only on id/vehicle_id (no time index,
--     no image_id, no user_id) — can't drive a fast per-user live feed, and it's
--     scrape-field extraction, not image vision.
--   - photo_sync_log: per-sync-run aggregate, not per-image.
-- None fit. analysis_events is a lean, purpose-built, append-only telemetry log.

CREATE TABLE IF NOT EXISTS public.analysis_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  user_id     uuid,
  vehicle_id  uuid,
  image_id    uuid,
  stage       text NOT NULL,          -- queued | analyzing | verdict_landed | hashed | sessioned | ...
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- The feed's read path: a user's events, newest first. Drives get_pipeline_events.
CREATE INDEX IF NOT EXISTS idx_analysis_events_user_time
  ON public.analysis_events (user_id, created_at DESC);
-- Group an image's stages together (received -> analyzing -> landed).
CREATE INDEX IF NOT EXISTS idx_analysis_events_image
  ON public.analysis_events (image_id);

ALTER TABLE public.analysis_events ENABLE ROW LEVEL SECURITY;

-- Owners read only their own events. No INSERT/UPDATE/DELETE policy => writes are
-- service-role only (the drain) — clients can never forge pipeline events.
DROP POLICY IF EXISTS analysis_events_owner_read ON public.analysis_events;
CREATE POLICY analysis_events_owner_read ON public.analysis_events
  FOR SELECT USING (user_id = auth.uid());

COMMENT ON TABLE public.analysis_events IS
  'Append-only live telemetry of the image-analysis pipeline: one row per stage event '
  '(queued/analyzing/verdict_landed/...). Read by get_pipeline_events; written by the '
  'BYOK drain (service role). Not domain history — that lives in vehicle_timeline_events.';

-- ── The feed RPC ────────────────────────────────────────────────────────────────
-- auth.uid()-scoped (no caller-supplied user id => no cross-user leak). Starts from the
-- small, indexed per-user event slice and joins out to the image (thumb/url/received_at)
-- and vehicle (label). received_at = the image row's created_at = when nuke received it,
-- so a card can show received -> analyzing -> landed without a separate insert trigger
-- on the 38.9M-row vehicle_images table.
CREATE OR REPLACE FUNCTION public.get_pipeline_events(
  p_since timestamptz DEFAULT NULL,
  p_limit int DEFAULT 120
)
RETURNS TABLE (
  event_id     uuid,
  stage        text,
  created_at   timestamptz,
  image_id     uuid,
  vehicle_id   uuid,
  vehicle      text,
  thumbnail_url text,
  image_url    text,
  received_at  timestamptz,
  detail       jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    e.id, e.stage, e.created_at,
    e.image_id, e.vehicle_id,
    NULLIF(trim(concat_ws(' ', v.year::text, v.make, v.model)), '') AS vehicle,
    vi.thumbnail_url, vi.image_url, vi.created_at AS received_at,
    e.detail
  FROM public.analysis_events e
  LEFT JOIN public.vehicle_images vi ON vi.id = e.image_id
  LEFT JOIN public.vehicles v        ON v.id  = e.vehicle_id
  WHERE e.user_id = auth.uid()
    AND (p_since IS NULL OR e.created_at > p_since)
  ORDER BY e.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 120), 300));
$$;

GRANT EXECUTE ON FUNCTION public.get_pipeline_events(timestamptz, int) TO authenticated, anon;

COMMENT ON FUNCTION public.get_pipeline_events(timestamptz, int) IS
  'Live pipeline feed for the calling user (auth.uid()). Newest events first, optional '
  'since-cursor. Joins each event to its image (thumbnail/received_at) and vehicle label.';

-- ── Seed history so the feed is not empty on day one ─────────────────────────────
-- One verdict_landed event per already-analyzed owner frame, stamped at the real
-- analyzed_at. Live received/analyzing/landed events accrue as the drain runs. Scoped
-- to the owner via the user_id index (measured: 328ms for the full 8.5k set), capped.
INSERT INTO public.analysis_events (created_at, user_id, vehicle_id, image_id, stage, detail)
SELECT
  COALESCE((vi.ai_scan_metadata->'byok_deep_analysis'->>'analyzed_at')::timestamptz, vi.updated_at, now()),
  vi.user_id, vi.vehicle_id, vi.id, 'verdict_landed',
  jsonb_build_object(
    'scene_type',      vi.ai_scan_metadata->'byok_deep_analysis'->>'scene_type',
    'build_phase',     vi.ai_scan_metadata->'byok_deep_analysis'->>'build_phase_guess',
    'narrative',       vi.ai_scan_metadata->'byok_deep_analysis'->>'narrative_one_line',
    'component_count', jsonb_array_length(COALESCE(vi.ai_scan_metadata->'byok_deep_analysis'->'components_seen','[]'::jsonb)),
    'ocr_count',       jsonb_array_length(COALESCE(vi.ai_scan_metadata->'byok_deep_analysis'->'text_regions','[]'::jsonb)),
    'backfilled',      true
  )
FROM public.vehicle_images vi
WHERE vi.user_id = '0b9f107a-d124-49de-9ded-94698f63c1c4'
  AND vi.ai_scan_metadata ? 'byok_deep_analysis'
ORDER BY (vi.ai_scan_metadata->'byok_deep_analysis'->>'analyzed_at')::timestamptz DESC NULLS LAST
LIMIT 5000;
