-- Owner photo commentary — testimony, not a menu pick.
--
-- WHY: the photo evidence rail (ProfileTab PhotoFullScreenView) asked "Why was
-- this taken?" and forced the owner to pick from a fixed 6-item taxonomy. That
-- inverts the right relationship: the agent guessed a category and the human was
-- demoted to confirming it from a menu. Skylar's directive: let the owner write
-- free-text context in their own words; the in-house (BYOK) agent distills the
-- category from it.
--
-- MODEL (per agent-trust-invariants + feedback_photo_intent_must_be_confirmed):
--   * The owner's words are NEW primary testimony → their own vehicle_observations
--     row (kind=comment, source=owner-input, trust 0.95), stored verbatim. They
--     never overwrite the agent's image_deep_byok analysis row — the two layers
--     stay separate and both remain auditable.
--   * structured_data.needs_distill=true marks the comment for the BYOK pipeline
--     to re-read and refine intent (superseding the prior verdict), out-of-band.
--   * confirm_photo_intent (the explicit one-tap confirm) is untouched and still
--     works for the photos already confirmed that way.
--
-- This migration:
--   (1) add_photo_comment(p_image_id, p_comment) — owner-gated SECURITY DEFINER
--       writer, mirroring confirm_photo_intent's ownership gate. ingest-observation
--       (the canonical writer) runs service-role with NO caller auth, so it cannot
--       be exposed to the app; an owner-gated RPC is the safe path.
--   (2) get_user_day_receipt — surface the latest owner comment per photo as
--       owner_note so the rail shows it (and it persists past the optimistic flip).

-- ── (1) the writer ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_photo_comment(p_image_id uuid, p_comment text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner   uuid;
  v_vehicle uuid;
  v_source  uuid;
  v_text    text := btrim(p_comment);
  v_hash    text;
  v_obs_id  uuid;
BEGIN
  -- Owner gate — caller must own the image (same shape as confirm_photo_intent).
  SELECT user_id, vehicle_id INTO v_owner, v_vehicle
  FROM vehicle_images WHERE id = p_image_id;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorized');
  END IF;
  IF v_text IS NULL OR length(v_text) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'empty');
  END IF;

  SELECT id INTO v_source FROM observation_sources WHERE slug = 'owner-input';

  -- Idempotent: same owner text on the same image dedups (no double-tap dupes).
  v_hash := md5('owner_comment|' || p_image_id::text || '|' || v_text);
  SELECT id INTO v_obs_id FROM vehicle_observations WHERE content_hash = v_hash LIMIT 1;
  IF v_obs_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'observation_id', v_obs_id, 'duplicate', true);
  END IF;

  INSERT INTO vehicle_observations (
    vehicle_id, observed_at, source_id, kind, content_text, content_hash,
    structured_data, confidence, confidence_score, observer_raw
  ) VALUES (
    v_vehicle, now(), v_source, 'comment', v_text, v_hash,
    jsonb_build_object(
      'analysis_kind', 'owner_comment',
      'image_id', p_image_id::text,
      'needs_distill', true   -- BYOK re-distill refines intent from these words
    ),
    'high', 0.95,
    jsonb_build_object('owner_user_id', auth.uid(), 'authored', 'owner_free_text')
  )
  RETURNING id INTO v_obs_id;

  RETURN jsonb_build_object('ok', true, 'observation_id', v_obs_id, 'image_id', p_image_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.add_photo_comment(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.add_photo_comment(uuid, text) TO authenticated;

-- ── (2) surface owner_note on each day-receipt photo ────────────────────────
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
           'total_job_cost', CASE WHEN v_is_owner THEN ws.total_job_cost ELSE NULL END
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

  v_facets := jsonb_build_object(
    'photos', jsonb_array_length(v_photos),
    'work', jsonb_array_length(v_work),
    'receipts', jsonb_array_length(v_receipts)
  );

  RETURN jsonb_build_object(
    'date', p_date,
    'is_owner_view', v_is_owner,
    'photos', v_photos,
    'work_sessions', v_work,
    'receipts', v_receipts,
    'facets', v_facets
  );
END;
$function$;
