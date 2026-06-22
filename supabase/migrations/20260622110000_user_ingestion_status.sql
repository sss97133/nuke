-- Per-user ingestion visibility: "see the ingestion of the data".
--
-- get_pipeline_pulse is a global fleet board; this is user-scoped and per-vehicle, so an
-- owner can watch their own library fill against the extraction contract (Ch.19): how many
-- frames are analyzed vs pending, and how completely the free/derived fields (dates, phash,
-- work-session, dedup) and the subject flags (confirmed/unrelated) are filled — plus the
-- real analysis cost-to-date stamped by the drain. This is the data spine for the
-- ingestion panel; the user controls the run via their analysis settings (the broker) +
-- the drain. Read-only, STABLE, SECURITY DEFINER so the app can call it for the signed-in
-- user. No model spend.

CREATE OR REPLACE FUNCTION public.get_user_ingestion_status(p_user_id uuid)
RETURNS TABLE(
  vehicle_id uuid,
  vehicle text,
  total_images bigint,
  analyzed bigint,
  pending bigint,
  dated bigint,
  hashed bigint,
  sessioned bigint,
  duplicates bigint,
  confirmed bigint,
  unrelated bigint,
  analysis_cost_usd numeric,
  last_analyzed timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT
    vi.vehicle_id,
    concat_ws(' ', v.year, v.make, v.model, v.trim) AS vehicle,
    count(*) AS total_images,
    count(*) FILTER (WHERE vi.ai_scan_metadata ? 'byok_deep_analysis') AS analyzed,
    count(*) FILTER (
      WHERE NOT (vi.ai_scan_metadata ? 'byok_deep_analysis')
        AND COALESCE(vi.vision_gate_status,'approved') = 'approved'
        AND COALESCE(vi.is_superseded,false) = false
        AND COALESCE(vi.is_duplicate,false) = false
        AND COALESCE(vi.image_vehicle_match_status,'pending') NOT IN ('unrelated','mismatch')
    ) AS pending,
    count(*) FILTER (WHERE vi.taken_at IS NOT NULL) AS dated,
    count(*) FILTER (WHERE vi.phash IS NOT NULL) AS hashed,
    count(*) FILTER (WHERE vi.work_session_id IS NOT NULL) AS sessioned,
    count(*) FILTER (WHERE COALESCE(vi.is_duplicate,false)) AS duplicates,
    count(*) FILTER (WHERE vi.image_vehicle_match_status = 'confirmed') AS confirmed,
    count(*) FILTER (WHERE vi.image_vehicle_match_status = 'unrelated') AS unrelated,
    round(sum(
      COALESCE(NULLIF(vi.ai_scan_metadata->'byok_deep_analysis'->>'agent_cost_cents','')::numeric, 0)
    ) / 100.0, 4) AS analysis_cost_usd,
    max(NULLIF(vi.ai_scan_metadata->'byok_deep_analysis'->>'analyzed_at','')::timestamptz) AS last_analyzed
  FROM vehicle_images vi
  JOIN vehicles v ON v.id = vi.vehicle_id
  WHERE vi.user_id = p_user_id
    AND COALESCE(vi.is_superseded,false) = false
  GROUP BY vi.vehicle_id, v.year, v.make, v.model, v.trim
  ORDER BY count(*) DESC;
$$;

COMMENT ON FUNCTION public.get_user_ingestion_status(uuid) IS
  'Per-vehicle ingestion progress for an owner against the extraction contract (Ch.19): '
  'analyzed/pending + dates/phash/session/dedup/confirmed fill + analysis cost-to-date. '
  'Read-only spine for the ingestion panel.';
