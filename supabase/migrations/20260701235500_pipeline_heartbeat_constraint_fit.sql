-- Fix: admin_notifications has CHECK constraints — notification_type must be one of a fixed set
-- ('system_alert', 'fraud_alert', 'bat_scrape_error', ...) and action_required one of
-- ('system_action', 'review_fraud', ...). The heartbeat's first insert
-- (notification_type='pipeline_heartbeat', action_required='review_pipeline') violated both.
-- Fit inside the existing schema instead of widening the constraints on a shared table:
--   notification_type = 'system_alert', action_required = 'system_action',
--   identity + dedup key = metadata->>'kind' = 'pipeline_heartbeat'.

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

  -- Dedup: at most one heartbeat notification per 24h (keyed on metadata.kind).
  IF EXISTS (
    SELECT 1 FROM admin_notifications
    WHERE notification_type = 'system_alert'
      AND metadata->>'kind' = 'pipeline_heartbeat'
      AND created_at > now() - interval '24 hours'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO admin_notifications (notification_type, title, message, action_required, priority, metadata)
  VALUES (
    'system_alert',
    'Pipeline heartbeat: ' || array_to_string(reasons, ', '),
    'Dead-man heartbeat tripped. Reasons: ' || array_to_string(reasons, '; ')
      || '. Full pulse snapshot in metadata.pulse.',
    'system_action',
    2,
    jsonb_build_object('kind', 'pipeline_heartbeat', 'reasons', to_jsonb(reasons), 'pulse', p)
  );
END;
$$;

COMMENT ON FUNCTION public.pipeline_heartbeat() IS
  'Dead-man switch: inserts a system_alert admin_notifications row (metadata.kind=pipeline_heartbeat, deduped to 1/24h) when intake is dead, unknown-source slop recurs, or the vegas feed errors. Scheduled 6-hourly as pipeline-heartbeat.';

REVOKE ALL ON FUNCTION public.pipeline_heartbeat() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pipeline_heartbeat() TO service_role;
