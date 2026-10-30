-- Exact live owners read2026-10-30, for guarded isolated contract setup only.
CREATE OR REPLACE FUNCTION public.get_user_day_receipt(p_user_id uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_owner boolean := (auth.uid() = p_user_id);
  v_photos jsonb;
  v_work jsonb;
  v_receipts jsonb := '[]'::jsonb;
  v_facets jsonb;
  v_gaps jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', s.id, 'url', s.image_url, 'thumb', COALESCE(s.thumbnail_url, s.image_url),
           'vehicle_id', s.vehicle_id, 'taken_at', s.taken_at,
           'file_name', s.file_name,
           'narrative', NULLIF(s.narrative, ''),
           'components', s.components,
           'part_numbers', s.part_numbers,
           'intent', COALESCE(s.confirmed_intent, s.model_intent),
           'intent_confidence', s.intent_confidence,
           'intent_confirmed', s.intent_confirmed,
           'owner_note', s.owner_note,
           'analyzed_by', s.analyzed_by,
           'analyzed_at', s.analyzed_at
         ) ORDER BY s.taken_at), '[]'::jsonb)
  INTO v_photos
  FROM (
    SELECT vi.id, vi.image_url, vi.thumbnail_url, vi.vehicle_id, vi.taken_at, vi.file_name,
           a.structured_data->>'narrative_one_line' AS narrative,
           (SELECT jsonb_agg(c->>'label')
              FROM jsonb_array_elements(COALESCE(a.structured_data->'components_seen','[]'::jsonb)) c
              WHERE c->>'label' IS NOT NULL) AS components,
           (SELECT jsonb_agg(t->>'text')
              FROM jsonb_array_elements(COALESCE(a.structured_data->'text_regions','[]'::jsonb)) t
              WHERE t->>'text' IS NOT NULL) AS part_numbers,
           a.structured_data->>'intent' AS model_intent,
           a.structured_data->>'intent_confirmed_value' AS confirmed_intent,
           NULLIF(a.structured_data->>'intent_confidence','')::numeric AS intent_confidence,
           NULLIF(a.structured_data->>'intent_owner_confirmed','')::boolean AS intent_confirmed,
           -- Owner's own words about this frame (latest), surfaced as primary voice.
           -- Prune by vehicle_id FIRST (idx_observations_vehicle_comment_bid) so this
           -- never seq-scans the 7.5M-row observations table — it lands on the handful
           -- of comments for this vehicle, then filters to this image.
           (SELECT oc.content_text
              FROM vehicle_observations oc
              WHERE oc.vehicle_id = vi.vehicle_id
                AND oc.kind = 'comment'
                AND oc.structured_data->>'analysis_kind' = 'owner_comment'
                AND oc.structured_data->>'image_id' = vi.id::text
              ORDER BY oc.observed_at DESC
              LIMIT 1) AS owner_note,
           a.agent_model AS analyzed_by,
           a.ingested_at AS analyzed_at
    FROM vehicle_images vi
    LEFT JOIN vehicles v ON v.id = vi.vehicle_id
    LEFT JOIN LATERAL (
      SELECT o.structured_data, o.agent_model, o.ingested_at
      FROM vehicle_observations o
      WHERE o.structured_data->>'analysis_kind' = 'image_deep_byok'
        AND o.structured_data->>'image_id' = vi.id::text
      ORDER BY o.ingested_at DESC
      LIMIT 1
    ) a ON true
    WHERE vi.user_id = p_user_id
      AND vi.taken_at >= p_date::timestamptz
      AND vi.taken_at < (p_date + 1)::timestamptz
      AND COALESCE(vi.is_duplicate, false) = false
      AND (v_is_owner OR (vi.vehicle_id IS NOT NULL AND v.is_public = true))
    ORDER BY vi.taken_at
    LIMIT 60
  ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', ws.id,
           'title', COALESCE(ws.title, ws.work_type, 'work session'),
           'vehicle_id', ws.vehicle_id,
           'duration_minutes', ws.duration_minutes,
           'total_job_cost', CASE WHEN v_is_owner THEN ws.total_job_cost ELSE NULL END,
           'session_type', ws.session_type
         ) ORDER BY ws.start_time NULLS LAST), '[]'::jsonb)
  INTO v_work
  FROM work_sessions ws
  WHERE ws.user_id = p_user_id AND ws.session_date = p_date;

  IF v_is_owner THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', r.id, 'vendor', r.vendor_name, 'total', r.total_amount,
             'vehicle_id', r.vehicle_id) ORDER BY r.total_amount DESC NULLS LAST), '[]'::jsonb)
    INTO v_receipts
    FROM receipts r
    WHERE r.user_id = p_user_id
      AND p_date IN (r.transaction_date, r.purchase_date, r.receipt_date);
  END IF;

  -- 20261029090000: gaps over 60 minutes between this user's consecutive photos that day (the same rows the photo
  -- list reads, without its 60-row cap), each with the owner testimony session that covers it.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'start', g.prev_at, 'end', g.taken_at,
           'minutes', floor(extract(epoch FROM g.taken_at - g.prev_at) / 60)::integer,
           'vehicle_id', CASE WHEN g.prev_vehicle_id = g.vehicle_id THEN g.vehicle_id END,
           'before_image_id', g.prev_id, 'after_image_id', g.id,
           'testimony_id', t.id) ORDER BY g.prev_at), '[]'::jsonb)
  INTO v_gaps
  FROM (
    SELECT vi.id, vi.vehicle_id, vi.taken_at,
           lag(vi.id) OVER w AS prev_id, lag(vi.vehicle_id) OVER w AS prev_vehicle_id, lag(vi.taken_at) OVER w AS prev_at
    FROM vehicle_images vi
    LEFT JOIN vehicles v ON v.id = vi.vehicle_id
    WHERE vi.user_id = p_user_id
      AND vi.taken_at >= p_date::timestamptz
      AND vi.taken_at < (p_date + 1)::timestamptz
      AND COALESCE(vi.is_duplicate, false) = false
      AND (v_is_owner OR (vi.vehicle_id IS NOT NULL AND v.is_public = true))
    WINDOW w AS (ORDER BY vi.taken_at, vi.id)
  ) g
  LEFT JOIN LATERAL (
    SELECT ws.id FROM work_sessions ws
    WHERE ws.user_id = p_user_id AND ws.session_date = p_date AND ws.session_type = 'owner_testimony'
      AND tstzrange(ws.start_time, ws.end_time) && tstzrange(g.prev_at, g.taken_at)
    ORDER BY ws.start_time, ws.id LIMIT 1
  ) t ON true
  WHERE g.prev_at IS NOT NULL AND g.taken_at - g.prev_at > interval '60 minutes';

  v_facets := jsonb_build_object(
    'photos', jsonb_array_length(v_photos),
    'work', jsonb_array_length(v_work),
    'receipts', jsonb_array_length(v_receipts),
    'gaps', jsonb_array_length(v_gaps)
  );

  RETURN jsonb_build_object(
    'date', p_date,
    'is_owner_view', v_is_owner,
    'photos', v_photos,
    'work_sessions', v_work,
    'receipts', v_receipts,
    'gaps', v_gaps,
    'facets', v_facets
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_user_contribution_calendar(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Money is the owner's: the day's work cost reaches the signed-in user whose sessions they are;
  -- every other caller gets the same calendar with work_cost null and money_masked true.
  WITH viewer AS (SELECT coalesce(auth.uid() = p_user_id, false) AS is_owner),
  photo AS (
    SELECT COALESCE(vi.taken_at, vi.created_at)::date AS day, count(*)::int AS n
    FROM vehicle_images vi
    WHERE vi.user_id = p_user_id
      AND COALESCE(vi.taken_at, vi.created_at)::date >= DATE '2000-01-01'
    GROUP BY 1
  ),
  evt AS (
    SELECT vte.event_date AS day, count(*)::int AS n
    FROM vehicle_timeline_events vte
    WHERE vte.user_id = p_user_id AND vte.event_date >= DATE '2000-01-01'
    GROUP BY 1
  ),
  wk AS (
    SELECT ws.session_date AS day,
           count(*)::int AS sessions,
           COALESCE(sum(ws.duration_minutes), 0)::int AS minutes,
           round(COALESCE(sum(ws.total_job_cost), 0))::int AS cost
    FROM work_sessions ws
    WHERE ws.user_id = p_user_id AND ws.session_date >= DATE '2000-01-01'
    GROUP BY 1
  ),
  days AS (
    SELECT day FROM photo UNION SELECT day FROM evt UNION SELECT day FROM wk
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'day',          to_char(d.day, 'YYYY-MM-DD'),
           'photos',       COALESCE(p.n, 0),
           'events',       COALESCE(e.n, 0),
           'work',         COALESCE(w.sessions, 0),
           'work_minutes', COALESCE(w.minutes, 0),
           'work_cost',    CASE WHEN (SELECT is_owner FROM viewer) THEN COALESCE(w.cost, 0) ELSE NULL END,
           'money_masked', NOT (SELECT is_owner FROM viewer)
         ) ORDER BY d.day), '[]'::jsonb)
  FROM days d
  LEFT JOIN photo p ON p.day = d.day
  LEFT JOIN evt   e ON e.day = d.day
  LEFT JOIN wk    w ON w.day = d.day;
