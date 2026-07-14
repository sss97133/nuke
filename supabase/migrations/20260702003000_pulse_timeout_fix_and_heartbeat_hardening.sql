-- Fix: get_pipeline_pulse() blew its own 8s statement_timeout on exact counts over
-- vehicle_images (34M rows, ai_processing_status unindexed) — SQLSTATE 57014 on every call.
-- Fix: pipeline_heartbeat() called the pulse with no exception guard — if the reading died,
-- the alarm died silently (the exact green-lie failure this system exists to prevent).
-- Changes: capped LIMIT-counts for unbounded backlogs, per-stanza exception degradation,
-- heartbeat computes its alarm signals directly and attaches the pulse only opportunistically.

CREATE OR REPLACE FUNCTION public.get_pipeline_pulse(p_days integer DEFAULT 14)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '8s'
AS $function$
DECLARE
  v_since TIMESTAMPTZ := date_trunc('day', now()) - make_interval(days => p_days - 1);
  v_vehicles JSONB := '[]'::jsonb;
  v_images JSONB := '[]'::jsonb;
  v_observations JSONB := '[]'::jsonb;
  v_comments JSONB := '[]'::jsonb;
  v_backlogs JSONB := '{}'::jsonb;
  v_errors TEXT[] := '{}';
BEGIN
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('d', d, 'n', n) ORDER BY d), '[]'::jsonb)
    INTO v_vehicles
    FROM (SELECT date_trunc('day', created_at)::date AS d, count(*) AS n
          FROM vehicles WHERE created_at >= v_since GROUP BY 1) t;
  EXCEPTION WHEN others THEN v_errors := v_errors || ('vehicles: ' || SQLERRM); END;

  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('d', d, 'n', n) ORDER BY d), '[]'::jsonb)
    INTO v_images
    FROM (SELECT date_trunc('day', created_at)::date AS d, count(*) AS n
          FROM vehicle_images WHERE created_at >= v_since GROUP BY 1) t;
  EXCEPTION WHEN others THEN v_errors := v_errors || ('images: ' || SQLERRM); END;

  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('d', d, 'n', n) ORDER BY d), '[]'::jsonb)
    INTO v_observations
    FROM (SELECT date_trunc('day', ingested_at)::date AS d, count(*) AS n
          FROM vehicle_observations WHERE ingested_at >= v_since GROUP BY 1) t;
  EXCEPTION WHEN others THEN v_errors := v_errors || ('observations: ' || SQLERRM); END;

  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('d', d, 'n', n) ORDER BY d), '[]'::jsonb)
    INTO v_comments
    FROM (SELECT date_trunc('day', created_at)::date AS d, count(*) AS n
          FROM auction_comments WHERE created_at >= v_since GROUP BY 1) t;
  EXCEPTION WHEN others THEN v_errors := v_errors || ('comments: ' || SQLERRM); END;

  BEGIN
    -- Capped counts: 10001 means "10000+". Exact totals over 34M rows are not a pulse reading.
    SELECT jsonb_build_object(
      'import_queue_pending',
        (SELECT count(*) FROM import_queue WHERE status = 'pending'),
      'images_analysis_pending_capped',
        (SELECT count(*) FROM (SELECT 1 FROM vehicle_images WHERE ai_processing_status = 'pending' LIMIT 10001) s),
      'images_analysis_failed_capped',
        (SELECT count(*) FROM (SELECT 1 FROM vehicle_images WHERE ai_processing_status = 'failed' LIMIT 10001) s),
      'cap', 10001
    ) INTO v_backlogs;
  EXCEPTION WHEN others THEN v_errors := v_errors || ('backlogs: ' || SQLERRM); END;

  RETURN jsonb_build_object(
    'since', v_since,
    'days', p_days,
    'organs', jsonb_build_object(
      'vehicles', v_vehicles, 'images', v_images,
      'observations', v_observations, 'auction_comments', v_comments),
    'backlogs', v_backlogs,
    'degraded', CASE WHEN array_length(v_errors,1) IS NULL THEN NULL ELSE to_jsonb(v_errors) END,
    'generated_at', now());
END;
$function$;

CREATE OR REPLACE FUNCTION public.pipeline_heartbeat()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  p jsonb;
  new_non_unknown bigint;
  unknown_new bigint;
  vegas_err text;
  reasons text[] := '{}';
BEGIN
  -- Alarm signals computed DIRECTLY (cheap: vehicles-24h brin, listing_feeds tiny).
  -- The alarm must never depend on the full reading surviving.
  SELECT count(*) INTO new_non_unknown
  FROM vehicles
  WHERE created_at > now() - interval '24 hours'
    AND COALESCE(source, 'unknown') <> 'unknown';

  SELECT count(*) INTO unknown_new
  FROM vehicles
  WHERE source = 'unknown' AND created_at > now() - interval '24 hours';

  SELECT last_error INTO vegas_err
  FROM listing_feeds WHERE id = '46b8373b-2454-4cbb-926c-7646c90e560d';

  IF new_non_unknown = 0 THEN
    reasons := reasons || 'no_new_non_unknown_vehicles_24h';
  END IF;
  IF unknown_new > 0 THEN
    reasons := reasons || format('unknown_source_new_24h=%s', unknown_new);
  END IF;
  IF vegas_err IS NOT NULL THEN
    reasons := reasons || 'vegas_feed_last_error_present';
  END IF;

  -- Pulse snapshot is opportunistic context, never a dependency.
  BEGIN
    p := public.get_pipeline_pulse_24h();
  EXCEPTION WHEN others THEN
    p := jsonb_build_object('pulse_error', SQLERRM);
    reasons := reasons || 'pulse_reading_failed';
  END;

  IF array_length(reasons, 1) IS NULL THEN
    RETURN;  -- healthy, stay silent
  END IF;

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
      || '. Pulse snapshot (or its error) in metadata.pulse.',
    'system_action', 2,
    jsonb_build_object('kind', 'pipeline_heartbeat', 'reasons', to_jsonb(reasons), 'pulse', p));
END;
$function$;
