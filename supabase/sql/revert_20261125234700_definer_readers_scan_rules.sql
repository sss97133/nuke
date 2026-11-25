-- Revert of 20261125234700_definer_readers_scan_rules.sql: get_user_day_receipt and vehicle_axle_type_evidence return
-- to their 2026-11-25 bodies (the reading text served raw again) and the two probe rows go. Run by hand only if the
-- migration must be undone; it re-opens the narrative and text-region path to strangers.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

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
        AND o.is_superseded IS NOT TRUE
        AND NOT public.image_reading_tier_is_automatic(o.agent_tier)  -- (20261121230000) a thin reading is not shown as the photo's reading
      ORDER BY o.ingested_at DESC
      LIMIT 1
    ) a ON true
    WHERE vi.user_id = p_user_id
      AND vi.taken_at >= p_date::timestamptz
      AND vi.taken_at < (p_date + 1)::timestamptz
      AND COALESCE(vi.is_duplicate, false) = false
      AND (v_is_owner OR (vi.vehicle_image_gallery_eligible IS TRUE AND vi.is_sensitive IS NOT TRUE
        AND vi.is_document IS NOT TRUE AND vi.doc_flag IS NOT TRUE AND EXISTS (SELECT 1 FROM public.vehicles visible_vehicle WHERE visible_vehicle.id=vi.vehicle_id AND visible_vehicle.is_public IS TRUE AND visible_vehicle.deleted_at IS NULL)))
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
  WHERE ws.user_id = p_user_id AND ws.session_date = p_date
    AND (v_is_owner OR EXISTS (SELECT 1 FROM public.vehicles visible_vehicle WHERE visible_vehicle.id=ws.vehicle_id AND visible_vehicle.is_public IS TRUE AND visible_vehicle.deleted_at IS NULL));

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
      AND (v_is_owner OR (vi.vehicle_image_gallery_eligible IS TRUE AND vi.is_sensitive IS NOT TRUE
        AND vi.is_document IS NOT TRUE AND vi.doc_flag IS NOT TRUE AND EXISTS (SELECT 1 FROM public.vehicles visible_vehicle WHERE visible_vehicle.id=vi.vehicle_id AND visible_vehicle.is_public IS TRUE AND visible_vehicle.deleted_at IS NULL)))
      AND v_is_owner
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
$function$;

