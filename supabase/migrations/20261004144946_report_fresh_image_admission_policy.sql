-- Declare fresh-image admission in the existing service-only pulse. No new organ,
-- schedule, grants, data backfill or processing dispatch. The heartbeat is unchanged.
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

CREATE OR REPLACE FUNCTION public.get_pipeline_pulse_24h()
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH candidates AS MATERIALIZED (
  -- Reuse the public feed's created_at index. Never scan/count the image corpus.
  SELECT id, platform_source, created_at FROM public.vehicles
  WHERE is_public IS TRUE AND status <> 'pending' AND deleted_at IS NULL
    AND listing_kind IS DISTINCT FROM 'non_vehicle_item'
    AND created_at >= now() - interval '24 hours'
  ORDER BY created_at DESC, id DESC LIMIT 5
), selected AS MATERIALIZED (
  SELECT id FROM candidates WHERE platform_source = 'bat'
  ORDER BY created_at DESC, id DESC LIMIT 1
), arrivals AS MATERIALIZED (
  SELECT i.ai_processing_status::text AS processing_status, i.ai_scan_metadata,
    i.ai_processing_started_at, i.ai_processing_completed_at,
    public.vehicle_image_gallery_eligible(i) AS gallery_eligible,
    i.created_at, i.id
  FROM public.vehicle_images i
  WHERE i.vehicle_id = (SELECT id FROM selected) AND i.source = 'bat_import'
    AND i.created_at >= now() - interval '24 hours'
  ORDER BY i.created_at DESC, i.id DESC LIMIT 21
), sample AS MATERIALIZED (
  SELECT *, coalesce(processing_status = 'skipped'
    AND ai_scan_metadata->'image_intake' @> '{
      "version":1,"producer":"extract-bat-core","mode":"source_link_only",
      "analysis_requested":false,"reason":"external_link_analysis_requires_explicit_request"
    }'::jsonb
    AND NOT ai_scan_metadata ? 'photo_pipeline'
    AND ai_processing_started_at IS NULL AND ai_processing_completed_at IS NULL, false) AS policy_deferred
  FROM arrivals ORDER BY created_at DESC, id DESC LIMIT 20
), admission AS (
  SELECT count(*) AS sampled,
    count(*) FILTER (WHERE gallery_eligible) AS gallery_eligible,
    count(*) FILTER (WHERE policy_deferred) AS source_policy_deferred,
    count(*) FILTER (WHERE processing_status = 'skipped' AND NOT policy_deferred) AS unexplained_skips,
    count(*) FILTER (WHERE processing_status = 'pending') AS pending,
    count(*) FILTER (WHERE processing_status = 'processing') AS processing,
    count(*) FILTER (WHERE processing_status = 'completed') AS completed,
    count(*) FILTER (WHERE processing_status = 'failed') AS failed,
    count(*) FILTER (WHERE processing_status IS NULL
      OR processing_status NOT IN ('skipped','pending','processing','completed','failed')) AS other_status,
    count(*) FILTER (WHERE jsonb_typeof(ai_scan_metadata->'photo_pipeline') = 'object') AS pipeline_receipts
  FROM sample
)
SELECT jsonb_build_object(
  'generated_at', now(),
  'new_vehicles_24h_by_source', COALESCE((
      SELECT jsonb_object_agg(COALESCE(s.source, 'null'), s.cnt)
      FROM (
        SELECT source, count(*) AS cnt
        FROM vehicles
        WHERE created_at > now() - interval '24 hours'
        GROUP BY source
      ) s
    ), '{}'::jsonb),
  'unknown_source_new_24h', (
      SELECT count(*) FROM vehicles
      WHERE source = 'unknown' AND created_at > now() - interval '24 hours'
    ),
  'feeds_enabled', (SELECT count(*) FROM listing_feeds WHERE enabled),
  'feeds_polled_24h', (
      SELECT count(*) FROM listing_feeds
      WHERE last_polled_at > now() - interval '24 hours'
    ),
  'vegas_feed_last_error', (
      SELECT last_error FROM listing_feeds
      WHERE id = '46b8373b-2454-4cbb-926c-7646c90e560d'
    ),
  'import_queue_pending', (SELECT count(*) FROM import_queue WHERE status = 'pending'),
  'import_queue_stuck_processing', (
      SELECT count(*) FROM import_queue
      WHERE status = 'processing' AND updated_at < now() - interval '2 hours'
    ),
  'last_valuation_run', (SELECT max(calculated_at) FROM nuke_estimates),
  'last_valuation_run_method',
    'approx: max(nuke_estimates.calculated_at) via idx_ne_calculated_at — vehicles.valuation_calculated_at is unindexed',
  'fresh_image_flow', jsonb_build_object(
    'assay', 'fresh_image_admission_v1', 'measured_at', now(),
    'window_hours', 24, 'candidate_vehicle_limit', 5, 'sample_limit', 20,
    'vehicle_selected', EXISTS(SELECT 1 FROM selected),
    'sample_truncated', (SELECT count(*) > 20 FROM arrivals),
    'metrics', (SELECT to_jsonb(a) FROM admission a),
    'output_coverage', 'not_measured',
    'scope_note', 'Newest public BaT vehicle among at most five recent public feed candidates; at most twenty recent BaT image links plus a truncation sentinel. Admission and receipt presence only. Claims, witnesses, reader output, model success, corpus and throughput are unverified.'
  )
);
$$;

COMMIT;
