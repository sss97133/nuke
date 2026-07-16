-- Fix: 20260701233000 minted a zero-arg public.get_pipeline_pulse() overload, but prod already
-- has get_pipeline_pulse(p_days int DEFAULT 14) (the SystemStatus organ-throughput series,
-- migration 20260610000005). Because the existing function has a default, ANY bare call
-- `SELECT get_pipeline_pulse()` — including the one inside pipeline_heartbeat() — became
-- "function is not unique" (42725). Resolution: drop the zero-arg overload and give the
-- heartbeat snapshot its own name, get_pipeline_pulse_24h(). The p_days series function is
-- untouched (its callers pass p_days explicitly and its bare-call default behavior is restored).

DROP FUNCTION IF EXISTS public.get_pipeline_pulse();

CREATE OR REPLACE FUNCTION public.get_pipeline_pulse_24h()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
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
    'approx: max(nuke_estimates.calculated_at) via idx_ne_calculated_at — vehicles.valuation_calculated_at is unindexed'
);
$$;

COMMENT ON FUNCTION public.get_pipeline_pulse_24h() IS
  'One-call pipeline health snapshot: 24h intake by source, unknown-source slop count, feed poll state, vegas feed error, import queue depth/stuck, last valuation run (index-backed proxy). Named _24h to avoid overload ambiguity with get_pipeline_pulse(p_days).';

CREATE OR REPLACE FUNCTION public.pipeline_heartbeat()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  p jsonb;
  new_non_unknown bigint;
  unknown_new bigint;
  vegas_err text;
  reasons text[] := '{}';
BEGIN
  p := public.get_pipeline_pulse_24h();

  -- Zero NEW non-'unknown' vehicles in 24h = the pipeline is dead.
  SELECT count(*) INTO new_non_unknown
  FROM vehicles
  WHERE created_at > now() - interval '24 hours'
    AND COALESCE(source, 'unknown') <> 'unknown';

  unknown_new := COALESCE((p->>'unknown_source_new_24h')::bigint, 0);
  vegas_err   := p->>'vegas_feed_last_error';

  IF new_non_unknown = 0 THEN
    reasons := reasons || 'no_new_non_unknown_vehicles_24h';
  END IF;
  IF unknown_new > 0 THEN
    -- Slop recurrence detector (2026-07-01 incident: source='unknown' rows landing unnoticed)
    reasons := reasons || format('unknown_source_new_24h=%s', unknown_new);
  END IF;
  IF vegas_err IS NOT NULL THEN
    reasons := reasons || 'vegas_feed_last_error_present';
  END IF;

  IF array_length(reasons, 1) IS NULL THEN
    RETURN;  -- healthy, stay silent
  END IF;

  -- Dedup: at most one heartbeat notification per 24h.
  IF EXISTS (
    SELECT 1 FROM admin_notifications
    WHERE notification_type = 'pipeline_heartbeat'
      AND created_at > now() - interval '24 hours'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO admin_notifications (notification_type, title, message, action_required, priority, metadata)
  VALUES (
    'pipeline_heartbeat',
    'Pipeline heartbeat: ' || array_to_string(reasons, ', '),
    'Dead-man heartbeat tripped. Reasons: ' || array_to_string(reasons, '; ')
      || '. Full pulse snapshot in metadata.pulse.',
    'review_pipeline',
    2,
    jsonb_build_object('reasons', to_jsonb(reasons), 'pulse', p)
  );
END;
$$;

-- Ops functions — not for the public REST surface.
REVOKE ALL ON FUNCTION public.get_pipeline_pulse_24h() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pipeline_pulse_24h() TO service_role;
REVOKE ALL ON FUNCTION public.pipeline_heartbeat() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pipeline_heartbeat() TO service_role;