CREATE OR REPLACE FUNCTION public.vehicle_axle_type_evidence(p_vehicle_id uuid)
 RETURNS TABLE(origin text, item_id uuid, image_id uuid, shop text, day date, axle_type text, printed text, method text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH v AS (
    SELECT v.id FROM public.vehicles v
     WHERE v.id = p_vehicle_id AND v.deleted_at IS NULL
       AND (v.is_public IS TRUE OR auth.role() = 'service_role' OR (auth.uid() IS NOT NULL AND (v.user_id = auth.uid()
            OR v.owner_id = auth.uid() OR v.uploaded_by = auth.uid() OR public.vehicle_user_has_access(v.id, auth.uid()))))),
  -- (a) paper: the cheap words test first, then the placement and the line kind on the few lines that name a type.
  raw AS MATERIALIZED (
    SELECT i.id AS item_id, r.vendor_name, i.description, i.part_number, i.total_price, i.hours,
           i.line_date, l.page_date, r.receipt_date, nullif(btrim(i.performer), '') AS performer,
           public.axle_type_from_words(i.description) AS ty
      FROM v
      JOIN public.receipt_vehicle_links l ON l.vehicle_id = v.id AND l.status = 'linked' AND l.retired_at IS NULL
      JOIN public.receipts r ON r.id = l.receipt_id AND r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL
      JOIN public.receipt_items i ON i.receipt_id = r.id
     WHERE i.description ~* '(posi|limited|lsd|locker|spool|traction|trac.?lok|sure.?grip|safe.?t|true.?trac|open)'
       AND public.axle_type_from_words(i.description) IS NOT NULL),
  paper AS (
    SELECT w.item_id, w.ty,
           nullif(left(btrim(public.text_redact_contact(w.vendor_name)), 300), '') AS shop,
           public.axle_printed_words(w.description) AS printed,
           coalesce(CASE WHEN w.line_date <= current_date + 1 THEN w.line_date END,
                    CASE WHEN w.page_date <= current_date + 1 THEN w.page_date END,
                    CASE WHEN w.receipt_date <= current_date + 1 THEN w.receipt_date END) AS day
      FROM raw w
     WHERE public.receipt_line_system(w.description) = 'axle'
       AND (public.receipt_line_kind(w.description, w.part_number, w.total_price, w.hours, w.line_date, w.performer) IN ('labor', 'note')
            OR (public.receipt_line_kind(w.description, w.part_number, w.total_price, w.hours, w.line_date, w.performer) = 'part'
                AND w.part_number IS NULL AND lower(w.description) ~
                  '\y(check and repair|repair|rebuild|install(ation)?|replace|swap|convert(ed)?|labor|set ?up|service)\y'))),
  -- (b) photos: printed text on the picture, then component labels; never the reader's notes.
  ph AS MATERIALIZED (
    SELECT o.id AS obs_id, o.extraction_method, o.observed_at, w.printed,
           CASE WHEN w.src = 'text' THEN 0 ELSE 1 END AS rank, w.ty,
           CASE WHEN o.structured_data->>'image_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN (o.structured_data->>'image_id')::uuid END AS img
      FROM v
      JOIN public.vehicle_observations o ON o.vehicle_id = v.id AND o.extraction_method = 'reviewed_image_analysis_v1'
           AND o.is_superseded IS NOT TRUE AND o.superseded_by IS NULL
           -- One pass over the stored reading names the few that mention a unit at all; only those are unpacked.
           -- The same reading must also name the differential or axle, so a locker, a spool or a bottle of gear oil
           -- elsewhere in the picture is not an axle reading.
           AND jsonb_path_exists(o.structured_data, '$ ? (exists($.components_seen[*] ? (@.label like_regex "differential|\\bdiff\\b|axle|rear.?end|carrier" flag "i")) && (exists($.text_regions[*] ? (@.text like_regex "limited|posi|lsd|locker|spool|traction|trac.?lok|sure.?grip|safe.?t|true.?trac" flag "i")) || exists($.components_seen[*] ? (@.label like_regex "limited|posi|lsd|locker|spool|traction|trac.?lok|sure.?grip|safe.?t|true.?trac" flag "i"))))')
      CROSS JOIN LATERAL (
        SELECT 'text' AS src, x->>'text' AS printed, public.axle_type_from_words(x->>'text', false) AS ty
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.structured_data->'text_regions') = 'array' THEN o.structured_data->'text_regions' ELSE '[]'::jsonb END) x
        UNION ALL
        SELECT 'label', x->>'label', public.axle_type_from_words(x->>'label', false)
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.structured_data->'components_seen') = 'array' THEN o.structured_data->'components_seen' ELSE '[]'::jsonb END) x
         WHERE x->>'label' ~* 'differential|\ydiff\y|axle|rear.?end|carrier'
      ) w
     WHERE w.ty IS NOT NULL),
  one AS (
    SELECT DISTINCT ON (coalesce(p.img::text, p.obs_id::text), p.ty) p.*
      FROM ph p ORDER BY coalesce(p.img::text, p.obs_id::text), p.ty, p.rank, p.obs_id)
  SELECT 'paper', p.item_id, NULL::uuid, p.shop, p.day, p.ty, p.printed, 'receipt_items'
    FROM paper p
  UNION ALL
  -- The image is returned as an id only; whether the viewer may be shown it is decided in the invoker's reader.
  SELECT CASE WHEN o.rank = 0 THEN 'photo_text' ELSE 'photo_label' END, o.obs_id, o.img, NULL::text,
         o.observed_at::date, o.ty, public.axle_printed_words(o.printed), o.extraction_method
    FROM one o
$function$;

DO $r$ BEGIN
  IF to_regclass('public.private_row_probes') IS NOT NULL THEN
    EXECUTE $d$DELETE FROM public.private_row_probes WHERE owner_lane = 'ta-policies'
      AND reader IN ('get_analysis_stream', 'vehicle_axle_type_evidence')$d$;
  END IF;
END $r$;

DO $verify$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.get_user_day_receipt(uuid, date)'::regprocedure) <> 'da8b99c06758ca0da01b10e37ac4b287'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.vehicle_axle_type_evidence(uuid)'::regprocedure) <> '8863aff3ba5e35f59f07dbaf428b3fda' THEN
    RAISE EXCEPTION 'revert did not restore the 2026-11-25 bodies';
  END IF;
END
$verify$;
COMMIT;