$function$
;
CREATE OR REPLACE FUNCTION public.get_user_contribution_days(p_user_id uuid)
 RETURNS TABLE(day date, kind text, n integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Photos: day = capture time when EXIF has it, upload time otherwise.
  SELECT
    COALESCE(vi.taken_at, vi.created_at)::date AS day,
    'photo'::text AS kind,
    count(*)::int AS n
  FROM vehicle_images vi
  WHERE vi.user_id = p_user_id
    AND COALESCE(vi.taken_at, vi.created_at)::date >= DATE '2000-01-01'
  GROUP BY 1

  UNION ALL

  -- Timeline events
  SELECT
    vte.event_date AS day,
    'event'::text AS kind,
    count(*)::int AS n
  FROM vehicle_timeline_events vte
  WHERE vte.user_id = p_user_id
    AND vte.event_date >= DATE '2000-01-01'
  GROUP BY 1

  UNION ALL

  -- Work sessions
  SELECT
    ws.session_date AS day,
    'work'::text AS kind,
    count(*)::int AS n
  FROM work_sessions ws
  WHERE ws.user_id = p_user_id
    AND ws.session_date >= DATE '2000-01-01'
  GROUP BY 1

  -- DESC so the newest days survive PostgREST's 1000-row cap (was ORDER BY 1,2
  -- which kept the oldest 1000 and hid everything after 2020-03-20).
  ORDER BY day DESC, kind;
$function$
;
